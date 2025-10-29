# isbnet/data/forinstance.py (CORRECTED FOR INFERENCE)

import numpy as np
import torch
from torch.utils.data import Dataset
import os
import os.path as osp
from glob import glob
from isbnet.ops import voxelization_idx

class ForInstanceDataset(Dataset):
    """
    A simplified version of the original dataset class, specifically for inference.
    It removes data augmentations and the faulty validity checks that cause infinite loops.
    """
    CLASSES = ("ground", "tree")

    def __init__(self, data_root, prefix, suffix, voxel_cfg=None, training=False, logger=None, **kwargs):
        self.data_root = data_root
        self.prefix = prefix
        self.suffix = suffix
        self.voxel_cfg = voxel_cfg
        self.logger = logger
        
        self.filenames = sorted(glob(osp.join(self.data_root, self.prefix, "*" + self.suffix)))
        if logger: logger.info(f"Load inference dataset: {len(self.filenames)} files loaded.")

    def load(self, filename):
        # For inference, our .pth files are a 4-tuple:
        # (xyz_centered, colors, dummy_semantic_labels, dummy_instance_labels)
        return torch.load(filename, weights_only=False)

    def __len__(self):
        return len(self.filenames)

    def __getitem__(self, index):
        filename = self.filenames[index]
        scan_id = os.path.basename(filename).replace(self.suffix, "")
        
        xyz, rgb, semantic_label, instance_label = self.load(filename)
        
        # --- Simple Transformation for Inference ---
        # The data is already centered. We just need to scale it for voxelization.
        xyz_scaled = xyz * self.voxel_cfg.scale
        
        # Shift to be all-positive for voxelization indexing
        xyz_final = xyz_scaled - xyz_scaled.min(0)

        # The collate_fn handles cases where there are too few points by returning None.
        if xyz_final.shape[0] < self.voxel_cfg.get("min_npoint", 1):
             return None

        # Convert to tensors
        coord = torch.from_numpy(xyz_final).long()
        coord_float = torch.from_numpy(xyz).float() # The original, centered (non-scaled) coords
        feat = torch.from_numpy(rgb).float()
        semantic_label = torch.from_numpy(semantic_label).long()
        instance_label = torch.from_numpy(instance_label).long()
        
        # Create dummy spp and inst_num for collate_fn compatibility
        spp = torch.from_numpy(np.arange(xyz.shape[0]))
        inst_num = 0 # No ground truth instances

        return (scan_id, coord, coord_float, feat, semantic_label, instance_label, spp, inst_num)

    def collate_fn(self, batch):
        # This collate_fn is from the original file and is correct.
        scan_ids, coords, coords_float, feats, semantic_labels, instance_labels = [], [], [], [], [], []
        spps, instance_batch_offsets = [], [0]
        total_inst_num, batch_id, spp_bias = 0, 0, 0
        
        for data in batch:
            if data is None: continue # Correctly handles sparse/empty chunks
            (scan_id, coord, coord_float, feat, semantic_label, instance_label, spp, inst_num) = data
            spp += spp_bias
            spp_bias = spp.max().item() + 1
            instance_label[instance_label != -100] += total_inst_num
            total_inst_num += inst_num
            scan_ids.append(scan_id)
            coords.append(torch.cat([coord.new_full((coord.size(0), 1), batch_id), coord], 1))
            coords_float.append(coord_float)
            feats.append(feat)
            semantic_labels.append(semantic_label)
            instance_labels.append(instance_label)
            spps.append(spp)
            instance_batch_offsets.append(total_inst_num)
            batch_id += 1
            
        if batch_id == 0: return None
        
        coords = torch.cat(coords, 0)
        batch_idxs = coords[:, 0].int()
        coords_float = torch.cat(coords_float, 0).to(torch.float32)
        feats = torch.cat(feats, 0)
        semantic_labels = torch.cat(semantic_labels, 0).long()
        instance_labels = torch.cat(instance_labels, 0).long()
        spps = torch.cat(spps, 0).long()
        
        spatial_shape = np.clip(coords.max(0)[0][1:].numpy() + 1, self.voxel_cfg.spatial_shape[0], None)
        voxel_coords, v2p_map, p2v_map = voxelization_idx(coords, batch_id)
        
        # For inference, we don't need all the training-specific labels
        return {
            "scan_ids": scan_ids, "batch_idxs": batch_idxs, "voxel_coords": voxel_coords,
            "p2v_map": p2v_map, "v2p_map": v2p_map, "coords_float": coords_float,
            "feats": feats,
            "spatial_shape": spatial_shape, "batch_size": batch_id,
            "semantic_labels": semantic_labels, # Needed for some internal logic
            "instance_labels": instance_labels, # Needed for some internal logic
            "spps": spps, # Needed by the model
        }