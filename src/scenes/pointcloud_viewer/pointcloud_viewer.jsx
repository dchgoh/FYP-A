import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Box, Button, Typography, Paper, Alert, CircularProgress, useTheme, FormControlLabel, Checkbox, FormControl, InputLabel, Select, MenuItem, IconButton, Slider} from '@mui/material';
import { tokens } from '../../theme';
import { CloudUpload, Map, Close, Gesture, HistoryEdu, DeleteSweep } from '@mui/icons-material';
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

  // --- State for Lasso History ---
  const [activeTool, setActiveTool] = useState(null);
  const lassoHelperRef = useRef(null);
  const [isProcessingLasso, setIsProcessingLasso] = useState(false);
  const [history, setHistory] = useState([]);
  const [activeHistoryId, setActiveHistoryId] = useState(null);
  const [pointSize, setPointSize] = useState(100.0); // State for the slider value

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

   const handleHistoryItemClick = (historyId) => {
    // If the clicked item is already active, do nothing to prevent re-renders
    if (activeHistoryId === historyId) return;

    // If an older item is selected, truncate the history log after that point
    if (historyId !== null) {
      const selectedIndex = history.findIndex(item => item.id === historyId);
      setHistory(prev => prev.slice(0, selectedIndex + 1));
    }
    setActiveHistoryId(historyId);
  };

  // Completely clears the history log
  const handleClearHistory = () => {
    setHistory([]);
    setActiveHistoryId(null); // Resets view to the full point cloud
  };

  
  const updatePointCloudColors = () => {
    // --- ADD THIS LINE ---
    if (!pointCloud || !originalGeometry || activeHistoryId !== null) return;
    
    // The rest of the function stays the same
    if (filterMode === 'classification') {
      const filteredGeometry = filterPointCloudByClassifications(originalGeometry, classifications);
      updatePointCloudGeometry(pointCloud, filteredGeometry);
    } else if (filterMode === 'treeID' && treeIDData) {
      const filteredGeometry = filterPointCloudByTreeIDs(originalGeometry, treeIDData, treeIDs);
      updatePointCloudGeometry(pointCloud, filteredGeometry);
    }
  };


  // --- ADD THIS NEW EFFECT ---  // Visually updates the point cloud based on the active history item
  useEffect(() => {
   if (!pointCloud || !originalGeometry) return;
   
   const activeHistoryItem = history.find(item => item.id === activeHistoryId);

    if (activeHistoryItem) {
      updatePointCloudGeometry(pointCloud, activeHistoryItem.geometry);
    } else {
     // When no history is active, show the full, original point cloud
      // We must re-apply the color filter in this case.
     updatePointCloudColors();
    }
  }, [activeHistoryId, history, pointCloud, originalGeometry, updatePointCloudColors]);

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
          const sourceGeometry = activeHistoryId === null
            ? originalGeometry
            : history.find(h => h.id === activeHistoryId)?.geometry;
          if (sourceGeometry) {
            const sourcePointCloud = new THREE.Points(sourceGeometry, pointCloud.material);
            sourcePointCloud.matrixWorld = pointCloud.matrixWorld;
            const selectedGeometry = filterPointCloudByLasso(sourcePointCloud, lassoPoints, sceneManagerRef.current.camera, canvasRect);
            if (selectedGeometry && selectedGeometry.attributes.position.count > 0) {
              const newHistoryItem = { id: Date.now(), name: `Selection ${history.length + 1}`, geometry: selectedGeometry };
              setHistory(prev => [...prev, newHistoryItem]);
              setActiveHistoryId(newHistoryItem.id);
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
  }, [activeTool, pointCloud, history, activeHistoryId, originalGeometry]);


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
  
  useEffect(() => {
    updatePointCloudColors();
  }, [filterMode, classifications, treeIDs, activeHistoryId]);

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

                {pointCloud && (
                  <FormControlLabel control={<Checkbox checked={showBoundingBox} onChange={toggleBoundingBox} sx={styles.checkbox}/>} label="Show Bounding Box" sx={styles.checkboxLabel}/>
                )}
                
                {pointCloud && (
                  <Box sx={{ ...styles.annotationSection, mt: 2 }}>
                    <Typography sx={styles.annotationTitle}>Appearance</Typography>
                    <Box sx={{ px: 1 }}>
                      <Typography gutterBottom variant="body2" sx={{ color: colors.grey[300] }}>
                        Point Size
                      </Typography>
                      <Slider
                        value={pointSize}
                        onChange={(e, newValue) => setPointSize(newValue)}
                        aria-labelledby="point-size-slider"
                        valueLabelDisplay="auto"
                        step={5}
                        min={10}
                        max={200}
                        sx={{ color: colors.greenAccent[500] }}
                      />
                    </Box>
                  </Box>
                )}

                {/* --- Lasso & History UI --- */}
               {pointCloud && (
                 <Box sx={styles.annotationSection}>
                   <Typography sx={styles.annotationTitle}>Selection Tool</Typography>
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
               )}

               {pointCloud && (
                 <Box sx={styles.annotationListSection}>
                   <Box sx={{display: 'flex', alignItems: 'center', mb:1}}>
                     <HistoryEdu sx={{mr:1, color: colors.grey[300]}}/>
                     <Typography sx={{...styles.annotationTitle, flex: 1, borderBottom: 'none', textAlign: 'left'}}>Selection History</Typography>
                     {history.length > 0 && (
                        <IconButton size="small" onClick={handleClearHistory} title="Clear All History">
                          <DeleteSweep color="error"/>
                        </IconButton>
                     )}
                   </Box>
                   
                   <Box 
                       sx={{...styles.annotationItem, ...(activeHistoryId === null ? styles.activeAnnotationItem : {})}}
                       onClick={() => handleHistoryItemClick(null)}
                     >
                     <Typography sx={styles.annotationName}>Full Point Cloud</Typography>
                   </Box>
                   
                   {history.map(item => (
                     <Box 
                       key={item.id}
                       sx={{...styles.annotationItem, ...(item.id === activeHistoryId ? styles.activeAnnotationItem : {})}}
                       onClick={() => handleHistoryItemClick(item.id)}
                       title={`Click to view and edit from this point`}
                     >
                       <Typography sx={styles.annotationName}>{item.name}</Typography>
                     </Box>
                   ))}
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
    </Box>
  );
};

export default PointCloudViewer;