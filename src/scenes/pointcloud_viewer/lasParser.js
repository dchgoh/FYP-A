// LAS file parsing utilities

export const parseLASFile = async (file, onProgress = null) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
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
        
        
        // Validate point format
        if (pointDataRecordFormat > 15) {
          console.warn('Invalid point format:', pointDataRecordFormat, '- This may cause parsing issues');
        }
        
        // Read scale factors and offsets
        const xScale = dataView.getFloat64(131, true);
        const yScale = dataView.getFloat64(139, true);
        const zScale = dataView.getFloat64(147, true);
        const xOffset = dataView.getFloat64(155, true);
        const yOffset = dataView.getFloat64(163, true);
        const zOffset = dataView.getFloat64(171, true);
        
        // Calculate point data offset
        const pointDataOffset = dataView.getUint32(96, true);
        
        const points = [];
        const colors = [];
        const treeIDs = [];
        
        let estimatedNumberOfPoints = numberOfPointRecords;
        if (numberOfPointRecords === 0 && pointDataOffset < arrayBuffer.byteLength) {
          const availableData = arrayBuffer.byteLength - pointDataOffset;
          estimatedNumberOfPoints = Math.floor(availableData / pointDataRecordLength);
        }

        // --- START OF NEW RANDOM SAMPLING LOGIC ---

        // Determine the number of points to sample. Up to 2 million is a good balance of density and performance.
        const maxPoints = Math.min(estimatedNumberOfPoints, 2000000);

        
        if (estimatedNumberOfPoints === 0) {
          throw new Error('LAS file appears to contain 0 points.');
        }

        // Create an array of random, unique indices to read from the file.
        // This method is memory-intensive for huge point counts, but robust.
        const allIndices = new Uint32Array(estimatedNumberOfPoints).map((_, i) => i);
        // Shuffle the array to randomize it (Fisher-Yates shuffle algorithm).
        for (let i = allIndices.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [allIndices[i], allIndices[j]] = [allIndices[j], allIndices[i]]; // Swap elements
        }
        // Take the first 'maxPoints' from the now-randomized list.
        const randomIndices = allIndices.slice(0, maxPoints);
        // Sort the indices to read the file in a more sequential (and thus faster) order.
        randomIndices.sort((a, b) => a - b);
        
        
        // Function to find treeID in extra bytes
        const findTreeIDInExtraBytes = (offset, pointFormat, recordLength) => {
          // Standard LAS point record structure
          const standardBytes = {
            0: 20,  // X(4) + Y(4) + Z(4) + Intensity(2) + Return(1) + Flags(1) + Classification(1) + ScanAngle(1) + UserData(1) + PointSourceID(2) + GPSTime(8)
            1: 28,  // + WavePacketDescriptor(1) + WaveformDataOffset(8) + WaveformPacketSize(4) + ReturnPointWaveformLocation(4) + X(4) + Y(4) + Z(4) + Intensity(4)
            2: 26,  // + R(2) + G(2) + B(2)
            3: 34,  // + R(2) + G(2) + B(2) + WavePacketDescriptor(1) + WaveformDataOffset(8) + WaveformPacketSize(4) + ReturnPointWaveformLocation(4) + X(4) + Y(4) + Z(4) + Intensity(4)
            4: 57,  // + R(2) + G(2) + B(2) + WavePacketDescriptor(1) + WaveformDataOffset(8) + WaveformPacketSize(4) + ReturnPointWaveformLocation(4) + X(4) + Y(4) + Z(4) + Intensity(4) + WaveformData(23)
            5: 63,  // + R(2) + G(2) + B(2) + WavePacketDescriptor(1) + WaveformDataOffset(8) + WaveformPacketSize(4) + ReturnPointWaveformLocation(4) + X(4) + Y(4) + Z(4) + Intensity(4) + WaveformData(29)
            6: 30,  // + R(2) + G(2) + B(2) + WavePacketDescriptor(1) + WaveformDataOffset(8) + WaveformPacketSize(4) + ReturnPointWaveformLocation(4) + X(4) + Y(4) + Z(4) + Intensity(4)
            7: 36,  // + R(2) + G(2) + B(2) + WavePacketDescriptor(1) + WaveformDataOffset(8) + WaveformPacketSize(4) + ReturnPointWaveformLocation(4) + X(4) + Y(4) + Z(4) + Intensity(4) + WaveformData(6)
            8: 38,  // + R(2) + G(2) + B(2) + WavePacketDescriptor(1) + WaveformDataOffset(8) + WaveformPacketSize(4) + ReturnPointWaveformLocation(4) + X(4) + Y(4) + Z(4) + Intensity(4) + WaveformData(8)
            9: 59,  // + R(2) + G(2) + B(2) + WavePacketDescriptor(1) + WaveformDataOffset(8) + WaveformPacketSize(4) + ReturnPointWaveformLocation(4) + X(4) + Y(4) + Z(4) + Intensity(4) + WaveformData(29)
            10: 67, // + R(2) + G(2) + B(2) + WavePacketDescriptor(1) + WaveformDataOffset(8) + WaveformPacketSize(4) + ReturnPointWaveformLocation(4) + X(4) + Y(4) + Z(4) + Intensity(4) + WaveformData(37)
          };
          
          const standardLength = standardBytes[pointFormat] || 20;
          const extraBytesStart = standardLength;
          const extraBytesLength = recordLength - standardLength;
          
          
          // Try to find treeID in extra bytes
          if (extraBytesLength >= 4) { // Need at least 4 bytes for float32
            // Try different positions in extra bytes
            const positionsToTry = [
              extraBytesStart,           // First 4 bytes
              extraBytesStart + 4,       // Next 4 bytes
              extraBytesStart + 8,       // Next 4 bytes
              extraBytesStart + 12,      // Next 4 bytes
              extraBytesStart + 16,      // Next 4 bytes
            ];
            
            for (const pos of positionsToTry) {
              // Only try float32 (4 bytes)
              if (pos + 4 <= offset + recordLength) {
                try {
                  const float32TreeID = dataView.getFloat32(offset + pos, true);
                  const roundedTreeID = Math.round(float32TreeID);
                  
                  // Check if this looks like a valid treeID (positive integer, not too large)
                  if (roundedTreeID > 0 && roundedTreeID < 1000000) {
                    return Math.abs(roundedTreeID);
                  }
                } catch (e) {
                  // Continue to next position
                }
              }
            }
          }
          
          return 0; // No valid treeID found
        };
        
        // Process the randomly selected points in chunks to keep the UI responsive.
        const processPointsChunked = async () => {
          const chunkSize = 5000; // Yield to browser every 5000 points.

          for (let i = 0; i < randomIndices.length; i++) {
            // Update the progress indicator every 100,000 points.
            if (i > 0 && i % 100000 === 0) {
              const progress = Math.round((i / randomIndices.length) * 100);
              if (onProgress) {
                onProgress(progress);
              }
              // A brief pause allows the UI thread to process updates.
              await new Promise(resolve => setTimeout(resolve, 0)); 
            }
            
            const pointIndex = randomIndices[i];
            const offset = pointDataOffset + (pointIndex * pointDataRecordLength);
            
            // Safety check to ensure we don't read past the end of the file.
            if (offset + pointDataRecordLength > arrayBuffer.byteLength) {
                console.warn(`Attempted to read past end of file at point index ${pointIndex}. Stopping.`);
                break;
            }

            // Read X, Y, Z coordinates.
            const xInt = dataView.getInt32(offset, true);
            const yInt = dataView.getInt32(offset + 4, true);
            const zInt = dataView.getInt32(offset + 8, true);
            const x = xInt * xScale + xOffset;
            const y = yInt * yScale + yOffset;
            const z = zInt * zScale + zOffset;
            points.push(x, y, z);
            
            // Read classification. For LAS 1.4 formats (6-10), classification is at byte 16; for earlier formats (0-5), it's at byte 15.
            const classificationOffset = (pointDataRecordFormat >= 6) ? 16 : 15;
            const classification = dataView.getUint8(offset + classificationOffset);
            const classificationData = getClassificationColor(classification);
            colors.push(classificationData.color[0], classificationData.color[1], classificationData.color[2]);
            
            // Read treeID from extra bytes using flexible detection
            const treeID = findTreeIDInExtraBytes(offset, pointDataRecordFormat, pointDataRecordLength);
            treeIDs.push(treeID);
          }
        };
        
        await processPointsChunked();

        // --- END OF NEW RANDOM SAMPLING LOGIC ---
        
        resolve({ points, colors, treeIDs, numberOfPointRecords });
      } catch (error) {
        console.error("Fatal error during LAS file parsing:", error);
        reject(error);
      }
    };
    reader.onerror = (e) => reject(new Error('FileReader failed to read file: ' + e.target.error.code));
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
