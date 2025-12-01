import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Box, Button, Typography, Paper, Alert, CircularProgress, useTheme, FormControlLabel, Checkbox, FormControl, InputLabel, Select, MenuItem, IconButton, Slider, Dialog, DialogTitle, DialogContent, DialogActions, TextField, Menu, ListItemIcon, ListItemText, Divider, Tooltip} from '@mui/material';
import { tokens } from '../../theme';
import { Map, Close, Gesture, HistoryEdu, DeleteSweep, Edit, Save, Delete, Merge, Refresh, ExpandMore, Undo, Redo, HelpOutline } from '@mui/icons-material';
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

// Isolated Slider component - completely independent, doesn't trigger parent re-renders
const IsolatedSlider = React.memo(({ 
  initialValue,
  onValueChange, // Called during drag to update uniform (via ref, no re-render)
  onValueCommit, // Called on release to update parent state
  ...otherProps 
}) => {
  // Internal state for smooth dragging (isolated from parent)
  const [localValue, setLocalValue] = useState(initialValue);
  
  // Sync with initialValue when it changes externally (but not during drag)
  useEffect(() => {
    setLocalValue(initialValue);
  }, [initialValue]);
  
  const handleChange = useCallback((e, newValue) => {
    // Update local state for smooth slider movement (isolated re-render)
    setLocalValue(newValue);
    // Update uniform directly via callback (no parent re-render)
    onValueChange?.(newValue);
  }, [onValueChange]);
  
  const handleCommit = useCallback((e, newValue) => {
    // Update parent state only on release (triggers parent re-render for persistence)
    onValueCommit?.(newValue);
  }, [onValueCommit]);
  
  return (
    <Slider
      value={localValue}
      onChange={handleChange}
      onChangeCommitted={handleCommit}
      {...otherProps}
    />
  );
}, (prevProps, nextProps) => {
  // Only re-render if initialValue changes (not during drag)
  return prevProps.initialValue === nextProps.initialValue &&
         prevProps.onValueChange === nextProps.onValueChange &&
         prevProps.onValueCommit === nextProps.onValueCommit;
});

