import * as THREE from 'three';

// Creates a non-interactive bounding box for a point cloud
export function createBoundingBox(geometry, visible = true) {
  // Create bounding box geometry
  const boxGeometry = new THREE.BoxGeometry(
    geometry.boundingBox.max.x - geometry.boundingBox.min.x,
    geometry.boundingBox.max.y - geometry.boundingBox.min.y,
    geometry.boundingBox.max.z - geometry.boundingBox.min.z
  );
  
  // Create wireframe material
  const boxMaterial = new THREE.LineBasicMaterial({ 
    color: 0x00ff00, 
    linewidth: 2 
  });
  
  // Create line segments for wireframe
  const box = new THREE.LineSegments(
    new THREE.EdgesGeometry(boxGeometry),
    boxMaterial
  );
  
  // Position the box at the center of the point cloud (relative to the point cloud)
  box.position.copy(geometry.boundingBox.getCenter(new THREE.Vector3()));
  box.visible = visible;
  
  // Make bounding box non-interactive
  box.userData = { isBoundingBox: true };
  box.raycast = () => {}; // Disable raycasting for the bounding box
  box.traverse((child) => {
    child.userData = { isBoundingBox: true };
    child.raycast = () => {}; // Disable raycasting for all children
  });
  
  return box;
}

// Updates the visibility of an existing bounding box
export function updateBoundingBoxVisibility(boundingBox, visible) {
  if (boundingBox) {
    boundingBox.visible = visible;
  }
}

// Disposes of a bounding box
export function disposeBoundingBox(boundingBox) {
  if (boundingBox) {
    boundingBox.geometry.dispose();
    boundingBox.material.dispose();
  }
}
