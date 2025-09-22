import React, { useState, useRef, useEffect } from 'react';
import { Box, Button, Typography, Paper, Alert, CircularProgress, useTheme, FormControlLabel, Checkbox, FormControl, InputLabel, Select, MenuItem } from '@mui/material';
import { tokens } from '../../theme';
import { CloudUpload } from '@mui/icons-material';
import * as THREE from 'three';
import { createSceneManager } from './scene_manager';
import { createBoundingBox, updateBoundingBoxVisibility, disposeBoundingBox } from './pointcloud_boundingbox';
import { createStyles, getResponsiveMarginLeft } from './pointcloud_viewer.styles';
import { createInitialClassifications, toggleClassification } from './classificationUtils';
import { createInitialTreeIDs, toggleTreeID } from './treeIDUtils';
import { parseLASFile } from './lasParser';
import { createPointCloudGeometry, createPointCloudMaterial, filterPointCloudByClassifications, filterPointCloudByTreeIDs, updatePointCloudGeometry } from './pointCloudManager';

const PointCloudViewer = ({ isCollapsed }) => {
  const theme = useTheme();
  const colors = tokens(theme.palette.mode);
  const styles = createStyles(theme, colors);
  const canvasRef = useRef(null);
  const sceneManagerRef = useRef(null);
  const minDistanceRef = useRef(1);
  const maxDistanceRef = useRef(1000);

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

    if (!file.name.toLowerCase().endsWith('.las') && !file.name.toLowerCase().endsWith('.laz')) {
      setError('Please select a LAS or LAZ file');
      return;
    }

    setSelectedFile(file);
    setError(null);
    setIsLoading(true);

    try {
      const { points, colors, treeIDs, numberOfPointRecords } = await parseLASFile(file);
      
      // Remove existing point cloud (bounding box will be removed with it as a child)
      if (pointCloud) {
        disposeBoundingBox(boundingBox);
        sceneManagerRef.current.scene.remove(pointCloud);
        setBoundingBox(null);
      }

      // Create new point cloud using utilities
      const geometry = createPointCloudGeometry(points, colors);
      const material = createPointCloudMaterial();
      const newPointCloud = new THREE.Points(geometry, material);
      
      sceneManagerRef.current.scene.add(newPointCloud);
      setPointCloud(newPointCloud);
      
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
    } catch (err) {
      setError(`Error parsing file: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
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
      sx={{
        ...styles.container,
        marginLeft: getResponsiveMarginLeft(isCollapsed)
      }}
    >
      <Box sx={styles.content}>
        <Box sx={styles.viewerWrapper}>
          {/* Left Controls Sidebar */}
          <Box sx={styles.controlsSidebar}>
            <Paper sx={styles.controlsPaper}>
                    <Typography variant="h6" sx={styles.controlsTitle}>
                      Point Cloud Controls
                    </Typography>
                    
                    <Box sx={styles.controlsContent}>
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
                
                {selectedFile && (
                  <Typography variant="body1" sx={styles.selectedFileText}>
                    File Name: {selectedFile.name}
                  </Typography>
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
        </Box>
      </Box>
    </Box>
  );
};

export default PointCloudViewer;
