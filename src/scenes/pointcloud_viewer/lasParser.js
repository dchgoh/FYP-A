// LAS file parsing utilities

export const parseLASFile = async (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const arrayBuffer = e.target.result;
        const dataView = new DataView(arrayBuffer);
        
        // Check LAS signature
        const signature = String.fromCharCode(
          dataView.getUint8(0),
          dataView.getUint8(1),
          dataView.getUint8(2),
          dataView.getUint8(3)
        );
        
        if (signature !== 'LASF') {
          throw new Error('Invalid LAS file format');
        }

        // Read header information
        const versionMajor = dataView.getUint8(24);
        const versionMinor = dataView.getUint8(25);
        const pointDataRecordFormat = dataView.getUint8(104);
        const pointDataRecordLength = dataView.getUint16(105, true);
        const numberOfPointRecords = dataView.getUint32(107, true);
        
        // Read scale factors and offsets
        const xScale = dataView.getFloat64(131, true);
        const yScale = dataView.getFloat64(139, true);
        const zScale = dataView.getFloat64(147, true);
        const xOffset = dataView.getFloat64(155, true);
        const yOffset = dataView.getFloat64(163, true);
        const zOffset = dataView.getFloat64(171, true);
        
        // Calculate point data offset
        const pointDataOffset = dataView.getUint32(96, true);
        
        // Parse point data
        const points = [];
        const colors = [];
        const maxPoints = Math.min(numberOfPointRecords, 1000000);
        
        for (let i = 0; i < maxPoints; i++) {
          if (i % 100000 === 0 && i > 0) {
            console.log(`Parsing progress: ${i}/${maxPoints} points (${Math.round(i/maxPoints*100)}%)`);
          }
          
          const offset = pointDataOffset + (i * pointDataRecordLength);
          
          // Read X, Y, Z coordinates
          const xInt = dataView.getInt32(offset, true);
          const yInt = dataView.getInt32(offset + 4, true);
          const zInt = dataView.getInt32(offset + 8, true);
          
          // Convert to real coordinates
          const x = xInt * xScale + xOffset;
          const y = yInt * yScale + yOffset;
          const z = zInt * zScale + zOffset;
          
          points.push(x, y, z);
          
          // Read classification (byte 15 in LAS format)
          const classification = dataView.getUint8(offset + 15);
          
          // Get color based on classification
          const classificationData = getClassificationColor(classification);
          colors.push(classificationData.color[0], classificationData.color[1], classificationData.color[2]);
        }
        
        console.log(`Parsed ${points.length / 3} points out of ${numberOfPointRecords} total points in file`);
        resolve({ points, colors, numberOfPointRecords });
      } catch (error) {
        reject(error);
      }
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsArrayBuffer(file);
  });
};

const getClassificationColor = (classification) => {
  const classificationScheme = {
    0: { name: "Unclassified", color: [0.75, 0.75, 0.75] },
    1: { name: "Low-vegetation", color: [0.6, 0.8, 0.2] },
    2: { name: "Terrain", color: [0.545, 0.271, 0.075] },
    3: { name: "Out-points", color: [1.0, 0.0, 1.0] },
    4: { name: "Stem", color: [0.627, 0.322, 0.176] },
    5: { name: "Live branches", color: [0.133, 0.545, 0.133] },
    6: { name: "Woody branches", color: [0.36, 0.25, 0.2] },
  };
  
  return classificationScheme[classification] || classificationScheme[0];
};
