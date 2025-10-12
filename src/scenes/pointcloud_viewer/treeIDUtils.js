// TreeID filtering utilities

export const createInitialTreeIDs = (treeIDs) => {
  if (!treeIDs || treeIDs.length === 0) return {};
  
  const uniqueTreeIDs = [...new Set(treeIDs)].sort((a, b) => a - b);
  const treeIDMap = {};
  
  uniqueTreeIDs.forEach((originalTreeID, index) => {
    const displayName = originalTreeID === 0 ? 'Unclassified' : `Tree ${originalTreeID}`;
    treeIDMap[originalTreeID] = {
      id: originalTreeID,
      name: displayName, // Show "Unclassified" for 0, "Tree X" for others
      visible: true,
      color: generateTreeIDColor(index),
      pointCount: treeIDs.filter(id => id === originalTreeID).length
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

const generateTreeIDColor = (index) => {
  // Generate distinct colors for tree IDs (different from classification colors)
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
  
  return colors[index % colors.length];
};
