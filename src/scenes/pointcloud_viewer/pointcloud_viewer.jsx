import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Box, Button, Typography, Paper, Alert, CircularProgress, useTheme, FormControlLabel, Checkbox, FormControl, InputLabel, Select, MenuItem, IconButton } from '@mui/material';
import { tokens } from '../../theme';
import { CloudUpload, Map, Close } from '@mui/icons-material';
import { useSearchParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import * as THREE from 'three';
import Draggable from 'react-draggable';
import { createSceneManager } from './scene_manager';
import { createBoundingBox, updateBoundingBoxVisibility, disposeBoundingBox } from './pointcloud_boundingbox';
import { createStyles, getResponsiveMarginLeft } from './pointcloud_viewer.styles';
import { createInitialClassifications, toggleClassification } from './classificationUtils';
import { createInitialTreeIDs, toggleTreeID } from './treeIDUtils';
import { parseLASFile } from './lasParser';
import { createPointCloudGeometry, createPointCloudMaterial, filterPointCloudByClassifications, filterPointCloudByTreeIDs, updatePointCloudGeometry } from './pointCloudManager';
import MiniMap from './MiniMap';

const PointCloudViewer = ({ isCollapsed }) => {
  const theme = useTheme();
  const colors = tokens(theme.palette.mode);
  const styles = createStyles(theme, colors);
  const canvasRef = useRef(null);
  const sceneManagerRef = useRef(null);
  const minDistanceRef = useRef(1);
  const maxDistanceRef = useRef(1000);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const [selectedFile, setSelectedFile] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [pointCloud, setPointCloud] = useState(null);
  const [showBoundingBox, setShowBoundingBox] = useState(true);
  const [boundingBox, setBoundingBox] = useState(null);
  const [classifications, setClassifications] = useState(createInitialClassifications());
  const [treeIDs, setTreeIDs] = useState({});
  const [treeIDData, setTreeIDData] = useState([]);
  const [originalGeometry, setOriginalGeometry] = useState(null);
  const [filterMode, setFilterMode] = useState('classification'); // 'classification' or 'treeID'
  const [fileId, setFileId] = useState(null);
  const [fileInfo, setFileInfo] = useState(null);

  // MiniMap state
  const [showMiniMap, setShowMiniMap] = useState(true);
  const [miniMapFiles, setMiniMapFiles] = useState([]);
  const [isLoadingMiniMapFiles, setIsLoadingMiniMapFiles] = useState(false);
  const [errorMiniMapFiles, setErrorMiniMapFiles] = useState(null);
  const [buttonPosition, setButtonPosition] = useState({ x: 0, y: 0 });
  const draggableButtonRef = useRef(null);
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

  // Load button position from localStorage
  useEffect(() => {
    const savedPosition = localStorage.getItem('miniMapButtonPosition');
    if (savedPosition) {
      try {
        const parsedPosition = JSON.parse(savedPosition);
        if (typeof parsedPosition.x === 'number' && typeof parsedPosition.y === 'number') {
          setButtonPosition(parsedPosition);
        } else {
          localStorage.removeItem('miniMapButtonPosition');
        }
      } catch (e) {
        console.error("Error parsing saved button position:", e);
        localStorage.removeItem('miniMapButtonPosition');
      }
    }
  }, []);

  const handleDragStart = () => {
    if (draggableButtonRef.current) {
      draggableButtonRef.current.style.cursor = 'grabbing';
    }
  };

  const handleDragStop = (e, data) => {
    const newPosition = { x: data.x, y: data.y };
    setButtonPosition(newPosition);
    localStorage.setItem('miniMapButtonPosition', JSON.stringify(newPosition));
    if (draggableButtonRef.current) {
      draggableButtonRef.current.style.cursor = 'grab';
    }
    requestAnimationFrame(() => {
      updateMiniMapPosition();
    });
  };

  const updateMiniMapPosition = useCallback(() => {
    if (!showMiniMap || !draggableButtonRef.current || !viewerWrapperRef.current) {
      if (showMiniMap) {
        setMiniMapContainerStyle(prev => ({ ...prev, visibility: 'hidden' }));
      }
      return;
    }

    const buttonNode = draggableButtonRef.current;
    const parentNode = viewerWrapperRef.current;

    const buttonTransform = window.getComputedStyle(buttonNode).transform;
    const matrix = new DOMMatrix(buttonTransform);
    
    const buttonRect = buttonNode.getBoundingClientRect();
    const parentRect = parentNode.getBoundingClientRect();

    const buttonTopInParent = buttonRect.top - parentRect.top;
    const buttonLeftInParent = buttonRect.left - parentRect.left;

    const parentWidth = parentRect.width;
    const parentHeight = parentRect.height;

    const currentMapEffectiveWidth = parentWidth < (MINIMAP_ESTIMATED_WIDTH_XS + MINIMAP_ESTIMATED_WIDTH_SM) / 2
        ? MINIMAP_ESTIMATED_WIDTH_XS
        : MINIMAP_ESTIMATED_WIDTH_SM;
    const currentMapEffectiveHeight = parentHeight < (MINIMAP_ESTIMATED_HEIGHT_XS + MINIMAP_ESTIMATED_HEIGHT_SM) / 2
        ? MINIMAP_ESTIMATED_HEIGHT_XS
        : MINIMAP_ESTIMATED_HEIGHT_SM;
    
    let idealTop, idealLeft;

    if (buttonTopInParent + BUTTON_FIXED_SIZE / 2 > parentHeight / 2) {
      idealTop = buttonTopInParent - currentMapEffectiveHeight - MINIMAP_BUTTON_GAP;
    } else {
      idealTop = buttonTopInParent + BUTTON_FIXED_SIZE + MINIMAP_BUTTON_GAP;
    }

    if (buttonLeftInParent + BUTTON_FIXED_SIZE / 2 > parentWidth / 2) {
      idealLeft = buttonLeftInParent - currentMapEffectiveWidth - MINIMAP_BUTTON_GAP;
    } else {
      idealLeft = buttonLeftInParent + BUTTON_FIXED_SIZE + MINIMAP_BUTTON_GAP;
    }

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

  // Fetch files for the mini-map
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
        const response = await fetch(`http://localhost:5000/api/files`, {
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

  // Effect to update MiniMap position on relevant changes
  useEffect(() => {
    updateMiniMapPosition(); 

    const handleResizeOrCollapse = () => {
      updateMiniMapPosition();
    };
    
    window.addEventListener('resize', handleResizeOrCollapse);
    
    return () => {
      window.removeEventListener('resize', handleResizeOrCollapse);
    };
  }, [buttonPosition, showMiniMap, isCollapsed, updateMiniMapPosition]);

  // Initial positioning after mount
  useEffect(() => {
    const timer = setTimeout(() => {
      updateMiniMapPosition();
    }, 100);
    return () => clearTimeout(timer);
  }, [updateMiniMapPosition]);

  // Add a resize observer to handle container size changes
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

  // Initialize Three.js scene
  useEffect(() => {
    if (!canvasRef.current) return;

    const sceneManager = createSceneManager(canvasRef.current);
    sceneManagerRef.current = sceneManager;
    sceneManager.startAnimation();

    return () => {
      sceneManager.dispose();
    };
  }, []);

  // Load file from backend when fileId is provided
  useEffect(() => {
    const fileIdParam = searchParams.get('fileId');
    console.log('useEffect triggered - fileIdParam:', fileIdParam, 'current fileId:', fileId);
    if (fileIdParam && fileIdParam !== fileId) {
      console.log('Loading file from backend for fileId:', fileIdParam);
      setFileId(fileIdParam);
      loadFileFromBackend(fileIdParam);
    }
  }, [searchParams, fileId]);

  // Cleanup effect to remove point cloud when component unmounts
  useEffect(() => {
    return () => {
      if (pointCloud && sceneManagerRef.current) {
        disposeBoundingBox(boundingBox);
        sceneManagerRef.current.scene.remove(pointCloud);
      }
    };
  }, [pointCloud, boundingBox]);

  // Function to load file from backend
  const loadFileFromBackend = async (fileId) => {
    // Prevent multiple simultaneous loads
    if (isLoading) {
      console.log('File load already in progress, skipping...');
      return;
    }
    
    setIsLoading(true);
    setError(null);

    try {
      const token = localStorage.getItem('authToken');
      if (!token) {
        setError('Authentication required');
        return;
      }

      console.log('Getting file info from backend...');
      // Get file information from the files list
      const filesResponse = await axios.get(`http://localhost:5000/api/files/`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      const files = filesResponse.data;
      console.log('All files from API:', files.map(f => ({ id: f.id, name: f.name, status: f.status })));
      const fileInfo = files.find(file => file.id === parseInt(fileId));
      
      if (!fileInfo) {
        console.error(`File with ID ${fileId} not found in files list. Available IDs:`, files.map(f => f.id));
        setError(`File with ID ${fileId} not found`);
        return;
      }
      
      console.log('File info retrieved:', fileInfo);
      setFileInfo(fileInfo);

      console.log('Downloading file from backend...');
      console.log('File status:', fileInfo.status);
      console.log('File stored_path:', fileInfo.stored_path);
      console.log('File size_bytes:', fileInfo.size_bytes);
      
      // Download the file from backend
      const response = await axios.get(`http://localhost:5000/api/files/download/${fileId}`, {
        headers: { 'Authorization': `Bearer ${token}` },
        responseType: 'blob'
      });

      console.log('File downloaded, creating File object...');
      // Create a File object from the blob
      const blob = new Blob([response.data]);
      const file = new File([blob], `file_${fileId}.las`, { type: 'application/octet-stream' });

      // Process the file using existing logic
      await processFile(file);

    } catch (err) {
      console.error('Error loading file from backend:', err);
      setError(`Failed to load file: ${err.response?.data?.message || err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  // Function to process file (extracted from handleFileSelect)
  const processFile = async (file) => {
    console.log('processFile called with file:', file.name);
    if (!file.name.toLowerCase().endsWith('.las') && !file.name.toLowerCase().endsWith('.laz')) {
      setError('Please select a LAS or LAZ file');
      return;
    }

    setSelectedFile(file);
    setError(null);
    setIsLoading(true);

    try {
      // Parse LAS file with progress indication
      console.log('Parsing LAS file...');
      const { points, colors, treeIDs, numberOfPointRecords } = await parseLASFile(file, (progress) => {
        console.log(`Parsing progress: ${progress}%`);
      });
      console.log('LAS file parsed successfully');
      
      // Clear scene in a separate frame to prevent blocking
      await new Promise(resolve => {
        requestAnimationFrame(() => {
          if (sceneManagerRef.current) {
            console.log('Clearing scene, children count before:', sceneManagerRef.current.scene.children.length);
            
            // Remove all point clouds and dispose of them
            const childrenToRemove = [];
            sceneManagerRef.current.scene.traverse((child) => {
              if (child instanceof THREE.Points) {
                childrenToRemove.push(child);
              }
            });
            
            childrenToRemove.forEach((pointCloud) => {
              sceneManagerRef.current.scene.remove(pointCloud);
              if (pointCloud.geometry) pointCloud.geometry.dispose();
              if (pointCloud.material) pointCloud.material.dispose();
            });
            
            // Dispose of bounding box
            if (boundingBox) {
              disposeBoundingBox(boundingBox);
            }
            
            setBoundingBox(null);
            setPointCloud(null);
            console.log('Scene children count after clearing:', sceneManagerRef.current.scene.children.length);
          }
          // Small delay to allow UI to update
          setTimeout(resolve, 10);
        });
      });

      // Create geometry and material in a separate frame
      await new Promise(resolve => {
        requestAnimationFrame(() => {
          console.log('Creating point cloud geometry...');
          const geometry = createPointCloudGeometry(points, colors);
          const material = createPointCloudMaterial();
          const newPointCloud = new THREE.Points(geometry, material);
          
          sceneManagerRef.current.scene.add(newPointCloud);
          setPointCloud(newPointCloud);
          console.log('Added new point cloud, scene children count:', sceneManagerRef.current.scene.children.length);
          
          // Store original geometry for filtering
          setOriginalGeometry(geometry.clone());
          
          // Initialize treeID data
          const treeIDMap = createInitialTreeIDs(treeIDs);
          setTreeIDs(treeIDMap);
          setTreeIDData(treeIDs);

          // Create bounding box using the module
          const box = createBoundingBox(geometry, showBoundingBox);
          
          // Add the box as a child of the point cloud so it moves with it
          newPointCloud.add(box);
          setBoundingBox(box);

          // Set camera to top view and get distance bounds
          const distanceBounds = sceneManagerRef.current.setCameraTopView(geometry);
          minDistanceRef.current = distanceBounds.minDistance;
          maxDistanceRef.current = distanceBounds.maxDistance;
          
          // Update controls
          sceneManagerRef.current.controls.setDistanceBounds(minDistanceRef.current, maxDistanceRef.current);
          sceneManagerRef.current.controls.setDragObjects([newPointCloud]);

          setError(null);
          // Small delay to allow UI to update
          setTimeout(resolve, 10);
        });
      });

    } catch (err) {
      setError(`Error parsing file: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  // Handle window resize and sidebar collapse
  useEffect(() => {
    const handleResize = () => {
      if (sceneManagerRef.current && canvasRef.current) {
        const canvas = canvasRef.current;
        const container = canvas.parentElement;
        if (container) {
          const rect = container.getBoundingClientRect();
          // Update canvas size
          canvas.width = rect.width;
          canvas.height = rect.height;
          // Update renderer size
          sceneManagerRef.current.renderer.setSize(rect.width, rect.height);
          // Update camera aspect ratio
          sceneManagerRef.current.camera.aspect = rect.width / rect.height;
          sceneManagerRef.current.camera.updateProjectionMatrix();
        }
      }
    };

    // Use a small delay to ensure the layout has updated
    const timer = setTimeout(handleResize, 100);
    
    return () => {
      clearTimeout(timer);
    };
  }, [isCollapsed]);


  // Handle file selection
  const handleFileSelect = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    await processFile(file);
  };

  // Toggle bounding box visibility
  const toggleBoundingBox = () => {
    const newVisibility = !showBoundingBox;
    updateBoundingBoxVisibility(boundingBox, newVisibility);
    setShowBoundingBox(newVisibility);
  };

  // Toggle classification visibility
  const handleToggleClassification = (classificationId) => {
    const newClassifications = toggleClassification(classifications, classificationId);
    
    // Update point cloud geometry if point cloud exists
    if (pointCloud && originalGeometry) {
      const filteredGeometry = filterPointCloudByClassifications(originalGeometry, newClassifications);
      updatePointCloudGeometry(pointCloud, filteredGeometry);
    }
    
    // Update state
    setClassifications(newClassifications);
  };

  // Toggle treeID visibility
  const handleToggleTreeID = (treeID) => {
    const newTreeIDs = toggleTreeID(treeIDs, treeID);
    
    // Update point cloud geometry if point cloud exists
    if (pointCloud && originalGeometry && treeIDData) {
      const filteredGeometry = filterPointCloudByTreeIDs(originalGeometry, treeIDData, newTreeIDs);
      updatePointCloudGeometry(pointCloud, filteredGeometry);
    }
    
    // Update state
    setTreeIDs(newTreeIDs);
  };

  // Toggle all classifications
  const handleToggleAllClassifications = () => {
    const allVisible = Object.values(classifications).every(c => c.visible);
    const newClassifications = { ...classifications };
    
    Object.keys(newClassifications).forEach(id => {
      newClassifications[id] = {
        ...newClassifications[id],
        visible: !allVisible
      };
    });
    
    // Update point cloud geometry if point cloud exists
    if (pointCloud && originalGeometry) {
      const filteredGeometry = filterPointCloudByClassifications(originalGeometry, newClassifications);
      updatePointCloudGeometry(pointCloud, filteredGeometry);
    }
    
    // Update state
    setClassifications(newClassifications);
  };

  // Toggle all treeIDs
  const handleToggleAllTreeIDs = () => {
    const allVisible = Object.values(treeIDs).every(t => t.visible);
    const newTreeIDs = { ...treeIDs };
    
    Object.keys(newTreeIDs).forEach(id => {
      newTreeIDs[id] = {
        ...newTreeIDs[id],
        visible: !allVisible
      };
    });
    
    // Update point cloud geometry if point cloud exists
    if (pointCloud && originalGeometry && treeIDData) {
      const filteredGeometry = filterPointCloudByTreeIDs(originalGeometry, treeIDData, newTreeIDs);
      updatePointCloudGeometry(pointCloud, filteredGeometry);
    }
    
    // Update state
    setTreeIDs(newTreeIDs);
  };

  // Update point cloud colors based on filter mode
  const updatePointCloudColors = () => {
    if (!pointCloud || !originalGeometry) return;

    if (filterMode === 'classification') {
      // Use classification colors
      const filteredGeometry = filterPointCloudByClassifications(originalGeometry, classifications);
      updatePointCloudGeometry(pointCloud, filteredGeometry);
    } else if (filterMode === 'treeID' && treeIDData) {
      // Use treeID colors
      const filteredGeometry = filterPointCloudByTreeIDs(originalGeometry, treeIDData, treeIDs);
      updatePointCloudGeometry(pointCloud, filteredGeometry);
    }
  };

  // Update colors when filter mode changes
  useEffect(() => {
    updatePointCloudColors();
  }, [filterMode]);


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
                       <Typography 
                         variant="h6" 
                         sx={styles.controlsTitle}
                       >
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
                      <Button
                        variant="contained"
                        component="span"
                        startIcon={<CloudUpload />}
                        disabled={isLoading}
                        sx={styles.uploadButton}
                        fullWidth
                      >
                        Choose LAS/LAZ File
                      </Button>
                    </label>
                  </>
                )}
                
                {selectedFile && fileInfo && (
                  <Box sx={{ mb: 2 }}>
                    <Typography variant="h6" sx={{ color: colors.grey[100], mb: 1, fontWeight: 'bold' }}>
                      File Information
                    </Typography>
                    <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, fontSize: '0.875rem' }}>
                      <Box>
                        <Typography variant="body2" sx={{ color: colors.grey[300], fontWeight: 'bold' }}>
                          Name:
                        </Typography>
                        <Typography variant="body2" sx={{ color: colors.grey[100], wordBreak: 'break-word' }}>
                          {fileInfo.name || selectedFile.name}
                        </Typography>
                      </Box>
                      <Box>
                        <Typography variant="body2" sx={{ color: colors.grey[300], fontWeight: 'bold' }}>
                          Plot:
                        </Typography>
                        <Typography variant="body2" sx={{ color: colors.grey[100] }}>
                          {fileInfo.plot_name || 'N/A'}
                        </Typography>
                      </Box>
                      <Box>
                        <Typography variant="body2" sx={{ color: colors.grey[300], fontWeight: 'bold' }}>
                          Division:
                        </Typography>
                        <Typography variant="body2" sx={{ color: colors.grey[100] }}>
                          {fileInfo.divisionName || 'N/A'}
                        </Typography>
                      </Box>
                      <Box>
                        <Typography variant="body2" sx={{ color: colors.grey[300], fontWeight: 'bold' }}>
                          Project:
                        </Typography>
                        <Typography variant="body2" sx={{ color: colors.grey[100], wordBreak: 'break-word' }}>
                          {fileInfo.projectName || 'N/A'}
                        </Typography>
                      </Box>
                    </Box>
                  </Box>
                )}

                {isLoading && (
                  <Box sx={styles.loadingContainer}>
                    <CircularProgress size={18} sx={styles.loadingSpinner} />
                    <Typography variant="body2" sx={styles.loadingText}>
                      Loading point cloud...
                    </Typography>
                  </Box>
                )}

                {pointCloud && (
                  <FormControl fullWidth size="small" sx={styles.filterModeSelect}>
                    <InputLabel>Select Filter Mode</InputLabel>
                    <Select
                      value={filterMode}
                      label="Select Filter Mode"
                      onChange={(e) => setFilterMode(e.target.value)}
                    >
                      <MenuItem value="classification">Classification</MenuItem>
                      <MenuItem value="treeID">Tree ID</MenuItem>
                    </Select>
                  </FormControl>
                )}

                {pointCloud && filterMode === 'classification' && (
                  <Box sx={styles.classificationSection}>
                    <Typography variant="h6" sx={styles.classificationTitle}>
                      Classifications
                    </Typography>
                    <Box sx={styles.selectAllItem}>
                      <Typography variant="body2" sx={styles.selectAllText}>
                        Select All
                      </Typography>
                      <Checkbox
                        checked={Object.values(classifications).every(c => c.visible)}
                        indeterminate={Object.values(classifications).some(c => c.visible) && !Object.values(classifications).every(c => c.visible)}
                        onChange={handleToggleAllClassifications}
                        sx={styles.checkbox}
                      />
                    </Box>
                    {Object.entries(classifications).map(([id, classification]) => (
                      <Box key={id} sx={styles.classificationItem}>
                        <Box
                          sx={{
                            ...styles.classificationColor,
                            backgroundColor: `rgb(${classification.color[0] * 255}, ${classification.color[1] * 255}, ${classification.color[2] * 255})`
                          }}
                        />
                        <Typography variant="body2" sx={styles.classificationName}>
                          {classification.name}
                        </Typography>
                        <Checkbox
                          checked={classification.visible}
                          onChange={() => handleToggleClassification(id)}
                          sx={styles.checkbox}
                        />
                      </Box>
                    ))}
                  </Box>
                )}

                {pointCloud && filterMode === 'treeID' && (
                  <Box sx={styles.classificationSection}>
                    <Typography variant="h6" sx={styles.classificationTitle}>
                      Tree IDs ({Object.keys(treeIDs).length - 1} trees)
                    </Typography>
                    <Box sx={styles.selectAllItem}>
                      <Typography variant="body2" sx={styles.selectAllText}>
                        Select All
                      </Typography>
                      <Checkbox
                        checked={Object.values(treeIDs).every(t => t.visible)}
                        indeterminate={Object.values(treeIDs).some(t => t.visible) && !Object.values(treeIDs).every(t => t.visible)}
                        onChange={handleToggleAllTreeIDs}
                        sx={styles.checkbox}
                      />
                    </Box>
                    {Object.entries(treeIDs).map(([id, treeID]) => (
                      <Box key={id} sx={styles.classificationItem}>
                        <Box
                          sx={{
                            ...styles.classificationColor,
                            backgroundColor: `rgb(${treeID.color[0] * 255}, ${treeID.color[1] * 255}, ${treeID.color[2] * 255})`
                          }}
                        />
                        <Typography variant="body2" sx={styles.classificationName}>
                          {treeID.name}
                        </Typography>
                        <Checkbox
                          checked={treeID.visible}
                          onChange={() => handleToggleTreeID(id)}
                          sx={styles.checkbox}
                        />
                      </Box>
                    ))}
                  </Box>
                )}

                {pointCloud && (
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={showBoundingBox}
                        onChange={toggleBoundingBox}
                        sx={styles.checkbox}
                      />
                    }
                    label="Show Bounding Box"
                    sx={styles.checkboxLabel}
                  />
                )}

                {error && (
                  <Alert severity="error" sx={styles.errorAlert}>
                    {error}
                  </Alert>
                )}
              </Box>
            </Paper>
          </Box>

          {/* Main Viewer Area */}
          <Box sx={styles.renderArea}>
            <canvas
              ref={canvasRef}
              style={styles.canvas}
            />
          </Box>

          {/* Draggable MiniMap Toggle Button */}
          <Draggable
            nodeRef={draggableButtonRef}
            position={buttonPosition}
            onStart={handleDragStart}
            onStop={handleDragStop}
            bounds="parent"
          >
            <IconButton
              ref={draggableButtonRef}
              onClick={toggleMiniMap}
              sx={{
                position: 'absolute',
                bottom: '15px', 
                right: '15px',
                zIndex: 1002,
                backgroundColor: 'rgba(0, 0, 0, 0.1)',
                color: 'white',
                borderRadius: '50%',
                width: BUTTON_FIXED_SIZE,
                height: BUTTON_FIXED_SIZE,
                cursor: 'grab',
                '&:hover': {
                  backgroundColor: 'rgba(0, 0, 0, 0.3)',
                },
                boxShadow: '0 2px 5px rgba(0,0,0,0.3)',
              }}
              title={showMiniMap ? "Hide Mini-map (Drag to move)" : "Show Mini-map (Drag to move)"}
            >
              {showMiniMap ? <Close fontSize="small"/> : <Map fontSize="small"/>}
            </IconButton>
          </Draggable>

          {/* Mini-map Container */}
          {showMiniMap && (
            <Box sx={miniMapContainerStyle}>
              {isLoadingMiniMapFiles && (
                <Box sx={{display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%'}}>
                  <CircularProgress size={30} />
                </Box>
              )}
              {errorMiniMapFiles && !isLoadingMiniMapFiles && (
                 <Box sx={{display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '100%', padding: 1, textAlign: 'center'}}>
                    <Typography variant="caption" color="error" sx={{fontSize: '0.7rem'}}>Failed to load map data.</Typography>
                    <Typography variant="caption" color="error" sx={{fontSize: '0.65rem', wordBreak: 'break-all'}}>{errorMiniMapFiles.substring(0,100)}</Typography>
                 </Box>
              )}
              {!isLoadingMiniMapFiles && !errorMiniMapFiles && miniMapFiles.length > 0 && (
                <MiniMap
                  files={miniMapFiles}
                  currentFileId={fileId ? parseInt(fileId) : null}
                  mapHeight="100%"
                  mapWidth="100%"
                  colors={colors}
                />
              )}
               {!isLoadingMiniMapFiles && !errorMiniMapFiles && miniMapFiles.length === 0 && (
                 <Box sx={{display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', padding: 1}}>
                    <Typography variant="caption" color="textSecondary" sx={{fontSize: '0.75rem'}}>No geolocated sites found.</Typography>
                 </Box>
              )}
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  );
};

export default PointCloudViewer;
