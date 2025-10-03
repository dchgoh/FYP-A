// src/scenes/pointcloud_viewer/SelectionHelper.js

import * as THREE from 'three';

/**
 * Creates a helper for selecting a 3D box region in the scene.
 * @param {THREE.Camera} camera - The perspective camera.
 * @param {THREE.Scene} scene - The main scene.
 * @param {HTMLElement} domElement - The renderer's canvas element.
 * @param {THREE.Object3D} targetObject - The object to raycast against (the point cloud).
 * @param {function} onSelectionChange - Callback when selection is being updated.
 * @param {function} onSelectionFinish - Callback when selection is finished, returns the final THREE.Box3.
 */
export function createSelectionHelper(camera, scene, domElement, targetObject, onSelectionChange, onSelectionFinish) {
  // --- FIXED LINE: Changed THREE.raycaster to THREE.Raycaster ---
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  
  let isSelecting = false;
  let startPoint = new THREE.Vector3();
  let endPoint = new THREE.Vector3();

  const selectionBox = new THREE.Box3();
  const boxHelper = new THREE.Box3Helper(selectionBox, 0xff00ff); // Magenta color
  boxHelper.visible = false;
  scene.add(boxHelper);

  const onPointerDown = (event) => {
    // Prevent default browser actions and stop camera controls from interfering
    event.preventDefault();
    event.stopPropagation();
    
    // Check if the click is on the target object
    updateMouse(event);
    const intersects = raycaster.intersectObject(targetObject);
    
    if (intersects.length > 0) {
      isSelecting = true;
      startPoint.copy(intersects[0].point);
      endPoint.copy(intersects[0].point);

      selectionBox.set(startPoint, endPoint);
      boxHelper.visible = true;
      boxHelper.box = selectionBox;
    }
  };

  const onPointerMove = (event) => {
    if (!isSelecting) return;
    
    event.preventDefault();
    event.stopPropagation();
    updateMouse(event);
    
    // Instead of intersecting, we raycast against a virtual plane
    // for a smoother selection experience when the cursor leaves the point cloud.
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
        camera.getWorldDirection(new THREE.Vector3()),
        startPoint
    );
    raycaster.ray.intersectPlane(plane, endPoint);

    // Update the box with the new points
    selectionBox.setFromPoints([startPoint, endPoint]);
    boxHelper.box = selectionBox;
      
    if (onSelectionChange) {
        onSelectionChange(selectionBox);
    }
  };

  const onPointerUp = () => {
    if (!isSelecting) return;
    isSelecting = false;
    
    if (onSelectionFinish) {
      if (!selectionBox.isEmpty()) {
        onSelectionFinish(selectionBox);
      } else {
        onSelectionFinish(null);
        hide();
      }
    }
  };
  
  const updateMouse = (event) => {
    const rect = domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
  };
  
  const hide = () => {
      boxHelper.visible = false;
      selectionBox.makeEmpty();
      boxHelper.box = selectionBox;
  };
  
  // Attach event listeners
  domElement.addEventListener('pointerdown', onPointerDown);
  domElement.addEventListener('pointermove', onPointerMove);
  domElement.addEventListener('pointerup', onPointerUp);

  const dispose = () => {
    domElement.removeEventListener('pointerdown', onPointerDown);
    domElement.removeEventListener('pointermove', onPointerMove);
    domElement.removeEventListener('pointerup', onPointerUp);
    scene.remove(boxHelper);
    if(boxHelper.geometry) boxHelper.geometry.dispose();
    if(boxHelper.material) boxHelper.material.dispose();
  };

  return { dispose, hide };
}