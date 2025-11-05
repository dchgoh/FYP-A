import React, { useEffect, useRef, useMemo, useState } from 'react';
import { MapContainer, TileLayer, Marker, CircleMarker, Popup, FeatureGroup, Tooltip, useMap, Rectangle, Circle } from 'react-leaflet';
import { Link } from 'react-router-dom';
import 'leaflet/dist/leaflet.css';
import { Typography, Box } from '@mui/material';
import L from 'leaflet';

// --- Leaflet Icon Fix ---
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: require('leaflet/dist/images/marker-icon-2x.png'),
  iconUrl: require('leaflet/dist/images/marker-icon.png'),
  shadowUrl: require('leaflet/dist/images/marker-shadow.png'),
});
// --- End Icon Fix ---

// Constants
const MAX_MINI_MAP_ZOOM = 22;
const OSM_MAX_NATIVE_ZOOM = 19;

// --- Styling for Midpoint CircleMarkers ---
const midpointInitialRadius = 5;
const midpointHoverRadius = 7;

const midpointPathOptions = {
  fillColor: "#ff7800",
  color: "#000",
  weight: 1,
  opacity: 1,
  fillOpacity: 0.8,
  className: 'mini-map-midpoint-circle'
};

const midpointVisiblePathOptions = {
  fillColor: "#00ff00", // Green for visible trees
  color: "#000",
  weight: 2,
  opacity: 1,
  fillOpacity: 0.9,
  className: 'mini-map-midpoint-circle'
};

const midpointHoverPathOptions = {
  fillColor: "#ff9933",
  weight: 2,
  fillOpacity: 0.9,
};

const midpointVisibleHoverPathOptions = {
  fillColor: "#33ff33", // Brighter green on hover
  weight: 3,
  fillOpacity: 1.0,
};

// Add new constants for plot rectangle styling
const plotRectangleStyle = {
  color: '#2196F3',
  weight: 1,
  opacity: 0.5,
  fillOpacity: 0.1,
  fillColor: '#2196F3',
};

const plotRectangleHoverStyle = {
  color: '#1976D2',
  weight: 2,
  opacity: 0.7,
  fillOpacity: 0.2,
  fillColor: '#1976D2',
};

// Add new constants for circle styling
const plotCircleStyle = {
  color: '#2196F3',
  weight: 1,
  opacity: 0.5,
  fillOpacity: 0.1,
  fillColor: '#2196F3',
};

const plotCircleHoverStyle = {
  color: '#1976D2',
  weight: 2,
  opacity: 0.7,
  fillOpacity: 0.2,
  fillColor: '#1976D2',
};

// Add zoom threshold constant
const ZOOM_THRESHOLD = 15; // Adjust this value to change when the switch happens

// Helper function to format numbers for tooltips
const formatNumber = (value, decimals = 2, unit = '') => {
  if (typeof value === 'number' && !isNaN(value)) {
    return `${value.toFixed(decimals)}${unit ? ` ${unit}` : ''}`;
  }
  return 'N/A';
};

// Helper function to calculate bounding box for a group of points
const calculateBoundingBox = (points) => {
  if (!points || points.length === 0) return null;
  
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;

  points.forEach(point => {
    if (point && typeof point.latitude === 'number' && typeof point.longitude === 'number') {
      minLat = Math.min(minLat, point.latitude);
      maxLat = Math.max(maxLat, point.latitude);
      minLng = Math.min(minLng, point.longitude);
      maxLng = Math.max(maxLng, point.longitude);
    }
  });

  // Add padding to the bounding box (0.5% of the range)
  const latPadding = (maxLat - minLat) * 0.005;
  const lngPadding = (maxLng - minLng) * 0.005;

  return [
    [minLat - latPadding, minLng - lngPadding],
    [maxLat + latPadding, maxLng + lngPadding]
  ];
};

