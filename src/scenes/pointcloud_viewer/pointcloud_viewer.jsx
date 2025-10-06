import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Box, Button, Typography, Paper, Alert, CircularProgress, useTheme, FormControlLabel, Checkbox, FormControl, InputLabel, Select, MenuItem, IconButton, Slider, Dialog, DialogTitle, DialogContent, DialogActions, TextField, Menu, ListItemIcon, ListItemText} from '@mui/material';
import { tokens } from '../../theme';
import { CloudUpload, Map, Close, Gesture, HistoryEdu, DeleteSweep, Edit, Save, Delete, Merge } from '@mui/icons-material';
import { useSearchParams } from 'react-router-dom';
import axios from 'axios';
import * as THREE from 'three';
import { createLassoHelper } from './LassoHelper';
import { createSceneManager } from './scene_manager';
import { createBoundingBox, updateBoundingBoxVisibility, disposeBoundingBox } from './pointcloud_boundingbox';
import { createStyles, getResponsiveMarginLeft } from './pointcloud_viewer.styles';
import { createInitialClassifications, toggleClassification } from './classificationUtils';
import { createInitialTreeIDs, toggleTreeID } from './treeIDUtils';
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
  generateRandomColor,
  addNewAnnotation,
  annotateAllVisiblePoints,
  handleAnnotationDialogClose
} from './utils/annotationUtils';

