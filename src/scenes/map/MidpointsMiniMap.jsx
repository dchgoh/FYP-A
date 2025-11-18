// src/scenes/map/MidpointsMiniMap.jsx
import React, { useEffect, useRef, useMemo } from 'react';
import { MapContainer, TileLayer, CircleMarker, FeatureGroup, Tooltip, Circle } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Box, Typography, useTheme } from '@mui/material'; // Import MUI components for message styling

const miniMapTileUrl = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const MAX_MINI_MAP_ZOOM = 22;
const OSM_MAX_NATIVE_ZOOM = 19;

// --- Styling for Midpoint CircleMarkers in Mini-Map ---
const miniMidpointInitialRadius = 5;
const miniMidpointHoverRadius = 7;

const miniMidpointPathOptions = {
  fillColor: "#ff7800",
  color: "#000",
  weight: 1,
  opacity: 1,
  fillOpacity: 0.8,
  className: 'mini-map-midpoint-circle'
};

const miniMidpointHoverPathOptions = {
  fillColor: "#ff9933",
  weight: 2,
  fillOpacity: 0.9,
};

// --- Styling for Encompassing Plot Circle ---
const plotCircleStyleMini = {
  color: '#3388ff',
  weight: 1,
  opacity: 0.6,
  fillOpacity: 0.1,
  fillColor: '#3388ff',
};

const plotCircleHoverStyleMini = {
  color: '#0056b3',
  weight: 2,
  opacity: 0.8,
  fillOpacity: 0.2,
  fillColor: '#0056b3',
};

const formatNumber = (value, decimals = 2, unit = '') => {
  if (typeof value === 'number' && !isNaN(value)) {
    return `${value.toFixed(decimals)}${unit ? ` ${unit}` : ''}`;
  }
  return 'N/A';
};

const calculateEncompassingCircleParams = (validPointsArray) => {
  if (!validPointsArray || validPointsArray.length === 0) return null;
  if (validPointsArray.length === 1) {
    return {
      center: [validPointsArray[0].latitude, validPointsArray[0].longitude],
      radius: 15
    };
  }
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  validPointsArray.forEach(point => {
    minLat = Math.min(minLat, point.latitude); maxLat = Math.max(maxLat, point.latitude);
    minLng = Math.min(minLng, point.longitude); maxLng = Math.max(maxLng, point.longitude);
  });
  const centerLat = (minLat + maxLat) / 2; const centerLng = (minLng + maxLng) / 2;
  const southWest = L.latLng(minLat, minLng); const northEast = L.latLng(maxLat, maxLng);
  const diagonalDistance = southWest.distanceTo(northEast);
  let radius = diagonalDistance / 2 * 1.10;
  return { center: [centerLat, centerLng], radius: Math.max(radius, 10) };
};


