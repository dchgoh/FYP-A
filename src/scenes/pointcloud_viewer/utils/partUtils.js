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
  const allTreeIDs = [];
  const allOriginalClassifications = [];
  const allClassificationColors = [];
  
  visibleParts.forEach(part => {
    const positions = part.geometry.attributes.position.array;
    const colors = part.geometry.attributes.color.array;
    const customColors = part.geometry.attributes.customColor.array;
    const sizes = part.geometry.attributes.size.array;
    
    // Handle treeID attribute if it exists
    const treeIDs = part.geometry.attributes.treeID?.array || [];
    const originalClassifications = part.geometry.attributes.originalClassification?.array || [];
    const classificationColors = part.geometry.attributes.classificationColor?.array || [];
    
    for (let i = 0; i < positions.length; i += 3) {
      allPositions.push(positions[i], positions[i+1], positions[i+2]);
      allColors.push(colors[i], colors[i+1], colors[i+2]);
      allCustomColors.push(customColors[i], customColors[i+1], customColors[i+2]);
      
      // Preserve treeID data
      if (treeIDs.length > 0) {
        allTreeIDs.push(treeIDs[i/3] || 0);
      }
      
      // Preserve original classification data
      if (originalClassifications.length > 0) {
        allOriginalClassifications.push(
          originalClassifications[i], 
          originalClassifications[i+1], 
          originalClassifications[i+2]
        );
      }
      
      // Preserve classificationColor data
      if (classificationColors.length > 0) {
        allClassificationColors.push(
          classificationColors[i],
          classificationColors[i+1],
          classificationColors[i+2]
        );
      } else if (originalClassifications.length > 0) {
        // If no classificationColor but have originalClassification, use that
        allClassificationColors.push(
          originalClassifications[i],
          originalClassifications[i+1],
          originalClassifications[i+2]
        );
      }
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
  
  // Preserve treeID attribute if any treeID data exists
  if (allTreeIDs.length > 0) {
    combinedGeometry.setAttribute('treeID', new THREE.Float32BufferAttribute(allTreeIDs, 1));
  }
  
  // Preserve original classification attribute if any classification data exists
  if (allOriginalClassifications.length > 0) {
    combinedGeometry.setAttribute('originalClassification', new THREE.Float32BufferAttribute(allOriginalClassifications, 3));
  }
  
  // Preserve classificationColor attribute if any classification color data exists
  if (allClassificationColors.length > 0) {
    combinedGeometry.setAttribute('classificationColor', new THREE.Float32BufferAttribute(allClassificationColors, 3));
  }
  
  return combinedGeometry;
};

export const createRemainingGeometry = (sourceGeometry, selectedGeometry, externalTreeIDData = null) => {
  const sourcePositions = sourceGeometry.attributes.position.array;
  const sourceColors = sourceGeometry.attributes.color.array;
  const sourceCustomColors = sourceGeometry.attributes.customColor.array;
  const sourceSizes = sourceGeometry.attributes.size.array;
  
  // Get additional attributes if they exist, or use external data
  const sourceTreeIDs = sourceGeometry.attributes.treeID?.array || externalTreeIDData || [];
  const sourceOriginalClassifications = sourceGeometry.attributes.originalClassification?.array || [];
  const sourceClassificationColors = sourceGeometry.attributes.classificationColor?.array || [];
  
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
  const remainingTreeIDs = [];
  const remainingOriginalClassifications = [];
  const remainingClassificationColors = [];
  
  for (let i = 0; i < sourcePositions.length; i += 3) {
    const key = `${sourcePositions[i].toFixed(3)},${sourcePositions[i+1].toFixed(3)},${sourcePositions[i+2].toFixed(3)}`;
    
    if (!selectedPositionSet.has(key)) {
      // This point is not in the selected geometry, add it to remaining
      const pointIndex = i / 3;
      remainingPositions.push(sourcePositions[i], sourcePositions[i+1], sourcePositions[i+2]);
      remainingColors.push(sourceColors[i], sourceColors[i+1], sourceColors[i+2]);
      remainingCustomColors.push(sourceCustomColors[i], sourceCustomColors[i+1], sourceCustomColors[i+2]);
      remainingSizes.push(sourceSizes[pointIndex]);
      
      // Preserve treeID data if it exists
      if (sourceTreeIDs.length > 0) {
        remainingTreeIDs.push(sourceTreeIDs[pointIndex] || 0);
      }
      
      // Preserve original classification data if it exists
      if (sourceOriginalClassifications.length > 0) {
        remainingOriginalClassifications.push(
          sourceOriginalClassifications[i], 
          sourceOriginalClassifications[i+1], 
          sourceOriginalClassifications[i+2]
        );
      }
      
      // Preserve classificationColor data if it exists (current classification colors after annotation)
      if (sourceClassificationColors.length > 0) {
        remainingClassificationColors.push(
          sourceClassificationColors[i],
          sourceClassificationColors[i+1],
          sourceClassificationColors[i+2]
        );
      }
    }
  }

  
  // Create remaining geometry
  const remainingGeometry = new THREE.BufferGeometry();
  remainingGeometry.setAttribute('position', new THREE.Float32BufferAttribute(remainingPositions, 3));
  remainingGeometry.setAttribute('color', new THREE.Float32BufferAttribute(remainingColors, 3));
  remainingGeometry.setAttribute('customColor', new THREE.Float32BufferAttribute(remainingCustomColors, 3));
  remainingGeometry.setAttribute('size', new THREE.Float32BufferAttribute(remainingSizes, 1));
  
  // Preserve treeID attribute if any treeID data exists
  if (remainingTreeIDs.length > 0) {
    remainingGeometry.setAttribute('treeID', new THREE.Float32BufferAttribute(remainingTreeIDs, 1));
  }
  
  // Preserve original classification attribute if any classification data exists
  if (remainingOriginalClassifications.length > 0) {
    remainingGeometry.setAttribute('originalClassification', new THREE.Float32BufferAttribute(remainingOriginalClassifications, 3));
  }
  
  // Preserve classificationColor attribute if any classification color data exists (current classification colors after annotation)
  if (remainingClassificationColors.length > 0) {
    remainingGeometry.setAttribute('classificationColor', new THREE.Float32BufferAttribute(remainingClassificationColors, 3));
  }
  
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
    // Preserve the selection order by mapping partIds to parts in order
    const partsToMerge = partIds.map(id => prev.find(part => part.id === id)).filter(Boolean);
    const remainingParts = prev.filter(part => !partIds.includes(part.id));
    
    if (partsToMerge.length < 2) return prev;
    
    // Combine geometries of parts to merge
    const allPositions = [];
    const allColors = [];
    const allCustomColors = [];
    const allSizes = [];
    const allTreeIDs = [];
    const allOriginalClassifications = [];
    
    partsToMerge.forEach(part => {
      const positions = part.geometry.attributes.position.array;
      const colors = part.geometry.attributes.color.array;
      const customColors = part.geometry.attributes.customColor.array;
      const sizes = part.geometry.attributes.size.array;
      
      // Handle treeID attribute if it exists
      const treeIDs = part.geometry.attributes.treeID?.array || [];
      const originalClassifications = part.geometry.attributes.originalClassification?.array || [];
      
      // Debug: Check treeID data for this part
      if (treeIDs.length > 0) {
      } else {
      }
      
      for (let i = 0; i < positions.length; i += 3) {
        allPositions.push(positions[i], positions[i+1], positions[i+2]);
        allColors.push(colors[i], colors[i+1], colors[i+2]);
        allCustomColors.push(customColors[i], customColors[i+1], customColors[i+2]);
        
        // Preserve treeID data
        if (treeIDs.length > 0) {
          const pointIndex = i / 3;
          const treeIDValue = treeIDs[pointIndex] || 0;
          allTreeIDs.push(treeIDValue);
          
          // Debug: Log first few treeID values for each part
          if (pointIndex < 5) {
          }
        } else {
          allTreeIDs.push(0); // Default value when no treeID data
        }
        
        // Preserve original classification data
        if (originalClassifications.length > 0) {
          allOriginalClassifications.push(
            originalClassifications[i], 
            originalClassifications[i+1], 
            originalClassifications[i+2]
          );
        }
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
    
    // Preserve treeID attribute if any treeID data exists
    if (allTreeIDs.length > 0) {
      mergedGeometry.setAttribute('treeID', new THREE.Float32BufferAttribute(allTreeIDs, 1));
    }
    
    // Preserve original classification attribute if any classification data exists
    if (allOriginalClassifications.length > 0) {
      mergedGeometry.setAttribute('originalClassification', new THREE.Float32BufferAttribute(allOriginalClassifications, 3));
    }
    
    // Create merged part
    const mergedPart = {
      id: Date.now(),
      name: partsToMerge[0].name, // Use the first selected part's name
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
  
  if (event.ctrlKey || event.metaKey) {
    // Multi-select mode
    if (selectedParts.includes(partId)) {
      // Remove from selection
      setSelectedParts(prev => {
        const newSelection = prev.filter(id => id !== partId);
        return newSelection;
      });
    } else {
      // Add to selection
      setSelectedParts(prev => {
        const newSelection = [...prev, partId];
        return newSelection;
      });
    }
  } else {
    // Single select mode
    setSelectedParts([partId]);
  }
};

