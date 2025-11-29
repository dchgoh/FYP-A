import numpy as np
import torch
import yaml
from munch import Munch
from torch.nn.parallel import DistributedDataParallel
import random
import argparse
import datetime
import os
import os.path as osp
import shutil
import time
from isbnet.data import build_dataloader, build_dataset
from isbnet.evaluation import PointWiseEval, ScanNetEval
from isbnet.model import ISBNet
from isbnet.model.criterion import Criterion
from isbnet.util import (
    AverageMeter,
    SummaryWriter,
    build_optimizer,
    checkpoint_save,
    cosine_lr_after_step,
    get_dist_info,
    get_max_memory,
    get_root_logger,
    init_dist,
    is_main_process,
    is_multiple,
    is_power2,
    load_checkpoint,
)


def get_args():
    parser = argparse.ArgumentParser("ISBNet")
    parser.add_argument("config", type=str, help="path to config file")
    parser.add_argument("--dist", action="store_true", help="run with distributed parallel")
    parser.add_argument("--resume", type=str, help="path to resume from")
    parser.add_argument("--work_dir", type=str, help="working directory")
    parser.add_argument("--skip_validate", action="store_true", help="skip validation")
    parser.add_argument("--local_rank", type=int, default=0)
    parser.add_argument("--exp_name", type=str, default="default")
    parser.add_argument("--only_backbone", action="store_true", help="only train backbone")
    parser.add_argument("--trainall", action="store_true", help="only train backbone")
    parser.add_argument("--seed", type=int, default=42, help="random seed for reproducibility")
    args = parser.parse_args()
    return args


def train(epoch, model, optimizer, scheduler, scaler, train_loader, cfg, logger, writer):
    model.train()
    iter_time = AverageMeter(True)
    data_time = AverageMeter(True)
    meter_dict = {}
    end = time.time()

    if train_loader.sampler is not None and cfg.dist:
        train_loader.sampler.set_epoch(epoch)

    for i, batch in enumerate(train_loader, start=1):
        data_time.update(time.time() - end)

        if scheduler is None:
            cosine_lr_after_step(optimizer, cfg.optimizer.lr, epoch - 1, cfg.step_epoch, cfg.epochs)
        with torch.cuda.amp.autocast(enabled=cfg.fp16):
            loss, log_vars = model(batch, return_loss=True, epoch=epoch - 1)

        # meter_dict
        for k, v in log_vars.items():
            if k != "placeholder":
                if k not in meter_dict.keys():
                    meter_dict[k] = AverageMeter()
                meter_dict[k].update(v)

        # backward
        optimizer.zero_grad()
        scaler.scale(loss).backward()
        scaler.step(optimizer)
        scaler.update()

        # time and print
        remain_iter = len(train_loader) * (cfg.epochs - epoch + 1) - i
        iter_time.update(time.time() - end)
        end = time.time()
        remain_time = remain_iter * iter_time.avg
        remain_time = str(datetime.timedelta(seconds=int(remain_time)))
        lr = optimizer.param_groups[0]["lr"]

        if scheduler is not None:
            scheduler.step()

        if is_multiple(i, 10):
            # Get the scene name from the batch dictionary. The key might be 'scene_name', 'filename', or similar.
            # We'll try a common one, 'scan_ids', but you may need to check your dataset's code.
            # Let's add a safe way to get it.
            scene_name = batch.get('scan_ids', ['unknown_scene'])[0]
            
            # --- Main Log Line ---
            log_str = f"Epoch [{epoch}/{cfg.epochs}][{i}/{len(train_loader)}] Scene: {scene_name}  "
            log_str += (
                f"lr: {lr:.2g}, eta: {remain_time}, mem: {get_max_memory()}, "
                f"data_time: {data_time.val:.2f}, iter_time: {iter_time.val:.2f}"
            )
            
            # Add total_loss to the main log line, checking if it exists first
            if 'loss' in meter_dict:
                log_str += f", total_loss: {meter_dict['loss'].val:.4f}"
            
            # --- Individual Loss Breakdown ---
            loss_log_str = "    Losses -> "
            # Iterate through the items and build the string, excluding total_loss
            for k, v in meter_dict.items():
                if k != 'loss':
                    loss_log_str += f"{k}: {v.val:.4f} | "
            
            # Print both log strings
            logger.info(log_str)
            logger.info(loss_log_str)
            # <<< MODIFICATION END >>>

    writer.add_scalar("train/learning_rate", lr, epoch)
    # <<< MODIFICATION START >>>
    # Log each individual loss component to TensorBoard
    for k, v in meter_dict.items():
        writer.add_scalar(f"train/{k}", v.avg, epoch)
    # <<< MODIFICATION END >>>
    checkpoint_save(epoch, model, optimizer, cfg.work_dir, cfg.save_freq)


