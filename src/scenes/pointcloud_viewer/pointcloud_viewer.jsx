import React, { useState, useRef, useEffect } from 'react';
import { Box, Button, Typography, Paper, Alert, CircularProgress, useTheme } from '@mui/material';
import { tokens } from '../../theme';
import { CloudUpload } from '@mui/icons-material';
import * as THREE from 'three';
import { createSceneManager } from './scene_manager';
import { createBoundingBox, updateBoundingBoxVisibility, disposeBoundingBox } from './pointcloud_boundingbox';
import { createStyles, getResponsiveMarginLeft } from './pointcloud_viewer.styles';

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

  // Parse LAS/LAZ file
  const parseLASFile = async (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const arrayBuffer = e.target.result;
          const dataView = new DataView(arrayBuffer);
          
          // Basic LAS file parsing (simplified)
          // LAS file format: https://www.asprs.org/wp-content/uploads/2010/12/LAS_1_4_r13.pdf
          
          // Check LAS signature
          const signature = String.fromCharCode(
            dataView.getUint8(0),
            dataView.getUint8(1),
            dataView.getUint8(2),
            dataView.getUint8(3)
          );
          
          if (signature !== 'LASF') {
            throw new Error('Invalid LAS file format');
          }

          // Read header information
          const versionMajor = dataView.getUint8(24);
          const versionMinor = dataView.getUint8(25);
          const pointDataRecordFormat = dataView.getUint8(104);
          const pointDataRecordLength = dataView.getUint16(105, true);
          const numberOfPointRecords = dataView.getUint32(107, true);
          
          // Read scale factors and offsets
          const xScale = dataView.getFloat64(131, true);
          const yScale = dataView.getFloat64(139, true);
          const zScale = dataView.getFloat64(147, true);
          const xOffset = dataView.getFloat64(155, true);
          const yOffset = dataView.getFloat64(163, true);
          const zOffset = dataView.getFloat64(171, true);
          
          // Calculate point data offset
          const pointDataOffset = dataView.getUint32(96, true);
          
          // Classification scheme (matching Potree viewer)
          const classificationScheme = {
            0: { name: "Unclassified", color: [0.75, 0.75, 0.75] },
            1: { name: "Low-vegetation", color: [0.6, 0.8, 0.2] },
            2: { name: "Terrain", color: [0.545, 0.271, 0.075] },
            3: { name: "Out-points", color: [1.0, 0.0, 1.0] },
            4: { name: "Stem", color: [0.627, 0.322, 0.176] },
            5: { name: "Live branches", color: [0.133, 0.545, 0.133] },
            6: { name: "Woody branches", color: [0.36, 0.25, 0.2] },
          };

          // Parse point data
          const points = [];
          const colors = [];
          const maxPoints = Math.min(numberOfPointRecords, 1000000);
          
          for (let i = 0; i < maxPoints; i++) { // Limit to 1M points for performance
            // Log progress every 100k points
            if (i % 100000 === 0 && i > 0) {
              console.log(`Parsing progress: ${i}/${maxPoints} points (${Math.round(i/maxPoints*100)}%)`);
            }
            const offset = pointDataOffset + (i * pointDataRecordLength);
            
            // Read X, Y, Z coordinates
            const xInt = dataView.getInt32(offset, true);
            const yInt = dataView.getInt32(offset + 4, true);
            const zInt = dataView.getInt32(offset + 8, true);
            
            // Convert to real coordinates
            const x = xInt * xScale + xOffset;
            const y = yInt * yScale + yOffset;
            const z = zInt * zScale + zOffset;
            
            points.push(x, y, z);
            
            // Read classification (byte 15 in LAS format)
            const classification = dataView.getUint8(offset + 15);
            
            // Get color based on classification
            const classificationData = classificationScheme[classification] || classificationScheme[0];
            colors.push(classificationData.color[0], classificationData.color[1], classificationData.color[2]);
          }
          
          console.log(`Parsed ${points.length / 3} points out of ${numberOfPointRecords} total points in file`);
          resolve({ points, colors, numberOfPointRecords });
        } catch (error) {
          reject(error);
        }
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsArrayBuffer(file);
    });
  };

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

      // Create new point cloud
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      
      // Normalize the geometry to center it
      geometry.computeBoundingBox();
      const center = geometry.boundingBox.getCenter(new THREE.Vector3());
      geometry.translate(-center.x, -center.y, -center.z);
      
      // Compute bounding sphere for better culling
      geometry.computeBoundingSphere();

      const material = new THREE.PointsMaterial({
        size: 2,
        vertexColors: true,
        sizeAttenuation: false,
        transparent: false,
        depthWrite: true,
        depthTest: true,
        blending: THREE.NormalBlending,
        map: null
      });

      const newPointCloud = new THREE.Points(geometry, material);
      sceneManagerRef.current.scene.add(newPointCloud);
      setPointCloud(newPointCloud);

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

  return (
    <Box 
      sx={{
        ...styles.container,
        marginLeft: getResponsiveMarginLeft(isCollapsed)
      }}
    >
      <Box sx={styles.content}>
        <Box sx={styles.header}>
          <Typography variant="h2" sx={styles.title}>
            Point Cloud Viewer
          </Typography>
        </Box>

        <Box sx={styles.uploadSection}>
          <Paper sx={styles.uploadPaper}>
            <Box sx={styles.uploadContent}>
              <Typography variant="h4" sx={styles.uploadTitle}>
                Upload LAS/LAZ File
              </Typography>
              
              <Box sx={styles.buttonContainer}>
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
                  >
                    Choose LAS/LAZ File
                  </Button>
                </label>
                
                {pointCloud && (
                  <Button
                    variant="contained"
                    onClick={toggleBoundingBox}
                    sx={styles.visibilityButton}
                  >
                    {showBoundingBox ? 'Hide' : 'Show'} Bounding Box
                  </Button>
                )}
              </Box>

              {selectedFile && (
                <Typography variant="body1" sx={styles.selectedFileText}>
                  Selected file: {selectedFile.name}
                </Typography>
              )}

              {error && (
                <Alert severity="error" sx={styles.errorAlert}>
                  {error}
                </Alert>
              )}

              {isLoading && (
                <Box sx={styles.loadingContainer}>
                  <CircularProgress size={20} />
                  <Typography variant="body2" sx={styles.loadingText}>
                    Loading point cloud...
                  </Typography>
                </Box>
              )}
            </Box>
          </Paper>

          <Box sx={styles.canvasSection}>
            <Paper sx={styles.canvasPaper}>
              <canvas
                ref={canvasRef}
                style={styles.canvas}
              />
            </Paper>
          </Box>

        </Box>
      </Box>
    </Box>
  );
};

export default PointCloudViewer;