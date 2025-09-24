# --- START OF FILE models/pointnet_offset_predictor.py ---

import torch
import torch.nn as nn
import torch.nn.parallel
import torch.utils.data
import torch.nn.functional as F
# Make sure pointnet_utils is accessible (e.g., in the same directory or added to sys.path)
try:
    from pointnet_utils import PointNetEncoder, feature_transform_reguliarzer
except ImportError:
    print("Error: Cannot import pointnet_utils. Make sure pointnet_utils.py is in the correct path.")
    # As a fallback, define a placeholder if needed for basic script loading,
    # but training will fail if the real util is missing.
    class PointNetEncoder(nn.Module):
        def __init__(self, global_feat=False, feature_transform=False, channel=3):
            super().__init__()
            self.dummy = nn.Parameter(torch.randn(1))
            print("WARNING: Using dummy PointNetEncoder placeholder.")
        def forward(self, x):
             # Return dummy values with expected types/shapes if possible
             print("WARNING: Dummy PointNetEncoder forward called.")
             B, C, N = x.shape
             dummy_feat = torch.randn(B, 1088, N, device=x.device) # Match expected output channel size
             dummy_trans = torch.eye(C, C, device=x.device).repeat(B,1,1) # Dummy transform matrix
             dummy_trans_feat = torch.eye(64, 64, device=x.device).repeat(B,1,1) # Dummy feature transform matrix
             return dummy_feat, dummy_trans, dummy_trans_feat

    def feature_transform_reguliarzer(trans):
        print("WARNING: Using dummy feature_transform_reguliarzer placeholder.")
        return torch.tensor(0.0, device=trans.device)


class get_model(nn.Module):
    def __init__(self, input_channels=6, num_output_channels=3, feature_transform=True):
        """
        PointNet-based model for predicting 3D offsets per point.
        Args:
            input_channels (int): Number of input features per point (e.g., 3 for XYZ, 6 for XYZ+RGB).
            num_output_channels (int): Number of output values per point (should be 3 for dx, dy, dz offsets).
            feature_transform (bool): Whether to use the feature transform in PointNetEncoder.
        """
        super(get_model, self).__init__()
        if num_output_channels != 3:
             print(f"Warning: Initializing offset predictor model with num_output_channels={num_output_channels}. Expected 3 for (dx, dy, dz).")

        self.num_offset_dims = num_output_channels # Should be 3
        self.feature_transform = feature_transform

        # PointNetEncoder extracts per-point features
        # global_feat=False returns per-point features (B, 1088, N)
        self.feat = PointNetEncoder(global_feat=False, feature_transform=self.feature_transform, channel=input_channels)

        # MLPs (implemented as 1x1 convs) on per-point features
        self.conv1 = torch.nn.Conv1d(1088, 512, 1)
        self.conv2 = torch.nn.Conv1d(512, 256, 1)
        self.conv3 = torch.nn.Conv1d(256, 128, 1)
        # Final layer maps features to the desired number of offset dimensions (3)
        self.conv4_offset = torch.nn.Conv1d(128, self.num_offset_dims, 1) # MODIFIED: Output size is 3

        # Batch Norm layers
        self.bn1 = nn.BatchNorm1d(512)
        self.bn2 = nn.BatchNorm1d(256)
        self.bn3 = nn.BatchNorm1d(128)

    def forward(self, x):
        """
        Forward pass.
        Args:
            x (torch.Tensor): Input point cloud data, shape (batchsize, input_channels, n_points)
        Returns:
            offset_pred (torch.Tensor): Predicted offsets, shape (batchsize, n_points, 3)
            trans_feat (torch.Tensor or None): Feature transform matrix for regularization loss.
                                                Shape (batchsize, 64, 64) if feature_transform=True, else None.
        """
        batchsize = x.size()[0]
        n_pts = x.size()[2]

        # x_feat shape: (batchsize, 1088, n_points)
        # trans: Input transform matrix (batchsize, input_channels, input_channels) - not used directly here
        # trans_feat: Feature transform matrix (batchsize, 64, 64) - used for regularization loss
        x_feat, trans, trans_feat = self.feat(x)

        # Apply MLPs with BatchNorm and ReLU
        x_proc = F.relu(self.bn1(self.conv1(x_feat)))
        x_proc = F.relu(self.bn2(self.conv2(x_proc)))
        x_proc = F.relu(self.bn3(self.conv3(x_proc)))

        # Final layer to predict offsets
        # Output shape: (batchsize, num_offset_dims, n_points)
        offset_pred_transposed = self.conv4_offset(x_proc)

        # Transpose to get (batchsize, n_points, num_offset_dims) which is standard for point-wise predictions
        offset_pred = offset_pred_transposed.transpose(2, 1).contiguous()

        # --- REMOVED LogSoftmax ---
        # NO activation function here for regression output

        return offset_pred, trans_feat