def validate(epoch, model, optimizer, val_loader, cfg, logger, writer):
    logger.info("Validation")
    all_pred_insts, all_sem_labels, all_ins_labels = [], [], []

    val_set = val_loader.dataset

    point_eval = PointWiseEval(num_classes=cfg.model.semantic_classes)
    scannet_eval = ScanNetEval(val_set.CLASSES, dataset_name=cfg.data.train.type)

    torch.cuda.empty_cache()

    model.iterative_sampling = False
    with torch.no_grad():
        model.eval()
        for i, batch in enumerate(val_loader):

            if cfg.data.train.type == "s3dis" and batch["coords_float"].shape[0] > 3000000:
                continue

            with torch.cuda.amp.autocast(enabled=cfg.fp16):
                res = model(batch)

            if i % 10 == 0:
                logger.info(f"Infer scene {i+1}/{len(val_set)}")

            if cfg.model.semantic_only:
                point_eval.update(
                    res["semantic_preds"],
                    res["centroid_offset"],
                    res["corners_offset"],
                    res["semantic_labels"],
                    res["centroid_offset_labels"],
                    res["corners_offset_labels"],
                    res["instance_labels"],
                )
            else:
                all_pred_insts.append(res["pred_instances"])
                all_sem_labels.append(res["semantic_labels"])
                all_ins_labels.append(res["instance_labels"])

    global best_metric

    if cfg.model.semantic_only:
        logger.info("Evaluate semantic segmentation and offset MAE")
        miou, acc, mae = point_eval.get_eval(logger)

        writer.add_scalar("val/mIoU", miou, epoch)
        writer.add_scalar("val/Acc", acc, epoch)
        writer.add_scalar("val/Offset MAE", mae, epoch)

        if best_metric < miou:
            best_metric = miou
            checkpoint_save(epoch, model, optimizer, cfg.work_dir, cfg.save_freq, best=True)

    else:
        logger.info("Evaluate instance segmentation")
        eval_res = scannet_eval.evaluate(all_pred_insts, all_sem_labels, all_ins_labels)
        del all_pred_insts, all_sem_labels, all_ins_labels

        writer.add_scalar("val/AP", eval_res["all_ap"], epoch)
        writer.add_scalar("val/AP_50", eval_res["all_ap_50%"], epoch)
        writer.add_scalar("val/AP_25", eval_res["all_ap_25%"], epoch)
        logger.info(
            "AP: {:.3f}. AP_50: {:.3f}. AP_25: {:.3f}".format(
                eval_res["all_ap"], eval_res["all_ap_50%"], eval_res["all_ap_25%"]
            )
        )

        if best_metric < eval_res["all_ap"]:
            best_metric = eval_res["all_ap"]
            logger.info(f"New best mAP {best_metric} at {epoch}")
            checkpoint_save(epoch, model, optimizer, cfg.work_dir, cfg.save_freq, best=True)


