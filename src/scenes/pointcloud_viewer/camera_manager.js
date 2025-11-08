import * as THREE from 'three';

// Camera management for point cloud viewer
export function createCamera(canvas) {
  const camera = new THREE.PerspectiveCamera(
    60,
    canvas.clientWidth / canvas.clientHeight,
    0.01,
    10000
  );
  camera.position.set(0, 0, 10);
  return camera;
}

// Set camera to top view for point cloud
export function setCameraTopView(camera, geometry) {
  if (!geometry.boundingSphere) {
    geometry.computeBoundingSphere();
  }
  const { center, radius } = geometry.boundingSphere;
  const distance = radius * 3;
  
  // Set camera position for top view (looking down from above)
  camera.position.set(center.x, center.y, center.z + distance); // Position camera above on Z-axis relative to geometry center
  camera.up.set(0, 1, 0); // Set up vector to Y-axis for proper orientation
  camera.lookAt(center);
  
  // Calculate distance bounds
  const minDistance = Math.max(0.1, radius * 0.5);
  const maxDistance = Math.max(minDistance + 1, radius * 6);
  
  return { minDistance, maxDistance };
}

// Handle camera resize
export function handleCameraResize(camera, canvas) {
  if (canvas) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
}
