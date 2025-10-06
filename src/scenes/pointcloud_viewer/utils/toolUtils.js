import * as THREE from 'three';
import { parseLASFile } from '../lasParser';
import { createPointCloudMaterial } from '../pointCloudManager';
import { createInitialClassifications } from '../classificationUtils';
import { createInitialTreeIDs } from '../treeIDUtils';

// Tool management functions
export const handleToolSelect = (setActiveTool) => (toolName) => {
  setActiveTool(prev => (prev === toolName ? null : toolName));
};

export const handleFileUpload = (setPointCloud, setOriginalGeometry, setClassifications, setTreeIDs, setTreeIDData, setParts, setActivePartId, setError, setIsLoading) => async (event) => {
  const file = event.target.files[0];
  if (!file) return;

  setIsLoading(true);
  setError(null);

  try {
    const geometry = await parseLASFile(file);
    
    // Create point cloud material
    const material = createPointCloudMaterial();
    
    // Create point cloud
    const newPointCloud = new THREE.Points(geometry, material);
    
    // Update state
    setPointCloud(newPointCloud);
    setOriginalGeometry(geometry);
    
    // Reset classifications and tree IDs
    setClassifications(createInitialClassifications());
    setTreeIDs(createInitialTreeIDs());
    setTreeIDData(null);
    
    // Reset parts
    setParts([]);
    setActivePartId(null);
    
  } catch (error) {
    console.error('Error loading file:', error);
    setError('Failed to load point cloud file');
  } finally {
    setIsLoading(false);
  }
};

export const toggleBoundingBox = (setShowBoundingBox) => () => {
  setShowBoundingBox(prev => !prev);
};

export const handleToggleClassification = (setClassifications) => (id) => {
  setClassifications(prev => ({
    ...prev,
    [id]: {
      ...prev[id],
      visible: !prev[id].visible
    }
  }));
};

export const handleToggleAllClassifications = (setClassifications, classifications) => () => {
  const allVisible = Object.values(classifications).every(c => c.visible);
  const newVisibility = !allVisible;
  
  const updatedClassifications = {};
  Object.keys(classifications).forEach(id => {
    updatedClassifications[id] = {
      ...classifications[id],
      visible: newVisibility
    };
  });
  
  setClassifications(updatedClassifications);
};

export const handleToggleTreeID = (setTreeIDs) => (id) => {
  setTreeIDs(prev => ({
    ...prev,
    [id]: {
      ...prev[id],
      visible: !prev[id].visible
    }
  }));
};

export const handleToggleAllTreeIDs = (setTreeIDs, treeIDs) => () => {
  const allVisible = Object.values(treeIDs).every(t => t.visible);
  const newVisibility = !allVisible;
  
  const updatedTreeIDs = {};
  Object.keys(treeIDs).forEach(id => {
    updatedTreeIDs[id] = {
      ...treeIDs[id],
      visible: newVisibility
    };
  });
  
  setTreeIDs(updatedTreeIDs);
};