def main():
    args = get_args()
    cfg_txt = open(args.config, "r").read()
    cfg = Munch.fromDict(yaml.safe_load(cfg_txt))

    # <<< MODIFICATION START >>>
    # Moved logger and work_dir setup to the beginning to ensure logger exists before use.
    if args.work_dir:
        cfg.work_dir = args.work_dir
    else:
        dataset_name = cfg.data.train.type
        cfg.work_dir = osp.join("./work_dirs", dataset_name, osp.splitext(osp.basename(args.config))[0], args.exp_name)

    os.makedirs(osp.abspath(cfg.work_dir), exist_ok=True)
    timestamp = time.strftime("%Y%m%d_%H%M%S", time.localtime())
    log_file = osp.join(cfg.work_dir, f"{timestamp}.log")
    logger = get_root_logger(log_file=log_file)
    
    # Using the --seed argument now that the logger exists.
    if args.seed is not None:
        logger.info(f"Set random seed to {args.seed}")
        random.seed(args.seed)
        np.random.seed(args.seed)
        torch.manual_seed(args.seed)
        if torch.cuda.is_available():
            torch.cuda.manual_seed_all(args.seed)
    # <<< MODIFICATION END >>>

    if args.dist:
        init_dist()
    cfg.dist = args.dist

    if args.only_backbone:
        logger.info("Only train backbone")
        cfg.model.semantic_only = True
        cfg.model.fixed_modules = []

    if args.trainall:
        logger.info("Train all !!!!!!!!!!!!!!!!")
        cfg.model.semantic_only = False
        cfg.model.fixed_modules = []

    logger.info(f"Config:\n{cfg_txt}")
    logger.info(f"Distributed: {args.dist}")
    logger.info(f"Mix precision training: {cfg.fp16}")
    shutil.copy(args.config, osp.join(cfg.work_dir, osp.basename(args.config)))
    writer = SummaryWriter(cfg.work_dir)

    logger.info(f"Save at: {cfg.work_dir}")

    criterion = Criterion(
        cfg.model.semantic_classes,
        cfg.model.instance_classes,
        cfg.model.semantic_weight,
        cfg.model.ignore_label,
        semantic_only=cfg.model.semantic_only,
        total_epoch=cfg.epochs,
        trainall=args.trainall,
        voxel_scale=cfg.data.train.voxel_cfg.scale,
    )

    model = ISBNet(**cfg.model, criterion=criterion, dataset_name=cfg.data.train.type, trainall=args.trainall).cuda()
    
    # <<< MODIFICATION START >>>
    # Diagnostic check for frozen backbone
    logger.info("="*50)
    logger.info("Checking Model Parameter Status (requires_grad)")
    logger.info("="*50)
    unet_is_training = False
    total_params = sum(p.numel() for p in model.parameters())
    trainable_params = sum(p.numel() for p in model.parameters() if p.requires_grad)

    for name, param in model.named_parameters():
        if 'unet' in name and param.requires_grad:
            unet_is_training = True
            break # Found a trainable UNet parameter, no need to check further

    logger.info("-"*50)
    if unet_is_training:
        logger.info("✅ SUCCESS: The UNet backbone is UNFROZEN and will be trained.")
    else:
        logger.info("🚨 CRITICAL: The UNet backbone is FROZEN. Gradients are disabled.")
        logger.info("    -> To fix, ensure 'fixed_modules' in your config is empty or commented out.")
        
    logger.info(f"Total model parameters: {total_params / 1e6:.2f}M")
    logger.info(f"Trainable model parameters: {trainable_params / 1e6:.2f}M")
    logger.info("-"*50)
    # <<< MODIFICATION END >>>

    if args.dist:
        model = DistributedDataParallel(
            model, device_ids=[torch.cuda.current_device()], find_unused_parameters=(trainable_params < total_params)
        )

    scaler = torch.cuda.amp.GradScaler(enabled=cfg.fp16)

    train_set = build_dataset(cfg.data.train, logger)
    val_set = build_dataset(cfg.data.test, logger)

    train_loader = build_dataloader(train_set, training=True, dist=args.dist, **cfg.dataloader.train)
    val_loader = build_dataloader(val_set, training=False, dist=False, **cfg.dataloader.test)

    # <<< MODIFICATION START >>>
    # Made the auto_scale_lr logic safer using .pop()
    if cfg.optimizer.pop('auto_scale_lr', False): # Default to False if not specified
        default_lr = cfg.optimizer.lr
        _, world_size = get_dist_info()
        total_batch_size = cfg.dataloader.train.batch_size * world_size
        if total_batch_size > 0:
            scaled_lr = default_lr * (total_batch_size / 16.0)
            cfg.optimizer.lr = scaled_lr
            logger.info(f"Auto-scaling LR from {default_lr} (for reference batch size 16) to {scaled_lr:.6f} (for current batch size {total_batch_size})")
    else:
        logger.info("Auto-scaling of learning rate is DISABLED. Using LR from config file directly.")
    optimizer = build_optimizer(model, cfg.optimizer)
    # <<< MODIFICATION END >>>

    start_epoch = 1
    if args.resume:
        logger.info(f"Resume from {args.resume}")
        start_epoch = load_checkpoint(args.resume, logger, model, optimizer=optimizer)
    elif cfg.pretrain:
        logger.info(f"Load pretrain from {cfg.pretrain}")
        load_checkpoint(cfg.pretrain, logger, model)

    scheduler = None
    global best_metric
    best_metric = 0

    logger.info("Training")
    for epoch in range(start_epoch, cfg.epochs + 1):
        train(epoch, model, optimizer, scheduler, scaler, train_loader, cfg, logger, writer)
        if not args.skip_validate and (is_multiple(epoch, cfg.save_freq) or is_power2(epoch)) and is_main_process():
            validate(epoch, model, optimizer, val_loader, cfg, logger, writer)
        writer.flush()

    logger.info(f"Finish!!! Model at: {cfg.work_dir}")


if __name__ == "__main__":
    main()