// LAS file export utilities
// This module exports point cloud geometry to LAS 1.2 format

/**
 * Exports a THREE.BufferGeometry to a LAS file blob
 * @param {THREE.BufferGeometry} geometry - The geometry to export
 * @param {Object} originalHeader - Optional original header info for scale/offset
 * @param {Array} treeIDs - Optional array of tree IDs for each point
 * @returns {Blob} - The LAS file as a blob
 */
export const exportGeometryToLAS = (geometry, originalHeader = null, treeIDs = null) => {
  if (!geometry || !geometry.attributes.position) {
    throw new Error('Invalid geometry provided for LAS export');
  }

  const positions = geometry.attributes.position.array;
  const colors = geometry.attributes.color?.array || null;
  const numPoints = positions.length / 3;

  console.log(`Exporting ${numPoints} points to LAS format`);
  console.log(`Tree IDs available: ${treeIDs ? 'Yes' : 'No'}`);

  // Calculate bounding box
  let xMin = Infinity, xMax = -Infinity;
  let yMin = Infinity, yMax = -Infinity;
  let zMin = Infinity, zMax = -Infinity;

  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const y = positions[i + 1];
    const z = positions[i + 2];
    
    xMin = Math.min(xMin, x);
    xMax = Math.max(xMax, x);
    yMin = Math.min(yMin, y);
    yMax = Math.max(yMax, y);
    zMin = Math.min(zMin, z);
    zMax = Math.max(zMax, z);
  }

  // Use original scale/offset if provided, otherwise calculate reasonable ones
  const xScale = originalHeader?.xScale || 0.001;
  const yScale = originalHeader?.yScale || 0.001;
  const zScale = originalHeader?.zScale || 0.001;
  const xOffset = originalHeader?.xOffset || xMin;
  const yOffset = originalHeader?.yOffset || yMin;
  const zOffset = originalHeader?.zOffset || zMin;

  // Determine point format and length based on what data we have
  // To ensure compatibility with laspy, we use format 3 (with RGB + GPS time) when we have extra bytes
  // This avoids validation errors in laspy that expect specific point record lengths for each format
  const hasTreeIDs = treeIDs && treeIDs.length === numPoints;
  const extraBytesPerPoint = hasTreeIDs ? 4 : 0; // 4 bytes for float32 treeID
  
  // Use format 3 when we have colors AND treeIDs to avoid laspy validation errors
  // Format 3 includes RGB + GPS Time = 34 bytes base
  const pointDataRecordFormat = (colors && hasTreeIDs) ? 3 : (colors ? 2 : 0);
  const basePointRecordLength = (colors && hasTreeIDs) ? 34 : (colors ? 26 : 20);
  const pointDataRecordLength = basePointRecordLength + extraBytesPerPoint;
  
  // Need VLR for extra bytes if we have treeID
  const vlrHeaderSize = hasTreeIDs ? 54 : 0; // VLR header for extra bytes
  const vlrDataSize = hasTreeIDs ? 192 : 0; // Extra Bytes VLR data size for one field
  const totalVLRSize = vlrHeaderSize + vlrDataSize;
  
  const pointDataOffset = 227 + totalVLRSize; // Header size for LAS 1.2 + VLRs

  // Calculate total file size
  const totalFileSize = pointDataOffset + (numPoints * pointDataRecordLength);

  // Create ArrayBuffer for the entire file
  const buffer = new ArrayBuffer(totalFileSize);
  const dataView = new DataView(buffer);
  const uint8View = new Uint8Array(buffer);

  // Write LAS header (LAS 1.2)
  
  // File Signature (4 bytes) - "LASF"
  uint8View[0] = 'L'.charCodeAt(0);
  uint8View[1] = 'A'.charCodeAt(0);
  uint8View[2] = 'S'.charCodeAt(0);
  uint8View[3] = 'F'.charCodeAt(0);

  // File Source ID (2 bytes)
  dataView.setUint16(4, 0, true);

  // Global Encoding (2 bytes)
  dataView.setUint16(6, 0, true);

  // Project ID - GUID data 1-4 (16 bytes) - all zeros
  for (let i = 8; i < 24; i++) {
    uint8View[i] = 0;
  }

  // Version Major (1 byte) - 1
  uint8View[24] = 1;

  // Version Minor (1 byte) - 2
  uint8View[25] = 2;

  // System Identifier (32 bytes) - "Point Cloud Viewer Export"
  const systemId = "Point Cloud Viewer Export";
  for (let i = 0; i < 32; i++) {
    uint8View[26 + i] = i < systemId.length ? systemId.charCodeAt(i) : 0;
  }

  // Generating Software (32 bytes)
  const software = "LAS Exporter 1.0";
  for (let i = 0; i < 32; i++) {
    uint8View[58 + i] = i < software.length ? software.charCodeAt(i) : 0;
  }

  // File Creation Day of Year (2 bytes)
  const now = new Date();
  const startOfYear = new Date(now.getFullYear(), 0, 0);
  const diff = now - startOfYear;
  const oneDay = 1000 * 60 * 60 * 24;
  const dayOfYear = Math.floor(diff / oneDay);
  dataView.setUint16(90, dayOfYear, true);

  // File Creation Year (2 bytes)
  dataView.setUint16(92, now.getFullYear(), true);

  // Header Size (2 bytes) - 227 for LAS 1.2
  dataView.setUint16(94, 227, true);

  // Offset to Point Data (4 bytes)
  dataView.setUint32(96, pointDataOffset, true);

  // Number of Variable Length Records (4 bytes)
  dataView.setUint32(100, hasTreeIDs ? 1 : 0, true);

  // Point Data Record Format (1 byte)
  uint8View[104] = pointDataRecordFormat;

  // Point Data Record Length (2 bytes)
  dataView.setUint16(105, pointDataRecordLength, true);

  // Legacy Number of Point Records (4 bytes)
  dataView.setUint32(107, numPoints, true);

  // Legacy Number of Points by Return (20 bytes - 5 uint32)
  for (let i = 0; i < 5; i++) {
    dataView.setUint32(111 + (i * 4), 0, true);
  }

  // X Scale Factor (8 bytes - double)
  dataView.setFloat64(131, xScale, true);

  // Y Scale Factor (8 bytes - double)
  dataView.setFloat64(139, yScale, true);

  // Z Scale Factor (8 bytes - double)
  dataView.setFloat64(147, zScale, true);

  // X Offset (8 bytes - double)
  dataView.setFloat64(155, xOffset, true);

  // Y Offset (8 bytes - double)
  dataView.setFloat64(163, yOffset, true);

  // Z Offset (8 bytes - double)
  dataView.setFloat64(171, zOffset, true);

  // Max X (8 bytes - double)
  dataView.setFloat64(179, xMax, true);

  // Min X (8 bytes - double)
  dataView.setFloat64(187, xMin, true);

  // Max Y (8 bytes - double)
  dataView.setFloat64(195, yMax, true);

  // Min Y (8 bytes - double)
  dataView.setFloat64(203, yMin, true);

  // Max Z (8 bytes - double)
  dataView.setFloat64(211, zMax, true);

  // Min Z (8 bytes - double)
  dataView.setFloat64(219, zMin, true);

  // Write Variable Length Records (VLRs) if we have treeID
  if (hasTreeIDs) {
    let vlrOffset = 227; // Start after header
    
    // VLR Header for Extra Bytes
    // Reserved (2 bytes)
    dataView.setUint16(vlrOffset, 0, true);
    vlrOffset += 2;
    
    // User ID (16 bytes) - "LASF_Spec"
    const userId = "LASF_Spec";
    for (let i = 0; i < 16; i++) {
      uint8View[vlrOffset + i] = i < userId.length ? userId.charCodeAt(i) : 0;
    }
    vlrOffset += 16;
    
    // Record ID (2 bytes) - 4 for Extra Bytes
    dataView.setUint16(vlrOffset, 4, true);
    vlrOffset += 2;
    
    // Record Length After Header (2 bytes) - 192 bytes for one Extra Bytes struct
    dataView.setUint16(vlrOffset, 192, true);
    vlrOffset += 2;
    
    // Description (32 bytes)
    const description = "TreeID";
    for (let i = 0; i < 32; i++) {
      uint8View[vlrOffset + i] = i < description.length ? description.charCodeAt(i) : 0;
    }
    vlrOffset += 32;
    
    // Extra Bytes Struct (192 bytes)
    // Reserved (2 bytes)
    dataView.setUint16(vlrOffset, 0, true);
    vlrOffset += 2;
    
    // Data type (1 byte) - 10 for float (4 bytes)
    uint8View[vlrOffset] = 10;
    vlrOffset += 1;
    
    // Options (1 byte)
    uint8View[vlrOffset] = 0;
    vlrOffset += 1;
    
    // Name (32 bytes)
    const fieldName = "treeID";
    for (let i = 0; i < 32; i++) {
      uint8View[vlrOffset + i] = i < fieldName.length ? fieldName.charCodeAt(i) : 0;
    }
    vlrOffset += 32;
    
    // Unused (4 bytes)
    dataView.setUint32(vlrOffset, 0, true);
    vlrOffset += 4;
    
    // No data (3 doubles - 24 bytes)
    for (let i = 0; i < 3; i++) {
      dataView.setFloat64(vlrOffset, 0, true);
      vlrOffset += 8;
    }
    
    // Min (3 doubles - 24 bytes)
    for (let i = 0; i < 3; i++) {
      dataView.setFloat64(vlrOffset, 0, true);
      vlrOffset += 8;
    }
    
    // Max (3 doubles - 24 bytes)
    for (let i = 0; i < 3; i++) {
      dataView.setFloat64(vlrOffset, 0, true);
      vlrOffset += 8;
    }
    
    // Scale (3 doubles - 24 bytes)
    for (let i = 0; i < 3; i++) {
      dataView.setFloat64(vlrOffset, 1.0, true);
      vlrOffset += 8;
    }
    
    // Offset (3 doubles - 24 bytes)
    for (let i = 0; i < 3; i++) {
      dataView.setFloat64(vlrOffset, 0, true);
      vlrOffset += 8;
    }
    
    // Description (32 bytes)
    const fieldDesc = "Tree ID value";
    for (let i = 0; i < 32; i++) {
      uint8View[vlrOffset + i] = i < fieldDesc.length ? fieldDesc.charCodeAt(i) : 0;
    }
    vlrOffset += 32;
    
    console.log(`Added Extra Bytes VLR for treeID at offset ${vlrOffset}`);
  }

  // Write point data
  let offset = pointDataOffset;
  
  for (let i = 0; i < numPoints; i++) {
    const idx = i * 3;
    const x = positions[idx];
    const y = positions[idx + 1];
    const z = positions[idx + 2];

    // Convert to scaled integer values
    const xInt = Math.round((x - xOffset) / xScale);
    const yInt = Math.round((y - yOffset) / yScale);
    const zInt = Math.round((z - zOffset) / zScale);

    // X (4 bytes - int32)
    dataView.setInt32(offset, xInt, true);
    offset += 4;

    // Y (4 bytes - int32)
    dataView.setInt32(offset, yInt, true);
    offset += 4;

    // Z (4 bytes - int32)
    dataView.setInt32(offset, zInt, true);
    offset += 4;

    // Intensity (2 bytes - uint16) - default to 0
    dataView.setUint16(offset, 0, true);
    offset += 2;

    // Return Number, Number of Returns, Scan Direction, Edge of Flight Line (1 byte)
    uint8View[offset] = 0x01; // First return of one return
    offset += 1;

    // Classification (1 byte) - default to unclassified (0)
    uint8View[offset] = 0;
    offset += 1;

    // Scan Angle Rank (1 byte - int8)
    dataView.setInt8(offset, 0);
    offset += 1;

    // User Data (1 byte)
    uint8View[offset] = 0;
    offset += 1;

    // Point Source ID (2 bytes - uint16)
    dataView.setUint16(offset, 0, true);
    offset += 2;

    // For Format 3, add GPS Time before RGB
    if (pointDataRecordFormat === 3) {
      // GPS Time (8 bytes - double) - default to 0
      dataView.setFloat64(offset, 0, true);
      offset += 8;
    }

    // For Format 2 or 3, add RGB values
    if ((pointDataRecordFormat === 2 || pointDataRecordFormat === 3) && colors) {
      const r = Math.round(colors[idx] * 65535);
      const g = Math.round(colors[idx + 1] * 65535);
      const b = Math.round(colors[idx + 2] * 65535);

      // Red (2 bytes - uint16)
      dataView.setUint16(offset, r, true);
      offset += 2;

      // Green (2 bytes - uint16)
      dataView.setUint16(offset, g, true);
      offset += 2;

      // Blue (2 bytes - uint16)
      dataView.setUint16(offset, b, true);
      offset += 2;
    }
    
    // Add treeID as extra bytes if available
    if (hasTreeIDs) {
      const treeID = treeIDs[i];
      dataView.setFloat32(offset, treeID, true);
      offset += 4;
    }
  }

  console.log(`LAS export complete. File size: ${totalFileSize} bytes, TreeIDs: ${hasTreeIDs ? 'Yes' : 'No'}`);

  // Create and return blob
  return new Blob([buffer], { type: 'application/octet-stream' });
};

/**
 * Downloads a LAS blob as a file
 * @param {Blob} blob - The LAS file blob
 * @param {string} filename - The desired filename
 */
export const downloadLASFile = (blob, filename) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

