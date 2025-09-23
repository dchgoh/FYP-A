// Point cloud geometry management utilities

import * as THREE from 'three';
import { findClassificationByColor } from './classificationUtils';
import { findTreeIDByID } from './treeIDUtils';

export const createPointCloudGeometry = (points, colors) => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

  // Add size attribute for each point (for shader)
  const pointCount = points.length / 3;
  const sizes = new Float32Array(pointCount);
  const customColors = new Float32Array(colors);
  
  // Set size for each point (original size)
  for (let i = 0; i < pointCount; i++) {
    sizes[i] = 10.0; // Original size
  }
  
  geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('customColor', new THREE.BufferAttribute(customColors, 3));
  
  // Normalize the geometry to center it
  geometry.computeBoundingBox();
  const center = geometry.boundingBox.getCenter(new THREE.Vector3());
  geometry.translate(-center.x, -center.y, -center.z);
  
  // Compute bounding sphere for better culling
  geometry.computeBoundingSphere();
  
  return geometry;
};

export const createPointCloudMaterial = () => {
  // Custom shader material for point cloud with border
  const vertexShader = `
    attribute float size;
    attribute vec3 customColor;
    varying vec3 vColor;
    void main() {
      vColor = customColor;
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      gl_PointSize = size * (10.0 / -mvPosition.z);
      gl_Position = projectionMatrix * mvPosition;
    }
  `;

  const fragmentShader = `
    uniform vec3 color;
    uniform float opacity;
    varying vec3 vColor;
    void main() {
      // Create a circular point with thin border
      vec2 center = gl_PointCoord - vec2(0.5);
      float dist = length(center);
      
      // Discard pixels outside the circle to make it truly circular
      if (dist > 0.5) {
        discard;
      }
      
      // Thin border effect
      if (dist > 0.45) {
        // Border color (dark)
        gl_FragColor = vec4(0.0, 0.0, 0.0, opacity);
      } else if (dist > 0.42) {
        // Smooth transition for thin border
        float alpha = smoothstep(0.42, 0.45, dist);
        gl_FragColor = mix(vec4(vColor, opacity), vec4(0.0, 0.0, 0.0, opacity), alpha);
      } else {
        // Main point color
        gl_FragColor = vec4(vColor, opacity);
      }
    }
  `;

  return new THREE.ShaderMaterial({
    uniforms: {
      color: { value: new THREE.Color(0xffffff) },
      opacity: { value: 1.0 }
    },
    vertexShader: vertexShader,
    fragmentShader: fragmentShader,
    transparent: false,
    depthWrite: true,
    depthTest: true,
    blending: THREE.NormalBlending,
    side: THREE.DoubleSide
  });
};

export const filterPointCloudByClassifications = (originalGeometry, classifications) => {
  if (!originalGeometry) return null;
  
  // Clone the original geometry to work with
  const newGeometry = originalGeometry.clone();
  const positions = newGeometry.attributes.position.array;
  const colors = newGeometry.attributes.color.array;
  const sizes = newGeometry.attributes.size ? newGeometry.attributes.size.array : null;
  
  let visiblePointCount = 0;
  
  // Create new arrays for visible points only
  const newPositions = new Float32Array(positions.length);
  const newColors = new Float32Array(colors.length);
  const newSizes = sizes ? new Float32Array(sizes.length) : null;
  const newCustomColors = new Float32Array(colors.length);
  
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
      
      newCustomColors[newIndex] = r;
      newCustomColors[newIndex + 1] = g;
      newCustomColors[newIndex + 2] = b;
      
      if (newSizes) {
        newSizes[visiblePointCount] = sizes[pointIndex];
      }
      
      visiblePointCount++;
    }
  }
  
  // Create final geometry with only visible points
  const finalGeometry = new THREE.BufferGeometry();
  
  if (visiblePointCount > 0) {
    finalGeometry.setAttribute('position', new THREE.Float32BufferAttribute(newPositions.slice(0, visiblePointCount * 3), 3));
    finalGeometry.setAttribute('color', new THREE.Float32BufferAttribute(newColors.slice(0, visiblePointCount * 3), 3));
    finalGeometry.setAttribute('customColor', new THREE.Float32BufferAttribute(newCustomColors.slice(0, visiblePointCount * 3), 3));
    
    if (newSizes) {
      finalGeometry.setAttribute('size', new THREE.BufferAttribute(newSizes.slice(0, visiblePointCount), 1));
    }
  } else {
    // If no points are visible, create empty geometry with at least one point to avoid errors
    const emptyPositions = new Float32Array([0, 0, 0]);
    const emptyColors = new Float32Array([0, 0, 0]);
    const emptySizes = new Float32Array([1]);
    finalGeometry.setAttribute('position', new THREE.Float32BufferAttribute(emptyPositions, 3));
    finalGeometry.setAttribute('color', new THREE.Float32BufferAttribute(emptyColors, 3));
    finalGeometry.setAttribute('customColor', new THREE.Float32BufferAttribute(emptyColors, 3));
    finalGeometry.setAttribute('size', new THREE.BufferAttribute(emptySizes, 1));
  }
  
  return finalGeometry;
};

