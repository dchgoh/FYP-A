// Point cloud geometry management utilities

import * as THREE from 'three';
import { findClassificationByColor } from './classificationUtils';
import { createInitialTreeIDs, findTreeIDByID } from './treeIDUtils';

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

// In pointCloudManager.js

export const createPointCloudMaterial = () => {
  const vertexShader = `
    // ADD THIS UNIFORM
    uniform float u_pointSize;

    attribute float size;
    attribute vec3 customColor;
    varying vec3 vColor;
    varying vec3 vWorldPosition;

    void main() {
      vColor = customColor;
      vec4 worldPosition = modelMatrix * vec4(position, 1.0);
      vWorldPosition = worldPosition.xyz;
      vec4 mvPosition = viewMatrix * worldPosition;
      
      // REPLACE THE HARDCODED 10.0 with the new uniform
      gl_PointSize = size * (u_pointSize / -mvPosition.z);
      
      gl_Position = projectionMatrix * mvPosition;
    }
  `;

  const fragmentShader = `
    // The fragment shader does NOT need to be changed
    uniform vec3 color;
    uniform float opacity;
    varying vec3 vColor;
    varying vec3 vWorldPosition;
    uniform bool u_clippingEnabled;
    uniform vec3 u_clipBoxMin;
    uniform vec3 u_clipBoxMax;
    void main() {
      if (u_clippingEnabled) {
        if (vWorldPosition.x < u_clipBoxMin.x || vWorldPosition.x > u_clipBoxMax.x ||
            vWorldPosition.y < u_clipBoxMin.y || vWorldPosition.y > u_clipBoxMax.y ||
            vWorldPosition.z < u_clipBoxMin.z || vWorldPosition.z > u_clipBoxMax.z) {
          discard;
        }
      }
      vec2 center = gl_PointCoord - vec2(0.5);
      float dist = length(center);
      if (dist > 0.5) discard;
      if (dist > 0.45) {
        gl_FragColor = vec4(0.0, 0.0, 0.0, opacity);
      } else {
        gl_FragColor = vec4(vColor, opacity);
      }
    }
  `;

  return new THREE.ShaderMaterial({
    uniforms: {
      color: { value: new THREE.Color(0xffffff) },
      opacity: { value: 1.0 },
      u_clippingEnabled: { value: false },
      u_clipBoxMin: { value: new THREE.Vector3() },
      u_clipBoxMax: { value: new THREE.Vector3() },
      
      // ADD THE NEW UNIFORM HERE with a default value
      u_pointSize: { value: 10.0 },
    },
    vertexShader: vertexShader,
    fragmentShader: fragmentShader,
    transparent: false,
    depthWrite: true,
    depthTest: true,
  });
};

export const filterPointCloudByClassifications = (originalGeometry, classifications) => {
  if (!originalGeometry) return null;
  
  const positions = originalGeometry.attributes.position.array;
  const colors = originalGeometry.attributes.color.array;
  const customColors = originalGeometry.attributes.customColor.array;
  const sizes = originalGeometry.attributes.size.array;
  
  const newPositions = [];
  const newColors = [];
  const newCustomColors = [];
  const newSizes = [];
  
  for (let i = 0; i < positions.length; i += 3) {
    const r = colors[i], g = colors[i+1], b = colors[i+2];
    const { isVisible } = findClassificationByColor(r, g, b, classifications);
    
    if (isVisible) {
      const pointIndex = i / 3;
      newPositions.push(positions[i], positions[i+1], positions[i+2]);
      newColors.push(colors[i], colors[i+1], colors[i+2]);
      newCustomColors.push(customColors[i], customColors[i+1], customColors[i+2]);
      newSizes.push(sizes[pointIndex]);
    }
  }
  
  if (newPositions.length === 0) return new THREE.BufferGeometry();

  const finalGeometry = new THREE.BufferGeometry();
  finalGeometry.setAttribute('position', new THREE.Float32BufferAttribute(newPositions, 3));
  finalGeometry.setAttribute('color', new THREE.Float32BufferAttribute(newColors, 3));
  finalGeometry.setAttribute('customColor', new THREE.Float32BufferAttribute(newCustomColors, 3));
  finalGeometry.setAttribute('size', new THREE.Float32BufferAttribute(newSizes, 1));
  
  return finalGeometry;
};

