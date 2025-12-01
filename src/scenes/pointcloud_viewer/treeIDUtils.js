// TreeID filtering utilities

export const createInitialTreeIDs = (treeIDs) => {
  if (!treeIDs || treeIDs.length === 0) return {};
  
  // OPTIMIZATION: Count points in a single O(n) pass instead of O(n*m) with filter
  const pointCountMap = new Map();
  for (let i = 0; i < treeIDs.length; i++) {
    const treeID = treeIDs[i];
    pointCountMap.set(treeID, (pointCountMap.get(treeID) || 0) + 1);
  }
  
  const uniqueTreeIDs = Array.from(pointCountMap.keys());
  
  // Sort: Unclassified first, then regular treeIDs
  uniqueTreeIDs.sort((a, b) => {
    // -1 is always the unclassified ID
    const aIsUnclassified = a === -1;
    const bIsUnclassified = b === -1;
    
    // Unclassified goes to the very first position
    if (aIsUnclassified && !bIsUnclassified) return -1;
    if (!aIsUnclassified && bIsUnclassified) return 1;
    
    // Both are regular treeIDs: sort numerically
    return a - b;
  });
  
  const treeIDMap = {};
  
  uniqueTreeIDs.forEach((originalTreeID) => {
    // Display name: -1 is always "Unclassified", trees start from 0
    const displayName = originalTreeID === -1 ? 'Unclassified' : `Tree ${originalTreeID}`;
    
    treeIDMap[originalTreeID] = {
      id: originalTreeID,
      name: displayName,
      visible: true,
      color: generateTreeIDColor(originalTreeID),
      pointCount: pointCountMap.get(originalTreeID) || 0
    };
  });
  
  return treeIDMap;
};

export const toggleTreeID = (treeIDs, treeID) => {
  const newTreeIDs = { ...treeIDs };
  // Convert treeID to string to match Object.keys() behavior
  const treeIDKey = String(treeID);
  if (newTreeIDs[treeIDKey]) {
    newTreeIDs[treeIDKey] = {
      ...newTreeIDs[treeIDKey],
      visible: !newTreeIDs[treeIDKey].visible
    };
  }
  return newTreeIDs;
};

export const findTreeIDByID = (treeID, treeIDs) => {
  // Convert treeID to string to match Object.keys() behavior
  const treeIDKey = String(treeID);
  if (!treeIDs[treeIDKey]) {
    return { id: treeID, isVisible: true };
  }
  return { id: treeID, isVisible: treeIDs[treeIDKey].visible };
};

export const generateTreeIDColor = (treeIDValue) => {
  // Generate distinct colors for tree IDs based on the treeID value itself
  // This ensures each treeID always gets the same color regardless of order or visibility
  // Using warmer, more vibrant colors to distinguish from classification
  const colors = [
    [1.0, 0.2, 0.2], // Bright Red
    [0.2, 1.0, 0.2], // Bright Green
    [0.2, 0.2, 1.0], // Bright Blue
    [1.0, 0.8, 0.0], // Gold
    [1.0, 0.0, 0.8], // Hot Pink
    [0.0, 1.0, 0.8], // Cyan
    [1.0, 0.4, 0.0], // Orange
    [0.8, 0.0, 1.0], // Purple
    [0.0, 0.8, 0.4], // Emerald
    [1.0, 0.6, 0.0], // Amber
    [0.6, 0.0, 1.0], // Violet
    [0.0, 0.6, 1.0], // Sky Blue
    [1.0, 0.0, 0.4], // Rose
    [0.4, 1.0, 0.0], // Lime
    [0.0, 1.0, 0.4], // Spring Green
    [1.0, 0.2, 0.6], // Pink
    [0.6, 1.0, 0.0], // Chartreuse
    [0.0, 0.4, 1.0], // Royal Blue
    [1.0, 0.6, 0.2], // Peach
    [0.8, 0.0, 0.6], // Magenta
  ];
  
  // Use a hash function based on treeID value to get consistent color
  // Handle negative values (like -1 for unclassified) by using absolute value
  const hash = Math.abs(treeIDValue);
  return colors[hash % colors.length];
};