export const filterPointCloudByTreeIDs = (originalGeometry, treeIDs, treeIDData) => {
  if (!originalGeometry || !treeIDData) return null;
  
  // Clone the original geometry to work with
  const newGeometry = originalGeometry.clone();
  const positions = newGeometry.attributes.position.array;
  const colors = newGeometry.attributes.color.array;
  const sizes = newGeometry.attributes.size ? newGeometry.attributes.size.array : null;
  
  let visiblePointCount = 0;
  
  // Create new arrays for visible points only
  const newPositions = new Float32Array(positions.length);
  const newColors = new Float32Array(colors.length);
  const newSizes = sizes ? new Float32Array(sizes.length) : null;
  const newCustomColors = new Float32Array(colors.length);
  
  // Filter points based on treeID visibility
  for (let i = 0; i < positions.length; i += 3) {
    const pointIndex = i / 3;
    const colorIndex = pointIndex * 3;
    const treeID = treeIDs[pointIndex];
    
    // Find matching treeID
    const { id: treeIDValue, isVisible } = findTreeIDByID(treeID, treeIDData);
    
    // Only include visible points
    if (isVisible) {
      const newIndex = visiblePointCount * 3;
      newPositions[newIndex] = positions[i];
      newPositions[newIndex + 1] = positions[i + 1];
      newPositions[newIndex + 2] = positions[i + 2];
      
      // Use treeID colors instead of classification colors
      const treeIDInfo = treeIDData[treeIDValue];
      if (treeIDInfo && treeIDInfo.color) {
        newColors[newIndex] = treeIDInfo.color[0];
        newColors[newIndex + 1] = treeIDInfo.color[1];
        newColors[newIndex + 2] = treeIDInfo.color[2];
        
        newCustomColors[newIndex] = treeIDInfo.color[0];
        newCustomColors[newIndex + 1] = treeIDInfo.color[1];
        newCustomColors[newIndex + 2] = treeIDInfo.color[2];
      } else {
        // Fallback to original colors if treeID color not found
        newColors[newIndex] = colors[colorIndex];
        newColors[newIndex + 1] = colors[colorIndex + 1];
        newColors[newIndex + 2] = colors[colorIndex + 2];
        
        newCustomColors[newIndex] = colors[colorIndex];
        newCustomColors[newIndex + 1] = colors[colorIndex + 1];
        newCustomColors[newIndex + 2] = colors[colorIndex + 2];
      }
      
      if (newSizes) {
        newSizes[visiblePointCount] = sizes[pointIndex];
      }
      
      visiblePointCount++;
    }
  }
  
  // Create final geometry with only visible points
  const finalGeometry = new THREE.BufferGeometry();
  
  if (visiblePointCount > 0) {
    finalGeometry.setAttribute('position', new THREE.Float32BufferAttribute(newPositions.slice(0, visiblePointCount * 3), 3));
    finalGeometry.setAttribute('color', new THREE.Float32BufferAttribute(newColors.slice(0, visiblePointCount * 3), 3));
    finalGeometry.setAttribute('customColor', new THREE.Float32BufferAttribute(newCustomColors.slice(0, visiblePointCount * 3), 3));
    
    if (newSizes) {
      finalGeometry.setAttribute('size', new THREE.BufferAttribute(newSizes.slice(0, visiblePointCount), 1));
    }
  } else {
    // If no points are visible, create empty geometry with at least one point to avoid errors
    const emptyPositions = new Float32Array([0, 0, 0]);
    const emptyColors = new Float32Array([0, 0, 0]);
    const emptySizes = new Float32Array([1]);
    finalGeometry.setAttribute('position', new THREE.Float32BufferAttribute(emptyPositions, 3));
    finalGeometry.setAttribute('color', new THREE.Float32BufferAttribute(emptyColors, 3));
    finalGeometry.setAttribute('customColor', new THREE.Float32BufferAttribute(emptyColors, 3));
    finalGeometry.setAttribute('size', new THREE.BufferAttribute(emptySizes, 1));
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
