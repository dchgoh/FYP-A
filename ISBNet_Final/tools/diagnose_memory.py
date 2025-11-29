# tools/diagnose_memory.py

import argparse
import os
import os.path as osp
import sys
import time
import yaml

import torch
from munch import Munch
from tqdm import tqdm

# Add the project root to the Python path to solve ModuleNotFoundError
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from isbnet.data import build_dataloader, build_dataset
from isbnet.model import ISBNet
from isbnet.model.criterion import Criterion
from isbnet.util import get_root_logger

def get_args():
    parser = argparse.ArgumentParser("ISBNet Memory Diagnoser")
    parser.add_argument("config", type=str, help="path to config file")
    args = parser.parse_args()
    return args

def main():
    args = get_args()
    cfg_txt = open(args.config, "r").read()
    cfg = Munch.fromDict(yaml.safe_load(cfg_txt))

    # Ensure the working directory from the config file exists.
    os.makedirs(cfg.work_dir, exist_ok=True)

    # Create a logger
    timestamp = time.strftime("%Y%m%d_%H%M%S", time.localtime())
    log_file = osp.join(cfg.work_dir, f"memory_diagnosis_{timestamp}.log")
    logger = get_root_logger(log_file=log_file)

    logger.info("Starting ISBNet Memory Diagnosis")
    logger.info(f"Using config: {args.config}")

    # --- Build the Dataset and DataLoader ---
    logger.info("Building dataset...")
    train_set = build_dataset(cfg.data.train, logger)
    
    logger.info("Building dataloader with batch_size=1 and training=False (disables shuffling)...")
    data_loader = build_dataloader(
        train_set,
        training=False,
        dist=False,
        batch_size=1,
        num_workers=cfg.dataloader.train.num_workers
    )

    # --- Build the Model ---
    logger.info("Building model...")
    criterion = Criterion(
        cfg.model.semantic_classes,
        cfg.model.instance_classes,
        cfg.model.semantic_weight,
        cfg.model.ignore_label,
        semantic_only=cfg.model.semantic_only,
    )
    model = ISBNet(**cfg.model, criterion=criterion).cuda()
    model.eval()

    # --- Diagnosis Loop ---
    problematic_files = []
    logger.info("Starting iteration over all training files...")
    
    with torch.no_grad():
        for i, batch in enumerate(tqdm(data_loader, desc="Diagnosing files")):
            scene_name = batch.get('scan_ids', [f'unknown_file_at_index_{i}'])[0]
            
            try:
                for key, value in batch.items():
                    if isinstance(value, torch.Tensor):
                        batch[key] = value.cuda()
                
                _ = model(batch)

            except torch.cuda.OutOfMemoryError:
                logger.error(f"🚨 FAILURE: File '{scene_name}' caused an OOM error.")
                problematic_files.append(scene_name)
                torch.cuda.empty_cache()

            except Exception as e:
                logger.error(f"💥 ERROR: File '{scene_name}' failed with a different error: {e}")
                problematic_files.append(scene_name)

    # --- Final Report ---
    logger.info("=" * 50)
    logger.info("Diagnosis Complete")
    logger.info("=" * 50)

    if not problematic_files:
        logger.info("✅ SUCCESS: No problematic files were found with the current configuration!")
    else:
        logger.warning(f"Found {len(problematic_files)} problematic file(s):")
        for filename in problematic_files:
            logger.warning(f"  - {filename}")
        
        output_txt_path = osp.join(cfg.work_dir, "problematic_files.txt")
        with open(output_txt_path, 'w') as f:
            for filename in problematic_files:
                f.write(f"{filename}\n")
        logger.info(f"List of problematic files saved to: {output_txt_path}")

if __name__ == "__main__":
    main()