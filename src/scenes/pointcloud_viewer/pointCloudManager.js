// Point cloud geometry management utilities

import * as THREE from 'three';
import { findClassificationByColor } from './classificationUtils';

export const createPointCloudGeometry = (points, colors) => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  
  // Normalize the geometry to center it
  geometry.computeBoundingBox();
  const center = geometry.boundingBox.getCenter(new THREE.Vector3());
  geometry.translate(-center.x, -center.y, -center.z);
  
  // Compute bounding sphere for better culling
  geometry.computeBoundingSphere();
  
  return geometry;
};

export const createPointCloudMaterial = () => {
  return new THREE.PointsMaterial({
    size: 2,
    vertexColors: true,
    sizeAttenuation: false,
    transparent: false,
    depthWrite: true,
    depthTest: true,
    blending: THREE.NormalBlending,
    map: null
  });
};

export const filterPointCloudByClassifications = (originalGeometry, classifications) => {
  if (!originalGeometry) return null;
  
  // Clone the original geometry to work with
  const newGeometry = originalGeometry.clone();
  const positions = newGeometry.attributes.position.array;
  const colors = newGeometry.attributes.color.array;
  
  let visiblePointCount = 0;
  
  // Create new arrays for visible points only
  const newPositions = new Float32Array(positions.length);
  const newColors = new Float32Array(colors.length);
  
  // Filter points based on classification visibility
  for (let i = 0; i < positions.length; i += 3) {
    const pointIndex = i / 3;
    const colorIndex = pointIndex * 3;
    
    const r = colors[colorIndex];
    const g = colors[colorIndex + 1];
    const b = colors[colorIndex + 2];
    
    // Find matching classification
    const { id: classificationId, isVisible } = findClassificationByColor(r, g, b, classifications);
    
    // Only include visible points
    if (isVisible) {
      const newIndex = visiblePointCount * 3;
      newPositions[newIndex] = positions[i];
      newPositions[newIndex + 1] = positions[i + 1];
      newPositions[newIndex + 2] = positions[i + 2];
      
      newColors[newIndex] = r;
      newColors[newIndex + 1] = g;
      newColors[newIndex + 2] = b;
      
      visiblePointCount++;
    }
  }
  
  // Create final geometry with only visible points
  const finalGeometry = new THREE.BufferGeometry();
  
  if (visiblePointCount > 0) {
    finalGeometry.setAttribute('position', new THREE.Float32BufferAttribute(newPositions.slice(0, visiblePointCount * 3), 3));
    finalGeometry.setAttribute('color', new THREE.Float32BufferAttribute(newColors.slice(0, visiblePointCount * 3), 3));
  } else {
    // If no points are visible, create empty geometry with at least one point to avoid errors
    const emptyPositions = new Float32Array([0, 0, 0]);
    const emptyColors = new Float32Array([0, 0, 0]);
    finalGeometry.setAttribute('position', new THREE.Float32BufferAttribute(emptyPositions, 3));
    finalGeometry.setAttribute('color', new THREE.Float32BufferAttribute(emptyColors, 3));
  }
  
  return finalGeometry;
};

export const updatePointCloudGeometry = (pointCloud, newGeometry) => {
  if (!pointCloud || !newGeometry) return;
  
  // Dispose of old geometry
  pointCloud.geometry.dispose();
  
  // Set new geometry
  pointCloud.geometry = newGeometry;
};