// Helper function to calculate circle parameters for a group of points
const calculateCircleParams = (points) => {
  if (!points || points.length === 0) return null;
  
  let minLat = Infinity, maxLat = -Infinity;
  let minLng = Infinity, maxLng = -Infinity;
  
  points.forEach(point => {
    if (point && typeof point.latitude === 'number' && typeof point.longitude === 'number') {
      minLat = Math.min(minLat, point.latitude);
      maxLat = Math.max(maxLat, point.latitude);
      minLng = Math.min(minLng, point.longitude);
      maxLng = Math.max(maxLng, point.longitude);
    }
  });
  
  // Calculate center
  const centerLat = (minLat + maxLat) / 2;
  const centerLng = (minLng + maxLng) / 2;
  
  // Calculate radius in meters (using the Haversine formula)
  const R = 6371000; // Earth's radius in meters
  const dLat = (maxLat - minLat) * Math.PI / 180;
  const dLng = (maxLng - minLng) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
           Math.cos(minLat * Math.PI / 180) * Math.cos(maxLat * Math.PI / 180) *
           Math.sin(dLng/2) * Math.sin(dLng/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  const distance = R * c;
  
  // Add 20% padding to the radius
  const radius = (distance / 2) * 1.2;
  
  return {
    center: [centerLat, centerLng],
    radius: radius
  };
};

const MiniMapContent = ({ files, currentFileId, initialCenter, initialZoom, colors, onTreeIDSelect, visibleTreeIDs }) => {
  const map = useMap();
  const markerRefs = useRef({});
  const [currentZoom, setCurrentZoom] = useState(initialZoom);

  const defaultIcon = L.icon({
    iconRetinaUrl: require('leaflet/dist/images/marker-icon-2x.png'),
    iconUrl: require('leaflet/dist/images/marker-icon.png'),
    shadowUrl: require('leaflet/dist/images/marker-shadow.png'),
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41]
  });

  const redMarkerSvg = `<svg viewBox="0 0 24 24" fill="#FF0000" width="32px" height="32px" xmlns="http://www.w3.org/2000/svg"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" filter="url(#drop-shadow)"/><filter id="drop-shadow"><feDropShadow dx="0" dy="1" stdDeviation="1" flood-color="#000000" flood-opacity="0.5"/></filter></svg>`;
  const currentIcon = L.divIcon({
    html: redMarkerSvg,
    className: 'current-location-div-icon',
    iconSize: [32, 32],
    iconAnchor: [16, 32],
    popupAnchor: [0, -32]
  });

  // Inject CSS for marker transitions
  useEffect(() => {
    const styleId = 'mini-map-hover-styles';
    if (!document.getElementById(styleId)) {
      const styleSheet = document.createElement("style");
      styleSheet.id = styleId;
      styleSheet.innerText = `
        .mini-map-midpoint-circle {
          transition-property: r, fill, stroke, stroke-width, fill-opacity, stroke-opacity;
          transition-duration: 0.15s;
          transition-timing-function: ease-out;
        }
      `;
      document.head.appendChild(styleSheet);
    }
  }, []);

  // Add zoom change handler
  useEffect(() => {
    const handleZoomEnd = () => {
      setCurrentZoom(map.getZoom());
    };

    map.on('zoomend', handleZoomEnd);
    setCurrentZoom(map.getZoom()); // Set initial zoom

    return () => {
      map.off('zoomend', handleZoomEnd);
    };
  }, [map]);

  useEffect(() => {
    const currentFile = files.find(file => file.id === currentFileId);
    if (currentFile) {
      const position = [currentFile.latitude, currentFile.longitude];
      
      const flyAndOpenPopup = () => {
        const markerInstance = markerRefs.current[`marker-${currentFile.id}`];
        if (markerInstance && typeof markerInstance.openPopup === 'function') {
          map.once('moveend', () => {
             setTimeout(() => markerInstance.openPopup(), 50);
          });
          map.panTo(position);
        }
      };

      if (map.getZoom() < 13 || !map.getBounds().contains(position)) {
        map.flyTo(position, 14, { animate: true, duration: 1 }).once('zoomend', flyAndOpenPopup);
      } else {
        flyAndOpenPopup();
      }
    } else if (files.length > 0 && initialCenter && !map.getBounds().contains(initialCenter)) {
      map.flyTo(initialCenter, initialZoom, { animate: true, duration: 0.5 });
    }
  }, [currentFileId, files, map, initialCenter, initialZoom]);

  // Styles for tooltips
  const tooltipContentStyle = {
    fontFamily: '"Helvetica Neue", Arial, sans-serif',
    fontSize: '11px',
    lineHeight: '1.4',
    padding: '3px 4px',
    maxWidth: '160px',
  };

  const metricLabelStyle = {
    display: 'inline-block',
    minWidth: '60px',
    fontWeight: '500',
    color: '#444',
    marginRight: '3px',
  };

  const valueStyle = {
    color: '#111',
    fontSize: '11px',
  };

  // Group midpoints by plot - only include trees from current file
  const plotGroups = useMemo(() => {
    const groups = {};
    
    files.forEach(file => {
      // Only process the current file for area circles and tree display
      if (file.id === currentFileId && file.tree_midpoints) {
        const plotKey = file.plot_name || 'unassigned';
        if (!groups[plotKey]) {
          groups[plotKey] = {
            name: plotKey,
            points: [],
            files: [],
            projectName: file.projectName || 'Unassigned',
            divisionName: file.divisionName || 'N/A'
          };
        }
        
        // Add midpoints to the plot group (only from current file)
        Object.values(file.tree_midpoints).forEach(midpoint => {
          if (midpoint && typeof midpoint.latitude === 'number' && typeof midpoint.longitude === 'number') {
            groups[plotKey].points.push(midpoint);
          }
        });
        
        // Add file info to the plot group
        groups[plotKey].files.push({
          id: file.id,
          name: file.name,
          latitude: file.latitude,
          longitude: file.longitude
        });
      }
    });
    
    return groups;
  }, [files, currentFileId]);

  // Add CSS styles for popups and tooltips
  useEffect(() => {
    const styleId = 'mini-map-popup-styles';
    if (!document.getElementById(styleId)) {
      const styleSheet = document.createElement("style");
      styleSheet.id = styleId;
      styleSheet.innerText = `
        .custom-popup .leaflet-popup-content-wrapper {
          background-color: rgba(255, 255, 255, 0.95);
          border-radius: 4px;
          box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
        }
        .custom-popup .leaflet-popup-tip {
          background-color: rgba(255, 255, 255, 0.95);
        }
        .custom-tooltip .leaflet-tooltip {
          background-color: rgba(255, 255, 255, 0.95);
          border: 1px solid rgba(0, 0, 0, 0.2);
          border-radius: 4px;
          box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
        }
        .custom-tooltip .leaflet-tooltip-top:before,
        .custom-tooltip .leaflet-tooltip-bottom:before,
        .custom-tooltip .leaflet-tooltip-left:before,
        .custom-tooltip .leaflet-tooltip-right:before {
          border: none;
        }
        .leaflet-container {
          z-index: auto !important;
        }
        .leaflet-popup, .leaflet-tooltip {
          z-index: 1000 !important;
        }
        .leaflet-popup-content-wrapper, .leaflet-popup-tip, .leaflet-tooltip {
          pointer-events: auto !important;
        }
      `;
      document.head.appendChild(styleSheet);
    }
  }, []);

  return (
    <>
      <TileLayer
        attribution='© <a href="https://www.openstreetmap.org/copyright">OSM</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        maxZoom={MAX_MINI_MAP_ZOOM}
        maxNativeZoom={OSM_MAX_NATIVE_ZOOM}
      />
      
      {/* Replace Rectangle components with Circle - only show for current file */}
      {Object.entries(plotGroups).map(([plotKey, plotData]) => {
        // Only show area circle if this plot contains the current file
        const hasCurrentFile = plotData.files.some(f => f.id === currentFileId);
        if (!hasCurrentFile) return null;
        
        const circleParams = calculateCircleParams(plotData.points);
        if (!circleParams) return null;

        return (
          <Circle
            key={`plot-${plotKey}`}
            center={circleParams.center}
            radius={circleParams.radius}
            pathOptions={plotCircleStyle}
            eventHandlers={{
              mouseover: (e) => {
                const layer = e.target;
                layer.setStyle(plotCircleHoverStyle);
              },
              mouseout: (e) => {
                const layer = e.target;
                layer.setStyle(plotCircleStyle);
              }
            }}
          >
            <Tooltip 
              direction="auto" 
              permanent={false} 
              sticky
              className="custom-tooltip"
              opacity={0.95}
            >
              <div style={{ 
                fontSize: '11px', 
                padding: '4px 6px',
                lineHeight: '1.4',
                whiteSpace: 'nowrap'
              }}>
                <div style={{ 
                  borderBottom: '1px solid rgba(0,0,0,0.1)', 
                  paddingBottom: '3px', 
                  marginBottom: '3px',
                  fontWeight: 'bold' 
                }}>
                  Area Details
                </div>
                <div><strong>Plot:</strong> {plotData.name}</div>
                <div><strong>Project:</strong> {plotData.projectName}</div>
                <div><strong>Division:</strong> {plotData.divisionName}</div>
                <div style={{ 
                  marginTop: '3px', 
                  paddingTop: '3px', 
                  borderTop: '1px solid rgba(0,0,0,0.1)'
                }}>
                  <strong>Total Trees:</strong> {plotData.points.length}
                </div>
              </div>
            </Tooltip>
          </Circle>
        );
      })}

      {/* Main markers - only show when zoomed out */}
      {currentZoom < ZOOM_THRESHOLD && files.map(file => {
        const isCurrent = file.id === currentFileId;
        const pointCloudViewPath = `/pointcloud?fileId=${file.id}`;
        
        const setMarkerRef = (leafletElement) => {
          if (leafletElement) {
            markerRefs.current[`marker-${file.id}`] = leafletElement;
          }
        };

        return (
          <Marker
            position={[file.latitude, file.longitude]}
            key={`mini-${file.id}`}
            icon={isCurrent ? currentIcon : defaultIcon}
            ref={setMarkerRef}
            zIndexOffset={isCurrent ? 1000 : 0}
          >
            <Popup 
              minWidth={180} 
              autoPanPadding={new L.Point(10, 10)}
              className="custom-popup"
              autoPan={true}
              keepInView={false}
            >
              <div style={{ lineHeight: 1.4 }}>
                <Typography variant="caption" component="strong" sx={{fontSize: '0.8rem', display: 'block', marginBottom: '2px'}}>
                  {file.name || 'Unnamed File'}
                </Typography>
                <Typography variant="caption" sx={{fontSize: '0.7rem'}}>
                  Coords: {file.latitude.toFixed(4)}, {file.longitude.toFixed(4)}
                </Typography>
                <Typography variant="caption" display="block" sx={{fontSize: '0.7rem'}}>
                  Plot: {file.plot_name || 'N/A'}
                </Typography>
                <Typography variant="caption" display="block" sx={{fontSize: '0.7rem'}}>
                  Division: {file.divisionName || 'N/A'}
                </Typography>
                <Typography variant="caption" display="block" sx={{fontSize: '0.7rem'}}>
                  Project: {file.projectName || 'Unassigned'}
                </Typography>

                {isCurrent ? (
                  <Typography 
                    variant="caption" 
                    sx={{
                      color: colors ? colors.greenAccent[500] : 'green',
                      fontWeight: 'bold', 
                      display: 'block', 
                      marginTop: '5px', 
                      fontSize: '0.75rem'
                    }}
                  >
                    Currently Viewing
                  </Typography>
                ) : (
                  <Link 
                    to={pointCloudViewPath} 
                    onClick={() => setTimeout(() => window.location.reload(true), 0)} 
                    style={{ 
                      fontSize: '0.75rem', 
                      textDecoration: 'none', 
                      color: colors ? colors.blueAccent[500] : '#3388cc',
                      fontWeight: 'bold', 
                      display: 'block', 
                      marginTop: '5px' 
                    }}
                  >
                    View Point Cloud
                  </Link>
                )}
              </div>
            </Popup>
          </Marker>
        );
      })}

      {/* Tree midpoints - only show when zoomed in and only for current file */}
      {currentZoom >= ZOOM_THRESHOLD && files.map(file => {
        // Only show tree midpoints for the current file
        if (file.id !== currentFileId || !file.tree_midpoints) return null;

        return (
          <FeatureGroup key={`midpoints-group-${file.id}`}>
            {Object.entries(file.tree_midpoints).map(([treeId, midpointData]) => {
              if (midpointData && typeof midpointData.latitude === 'number' && typeof midpointData.longitude === 'number') {
                // Check if this treeID is visible
                const treeIDValue = parseInt(treeId, 10);
                const isVisible = visibleTreeIDs && visibleTreeIDs[String(treeIDValue)] !== undefined 
                  ? visibleTreeIDs[String(treeIDValue)] 
                  : false;
                
                // Use different path options based on visibility
                const currentPathOptions = isVisible ? midpointVisiblePathOptions : midpointPathOptions;
                const currentHoverPathOptions = isVisible ? midpointVisibleHoverPathOptions : midpointHoverPathOptions;
                
                const metricsToDisplay = [];
                if (midpointData.dbh_cm !== undefined) {
                  metricsToDisplay.push({ label: 'DBH:', value: formatNumber(midpointData.dbh_cm, 1, 'cm') });
                }
                if (midpointData.height_m !== undefined) {
                  metricsToDisplay.push({ label: 'Height:', value: formatNumber(midpointData.height_m, 1, 'm') });
                }
                if (midpointData.stem_volume_m3 !== undefined) {
                  metricsToDisplay.push({ label: 'Stem Vol:', value: formatNumber(midpointData.stem_volume_m3, 3, 'm³') });
                }
                if (midpointData.ag_volume_m3 !== undefined) {
                  metricsToDisplay.push({ label: 'AG Vol:', value: formatNumber(midpointData.ag_volume_m3, 3, 'm³') });
                }
                if (midpointData.total_volume_m3 !== undefined) {
                  metricsToDisplay.push({ label: 'Total Vol:', value: formatNumber(midpointData.total_volume_m3, 3, 'm³') });
                }
                if (midpointData.biomass_tonnes !== undefined) {
                  metricsToDisplay.push({ label: 'Biomass:', value: formatNumber(midpointData.biomass_tonnes, 3, 'tonnes') });
                }
                if (midpointData.carbon_tonnes !== undefined) {
                  metricsToDisplay.push({ label: 'Carbon:', value: formatNumber(midpointData.carbon_tonnes, 3, 'tonnes') });
                }
                if (midpointData.co2_equivalent_tonnes !== undefined) {
                  metricsToDisplay.push({ label: 'CO₂eq:', value: formatNumber(midpointData.co2_equivalent_tonnes, 3, 'tonnes') });
                }

                return (
                  <CircleMarker
                    key={`midpoint-${file.id}-${treeId}`}
                    center={[midpointData.latitude, midpointData.longitude]}
                    radius={midpointInitialRadius}
                    pathOptions={currentPathOptions}
                    eventHandlers={{
                      mouseover: (event) => {
                        const layer = event.target;
                        layer.setStyle(currentHoverPathOptions);
                        layer.setRadius(midpointHoverRadius);
                        layer.bringToFront();
                      },
                      mouseout: (event) => {
                        const layer = event.target;
                        const { className, ...restInitialOptions } = currentPathOptions;
                        layer.setStyle(restInitialOptions);
                        layer.setRadius(midpointInitialRadius);
                      },
                      click: (event) => {
                        // Prevent event propagation to map to avoid zooming
                        event.originalEvent.stopPropagation();
                        // Toggle treeID visibility, switch to treeID filter mode, and filter/split
                        if (onTreeIDSelect) {
                          const treeIDValue = parseInt(treeId, 10);
                          if (!isNaN(treeIDValue)) {
                            onTreeIDSelect(treeIDValue);
                          }
                        }
                      },
                      dblclick: (event) => {
                        // Prevent double-click zoom on tree markers
                        event.originalEvent.stopPropagation();
                        event.originalEvent.preventDefault();
                      },
                    }}
                  >
                    <Tooltip 
                      sticky 
                      offset={[0, -5]} 
                      direction="auto"
                      opacity={0.95}
                      className="custom-tooltip"
                      permanent={false}
                    >
                      <div style={tooltipContentStyle}>
                        <div style={{ marginBottom: '2px', fontSize: '11px' }}>
                          <strong style={{ marginRight: '3px', fontSize: '11px' }}>ID:</strong>
                          <span style={valueStyle}>{treeId}</span>
                        </div>
                        <div style={{ marginBottom: '3px', fontSize: '11px' }}>
                          <strong style={{ marginRight: '3px', fontSize: '11px' }}>Loc:</strong>
                          <span style={valueStyle}>
                            {formatNumber(midpointData.latitude, 3)},
                            {formatNumber(midpointData.longitude, 3)}
                          </span>
                        </div>

                        {metricsToDisplay.length > 0 && (
                          <div style={{ 
                            borderTop: '1px solid #e0e0e0', 
                            paddingTop: '3px', 
                            marginTop: '2px',
                            fontSize: '10px' 
                          }}>
                            {metricsToDisplay.map((metric, index) => (
                              <div key={index} style={{ 
                                display: 'flex', 
                                justifyContent: 'space-between',
                                marginBottom: '1px'
                              }}>
                                <span style={{...metricLabelStyle, fontSize: '10px'}}>{metric.label}</span>
                                <span style={{...valueStyle, fontSize: '10px'}}>{metric.value}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </Tooltip>
                  </CircleMarker>
                );
              }
              return null;
            })}
          </FeatureGroup>
        );
      })}
    </>
  );
};

const MiniMap = ({ files = [], currentFileId, mapHeight = '250px', mapWidth = '300px', colors, onTreeIDSelect, visibleTreeIDs }) => {
  const defaultInitialCenter = [1.55, 110.35]; // Sarawak, Malaysia approx.
  const defaultInitialZoom = 18; // Increased from 16 to 18 for even more zoomed in default view

  let effectiveInitialCenter = defaultInitialCenter;
  let effectiveInitialZoom = defaultInitialZoom;

  const currentFile = files.find(file => file.id === currentFileId);

  if (currentFile) {
    effectiveInitialCenter = [currentFile.latitude, currentFile.longitude];
    effectiveInitialZoom = 19; // Increased from 17 to 19 for very close current file view
  } else if (files.length > 0) {
    effectiveInitialCenter = [files[0].latitude, files[0].longitude];
    effectiveInitialZoom = 18; // Increased from 16 to 18 for closer files view
  }

  // Ensure we're still showing tree points at these zoom levels
  if (ZOOM_THRESHOLD === 15) {
    // We're well above the threshold at these zoom levels, so tree points will be visible
  }

  if (!files || files.length === 0) {
    return (
      <Box sx={{height: mapHeight, width: mapWidth, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(200,200,200,0.5)', borderRadius: '4px'}}>
        <Typography variant="caption">No map data.</Typography>
      </Box>
    );
  }

  return (
    <MapContainer
      key={`${effectiveInitialCenter.join(',')}-${effectiveInitialZoom}`}
      center={effectiveInitialCenter}
      zoom={effectiveInitialZoom}
      style={{ height: mapHeight, width: mapWidth, borderRadius: 'inherit' }}
      scrollWheelZoom={true}
      doubleClickZoom={false}
      attributionControl={false}
      zoomControl={false}
    >
      <MiniMapContent
        files={files}
        currentFileId={currentFileId}
        initialCenter={effectiveInitialCenter}
        initialZoom={effectiveInitialZoom}
        colors={colors}
        onTreeIDSelect={onTreeIDSelect}
        visibleTreeIDs={visibleTreeIDs}
      />
    </MapContainer>
  );
};

export default MiniMap;
