import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Box, Button, Typography, Paper, Alert, CircularProgress, useTheme, FormControlLabel, Checkbox, FormControl, InputLabel, Select, MenuItem, IconButton, Slider, Dialog, DialogTitle, DialogContent, DialogActions, TextField, Menu, ListItemIcon, ListItemText, Divider} from '@mui/material';
import { tokens } from '../../theme';
import { Map, Close, Gesture, HistoryEdu, DeleteSweep, Edit, Save, Delete, Merge } from '@mui/icons-material';
import { useSearchParams } from 'react-router-dom';
import axios from 'axios';
import * as THREE from 'three';
import { createLassoHelper } from './LassoHelper';
import { createSceneManager } from './scene_manager';
import { createBoundingBox, updateBoundingBoxVisibility, disposeBoundingBox } from './pointcloud_boundingbox';
import { createStyles, getResponsiveMarginLeft } from './pointcloud_viewer.styles';
import { createInitialClassifications, toggleClassification } from './classificationUtils';
import { createInitialTreeIDs, toggleTreeID, generateTreeIDColor } from './treeIDUtils';
import { parseLASFile } from './lasParser';
import {
  createPointCloudGeometry,
  createPointCloudMaterial,
  filterPointCloudByClassifications,
  filterPointCloudByTreeIDs,
  updatePointCloudGeometry,
  filterPointCloudByLasso
} from './pointCloudManager';
import MiniMap from './MiniMap';

// Import utility functions
import {
  handlePartClick,
  handleTogglePartVisibility,
  combineVisibleParts,
  createRemainingGeometry,
  deletePart,
  mergeParts,
  handlePartMultiSelect
} from './utils/partUtils';

import {
  handleAnnotationTypeChange,
  handleAnnotationValueSelect,
  annotateAllVisiblePoints,
  handleAnnotationDialogClose
} from './utils/annotationUtils';

