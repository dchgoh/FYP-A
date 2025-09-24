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
        
        // Debug logging
        console.log('LAS File Info:');
        console.log('Version:', versionMajor + '.' + versionMinor);
        console.log('Point Format:', pointDataRecordFormat);
        console.log('Point Record Length:', pointDataRecordLength);
        console.log('Number of Points:', numberOfPointRecords);
        console.log('File Size:', arrayBuffer.byteLength, 'bytes');
        
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
        
        // Parse point data with uniform sampling
        const points = [];
        const colors = [];
        const treeIDs = [];
        
        // If header says 0 points but we have data, try to estimate from available data
        let estimatedNumberOfPoints = numberOfPointRecords;
        if (numberOfPointRecords === 0 && pointDataOffset < arrayBuffer.byteLength) {
          const availableData = arrayBuffer.byteLength - pointDataOffset;
          estimatedNumberOfPoints = Math.floor(availableData / pointDataRecordLength);
          console.log(`Header says 0 points, but estimating ${estimatedNumberOfPoints} points from available data`);
        }
        
        const maxPoints = Math.min(estimatedNumberOfPoints, 1000000);
        
        // Calculate sampling interval for uniform distribution
        const samplingInterval = Math.max(1, Math.floor(estimatedNumberOfPoints / maxPoints));
        const actualPointsToLoad = Math.min(estimatedNumberOfPoints, maxPoints * samplingInterval);
        
        console.log(`Total points: ${estimatedNumberOfPoints}, Sampling every ${samplingInterval} points, Loading: ${actualPointsToLoad} points`);
        console.log(`Point format: ${pointDataRecordFormat}, Record length: ${pointDataRecordLength} bytes`);
        
        if (estimatedNumberOfPoints === 0) {
          console.error('ERROR: LAS file has 0 points! This might be a corrupted or empty file.');
          console.log('File size:', arrayBuffer.byteLength, 'bytes');
          console.log('Point data offset:', pointDataOffset);
          console.log('Expected data size:', estimatedNumberOfPoints * pointDataRecordLength);
          console.log('Available data after offset:', arrayBuffer.byteLength - pointDataOffset);
          
          // Debug the LAS header more thoroughly
          console.log('=== LAS HEADER DEBUG ===');
          console.log('Signature:', signature);
          console.log('Version:', versionMajor + '.' + versionMinor);
          console.log('Point Data Record Format:', pointDataRecordFormat);
          console.log('Point Data Record Length:', pointDataRecordLength);
          console.log('Number of Point Records (from header):', numberOfPointRecords);
          console.log('X Scale:', xScale, 'Y Scale:', yScale, 'Z Scale:', zScale);
          console.log('X Offset:', xOffset, 'Y Offset:', yOffset, 'Z Offset:', zOffset);
          console.log('=== END LAS HEADER DEBUG ===');
        }
        
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
          
          console.log(`Point format ${pointFormat}: Standard length ${standardLength}, Extra bytes: ${extraBytesLength} bytes starting at offset ${extraBytesStart}`);
          
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
              // Try float32 first (4 bytes)
              if (pos + 4 <= offset + recordLength) {
                try {
                  const float32TreeID = dataView.getFloat32(offset + pos, true);
                  const roundedTreeID = Math.round(float32TreeID);
                  
                  // Check if this looks like a valid treeID (positive integer, not too large)
                  if (roundedTreeID > 0 && roundedTreeID < 1000000) {
                    console.log(`Found treeID (float32) at position ${pos}: ${roundedTreeID}`);
                    return Math.abs(roundedTreeID);
                  }
                } catch (e) {
                  // Continue to next position
                }
              }
              
              // Try float64 (8 bytes)
              if (pos + 8 <= offset + recordLength) {
                try {
                  const float64TreeID = dataView.getFloat64(offset + pos, true);
                  const roundedTreeID = Math.round(float64TreeID);
                  
                  // Check if this looks like a valid treeID (positive integer, not too large)
                  if (roundedTreeID > 0 && roundedTreeID < 1000000) {
                    console.log(`Found treeID (float64) at position ${pos}: ${roundedTreeID}`);
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
        
        // Process points in chunks to prevent UI blocking
        const processPointsChunked = async () => {
          const chunkSize = 5000; // Process 5k points at a time for better responsiveness
          let processedPoints = 0;
          
          for (let i = 0; i < actualPointsToLoad; i += samplingInterval) {
            if (i % (samplingInterval * 100000) === 0 && i > 0) {
              const progress = Math.round(i/actualPointsToLoad*100);
              console.log(`Parsing progress: ${Math.floor(i/samplingInterval)}/${maxPoints} points (${progress}%)`);
              if (onProgress) {
                onProgress(progress);
              }
            }
            
            const offset = pointDataOffset + (i * pointDataRecordLength);
            
            // Check if we have enough data
            if (offset + pointDataRecordLength > arrayBuffer.byteLength) {
              console.warn(`Stopping at point ${i}: not enough data in file`);
              break;
            }
            
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
            
            // Read treeID from extra bytes using flexible detection
            const treeID = findTreeIDInExtraBytes(offset, pointDataRecordFormat, pointDataRecordLength);
            
            treeIDs.push(treeID);
            
            // Get color based on classification
            const classificationData = getClassificationColor(classification);
            colors.push(classificationData.color[0], classificationData.color[1], classificationData.color[2]);
            
            processedPoints++;
            
            // Yield control to browser every chunkSize points
            if (processedPoints % chunkSize === 0) {
              await new Promise(resolve => setTimeout(resolve, 0));
            }
          }
        };
        
        await processPointsChunked();
        
        console.log(`Parsed ${points.length / 3} uniformly sampled points out of ${estimatedNumberOfPoints} total points in file`);
        console.log(`Sampling ratio: 1:${samplingInterval} (every ${samplingInterval} points)`);
        console.log(`Found treeIDs:`, [...new Set(treeIDs)].sort((a, b) => a - b));
        resolve({ points, colors, treeIDs, numberOfPointRecords });
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
