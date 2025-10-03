// src/scenes/pointcloud_viewer/LassoHelper.js

/**
 * Creates a helper for drawing a 2D lasso on an overlay canvas.
 * @param {HTMLElement} parentElement - The element to append the overlay canvas to.
 * @param {function} onSelectionFinish - Callback with the array of 2D points forming the lasso polygon.
 */
export function createLassoHelper(parentElement, onSelectionFinish) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  parentElement.appendChild(canvas);

  // Style the canvas to perfectly overlay its parent
  canvas.style.position = 'absolute';
  canvas.style.top = '0';
  canvas.style.left = '0';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.pointerEvents = 'none'; // Initially, it doesn't block mouse events
  canvas.style.zIndex = '10'; // Make sure it's on top

  let isSelecting = false;
  let path = [];

  const resizeCanvas = () => {
    canvas.width = parentElement.clientWidth;
    canvas.height = parentElement.clientHeight;
  };
  resizeCanvas(); // Initial size

  const onPointerDown = (event) => {
    // Stop camera controls from working while we draw
    event.stopPropagation();
    
    isSelecting = true;
    canvas.style.pointerEvents = 'auto'; // Capture mouse events now

    const rect = parentElement.getBoundingClientRect();
    path = [{ x: event.clientX - rect.left, y: event.clientY - rect.top }];
    
    clearCanvas();
  };

  const onPointerMove = (event) => {
    if (!isSelecting) return;
    event.stopPropagation();

    const rect = parentElement.getBoundingClientRect();
    path.push({ x: event.clientX - rect.left, y: event.clientY - rect.top });
    
    drawPath();
  };

  const onPointerUp = (event) => {
    if (!isSelecting) return;
    event.stopPropagation();
    
    isSelecting = false;
    canvas.style.pointerEvents = 'none'; // Stop capturing events

    if (path.length > 2 && onSelectionFinish) {
        onSelectionFinish(path);
    }
    
    // Don't clear immediately, let the main component decide when.
  };

  const drawPath = () => {
    clearCanvas();
    context.strokeStyle = '#00FFFF'; // A bright cyan color
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(path[0].x, path[0].y);
    for (let i = 1; i < path.length; i++) {
        context.lineTo(path[i].x, path[i].y);
    }
    context.stroke();
  };

  const clearCanvas = () => {
    context.clearRect(0, 0, canvas.width, canvas.height);
  };
  
  // Use parent for events, as the canvas itself might not always catch them.
  parentElement.addEventListener('pointerdown', onPointerDown);
  parentElement.addEventListener('pointermove', onPointerMove);
  parentElement.addEventListener('pointerup', onPointerUp);
  window.addEventListener('resize', resizeCanvas); // Keep canvas size in sync

  const dispose = () => {
    parentElement.removeEventListener('pointerdown', onPointerDown);
    parentElement.removeEventListener('pointermove', onPointerMove);
    parentElement.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('resize', resizeCanvas);
    if(canvas.parentElement) {
      canvas.parentElement.removeChild(canvas);
    }
  };

  return { dispose, clearCanvas };
}