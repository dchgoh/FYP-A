import React, { useState, useRef, useEffect } from 'react';
import { Box, Button, Typography, Paper, Alert, CircularProgress, useTheme } from '@mui/material';
import { tokens } from '../../theme';
import { CloudUpload } from '@mui/icons-material';
import * as THREE from 'three';
import { createSceneManager } from './scene_manager';
import { createBoundingBox, updateBoundingBoxVisibility, disposeBoundingBox } from './pointcloud_boundingbox';
import { createStyles, getResponsiveMarginLeft } from './pointcloud_viewer.styles';
import { createInitialClassifications, toggleClassification } from './classificationUtils';
import { parseLASFile } from './lasParser';
import { createPointCloudGeometry, createPointCloudMaterial, filterPointCloudByClassifications, updatePointCloudGeometry } from './pointCloudManager';

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
  const [originalGeometry, setOriginalGeometry] = useState(null);

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
      const { points, colors, numberOfPointRecords } = await parseLASFile(file);
      
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
      
      // Store original geometry for classification filtering
      setOriginalGeometry(geometry.clone());

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
                    
                    {selectedFile && (
                      <Typography variant="body1" sx={styles.selectedFileTextTop}>
                        📁 {selectedFile.name}
                      </Typography>
                    )}
                    
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
                
                {pointCloud && (
                  <Button
                    variant="outlined"
                    onClick={toggleBoundingBox}
                    sx={styles.visibilityButton}
                    fullWidth
                  >
                    {showBoundingBox ? 'Hide' : 'Show'} Bounding Box
                  </Button>
                )}

                {pointCloud && (
                  <Box sx={styles.classificationSection}>
                    <Typography variant="h6" sx={styles.classificationTitle}>
                      Classifications
                    </Typography>
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
                        <Button
                          size="small"
                          variant={classification.visible ? "contained" : "outlined"}
                          onClick={() => handleToggleClassification(id)}
                          sx={styles.classificationToggle}
                        >
                          {classification.visible ? 'Hide' : 'Show'}
                        </Button>
                      </Box>
                    ))}
                  </Box>
                )}

                {error && (
                  <Alert severity="error" sx={styles.errorAlert}>
                    {error}
                  </Alert>
                )}

                {isLoading && (
                  <Box sx={styles.loadingContainer}>
                    <CircularProgress size={16} />
                    <Typography variant="body2" sx={styles.loadingText}>
                      Loading...
                    </Typography>
                  </Box>
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
