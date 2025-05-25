# data_utils/FORInstanceDataLoader.py
import os
import h5py
import numpy as np
import torch
from torch.utils.data import Dataset
import random
import warnings
import time
from collections import Counter
import glob
from tqdm import tqdm # Add tqdm for progress bars during scanning

warnings.filterwarnings('ignore')

def pc_normalize(pc):
    # ... (pc_normalize function remains unchanged) ...
    if pc.ndim != 2 or pc.shape[0] == 0 or pc.shape[1] < 3:
        return pc
    centroid = np.mean(pc[:, :3], axis=0)
    pc_copy = pc.copy()
    pc_copy[:, :3] = pc_copy[:, :3] - centroid
    max_dist = np.max(np.sqrt(np.sum(pc_copy[:, :3] ** 2, axis=1)))
    if max_dist < 1e-6:
        return pc_copy
    pc_copy[:, :3] = pc_copy[:, :3] / max_dist
    return pc_copy

class FORInstanceDataset(Dataset):
    # --- CLASS DEFINITION ---
    def __init__(self, data_root, split='train', num_point=1024, transform=None,
                 single_block_path=None,
                 unclassified_label_id=0,
                 outpoints_label_id=3,
                 # <<< ADDED: Define the TreeID to potentially ignore in weight calculation >>>
                 # Set to -1 if no TreeID should be specifically ignored (e.g., 0 is a valid tree)
                 ignore_tree_id_for_weighting=0,
                 **kwargs):
        self.num_point = num_point
        self.transform = transform
        self.single_mode = single_block_path is not None
        self.unclassified_label_id = unclassified_label_id
        self.outpoints_label_id = outpoints_label_id
        # <<< ADDED: Store the TreeID to ignore during weight calculation >>>
        self.ignore_tree_id_for_weighting = ignore_tree_id_for_weighting

        print(f"--- Initializing FORInstanceDataset ---")
        print(f"Split:                 '{split}'")
        print(f"Points per sample:     {num_point}")
        print(f"Single Block Mode:     {self.single_mode}")
        print(f"Unclassified Label ID (filtering): {self.unclassified_label_id}")
        print(f"Outpoints Label ID (info):       {self.outpoints_label_id}")
        print(f"TreeID to Ignore (for weights):  {self.ignore_tree_id_for_weighting}") # Log the ignore ID
        print(f"Data Root:             '{data_root if not self.single_mode else os.path.dirname(single_block_path)}'")


        if self.single_mode:
            # --- Single Block Mode ---
            print(f"\nInitializing in SINGLE BLOCK mode for: {single_block_path}")
            if not os.path.isfile(single_block_path):
                raise FileNotFoundError(f"Single block file not found: {single_block_path}")

            self.block_filepaths = [single_block_path]
            self.split = "single_block"

            try:
                with h5py.File(single_block_path, 'r') as f:
                    print("Loading data from single block into memory...")
                    start_load = time.time()
                    self.block_data = f['data'][:]
                    self.block_labels = f['label'][:]
                    if 'treeID' not in f:
                        raise KeyError("'treeID' dataset missing from single block file.")
                    self.block_tree_ids = f['treeID'][:] # Load Tree IDs
                    load_time = time.time() - start_load
                    print(f"Single block raw data loaded in {load_time:.2f} seconds.")

                self.raw_total_num_points = self.block_data.shape[0]
                if self.raw_total_num_points == 0:
                    raise ValueError(f"Single block file {single_block_path} contains 0 raw points.")
                if not (self.raw_total_num_points == self.block_labels.shape[0] == self.block_tree_ids.shape[0]):
                     raise ValueError("Mismatched shapes in single block (Raw)")

                print(f"Loaded single block with {self.raw_total_num_points} raw points.")

                # --- Calculate SEMANTIC class weights (Unchanged) ---
                self.class_weights = self.calculate_class_weights(self.block_labels, self.unclassified_label_id)

                # --- Calculate NUM_TREES and TREE_ID_WEIGHTS (Added) ---
                print("\nCalculating TreeID properties for single block...")
                unique_tree_ids = np.unique(self.block_tree_ids)
                # Filter out potential negative IDs if they represent invalid entries
                valid_tree_ids = unique_tree_ids[unique_tree_ids >= 0]
                if len(valid_tree_ids) == 0:
                    print("Warning: No valid (>=0) Tree IDs found in the single block.")
                    self.num_trees = 1 # Set to 1 to avoid errors, represents only background/ignore
                    self.tree_id_weights = torch.ones(1, dtype=torch.float) # Uniform weight for the single class
                else:
                    max_tree_id = int(np.max(valid_tree_ids))
                    self.num_trees = max_tree_id + 1 # Number of classes = max_id + 1 (assumes IDs are 0 to max_id)
                    print(f"Max valid TreeID found: {max_tree_id}. Setting num_trees = {self.num_trees}")
                    # Calculate weights based on the loaded tree IDs
                    self.tree_id_weights = self.calculate_tree_id_weights(self.block_tree_ids, self.num_trees, self.ignore_tree_id_for_weighting)

                # --- Estimate epoch length (Unchanged logic, based on SEMANTIC filtering) ---
                valid_mask = self.block_labels != self.unclassified_label_id
                num_valid_points = np.sum(valid_mask)
                print(f"\nEstimated valid points (excluding Class {self.unclassified_label_id}): {num_valid_points}")
                if num_valid_points == 0:
                    raise ValueError("Single block contains 0 valid points after filtering 'Unclassified'. Cannot proceed.")
                if num_valid_points < self.num_point:
                    print(f"Warning: Valid points in single block ({num_valid_points}) < num_point ({self.num_point}).")

                self.num_samples_per_epoch = max(1, num_valid_points // self.num_point)
                print(f"Setting epoch length for single block: {self.num_samples_per_epoch} steps.")

            except Exception as e:
                print(f"Error initializing single block mode: {e}")
                raise e

        else:
            # --- Multi-Block Mode ---
            print(f"\nInitializing in MULTI BLOCK mode for split '{split}'")
            self.data_root = data_root
            self.split = split
            block_subdir_name = f"{split}_chunks" # Changed from _chunks to _blocks to match example
            self.block_dir = os.path.join(self.data_root, block_subdir_name)

            if not os.path.isdir(self.block_dir):
                raise FileNotFoundError(f"Block directory not found for split '{split}': {self.block_dir}")

            all_potential_paths = sorted(glob.glob(os.path.join(self.block_dir, "*.h5")))
            if not all_potential_paths:
                raise FileNotFoundError(f"No HDF5 files found in {self.block_dir}")

            self.block_filepaths = []
            self.points_per_block = []
            self.raw_points_per_block = []
            self.total_num_valid_points = 0
            self.total_num_raw_points = 0
            all_raw_labels_list = [] # For semantic weights

            print(f"Scanning {len(all_potential_paths)} potential blocks for content and validity...")
            start_scan_time = time.time()
            skipped_blocks = 0
            # --- First pass: Validate blocks based on semantic labels and shapes ---
            for block_path in tqdm(all_potential_paths, desc="Scanning Blocks (Pass 1)"):
                valid_block = False; num_valid_points_in_block = 0; num_raw_points_in_block = 0; block_raw_labels = None
                try:
                    with h5py.File(block_path, 'r') as f:
                        if 'data' not in f or 'label' not in f or 'treeID' not in f:
                             skipped_blocks += 1; continue
                        num_raw_points_in_block = f['data'].shape[0]
                        if num_raw_points_in_block == 0:
                             skipped_blocks += 1; continue
                        if not (f['label'].shape[0] == num_raw_points_in_block and f['treeID'].shape[0] == num_raw_points_in_block):
                             print(f"Warning: Mismatched shapes in {os.path.basename(block_path)}. Skipping.")
                             skipped_blocks += 1; continue

                        block_raw_labels = f['label'][:]
                        valid_mask = block_raw_labels != self.unclassified_label_id
                        num_valid_points_in_block = np.sum(valid_mask)
                        if num_valid_points_in_block == 0:
                             skipped_blocks += 1; continue
                        valid_block = True
                except Exception as e:
                    print(f"Error reading/validating block {os.path.basename(block_path)}: {e}. Skipping.")
                    skipped_blocks += 1

                if valid_block:
                    self.block_filepaths.append(block_path)
                    self.points_per_block.append(num_valid_points_in_block)
                    self.raw_points_per_block.append(num_raw_points_in_block)
                    self.total_num_valid_points += num_valid_points_in_block
                    self.total_num_raw_points += num_raw_points_in_block
                    if block_raw_labels is not None:
                         all_raw_labels_list.append(block_raw_labels)

            scan_time = time.time() - start_scan_time
            print(f"Block scan (Pass 1) complete in {scan_time:.2f} seconds.")
            print(f"Skipped {skipped_blocks} invalid/empty/corrupt blocks.")

            if not self.block_filepaths:
                 raise ValueError(f"No valid HDF5 blocks found in {self.block_dir} for split '{split}' after filtering.")

            print(f"Found {len(self.block_filepaths)} valid block files for split '{split}'.")
            print(f"Total raw points across valid blocks: {self.total_num_raw_points}")
            print(f"Total valid points (excluding Class {self.unclassified_label_id}): {self.total_num_valid_points}")

            if self.total_num_valid_points < self.num_point:
                 print(f"Warning: Total valid points ({self.total_num_valid_points}) < num_point ({self.num_point}).")

            # --- Calculate block sampling weights (Unchanged logic) ---
            if self.total_num_valid_points > 0:
                 self.block_weights = np.array(self.points_per_block, dtype=np.float64) / self.total_num_valid_points
            else:
                 print("Warning: Total valid points is zero, using equal block weights.")
                 self.block_weights = np.ones(len(self.block_filepaths), dtype=np.float64) / len(self.block_filepaths)

            # --- Calculate SEMANTIC class weights (Unchanged) ---
            print("\nCalculating Semantic class weights...")
            if all_raw_labels_list:
                 all_raw_labels_flat = np.concatenate(all_raw_labels_list, axis=0)
                 self.class_weights = self.calculate_class_weights(all_raw_labels_flat, self.unclassified_label_id)
            else:
                 print("Warning: No semantic labels collected. Using equal semantic weights.")
                 num_expected_classes = 7
                 self.class_weights = torch.ones(num_expected_classes, dtype=torch.float)

            # --- Calculate NUM_TREES and TREE_ID_WEIGHTS (Added) ---
            # This requires scanning the TreeID data from all valid blocks
            print("\nCalculating TreeID properties (requires scanning TreeIDs)...")
            start_treeid_scan = time.time()
            all_tree_ids_flat = self._collect_all_tree_ids(self.block_filepaths)
            scan_treeid_time = time.time() - start_treeid_scan
            print(f"TreeID scan complete in {scan_treeid_time:.2f} seconds.")

            if all_tree_ids_flat is None or len(all_tree_ids_flat) == 0:
                 print("Warning: No Tree IDs found across valid blocks.")
                 self.num_trees = 1
                 self.tree_id_weights = torch.ones(1, dtype=torch.float)
            else:
                 unique_tree_ids = np.unique(all_tree_ids_flat)
                 valid_tree_ids = unique_tree_ids[unique_tree_ids >= 0]
                 if len(valid_tree_ids) == 0:
                     print("Warning: No valid (>=0) Tree IDs found across blocks.")
                     self.num_trees = 1
                     self.tree_id_weights = torch.ones(1, dtype=torch.float)
                 else:
                     max_tree_id = int(np.max(valid_tree_ids))
                     self.num_trees = max_tree_id + 1
                     print(f"Max valid TreeID found: {max_tree_id}. Setting num_trees = {self.num_trees}")
                     self.tree_id_weights = self.calculate_tree_id_weights(all_tree_ids_flat, self.num_trees, self.ignore_tree_id_for_weighting)


            # --- Define epoch length (Unchanged logic) ---
            if self.split == 'train':
                 self.num_samples_per_epoch = max(1, self.total_num_valid_points // self.num_point)
            else:
                 self.num_samples_per_epoch = max(1, (self.total_num_valid_points // self.num_point) // 4 + 1)
            print(f"\nSetting {self.split} epoch length: {self.num_samples_per_epoch} steps (based on valid points).")

    # <<< ADDED: Helper function to collect all Tree IDs from valid blocks >>>
    def _collect_all_tree_ids(self, block_filepaths):
        """Scans specified HDF5 files and collects all 'treeID' data."""
        all_tree_ids_list = []
        print(f"Scanning {len(block_filepaths)} blocks to collect TreeIDs...")
        for block_path in tqdm(block_filepaths, desc="Scanning TreeIDs (Pass 2)"):
            try:
                with h5py.File(block_path, 'r') as f:
                    if 'treeID' in f:
                        tree_ids = f['treeID'][:]
                        # Optional: filter invalid IDs here if needed, e.g. tree_ids[tree_ids >= 0]
                        all_tree_ids_list.append(tree_ids)
                    else:
                        print(f"Warning: 'treeID' dataset missing in {os.path.basename(block_path)} during TreeID scan.")
            except Exception as e:
                print(f"Error reading TreeIDs from {os.path.basename(block_path)}: {e}")
        if not all_tree_ids_list:
            return None
        return np.concatenate(all_tree_ids_list, axis=0)

    # <<< MODIFIED: Renamed to avoid conflict, logic remains the same >>>
    def calculate_class_weights(self, labels_flat, ignored_label_id):
        # ... (This function remains unchanged, calculates SEMANTIC weights) ...
        if labels_flat is None or len(labels_flat) == 0:
            num_expected_classes = 7
            return torch.ones(num_expected_classes, dtype=torch.float)
        present_labels = np.unique(labels_flat)
        if len(present_labels) == 0:
             num_classes = 7
        else:
             max_label_present = int(np.max(present_labels))
             num_classes = max_label_present + 1
        # print(f"Calculating SEMANTIC weights for {num_classes} classes (max label found: {max_label_present}).") # Reduced verbosity
        label_counts = Counter(labels_flat)
        weights = np.zeros(num_classes, dtype=np.float64)
        total_valid_samples_for_weighting = 0
        for i in range(num_classes):
             if i == ignored_label_id: continue
             total_valid_samples_for_weighting += label_counts.get(i, 0)
        if total_valid_samples_for_weighting == 0:
             return torch.ones(num_classes, dtype=torch.float)
        for i in range(num_classes):
             if i == ignored_label_id:
                 weights[i] = 0.0
                 continue
             count = label_counts.get(i, 0)
             if count > 0:
                  weights[i] = 1.0 / np.log(1.02 + count)
             else:
                  weights[i] = 0.0
        # print(f"Calculated SEMANTIC class weights (Class {ignored_label_id} weight=0):", weights) # Reduced verbosity
        return torch.tensor(weights, dtype=torch.float)


    # <<< ADDED: Function to calculate Tree ID weights >>>
    def calculate_tree_id_weights(self, tree_ids_flat, num_trees, ignored_tree_id):
        """
        Calculates Tree ID weights based on inverse log frequency.
        Args:
            tree_ids_flat (np.ndarray): A flat array of all Tree IDs (can include negatives or ignored).
            num_trees (int): The total number of tree classes (max_id + 1).
            ignored_tree_id (int): The Tree ID to exclude from weight calculation and assign weight 0.
                                   Use -1 if no ID should be ignored this way.
        Returns:
            torch.Tensor: A tensor containing the calculated weights for each Tree ID.
        """
        print(f"Calculating weights for {num_trees} Tree IDs.")
        if tree_ids_flat is None or len(tree_ids_flat) == 0:
            print("Warning: No Tree IDs provided to calculate_tree_id_weights.")
            return torch.ones(num_trees, dtype=torch.float)

        # Filter out potentially invalid negative IDs before counting
        valid_ids_for_counting = tree_ids_flat[tree_ids_flat >= 0]
        if len(valid_ids_for_counting) == 0:
             print("Warning: No valid (>=0) Tree IDs found for weight calculation.")
             return torch.ones(num_trees, dtype=torch.float)

        # Count occurrences of each valid Tree ID
        tree_id_counts = Counter(valid_ids_for_counting)
        weights = np.zeros(num_trees, dtype=np.float64)
        total_valid_samples_for_weighting = 0

        # Calculate sum of samples *excluding* the specifically ignored tree ID
        for tree_id in range(num_trees):
            if tree_id == ignored_tree_id:
                continue
            total_valid_samples_for_weighting += tree_id_counts.get(tree_id, 0)

        if total_valid_samples_for_weighting == 0:
            print(f"Warning: No samples found excluding ignored TreeID {ignored_tree_id}. Returning equal weights.")
            # Still need to set the ignored ID's weight to 0 if specified
            final_weights = torch.ones(num_trees, dtype=torch.float)
            if 0 <= ignored_tree_id < num_trees:
                final_weights[ignored_tree_id] = 0.0
            return final_weights

        # Calculate inverse log frequency weights
        for tree_id in range(num_trees):
            if tree_id == ignored_tree_id:
                weights[tree_id] = 0.0 # Explicitly set weight of ignored TreeID to 0
                continue

            count = tree_id_counts.get(tree_id, 0)
            if count > 0:
                weights[tree_id] = 1.0 / np.log(1.02 + count) # Smoothing factor 1.02
            else:
                weights[tree_id] = 0.0 # Assign 0 weight if TreeID not present

        print(f"Calculated TreeID weights (TreeID {ignored_tree_id} weight=0): First 10 - {weights[:10]}")
        return torch.tensor(weights, dtype=torch.float)


    def __getitem__(self, index):
        # ... (This function remains unchanged, still loads/filters/samples points, sem_labels, inst_labels) ...
        # ... and returns point_set_tensor, semantic_labels_tensor, instance_labels_tensor ...
        try:
            if self.single_mode:
                raw_point_set = self.block_data
                raw_semantic_labels = self.block_labels
                raw_instance_labels = self.block_tree_ids
                current_block_identifier = self.block_filepaths[0]
            else:
                if not self.block_filepaths: raise RuntimeError("Dataset Error: No valid block file paths.")
                chosen_block_idx = np.random.choice(len(self.block_filepaths), p=self.block_weights)
                block_path = self.block_filepaths[chosen_block_idx]
                current_block_identifier = os.path.basename(block_path)

                with h5py.File(block_path, 'r') as f:
                    raw_point_set = f['data'][:]
                    raw_semantic_labels = f['label'][:]
                    raw_instance_labels = f['treeID'][:] # Load instance label

        except Exception as e:
            print(f"ERROR: Failed to load data for index {index} (block: {current_block_identifier}): {e}. Retrying...")
            return self.__getitem__(random.randint(0, len(self) - 1))

        try:
            valid_mask = raw_semantic_labels != self.unclassified_label_id
            point_set_filtered = raw_point_set[valid_mask, :]
            semantic_labels_filtered = raw_semantic_labels[valid_mask]
            instance_labels_filtered = raw_instance_labels[valid_mask] # Filter instance label

            num_valid_points = point_set_filtered.shape[0]
            if num_valid_points == 0:
                print(f"Warning: Block {current_block_identifier} has 0 points after filtering. Retrying getitem...")
                return self.__getitem__(random.randint(0, len(self) - 1))

        except Exception as e:
            print(f"ERROR: Failed during filtering for index {index} (block: {current_block_identifier}): {e}. Retrying...")
            return self.__getitem__(random.randint(0, len(self) - 1))

        try:
            if num_valid_points >= self.num_point:
                sampled_indices = np.random.choice(num_valid_points, self.num_point, replace=False)
            else:
                sampled_indices = np.random.choice(num_valid_points, self.num_point, replace=True)

            point_set_sampled = point_set_filtered[sampled_indices, :]
            semantic_labels_sampled = semantic_labels_filtered[sampled_indices]
            instance_labels_sampled = instance_labels_filtered[sampled_indices] # Sample instance label

        except Exception as e:
             print(f"ERROR: Failed during sampling for index {index} (block: {current_block_identifier}): {e}. Retrying...")
             return self.__getitem__(random.randint(0, len(self) - 1))

        try:
            point_set_processed = pc_normalize(point_set_sampled)
            if self.transform:
                 point_set_processed = self.transform(point_set_processed)

            semantic_labels_final = semantic_labels_sampled
            instance_labels_final = instance_labels_sampled # Final instance label

            point_set_tensor = torch.from_numpy(point_set_processed).float()
            semantic_labels_tensor = torch.from_numpy(semantic_labels_final).long()
            instance_labels_tensor = torch.from_numpy(instance_labels_final).long() # Final instance label tensor

            # Return all three items - unchanged signature
            return point_set_tensor, semantic_labels_tensor, instance_labels_tensor

        except Exception as e:
             print(f"ERROR: Failed during post-processing for index {index}: {e}. Retrying...")
             return self.__getitem__(random.randint(0, len(self) - 1))


    def __len__(self):
        # ... (This function remains unchanged) ...
        return self.num_samples_per_epoch

# --- Example Usage Block (Updated to show new attributes) ---
if __name__ == '__main__':
    BASE_DATA_DIR = "/content/" # Adjust if needed
    NUM_POINT = 1024
    UNCLASSIFIED_LABEL = 0
    IGNORE_TREEID_WEIGHT = 0 # Example: Ignore TreeID 0 for weight calculation

    print(f"--- DataLoader Test Configuration ---")
    print(f"Base Data Dir: {BASE_DATA_DIR}")
    print(f"Points per Sample: {NUM_POINT}")
    print(f"Unclassified Label ID (to filter): {UNCLASSIFIED_LABEL}")
    print(f"TreeID to Ignore for Weights: {IGNORE_TREEID_WEIGHT}")

    # --- Create Dummy Data if Necessary ---
    train_block_dir = os.path.join(BASE_DATA_DIR, "train_blocks")
    os.makedirs(train_block_dir, exist_ok=True)
    dummy_train_file = os.path.join(train_block_dir, "train_block_0_dummy.h5")

    if not glob.glob(os.path.join(train_block_dir, "*.h5")):
        print(f"\nWARNING: No HDF5 files found in {train_block_dir}.")
        print(f"Creating a dummy HDF5 file: {dummy_train_file}")
        # ... (Dummy data creation logic - unchanged, but ensure it creates treeID) ...
        try:
            with h5py.File(dummy_train_file, 'w') as f:
                num_dummy_points = NUM_POINT * 5
                dummy_data = np.random.rand(num_dummy_points, 6).astype(np.float32)
                dummy_labels = np.random.randint(0, 7, size=num_dummy_points, dtype=np.uint8)
                dummy_labels[np.random.choice(num_dummy_points, num_dummy_points // 10, replace=False)] = UNCLASSIFIED_LABEL
                dummy_treeids = np.random.randint(0, 15, size=num_dummy_points, dtype=np.int32) # Random tree IDs 0-14
                # Assign treeID=0 to non-tree classes (approximate) + some actual 0s
                non_tree_mask = (dummy_labels == 0) | (dummy_labels == 1) | (dummy_labels == 2) | (dummy_labels == 3)
                dummy_treeids[non_tree_mask] = 0
                # Ensure some have ID defined by IGNORE_TREEID_WEIGHT
                if IGNORE_TREEID_WEIGHT > 0:
                     dummy_treeids[np.random.choice(num_dummy_points, num_dummy_points // 20, replace=False)] = IGNORE_TREEID_WEIGHT

                f.create_dataset('data', data=dummy_data, compression='gzip')
                f.create_dataset('label', data=dummy_labels, compression='gzip')
                f.create_dataset('treeID', data=dummy_treeids, compression='gzip')
            print("Dummy file created successfully.")
        except Exception as e: print(f"ERROR creating dummy HDF5 file: {e}")

    # --- Test Multi-Block Mode ---
    print("\n--- Testing Multi-Block Mode (Train Split) ---")
    try:
        train_dataset_multi = FORInstanceDataset(
            data_root=BASE_DATA_DIR,
            split='train',
            num_point=NUM_POINT,
            unclassified_label_id=UNCLASSIFIED_LABEL,
            ignore_tree_id_for_weighting=IGNORE_TREEID_WEIGHT # Pass the ignore ID
        )
        print(f"\nDataset length (samples per epoch): {len(train_dataset_multi)}")

        # --- Print calculated attributes ---
        if hasattr(train_dataset_multi, 'class_weights'):
            print(f"  Calculated Semantic Class Weights: {train_dataset_multi.class_weights.numpy()}")
        else: print("  Semantic Class Weights not calculated.")
        if hasattr(train_dataset_multi, 'num_trees'):
            print(f"  Calculated Number of Trees (Classes): {train_dataset_multi.num_trees}")
        else: print("  Number of Trees not calculated.")
        if hasattr(train_dataset_multi, 'tree_id_weights'):
            print(f"  Calculated Tree ID Weights (first 10): {train_dataset_multi.tree_id_weights.numpy()[:10]}")
        else: print("  Tree ID Weights not calculated.")
        # --- End Print Attributes ---

        if len(train_dataset_multi) > 0:
            print("\n  Fetching one sample...")
            start_sample_time = time.time()
            sample_data = train_dataset_multi[0]
            sample_time = time.time() - start_sample_time
            print(f"    Time to fetch one sample: {sample_time:.4f} seconds")

            if sample_data is None: print("    ERROR: __getitem__ returned None!")
            else:
                # --- Unpack 3 items ---
                mb_points, mb_sem_labels, mb_inst_labels = sample_data
                print("    Sample point cloud shape:", mb_points.shape)
                print("    Sample semantic label shape:", mb_sem_labels.shape)
                print("    Sample instance label shape:", mb_inst_labels.shape) # Check instance label

                unique_sem_labels = torch.unique(mb_sem_labels)
                print("    Sample semantic label unique values:", unique_sem_labels)
                if UNCLASSIFIED_LABEL in unique_sem_labels: print(f"    ERROR: Class {UNCLASSIFIED_LABEL} NOT filtered!")
                else: print(f"    SUCCESS: Class {UNCLASSIFIED_LABEL} filtered.")
                print("    Sample instance label unique values:", torch.unique(mb_inst_labels)) # Show instance labels

            # --- Test with DataLoader ---
            # ... (DataLoader test remains the same, ensuring it yields 3 items) ...
            from torch.utils.data import DataLoader
            print("\n  Testing DataLoader (batch_size=4)...")
            train_loader_multi = DataLoader(train_dataset_multi, batch_size=4, shuffle=True, num_workers=0)
            start_batch_time = time.time()
            batch_count = 0; max_batches_to_test = 5
            print(f"    Fetching up to {max_batches_to_test} batches...")
            for i, batch in enumerate(train_loader_multi):
                if batch is None: print(f"    ERROR: DataLoader returned None for batch {i+1}!"); continue
                # --- Unpack 3 items ---
                points_batch, sem_labels_batch, inst_labels_batch = batch
                if i == 0:
                    print(f"    Batch {i+1} points shape:", points_batch.shape)
                    print(f"    Batch {i+1} semantic labels shape:", sem_labels_batch.shape)
                    print(f"    Batch {i+1} instance labels shape:", inst_labels_batch.shape) # Check instance labels
                    unique_batch_labels = torch.unique(sem_labels_batch)
                    print(f"    Batch {i+1} unique semantic labels:", unique_batch_labels)
                    if UNCLASSIFIED_LABEL in unique_batch_labels: print(f"    ERROR: Class {UNCLASSIFIED_LABEL} present!")
                    else: print(f"    SUCCESS: Class {UNCLASSIFIED_LABEL} not present.")
                batch_count += 1
                if batch_count >= max_batches_to_test: break
            batch_time = time.time() - start_batch_time
            print(f"    Time to fetch {batch_count} batch(es): {batch_time:.4f} seconds")

        else: print("\nMulti-block train dataset initialization resulted in 0 length.")

    except FileNotFoundError as e: print(f"\nFILE NOT FOUND ERROR: {e}")
    except Exception as e: print(f"\nUNEXPECTED ERROR testing multi-block train dataset: {e}"); import traceback; traceback.print_exc()