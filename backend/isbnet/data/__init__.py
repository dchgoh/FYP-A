# isbnet/data/__init__.py

from torch.utils.data import DataLoader
from torch.utils.data.distributed import DistributedSampler

# --- Original Datasets ---
from .s3dis import S3DISDataset
from .scannet200 import ScanNet200Dataset
from .scannetv2 import ScanNetDataset
from .stpls3d import STPLS3DDataset
from .replica import ReplicaDataset

# =================================================================
# MODIFICATION 1: Import your new dataset class
# =================================================================
# We assume your dataset class is named 'ForInstanceDataset' and is in a file
# named 'forinstance.py' inside this same 'data' directory.
# If your file is named something else (like custom.py), change the import accordingly.
from .forinstance import ForInstanceDataset
# =================================================================


# Add your new dataset to the __all__ list for clean imports
__all__ = [
    "S3DISDataset",
    "ScanNetDataset",
    "ScanNet200Dataset",
    "STPLS3DDataset",
    "ReplicaDataset",
    "ForInstanceDataset", # <-- Added here
    "build_dataset"
]


def build_dataset(data_cfg, logger):
    """
    Factory function to build a dataset instance from a configuration dictionary.
    """
    assert "type" in data_cfg
    _data_cfg = data_cfg.copy()
    _data_cfg["logger"] = logger
    data_type = _data_cfg.pop("type")

    if data_type == "s3dis":
        return S3DISDataset(**_data_cfg)
    elif data_type == "scannetv2":
        return ScanNetDataset(**_data_cfg)
    elif data_type == "scannet200":
        return ScanNet200Dataset(**_data_cfg)
    elif data_type == "stpls3d":
        return STPLS3DDataset(**_data_cfg)
    elif data_type == "replica":
        return ReplicaDataset(**_data_cfg)
    # =================================================================
    # MODIFICATION 2: Add your dataset to the factory function
    # =================================================================
    # This is the "magic" that connects the config file to your code.
    # When the config says `type: forinstance`, this `elif` block will be executed.
    elif data_type == "forinstance":
        return ForInstanceDataset(**_data_cfg)
    # =================================================================
    else:
        raise ValueError(f"Unknown dataset type: {data_type}")


def build_dataloader(dataset, batch_size=1, num_workers=1, training=True, dist=False):
    """
    This function builds the DataLoader. It is generic and does NOT need to be modified,
    as it will work correctly with any dataset instance that is passed to it.
    """
    shuffle = training
    sampler = DistributedSampler(dataset, shuffle=shuffle) if dist else None
    if sampler is not None:
        shuffle = False
        
    if training:
        return DataLoader(
            dataset,
            batch_size=batch_size,
            num_workers=num_workers,
            collate_fn=dataset.collate_fn,
            shuffle=shuffle,
            sampler=sampler,
            drop_last=True,
            pin_memory=True,
        )
    else:
        return DataLoader(
            dataset,
            batch_size=batch_size,
            num_workers=num_workers,
            collate_fn=dataset.collate_fn,
            shuffle=False,
            sampler=sampler,
            drop_last=False,
            pin_memory=True,
        )