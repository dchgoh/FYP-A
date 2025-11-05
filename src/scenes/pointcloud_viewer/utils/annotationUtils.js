// Annotation utility functions
import * as THREE from 'three';
export const handleAnnotationTypeChange = (setSelectedAnnotationType, setSelectedAnnotationValue) => (type) => {
  setSelectedAnnotationType(type);
  setSelectedAnnotationValue(null);
};

export const handleAnnotationValueSelect = (setSelectedAnnotationValue) => (value) => {
  setSelectedAnnotationValue(value);
};

export const annotateAllVisiblePoints = (setIsAnnotating, setAnnotationDialogOpen, selectedAnnotationValue, selectedAnnotationType, classifications, treeIDs, pointCloud, parts, selectedParts, originalGeometry, combineVisibleParts, setTreeIDs, setTreeIDData, treeIDData, setParts) => () => {
  if (!selectedAnnotationValue || !pointCloud) return;

  setIsAnnotating(true);

  let annotationColor;
  let annotationTreeID = null;
  
  if (selectedAnnotationType === 'classification') {
    const classification = classifications[selectedAnnotationValue];
    annotationColor = classification.color;
  } else if (selectedAnnotationType === 'treeID') {
    // Parse treeID as integer (int32 format)
    const treeIDValue = parseInt(selectedAnnotationValue, 10);
    
    // Validate it's a valid integer within int32 range
    if (isNaN(treeIDValue) || treeIDValue < -2147483648 || treeIDValue > 2147483647) {
      setIsAnnotating(false);
      setAnnotationDialogOpen(false);
      console.error('Invalid treeID value:', selectedAnnotationValue);
      return;
    }
    
    annotationTreeID = treeIDValue;
    
    // Check if treeID exists in treeIDs map, if not create it
    const treeIDKey = String(treeIDValue);
    let treeInfo = treeIDs[treeIDKey];
    
    if (!treeInfo) {
      // Generate color for new treeID
      const existingTreeIDCount = Object.keys(treeIDs).length;
      const generateTreeIDColor = (index) => {
        const colors = [
          [1.0, 0.2, 0.2], [0.2, 1.0, 0.2], [0.2, 0.2, 1.0], [1.0, 0.8, 0.0],
          [1.0, 0.0, 0.8], [0.0, 1.0, 0.8], [1.0, 0.4, 0.0], [0.8, 0.0, 1.0],
          [0.0, 0.8, 0.4], [1.0, 0.6, 0.0], [0.6, 0.0, 1.0], [0.0, 0.6, 1.0],
          [1.0, 0.0, 0.4], [0.4, 1.0, 0.0], [0.0, 1.0, 0.4], [1.0, 0.2, 0.6],
          [0.6, 1.0, 0.0], [0.0, 0.4, 1.0], [1.0, 0.6, 0.2], [0.8, 0.0, 0.6],
        ];
        return colors[index % colors.length];
      };
      
      // Determine display name
      const hasNegativeOne = Object.keys(treeIDs).some(key => parseInt(key) === -1);
      let displayName;
      if (hasNegativeOne) {
        displayName = treeIDValue === -1 ? 'Unclassified' : `Tree ${treeIDValue}`;
      } else {
        displayName = treeIDValue === 0 ? 'Unclassified' : `Tree ${treeIDValue}`;
      }
      
      treeInfo = {
        id: treeIDValue,
        name: displayName,
        visible: true,
        color: generateTreeIDColor(existingTreeIDCount),
        pointCount: 0
      };
      
      // Update treeIDs state
      setTreeIDs(prev => ({
        ...prev,
        [treeIDKey]: treeInfo
      }));
    }
    
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
      const originalClassification = targetGeometry.attributes.originalClassification?.array;
      
      // Get or preserve original classification colors
      let originalClassificationArray = null;
      if (originalClassification) {
        originalClassificationArray = originalClassification;
      } else if (classificationColors) {
        // If originalClassification doesn't exist but classificationColor does, preserve it
        originalClassificationArray = new Float32Array(classificationColors.length);
        originalClassificationArray.set(classificationColors);
      }
      
      // Apply the annotation color to all points in the target geometry
      for (let i = 0; i < colors.length; i += 3) {
        // Update display colors with annotation color
        colors[i] = annotationColor[0];
        colors[i + 1] = annotationColor[1];
        colors[i + 2] = annotationColor[2];
        customColors[i] = annotationColor[0];
        customColors[i + 1] = annotationColor[1];
        customColors[i + 2] = annotationColor[2];
        
        // Preserve original classification colors - don't overwrite with treeID color
        // classificationColor should keep the original classification colors
        if (selectedAnnotationType === 'classification') {
          // When annotating classification, update classificationColor
          if (classificationColors) {
            classificationColors[i] = annotationColor[0];
            classificationColors[i + 1] = annotationColor[1];
            classificationColors[i + 2] = annotationColor[2];
          }
        } else if (selectedAnnotationType === 'treeID') {
          // When annotating treeID, preserve classificationColor as original classification
          // Don't overwrite it with treeID color
        }
      }
      
      // Create or update originalClassification attribute to preserve classification data
      if (originalClassificationArray) {
        targetGeometry.setAttribute('originalClassification', new THREE.Float32BufferAttribute(originalClassificationArray, 3));
      } else if (classificationColors && selectedAnnotationType === 'classification') {
        // If we annotated classification, save current classificationColor as originalClassification
        const newOriginalClassification = new Float32Array(classificationColors.length);
        newOriginalClassification.set(classificationColors);
        targetGeometry.setAttribute('originalClassification', new THREE.Float32BufferAttribute(newOriginalClassification, 3));
      }
      
      // Ensure classificationColor is preserved when annotating with treeID
      // If classificationColor doesn't exist but we have originalClassification, create it
      if (selectedAnnotationType === 'treeID' && !classificationColors && originalClassificationArray) {
        targetGeometry.setAttribute('classificationColor', new THREE.Float32BufferAttribute(originalClassificationArray, 3));
      }
      
      // Mark attributes as needing update
      targetGeometry.attributes.color.needsUpdate = true;
      targetGeometry.attributes.customColor.needsUpdate = true;
      if (targetGeometry.attributes.classificationColor) {
        targetGeometry.attributes.classificationColor.needsUpdate = true;
      }
      if (targetGeometry.attributes.originalClassification) {
        targetGeometry.attributes.originalClassification.needsUpdate = true;
      }
      
      // Update treeID attribute and treeIDData if annotating with treeID
      if (selectedAnnotationType === 'treeID' && annotationTreeID !== null) {
        const pointCount = colors.length / 3;
        
        // Get or create treeID attribute
        if (!targetGeometry.attributes.treeID) {
          const treeIDArray = new Float32Array(pointCount);
          targetGeometry.setAttribute('treeID', new THREE.Float32BufferAttribute(treeIDArray, 1));
        }
        
        const treeIDAttribute = targetGeometry.attributes.treeID;
        
        // Update treeID for all points in target geometry
        for (let i = 0; i < pointCount; i++) {
          treeIDAttribute.array[i] = annotationTreeID;
        }
        treeIDAttribute.needsUpdate = true;
      }
      
      // If we're annotating parts, also update the original geometry for persistence
      if (parts.length > 0 && selectedParts.length > 0) {
        const originalPositions = originalGeometry.attributes.position.array;
        const originalColors = originalGeometry.attributes.color.array;
        const originalCustomColors = originalGeometry.attributes.customColor.array;
        const originalClassificationColors = originalGeometry.attributes.classificationColor?.array;
        const originalOriginalClassification = originalGeometry.attributes.originalClassification?.array;
        const targetPositions = targetGeometry.attributes.position.array;
        
        // Preserve original classification in original geometry if not already present
        if (!originalOriginalClassification && originalClassificationColors) {
          const preservedOriginalClassification = new Float32Array(originalClassificationColors.length);
          preservedOriginalClassification.set(originalClassificationColors);
          originalGeometry.setAttribute('originalClassification', new THREE.Float32BufferAttribute(preservedOriginalClassification, 3));
        }
        
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
            const pointIndex = colorIndex / 3;
            
            // Update display colors with annotation color
            originalColors[colorIndex] = annotationColor[0];
            originalColors[colorIndex + 1] = annotationColor[1];
            originalColors[colorIndex + 2] = annotationColor[2];
            originalCustomColors[colorIndex] = annotationColor[0];
            originalCustomColors[colorIndex + 1] = annotationColor[1];
            originalCustomColors[colorIndex + 2] = annotationColor[2];
            
            // Preserve original classification colors - only update if annotating classification
            if (selectedAnnotationType === 'classification' && originalClassificationColors) {
              // When annotating classification, update classificationColor
              originalClassificationColors[colorIndex] = annotationColor[0];
              originalClassificationColors[colorIndex + 1] = annotationColor[1];
              originalClassificationColors[colorIndex + 2] = annotationColor[2];
            }
            // When annotating treeID, don't overwrite classificationColor - preserve it
            
            // Update treeID attribute and treeIDData if annotating with treeID
            if (selectedAnnotationType === 'treeID' && annotationTreeID !== null) {
              // Get or create treeID attribute in original geometry
              if (!originalGeometry.attributes.treeID) {
                const originalPointCount = originalPositions.length / 3;
                const treeIDArray = new Float32Array(originalPointCount);
                originalGeometry.setAttribute('treeID', new THREE.Float32BufferAttribute(treeIDArray, 1));
              }
              
              originalGeometry.attributes.treeID.array[pointIndex] = annotationTreeID;
              
              // Update treeIDData array
              if (treeIDData && pointIndex < treeIDData.length) {
                treeIDData[pointIndex] = annotationTreeID;
              }
            }
          }
        }
        
        originalGeometry.attributes.color.needsUpdate = true;
        originalGeometry.attributes.customColor.needsUpdate = true;
        if (originalClassificationColors) {
          originalGeometry.attributes.classificationColor.needsUpdate = true;
        }
        if (originalGeometry.attributes.originalClassification) {
          originalGeometry.attributes.originalClassification.needsUpdate = true;
        }
        
        // Mark treeID attribute as needing update
        if (selectedAnnotationType === 'treeID' && annotationTreeID !== null && originalGeometry.attributes.treeID) {
          originalGeometry.attributes.treeID.needsUpdate = true;
        }
        
        // Rename parts when annotating with treeID
        if (selectedAnnotationType === 'treeID' && annotationTreeID !== null && setParts) {
          const hasNegativeOne = Object.keys(treeIDs).some(key => parseInt(key) === -1);
          let newPartName;
          if (hasNegativeOne) {
            newPartName = annotationTreeID === -1 ? 'Unclassified' : `Tree ${annotationTreeID}`;
          } else {
            newPartName = annotationTreeID === 0 ? 'Unclassified' : `Tree ${annotationTreeID}`;
          }
          
          setParts(prev => prev.map(part => {
            // Rename all selected parts
            if (selectedParts.includes(part.id)) {
              return { ...part, name: newPartName };
            }
            return part;
          }));
        }
      } else if (parts.length === 0 && selectedAnnotationType === 'treeID' && annotationTreeID !== null) {
        // Annotating full original geometry - update treeID attribute and treeIDData array
        const pointCount = originalGeometry.attributes.position.array.length / 3;
        
        // Preserve original classification in original geometry if not already present
        const originalClassificationColors = originalGeometry.attributes.classificationColor?.array;
        const originalOriginalClassification = originalGeometry.attributes.originalClassification?.array;
        if (!originalOriginalClassification && originalClassificationColors) {
          const preservedOriginalClassification = new Float32Array(originalClassificationColors.length);
          preservedOriginalClassification.set(originalClassificationColors);
          originalGeometry.setAttribute('originalClassification', new THREE.Float32BufferAttribute(preservedOriginalClassification, 3));
          originalGeometry.attributes.originalClassification.needsUpdate = true;
        }
        
        // Get or create treeID attribute in original geometry
        if (!originalGeometry.attributes.treeID) {
          const treeIDArray = new Float32Array(pointCount);
          originalGeometry.setAttribute('treeID', new THREE.Float32BufferAttribute(treeIDArray, 1));
        }
        
        const treeIDAttribute = originalGeometry.attributes.treeID;
        
        // Update treeID for all points in original geometry
        for (let i = 0; i < pointCount; i++) {
          treeIDAttribute.array[i] = annotationTreeID;
        }
        treeIDAttribute.needsUpdate = true;
        
        // Update treeIDData array
        if (treeIDData) {
          const newTreeIDData = [...treeIDData];
          for (let i = 0; i < pointCount && i < newTreeIDData.length; i++) {
            newTreeIDData[i] = annotationTreeID;
          }
          // Update treeIDData state
          setTreeIDData(newTreeIDData);
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
