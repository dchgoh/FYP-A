import * as THREE from 'three';
import { DragControls } from 'three/examples/jsm/controls/DragControls';

// Encapsulates drag controls and wheel zoom for the point cloud viewer
export function createPointCloudControls(camera, domElement) {
  let dragControls = null;
  let minDistance = 1;
  let maxDistance = 1000;

  const handleWheel = (event) => {
    event.preventDefault();
    if (!camera) return;
    const delta = Math.sign(event.deltaY);
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    const currentDistance = camera.position.length();
    const targetDistance = THREE.MathUtils.clamp(
      currentDistance + delta * (currentDistance * 0.1),
      minDistance,
      maxDistance
    );
    const newPosition = forward.clone().multiplyScalar(targetDistance).negate();
    camera.position.copy(newPosition);
    camera.lookAt(0, 0, 0);
  };

  domElement.addEventListener('wheel', handleWheel, { passive: false });

  function setDistanceBounds(min, max) {
    minDistance = Math.max(0.0001, min || 1);
    maxDistance = Math.max(minDistance + 1, max || 1000);
  }

  function setDragObjects(objects) {
    if (dragControls) {
      dragControls.dispose();
      dragControls = null;
    }
    const list = Array.isArray(objects) ? objects : [];
    if (list.length > 0) {
      dragControls = new DragControls(list, camera, domElement);
      dragControls.addEventListener('dragstart', () => {
        domElement.style.cursor = 'grabbing';
      });
      dragControls.addEventListener('dragend', () => {
        domElement.style.cursor = 'default';
      });
    }
  }

  function dispose() {
    if (dragControls) {
      dragControls.dispose();
      dragControls = null;
    }
    domElement.removeEventListener('wheel', handleWheel);
  }

  return { setDistanceBounds, setDragObjects, dispose };
}