const MidpointsMiniMap = ({ midpoints, centerCoords, mainFileName }) => {
  const mapRef = useRef(null);
  const mapContainerRef = useRef(null); // For the outer div
  const theme = useTheme(); // For accessing MUI theme breakpoints if needed

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
        /* Basic Leaflet tooltip responsiveness */
        .leaflet-tooltip {
            max-width: 250px; /* Prevent tooltips from getting too wide */
            word-wrap: break-word; /* Allow long words to break */
        }
      `;
      document.head.appendChild(styleSheet);
    }
  }, []);

  const validMidpoints = useMemo(() => {
    if (!midpoints) return [];
    return Object.values(midpoints).filter(m => m && typeof m.latitude === 'number' && typeof m.longitude === 'number');
  }, [midpoints]);

  const encompassingCircle = useMemo(() => {
    return calculateEncompassingCircleParams(validMidpoints);
  }, [validMidpoints]);

  useEffect(() => {
    if (mapRef.current) {
      const map = mapRef.current;
      const timer = setTimeout(() => {
        if (mapRef.current) {
          map.invalidateSize();
          // Only set initial view if map hasn't been interacted with
          const currentCenter = map.getCenter();
          const currentZoom = map.getZoom();
          const isAtInitialPosition = (currentCenter.lat === 0 && currentCenter.lng === 0) || currentZoom <= 3;
          
          if (isAtInitialPosition) {
            if (validMidpoints.length > 0) {
              const pointsForBounds = validMidpoints.map(m => [m.latitude, m.longitude]);
              const bounds = L.latLngBounds(pointsForBounds);
              map.fitBounds(bounds.pad(0.05), {
                maxZoom: MAX_MINI_MAP_ZOOM,
                padding: [5, 5]
              });
            } else if (centerCoords) {
              map.setView(centerCoords, 18);
            }
          }
        }
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [validMidpoints, centerCoords]); // Removed mainFileName from dependencies


  if (!midpoints || Object.keys(midpoints).length === 0) {
    const message = mainFileName
      ? `No midpoints to display on map for ${mainFileName}.`
      : "No midpoints to display on map.";
    return (
        // Use MUI Box for consistent styling and responsive props
        <Box
            sx={{
                height: '300px', // Match map height
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: '1px solid #ccc',
                borderRadius: '4px', // Match potential map border-radius
                textAlign: 'center',
                fontStyle: 'italic',
                p: { xs: 1, sm: 2 }, // Responsive padding
                backgroundColor: theme.palette.mode === 'dark' ? theme.palette.grey[800] : theme.palette.grey[200], // Theme-aware background
                color: theme.palette.text.secondary,
            }}
        >
            <Typography variant="caption">{message}</Typography>
        </Box>
    );
  }

  let initialCenter = centerCoords || [0,0];
  let initialZoom = centerCoords ? 18 : 2;
  if (validMidpoints.length > 0) {
    initialCenter = [validMidpoints[0].latitude, validMidpoints[0].longitude];
    initialZoom = 19;
  }

  // --- Styles for Tooltip Content (Can be adjusted with MUI theme for more power) ---
  const tooltipContentStyle = {
    fontFamily: theme.typography.fontFamily || '"Helvetica Neue", Arial, sans-serif',
    fontSize: { xs: '11px', sm: '12px', md: '13px' }, // Responsive font size example
    lineHeight: '1.5',
    padding: { xs: '3px 5px', sm: '4px 6px' },
    maxWidth: '220px', // Max width for individual tooltips
    wordBreak: 'break-word',
  };

  const metricLabelStyle = {
    display: 'inline-block',
    minWidth: { xs: '60px', sm: '70px', md: '80px' }, // Responsive minWidth
    fontWeight: 500,
    color: theme.palette.text.secondary,
    marginRight: '5px',
    fontSize: 'inherit', // Inherit from parent tooltipContentStyle
  };

  const valueStyle = {
    color: theme.palette.text.primary,
    fontSize: 'inherit', // Inherit
  };

  // Outer div for the map container. Its responsiveness is largely dictated by its parent in the DOM.
  // The `height` is fixed here, which is common for a mini-map.
  // If `height` needs to be responsive (e.g., percentage of viewport or parent),
  // that would be set here, e.g., `height: '50vh'` or `height: '100%'` (if parent has defined height).
  return (
    <Box
        ref={mapContainerRef}
        sx={{
            height: '300px', // Or responsive height if needed e.g. { xs: '200px', sm: '300px' }
            width: '100%',
            marginBottom: '10px',
            border: '1px solid #ccc',
            borderRadius: '4px', // Optional: for rounded corners
            position: 'relative', // Good for potential overlays or absolute positioned elements inside
            overflow: 'hidden', // Prevent content from overflowing
        }}
    >
      <MapContainer
        center={initialCenter}
        zoom={initialZoom}
        maxZoom={MAX_MINI_MAP_ZOOM}
        style={{ height: '100%', width: '100%', borderRadius: 'inherit', overflow: 'hidden' }} // Inherit border radius from parent Box
        scrollWheelZoom={true}
        zoomControl={true} // Leaflet's zoom control is fairly responsive
        attributionControl={false} // Usually not needed for a mini-map
        whenCreated={(mapInstance) => { mapRef.current = mapInstance; }}
      >
        <TileLayer
            url={miniMapTileUrl}
            maxZoom={MAX_MINI_MAP_ZOOM}
            maxNativeZoom={OSM_MAX_NATIVE_ZOOM}
        />

        {encompassingCircle && (
          <Circle
            center={encompassingCircle.center}
            radius={encompassingCircle.radius}
            pathOptions={plotCircleStyleMini}
            eventHandlers={{
              mouseover: (e) => e.target.setStyle(plotCircleHoverStyleMini),
              mouseout: (e) => e.target.setStyle(plotCircleStyleMini)
            }}
          >
            <Tooltip sticky>
              <Box sx={{ fontWeight: 'bold', mb: 0.5, fontSize: { xs: '10px', sm: '11px' } }}> {/* Responsive font size */}
                {mainFileName ? `Scan Area: ${mainFileName}` : 'Midpoint Scan Area'}
              </Box>
              <Box sx={{ fontSize: { xs: '10px', sm: '11px' } }}> {/* Responsive font size */}
                Total Trees: {validMidpoints.length}
              </Box>
            </Tooltip>
          </Circle>
        )}

        <FeatureGroup>
          {Object.entries(midpoints).map(([treeId, midpointData]) => {
            if (midpointData && typeof midpointData.latitude === 'number' && typeof midpointData.longitude === 'number') {
              const metricsToDisplay = [];
              if (midpointData.hasOwnProperty('dbh_cm') && midpointData.dbh_cm !== undefined) {
                metricsToDisplay.push({ label: 'DBH:', value: formatNumber(midpointData.dbh_cm, 1, 'cm') });
              }
              if (midpointData.hasOwnProperty('height_m') && midpointData.height_m !== undefined) {
                metricsToDisplay.push({ label: 'Height:', value: formatNumber(midpointData.height_m, 1, 'm') });
              }
              if (midpointData.hasOwnProperty('stem_volume_m3') && midpointData.stem_volume_m3 !== undefined) {
                metricsToDisplay.push({ label: 'Stem Vol:', value: formatNumber(midpointData.stem_volume_m3, 3, 'm³') });
              }
              if (midpointData.hasOwnProperty('ag_volume_m3') && midpointData.ag_volume_m3 !== undefined) {
                metricsToDisplay.push({ label: 'AG Vol:', value: formatNumber(midpointData.ag_volume_m3, 3, 'm³') });
              }
              if (midpointData.hasOwnProperty('total_volume_m3') && midpointData.total_volume_m3 !== undefined) {
                metricsToDisplay.push({ label: 'Total Vol:', value: formatNumber(midpointData.total_volume_m3, 3, 'm³') });
              }
              if (midpointData.hasOwnProperty('biomass_tonnes') && midpointData.biomass_tonnes !== undefined) {
                metricsToDisplay.push({ label: 'Biomass:', value: formatNumber(midpointData.biomass_tonnes, 3, 'tonnes') });
              }
              if (midpointData.hasOwnProperty('carbon_tonnes') && midpointData.carbon_tonnes !== undefined) {
                metricsToDisplay.push({ label: 'Carbon:', value: formatNumber(midpointData.carbon_tonnes, 3, 'tonnes') });
              }
              if (midpointData.hasOwnProperty('co2_equivalent_tonnes') && midpointData.co2_equivalent_tonnes !== undefined) {
                metricsToDisplay.push({ label: 'CO₂eq:', value: formatNumber(midpointData.co2_equivalent_tonnes, 3, 'tonnes') });
              }

              return (
                <CircleMarker
                  key={treeId}
                  center={[midpointData.latitude, midpointData.longitude]}
                  radius={miniMidpointInitialRadius}
                  pathOptions={miniMidpointPathOptions}
                  eventHandlers={{
                    mouseover: (event) => {
                        const layer = event.target;
                        layer.setStyle(miniMidpointHoverPathOptions);
                        layer.setRadius(miniMidpointHoverRadius);
                        layer.bringToFront();
                    },
                    mouseout: (event) => {
                        const layer = event.target;
                        const { className, ...restInitialOptions } = miniMidpointPathOptions;
                        layer.setStyle(restInitialOptions);
                        layer.setRadius(miniMidpointInitialRadius);
                    },
                  }}
                >
                  <Tooltip sticky>
                    {/* Use MUI Box for applying sx prop to tooltip content */}
                    <Box sx={tooltipContentStyle}>
                      <Box sx={{ mb: 0.5 }}>
                        <Typography component="span" sx={{ ...metricLabelStyle, fontWeight: 'bold', minWidth: {xs: '50px', sm: '60px'} }}>Tree ID:</Typography>
                        <Typography component="span" sx={valueStyle}>{treeId}</Typography>
                      </Box>
                      <Box sx={{ mb: 1 }}>
                        <Typography component="span" sx={{ ...metricLabelStyle, fontWeight: 'bold', minWidth: {xs: '50px', sm: '60px'} }}>Coords:</Typography>
                        <Typography component="span" sx={valueStyle}>
                          {formatNumber(midpointData.latitude, 4)}, {formatNumber(midpointData.longitude, 4)}
                        </Typography>
                      </Box>

                      {metricsToDisplay.length > 0 && (
                        <Box sx={{ borderTop: `1px solid ${theme.palette.divider}`, pt: 1, mt: 0.5 }}>
                          {metricsToDisplay.map((metric, index) => (
                            <Box key={index} sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.25 }}>
                              <Typography component="span" sx={metricLabelStyle}>{metric.label}</Typography>
                              <Typography component="span" sx={valueStyle}>{metric.value}</Typography>
                            </Box>
                          ))}
                        </Box>
                      )}
                    </Box>
                  </Tooltip>
                </CircleMarker>
              );
            }
            return null;
          })}
        </FeatureGroup>
      </MapContainer>
    </Box>
  );
};

export default MidpointsMiniMap;