const PointCloudViewer = ({ isCollapsed }) => {
  const theme = useTheme();
  const colors = tokens(theme.palette.mode);
  const styles = createStyles(theme, colors);
  const canvasRef = useRef(null);
  const sceneManagerRef = useRef(null);
  const [searchParams] = useSearchParams();

  // --- CORRECTED AND COMPLETE STATE ---
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [pointCloud, setPointCloud] = useState(null);
  const [originalGeometry, setOriginalGeometry] = useState(null);
  const [fileInfo, setFileInfo] = useState(null);
  const [classifications, setClassifications] = useState(createInitialClassifications());
  const [treeIDs, setTreeIDs] = useState({});
  const [treeIDData, setTreeIDData] = useState([]);
  const [filterMode, setFilterMode] = useState('classification');
  const [showBoundingBox, setShowBoundingBox] = useState(true);
  const [boundingBox, setBoundingBox] = useState(null);
  const [fileId, setFileId] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const minDistanceRef = useRef(1);
  const maxDistanceRef = useRef(1000);

  // --- State for Point Cloud Parts ---
  const [activeTool, setActiveTool] = useState(null);
  const lassoHelperRef = useRef(null);
  const [isProcessingLasso, setIsProcessingLasso] = useState(false);
  const [parts, setParts] = useState([]);
  const [activePartId, setActivePartId] = useState(null);
  const [pointSize, setPointSize] = useState(5.0); // State for the slider value
  const [pointDensity, setPointDensity] = useState(1.0); // 0..1 density control
  
  // --- Multi-selection and Context Menu State ---
  const [selectedParts, setSelectedParts] = useState([]);
  const [contextMenu, setContextMenu] = useState(null);
  
  // --- Annotation State ---
  const [selectedAnnotationType, setSelectedAnnotationType] = useState('classification');
  const [selectedAnnotationValue, setSelectedAnnotationValue] = useState(null);
  const [isAnnotating, setIsAnnotating] = useState(false);
  const [annotationDialogOpen, setAnnotationDialogOpen] = useState(false);
  
  // --- Rename State ---
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renamePartId, setRenamePartId] = useState(null);
  const [newPartName, setNewPartName] = useState('');
  
  // --- Save Dialog State ---
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [savePartId, setSavePartId] = useState(null);
  const [saveFileName, setSaveFileName] = useState('');

  // This effect updates the shader when the slider value changes
  useEffect(() => {
    if (pointCloud && pointCloud.material) {
      pointCloud.material.uniforms.u_pointSize.value = pointSize;
    }
  }, [pointSize, pointCloud]);

  // Update density uniform when changed
  useEffect(() => {
    if (pointCloud && pointCloud.material && pointCloud.material.uniforms.u_density) {
      pointCloud.material.uniforms.u_density.value = pointDensity;
    }
  }, [pointDensity, pointCloud]);

  // --- MiniMap State ---
  const [showMiniMap, setShowMiniMap] = useState(false);
  const [miniMapFiles, setMiniMapFiles] = useState([]);
  const [isLoadingMiniMapFiles, setIsLoadingMiniMapFiles] = useState(false);
  const [errorMiniMapFiles, setErrorMiniMapFiles] = useState(null);
  const viewerWrapperRef = useRef(null);
  const [miniMapContainerStyle, setMiniMapContainerStyle] = useState(() => ({
    position: 'absolute',
    visibility: 'hidden',
    width: { xs: '260px', sm: '300px' },
    height: { xs: '200px', sm: '250px' },
    backgroundColor: `rgba(${theme.palette.mode === 'dark' ? '30,30,30' : '245,245,245'}, 0.9)`,
    border: `1px solid ${colors.grey[700]}`,
    borderRadius: '8px',
    zIndex: 1001,
    boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
    overflow: 'hidden',
  }));

  // Constants for positioning logic
  const MINIMAP_ESTIMATED_WIDTH_SM = 300;
  const MINIMAP_ESTIMATED_WIDTH_XS = 260;
  const MINIMAP_ESTIMATED_HEIGHT_SM = 250;
  const MINIMAP_ESTIMATED_HEIGHT_XS = 200;
  const BUTTON_FIXED_SIZE = 40;
  const MINIMAP_BUTTON_GAP = 10;

  const handleToolSelect = (toolName) => {
    setActiveTool(prev => (prev === toolName ? null : toolName));
  };

  // Create function instances with state setters
  const handlePartClickInstance = handlePartClick(setActivePartId, activePartId);
  const handleTogglePartVisibilityInstance = handleTogglePartVisibility(setParts);
  const combineVisiblePartsInstance = () => combineVisibleParts(parts, originalGeometry);
  const deletePartInstance = deletePart(setParts, setActivePartId);
  const mergePartsInstance = mergeParts(setParts, setSelectedParts);
  const handlePartMultiSelectInstance = handlePartMultiSelect(setSelectedParts, selectedParts);

  // Context menu handlers
  const handleContextMenu = (event, partId) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({
      mouseX: event.clientX + 2,
      mouseY: event.clientY - 6,
      partId: partId
    });
  };

  const handleCloseContextMenu = () => {
    setContextMenu(null);
  };

  const handleDeletePart = (partId) => {
    deletePartInstance(partId);
    setSelectedParts(prev => prev.filter(id => id !== partId));
    handleCloseContextMenu();
  };

  const handleDeleteSelectedParts = () => {
    selectedParts.forEach(partId => {
      deletePartInstance(partId);
    });
    setSelectedParts([]);
    handleCloseContextMenu();
  };

  const handleMergeSelectedParts = () => {
    if (selectedParts.length >= 2) {
      mergePartsInstance(selectedParts);
      setSelectedParts([]);
    }
    handleCloseContextMenu();
  };

  const handleRenamePart = (partId) => {
    const part = parts.find(p => p.id === partId);
    if (part) {
      setRenamePartId(partId);
      setNewPartName(part.name);
      setRenameDialogOpen(true);
    }
    handleCloseContextMenu();
  };

  const handleRenameConfirm = () => {
    if (renamePartId && newPartName.trim()) {
      setParts(prev => prev.map(part => 
        part.id === renamePartId 
          ? { ...part, name: newPartName.trim() }
          : part
      ));
    }
    setRenameDialogOpen(false);
    setRenamePartId(null);
    setNewPartName('');
  };

  const handleRenameCancel = () => {
    setRenameDialogOpen(false);
    setRenamePartId(null);
    setNewPartName('');
  };

  const handleSavePart = (partId) => {
    const part = parts.find(p => p.id === partId);
    if (!part || !part.geometry) return;
    
    // Set up the save dialog with default filename (without .las extension)
    const defaultFileName = part.name.replace(/[^a-zA-Z0-9]/g, '_');
    setSavePartId(partId);
    setSaveFileName(defaultFileName);
    setSaveDialogOpen(true);
    handleCloseContextMenu();
  };

  const handleSaveConfirm = async () => {
    if (!savePartId || !saveFileName.trim()) return;
    
    const part = parts.find(p => p.id === savePartId);
    if (!part || !part.geometry) return;

    try {
      setIsLoading(true);
      
      // Convert geometry to LAS format
      const lasData = await convertGeometryToLAS(part.geometry, part.name, part.type, part.id);
      
      // Create FormData for file upload
      const formData = new FormData();
      const fileName = `${saveFileName.trim()}.las`;
      const blob = new Blob([lasData], { type: 'application/octet-stream' });
      formData.append('file', blob, fileName);
      formData.append('skipSegmentation', 'true'); // Skip segmentation for saved parts
      
      // Set plot/division/project information to match the current file
      if (fileInfo) {
        if (fileInfo.plot_name) {
          formData.append('plot_name', fileInfo.plot_name);
        }
        if (fileInfo.project_id) {
          formData.append('project_id', fileInfo.project_id);
        }
      }
      
      // Upload to backend
      const token = localStorage.getItem('authToken');
      if (!token) {
        setError('Authentication required');
        return;
      }
      
      const response = await axios.post('/api/files/upload', formData, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'multipart/form-data'
        }
      });
      
      if (response.status === 200 || response.status === 201) {
        // Success - show success message
        setError(null);
        console.log('Part saved successfully:', response.data);
        
        // Close the save dialog
        setSaveDialogOpen(false);
        setSavePartId(null);
        setSaveFileName('');
      } else {
        throw new Error(`Upload failed with status: ${response.status}`);
      }
      
    } catch (error) {
      console.error('Error saving part:', error);
      setError(`Failed to save part: ${error.response?.data?.message || error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveCancel = () => {
    setSaveDialogOpen(false);
    setSavePartId(null);
    setSaveFileName('');
  };

  // Convert Three.js geometry to PLY format (more reliable)
  const convertGeometryToPLY = async (geometry, partName) => {
    const positions = geometry.attributes.position.array;
    const colors = geometry.attributes.color.array;
    
    const pointCount = positions.length / 3;
    
    let plyContent = `ply
format ascii 1.0
comment Generated by Point Cloud Viewer
element vertex ${pointCount}
property float x
property float y
property float z
property uchar red
property uchar green
property uchar blue
end_header
`;
    
    for (let i = 0; i < pointCount; i++) {
      const posIndex = i * 3;
      const x = positions[posIndex];
      const y = positions[posIndex + 1];
      const z = positions[posIndex + 2];
      
      const r = Math.round(colors[posIndex] * 255);
      const g = Math.round(colors[posIndex + 1] * 255);
      const b = Math.round(colors[posIndex + 2] * 255);
      
      plyContent += `${x.toFixed(6)} ${y.toFixed(6)} ${z.toFixed(6)} ${r} ${g} ${b}\n`;
    }
    
    return plyContent;
  };

  // Convert Three.js geometry to LAS format - Minimal working version
  const convertGeometryToLAS = async (geometry, partName, partType = null, partId = null) => {
    const positions = geometry.attributes.position.array;
    const colors = geometry.attributes.color.array;
    
    const pointCount = positions.length / 3;
    
    // Calculate bounds
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;
    
    for (let i = 0; i < positions.length; i += 3) {
      minX = Math.min(minX, positions[i]);
      maxX = Math.max(maxX, positions[i]);
      minY = Math.min(minY, positions[i + 1]);
      maxY = Math.max(maxY, positions[i + 1]);
      minZ = Math.min(minZ, positions[i + 2]);
      maxZ = Math.max(maxZ, positions[i + 2]);
    }
    
    // Use fixed scale factors for simplicity
    const scaleX = 0.01;
    const scaleY = 0.01;
    const scaleZ = 0.01;
    const offsetX = minX;
    const offsetY = minY;
    const offsetZ = minZ;
    
    // Create LAS header (375 bytes for LAS 1.3)
    const header = new ArrayBuffer(375);
    const headerView = new DataView(header);
    
    // Initialize header with zeros
    for (let i = 0; i < 375; i++) {
      headerView.setUint8(i, 0);
    }
    
    // LAS File Signature
    headerView.setUint8(0, 0x4C); // 'L'
    headerView.setUint8(1, 0x41); // 'A'
    headerView.setUint8(2, 0x53); // 'S'
    headerView.setUint8(3, 0x46); // 'F'
    
    // Version Major.Minor - Use 1.3 to match original format
    headerView.setUint8(24, 1);
    headerView.setUint8(25, 3);
    
    // Header Size
    headerView.setUint16(94, 375, true);
    
    // Check if treeID exists
    const hasTreeID = geometry.attributes.treeID !== undefined;
    
    // Enable extra bytes for treeID
    const useExtraBytes = hasTreeID;
    
    // Offset to point data (375 + VLR size)
    const vlrSize = useExtraBytes ? 192 : 0; // Extra bytes VLR is 192 bytes for one extra byte
    headerView.setUint32(96, 375 + vlrSize, true);
    
    // Point Data Format ID - Use format 3 to match original (supports RGB and extra bytes)
    const pointFormat = 3; // Format 3 supports RGB
    headerView.setUint8(104, pointFormat);
    
    // Point Data Record Length (38 bytes for format 3 with one extra byte)
    const pointDataRecordLength = useExtraBytes ? 38 : 34; // Format 3 base (34) + extra bytes (4 for one int32)
    headerView.setUint16(105, pointDataRecordLength, true);
    
    // Number of point records
    headerView.setUint32(107, pointCount, true);
    
    // Number of variable length records (1 for extra bytes description if hasTreeID)
    headerView.setUint16(100, useExtraBytes ? 1 : 0, true);
    
    // Number of points by return (5 values) - Set proper return distribution
    headerView.setUint32(111, pointCount, true); // Return 1 (all points are first returns)
    headerView.setUint32(115, 0, true); // Return 2
    headerView.setUint32(119, 0, true); // Return 3
    headerView.setUint32(123, 0, true); // Return 4
    headerView.setUint32(127, 0, true); // Return 5
    
    // X scale factor
    headerView.setFloat64(131, scaleX, true);
    
    // Y scale factor
    headerView.setFloat64(139, scaleY, true);
    
    // Z scale factor
    headerView.setFloat64(147, scaleZ, true);
    
    // X offset
    headerView.setFloat64(155, offsetX, true);
    
    // Y offset
    headerView.setFloat64(163, offsetY, true);
    
    // Z offset
    headerView.setFloat64(171, offsetZ, true);
    
    // Max X
    headerView.setFloat64(179, maxX, true);
    
    // Min X
    headerView.setFloat64(187, minX, true);
    
    // Max Y
    headerView.setFloat64(195, maxY, true);
    
    // Min Y
    headerView.setFloat64(203, minY, true);
    
    // Max Z
    headerView.setFloat64(211, maxZ, true);
    
    // Min Z
    headerView.setFloat64(219, minZ, true);
    
    // Create VLR for extra bytes description (if needed)
    let vlrData = null;
    if (useExtraBytes) {
      // Create VLR for one extra byte (treeID only)
      vlrData = new ArrayBuffer(192); // 192 bytes for one extra byte description
      const vlrView = new DataView(vlrData);
      
      // Initialize with zeros
      for (let i = 0; i < 192; i++) {
        vlrView.setUint8(i, 0);
      }
      
      // VLR Header (54 bytes)
      vlrView.setUint16(0, 0, true); // Reserved
      
      // User ID (16 bytes) - 'LASF_Spec'
      const userId = 'LASF_Spec';
      for (let i = 0; i < userId.length; i++) {
        vlrView.setUint8(2 + i, userId.charCodeAt(i));
      }
      
      vlrView.setUint16(18, 4, true); // Record ID
      vlrView.setUint16(20, 138, true); // Length after header (192 - 54 = 138)
      
      // Description (32 bytes) - already zeroed
      
      // Extra Bytes Description (192 bytes for one extra byte)
      // Note: Each extra byte description is 192 bytes, starting immediately after VLR header
      
      // Extra byte: treeID (192 bytes starting at offset 54)
      let offset = 54;
      
      // Reserved (2 bytes)
      vlrView.setUint16(offset, 0, true);
      offset += 2;
      
      // Data type (1 byte) - 6 = int32 (signed 32-bit integer)
      vlrView.setUint8(offset, 6);
      offset += 1;
      
      // Options (1 byte)
      vlrView.setUint8(offset, 0);
      offset += 1;
      
      // Name (32 bytes)
      const name1 = 'treeID';
      for (let i = 0; i < name1.length; i++) {
        vlrView.setUint8(offset + i, name1.charCodeAt(i));
      }
      offset += 32;
      
      // Unused (32 bytes) - already zeroed
      offset += 32;
      
      // No data (3 double values, 24 bytes) - already zeroed
      offset += 24;
      
      // Min (8 bytes double) - already zeroed
      offset += 8;
      
      // Max (8 bytes double) - already zeroed
      offset += 8;
      
      // Scale (8 bytes double)
      vlrView.setFloat64(offset, 1.0, true);
      offset += 8;
      
      // Offset (8 bytes double)
      vlrView.setFloat64(offset, 0.0, true);
      offset += 8;
      
      // Description (32 bytes) - already zeroed
      offset += 32;
    }
    
    // Create point data (dynamic size based on format and extra bytes)
    const pointDataSize = pointDataRecordLength;
    const pointData = new ArrayBuffer(pointCount * pointDataSize);
    const pointDataView = new DataView(pointData);
    
    // Get treeID data from geometry attributes
    let treeIDAttribute = null;
    if (geometry.attributes.treeID) {
      treeIDAttribute = geometry.attributes.treeID.array;
    } else {
    }
    
    
    for (let i = 0; i < pointCount; i++) {
      const offset = i * pointDataSize;
      const posIndex = i * 3;
      
      // Convert coordinates to integers (scaled)
      const x = Math.round((positions[posIndex] - offsetX) / scaleX);
      const y = Math.round((positions[posIndex + 1] - offsetY) / scaleY);
      const z = Math.round((positions[posIndex + 2] - offsetZ) / scaleZ);
      
      // Write coordinates
      pointDataView.setInt32(offset, x, true);
      pointDataView.setInt32(offset + 4, y, true);
      pointDataView.setInt32(offset + 8, z, true);
      
      // Intensity (default to 100)
      pointDataView.setUint16(offset + 12, 100, true);
      
      // Return number and number of returns packed into one byte at offset 14
      const returnByte = (1 & 0x07) | ((1 & 0x07) << 3); // Return number | Number of returns
      pointDataView.setUint8(offset + 14, returnByte);
      
      // Classification (convert color back to classification)
      // Use original classification colors if available, otherwise use display colors
      const originalClassification = geometry.attributes.originalClassification?.array;
      let r, g, b;
      if (originalClassification) {
        r = originalClassification[posIndex];
        g = originalClassification[posIndex + 1];
        b = originalClassification[posIndex + 2];
      } else {
        r = colors[posIndex];
        g = colors[posIndex + 1];
        b = colors[posIndex + 2];
      }
      
      let classification = 0; // Default to unclassified
      
      // Simple color to classification mapping
      if (Math.abs(r - 0.75) < 0.01 && Math.abs(g - 0.75) < 0.01 && Math.abs(b - 0.75) < 0.01) classification = 0; // Unclassified
      else if (Math.abs(r - 0.6) < 0.01 && Math.abs(g - 0.8) < 0.01 && Math.abs(b - 0.2) < 0.01) classification = 1; // Low-vegetation
      else if (Math.abs(r - 0.545) < 0.01 && Math.abs(g - 0.271) < 0.01 && Math.abs(b - 0.075) < 0.01) classification = 2; // Terrain
      else if (Math.abs(r - 1.0) < 0.01 && Math.abs(g - 0.0) < 0.01 && Math.abs(b - 1.0) < 0.01) classification = 3; // Out-points
      else if (Math.abs(r - 0.627) < 0.01 && Math.abs(g - 0.322) < 0.01 && Math.abs(b - 0.176) < 0.01) classification = 4; // Stem
      else if (Math.abs(r - 0.133) < 0.01 && Math.abs(g - 0.545) < 0.01 && Math.abs(b - 0.133) < 0.01) classification = 5; // Live branches
      else if (Math.abs(r - 0.36) < 0.01 && Math.abs(g - 0.25) < 0.01 && Math.abs(b - 0.2) < 0.01) classification = 6; // Woody branches
      
      // Classification at offset 15
      pointDataView.setUint8(offset + 15, classification);
       
       // Additional fields for LAS format 3
       if (pointFormat === 3) {
         try {
           // Scan angle rank (default to 0) at offset 16
           pointDataView.setInt8(offset + 16, 0);
           
           // User data (default to 0) at offset 17
           pointDataView.setUint8(offset + 17, 0);
           
           // Point source ID (default to 0) at offset 18-19
           pointDataView.setUint16(offset + 18, 0, true);
           
           // GPS time (default to 0) at offset 20-27
           pointDataView.setFloat64(offset + 20, 0, true);
           
           // RGB colors (format 3 includes RGB) at offset 28-33
           const red = Math.round(r * 65535); // Convert 0-1 to 0-65535
           const green = Math.round(g * 65535);
           const blue = Math.round(b * 65535);
           pointDataView.setUint16(offset + 28, red, true);
           pointDataView.setUint16(offset + 30, green, true);
           pointDataView.setUint16(offset + 32, blue, true);
           
           // Store treeID in extra bytes as Int32 (starting at offset 34)
           if (useExtraBytes && hasTreeID && treeIDAttribute) {
             const treeIDValue = treeIDAttribute[i] || 0;
             // Convert to int32 format
             const int32Value = Math.round(treeIDValue);
             // Clamp to int32 range
             const clampedValue = Math.max(-2147483648, Math.min(2147483647, int32Value));
             pointDataView.setInt32(offset + 34, clampedValue, true);
           }
         } catch (error) {
           console.error(`LAS Conversion Error at point ${i}:`, {
             error: error.message,
             offset,
             pointDataSize,
             pointDataRecordLength,
             pointFormat,
             bufferLength: pointData.byteLength
           });
           throw error;
         }
       }
    }
    
    // Combine header, VLR (if exists), and point data
    const totalSize = header.byteLength + (vlrData ? vlrData.byteLength : 0) + pointData.byteLength;
    const lasFile = new Uint8Array(totalSize);
    let offset = 0;
    
    lasFile.set(new Uint8Array(header), offset);
    offset += header.byteLength;
    
    if (vlrData) {
      lasFile.set(new Uint8Array(vlrData), offset);
      offset += vlrData.byteLength;
    }
    
    lasFile.set(new Uint8Array(pointData), offset);
    
    return lasFile;
  };

  
  const updatePointCloudColors = () => {
    // Don't update if we have parts - let the parts visibility effect handle it
    if (!pointCloud || !originalGeometry || parts.length > 0) return;
    
    // The rest of the function stays the same
    if (filterMode === 'classification') {
      const filteredGeometry = filterPointCloudByClassifications(originalGeometry, classifications);
      updatePointCloudGeometry(pointCloud, filteredGeometry);
    } else if (filterMode === 'treeID' && treeIDData) {
      const filteredGeometry = filterPointCloudByTreeIDs(originalGeometry, treeIDData, treeIDs);
      updatePointCloudGeometry(pointCloud, filteredGeometry);
    }
  };



  // Helper function to apply filter mode colors to combined geometry
  const applyFilterModeColorsToGeometry = (geometry) => {
    if (!geometry || !geometry.attributes.position) return geometry;
    
    const positions = geometry.attributes.position.array;
    const pointCount = positions.length / 3;
    
    // Get treeID data from geometry
    const treeIDAttribute = geometry.attributes.treeID;
    const originalClassificationAttribute = geometry.attributes.originalClassification;
    const classificationColorAttribute = geometry.attributes.classificationColor;
    
    // Create new color arrays
    const newColors = [];
    const newCustomColors = [];
    
    // If we have parts, the geometry already has the correct colors from the parts
    // We should preserve those colors, not recalculate based on visibility state
    if (parts.length > 0 && geometry.attributes.color && geometry.attributes.color.array.length > 0) {
      // Use existing colors from parts (they already have the correct colors)
      const existingColors = geometry.attributes.color.array;
      const existingCustomColors = geometry.attributes.customColor?.array || existingColors;
      for (let i = 0; i < existingColors.length; i++) {
        newColors.push(existingColors[i]);
      }
      for (let i = 0; i < existingCustomColors.length; i++) {
        newCustomColors.push(existingCustomColors[i]);
      }
    } else if (filterMode === 'treeID' && treeIDAttribute) {
      // Apply treeID colors using existing treeIDs state (to maintain consistent colors)
      const treeIDArray = treeIDAttribute.array;
      
      for (let i = 0; i < pointCount; i++) {
        const treeIDValue = treeIDArray[i] || 0;
        const treeIDKey = String(treeIDValue);
        let treeInfo = treeIDs[treeIDKey];
        
        // If treeID not found in state, generate color using the treeID value directly
        if (!treeInfo) {
          // Generate color for this treeID value (consistent based on treeID value)
          const color = generateTreeIDColor(treeIDValue);
          treeInfo = {
            id: treeIDValue,
            visible: true,
            color: color
          };
        }
        
        // When parts exist, all treeIDs in the geometry are already visible (filtered by parts)
        // So we don't need to check visibility here - just use the color
        if (treeInfo && treeInfo.color) {
          newColors.push(treeInfo.color[0], treeInfo.color[1], treeInfo.color[2]);
          newCustomColors.push(treeInfo.color[0], treeInfo.color[1], treeInfo.color[2]);
        } else {
          // Fallback color (gray for missing treeIDs)
          newColors.push(0.5, 0.5, 0.5);
          newCustomColors.push(0.5, 0.5, 0.5);
        }
      }
    } else if (filterMode === 'classification') {
      // Apply classification colors - use originalClassification first, then classificationColor
      let classificationArray = null;
      if (originalClassificationAttribute) {
        classificationArray = originalClassificationAttribute.array;
      } else if (classificationColorAttribute) {
        classificationArray = classificationColorAttribute.array;
      }
      
      if (classificationArray) {
        for (let i = 0; i < classificationArray.length; i += 3) {
          const r = classificationArray[i];
          const g = classificationArray[i + 1];
          const b = classificationArray[i + 2];
          newColors.push(r, g, b);
          newCustomColors.push(r, g, b);
        }
      } else {
        // Fallback to existing colors if no classification data
        const existingColors = geometry.attributes.color?.array || [];
        for (let i = 0; i < existingColors.length; i++) {
          newColors.push(existingColors[i]);
        }
        for (let i = 0; i < existingColors.length; i++) {
          newCustomColors.push(existingColors[i]);
        }
      }
    } else {
      // Use existing colors if no filter mode data available
      const existingColors = geometry.attributes.color?.array || [];
      const existingCustomColors = geometry.attributes.customColor?.array || [];
      for (let i = 0; i < existingColors.length; i++) {
        newColors.push(existingColors[i]);
      }
      for (let i = 0; i < existingCustomColors.length; i++) {
        newCustomColors.push(existingCustomColors[i]);
      }
    }
    
    // Update geometry colors
    if (newColors.length > 0) {
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(newColors, 3));
      geometry.attributes.color.needsUpdate = true;
    }
    if (newCustomColors.length > 0) {
      geometry.setAttribute('customColor', new THREE.Float32BufferAttribute(newCustomColors, 3));
      geometry.attributes.customColor.needsUpdate = true;
    }
    
    return geometry;
  };

  // --- ADD THIS NEW EFFECT ---  // Visually updates the point cloud based on visibility
  useEffect(() => {
   if (!pointCloud || !originalGeometry) return;
   
   // If no parts exist, show the full point cloud
   if (parts.length === 0) {
     updatePointCloudColors();
     return;
   }
   
   // If we have parts, combine visible ones
   const combinedGeometry = combineVisiblePartsInstance();
   if (combinedGeometry) {
     // Apply filter mode colors to the combined geometry
     const coloredGeometry = applyFilterModeColorsToGeometry(combinedGeometry);
     updatePointCloudGeometry(pointCloud, coloredGeometry);
   } else {
     // No visible parts, show empty
     const emptyGeometry = new THREE.BufferGeometry();
     emptyGeometry.setAttribute('position', new THREE.Float32BufferAttribute([], 3));
     emptyGeometry.setAttribute('color', new THREE.Float32BufferAttribute([], 3));
     emptyGeometry.setAttribute('customColor', new THREE.Float32BufferAttribute([], 3));
     emptyGeometry.setAttribute('size', new THREE.Float32BufferAttribute([], 1));
     updatePointCloudGeometry(pointCloud, emptyGeometry);
   }
  }, [parts, pointCloud, originalGeometry, updatePointCloudColors, filterMode, treeIDs, treeIDData]);

   useEffect(() => {
    const canvasContainerElement = canvasRef.current?.parentElement;
    if (!canvasContainerElement || !sceneManagerRef.current || !pointCloud) return;

    if (activeTool) {
      if(sceneManagerRef.current.controls) sceneManagerRef.current.controls.enabled = false;
    } else {
      if(sceneManagerRef.current.controls) sceneManagerRef.current.controls.enabled = true;
    }

    if (activeTool === 'lasso') {
      const onSelectionFinish = (lassoPoints) => {
        setIsProcessingLasso(true);
        setActiveTool(null);
         setTimeout(() => {
           const canvasRect = canvasContainerElement.getBoundingClientRect();
           const sourceGeometry = selectedParts.length === 0
             ? originalGeometry
             : parts.find(h => selectedParts.includes(h.id))?.geometry;
           if (sourceGeometry) {
             const sourcePointCloud = new THREE.Points(sourceGeometry, pointCloud.material);
             sourcePointCloud.matrixWorld = pointCloud.matrixWorld;
             
             // Use treeIDData when cutting from originalGeometry, otherwise use the geometry's treeID attribute
             const treeIDDataToUse = selectedParts.length === 0 
               ? treeIDData 
               : (sourceGeometry.attributes.treeID?.array || null);
             
             const selectedGeometry = filterPointCloudByLasso(sourcePointCloud, lassoPoints, sceneManagerRef.current.camera, canvasRect, treeIDDataToUse);
             if (selectedGeometry && selectedGeometry.attributes && selectedGeometry.attributes.position && selectedGeometry.attributes.position.count > 0) {
               // Create two parts: selected and remaining
               const remainingGeometry = createRemainingGeometry(sourceGeometry, selectedGeometry, treeIDDataToUse);
               
               // Get the source part name for naming
               const sourcePartName = selectedParts.length === 0 
                 ? 'Full Point Cloud'
                 : parts.find(h => selectedParts.includes(h.id))?.name || 'Part';
               
               const newPart = { 
                 id: Date.now(), 
                 name: sourcePartName, 
                 geometry: selectedGeometry,
                 visible: true,
                 type: 'selected'
               };
               
               const remainingPart = {
                 id: Date.now() + 1,
                 name: `${sourcePartName} (remaining)`,
                 geometry: remainingGeometry,
                 visible: false,
                 type: 'remaining'
               };
               
               // If we're cutting from an existing part (not the full point cloud), replace it
               if (selectedParts.length > 0) {
                 setParts(prev => {
                   const otherParts = prev.filter(part => !selectedParts.includes(part.id));
                   return [...otherParts, newPart, remainingPart];
                 });
                 // Clear selected parts and select the new part
                 setSelectedParts([newPart.id]);
               } else {
                 // If cutting from full point cloud, just add the new parts
                 setParts(prev => [...prev, newPart, remainingPart]);
                 setSelectedParts([newPart.id]);
               }
             } else {
               // No points selected (empty space), just clear the canvas
               console.log('No points selected in the lasso area');
             }
           }
           if(lassoHelperRef.current) lassoHelperRef.current.clearCanvas();
           setIsProcessingLasso(false);
         }, 50);
      };
      lassoHelperRef.current = createLassoHelper(canvasContainerElement, onSelectionFinish);
    }

    return () => {
      if (lassoHelperRef.current) {
        lassoHelperRef.current.dispose();
        lassoHelperRef.current = null;
      }
      if (sceneManagerRef.current?.controls) {
        sceneManagerRef.current.controls.enabled = true;
      }
    };
  }, [activeTool, pointCloud, parts, selectedParts, originalGeometry]);


  // (All existing code from here... updateMiniMapPosition down to return statement remains the same)
  
  const updateMiniMapPosition = useCallback(() => {
    if (!showMiniMap || !viewerWrapperRef.current) {
      if (showMiniMap) {
        setMiniMapContainerStyle(prev => ({ ...prev, visibility: 'hidden' }));
      }
      return;
    }

    const parentNode = viewerWrapperRef.current;
    const parentRect = parentNode.getBoundingClientRect();

    const parentWidth = parentRect.width;
    const parentHeight = parentRect.height;

    const currentMapEffectiveWidth = parentWidth < (MINIMAP_ESTIMATED_WIDTH_XS + MINIMAP_ESTIMATED_WIDTH_SM) / 2
        ? MINIMAP_ESTIMATED_WIDTH_XS
        : MINIMAP_ESTIMATED_WIDTH_SM;
    const currentMapEffectiveHeight = parentHeight < (MINIMAP_ESTIMATED_HEIGHT_XS + MINIMAP_ESTIMATED_HEIGHT_SM) / 2
        ? MINIMAP_ESTIMATED_HEIGHT_XS
        : MINIMAP_ESTIMATED_HEIGHT_SM;
    
    const buttonTop = 15;
    const buttonHeight = BUTTON_FIXED_SIZE;
    const idealTop = buttonTop + buttonHeight + MINIMAP_BUTTON_GAP;
    const idealLeft = 315;

    const finalTop = Math.max(MINIMAP_BUTTON_GAP, Math.min(idealTop, parentHeight - currentMapEffectiveHeight - MINIMAP_BUTTON_GAP));
    const finalLeft = Math.max(MINIMAP_BUTTON_GAP, Math.min(idealLeft, parentWidth - currentMapEffectiveWidth - MINIMAP_BUTTON_GAP));
    
    setMiniMapContainerStyle(prev => ({
      ...prev,
      top: `${finalTop}px`,
      left: `${finalLeft}px`,
      right: 'auto',
      bottom: 'auto',
      visibility: 'visible',
      width: `${currentMapEffectiveWidth}px`,
      height: `${currentMapEffectiveHeight}px`,
      transition: 'top 0.2s ease-out, left 0.2s ease-out',
    }));
  }, [showMiniMap]);

  const toggleMiniMap = () => {
    setShowMiniMap(prevShowState => {
        const newShowState = !prevShowState;
        if (!newShowState) {
            setMiniMapContainerStyle(prevStyle => ({...prevStyle, visibility: 'hidden'}));
        }
        return newShowState;
    });
  };

  useEffect(() => {
    const fetchAllFilesForMap = async () => {
      const storedToken = localStorage.getItem('authToken');
      if (!storedToken) {
        setErrorMiniMapFiles("Authentication required for mini-map data.");
        setIsLoadingMiniMapFiles(false);
        return;
      }

      setIsLoadingMiniMapFiles(true);
      setErrorMiniMapFiles(null);
      try {
        const response = await fetch(`/api/files`, {
          headers: { 'Authorization': `Bearer ${storedToken}` }
        });
        if (!response.ok) {
          throw new Error(`HTTP error fetching files for mini-map! Status: ${response.status}`);
        }
        const filesData = await response.json();
        const filesArray = Array.isArray(filesData) ? filesData : [];

        const filesWithValidCoords = filesArray.filter(file =>
          file.latitude !== null && typeof file.latitude === 'number' &&
          file.longitude !== null && typeof file.longitude === 'number'
        ).map(f => ({
            ...f,
            projectName: f.projectName || (f.project_id ? `${f.project_name}` : 'Unassigned'),
            divisionName: f.divisionName || (f.division_id ? `${f.division_name}` : 'N/A'),
       }));
        setMiniMapFiles(filesWithValidCoords);
      } catch (err) {
        console.error("Failed to fetch mini-map files:", err);
        setErrorMiniMapFiles(err.message || "An error occurred while fetching mini-map files.");
        setMiniMapFiles([]);
      } finally {
        setIsLoadingMiniMapFiles(false);
      }
    };
    fetchAllFilesForMap();
  }, []);

  useEffect(() => {
    updateMiniMapPosition(); 
    const handleResizeOrCollapse = () => {
      updateMiniMapPosition();
    };
    window.addEventListener('resize', handleResizeOrCollapse);
    return () => {
      window.removeEventListener('resize', handleResizeOrCollapse);
    };
  }, [showMiniMap, isCollapsed, updateMiniMapPosition]);

  useEffect(() => {
    const timer = setTimeout(() => {
      updateMiniMapPosition();
    }, 100);
    return () => clearTimeout(timer);
  }, [updateMiniMapPosition]);

  useEffect(() => {
    if (!viewerWrapperRef.current) return;
    const resizeObserver = new ResizeObserver(() => {
      updateMiniMapPosition();
    });
    resizeObserver.observe(viewerWrapperRef.current);
    return () => {
      resizeObserver.disconnect();
    };
  }, [updateMiniMapPosition]);

  useEffect(() => {
    if (!canvasRef.current) return;
    const sceneManager = createSceneManager(canvasRef.current);
    sceneManagerRef.current = sceneManager;
    sceneManager.startAnimation();
    return () => {
      sceneManager.dispose();
    };
  }, []);

  useEffect(() => {
    const fileIdParam = searchParams.get('fileId');
    if (fileIdParam && fileIdParam !== fileId) {
      setFileId(fileIdParam);
      loadFileFromBackend(fileIdParam);
    }
  }, [searchParams, fileId]);

  useEffect(() => {
    return () => {
      if (pointCloud && sceneManagerRef.current) {
        disposeBoundingBox(boundingBox);
        sceneManagerRef.current.scene.remove(pointCloud);
        // Dispose of geometry and material to prevent memory leaks
        if (pointCloud.geometry) pointCloud.geometry.dispose();
        if (pointCloud.material) pointCloud.material.dispose();
      }
    };
  }, [pointCloud, boundingBox]);

  const loadFileFromBackend = async (fileId) => {
    if (isLoading) return;
    setIsLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem('authToken');
      if (!token) {
        setError('Authentication required');
        return;
      }
      const filesResponse = await axios.get(`/api/files/`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const files = filesResponse.data;
      const fileInfo = files.find(file => file.id === parseInt(fileId));
      if (!fileInfo) {
        setError(`File with ID ${fileId} not found`);
        return;
      }
      setFileInfo(fileInfo);
      const response = await axios.get(`/api/files/download/${fileId}`, {
        headers: { 'Authorization': `Bearer ${token}` },
        responseType: 'blob'
      });
      const blob = new Blob([response.data]);
      const file = new File([blob], `file_${fileId}.las`, { type: 'application/octet-stream' });
      await processFile(file);
    } catch (err) {
      setError(`Failed to load file: ${err.response?.data?.message || err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const processFile = async (file) => {
    if (!file.name.toLowerCase().endsWith('.las') && !file.name.toLowerCase().endsWith('.laz')) {
      setError('Please select a LAS or LAZ file');
      return;
    }
    setSelectedFile(file);
    setError(null);
    setIsLoading(true);
    try {
      const { points, colors, treeIDs } = await parseLASFile(file);
      await new Promise(resolve => {
        requestAnimationFrame(() => {
          if (sceneManagerRef.current) {
            // Remove all existing point clouds from the scene
            const childrenToRemove = [];
            sceneManagerRef.current.scene.traverse((child) => {
              if (child instanceof THREE.Points) childrenToRemove.push(child);
            });
            childrenToRemove.forEach((pc) => {
              sceneManagerRef.current.scene.remove(pc);
              if (pc.geometry) pc.geometry.dispose();
              if (pc.material) pc.material.dispose();
            });
            
            // Clean up bounding box
            if (boundingBox) disposeBoundingBox(boundingBox);
            setBoundingBox(null);
            setPointCloud(null);
            
            // Clear parts state to prevent conflicts
            setParts([]);
            setSelectedParts([]);
            setActivePartId(null);
          }
          resolve();
        });
      });

      await new Promise(resolve => {
        requestAnimationFrame(() => {
          const geometry = createPointCloudGeometry(points, colors);
          
          // Create treeID colors for the same points
          const treeIDColors = [];
          const uniqueTreeIDData = createInitialTreeIDs(treeIDs);
          
          for (let i = 0; i < points.length; i += 3) {
            const pointIndex = i / 3;
            const pointTreeID = treeIDs[pointIndex];
            const treeInfo = uniqueTreeIDData[pointTreeID];
            if (treeInfo && treeInfo.color) {
              treeIDColors.push(treeInfo.color[0], treeInfo.color[1], treeInfo.color[2]);
            } else {
              treeIDColors.push(0.5, 0.5, 0.5); // Default color
            }
          }
          
          // Store both classification and treeID colors in the geometry
          geometry.setAttribute('classificationColor', new THREE.Float32BufferAttribute(colors, 3));
          geometry.setAttribute('treeIDColor', new THREE.Float32BufferAttribute(treeIDColors, 3));
          
          const material = createPointCloudMaterial();
          const newPointCloud = new THREE.Points(geometry, material);
          
          // Double-check that no point clouds exist before adding the new one
          const existingPointClouds = [];
          sceneManagerRef.current.scene.traverse((child) => {
            if (child instanceof THREE.Points) existingPointClouds.push(child);
          });
          
          // Remove any remaining point clouds (safety check)
          existingPointClouds.forEach((pc) => {
            sceneManagerRef.current.scene.remove(pc);
            if (pc.geometry) pc.geometry.dispose();
            if (pc.material) pc.material.dispose();
          });
          
          sceneManagerRef.current.scene.add(newPointCloud);
          setPointCloud(newPointCloud);
          setOriginalGeometry(geometry.clone());
          const treeIDMap = createInitialTreeIDs(treeIDs);
          setTreeIDs(treeIDMap);
          setTreeIDData(treeIDs);
          const box = createBoundingBox(geometry, showBoundingBox);
          newPointCloud.add(box);
          setBoundingBox(box);
          const distanceBounds = sceneManagerRef.current.setCameraTopView(geometry);
          minDistanceRef.current = distanceBounds.minDistance;
          maxDistanceRef.current = distanceBounds.maxDistance;
          sceneManagerRef.current.controls.setDistanceBounds(minDistanceRef.current, maxDistanceRef.current);
          sceneManagerRef.current.controls.setDragObjects([newPointCloud]);
          setError(null);
          setTimeout(resolve, 10);
        });
      });
    } catch (err) {
      setError(`Error parsing file: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const handleResize = () => {
      if (sceneManagerRef.current && canvasRef.current) {
        const canvas = canvasRef.current;
        const container = canvas.parentElement;
        if (container) {
          const rect = container.getBoundingClientRect();
          sceneManagerRef.current.renderer.setSize(rect.width, rect.height);
          sceneManagerRef.current.camera.aspect = rect.width / rect.height;
          sceneManagerRef.current.camera.updateProjectionMatrix();
        }
      }
    };
    const timer = setTimeout(handleResize, 100);
    return () => clearTimeout(timer);
  }, [isCollapsed]);



  const toggleBoundingBox = () => {
    const newVisibility = !showBoundingBox;
    updateBoundingBoxVisibility(boundingBox, newVisibility);
    setShowBoundingBox(newVisibility);
  };

  const handleSplitPointCloud = () => {
    if (!pointCloud || !originalGeometry) return;
    
    const newParts = [];
    
    if (filterMode === 'classification') {
      // Split by classification - create a custom filter for each classification
      Object.entries(classifications).forEach(([id, classification]) => {
        const filteredGeometry = filterPointCloudBySingleClassification(originalGeometry, id, classification, treeIDData);
        if (filteredGeometry && filteredGeometry.attributes && filteredGeometry.attributes.position && filteredGeometry.attributes.position.count > 0) {
          newParts.push({
            id: Date.now() + Math.random(),
            name: classification.name,
            geometry: filteredGeometry,
            visible: true,
            type: 'classification',
            classificationId: id
          });
        }
      });
    } else if (filterMode === 'treeID' && treeIDData) {
      // Split by treeID - create a custom filter for each treeID
      // Check if -1 exists to determine which is Unclassified
      const hasNegativeOne = Object.keys(treeIDs).some(key => parseInt(key) === -1);
      
      // Sort entries: Unclassified first, then regular treeIDs
      const sortedEntries = Object.entries(treeIDs).sort(([idA, treeIDA], [idB, treeIDB]) => {
        const numA = parseInt(idA);
        const numB = parseInt(idB);
        
        // Determine which value is unclassified
        const aIsUnclassified = hasNegativeOne ? (numA === -1) : (numA === 0);
        const bIsUnclassified = hasNegativeOne ? (numB === -1) : (numB === 0);
        
        // Unclassified goes to the very first position
        if (aIsUnclassified && !bIsUnclassified) return -1;
        if (!aIsUnclassified && bIsUnclassified) return 1;
        
        // Both are regular treeIDs: sort numerically
        return numA - numB;
      });
      
      sortedEntries.forEach(([id, treeID]) => {
        const filteredGeometry = filterPointCloudBySingleTreeID(originalGeometry, id, treeID, treeIDData);
        if (filteredGeometry && filteredGeometry.attributes && filteredGeometry.attributes.position && filteredGeometry.attributes.position.count > 0) {
          newParts.push({
            id: Date.now() + Math.random(),
            name: treeID.name,
            geometry: filteredGeometry,
            visible: true,
            type: 'treeID',
            treeIDId: id
          });
        }
      });
    }
    
    if (newParts.length > 0) {
      setParts(newParts);
      setSelectedParts([]); // Clear selection after splitting
    }
  };

  // Helper function to filter by a single treeID while preserving classification data
  const filterPointCloudBySingleTreeID = (originalGeometry, treeIDId, treeID, treeIDData) => {
    if (!originalGeometry || !treeIDData) {
      const emptyGeometry = new THREE.BufferGeometry();
      emptyGeometry.setAttribute('position', new THREE.Float32BufferAttribute([], 3));
      emptyGeometry.setAttribute('color', new THREE.Float32BufferAttribute([], 3));
      emptyGeometry.setAttribute('customColor', new THREE.Float32BufferAttribute([], 3));
      emptyGeometry.setAttribute('size', new THREE.Float32BufferAttribute([], 1));
      return emptyGeometry;
    }
    
    const positions = originalGeometry.attributes.position.array;
    const classificationColors = originalGeometry.attributes.classificationColor?.array || originalGeometry.attributes.color.array;
    const treeIDColors = originalGeometry.attributes.treeIDColor?.array || originalGeometry.attributes.color.array;
    const customColors = originalGeometry.attributes.customColor.array;
    const sizes = originalGeometry.attributes.size.array;
    
    const newPositions = [];
    const newColors = [];
    const newCustomColors = [];
    const newSizes = [];
    const newClassifications = []; // Store classification data for each point
    const newTreeIDs = []; // Store treeID data for each point
    
    const targetTreeID = parseInt(treeIDId);
    const treeIDColor = treeID.color; // Use the treeID's assigned color
    
    for (let i = 0; i < positions.length; i += 3) {
      const pointIndex = i / 3;
      const pointTreeID = treeIDData[pointIndex];
      
      // Check if this point matches the target treeID
      if (pointTreeID === targetTreeID) {
        newPositions.push(positions[i], positions[i+1], positions[i+2]);
        // Use treeID color for display
        newColors.push(treeIDColor[0], treeIDColor[1], treeIDColor[2]);
        newCustomColors.push(treeIDColor[0], treeIDColor[1], treeIDColor[2]);
        newSizes.push(sizes[pointIndex]);
        
        // Preserve original classification colors
        newClassifications.push(classificationColors[i], classificationColors[i+1], classificationColors[i+2]);
        
        // Preserve treeID data
        newTreeIDs.push(pointTreeID);
      }
    }
    
    if (newPositions.length === 0) return new THREE.BufferGeometry();

    const finalGeometry = new THREE.BufferGeometry();
    finalGeometry.setAttribute('position', new THREE.Float32BufferAttribute(newPositions, 3));
    finalGeometry.setAttribute('color', new THREE.Float32BufferAttribute(newColors, 3));
    finalGeometry.setAttribute('customColor', new THREE.Float32BufferAttribute(newCustomColors, 3));
    finalGeometry.setAttribute('size', new THREE.Float32BufferAttribute(newSizes, 1));
    
    // Store original classification colors as a custom attribute
    if (newClassifications.length > 0) {
      finalGeometry.setAttribute('originalClassification', new THREE.Float32BufferAttribute(newClassifications, 3));
    }
    
    // Store treeID data as a custom attribute
    if (newTreeIDs.length > 0) {
      finalGeometry.setAttribute('treeID', new THREE.Float32BufferAttribute(newTreeIDs, 1));
    } else {
    }
    
    return finalGeometry;
  };

  // Helper function to filter by a single classification while preserving treeID data
  const filterPointCloudBySingleClassification = (originalGeometry, classificationId, classification, treeIDData = null) => {
    if (!originalGeometry) {
      const emptyGeometry = new THREE.BufferGeometry();
      emptyGeometry.setAttribute('position', new THREE.Float32BufferAttribute([], 3));
      emptyGeometry.setAttribute('color', new THREE.Float32BufferAttribute([], 3));
      emptyGeometry.setAttribute('customColor', new THREE.Float32BufferAttribute([], 3));
      emptyGeometry.setAttribute('size', new THREE.Float32BufferAttribute([], 1));
      return emptyGeometry;
    }
    
    const positions = originalGeometry.attributes.position.array;
    const classificationColors = originalGeometry.attributes.classificationColor?.array || originalGeometry.attributes.color.array;
    const treeIDColors = originalGeometry.attributes.treeIDColor?.array || originalGeometry.attributes.color.array;
    const customColors = originalGeometry.attributes.customColor.array;
    const sizes = originalGeometry.attributes.size.array;
    
    const newPositions = [];
    const newColors = [];
    const newCustomColors = [];
    const newSizes = [];
    const newTreeIDs = []; // Store treeID data for each point
    const newClassificationColors = []; // Preserve classification colors
    const newOriginalClassifications = []; // Preserve original classification
    
    // Get original classification data from originalGeometry
    const originalClassification = originalGeometry.attributes.originalClassification?.array;
    
    const [targetR, targetG, targetB] = classification.color;
    
    for (let i = 0; i < positions.length; i += 3) {
      const r = classificationColors[i], g = classificationColors[i+1], b = classificationColors[i+2];
      
      // Check if this point matches the target classification color
      if (Math.abs(r - targetR) < 0.01 && Math.abs(g - targetG) < 0.01 && Math.abs(b - targetB) < 0.01) {
        const pointIndex = i / 3;
        newPositions.push(positions[i], positions[i+1], positions[i+2]);
        // Use classification colors for display
        newColors.push(classificationColors[i], classificationColors[i+1], classificationColors[i+2]);
        newCustomColors.push(customColors[i], customColors[i+1], customColors[i+2]);
        newSizes.push(sizes[pointIndex]);
        
        // Preserve classification colors
        newClassificationColors.push(classificationColors[i], classificationColors[i+1], classificationColors[i+2]);
        
        // Preserve original classification if available
        if (originalClassification && i < originalClassification.length) {
          newOriginalClassifications.push(originalClassification[i], originalClassification[i+1], originalClassification[i+2]);
        } else {
          // If no originalClassification, use classification colors as original
          newOriginalClassifications.push(classificationColors[i], classificationColors[i+1], classificationColors[i+2]);
        }
        
        // Preserve treeID data if available
        if (treeIDData && treeIDData[pointIndex] !== undefined) {
          newTreeIDs.push(treeIDData[pointIndex]);
        } else {
          newTreeIDs.push(0); // Default to 0 if no treeID data
        }
      }
    }
    
    if (newPositions.length === 0) return new THREE.BufferGeometry();

    const finalGeometry = new THREE.BufferGeometry();
    finalGeometry.setAttribute('position', new THREE.Float32BufferAttribute(newPositions, 3));
    finalGeometry.setAttribute('color', new THREE.Float32BufferAttribute(newColors, 3));
    finalGeometry.setAttribute('customColor', new THREE.Float32BufferAttribute(newCustomColors, 3));
    finalGeometry.setAttribute('size', new THREE.Float32BufferAttribute(newSizes, 1));
    
    // Store classificationColor attribute to preserve classification colors
    if (newClassificationColors.length > 0) {
      finalGeometry.setAttribute('classificationColor', new THREE.Float32BufferAttribute(newClassificationColors, 3));
    }
    
    // Store originalClassification attribute to preserve original classification data
    if (newOriginalClassifications.length > 0) {
      finalGeometry.setAttribute('originalClassification', new THREE.Float32BufferAttribute(newOriginalClassifications, 3));
    }
    
    // Store treeID data as a custom attribute
    if (newTreeIDs.length > 0) {
      finalGeometry.setAttribute('treeID', new THREE.Float32BufferAttribute(newTreeIDs, 1));
      console.log('Classification Filter: Stored treeID data with', newTreeIDs.length, 'values');
      console.log('Classification Filter: Sample treeID values:', newTreeIDs.slice(0, 10));
    } else {
      console.log('Classification Filter: No treeID data to store');
    }
    
    return finalGeometry;
  };

  const handleResetPointCloud = () => {
    // Clear all parts to show the full point cloud
    setParts([]);
    setSelectedParts([]);
    setActivePartId(null);
    
    // Reset filter mode to classification to show full point cloud
    setFilterMode('classification');
    
    // Reset all treeIDs to visible so they show when switching back to treeID mode
    if (treeIDs && Object.keys(treeIDs).length > 0) {
      const resetTreeIDs = {};
      Object.keys(treeIDs).forEach(id => {
        if (treeIDs[id]) {
          resetTreeIDs[id] = {
            ...treeIDs[id],
            visible: true
          };
        }
      });
      setTreeIDs(resetTreeIDs);
    }
  };

  // Handler for treeID selection from minimap
  const handleTreeIDSelectFromMiniMap = (treeIDValue) => {
    if (!treeIDData || !originalGeometry) return;
    
    // Switch to treeID filter mode
    setFilterMode('treeID');
    
    // Check if parts exist and are split by treeID
    const partsAreTreeIDSplit = parts.length > 0 && parts.every(part => part.type === 'treeID');
    const treeIDString = String(treeIDValue);
    
    if (partsAreTreeIDSplit) {
      // Parts already split by treeID - check if clicking the same treeID or different one
      const clickedPart = parts.find(part => part.treeIDId === treeIDString);
      const currentVisible = clickedPart ? clickedPart.visible : false;
      
      // Toggle treeID visibility
      const newTreeIDs = toggleTreeID(treeIDs, treeIDValue);
      setTreeIDs(newTreeIDs);
      
      // Toggle visibility of the clicked treeID part (keep others as they are)
      setParts(prevParts => 
        prevParts.map(part => 
          part.treeIDId === treeIDString 
            ? { ...part, visible: !currentVisible }
            : part // Keep other parts as they are
        )
      );
    } else {
      // Need to split by treeID first - show only the clicked treeID
      const newParts = [];
      const hasNegativeOne = Object.keys(treeIDs).some(key => parseInt(key) === -1);
      
      // Sort entries: Unclassified first, then regular treeIDs
      const sortedEntries = Object.entries(treeIDs).sort(([idA, treeIDA], [idB, treeIDB]) => {
        const numA = parseInt(idA);
        const numB = parseInt(idB);
        const aIsUnclassified = hasNegativeOne ? (numA === -1) : (numA === 0);
        const bIsUnclassified = hasNegativeOne ? (numB === -1) : (numB === 0);
        if (aIsUnclassified && !bIsUnclassified) return -1;
        if (!aIsUnclassified && bIsUnclassified) return 1;
        return numA - numB;
      });
      
      sortedEntries.forEach(([id, treeID]) => {
        const filteredGeometry = filterPointCloudBySingleTreeID(originalGeometry, id, treeID, treeIDData);
        if (filteredGeometry && filteredGeometry.attributes && filteredGeometry.attributes.position && filteredGeometry.attributes.position.count > 0) {
          // First time: hide all first, then show only the clicked treeID
          const isClickedTreeID = id === treeIDString;
          newParts.push({
            id: Date.now() + Math.random() + parseFloat(id),
            name: treeID.name,
            geometry: filteredGeometry,
            visible: isClickedTreeID, // Show only clicked one, hide all others
            type: 'treeID',
            treeIDId: id
          });
        }
      });
      
      if (newParts.length > 0) {
        setParts(newParts);
        setSelectedParts([]);
        
        // Update treeID visibility state: clicked treeID visible, others hidden
        const newTreeIDs = { ...treeIDs };
        sortedEntries.forEach(([id, treeID]) => {
          const isClickedTreeID = id === treeIDString;
          if (newTreeIDs[id]) {
            newTreeIDs[id] = {
              ...newTreeIDs[id],
              visible: isClickedTreeID // Show clicked, hide all others
            };
          }
        });
        setTreeIDs(newTreeIDs);
      }
    }
  };


  // Create annotation function instances with state setters
  const handleAnnotationTypeChangeInstance = handleAnnotationTypeChange(setSelectedAnnotationType, setSelectedAnnotationValue);
  const handleAnnotationValueSelectInstance = handleAnnotationValueSelect(setSelectedAnnotationValue);
  const annotateAllVisiblePointsInstance = annotateAllVisiblePoints(setIsAnnotating, setAnnotationDialogOpen, selectedAnnotationValue, selectedAnnotationType, classifications, treeIDs, pointCloud, parts, selectedParts, originalGeometry, combineVisiblePartsInstance, setTreeIDs, setTreeIDData, treeIDData, setParts);
  const handleAnnotationDialogCloseInstance = handleAnnotationDialogClose(setAnnotationDialogOpen, setSelectedAnnotationValue);


  useEffect(() => {
    updatePointCloudColors();
  }, [filterMode, classifications, treeIDs]);

  // Create a map of visible treeIDs from parts for the minimap
  const visibleTreeIDs = useMemo(() => {
    const visibleMap = {};
    if (parts.length > 0 && parts.every(part => part.type === 'treeID')) {
      parts.forEach(part => {
        if (part.treeIDId) {
          visibleMap[part.treeIDId] = part.visible;
        }
      });
    }
    return visibleMap;
  }, [parts]);

  return (
    <Box 
      className="pointcloud-viewer"
      sx={{
        ...styles.container,
        marginLeft: getResponsiveMarginLeft(isCollapsed)
      }}
    >
      <Box sx={styles.content}>
        <Box sx={styles.viewerWrapper} ref={viewerWrapperRef}>
          {/* Left Controls Sidebar */}
          <Box sx={styles.controlsSidebar}>
            <Paper sx={styles.controlsPaper}>
               <Box sx={{ display: 'flex', justifyContent: 'center', mb: 2 }}>
                 <Typography variant="h6" sx={styles.controlsTitle}>
                   Point Cloud Controls
                 </Typography>
               </Box>
              
              <Box sx={styles.controlsContent}>
                
                {selectedFile && fileInfo && (
                    <Box sx={{ mb: 2, p:1, border: `1px solid ${colors.grey[700]}`, borderRadius: '4px' }}>
                        <Typography variant="subtitle1" sx={{ color: colors.grey[100], mb: 1, fontWeight: 'bold' }}>File Information</Typography>
                        <Typography variant="body2" sx={{ color: colors.grey[200], mb: 0.5 }}>File Name: <span style={{color: colors.grey[300]}}>{fileInfo.name || selectedFile.name}</span></Typography>
                        <Typography variant="body2" sx={{ color: colors.grey[200], mb: 0.5 }}>Plot: <span style={{color: colors.grey[300]}}>{fileInfo.plot_name || 'N/A'}</span></Typography>
                        <Typography variant="body2" sx={{ color: colors.grey[200], mb: 0.5 }}>Division: <span style={{color: colors.grey[300]}}>{fileInfo.divisionName || 'N/A'}</span></Typography>
                        <Typography variant="body2" sx={{ color: colors.grey[200] }}>Project: <span style={{color: colors.grey[300]}}>{fileInfo.projectName || 'N/A'}</span></Typography>
                    </Box>
                )}

                {isLoading && (
                  <Box sx={styles.loadingContainer}>
                    <CircularProgress size={18}/>
                    <Typography variant="body2" sx={styles.loadingText}>Loading...</Typography>
                  </Box>
                )}

                {/* --- Point Cloud Parts --- */}
                {pointCloud && (
                  <Box sx={styles.annotationListSection}>
                     <Box sx={{display: 'flex', alignItems: 'center', mb:1}}>
                       <Typography sx={{...styles.annotationTitle, flex: 1, borderBottom: 'none', textAlign: 'center'}}>Point Cloud</Typography>
                     </Box>
                    <Box sx={{ maxHeight: 320, overflowY: 'auto' }}>
                      <Box 
                        sx={{...styles.annotationItem, ...(selectedParts.length === 0 ? styles.activeAnnotationItem : {})}}
                        onClick={() => setSelectedParts([])}
                      >
                        <Typography sx={styles.annotationName}>Full Point Cloud</Typography>
                      </Box>
                    {parts.length > 0 && (() => {
                      const allVisible = parts.every(p => p.visible);
                      const noneVisible = parts.every(p => !p.visible);
                      return (
                        <Box
                          sx={styles.annotationItem}
                          onClick={() => {
                            const target = !allVisible;
                            setParts(prev => prev.map(part => ({ ...part, visible: target })));
                          }}
                          title="Toggle visibility of all parts"
                        >
                          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                            <Typography sx={styles.annotationName}>
                              Show all parts
                            </Typography>
                            <Checkbox 
                              checked={allVisible}
                              indeterminate={!allVisible && !noneVisible}
                              onChange={(e) => {
                                e.stopPropagation();
                                const checked = e.target.checked;
                                setParts(prev => prev.map(part => ({ ...part, visible: checked })));
                              }}
                              sx={{ p: 0.5 }}
                              size="small"
                            />
                          </Box>
                        </Box>
                      );
                    })()}
                    {parts.length > 0 && (
                      <Divider sx={{ my: 1 }} />
                    )}
                    
                    {parts.map(part => {
                      const isSelected = selectedParts.includes(part.id);
                      
                      return (
                      <Box 
                        key={part.id}
                        sx={{
                          ...styles.annotationItem, 
                          ...(isSelected ? styles.activeAnnotationItem : {})
                        }}
                        onClick={(e) => {
                          if (e.ctrlKey || e.metaKey) {
                            // Multi-select mode
                            handlePartMultiSelectInstance(part.id, e);
                          } else {
                            // Single select mode
                            if (selectedParts.includes(part.id) && selectedParts.length === 1) {
                              // If this is the only selected part, keep it selected (don't unselect)
                              // Do nothing - part remains selected
                            } else {
                              // Otherwise, select only this part
                              setSelectedParts([part.id]);
                            }
                          }
                        }}
                        onContextMenu={(e) => handleContextMenu(e, part.id)}
                        title={`Click to view this part. Ctrl+click for multi-selection. Right-click for options.`}
                      >
                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flex: 1 }}>
                            <Typography sx={styles.annotationName}>
                              {part.name}
                            </Typography>
                          </Box>
                          <Checkbox 
                            checked={part.visible}
                            onChange={(e) => {
                              e.stopPropagation();
                              handleTogglePartVisibilityInstance(part.id);
                            }}
                            sx={{ p: 0.5 }}
                            size="small"
                          />
                        </Box>
                      </Box>
                      );
                    })}
                    </Box>
                  </Box>
                )}

                {/* --- Filter Mode --- */}
                {pointCloud && (
                  <FormControl fullWidth size="small" sx={styles.filterModeSelect}>
                    <InputLabel>Filter Mode</InputLabel>
                    <Select value={filterMode} label="Filter Mode" onChange={(e) => setFilterMode(e.target.value)}>
                      <MenuItem value="classification">Classification</MenuItem>
                      <MenuItem value="treeID">Tree ID</MenuItem>
                    </Select>
                  </FormControl>
                )}

                {/* Split/Reset Button - appears when filter mode is selected */}
                {pointCloud && filterMode && (
                  <Box sx={{ mt: 2 }}>
                    {parts.length === 0 ? (
                      <Button
                        variant="contained"
                        onClick={() => handleSplitPointCloud()}
                        fullWidth
                        sx={{ 
                          backgroundColor: colors.greenAccent[500],
                          '&:hover': { backgroundColor: colors.greenAccent[600] }
                        }}
                        startIcon={<DeleteSweep />}
                      >
                        Split Point Cloud by {filterMode === 'classification' ? 'Classification' : 'Tree ID'}
                      </Button>
                    ) : (
                      <Button
                        variant="outlined"
                        onClick={() => handleResetPointCloud()}
                        fullWidth
                        sx={{ 
                          borderColor: colors.grey[400],
                          color: colors.grey[200],
                          '&:hover': { 
                            borderColor: colors.grey[300],
                            backgroundColor: colors.grey[800]
                          }
                        }}
                        startIcon={<Close />}
                      >
                        Reset to Full Point Cloud
                      </Button>
                    )}
                  </Box>
                )}

                {/* --- Combined Tools Container --- */}
                {pointCloud && (
                  <Box sx={styles.annotationSection}>
                    <Typography sx={styles.annotationTitle}>Tools & Controls</Typography>
                    
                    {/* Bounding Box */}
                    <FormControlLabel 
                      control={<Checkbox checked={showBoundingBox} onChange={toggleBoundingBox} sx={styles.checkbox}/>} 
                      label="Show Bounding Box" 
                      sx={styles.checkboxLabel}
                    />
                    
                    {/* Point Size */}
                    <Box sx={{ px: 1, mt: 2 }}>
                      <Typography gutterBottom variant="body2" sx={{ color: colors.grey[300] }}>
                        Point Size
                      </Typography>
                      <Slider
                        value={pointSize}
                        onChange={(e, newValue) => setPointSize(newValue)}
                        aria-labelledby="point-size-slider"
                        valueLabelDisplay="auto"
                        step={0.5}
                        min={1}
                        max={20}
                        sx={{ color: colors.greenAccent[500] }}
                      />
                    </Box>

                    {/* Point Density */}
                    <Box sx={{ px: 1, mt: 2 }}>
                      <Typography gutterBottom variant="body2" sx={{ color: colors.grey[300] }}>
                        Point Density
                      </Typography>
                      <Slider
                        value={pointDensity}
                        onChange={(e, v) => setPointDensity(v)}
                        aria-labelledby="point-density-slider"
                        valueLabelDisplay="auto"
                        step={0.05}
                        min={0.1}
                        max={1.0}
                        sx={{ color: colors.greenAccent[500] }}
                      />
                    </Box>
                    
                    {/* Annotation Button */}
                    <Button
                      variant="contained"
                      onClick={() => setAnnotationDialogOpen(true)}
                      disabled={isAnnotating}
                      fullWidth
                      sx={{ mt: 2, mb: 2 }}
                      startIcon={<Edit />}
                    >
                      Annotate Selected Part
                    </Button>
                    
                    {/* Selection Tool */}
                    <Box sx={{ mt: 2 }}>
                      <Typography gutterBottom variant="body2" sx={{ color: colors.grey[300], mb: 1 }}>
                        Selection Tool
                      </Typography>
                      {isProcessingLasso && (
                        <Box sx={styles.loadingContainer}>
                            <CircularProgress size={18}/>
                            <Typography sx={styles.loadingText}>Processing Selection...</Typography>
                        </Box>
                      )}
                      <Box sx={{ display: 'flex', justifyContent: 'center', gap: 1}}>
                        <IconButton
                          sx={{...styles.toolButton, ...(activeTool === 'lasso' ? {backgroundColor: colors.primary[700], color: colors.grey[100]} : {})}}
                          onClick={() => handleToolSelect('lasso')} 
                          title="Lasso Selection Tool"
                          disabled={isProcessingLasso}
                        >
                          <Gesture />
                        </IconButton>
                      </Box>
                    </Box>
                  </Box>
                )}


                {error && (
                  <Alert severity="error" sx={styles.errorAlert}>{error}</Alert>
                )}
              </Box>
            </Paper>
          </Box>

          {/* Main Viewer Area */}
          <Box sx={styles.renderArea}>
            <canvas ref={canvasRef} style={styles.canvas}/>
          </Box>

          {/* MiniMap Toggle Button & Container */}
          <IconButton onClick={toggleMiniMap} sx={{ position: 'absolute', top: '15px', left: '315px', zIndex: 1002, backgroundColor: 'rgba(0,0,0,0.2)', color: 'white', '&:hover': {backgroundColor: 'rgba(0,0,0,0.4)'}}}>
            {showMiniMap ? <Close /> : <Map />}
          </IconButton>
          {showMiniMap && (
            <Box sx={miniMapContainerStyle}>
                {isLoadingMiniMapFiles && <CircularProgress/>}
                {errorMiniMapFiles && <Typography color="error">{errorMiniMapFiles}</Typography>}
                {!isLoadingMiniMapFiles && !errorMiniMapFiles && miniMapFiles.length > 0 && (
                    <MiniMap files={miniMapFiles} currentFileId={fileId ? parseInt(fileId) : null} colors={colors} onTreeIDSelect={handleTreeIDSelectFromMiniMap} visibleTreeIDs={visibleTreeIDs}/>
                )}
                {!isLoadingMiniMapFiles && !errorMiniMapFiles && miniMapFiles.length === 0 && <Typography>No geolocated files found.</Typography>}
            </Box>
           )}

         </Box>
       </Box>

       {/* Annotation Dialog */}
       <Dialog 
         open={annotationDialogOpen} 
         onClose={handleAnnotationDialogClose}
         maxWidth="sm"
         fullWidth
       >
         <DialogTitle>
           <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
             <Edit sx={{ color: colors.greenAccent[500] }} />
             Annotate Selected Part
           </Box>
         </DialogTitle>
         <DialogContent>
           <Box sx={{ mt: 2 }}>
             <Typography variant="body2" sx={{ color: colors.grey[300], mb: 2 }}>
               {parts.length === 0 
                 ? "This will annotate the full point cloud"
                 : selectedParts.length === 0 
                   ? "Please select a part to annotate"
                   : selectedParts.length === 1
                     ? `This will annotate: ${parts.find(p => p.id === selectedParts[0])?.name || 'Selected Part'}`
                     : `This will annotate ${selectedParts.length} selected parts`
               }
             </Typography>
             
             <FormControl fullWidth sx={{ mb: 2 }}>
               <InputLabel>Annotation Type</InputLabel>
               <Select 
                 value={selectedAnnotationType} 
                 label="Annotation Type" 
                 onChange={(e) => handleAnnotationTypeChangeInstance(e.target.value)}
               >
                 <MenuItem value="classification">Classification</MenuItem>
                 <MenuItem value="treeID">Tree ID</MenuItem>
               </Select>
             </FormControl>
             
             {selectedAnnotationType === 'classification' && (
               <FormControl fullWidth sx={{ mb: 2 }}>
                 <InputLabel>Classification</InputLabel>
                 <Select 
                   value={selectedAnnotationValue || ''} 
                   label="Classification" 
                   onChange={(e) => handleAnnotationValueSelectInstance(e.target.value)}
                 >
                   {Object.entries(classifications).map(([id, classification]) => (
                     <MenuItem key={id} value={id}>
                       <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                         <Box sx={{
                           width: 16, 
                           height: 16, 
                           backgroundColor: `rgb(${classification.color.map(c=>c*255).join(',')})`,
                           borderRadius: '2px'
                         }} />
                         {classification.name}
                       </Box>
                     </MenuItem>
                   ))}
                 </Select>
               </FormControl>
             )}
             
            {selectedAnnotationType === 'treeID' && (
              <TextField
                fullWidth
                label="Tree ID"
                type="number"
                value={selectedAnnotationValue || ''}
                onChange={(e) => {
                  const value = e.target.value;
                  // Only allow integers (including negative numbers like -1)
                  if (value === '' || /^-?\d+$/.test(value)) {
                    handleAnnotationValueSelectInstance(value);
                  }
                }}
                inputProps={{
                  step: 1,
                  min: -2147483648,
                  max: 2147483647
                }}
                helperText="Enter an integer value (int32 format)"
                sx={{ mb: 2 }}
              />
            )}
             
           </Box>
         </DialogContent>
         <DialogActions>
           <Button onClick={handleAnnotationDialogCloseInstance}>
             Cancel
           </Button>
          <Button 
            onClick={annotateAllVisiblePointsInstance}
            variant="contained"
            disabled={
              !selectedAnnotationValue || 
              isAnnotating || 
              (parts.length > 0 && selectedParts.length === 0) ||
              (selectedAnnotationType === 'treeID' && (selectedAnnotationValue === '' || isNaN(parseInt(selectedAnnotationValue, 10)) || parseInt(selectedAnnotationValue, 10) < -2147483648 || parseInt(selectedAnnotationValue, 10) > 2147483647))
            }
            startIcon={<Save />}
          >
            {isAnnotating ? 'Applying...' : 'Apply Annotation'}
          </Button>
         </DialogActions>
       </Dialog>

       {/* Rename Dialog */}
       <Dialog 
         open={renameDialogOpen} 
         onClose={handleRenameCancel}
         maxWidth="sm"
         fullWidth
       >
         <DialogTitle>
           <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
             <Edit sx={{ color: colors.greenAccent[500] }} />
             Rename Part
           </Box>
         </DialogTitle>
         <DialogContent>
           <Box sx={{ mt: 2 }}>
             <TextField
               fullWidth
               label="Part Name"
               value={newPartName}
               onChange={(e) => setNewPartName(e.target.value)}
               variant="outlined"
               autoFocus
               onKeyPress={(e) => {
                 if (e.key === 'Enter') {
                   handleRenameConfirm();
                 }
               }}
             />
           </Box>
         </DialogContent>
         <DialogActions>
           <Button onClick={handleRenameCancel}>
             Cancel
           </Button>
           <Button 
             onClick={handleRenameConfirm}
             variant="contained"
             disabled={!newPartName.trim()}
           >
             Rename
           </Button>
         </DialogActions>
       </Dialog>

       {/* Save Dialog */}
       <Dialog 
         open={saveDialogOpen} 
         onClose={handleSaveCancel}
         maxWidth="sm"
         fullWidth
       >
         <DialogTitle>
           <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
             <Save sx={{ color: colors.greenAccent[500] }} />
             Save Part
           </Box>
         </DialogTitle>
         <DialogContent>
           <Box sx={{ mt: 2 }}>
             <Typography variant="body2" sx={{ color: colors.grey[300], mb: 2 }}>
               Enter a filename for the saved part:
             </Typography>
             <TextField
               fullWidth
               label="File Name"
               value={saveFileName}
               onChange={(e) => setSaveFileName(e.target.value)}
               variant="outlined"
               autoFocus
               placeholder="part_name"
               onKeyPress={(e) => {
                 if (e.key === 'Enter') {
                   handleSaveConfirm();
                 }
               }}
             />
           </Box>
         </DialogContent>
         <DialogActions>
           <Button onClick={handleSaveCancel} disabled={isLoading}>
             Cancel
           </Button>
           <Button 
             onClick={handleSaveConfirm}
             variant="contained"
             disabled={!saveFileName.trim() || isLoading}
             startIcon={isLoading ? <CircularProgress size={16} /> : <Save />}
           >
             {isLoading ? 'Saving...' : 'Save Part'}
           </Button>
         </DialogActions>
       </Dialog>

       {/* Context Menu */}
       <Menu
         open={contextMenu !== null}
         onClose={handleCloseContextMenu}
         anchorReference="anchorPosition"
         anchorPosition={
           contextMenu !== null
             ? { top: contextMenu.mouseY, left: contextMenu.mouseX }
             : undefined
         }
        >
          {selectedParts.length > 1 ? [
            <MenuItem key="delete-selected" onClick={handleDeleteSelectedParts}>
              <ListItemIcon>
                <Delete fontSize="small" />
              </ListItemIcon>
              <ListItemText>Delete Selected Parts ({selectedParts.length})</ListItemText>
            </MenuItem>,
            <MenuItem key="merge-selected" onClick={handleMergeSelectedParts}>
              <ListItemIcon>
                <Merge fontSize="small" />
              </ListItemIcon>
              <ListItemText>Merge Selected Parts ({selectedParts.length})</ListItemText>
            </MenuItem>
          ] : [
            <MenuItem key="rename-part" onClick={() => handleRenamePart(contextMenu?.partId)}>
              <ListItemIcon>
                <Edit fontSize="small" />
              </ListItemIcon>
              <ListItemText>Rename Part</ListItemText>
            </MenuItem>,
            <MenuItem key="save-part" onClick={() => handleSavePart(contextMenu?.partId)} disabled={isLoading}>
              <ListItemIcon>
                <Save fontSize="small" />
              </ListItemIcon>
              <ListItemText>{isLoading ? 'Saving...' : 'Save Part'}</ListItemText>
            </MenuItem>,
            <MenuItem key="delete-part" onClick={() => handleDeletePart(contextMenu?.partId)}>
              <ListItemIcon>
                <Delete fontSize="small" />
              </ListItemIcon>
              <ListItemText>Delete Part</ListItemText>
            </MenuItem>,
            ...(selectedParts.length >= 2 ? [
              <MenuItem key="merge-selected-single" onClick={handleMergeSelectedParts}>
                <ListItemIcon>
                  <Merge fontSize="small" />
                </ListItemIcon>
                <ListItemText>Merge Selected Parts ({selectedParts.length})</ListItemText>
              </MenuItem>
            ] : [])
          ]}
       </Menu>
     </Box>
   );
 };
 
 export default PointCloudViewer;