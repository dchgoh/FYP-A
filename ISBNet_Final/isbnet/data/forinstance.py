# isbnet/data/forinstance.py

import numpy as np
import scipy.interpolate
import scipy.ndimage
import torch
from torch.utils.data import Dataset
import random
import math
import os
import os.path as osp
from glob import glob
from isbnet.ops import voxelization_idx

class ForInstanceDataset(Dataset):
    """
    Custom PyTorch Dataset for the FOR-Instance dataset.
    This dataset is designed to work with pre-processed, instance-aware chunks.
    """

    CLASSES = ("ground", "tree")
    BENCHMARK_SEMANTIC_IDXS = [i for i in range(len(CLASSES))]
    # =================================================================
    # CHANGE 1: Accept the 'repeat' parameter from the config file.
    # We set a default value of 1.
    # =================================================================
    def __init__(self, data_root, prefix, suffix, voxel_cfg=None, training=True, logger=None, repeat=1):
        self.data_root = data_root
        self.prefix = prefix
        self.suffix = suffix
        self.voxel_cfg = voxel_cfg
        self.training = training
        self.logger = logger
        self.mode = "train" if training else "test"
        
        # Ensure we only repeat the training set, not the validation/test sets.
        if not self.training:
            repeat = 1
        
        # Get the list of all pre-processed .pth chunk files, passing the repeat value.
        self.filenames = self.get_filenames(repeat)
        
        if logger:
            logger.info(f"Load {self.mode} dataset: {len(self.filenames)} files loaded.")

    # =================================================================
    # CHANGE 2: Modify get_filenames to use the 'repeat' value.
    # =================================================================
    def get_filenames(self, repeat):
        """Finds all pre-processed .pth chunk files and repeats the list if specified."""
        path = osp.join(self.data_root, self.prefix, "*" + self.suffix)
        filenames = glob(path)
        assert len(filenames) > 0, f"No files found matching the pattern: {path}"
        
        # This is the key logic: multiply the list of filenames.
        # This makes the dataset appear 'repeat' times larger to the dataloader.
        if repeat > 1:
            filenames = filenames * repeat
            
        return sorted(filenames)

    def load(self, filename):
        """Loads a single .pth chunk file."""
        xyz, colors, semantic_label, instance_label = torch.load(filename, weights_only=False)
        spp = np.arange(xyz.shape[0]) # Create a dummy superpoint array
        return xyz, colors, semantic_label, instance_label, spp

    def __len__(self):
        return len(self.filenames)

    def elastic(self, x, gran, mag):
        """Applies elastic distortion augmentation."""
        blur0 = np.ones((3, 1, 1)).astype("float32") / 3
        blur1 = np.ones((1, 3, 1)).astype("float32") / 3
        blur2 = np.ones((1, 1, 3)).astype("float32") / 3
        bb = np.abs(x).max(0).astype(np.int32) // gran + 3
        noise = [np.random.randn(bb[0], bb[1], bb[2]).astype("float32") for _ in range(3)]
        noise = [scipy.ndimage.filters.convolve(n, blur0, mode="constant", cval=0) for n in noise]
        noise = [scipy.ndimage.filters.convolve(n, blur1, mode="constant", cval=0) for n in noise]
        noise = [scipy.ndimage.filters.convolve(n, blur2, mode="constant", cval=0) for n in noise]
        noise = [scipy.ndimage.filters.convolve(n, blur0, mode="constant", cval=0) for n in noise]
        noise = [scipy.ndimage.filters.convolve(n, blur1, mode="constant", cval=0) for n in noise]
        noise = [scipy.ndimage.filters.convolve(n, blur2, mode="constant", cval=0) for n in noise]
        ax = [np.linspace(-(b - 1) * gran, (b - 1) * gran, b) for b in bb]
        interp = [scipy.interpolate.RegularGridInterpolator(ax, n, bounds_error=0, fill_value=0) for n in noise]
        def g(x_):
            return np.hstack([i(x_)[:, None] for i in interp])
        return x + g(x) * mag

    def dataAugment(self, xyz, jitter=False, flip=False, rot=False):
        """Applies rigid transformations."""
        m = np.eye(3)
        if jitter and np.random.rand() < 0.8:
            m += np.random.randn(3, 3) * 0.1
        if rot and np.random.rand() < 0.8:
            theta = np.random.rand() * 2 * math.pi
            m = np.matmul(m, [[math.cos(theta), math.sin(theta), 0], [-math.sin(theta), math.cos(theta), 0], [0, 0, 1]])
        rotated_xyz = np.matmul(xyz, m)
        if flip:
          for i in range(3):
            if np.random.rand() < 0.5:
              rotated_xyz[:, i] = -rotated_xyz[:, i]
        return rotated_xyz

    def transform_train(self, xyz, rgb, semantic_label, instance_label, spp):
        """Transformation pipeline for training. Cropping is DISABLED."""
        xyz_middle = self.dataAugment(xyz, True, True, True)
        xyz_scaled = xyz_middle * self.voxel_cfg.scale
        
        if np.random.rand() < 0.8:
            xyz_elastic = self.elastic(xyz_scaled, 6, 40.0)
            xyz_elastic = self.elastic(xyz_elastic, 20, 160.0)
        else:
            xyz_elastic = xyz_scaled

        # Directly use the scaled coordinates without elastic distortion
        #xyz_elastic = xyz_scaled
        # =================================================================
        xyz_final = xyz_elastic - xyz_elastic.min(0)
        
        # DO NOT re-normalize. The data is already centered.
        # The 'final' coordinates for voxelization are simply the scaled, centered coordinates.
        #xyz_final = xyz_elastic

        if xyz_final.shape[0] < self.voxel_cfg.get("min_npoint", 1):
             return None
        return xyz_final, xyz_middle, rgb, semantic_label, instance_label, spp
    
    def transform_test(self, xyz, rgb, semantic_label, instance_label, spp):
        """Transformation pipeline for testing."""
        xyz_middle = self.dataAugment(xyz, False, False, False)
        
        # =====================================================================
        # >>> CRITICAL FIX: Manually add point subsampling for testing <<<
        # =====================================================================
        # Get the maximum number of points allowed from the config
        max_points = self.voxel_cfg.get("max_npoint", 200000) # Default to a high number if not set

        if xyz_middle.shape[0] > max_points:
            # If the chunk has too many points, randomly select a subset
            choices = np.random.choice(xyz_middle.shape[0], max_points, replace=False)
            xyz_middle = xyz_middle[choices]
            rgb = rgb[choices]
            semantic_label = semantic_label[choices]
            instance_label = instance_label[choices]
            spp = spp[choices]
        # =====================================================================
        
        xyz_scaled = xyz_middle * self.voxel_cfg.scale
        xyz_final = xyz_scaled - xyz_scaled.min(0)
        #xyz_final = xyz_scaled  # No re-normalization, data is already centered.
        return xyz_final, xyz_middle, rgb, semantic_label, instance_label, spp

    def __getitem__(self, index):
        """Loads and transforms a single chunk."""
        while True:
            filename = self.filenames[index]
            scan_id = os.path.basename(filename).replace(self.suffix, "")
            xyz, rgb, semantic_label, instance_label, spp = self.load(filename)
            if self.training:
                data = self.transform_train(xyz, rgb, semantic_label, instance_label, spp)
            else:
                data = self.transform_test(xyz, rgb, semantic_label, instance_label, spp)
            if data is None:
                index = random.randint(0, len(self) - 1)
                continue
            xyz, xyz_middle, rgb, semantic_label, instance_label, spp = data
            if np.sum(instance_label > -100) == 0:
                index = random.randint(0, len(self) - 1)
                continue
            coord = torch.from_numpy(xyz).long()
            coord_float = torch.from_numpy(xyz_middle).float()
            feat = torch.from_numpy(rgb).float()
            if self.training:
                feat += torch.randn(3) * 0.1
            semantic_label = torch.from_numpy(semantic_label).long()
            instance_label = torch.from_numpy(instance_label).long()
            spp = torch.from_numpy(spp)
            spp = torch.unique(spp, return_inverse=True)[1]
            inst_num = int(instance_label.max()) + 1
            return (scan_id, coord, coord_float, feat, semantic_label, instance_label, spp, inst_num)

    def collate_fn(self, batch):
        """Collates a batch of chunks into a sparse voxel tensor format for ISBNet."""
        scan_ids, coords, coords_float, feats, semantic_labels, instance_labels = [], [], [], [], [], []
        spps, instance_batch_offsets = [], [0]
        total_inst_num, batch_id, spp_bias = 0, 0, 0
        for data in batch:
            if data is None: continue
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
        assert batch_id > 0, "empty batch"
        if batch_id < len(batch) and self.logger:
            self.logger.info(f"batch is truncated from size {len(batch)} to {batch_id}")
        coords = torch.cat(coords, 0)
        batch_idxs = coords[:, 0].int()
        coords_float = torch.cat(coords_float, 0).to(torch.float32)
        feats = torch.cat(feats, 0)
        semantic_labels = torch.cat(semantic_labels, 0).long()
        instance_labels = torch.cat(instance_labels, 0).long()
        spps = torch.cat(spps, 0).long()
        instance_batch_offsets = torch.tensor(instance_batch_offsets, dtype=torch.long)
        
        #First Version
        spatial_shape = np.clip(coords.max(0)[0][1:].numpy() + 1, self.voxel_cfg.spatial_shape[0], None)
        # Find the maximum coordinate in the current batch
        
        #Current Version
        # The coordinates are now centered, so they have negative values. We need to shift
        # them to be all-positive just for the voxelization indexing, without changing
        # the underlying float coordinates.
        #min_coords = coords[:, 1:].min(0).values
        #coords[:, 1:] = coords[:, 1:] - min_coords

        # Now that the integer coordinates for voxelization are all positive, we can find the max.
        # We also need to access .values for max()
        #voxel_shape = coords.max(0).values[1:].cpu().numpy() + 1
        #spatial_shape = np.maximum(voxel_shape, self.voxel_cfg.spatial_shape).astype(int)

        voxel_coords, v2p_map, p2v_map = voxelization_idx(coords, batch_id)
        del coords
        return {
            "scan_ids": scan_ids, "batch_idxs": batch_idxs, "voxel_coords": voxel_coords,
            "p2v_map": p2v_map, "v2p_map": v2p_map, "coords_float": coords_float,
            "feats": feats, "semantic_labels": semantic_labels, "instance_labels": instance_labels,
            "spps": spps, "instance_batch_offsets": instance_batch_offsets,
            "spatial_shape": spatial_shape, "batch_size": batch_id,
        }