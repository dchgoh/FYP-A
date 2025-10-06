import * as THREE from 'three';

// Part management functions
export const handlePartClick = (setActivePartId, activePartId) => (partId) => {
  // If the clicked item is already active, do nothing to prevent re-renders
  if (activePartId === partId) return;

  // Simply set the active part without truncating
  setActivePartId(partId);
};

export const handleTogglePartVisibility = (setParts) => (partId) => {
  setParts(prev => prev.map(part => 
    part.id === partId ? { ...part, visible: !part.visible } : part
  ));
};

export const combineVisibleParts = (parts, originalGeometry) => {
  if (!originalGeometry) return null;
  
  const visibleParts = parts.filter(part => part.visible);
  if (visibleParts.length === 0) return null;
  
  // Combine all visible parts into one geometry
  const allPositions = [];
  const allColors = [];
  const allCustomColors = [];
  const allSizes = [];
  
  visibleParts.forEach(part => {
    const positions = part.geometry.attributes.position.array;
    const colors = part.geometry.attributes.color.array;
    const customColors = part.geometry.attributes.customColor.array;
    const sizes = part.geometry.attributes.size.array;
    
    for (let i = 0; i < positions.length; i += 3) {
      allPositions.push(positions[i], positions[i+1], positions[i+2]);
      allColors.push(colors[i], colors[i+1], colors[i+2]);
      allCustomColors.push(customColors[i], customColors[i+1], customColors[i+2]);
    }
    
    for (let i = 0; i < sizes.length; i++) {
      allSizes.push(sizes[i]);
    }
  });
  
  // Create combined geometry
  const combinedGeometry = new THREE.BufferGeometry();
  combinedGeometry.setAttribute('position', new THREE.Float32BufferAttribute(allPositions, 3));
  combinedGeometry.setAttribute('color', new THREE.Float32BufferAttribute(allColors, 3));
  combinedGeometry.setAttribute('customColor', new THREE.Float32BufferAttribute(allCustomColors, 3));
  combinedGeometry.setAttribute('size', new THREE.Float32BufferAttribute(allSizes, 1));
  
  return combinedGeometry;
};

export const createRemainingGeometry = (sourceGeometry, selectedGeometry) => {
  const sourcePositions = sourceGeometry.attributes.position.array;
  const sourceColors = sourceGeometry.attributes.color.array;
  const sourceCustomColors = sourceGeometry.attributes.customColor.array;
  const sourceSizes = sourceGeometry.attributes.size.array;
  
  const selectedPositions = selectedGeometry.attributes.position.array;
  
  // Create a Set of selected positions for fast lookup
  const selectedPositionSet = new Set();
  for (let i = 0; i < selectedPositions.length; i += 3) {
    const key = `${selectedPositions[i].toFixed(3)},${selectedPositions[i+1].toFixed(3)},${selectedPositions[i+2].toFixed(3)}`;
    selectedPositionSet.add(key);
  }
  
  // Collect remaining points
  const remainingPositions = [];
  const remainingColors = [];
  const remainingCustomColors = [];
  const remainingSizes = [];
  
  for (let i = 0; i < sourcePositions.length; i += 3) {
    const key = `${sourcePositions[i].toFixed(3)},${sourcePositions[i+1].toFixed(3)},${sourcePositions[i+2].toFixed(3)}`;
    
    if (!selectedPositionSet.has(key)) {
      // This point is not in the selected geometry, add it to remaining
      remainingPositions.push(sourcePositions[i], sourcePositions[i+1], sourcePositions[i+2]);
      remainingColors.push(sourceColors[i], sourceColors[i+1], sourceColors[i+2]);
      remainingCustomColors.push(sourceCustomColors[i], sourceCustomColors[i+1], sourceCustomColors[i+2]);
      remainingSizes.push(sourceSizes[i/3]);
    }
  }
  
  // Create remaining geometry
  const remainingGeometry = new THREE.BufferGeometry();
  remainingGeometry.setAttribute('position', new THREE.Float32BufferAttribute(remainingPositions, 3));
  remainingGeometry.setAttribute('color', new THREE.Float32BufferAttribute(remainingColors, 3));
  remainingGeometry.setAttribute('customColor', new THREE.Float32BufferAttribute(remainingCustomColors, 3));
  remainingGeometry.setAttribute('size', new THREE.Float32BufferAttribute(remainingSizes, 1));
  
  return remainingGeometry;
};

// Delete a part by ID
export const deletePart = (setParts, setActivePartId) => (partId) => {
  setParts(prev => prev.filter(part => part.id !== partId));
  setActivePartId(null); // Clear active part if deleted part was active
};

// Merge multiple parts into one
export const mergeParts = (setParts, setSelectedParts) => (partIds) => {
  if (partIds.length < 2) return;
  
  setParts(prev => {
    const partsToMerge = prev.filter(part => partIds.includes(part.id));
    const remainingParts = prev.filter(part => !partIds.includes(part.id));
    
    if (partsToMerge.length < 2) return prev;
    
    // Combine geometries of parts to merge
    const allPositions = [];
    const allColors = [];
    const allCustomColors = [];
    const allSizes = [];
    
    partsToMerge.forEach(part => {
      const positions = part.geometry.attributes.position.array;
      const colors = part.geometry.attributes.color.array;
      const customColors = part.geometry.attributes.customColor.array;
      const sizes = part.geometry.attributes.size.array;
      
      for (let i = 0; i < positions.length; i += 3) {
        allPositions.push(positions[i], positions[i+1], positions[i+2]);
        allColors.push(colors[i], colors[i+1], colors[i+2]);
        allCustomColors.push(customColors[i], customColors[i+1], customColors[i+2]);
      }
      
      for (let i = 0; i < sizes.length; i++) {
        allSizes.push(sizes[i]);
      }
    });
    
    // Create merged geometry
    const mergedGeometry = new THREE.BufferGeometry();
    mergedGeometry.setAttribute('position', new THREE.Float32BufferAttribute(allPositions, 3));
    mergedGeometry.setAttribute('color', new THREE.Float32BufferAttribute(allColors, 3));
    mergedGeometry.setAttribute('customColor', new THREE.Float32BufferAttribute(allCustomColors, 3));
    mergedGeometry.setAttribute('size', new THREE.Float32BufferAttribute(allSizes, 1));
    
    // Create merged part
    const mergedPart = {
      id: Date.now(),
      name: `Merged Part (${partsToMerge.length} parts)`,
      geometry: mergedGeometry,
      visible: true,
      type: 'merged'
    };
    
    // Select the merged part
    setSelectedParts([mergedPart.id]);
    
    return [...remainingParts, mergedPart];
  });
};

// Handle multi-selection with Ctrl+click
export const handlePartMultiSelect = (setSelectedParts, selectedParts) => (partId, event) => {
  console.log('handlePartMultiSelect called:', {
    partId,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    currentSelectedParts: selectedParts
  });
  
  if (event.ctrlKey || event.metaKey) {
    // Multi-select mode
    if (selectedParts.includes(partId)) {
      // Remove from selection
      console.log('Removing from selection:', partId);
      setSelectedParts(prev => {
        const newSelection = prev.filter(id => id !== partId);
        console.log('New selection after removal:', newSelection);
        return newSelection;
      });
    } else {
      // Add to selection
      console.log('Adding to selection:', partId);
      setSelectedParts(prev => {
        const newSelection = [...prev, partId];
        console.log('New selection after addition:', newSelection);
        return newSelection;
      });
    }
  } else {
    // Single select mode
    console.log('Single select mode, setting selection to:', [partId]);
    setSelectedParts([partId]);
  }
};
