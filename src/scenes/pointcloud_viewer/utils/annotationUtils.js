// Annotation utility functions
export const handleAnnotationTypeChange = (setSelectedAnnotationType, setSelectedAnnotationValue) => (type) => {
  setSelectedAnnotationType(type);
  setSelectedAnnotationValue(null);
};

export const handleAnnotationValueSelect = (setSelectedAnnotationValue) => (value) => {
  setSelectedAnnotationValue(value);
};

export const annotateAllVisiblePoints = (setIsAnnotating, setAnnotationDialogOpen, selectedAnnotationValue, selectedAnnotationType, classifications, treeIDs, pointCloud, parts, selectedParts, originalGeometry, combineVisibleParts) => () => {
  if (!selectedAnnotationValue || !pointCloud) return;

  setIsAnnotating(true);

  let annotationColor;
  if (selectedAnnotationType === 'classification') {
    const classification = classifications[selectedAnnotationValue];
    annotationColor = classification.color;
  } else if (selectedAnnotationType === 'treeID') {
    const treeInfo = treeIDs[selectedAnnotationValue];
    annotationColor = treeInfo.color;
  }

  // Use requestAnimationFrame to prevent blocking the UI
  requestAnimationFrame(() => {
    try {
      // Get the target geometry - either the selected parts or original geometry
      let targetGeometry = null;
      
      if (parts.length > 0 && selectedParts.length > 0) {
        // Annotate the selected parts
        if (selectedParts.length === 1) {
          // Single part selected
          const targetPart = parts.find(part => part.id === selectedParts[0]);
          targetGeometry = targetPart?.geometry;
        } else {
          // Multiple parts selected - combine them
          targetGeometry = combineVisibleParts();
        }
      } else if (parts.length === 0) {
        // No parts exist, annotate the full original geometry
        targetGeometry = originalGeometry;
      } else {
        // Parts exist but no part is selected, show error
        setIsAnnotating(false);
        setAnnotationDialogOpen(false);
        return;
      }
      
      if (!targetGeometry) {
        setIsAnnotating(false);
        return;
      }
      
      // Update colors for the target geometry
      const colors = targetGeometry.attributes.color.array;
      const customColors = targetGeometry.attributes.customColor.array;
      const classificationColors = targetGeometry.attributes.classificationColor?.array;
      
      // Apply the annotation color to all points in the target geometry
      for (let i = 0; i < colors.length; i += 3) {
        colors[i] = annotationColor[0];
        colors[i + 1] = annotationColor[1];
        colors[i + 2] = annotationColor[2];
        customColors[i] = annotationColor[0];
        customColors[i + 1] = annotationColor[1];
        customColors[i + 2] = annotationColor[2];
        
        // Also update classificationColor if it exists
        if (classificationColors) {
          classificationColors[i] = annotationColor[0];
          classificationColors[i + 1] = annotationColor[1];
          classificationColors[i + 2] = annotationColor[2];
        }
      }
      
      // Mark attributes as needing update
      targetGeometry.attributes.color.needsUpdate = true;
      targetGeometry.attributes.customColor.needsUpdate = true;
      if (classificationColors) {
        targetGeometry.attributes.classificationColor.needsUpdate = true;
      }
      
      // If we're annotating parts, also update the original geometry for persistence
      if (parts.length > 0 && selectedParts.length > 0) {
        const originalPositions = originalGeometry.attributes.position.array;
        const originalColors = originalGeometry.attributes.color.array;
        const originalCustomColors = originalGeometry.attributes.customColor.array;
        const originalClassificationColors = originalGeometry.attributes.classificationColor?.array;
        const targetPositions = targetGeometry.attributes.position.array;
        
        // Create a Map for faster lookup
        const positionMap = new Map();
        for (let i = 0; i < originalPositions.length; i += 3) {
          const key = `${originalPositions[i].toFixed(3)},${originalPositions[i+1].toFixed(3)},${originalPositions[i+2].toFixed(3)}`;
          positionMap.set(key, i);
        }
        
        // Update original geometry for matching points
        for (let i = 0; i < targetPositions.length; i += 3) {
          const key = `${targetPositions[i].toFixed(3)},${targetPositions[i+1].toFixed(3)},${targetPositions[i+2].toFixed(3)}`;
          const colorIndex = positionMap.get(key);
          
          if (colorIndex !== undefined) {
            originalColors[colorIndex] = annotationColor[0];
            originalColors[colorIndex + 1] = annotationColor[1];
            originalColors[colorIndex + 2] = annotationColor[2];
            originalCustomColors[colorIndex] = annotationColor[0];
            originalCustomColors[colorIndex + 1] = annotationColor[1];
            originalCustomColors[colorIndex + 2] = annotationColor[2];
            
            // Also update classificationColor if it exists
            if (originalClassificationColors) {
              originalClassificationColors[colorIndex] = annotationColor[0];
              originalClassificationColors[colorIndex + 1] = annotationColor[1];
              originalClassificationColors[colorIndex + 2] = annotationColor[2];
            }
          }
        }
        
        originalGeometry.attributes.color.needsUpdate = true;
        originalGeometry.attributes.customColor.needsUpdate = true;
        if (originalClassificationColors) {
          originalGeometry.attributes.classificationColor.needsUpdate = true;
        }
      }
      
      setIsAnnotating(false);
      setAnnotationDialogOpen(false);
    } catch (error) {
      console.error('Error during annotation:', error);
      setIsAnnotating(false);
      setAnnotationDialogOpen(false);
    }
  });
};

export const handleAnnotationDialogClose = (setAnnotationDialogOpen, setSelectedAnnotationValue) => () => {
  setAnnotationDialogOpen(false);
  setSelectedAnnotationValue(null);
};