class get_loss(torch.nn.Module):
    def __init__(self, mat_diff_loss_scale=0.001, loss_type='SmoothL1Loss'):
        """
        Loss function for offset prediction. Combines a regression loss
        with the feature transform regularization loss.
        Args:
            mat_diff_loss_scale (float): Weighting factor for the feature transform regularization loss.
            loss_type (str): Type of regression loss to use ('SmoothL1Loss', 'L1Loss', 'MSELoss').
        """
        super(get_loss, self).__init__()
        self.mat_diff_loss_scale = mat_diff_loss_scale
        self.loss_type = loss_type

        # Instantiate the chosen regression loss
        if loss_type == 'SmoothL1Loss':
            self.regression_loss_fn = nn.SmoothL1Loss(reduction='mean')
            # print("Using SmoothL1Loss for offsets.")
        elif loss_type == 'L1Loss':
            self.regression_loss_fn = nn.L1Loss(reduction='mean')
            # print("Using L1Loss for offsets.")
        elif loss_type == 'MSELoss':
            self.regression_loss_fn = nn.MSELoss(reduction='mean')
            # print("Using MSELoss for offsets.")
        else:
            raise ValueError(f"Unsupported loss_type: {loss_type}. Choose from 'SmoothL1Loss', 'L1Loss', 'MSELoss'.")

    def forward(self, pred_offsets, target_offsets, trans_feat):
        """
        Calculate the total loss.
        Args:
            pred_offsets (torch.Tensor): Predicted offsets (Num_foreground_points, 3).
                                        Assumes input is already filtered for foreground points.
            target_offsets (torch.Tensor): Ground truth offsets (Num_foreground_points, 3).
                                         Assumes input is already filtered for foreground points.
            trans_feat (torch.Tensor or None): Feature transform matrix (Batchsize, 64, 64)
                                                passed through from the model's forward pass.
        Returns:
            total_loss (torch.Tensor): The computed total loss (scalar).
            regression_loss (torch.Tensor): The regression loss component (scalar).
            reg_loss (torch.Tensor): The regularization loss component (scalar).
        """
        # --- Regression Loss ---
        # Calculate loss between predicted and target offsets
        # Assumes pred_offsets and target_offsets are already masked for foreground points
        # and flattened or appropriately shaped for the loss function.
        # Example: if inputs are (M, 3) where M is num foreground points across batch.
        regression_loss = self.regression_loss_fn(pred_offsets, target_offsets)

        # --- Regularization Loss ---
        if trans_feat is not None and self.mat_diff_loss_scale > 0:
            # Calculate the feature transform regularization loss
            # Ensure trans_feat is passed correctly if feature_transform=True
            reg_loss = feature_transform_reguliarzer(trans_feat) * self.mat_diff_loss_scale
        else:
            # Set regularization loss to zero if no transform or scale is zero
            reg_loss = torch.tensor(0.0, device=pred_offsets.device)


        # --- Total Loss ---
        total_loss = regression_loss + reg_loss

        return total_loss, regression_loss, reg_loss # Return components for logging


# --- Example Usage / Sanity Check ---
if __name__ == '__main__':
    print("--- Testing PointNet Offset Predictor ---")

    # Parameters
    batch_size = 4
    num_points = 1024
    input_features = 6 # Example: XYZ + RGB

    # --- Model Test ---
    print("Initializing model...")
    # Use feature_transform=True to test regularization loss path
    model = get_model(input_channels=input_features, num_output_channels=3, feature_transform=True)
    print(model)

    print("\nCreating dummy input...")
    # Input shape: (B, C, N)
    dummy_input = torch.rand(batch_size, input_features, num_points)

    print("Running forward pass...")
    # Output: predicted offsets (B, N, 3), feature transform matrix (B, 64, 64)
    pred_offsets, trans_feat = model(dummy_input)

    print("Output shapes:")
    print(f"  Predicted Offsets: {pred_offsets.shape}") # Expected: (B, N, 3)
    assert pred_offsets.shape == (batch_size, num_points, 3)
    if trans_feat is not None:
        print(f"  Feature Transform: {trans_feat.shape}") # Expected: (B, 64, 64)
        assert trans_feat.shape == (batch_size, 64, 64)
    else:
         print(f"  Feature Transform: None (as expected if feature_transform=False)")


    # --- Loss Test ---
    print("\nInitializing loss function (SmoothL1Loss)...")
    loss_fn = get_loss(mat_diff_loss_scale=0.001, loss_type='SmoothL1Loss')

    print("Creating dummy targets...")
    # Simulate masked foreground points and targets
    num_foreground_points = batch_size * num_points // 2 # Example: half are foreground
    dummy_pred_flat = torch.rand(num_foreground_points, 3)
    dummy_target_flat = torch.rand(num_foreground_points, 3)
    # Use the trans_feat from the model forward pass if available
    dummy_trans_feat_for_loss = trans_feat

    print("Calculating loss...")
    total_loss, regr_loss, reg_loss = loss_fn(dummy_pred_flat, dummy_target_flat, dummy_trans_feat_for_loss)

    print(f"Calculated Losses:")
    print(f"  Total Loss:       {total_loss.item():.6f}")
    print(f"  Regression Loss:  {regr_loss.item():.6f}")
    print(f"  Regularization Loss: {reg_loss.item():.6f}")
    assert torch.is_tensor(total_loss) and total_loss.ndim == 0

    print("\n--- Test Complete ---")


# --- END OF FILE models/pointnet_offset_predictor.py ---