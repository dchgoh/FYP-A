// Classification utilities for point cloud viewer

export const CLASSIFICATION_SCHEME = {
  0: { name: "Unclassified", color: [0.75, 0.75, 0.75] },
  1: { name: "Low-vegetation", color: [0.6, 0.8, 0.2] },
  2: { name: "Terrain", color: [0.545, 0.271, 0.075] },
  3: { name: "Out-points", color: [1.0, 0.0, 1.0] },
  4: { name: "Stem", color: [0.627, 0.322, 0.176] },
  5: { name: "Live branches", color: [0.133, 0.545, 0.133] },
  6: { name: "Woody branches", color: [0.36, 0.25, 0.2] },
};

export const createInitialClassifications = () => {
  return Object.keys(CLASSIFICATION_SCHEME).reduce((acc, id) => {
    acc[id] = {
      visible: true,
      name: CLASSIFICATION_SCHEME[id].name,
      color: CLASSIFICATION_SCHEME[id].color
    };
    return acc;
  }, {});
};

export const toggleClassification = (classifications, classificationId) => {
  return {
    ...classifications,
    [classificationId]: {
      ...classifications[classificationId],
      visible: !classifications[classificationId].visible
    }
  };
};

export const findClassificationByColor = (r, g, b, classifications) => {
  for (const [id, classification] of Object.entries(classifications)) {
    const [cr, cg, cb] = classification.color;
    if (Math.abs(r - cr) < 0.01 && Math.abs(g - cg) < 0.01 && Math.abs(b - cb) < 0.01) {
      return { id, isVisible: classification.visible };
    }
  }
  return { id: null, isVisible: true };
};