import {
  handleToolSelect,
  handleFileUpload,
  toggleBoundingBox,
  handleToggleClassification,
  handleToggleAllClassifications,
  handleToggleTreeID,
  handleToggleAllTreeIDs
} from './utils/toolUtils';

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
  
  // --- Multi-selection and Context Menu State ---
  const [selectedParts, setSelectedParts] = useState([]);
  const [contextMenu, setContextMenu] = useState(null);
  
  // --- Annotation State ---
  const [selectedAnnotationType, setSelectedAnnotationType] = useState('classification');
  const [selectedAnnotationValue, setSelectedAnnotationValue] = useState(null);
  const [isAnnotating, setIsAnnotating] = useState(false);
  const [annotationDialogOpen, setAnnotationDialogOpen] = useState(false);
  const [newAnnotationName, setNewAnnotationName] = useState('');
  const [newAnnotationColor, setNewAnnotationColor] = useState([1, 0, 0]); // Default red

  // This effect updates the shader when the slider value changes
  useEffect(() => {
    if (pointCloud && pointCloud.material) {
      pointCloud.material.uniforms.u_pointSize.value = pointSize;
    }
  }, [pointSize, pointCloud]);

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
     updatePointCloudGeometry(pointCloud, combinedGeometry);
   } else {
     // No visible parts, show empty
     const emptyGeometry = new THREE.BufferGeometry();
     emptyGeometry.setAttribute('position', new THREE.Float32BufferAttribute([], 3));
     emptyGeometry.setAttribute('color', new THREE.Float32BufferAttribute([], 3));
     emptyGeometry.setAttribute('customColor', new THREE.Float32BufferAttribute([], 3));
     emptyGeometry.setAttribute('size', new THREE.Float32BufferAttribute([], 1));
     updatePointCloudGeometry(pointCloud, emptyGeometry);
   }
  }, [parts, pointCloud, originalGeometry, updatePointCloudColors]);

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
             const selectedGeometry = filterPointCloudByLasso(sourcePointCloud, lassoPoints, sceneManagerRef.current.camera, canvasRect);
             if (selectedGeometry && selectedGeometry.attributes && selectedGeometry.attributes.position && selectedGeometry.attributes.position.count > 0) {
               // Create two parts: selected and remaining
               const remainingGeometry = createRemainingGeometry(sourceGeometry, selectedGeometry);
               
               const newPart = { 
                 id: Date.now(), 
                 name: `Part ${parts.length + 1}`, 
                 geometry: selectedGeometry,
                 visible: true,
                 type: 'selected'
               };
               
               const remainingPart = {
                 id: Date.now() + 1,
                 name: `Remaining ${parts.length + 1}`,
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
            projectName: f.project_name || (f.project_id ? `Project ID ${f.project_id}` : 'Unassigned'),
            divisionName: f.division_name || (f.division_id ? `Division ID ${f.division_id}` : 'N/A'),
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
            const childrenToRemove = [];
            sceneManagerRef.current.scene.traverse((child) => {
              if (child instanceof THREE.Points) childrenToRemove.push(child);
            });
            childrenToRemove.forEach((pc) => {
              sceneManagerRef.current.scene.remove(pc);
              if (pc.geometry) pc.geometry.dispose();
              if (pc.material) pc.material.dispose();
            });
            if (boundingBox) disposeBoundingBox(boundingBox);
            setBoundingBox(null);
            setPointCloud(null);
          }
          setTimeout(resolve, 10);
        });
      });

      await new Promise(resolve => {
        requestAnimationFrame(() => {
          const geometry = createPointCloudGeometry(points, colors);
          const material = createPointCloudMaterial();
          const newPointCloud = new THREE.Points(geometry, material);
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


  const handleFileSelect = async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    await processFile(file);
  };

  const toggleBoundingBox = () => {
    const newVisibility = !showBoundingBox;
    updateBoundingBoxVisibility(boundingBox, newVisibility);
    setShowBoundingBox(newVisibility);
  };

  const handleToggleClassification = (classificationId) => {
    const newClassifications = toggleClassification(classifications, classificationId);
    if (pointCloud && originalGeometry) {
      const filteredGeometry = filterPointCloudByClassifications(originalGeometry, newClassifications);
      updatePointCloudGeometry(pointCloud, filteredGeometry);
    }
    setClassifications(newClassifications);
  };

  const handleToggleTreeID = (treeID) => {
    const newTreeIDs = toggleTreeID(treeIDs, treeID);
    if (pointCloud && originalGeometry && treeIDData) {
      const filteredGeometry = filterPointCloudByTreeIDs(originalGeometry, treeIDData, newTreeIDs);
      updatePointCloudGeometry(pointCloud, filteredGeometry);
    }
    setTreeIDs(newTreeIDs);
  };

  const handleToggleAllClassifications = () => {
    const allVisible = Object.values(classifications).every(c => c.visible);
    const newClassifications = { ...classifications };
    Object.keys(newClassifications).forEach(id => {
      newClassifications[id].visible = !allVisible;
    });
    if (pointCloud && originalGeometry) {
      const filteredGeometry = filterPointCloudByClassifications(originalGeometry, newClassifications);
      updatePointCloudGeometry(pointCloud, filteredGeometry);
    }
    setClassifications(newClassifications);
  };

  const handleToggleAllTreeIDs = () => {
    const allVisible = Object.values(treeIDs).every(t => t.visible);
    const newTreeIDs = { ...treeIDs };
    Object.keys(newTreeIDs).forEach(id => {
      newTreeIDs[id].visible = !allVisible;
    });
    if (pointCloud && originalGeometry && treeIDData) {
      const filteredGeometry = filterPointCloudByTreeIDs(originalGeometry, treeIDData, newTreeIDs);
      updatePointCloudGeometry(pointCloud, filteredGeometry);
    }
    setTreeIDs(newTreeIDs);
  };


  // Create annotation function instances with state setters
  const handleAnnotationTypeChangeInstance = handleAnnotationTypeChange(setSelectedAnnotationType, setSelectedAnnotationValue);
  const handleAnnotationValueSelectInstance = handleAnnotationValueSelect(setSelectedAnnotationValue);
  const addNewAnnotationInstance = addNewAnnotation(setClassifications, setTreeIDs, selectedAnnotationType, newAnnotationName, newAnnotationColor, setSelectedAnnotationValue, setNewAnnotationName, setNewAnnotationColor);
  const annotateAllVisiblePointsInstance = annotateAllVisiblePoints(setIsAnnotating, setAnnotationDialogOpen, selectedAnnotationValue, selectedAnnotationType, classifications, treeIDs, pointCloud, parts, selectedParts, originalGeometry, combineVisiblePartsInstance);
  const handleAnnotationDialogCloseInstance = handleAnnotationDialogClose(setAnnotationDialogOpen, setSelectedAnnotationValue);


  useEffect(() => {
    updatePointCloudColors();
  }, [filterMode, classifications, treeIDs]);

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
                {!fileId && (
                  <>
                    <input
                      accept=".las,.laz"
                      style={styles.fileInput}
                      id="las-file-input"
                      type="file"
                      onChange={handleFileSelect}
                    />
                    <label htmlFor="las-file-input">
                      <Button variant="contained" component="span" startIcon={<CloudUpload />} disabled={isLoading} sx={styles.uploadButton} fullWidth>
                        Choose LAS/LAZ File
                      </Button>
                    </label>
                  </>
                )}
                
                {selectedFile && fileInfo && (
                    <Box sx={{ mb: 2, p:1, border: `1px solid ${colors.grey[700]}`, borderRadius: '4px' }}>
                        <Typography variant="subtitle1" sx={{ color: colors.grey[100], mb: 1, fontWeight: 'bold' }}>File Information</Typography>
                        <Typography variant="body2" sx={{ color: colors.grey[200] }}>Name: <span style={{color: colors.grey[300]}}>{fileInfo.name || selectedFile.name}</span></Typography>
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
                    
                    <Box 
                        sx={{...styles.annotationItem, ...(selectedParts.length === 0 ? styles.activeAnnotationItem : {})}}
                        onClick={() => setSelectedParts([])}
                      >
                      <Typography sx={styles.annotationName}>Full Point Cloud</Typography>
                    </Box>
                    
                    {parts.map(part => {
                      const isSelected = selectedParts.includes(part.id);
                      console.log('Part rendering:', {
                        partId: part.id,
                        partName: part.name,
                        isSelected,
                        selectedParts
                      });
                      
                      return (
                      <Box 
                        key={part.id}
                        sx={{
                          ...styles.annotationItem, 
                          ...(isSelected ? styles.activeAnnotationItem : {})
                        }}
                        onClick={(e) => {
                          console.log('Click event:', {
                            partId: part.id,
                            ctrlKey: e.ctrlKey,
                            metaKey: e.metaKey,
                            currentSelectedParts: selectedParts
                          });
                          
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

                {pointCloud && filterMode === 'classification' && (
                  <Box sx={styles.classificationSection}>
                    <Typography sx={styles.classificationTitle}>Classifications</Typography>
                    <Box sx={styles.selectAllItem}><Typography sx={styles.selectAllText}>Select All</Typography><Checkbox checked={Object.values(classifications).every(c => c.visible)} indeterminate={!Object.values(classifications).every(c => c.visible) && Object.values(classifications).some(c => c.visible)} onChange={handleToggleAllClassifications} sx={styles.checkbox}/></Box>
                    {Object.entries(classifications).map(([id, classification]) => (
                      <Box key={id} sx={styles.classificationItem}>
                        <Box sx={{...styles.classificationColor, backgroundColor: `rgb(${classification.color.map(c=>c*255).join(',')})`}}/>
                        <Typography sx={styles.classificationName}>{classification.name}</Typography>
                        <Checkbox checked={classification.visible} onChange={() => handleToggleClassification(id)} sx={styles.checkbox}/>
                      </Box>
                    ))}
                  </Box>
                )}

                {pointCloud && filterMode === 'treeID' && (
                  <Box sx={styles.classificationSection}>
                     <Typography sx={styles.classificationTitle}>Tree IDs ({Object.keys(treeIDs).length - 1} trees)</Typography>
                     <Box sx={styles.selectAllItem}><Typography sx={styles.selectAllText}>Select All</Typography><Checkbox checked={Object.values(treeIDs).every(t => t.visible)} indeterminate={!Object.values(treeIDs).every(t => t.visible) && Object.values(treeIDs).some(t => t.visible)} onChange={handleToggleAllTreeIDs} sx={styles.checkbox}/></Box>
                     {Object.entries(treeIDs).map(([id, treeID]) => (
                      <Box key={id} sx={styles.classificationItem}>
                        <Box sx={{...styles.classificationColor, backgroundColor: `rgb(${treeID.color.map(c=>c*255).join(',')})`}}/>
                        <Typography sx={styles.classificationName}>{treeID.name}</Typography>
                        <Checkbox checked={treeID.visible} onChange={() => handleToggleTreeID(id)} sx={styles.checkbox}/>
                      </Box>
                    ))}
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
                        step={0.1}
                        min={1}
                        max={10}
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
                    <MiniMap files={miniMapFiles} currentFileId={fileId ? parseInt(fileId) : null} colors={colors}/>
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
               <FormControl fullWidth sx={{ mb: 2 }}>
                 <InputLabel>Tree ID</InputLabel>
                 <Select 
                   value={selectedAnnotationValue || ''} 
                   label="Tree ID" 
                   onChange={(e) => handleAnnotationValueSelectInstance(e.target.value)}
                 >
                   {Object.entries(treeIDs).map(([id, treeID]) => (
                     <MenuItem key={id} value={id}>
                       <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                         <Box sx={{
                           width: 16, 
                           height: 16, 
                           backgroundColor: `rgb(${treeID.color.map(c=>c*255).join(',')})`,
                           borderRadius: '2px'
                         }} />
                         {treeID.name}
                       </Box>
                     </MenuItem>
                   ))}
                 </Select>
               </FormControl>
             )}
             
             {/* Add New Annotation Section */}
             <Box sx={{ mt: 3, p: 2, backgroundColor: colors.primary[800], borderRadius: '4px' }}>
               <Typography variant="subtitle2" sx={{ color: colors.grey[200], mb: 2 }}>
                 Or Add New {selectedAnnotationType === 'classification' ? 'Classification' : 'Tree ID'}
               </Typography>
               <TextField
                 fullWidth
                 size="small"
                 label={`New ${selectedAnnotationType === 'classification' ? 'Classification' : 'Tree ID'} Name`}
                 value={newAnnotationName}
                 onChange={(e) => setNewAnnotationName(e.target.value)}
                 sx={{ mb: 2 }}
               />
               <Box sx={{ display: 'flex', gap: 1 }}>
                 <Button
                   variant="outlined"
                   onClick={addNewAnnotationInstance}
                   disabled={!newAnnotationName.trim()}
                   sx={{ flex: 1 }}
                 >
                   Add New
                 </Button>
                 <Button
                   variant="outlined"
                   onClick={() => setNewAnnotationColor(generateRandomColor())}
                   sx={{ minWidth: 'auto', px: 2 }}
                 >
                   Random Color
                 </Button>
               </Box>
             </Box>
           </Box>
         </DialogContent>
         <DialogActions>
           <Button onClick={handleAnnotationDialogCloseInstance}>
             Cancel
           </Button>
           <Button 
             onClick={annotateAllVisiblePointsInstance}
             variant="contained"
             disabled={!selectedAnnotationValue || isAnnotating || (parts.length > 0 && selectedParts.length === 0)}
             startIcon={<Save />}
           >
             {isAnnotating ? 'Applying...' : 'Apply Annotation'}
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
         {selectedParts.length > 1 ? (
           <>
             <MenuItem onClick={handleDeleteSelectedParts}>
               <ListItemIcon>
                 <Delete fontSize="small" />
               </ListItemIcon>
               <ListItemText>Delete Selected Parts ({selectedParts.length})</ListItemText>
             </MenuItem>
             <MenuItem onClick={handleMergeSelectedParts}>
               <ListItemIcon>
                 <Merge fontSize="small" />
               </ListItemIcon>
               <ListItemText>Merge Selected Parts ({selectedParts.length})</ListItemText>
             </MenuItem>
           </>
         ) : (
           <>
             <MenuItem onClick={() => handleDeletePart(contextMenu?.partId)}>
               <ListItemIcon>
                 <Delete fontSize="small" />
               </ListItemIcon>
               <ListItemText>Delete Part</ListItemText>
             </MenuItem>
             {selectedParts.length >= 2 && (
               <MenuItem onClick={handleMergeSelectedParts}>
                 <ListItemIcon>
                   <Merge fontSize="small" />
                 </ListItemIcon>
                 <ListItemText>Merge Selected Parts ({selectedParts.length})</ListItemText>
               </MenuItem>
             )}
           </>
         )}
       </Menu>
     </Box>
   );
 };
 
 export default PointCloudViewer;