export const filterPointCloudByTreeIDs = (originalGeometry, treeIDData, treeIDs) => {
  if (!originalGeometry || !treeIDData) return null;
  
  const positions = originalGeometry.attributes.position.array;
  const sizes = originalGeometry.attributes.size.array;
  
  const newPositions = [];
  const newColors = []; // Will be populated with Tree ID colors
  const newCustomColors = [];
  const newSizes = [];
  
  const uniqueTreeIDData = createInitialTreeIDs(treeIDData); // Get the color map

  for (let i = 0; i < positions.length; i += 3) {
    const pointIndex = i / 3;
    const treeID = treeIDData[pointIndex];
    const { isVisible } = findTreeIDByID(treeID, treeIDs);

    if (isVisible) {
      newPositions.push(positions[i], positions[i+1], positions[i+2]);
      newSizes.push(sizes[pointIndex]);
      
      const treeInfo = uniqueTreeIDData[treeID];
      if (treeInfo && treeInfo.color) {
        newColors.push(...treeInfo.color);
        newCustomColors.push(...treeInfo.color);
      } else {
        // Fallback color if something goes wrong
        newColors.push(0.5, 0.5, 0.5);
        newCustomColors.push(0.5, 0.5, 0.5);
      }
    }
  }

  if (newPositions.length === 0) return new THREE.BufferGeometry();

  const finalGeometry = new THREE.BufferGeometry();
  finalGeometry.setAttribute('position', new THREE.Float32BufferAttribute(newPositions, 3));
  finalGeometry.setAttribute('color', new THREE.Float32BufferAttribute(newColors, 3));
  finalGeometry.setAttribute('customColor', new THREE.Float32BufferAttribute(newCustomColors, 3));
  finalGeometry.setAttribute('size', new THREE.Float32BufferAttribute(newSizes, 1));
  
  return finalGeometry;
};

export const updatePointCloudGeometry = (pointCloud, newGeometry) => {
  if (!pointCloud || !newGeometry) return;
  
  // Dispose of old geometry
  pointCloud.geometry.dispose();
  
  // Set new geometry
  pointCloud.geometry = newGeometry;
};

// --- NEW HELPER FUNCTION: Point in Polygon Test ---
// A standard algorithm to check if a 2D point is inside a 2D polygon.
function isPointInPolygon(point, polygon) {
  let isInside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;

    const intersect = ((yi > point.y) !== (yj > point.y)) &&
      (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi);
    if (intersect) isInside = !isInside;
  }
  return isInside;
}


// --- NEW FILTERING FUNCTION ---
export const filterPointCloudByLasso = (pointCloud, lassoPoints, camera, canvasRect, treeIDData = null) => {
  const originalGeometry = pointCloud.geometry;
  if (!originalGeometry || !lassoPoints || lassoPoints.length === 0) {
    return null;
  }
  
  // Get ALL original attributes
  const positions = originalGeometry.attributes.position.array;
  const colors = originalGeometry.attributes.color.array;
  const customColors = originalGeometry.attributes.customColor.array;
  const sizes = originalGeometry.attributes.size.array;
  
  // Get treeID data if available (use passed parameter or try geometry attribute)
  const treeIDs = treeIDData || originalGeometry.attributes.treeID?.array || null;
  const originalClassifications = originalGeometry.attributes.originalClassification?.array || null;
  
  // Create arrays for ALL new attributes
  const newPositions = [];
  const newColors = [];
  const newCustomColors = [];
  const newSizes = [];
  const newTreeIDs = [];
  const newOriginalClassifications = [];
  
  const point = new THREE.Vector3();
  const worldMatrix = pointCloud.matrixWorld;

  for (let i = 0; i < positions.length; i += 3) {
    point.set(positions[i], positions[i+1], positions[i+2]).applyMatrix4(worldMatrix);
    const projectedPoint = point.clone().project(camera);

    if (projectedPoint.z > -1 && projectedPoint.z < 1) {
      const screenX = (projectedPoint.x + 1) * canvasRect.width / 2;
      const screenY = (-projectedPoint.y + 1) * canvasRect.height / 2;

      if (isPointInPolygon({x: screenX, y: screenY}, lassoPoints)) {
        const pointIndex = i / 3;
        // Copy POSITION
        newPositions.push(positions[i], positions[i+1], positions[i+2]);
        // Copy all other attributes
        newColors.push(colors[i], colors[i+1], colors[i+2]);
        newCustomColors.push(customColors[i], customColors[i+1], customColors[i+2]);
        newSizes.push(sizes[pointIndex]);
        
        // Copy treeID data if available
        if (treeIDs) {
          newTreeIDs.push(treeIDs[pointIndex] || 0);
        }
        
        // Copy original classification data if available
        if (originalClassifications) {
          newOriginalClassifications.push(
            originalClassifications[i], 
            originalClassifications[i+1], 
            originalClassifications[i+2]
          );
        }
      }
    }
  }

  if (newPositions.length === 0) return new THREE.BufferGeometry();

  const finalGeometry = new THREE.BufferGeometry();
  finalGeometry.setAttribute('position', new THREE.Float32BufferAttribute(newPositions, 3));
  finalGeometry.setAttribute('color', new THREE.Float32BufferAttribute(newColors, 3));
  finalGeometry.setAttribute('customColor', new THREE.Float32BufferAttribute(newCustomColors, 3));
  finalGeometry.setAttribute('size', new THREE.Float32BufferAttribute(newSizes, 1));
  
  // Store treeID data as a custom attribute if available
  if (newTreeIDs.length > 0) {
    finalGeometry.setAttribute('treeID', new THREE.Float32BufferAttribute(newTreeIDs, 1));
  }
  
  // Store original classification data as a custom attribute if available
  if (newOriginalClassifications.length > 0) {
    finalGeometry.setAttribute('originalClassification', new THREE.Float32BufferAttribute(newOriginalClassifications, 3));
  }
  
  return finalGeometry;
};