import * as THREE from 'three';
import { createPointCloudControls } from './pointcloud_controls';
import { createCamera, setCameraTopView, handleCameraResize } from './camera_manager';

// Scene management for point cloud viewer
export function createSceneManager(canvas) {
  // Scene setup
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1a1a);

  // Camera setup
  const camera = createCamera(canvas);

  // Renderer setup
  const renderer = new THREE.WebGLRenderer({ 
    canvas: canvas,
    antialias: true,
    alpha: false,
    powerPreference: "high-performance"
  });
  renderer.setSize(canvas.clientWidth, canvas.clientHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = false;

  // Lighting
  const ambientLight = new THREE.AmbientLight(0x404040, 0.6);
  scene.add(ambientLight);

  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
  directionalLight.position.set(1, 1, 1);
  scene.add(directionalLight);

  // Setup controls module (drag + wheel zoom)
  const controls = createPointCloudControls(camera, renderer.domElement);

  // Animation loop
  let animationId = null;
  let lastTime = 0;
  
  const animate = (currentTime) => {
    animationId = requestAnimationFrame(animate);
    
    // Throttle updates to 60fps
    if (currentTime - lastTime >= 16.67) {
      renderer.render(scene, camera);
      lastTime = currentTime;
    }
  };

  // Handle window resize
  const handleResize = () => {
    handleCameraResize(camera, canvas);
    renderer.setSize(canvas.clientWidth, canvas.clientHeight);
  };

  window.addEventListener('resize', handleResize);

  // Start animation
  const startAnimation = () => {
    animate(0);
  };

  // Dispose function
  const dispose = () => {
    window.removeEventListener('resize', handleResize);
    if (animationId) {
      cancelAnimationFrame(animationId);
    }
    if (controls) {
      controls.dispose();
    }
    if (renderer) {
      renderer.dispose();
    }
  };

  return {
    scene,
    camera,
    renderer,
    controls,
    startAnimation,
    dispose,
    setCameraTopView: (geometry) => setCameraTopView(camera, geometry)
  };
}