IsolatedSlider.displayName = 'IsolatedSlider';

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
  const [originalFileOffsets, setOriginalFileOffsets] = useState({ xOffset: 0, yOffset: 0, zOffset: 0, xScale: 0.01, yScale: 0.01, zScale: 0.01 });
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
  const [pointSize, setPointSize] = useState(5.0); // State for the slider value (only updated on release)
  const [pointDensity, setPointDensity] = useState(1.0); // 0..1 density control (only updated on release)
  const pointCloudRef = useRef(null); // Store pointCloud reference to update uniforms directly
  
  // --- Multi-selection and Context Menu State ---
  const [selectedParts, setSelectedParts] = useState([]);
  const [contextMenu, setContextMenu] = useState(null);
  
  // --- Annotation State ---
  const [selectedAnnotationType, setSelectedAnnotationType] = useState('classification');
  const [selectedAnnotationValue, setSelectedAnnotationValue] = useState(null);
  const [isAnnotating, setIsAnnotating] = useState(false);
  const [annotationDialogOpen, setAnnotationDialogOpen] = useState(false);
  const [annotationHelpDialogOpen, setAnnotationHelpDialogOpen] = useState(false);
  const [selectionHelpDialogOpen, setSelectionHelpDialogOpen] = useState(false);
  const [partListHelpDialogOpen, setPartListHelpDialogOpen] = useState(false);
  const [splitWarningDialogOpen, setSplitWarningDialogOpen] = useState(false);
  const [pendingSplitType, setPendingSplitType] = useState(null); // 'classification' or 'treeID'
  const [lastConfirmedSplit, setLastConfirmedSplit] = useState(null); // 'classification' or 'treeID' or null
  const [pendingMiniMapTreeID, setPendingMiniMapTreeID] = useState(null); // treeID value from minimap click
  
  // --- Rename State ---
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renamePartId, setRenamePartId] = useState(null);
  const [newPartName, setNewPartName] = useState('');
  
  // --- Save Dialog State ---
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [savePartId, setSavePartId] = useState(null);
  const [saveFileName, setSaveFileName] = useState('');
  
  // --- File Information Expand/Collapse State ---
  const [fileInfoExpanded, setFileInfoExpanded] = useState(true);
  const [annotationSelectionExpanded, setAnnotationSelectionExpanded] = useState(true);
  const [toolsControlsExpanded, setToolsControlsExpanded] = useState(true);
  
  // --- User Role State ---
  const [userRole, setUserRole] = useState(() => {
    return localStorage.getItem('userRole') || null;
  });
  
  // --- Undo/Redo State ---
  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const maxHistorySize = 50;
  const isRestoringRef = useRef(false);
  const shouldSaveHistoryRef = useRef(false);

  // Store pointCloud in ref for direct access without re-renders
  useEffect(() => {
    pointCloudRef.current = pointCloud;
  }, [pointCloud]);

  // This effect updates the shader when the slider value changes (only on release)
  useEffect(() => {
    if (pointCloud && pointCloud.material) {
      pointCloud.material.uniforms.u_pointSize.value = pointSize;
    }
  }, [pointSize, pointCloud]);

  // Update density uniform when changed (only on release)
  useEffect(() => {
    if (pointCloud && pointCloud.material && pointCloud.material.uniforms.u_density) {
      pointCloud.material.uniforms.u_density.value = pointDensity;
    }
  }, [pointDensity, pointCloud]);

  // Callbacks for Point Size slider - update uniform directly (no parent re-render)
  const handlePointSizeChange = useCallback((newValue) => {
    // Update uniform immediately via ref (no re-render, smooth visual update)
    if (pointCloudRef.current && pointCloudRef.current.material) {
      pointCloudRef.current.material.uniforms.u_pointSize.value = newValue;
    }
  }, []);

  const handlePointSizeCommit = useCallback((newValue) => {
    // Update parent state only when user releases mouse (triggers re-render for persistence)
    setPointSize(newValue);
  }, []);

  // Callbacks for Point Density slider - update uniform directly (no parent re-render)
  const handlePointDensityChange = useCallback((v) => {
    // Update uniform immediately via ref (no re-render, smooth visual update)
    if (pointCloudRef.current && pointCloudRef.current.material && pointCloudRef.current.material.uniforms.u_density) {
      pointCloudRef.current.material.uniforms.u_density.value = v;
    }
  }, []);

  const handlePointDensityCommit = useCallback((v) => {
    // Update parent state only when user releases mouse (triggers re-render for persistence)
    setPointDensity(v);
  }, []);

  // Memoized slider styles to prevent re-creation on every render
  const sliderSx = useMemo(() => ({ color: colors.greenAccent[500] }), [colors.greenAccent]);

  // --- MiniMap State ---
  const [showMiniMap, setShowMiniMap] = useState(true);
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

  const defaultViewRef = useRef(null);

  const handleToolSelect = (toolName) => {
    setActiveTool(prev => (prev === toolName ? null : toolName));
  };

  // Create function instances with state setters
  const handlePartClickInstance = handlePartClick(setActivePartId, activePartId);
  const handleTogglePartVisibilityBase = handleTogglePartVisibility(setParts);
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
    
    // Use original file's scale factors and offsets to preserve coordinate system
    // This ensures saved parts maintain the same coordinate reference as the original file
    const scaleX = originalFileOffsets.xScale || 0.01;
    const scaleY = originalFileOffsets.yScale || 0.01;
    const scaleZ = originalFileOffsets.zScale || 0.01;
    // Use original file's offsets instead of part's minX/minY/minZ
    // This preserves the absolute coordinate system, allowing backend to correctly read file location
    const offsetX = originalFileOffsets.xOffset || 0;
    const offsetY = originalFileOffsets.yOffset || 0;
    const offsetZ = originalFileOffsets.zOffset || 0;
    
    // Debug: Log coordinate conversion info
    if (pointCount > 0) {
      const firstPointX = positions[0];
      const firstPointY = positions[1];
      const firstPointZ = positions[2];
      const firstPointXInt = Math.round((firstPointX - offsetX) / scaleX);
      const firstPointYInt = Math.round((firstPointY - offsetY) / scaleY);
      const firstPointZInt = Math.round((firstPointZ - offsetZ) / scaleZ);
      const reconstructedX = firstPointXInt * scaleX + offsetX;
      const reconstructedY = firstPointYInt * scaleY + offsetY;
      const reconstructedZ = firstPointZInt * scaleZ + offsetZ;
      console.log(`[Save] Part "${partName}": First point absolute coords: (${firstPointX.toFixed(3)}, ${firstPointY.toFixed(3)}, ${firstPointZ.toFixed(3)})`);
      console.log(`[Save] Using offsets: (${offsetX.toFixed(3)}, ${offsetY.toFixed(3)}, ${offsetZ.toFixed(3)}), scales: (${scaleX}, ${scaleY}, ${scaleZ})`);
      console.log(`[Save] First point relative ints: (${firstPointXInt}, ${firstPointYInt}, ${firstPointZInt})`);
      console.log(`[Save] Reconstructed from ints: (${reconstructedX.toFixed(3)}, ${reconstructedY.toFixed(3)}, ${reconstructedZ.toFixed(3)})`);
    }
    
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
      // Use classificationColor (current) if available, otherwise fall back to originalClassification or display colors
      const classificationColors = geometry.attributes.classificationColor?.array;
      const originalClassification = geometry.attributes.originalClassification?.array;
      let r, g, b;
      if (classificationColors) {
        r = classificationColors[posIndex];
        g = classificationColors[posIndex + 1];
        b = classificationColors[posIndex + 2];
      } else if (originalClassification) {
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
    
    // Always apply filter mode colors to respect the current filter mode
    // This ensures that when parts are created (e.g., via lasso tool), they show the correct colors
    if (filterMode === 'treeID' && treeIDAttribute) {
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
      // Apply classification colors - use classificationColor first (current), then originalClassification (original) as fallback
      let classificationArray = null;
      if (classificationColorAttribute) {
        // Use classificationColor for current classification colors (after annotation)
        classificationArray = classificationColorAttribute.array;
      } else if (originalClassificationAttribute) {
        // Fallback to originalClassification if classificationColor doesn't exist
        classificationArray = originalClassificationAttribute.array;
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

  // Helper function to create a state snapshot for undo/redo (defined early for use in lasso handler)
  const createStateSnapshot = useCallback(() => {
    if (!originalGeometry) return null;
    
    // Helper to deep clone a geometry with all its attributes
    const deepCloneGeometry = (geometry) => {
      if (!geometry) return null;
      const cloned = geometry.clone();
      
      // Deep clone all attributes to avoid reference issues
      Object.keys(geometry.attributes).forEach(key => {
        const attr = geometry.attributes[key];
        if (attr && attr.array) {
          // Create a new array with copied values
          const clonedArray = new attr.array.constructor(attr.array);
          cloned.setAttribute(key, new THREE.BufferAttribute(clonedArray, attr.itemSize));
        }
      });
      
      return cloned;
    };
    
    // Clone geometries for all parts with deep cloning
    const partsSnapshot = parts.map(part => ({
      ...part,
      geometry: part.geometry ? deepCloneGeometry(part.geometry) : null
    }));
    
    // Deep clone original geometry
    const originalGeometrySnapshot = deepCloneGeometry(originalGeometry);
    
    // Deep clone treeIDs
    const treeIDsSnapshot = JSON.parse(JSON.stringify(treeIDs));
    
    // Deep clone treeIDData array
    const treeIDDataSnapshot = treeIDData ? [...treeIDData] : null;
    
    return {
      parts: partsSnapshot,
      originalGeometry: originalGeometrySnapshot,
      treeIDs: treeIDsSnapshot,
      treeIDData: treeIDDataSnapshot
    };
  }, [parts, originalGeometry, treeIDs, treeIDData]);

  // Wrapper to save history before toggling visibility (defined after createStateSnapshot)
  const handleTogglePartVisibilityInstance = useCallback((partId) => {
    // Save state BEFORE the action (if first time, this becomes the initial state)
    if (history.length === 0) {
      const beforeSnapshot = createStateSnapshot();
      if (beforeSnapshot) {
        setHistory([beforeSnapshot]);
        setHistoryIndex(0);
      }
    }
    shouldSaveHistoryRef.current = true;
    handleTogglePartVisibilityBase(partId);
  }, [handleTogglePartVisibilityBase, createStateSnapshot, history.length]);

  // Delete and merge handlers (defined after createStateSnapshot)
  const handleDeletePart = useCallback((partId) => {
    // Save state BEFORE the action (if first time, this becomes the initial state)
    if (history.length === 0) {
      const beforeSnapshot = createStateSnapshot();
      if (beforeSnapshot) {
        setHistory([beforeSnapshot]);
        setHistoryIndex(0);
      }
    }
    shouldSaveHistoryRef.current = true;
    deletePartInstance(partId);
    setSelectedParts(prev => prev.filter(id => id !== partId));
    handleCloseContextMenu();
  }, [createStateSnapshot, history.length, deletePartInstance, setSelectedParts]);

  const handleDeleteSelectedParts = useCallback(() => {
    // Save state BEFORE the action (if first time, this becomes the initial state)
    if (history.length === 0) {
      const beforeSnapshot = createStateSnapshot();
      if (beforeSnapshot) {
        setHistory([beforeSnapshot]);
        setHistoryIndex(0);
      }
    }
    shouldSaveHistoryRef.current = true;
    selectedParts.forEach(partId => {
      deletePartInstance(partId);
    });
    setSelectedParts([]);
    handleCloseContextMenu();
  }, [createStateSnapshot, history.length, selectedParts, deletePartInstance, setSelectedParts]);

  const handleMergeSelectedParts = useCallback(() => {
    if (selectedParts.length >= 2) {
      // Save state BEFORE the action (if first time, this becomes the initial state)
      if (history.length === 0) {
        const beforeSnapshot = createStateSnapshot();
        if (beforeSnapshot) {
          setHistory([beforeSnapshot]);
          setHistoryIndex(0);
        }
      }
      shouldSaveHistoryRef.current = true;
      mergePartsInstance(selectedParts);
      setSelectedParts([]);
    }
    handleCloseContextMenu();
  }, [createStateSnapshot, history.length, selectedParts, mergePartsInstance, setSelectedParts]);

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
           // Save state BEFORE the action (if first time, this becomes the initial state)
           if (history.length === 0) {
             const beforeSnapshot = createStateSnapshot();
             if (beforeSnapshot) {
               setHistory([beforeSnapshot]);
               setHistoryIndex(0);
             }
           }
           
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
               
               // Mark that we should save to history after lasso selection
               shouldSaveHistoryRef.current = true;
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
  }, [activeTool, pointCloud, parts, selectedParts, originalGeometry, createStateSnapshot, history.length]);


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

  const handleResetView = useCallback(() => {
    if (!sceneManagerRef.current) return;

    const camera = sceneManagerRef.current.camera;
    const controls = sceneManagerRef.current.controls;
    const defaultView = defaultViewRef.current;

    if (defaultView && pointCloud) {
      camera.position.copy(defaultView.cameraPosition);
      camera.quaternion.copy(defaultView.cameraQuaternion);
      camera.up.copy(defaultView.cameraUp);
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld(true);

      pointCloud.position.copy(defaultView.pointCloudPosition);
      pointCloud.quaternion.copy(defaultView.pointCloudQuaternion);
      pointCloud.rotation.setFromQuaternion(pointCloud.quaternion);
      pointCloud.updateMatrixWorld(true);

      minDistanceRef.current = defaultView.minDistance;
      maxDistanceRef.current = defaultView.maxDistance;

      if (controls) {
        controls.setDistanceBounds(minDistanceRef.current, maxDistanceRef.current);
      }
      return;
    }

    if (originalGeometry) {
      if (!originalGeometry.boundingSphere) {
        originalGeometry.computeBoundingSphere();
      }
      const distanceBounds = sceneManagerRef.current.setCameraTopView(originalGeometry);
      if (distanceBounds) {
        minDistanceRef.current = distanceBounds.minDistance;
        maxDistanceRef.current = distanceBounds.maxDistance;
        if (controls) {
          controls.setDistanceBounds(minDistanceRef.current, maxDistanceRef.current);
        }
      }
    }
  }, [pointCloud, originalGeometry]);

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
      const { points, colors, treeIDs, xOffset, yOffset, zOffset, xScale, yScale, zScale } = await parseLASFile(file);
      // Store original file's coordinate offsets and scales for use when saving parts
      if (xOffset !== undefined && yOffset !== undefined && zOffset !== undefined) {
        setOriginalFileOffsets({ xOffset, yOffset, zOffset, xScale: xScale || 0.01, yScale: yScale || 0.01, zScale: zScale || 0.01 });
      }
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
          defaultViewRef.current = null;
            
            // Clear parts state to prevent conflicts
            setParts([]);
            setSelectedParts([]);
            setActivePartId(null);
            
            // Reset undo/redo history when loading new file
            setHistory([]);
            setHistoryIndex(-1);
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

          defaultViewRef.current = {
            cameraPosition: sceneManagerRef.current.camera.position.clone(),
            cameraQuaternion: sceneManagerRef.current.camera.quaternion.clone(),
            cameraUp: sceneManagerRef.current.camera.up.clone(),
            pointCloudPosition: newPointCloud.position.clone(),
            pointCloudQuaternion: newPointCloud.quaternion.clone(),
            minDistance: distanceBounds.minDistance,
            maxDistance: distanceBounds.maxDistance,
          };
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

  const performSplitByClassification = () => {
    if (!pointCloud || !originalGeometry) return;
    
    const newParts = [];
    
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
    
    if (newParts.length > 0) {
      setParts(newParts);
      setSelectedParts([]); // Clear selection after splitting
    }
  };

  const performSplitByTreeID = () => {
    if (!pointCloud || !originalGeometry || !treeIDData) return;
    
    // Split by treeID - create a custom filter for each treeID
    // Sort entries: Unclassified first, then regular treeIDs
    const sortedEntries = Object.entries(treeIDs).sort(([idA, treeIDA], [idB, treeIDB]) => {
      const numA = parseInt(idA);
      const numB = parseInt(idB);
      
      // -1 is always the unclassified ID
      const aIsUnclassified = numA === -1;
      const bIsUnclassified = numB === -1;
      
      // Unclassified goes to the very first position
      if (aIsUnclassified && !bIsUnclassified) return -1;
      if (!aIsUnclassified && bIsUnclassified) return 1;
      
      // Both are regular treeIDs: sort numerically
      return numA - numB;
    });
    
    // OPTIMIZATION: For large numbers of treeIDs, process in batches to avoid blocking UI
    const BATCH_SIZE = 50; // Process 50 treeIDs at a time
    const totalEntries = sortedEntries.length;
    const newParts = []; // Shared across batches
    
    const processBatch = (startIndex) => {
      const endIndex = Math.min(startIndex + BATCH_SIZE, totalEntries);
      
      for (let i = startIndex; i < endIndex; i++) {
        const [id, treeID] = sortedEntries[i];
        const filteredGeometry = filterPointCloudBySingleTreeID(originalGeometry, id, treeID, treeIDData);
        if (filteredGeometry && filteredGeometry.attributes && filteredGeometry.attributes.position && filteredGeometry.attributes.position.count > 0) {
          newParts.push({
            id: Date.now() + Math.random() + i, // Ensure unique IDs
            name: treeID.name,
            geometry: filteredGeometry,
            visible: true,
            type: 'treeID',
            treeIDId: id
          });
        }
      }
      
      // If more entries to process, continue in next frame
      if (endIndex < totalEntries) {
        requestAnimationFrame(() => processBatch(endIndex));
      } else {
        // All done, update state
        if (newParts.length > 0) {
          setParts(newParts);
          setSelectedParts([]); // Clear selection after splitting
        }
      }
    };
    
    // Start processing
    if (totalEntries > BATCH_SIZE) {
      // For large datasets, process in batches
      processBatch(0);
    } else {
      // For small datasets, process all at once
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
      
      if (newParts.length > 0) {
        setParts(newParts);
        setSelectedParts([]); // Clear selection after splitting
      }
    }
  };

  const handleSplitByClassification = () => {
    if (parts.length > 0) {
      setPendingSplitType('classification');
      setSplitWarningDialogOpen(true);
    } else {
      performSplitByClassification();
      setLastConfirmedSplit('classification');
    }
  };

  const handleSplitByTreeID = () => {
    // PERFORMANCE CHECK: Warn if too many treeIDs
    const treeIDCount = Object.keys(treeIDs).length;
    const PERFORMANCE_THRESHOLD = 1000; // Warn if more than 1000 treeIDs
    
    if (treeIDCount > PERFORMANCE_THRESHOLD) {
      const proceed = window.confirm(
        `Warning: You have ${treeIDCount} tree IDs. Creating parts for all of them may cause performance issues and could freeze the browser.\n\n` +
        `Consider using the Tree ID filter mode instead of splitting.\n\n` +
        `Do you want to continue anyway?`
      );
      if (!proceed) {
        return;
      }
    }
    
    if (parts.length > 0) {
      setPendingSplitType('treeID');
      setSplitWarningDialogOpen(true);
    } else {
      performSplitByTreeID();
      setLastConfirmedSplit('treeID');
    }
  };

  const handleConfirmSplit = () => {
    setSplitWarningDialogOpen(false);
    const splitType = pendingSplitType;
    setPendingSplitType(null);
    
    if (splitType === 'classification') {
      setFilterMode('classification');
      performSplitByClassification();
      setLastConfirmedSplit('classification');
    } else if (splitType === 'treeID') {
      setFilterMode('treeID');
      performSplitByTreeID();
      setLastConfirmedSplit('treeID');
    } else if (splitType === 'minimap' && pendingMiniMapTreeID !== null) {
      setFilterMode('treeID');
      const treeIDValue = pendingMiniMapTreeID;
      setPendingMiniMapTreeID(null);
      performTreeIDSelectFromMiniMap(treeIDValue);
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

  // Perform treeID selection from minimap (actual implementation)
  const performTreeIDSelectFromMiniMap = (treeIDValue) => {
    if (!treeIDData || !originalGeometry) return;
    
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
      
      // Select the clicked part in the point cloud list
      if (clickedPart) {
        setSelectedParts([clickedPart.id]);
        setActivePartId(clickedPart.id);
      }
    } else {
      // Need to split by treeID first - show only the clicked treeID
      const newParts = [];
      
      // Sort entries: Unclassified first, then regular treeIDs
      const sortedEntries = Object.entries(treeIDs).sort(([idA, treeIDA], [idB, treeIDB]) => {
        const numA = parseInt(idA);
        const numB = parseInt(idB);
        const aIsUnclassified = numA === -1;
        const bIsUnclassified = numB === -1;
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
        
        // Find and select the clicked treeID part
        const clickedPart = newParts.find(part => part.treeIDId === treeIDString);
        if (clickedPart) {
          setSelectedParts([clickedPart.id]);
          setActivePartId(clickedPart.id);
        } else {
          setSelectedParts([]);
        }
        
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
        setLastConfirmedSplit('treeID'); // Update split type after minimap click
      }
    }
  };

  // Handler for treeID selection from minimap
  const handleTreeIDSelectFromMiniMap = (treeIDValue) => {
    if (!treeIDData || !originalGeometry) return;
    
    // Check if currently split by classification - show warning
    if (lastConfirmedSplit === 'classification') {
      setPendingMiniMapTreeID(treeIDValue);
      setPendingSplitType('minimap'); // Special type for minimap
      setSplitWarningDialogOpen(true);
    } else {
      performTreeIDSelectFromMiniMap(treeIDValue);
    }
  };


  // Create annotation function instances with state setters
  const handleAnnotationTypeChangeInstance = handleAnnotationTypeChange(setSelectedAnnotationType, setSelectedAnnotationValue);
  const handleAnnotationValueSelectInstance = handleAnnotationValueSelect(setSelectedAnnotationValue);
  const annotateAllVisiblePointsBase = annotateAllVisiblePoints(setIsAnnotating, setAnnotationDialogOpen, selectedAnnotationValue, selectedAnnotationType, classifications, treeIDs, pointCloud, parts, selectedParts, originalGeometry, combineVisiblePartsInstance, setTreeIDs, setTreeIDData, treeIDData, setParts);
  
  // Wrapper to mark that annotation was applied for undo/redo
  const annotateAllVisiblePointsInstance = useCallback(() => {
    // Save state BEFORE the action (if first time, this becomes the initial state)
    if (history.length === 0) {
      const beforeSnapshot = createStateSnapshot();
      if (beforeSnapshot) {
        setHistory([beforeSnapshot]);
        setHistoryIndex(0);
      }
    }
    shouldSaveHistoryRef.current = true;
    annotateAllVisiblePointsBase();
  }, [annotateAllVisiblePointsBase, createStateSnapshot, history.length]);
  
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

  // Helper function to check if a part has multiple colors
  const hasMultipleColors = (part) => {
    if (part.type === 'classification' && part.classificationId) {
      // Classification parts have a single color
      return false;
    } else if (part.type === 'treeID' && part.treeIDId) {
      // TreeID parts have a single color
      return false;
    } else if (part.geometry && part.geometry.attributes && part.geometry.attributes.color) {
      // Check if all colors in the geometry are the same
      const colors = part.geometry.attributes.color.array;
      if (colors.length < 6) return false; // Need at least 2 points to compare
      
      const firstR = colors[0];
      const firstG = colors[1];
      const firstB = colors[2];
      
      // Check if any point has a different color (with small tolerance for floating point)
      const tolerance = 0.01;
      for (let i = 3; i < colors.length; i += 3) {
        if (Math.abs(colors[i] - firstR) > tolerance ||
            Math.abs(colors[i + 1] - firstG) > tolerance ||
            Math.abs(colors[i + 2] - firstB) > tolerance) {
          return true; // Found different color
        }
      }
      return false; // All colors are the same
    }
    return false; // Can't determine, assume single color
  };

  // Helper function to get the color for a part
  const getPartColor = (part) => {
    if (part.type === 'classification' && part.classificationId && classifications[part.classificationId]) {
      const color = classifications[part.classificationId].color;
      return `rgb(${color.map(c => Math.round(c * 255)).join(',')})`;
    } else if (part.type === 'treeID' && part.treeIDId && treeIDs[part.treeIDId]) {
      const color = treeIDs[part.treeIDId].color;
      return `rgb(${color.map(c => Math.round(c * 255)).join(',')})`;
    } else if (part.geometry && part.geometry.attributes && part.geometry.attributes.color) {
      // For other types, try to get average color from geometry
      const colors = part.geometry.attributes.color.array;
      if (colors.length >= 3) {
        // Get average color from first few points
        let r = 0, g = 0, b = 0;
        const sampleSize = Math.min(100, colors.length / 3);
        for (let i = 0; i < sampleSize; i++) {
          r += colors[i * 3];
          g += colors[i * 3 + 1];
          b += colors[i * 3 + 2];
        }
        r = Math.round((r / sampleSize) * 255);
        g = Math.round((g / sampleSize) * 255);
        b = Math.round((b / sampleSize) * 255);
        return `rgb(${r},${g},${b})`;
      }
    }
    // Default gray color
    return 'rgb(128,128,128)';
  };

  // Helper function to restore state from snapshot
  const restoreStateSnapshot = useCallback((snapshot) => {
    if (!snapshot) return;
    
    isRestoringRef.current = true;
    
    // Restore parts
    setParts(snapshot.parts);
    
    // Restore original geometry
    if (snapshot.originalGeometry) {
      setOriginalGeometry(snapshot.originalGeometry);
    }
    
    // Restore treeIDs
    setTreeIDs(snapshot.treeIDs);
    
    // Restore treeIDData
    if (snapshot.treeIDData) {
      setTreeIDData(snapshot.treeIDData);
    }
    
    // Reset flag after a short delay to allow state updates to complete
    setTimeout(() => {
      isRestoringRef.current = false;
    }, 100);
  }, []);

  // Save state to history (saves state AFTER an action)
  const saveToHistory = useCallback(() => {
    const snapshot = createStateSnapshot();
    if (!snapshot) return;
    
    setHistory(prev => {
      // Remove any history after current index (when undoing and then making new changes)
      const newHistory = prev.slice(0, historyIndex + 1);
      // Add new snapshot (state after action)
      newHistory.push(snapshot);
      // Limit history size
      if (newHistory.length > maxHistorySize) {
        return newHistory.slice(-maxHistorySize);
      }
      return newHistory;
    });
    setHistoryIndex(prev => {
      const newIndex = Math.min(prev + 1, maxHistorySize - 1);
      return newIndex;
    });
  }, [createStateSnapshot, historyIndex]);

  // Undo function
  const handleUndo = useCallback(() => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      restoreStateSnapshot(history[newIndex]);
    }
  }, [history, historyIndex, restoreStateSnapshot]);

  // Redo function
  const handleRedo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1;
      setHistoryIndex(newIndex);
      restoreStateSnapshot(history[newIndex]);
    }
  }, [history, historyIndex, restoreStateSnapshot]);

  // Check if undo is available (for lasso/annotation/checkbox/delete/merge actions)
  // Only enable if we have history beyond the initial state
  const canUndo = historyIndex > 0 && history.length > 1;
  
  // Check if redo is available (for lasso/annotation/checkbox/delete/merge actions)
  const canRedo = historyIndex < history.length - 1 && history.length > 1;

  // Keyboard shortcuts for undo/redo (Ctrl+Z / Ctrl+Y or Ctrl+Shift+Z)
  useEffect(() => {
    const handleKeyDown = (event) => {
      const isModifierPressed = event.ctrlKey || event.metaKey;
      if (!isModifierPressed) return;

      const activeElement = document.activeElement;
      if (activeElement && ['INPUT', 'TEXTAREA'].includes(activeElement.tagName)) return;
      if (activeElement && activeElement.isContentEditable) return;

      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey && canUndo) {
        event.preventDefault();
        handleUndo();
      } else if ((key === 'y' || (key === 'z' && event.shiftKey)) && canRedo) {
        event.preventDefault();
        handleRedo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleUndo, handleRedo, canUndo, canRedo]);

  // Track lasso selection completion for undo/redo
  useEffect(() => {
    if (isRestoringRef.current || !originalGeometry) return;
    
    // Save to history after lasso selection creates parts
    if (shouldSaveHistoryRef.current && !isProcessingLasso) {
      shouldSaveHistoryRef.current = false;
      const timeoutId = setTimeout(() => {
        if (!isRestoringRef.current) {
          saveToHistory();
        }
      }, 100);
      
      return () => clearTimeout(timeoutId);
    }
  }, [isProcessingLasso, saveToHistory, originalGeometry]);

  // Track annotation completion for undo/redo
  useEffect(() => {
    if (isRestoringRef.current || !originalGeometry) return;
    
    // When annotation completes (isAnnotating goes from true to false)
    if (!isAnnotating && shouldSaveHistoryRef.current) {
      // Wait a bit longer to ensure all state updates (including treeIDData) are complete
      const timeoutId = setTimeout(() => {
        if (!isRestoringRef.current && shouldSaveHistoryRef.current) {
          shouldSaveHistoryRef.current = false;
          saveToHistory();
        }
      }, 300);
      
      return () => clearTimeout(timeoutId);
    }
  }, [isAnnotating, saveToHistory, originalGeometry, treeIDData]);

  // Track checkbox visibility changes, delete, and merge for undo/redo
  useEffect(() => {
    if (isRestoringRef.current || !originalGeometry) return;
    
    // Save to history after visibility checkbox changes, delete, or merge
    if (shouldSaveHistoryRef.current) {
      // Use a debounce to batch rapid changes
      const timeoutId = setTimeout(() => {
        if (!isRestoringRef.current && shouldSaveHistoryRef.current) {
          shouldSaveHistoryRef.current = false;
          saveToHistory();
        }
      }, 200);
      
      return () => clearTimeout(timeoutId);
    }
  }, [parts, saveToHistory, originalGeometry]);

  // Initialize history when originalGeometry is first loaded
  // Don't initialize automatically - only save when lasso/annotation/checkbox/delete/merge actions occur
  // This ensures undo/redo is only available for those specific actions

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
                        <Box 
                            sx={{ 
                                position: 'relative',
                                mb: fileInfoExpanded ? 1 : 0,
                                cursor: 'pointer',
                                '&:hover': { opacity: 0.8 }
                            }}
                            onClick={() => setFileInfoExpanded(!fileInfoExpanded)}
                        >
                            <Typography variant="subtitle1" sx={{ color: colors.grey[100], fontWeight: 'bold', pr: 3 }}>File Information</Typography>
                            <ExpandMore 
                                sx={{ 
                                    position: 'absolute',
                                    right: 0,
                                    top: '50%',
                                    transform: fileInfoExpanded 
                                        ? 'translateY(-50%) rotate(180deg)' 
                                        : 'translateY(-50%) rotate(0deg)',
                                    color: colors.grey[300],
                                    transition: 'transform 0.2s ease-in-out'
                                }}
                            />
                        </Box>
                        {fileInfoExpanded && (
                            <Box>
                                <Typography variant="body2" sx={{ color: colors.grey[200], mb: 0.5 }}>File Name: <span style={{color: colors.grey[300]}}>{fileInfo.name || selectedFile.name}</span></Typography>
                                <Typography variant="body2" sx={{ color: colors.grey[200], mb: 0.5 }}>Plot: <span style={{color: colors.grey[300]}}>{fileInfo.plot_name || 'N/A'}</span></Typography>
                                <Typography variant="body2" sx={{ color: colors.grey[200], mb: 0.5 }}>Division: <span style={{color: colors.grey[300]}}>{fileInfo.divisionName || 'N/A'}</span></Typography>
                                <Typography variant="body2" sx={{ color: colors.grey[200] }}>Project: <span style={{color: colors.grey[300]}}>{fileInfo.projectName || 'N/A'}</span></Typography>
                            </Box>
                        )}
                    </Box>
                )}

                {isLoading && (
                  <Box sx={styles.loadingContainer}>
                    <CircularProgress size={18}/>
                    <Typography variant="body2" sx={styles.loadingText}>Loading...</Typography>
                  </Box>
                )}

                {/* --- Colour Mode --- */}
                {pointCloud && (
                  <FormControl fullWidth size="small" sx={styles.filterModeSelect}>
                    <InputLabel>Colour Mode</InputLabel>
                    <Select value={filterMode} label="Colour Mode" onChange={(e) => setFilterMode(e.target.value)}>
                      <MenuItem value="classification">Classification</MenuItem>
                      <MenuItem value="treeID">Tree ID</MenuItem>
                    </Select>
                  </FormControl>
                )}

                {/* --- Split Point Cloud --- */}
                {pointCloud && (
                  <Box sx={{ mt: 2 }}>
                    <Typography variant="body2" sx={{ color: colors.grey[300], mb: 1, textAlign: 'center', fontWeight: 'bold' }}>
                      Split Point Cloud
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 1 }}>
                      <Button
                        variant="contained"
                        onClick={handleSplitByClassification}
                        disabled={lastConfirmedSplit === 'classification'}
                        fullWidth
                        sx={{ 
                          backgroundColor: colors.greenAccent[700],
                          color: colors.grey[100],
                          '&:hover': { backgroundColor: colors.greenAccent[600] },
                          '&:disabled': {
                            backgroundColor: colors.grey[700],
                            color: colors.grey[500]
                          }
                        }}
                      >
                        Split by Classification
                      </Button>
                      <Button
                        variant="contained"
                        onClick={handleSplitByTreeID}
                        disabled={!treeIDData || lastConfirmedSplit === 'treeID'}
                        fullWidth
                        sx={{ 
                          backgroundColor: colors.greenAccent[700],
                          color: colors.grey[100],
                          whiteSpace: 'pre-line',
                          '&:hover': { backgroundColor: colors.greenAccent[600] },
                          '&:disabled': {
                            backgroundColor: colors.grey[700],
                            color: colors.grey[500]
                          }
                        }}
                      >
                        Split by{'\n'}Tree ID
                      </Button>
                    </Box>
                  </Box>
                )}

                {/* --- Point Cloud Parts --- */}
                {pointCloud && (
                  <Box sx={styles.annotationListSection}>
                     <Box sx={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', mb:1 }}>
                       <Typography sx={{...styles.annotationTitle, flex: 1, borderBottom: 'none', textAlign: 'center'}}>Point Cloud</Typography>
                       <IconButton
                         onClick={() => setPartListHelpDialogOpen(true)}
                         size="small"
                         sx={{
                           position: 'absolute',
                           right: 0,
                           bottom: '20%',
                           color: colors.grey[400],
                           '&:hover': {
                             color: colors.greenAccent[400],
                             backgroundColor: 'rgba(0,0,0,0.1)',
                           },
                         }}
                         title="How to manage parts"
                       >
                         <HelpOutline fontSize="small" />
                       </IconButton>
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
                                // Save state BEFORE the action (if first time, this becomes the initial state)
                                if (history.length === 0) {
                                  const beforeSnapshot = createStateSnapshot();
                                  if (beforeSnapshot) {
                                    setHistory([beforeSnapshot]);
                                    setHistoryIndex(0);
                                  }
                                }
                                shouldSaveHistoryRef.current = true;
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
                      const partColor = getPartColor(part);
                      const showColor = !hasMultipleColors(part);
                      
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
                        onContextMenu={userRole !== 'Regular' ? (e) => handleContextMenu(e, part.id) : undefined}
                        title={userRole !== 'Regular' ? `Click to view this part. Ctrl+click for multi-selection. Right-click for options.` : `Click to view this part. Ctrl+click for multi-selection.`}
                      >
                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flex: 1 }}>
                            {showColor && (
                              <Box
                                sx={{
                                  width: 16,
                                  height: 16,
                                  backgroundColor: partColor,
                                  borderRadius: '2px',
                                  border: `1px solid ${colors.grey[600]}`,
                                  flexShrink: 0
                                }}
                              />
                            )}
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


                {/* --- Annotation & Selection Tools --- */}
                {pointCloud && userRole !== 'Regular' && (
                  <Box sx={styles.annotationSection}>
                    <Box 
                      sx={{ 
                        position: 'relative',
                        mb: annotationSelectionExpanded ? 1 : 0,
                        cursor: 'pointer',
                        '&:hover': { opacity: 0.8 }
                      }}
                      onClick={() => setAnnotationSelectionExpanded(!annotationSelectionExpanded)}
                    >
                      <Typography sx={{...styles.annotationTitle, pr: 3}}>Tools</Typography>
                      <ExpandMore 
                        sx={{ 
                          position: 'absolute',
                          right: 0,
                          top: '35%',
                          transform: annotationSelectionExpanded 
                            ? 'translateY(-50%) rotate(180deg)' 
                            : 'translateY(-50%) rotate(0deg)',
                          color: colors.grey[300],
                          transition: 'transform 0.2s ease-in-out'
                        }}
                      />
                    </Box>
                    
                    {annotationSelectionExpanded && (
                      <Box>
                        {/* Selection Tool */}
                        <Box sx={{ mt: 2 }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                            <Typography gutterBottom variant="body2" sx={{ color: colors.grey[300], mb: 0 }}>
                              Selection Tool
                            </Typography>
                            <IconButton
                              onClick={() => setSelectionHelpDialogOpen(true)}
                              size="small"
                              sx={{
                                color: colors.grey[400],
                                '&:hover': {
                                  color: colors.greenAccent[400],
                                  backgroundColor: 'rgba(0,0,0,0.1)',
                                },
                              }}
                              title="How to use Selection Tool"
                            >
                              <HelpOutline fontSize="small" />
                            </IconButton>
                          </Box>
                          {isProcessingLasso && (
                            <Box sx={styles.loadingContainer}>
                                <CircularProgress size={18}/>
                                <Typography sx={styles.loadingText}>Processing Selection...</Typography>
                            </Box>
                          )}
                          <Button
                            variant="contained"
                            onClick={() => handleToolSelect('lasso')}
                            disabled={isProcessingLasso}
                            fullWidth
                            sx={{
                              mb: 2,
                              backgroundColor: activeTool === 'lasso' ? colors.greenAccent[600] : colors.greenAccent[900],
                              color: colors.grey[100],
                              fontWeight: 'bold',
                              '&:hover': {
                                backgroundColor: activeTool === 'lasso' ? colors.greenAccent[600] : colors.greenAccent[600]
                              },
                              '&:disabled': {
                                opacity: 0.5,
                                backgroundColor: colors.grey[700]
                              }
                            }}
                            startIcon={<Gesture />}
                          >
                            Lasso Tool{activeTool === 'lasso' ? ' (activate)' : ''}
                          </Button>
                        </Box>
                        
                        {/* Annotation Tool */}
                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1, mt: 2 }}>
                          <Typography variant="body2" sx={{ color: colors.grey[300] }}>
                            Annotation Tool
                          </Typography>
                          <IconButton 
                            onClick={() => setAnnotationHelpDialogOpen(true)}
                            size="small"
                            sx={{ 
                              color: colors.grey[400],
                              '&:hover': { 
                                color: colors.greenAccent[400],
                                backgroundColor: 'rgba(0,0,0,0.1)'
                              }
                            }} 
                            title="How to use Annotation Tool"
                          >
                            <HelpOutline fontSize="small" />
                          </IconButton>
                        </Box>
                        <Button
                          variant="contained"
                          onClick={() => setAnnotationDialogOpen(true)}
                          disabled={isAnnotating || parts.length === 0 || selectedParts.length !== 1}
                          fullWidth
                          sx={{ 
                            mb: 2,
                            backgroundColor: colors.greenAccent[500],
                            color: colors.grey[100],
                            fontWeight: !isAnnotating && parts.length > 0 && selectedParts.length === 1 ? 'bold' : 'normal',
                            opacity: (parts.length === 0 || selectedParts.length !== 1) || isAnnotating ? 0.5 : 1,
                            '&:hover': {
                              backgroundColor: colors.greenAccent[600]
                            },
                            '&:disabled': {
                              opacity: 0.5,
                              backgroundColor: colors.grey[700],
                              color: colors.grey[500]
                            }
                          }}
                          startIcon={<Edit />}
                        >
                          Annotate Selected Part
                        </Button>
                        
                      </Box>
                    )}
                  </Box>
                )}

                {/* --- Combined Tools Container --- */}
                {pointCloud && (
                  <Box sx={styles.annotationSection}>
                    <Box 
                      sx={{ 
                        position: 'relative',
                        mb: toolsControlsExpanded ? 1 : 0,
                        cursor: 'pointer',
                        '&:hover': { opacity: 0.8 }
                      }}
                      onClick={() => setToolsControlsExpanded(!toolsControlsExpanded)}
                    >
                      <Typography sx={{...styles.annotationTitle, pr: 3}}>Display Settings</Typography>
                      <ExpandMore 
                        sx={{ 
                          position: 'absolute',
                          right: 0,
                          top: '35%',
                          transform: toolsControlsExpanded 
                            ? 'translateY(-50%) rotate(180deg)' 
                            : 'translateY(-50%) rotate(0deg)',
                          color: colors.grey[300],
                          transition: 'transform 0.2s ease-in-out'
                        }}
                      />
                    </Box>
                    
                    {toolsControlsExpanded && (
                      <Box>
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
                          <IsolatedSlider
                            initialValue={pointSize}
                            onValueChange={handlePointSizeChange}
                            onValueCommit={handlePointSizeCommit}
                            aria-labelledby="point-size-slider"
                            valueLabelDisplay="auto"
                            step={0.5}
                            min={1}
                            max={20}
                            sx={sliderSx}
                            disableRipple
                          />
                        </Box>

                        {/* Point Density */}
                        <Box sx={{ px: 1, mt: 2 }}>
                          <Typography gutterBottom variant="body2" sx={{ color: colors.grey[300] }}>
                            Point Density
                          </Typography>
                          <IsolatedSlider
                            initialValue={pointDensity}
                            onValueChange={handlePointDensityChange}
                            onValueCommit={handlePointDensityCommit}
                            aria-labelledby="point-density-slider"
                            valueLabelDisplay="auto"
                            step={0.05}
                            min={0.1}
                            max={1.0}
                            sx={sliderSx}
                            disableRipple
                          />
                        </Box>
                      </Box>
                    )}
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
          <Box sx={{ position: 'absolute', top: '15px', left: '315px', zIndex: 1002, display: 'flex', gap: '10px' }}>
            <Tooltip title={showMiniMap ? "Hide Mini Map" : "Show Mini Map"}>
              <IconButton onClick={toggleMiniMap} sx={{ backgroundColor: 'rgba(0,0,0,0.2)', color: 'white', '&:hover': {backgroundColor: 'rgba(0,0,0,0.4)'} }}>
                {showMiniMap ? <Close /> : <Map />}
              </IconButton>
            </Tooltip>
            <Tooltip title="Reset View">
              <IconButton onClick={handleResetView} sx={{ backgroundColor: 'rgba(0,0,0,0.2)', color: 'white', '&:hover': {backgroundColor: 'rgba(0,0,0,0.4)'} }}>
                <Refresh />
              </IconButton>
            </Tooltip>
            <Tooltip title={canUndo ? "Undo (Ctrl+Z)" : "Nothing to undo"}>
              <span>
                <IconButton 
                  onClick={handleUndo} 
                  disabled={!canUndo}
                  sx={{ 
                    backgroundColor: 'rgba(0,0,0,0.2)', 
                    color: canUndo ? 'white' : 'rgba(255,255,255,0.5)',
                    fontWeight: canUndo ? 'bold' : 'normal',
                    opacity: canUndo ? 1 : 0.5,
                    '&:hover': canUndo ? {backgroundColor: 'rgba(0,0,0,0.4)'} : {},
                    '&:disabled': {
                      color: 'rgba(255,255,255,0.5)',
                      opacity: 0.5
                    }
                  }}
                >
                  <Undo />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title={canRedo ? "Redo (Ctrl+Y)" : "Nothing to redo"}>
              <span>
                <IconButton 
                  onClick={handleRedo} 
                  disabled={!canRedo}
                  sx={{ 
                    backgroundColor: 'rgba(0,0,0,0.2)', 
                    color: canRedo ? 'white' : 'rgba(255,255,255,0.5)',
                    fontWeight: canRedo ? 'bold' : 'normal',
                    opacity: canRedo ? 1 : 0.5,
                    '&:hover': canRedo ? {backgroundColor: 'rgba(0,0,0,0.4)'} : {},
                    '&:disabled': {
                      color: 'rgba(255,255,255,0.5)',
                      opacity: 0.5
                    }
                  }}
                >
                  <Redo />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title={isAnnotating || parts.length === 0 || selectedParts.length !== 1 
              ? (parts.length === 0 ? "Select a part to annotate" : selectedParts.length === 0 ? "Select a part to annotate" : "Select exactly one part")
              : "Annotate Selected Part"}>
              <span>
                <IconButton 
                  onClick={() => setAnnotationDialogOpen(true)}
                  disabled={isAnnotating || parts.length === 0 || selectedParts.length !== 1}
                  sx={{ 
                    backgroundColor: 'rgba(0,0,0,0.2)', 
                    color: !isAnnotating && parts.length > 0 && selectedParts.length === 1 ? 'white' : 'rgba(255,255,255,0.5)',
                    fontWeight: !isAnnotating && parts.length > 0 && selectedParts.length === 1 ? 'bold' : 'normal',
                    '&:hover': !isAnnotating && parts.length > 0 && selectedParts.length === 1 ? {backgroundColor: 'rgba(0,0,0,0.4)'} : {},
                    '&:disabled': {
                      color: 'rgba(255,255,255,0.5)',
                      opacity: 1
                    }
                  }}
                >
                  <Edit />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title={isProcessingLasso ? "Processing selection..." : "Lasso Selection Tool"}>
              <span>
                <IconButton 
                  onClick={() => handleToolSelect('lasso')}
                  disabled={isProcessingLasso}
                  sx={{ 
                    backgroundColor: activeTool === 'lasso' ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.2)', 
                    color: activeTool === 'lasso' ? 'white' : 'rgba(255,255,255,0.6)',
                    fontWeight: activeTool === 'lasso' ? 'bold' : 'normal',
                    '&:hover': {backgroundColor: 'rgba(0,0,0,0.4)'},
                    '&:disabled': { 
                      color: 'rgba(255,255,255,0.5)',
                      opacity: 0.5
                    }
                  }}
                >
                  <Gesture />
                </IconButton>
              </span>
            </Tooltip>
          </Box>
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
              {selectedParts.length === 0 
                ? "Please select a part to annotate"
                : selectedParts.length === 1
                  ? <>This will annotate: <strong>{parts.find(p => p.id === selectedParts[0])?.name || 'Selected Part'}</strong></>
                  : <>This will annotate <strong>{selectedParts.length} selected parts</strong></>
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
              parts.length === 0 ||
              selectedParts.length === 0 ||
              (selectedAnnotationType === 'treeID' && (selectedAnnotationValue === '' || isNaN(parseInt(selectedAnnotationValue, 10)) || parseInt(selectedAnnotationValue, 10) < -2147483648 || parseInt(selectedAnnotationValue, 10) > 2147483647))
            }
            startIcon={<Save />}
          >
            {isAnnotating ? 'Applying...' : 'Apply Annotation'}
          </Button>
         </DialogActions>
       </Dialog>

       {/* Annotation Help Dialog */}
       <Dialog 
         open={annotationHelpDialogOpen} 
         onClose={() => setAnnotationHelpDialogOpen(false)}
         maxWidth="md"
         fullWidth
       >
         <DialogTitle>
           <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
             <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
               <HelpOutline sx={{ color: colors.greenAccent[500] }} />
               How to Use Annotation Tool
             </Box>
             <IconButton
               onClick={() => setAnnotationHelpDialogOpen(false)}
               sx={{
                 color: colors.grey[400],
                 '&:hover': {
                   color: colors.grey[200],
                   backgroundColor: 'rgba(0,0,0,0.1)'
                 }
               }}
               size="small"
             >
               <Close />
             </IconButton>
           </Box>
         </DialogTitle>
         <DialogContent>
           <Box sx={{ mt: 2 }}>
             <Typography variant="h6" sx={{ color: colors.grey[100], mb: 2, fontWeight: 'bold' }}>
               Overview
             </Typography>
             <Typography variant="body1" sx={{ color: colors.grey[300], mb: 3 }}>
               The Annotation Tool allows you to assign classification labels or Tree IDs to points in your point cloud. 
               You can annotate specific selected parts that you create using the Lasso Selection Tool.
             </Typography>

             <Typography variant="h6" sx={{ color: colors.grey[100], mb: 2, fontWeight: 'bold' }}>
               Step-by-Step Instructions
             </Typography>
             
             <Box sx={{ mb: 3 }}>
               <Typography variant="subtitle1" sx={{ color: colors.greenAccent[400], mb: 1, fontWeight: 'bold' }}>
                 1. Create and Select a Part
               </Typography>
              <Box sx={{ pl: 2, mb: 2 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1 }}>
                  <Typography variant="body2" sx={{ color: colors.grey[300] }}>
                    • Use the
                  </Typography>
                  <Gesture sx={{ fontSize: 16, color: colors.grey[300] }} />
                  <Typography variant="body2" sx={{ color: colors.grey[300] }}>
                    <strong>Lasso Selection Tool</strong> to create a part by selecting points in the point cloud.
                  </Typography>
                </Box>
                <Typography variant="body2" sx={{ color: colors.grey[300], mb: 1 }}>
                  • You can also create parts using the <strong>Split Point Cloud</strong> buttons for Classification or Tree ID.
                </Typography>
                <Typography variant="body2" sx={{ color: colors.grey[300] }}>
                  • Select exactly one part from the point cloud list before annotating.
                </Typography>
              </Box>

               <Typography variant="subtitle1" sx={{ color: colors.greenAccent[400], mb: 1, fontWeight: 'bold' }}>
                 2. Click the Annotation Button
               </Typography>
               <Box sx={{ pl: 2, mb: 2, display: 'flex', alignItems: 'center', gap: 0.5 }}>
                 <Typography variant="body2" sx={{ color: colors.grey[300] }}>
                   Click the
                 </Typography>
                 <Edit sx={{ fontSize: 16, color: colors.grey[300] }} />
                 <Typography variant="body2" sx={{ color: colors.grey[300] }}>
                   icon button in the viewer or the "Annotate Selected Part" button in the sidebar.
                 </Typography>
               </Box>

               <Typography variant="subtitle1" sx={{ color: colors.greenAccent[400], mb: 1, fontWeight: 'bold' }}>
                 3. Choose Annotation Type and Value
               </Typography>
               <Typography variant="body2" sx={{ color: colors.grey[300], mb: 2, pl: 2 }}>
                 • Select the <strong>Annotation Type</strong> (Classification or Tree ID).
                 <br />
                 • For <strong>Classification:</strong> Choose from the dropdown list of available classifications.
                 <br />
                 • For <strong>Tree ID:</strong> Enter an integer value.
               </Typography>

               <Typography variant="subtitle1" sx={{ color: colors.greenAccent[400], mb: 1, fontWeight: 'bold' }}>
                 4. Apply Annotation
               </Typography>
               <Typography variant="body2" sx={{ color: colors.grey[300], mb: 2, pl: 2 }}>
                 Click "Apply Annotation" to assign the selected classification or Tree ID to all points in the selected area.
                 The annotation process may take a moment depending on the number of points.
               </Typography>
             </Box>

             <Typography variant="h6" sx={{ color: colors.grey[100], mb: 2, fontWeight: 'bold' }}>
               Tips
             </Typography>
            <Box component="ul" sx={{ color: colors.grey[300], pl: 3, mb: 2 }}>
              <li>You must create at least one part using the Lasso Selection Tool or the Split Point Cloud buttons before you can annotate.</li>
               <li>Select exactly one part from the point cloud list before annotating, or the annotation button will be disabled.</li>
               <li>You can undo/redo annotations using the undo/redo buttons in the viewer.</li>
             </Box>
           </Box>
         </DialogContent>
      </Dialog>

      {/* Part List Help Dialog */}
      <Dialog
        open={partListHelpDialogOpen}
        onClose={() => setPartListHelpDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <HelpOutline sx={{ color: colors.greenAccent[500] }} />
              How to Use Point Cloud List
            </Box>
            <IconButton
              onClick={() => setPartListHelpDialogOpen(false)}
              sx={{
                color: colors.grey[400],
                '&:hover': {
                  color: colors.grey[200],
                  backgroundColor: 'rgba(0,0,0,0.1)',
                },
              }}
              size="small"
            >
              <Close />
            </IconButton>
          </Box>
        </DialogTitle>
        <DialogContent>
          <Box sx={{ mt: 2 }}>
            <Typography variant="body1" sx={{ color: colors.grey[300], mb: 2 }}>
              The Point Cloud list shows every part you have created. Use it to control visibility, selection, and part actions.
            </Typography>
            <Box component="ul" sx={{ color: colors.grey[300], pl: 3, mb: 2, '& > li': { mb: 1 } }}>
              <li><strong>Toggle visibility:</strong> Use the checkbox on each part to show or hide it in the viewer.</li>
              <li><strong>Select a part:</strong> Click a row to select it. The selected part will be highlighted.</li>
              <li><strong>Multi-select:</strong> Hold <strong>Ctrl</strong> while clicking to select multiple parts.</li>
              <li><strong>Context menu (right-click a part):</strong> Provides rename, delete, and save options. The merge option appears when multiple parts are selected.</li>
              <li><strong>Merge parts:</strong> Select multiple parts, then use the context menu and choose "Merge Selected Parts" to combine them into one part.</li>
            </Box>
          </Box>
        </DialogContent>
      </Dialog>

      {/* Selection Tool Help Dialog */}
      <Dialog
        open={selectionHelpDialogOpen}
        onClose={() => setSelectionHelpDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <HelpOutline sx={{ color: colors.greenAccent[500] }} />
              How to Use Selection Tool
            </Box>
            <IconButton
              onClick={() => setSelectionHelpDialogOpen(false)}
              sx={{
                color: colors.grey[400],
                '&:hover': {
                  color: colors.grey[200],
                  backgroundColor: 'rgba(0,0,0,0.1)',
                },
              }}
              size="small"
            >
              <Close />
            </IconButton>
          </Box>
        </DialogTitle>
        <DialogContent>
          <Box sx={{ mt: 2 }}>
            <Typography variant="body1" sx={{ color: colors.grey[300], mb: 2 }}>
              The Selection Tool lets you split the point cloud into parts using a lasso (free-form polygon) selection.
            </Typography>
            <Typography variant="subtitle1" sx={{ color: colors.greenAccent[400], mb: 1, fontWeight: 'bold' }}>
              Steps
            </Typography>
            <Box component="ul" sx={{ color: colors.grey[300], pl: 3, mb: 2 }}>
              <li>Click the lasso icon to activate it.</li>
              <li>Click around the area you want to isolate.</li>
            </Box>
            <Typography variant="body2" sx={{ color: colors.grey[400], mt: 2, fontStyle: 'italic' }}>
              Note: The lasso only cuts the parts you currently have selected. Select specific parts first if needed.
            </Typography>
          </Box>
        </DialogContent>
      </Dialog>

      {/* Split Warning Dialog */}
      <Dialog
        open={splitWarningDialogOpen}
        onClose={() => {
          setSplitWarningDialogOpen(false);
          setPendingSplitType(null);
          setPendingMiniMapTreeID(null);
        }}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Typography variant="h6" sx={{ color: colors.grey[100] }}>
              Warning
            </Typography>
            <IconButton
              onClick={() => {
                setSplitWarningDialogOpen(false);
                setPendingSplitType(null);
                setPendingMiniMapTreeID(null);
              }}
              sx={{
                color: colors.grey[400],
                '&:hover': {
                  color: colors.grey[200],
                  backgroundColor: 'rgba(0,0,0,0.1)',
                },
              }}
              size="small"
            >
              <Close />
            </IconButton>
          </Box>
        </DialogTitle>
        <DialogContent>
          <Box sx={{ mt: 2 }}>
            <Alert severity="warning" sx={{ mb: 2 }}>
              All existing parts will be lost when you split the point cloud.
            </Alert>
            <Typography variant="body2" sx={{ color: colors.grey[300] }}>
              {pendingSplitType === 'minimap' 
                ? 'This action will replace all current parts with new parts based on Tree ID from the minimap. Any unsaved work on existing parts will be lost.'
                : `This action will replace all current parts with new parts based on ${pendingSplitType === 'classification' ? 'classification' : 'Tree ID'}. Any unsaved work on existing parts will be lost.`
              }
            </Typography>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => {
            setSplitWarningDialogOpen(false);
            setPendingSplitType(null);
            setPendingMiniMapTreeID(null);
          }}>
            Cancel
          </Button>
          <Button onClick={handleConfirmSplit} variant="contained" color="warning">
            Continue
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
       {userRole !== 'Regular' && (
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
       )}
     </Box>
   );
 };
 
 export default PointCloudViewer;