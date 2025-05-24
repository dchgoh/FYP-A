// src/scenes/map/MidpointsMiniMap.jsx
import React, { useEffect, useRef } from 'react';
import { MapContainer, TileLayer, CircleMarker, FeatureGroup, Tooltip } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

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
  className: 'mini-map-midpoint-circle' // Class for CSS transition
};

const miniMidpointHoverPathOptions = {
  fillColor: "#ff9933", // Lighter orange
  weight: 2,
  fillOpacity: 0.9,
};


const MidpointsMiniMap = ({ midpoints, centerCoords, mainFileName }) => {
  const mapRef = useRef(null);
  const mapContainerRef = useRef(null);

  // --- Inject CSS for Mini-Map Marker Transitions ---
  useEffect(() => {
    const styleId = 'mini-map-hover-styles';
    if (!document.getElementById(styleId)) {
      const styleSheet = document.createElement("style");
      styleSheet.id = styleId;
      styleSheet.innerText = `
        .mini-map-midpoint-circle {
          transition-property: r, fill, stroke, stroke-width, fill-opacity, stroke-opacity;
          transition-duration: 0.15s; /* Faster transition for mini-map */
          transition-timing-function: ease-out;
        }
      `;
      document.head.appendChild(styleSheet);
    }
  }, []);


  useEffect(() => {
    if (mapRef.current) {
      const map = mapRef.current;
      const timer = setTimeout(() => {
        if (mapRef.current) { // Check again as mapRef could be nulled out
          map.invalidateSize();
          if (midpoints && Object.keys(midpoints).length > 0) {
            const points = Object.values(midpoints)
              .filter(m => m && typeof m.latitude === 'number' && typeof m.longitude === 'number')
              .map(m => [m.latitude, m.longitude]);

            if (points.length > 0) {
              const bounds = L.latLngBounds(points);
              map.fitBounds(bounds.pad(0.1), {
                maxZoom: MAX_MINI_MAP_ZOOM - 2
              });
            } else if (centerCoords) {
              map.setView(centerCoords, 15);
            }
          } else if (centerCoords) {
            map.setView(centerCoords, 15);
          }
        }
      }, 100); // Increased timeout slightly for complex parent components
      return () => clearTimeout(timer);
    }
  }, [midpoints, centerCoords, mainFileName]);

  // Conditional rendering if no midpoints are available
  if (!midpoints || Object.keys(midpoints).length === 0) {
    const message = mainFileName
      ? `No midpoints to display on map for ${mainFileName}.`
      : "No midpoints to display on map.";
    return <div style={{padding: '10px', textAlign: 'center', fontStyle: 'italic'}}>{message}</div>;
  }

  // Determine initial map center and zoom
  let initialCenter = centerCoords || [0,0];
  let initialZoom = centerCoords ? 15 : 2;
  const validMidpoints = Object.values(midpoints).filter(m => m && typeof m.latitude === 'number' && typeof m.longitude === 'number');

  if (validMidpoints.length > 0) {
    initialCenter = [validMidpoints[0].latitude, validMidpoints[0].longitude];
    initialZoom = validMidpoints.length === 1 ? MAX_MINI_MAP_ZOOM - 3 : 16;
  }

  // Helper to format numbers for the tooltip
  const formatNumber = (value, decimals = 2, unit = '') => {
    if (typeof value === 'number' && !isNaN(value)) {
      return `${value.toFixed(decimals)}${unit ? ` ${unit}` : ''}`;
    }
    return 'N/A';
  };

  // --- Styles for Tooltip Content ---
  const tooltipContentStyle = {
    fontFamily: '"Helvetica Neue", Arial, sans-serif',
    fontSize: '13px',
    lineHeight: '1.6',
    padding: '4px 6px', // Add some internal padding
  };

  const metricLabelStyle = {
    display: 'inline-block',
    minWidth: '80px', // Adjust based on your longest label
    fontWeight: '500', // Semi-bold for labels
    color: '#444',    // Darker grey for labels
    marginRight: '5px',
  };

  const valueStyle = {
    color: '#111', // Almost black for values
  };


  return (
    <div ref={mapContainerRef} style={{ height: '300px', width: '100%', marginBottom: '10px', border: '1px solid #ccc' }}>
      <MapContainer
        key={mainFileName || 'mini-map-default-key'}
        center={initialCenter}
        zoom={initialZoom}
        maxZoom={MAX_MINI_MAP_ZOOM}
        style={{ height: '100%', width: '100%' }}
        scrollWheelZoom={true}
        zoomControl={true}
        attributionControl={false}
        whenCreated={(mapInstance) => { mapRef.current = mapInstance; }}
      >
        <TileLayer
            url={miniMapTileUrl}
            maxZoom={MAX_MINI_MAP_ZOOM}
            maxNativeZoom={OSM_MAX_NATIVE_ZOOM}
        />
        <FeatureGroup>
          {Object.entries(midpoints).map(([treeId, midpointData]) => {
            if (midpointData && typeof midpointData.latitude === 'number' && typeof midpointData.longitude === 'number') {
              // Prepare array of metrics to display
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
              // Add other metrics here using the same pattern

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
                    <div style={tooltipContentStyle}>
                      <div style={{ marginBottom: '4px' }}>
                        <strong style={{ marginRight: '5px' }}>Tree ID:</strong>
                        <span style={valueStyle}>{treeId}</span>
                      </div>
                      <div style={{ marginBottom: '6px' }}>
                        <strong style={{ marginRight: '5px' }}>Coords:</strong>
                        <span style={valueStyle}>
                          {formatNumber(midpointData.latitude, 4)}, {formatNumber(midpointData.longitude, 4)}
                        </span>
                      </div>

                      {metricsToDisplay.length > 0 && (
                        <div style={{ borderTop: '1px solid #e0e0e0', paddingTop: '6px', marginTop: '4px' }}>
                          {metricsToDisplay.map((metric, index) => (
                            <div key={index}> {/* Using index as key is fine here if metrics order is stable for a given point */}
                              <span style={metricLabelStyle}>{metric.label}</span>
                              <span style={valueStyle}>{metric.value}</span>
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
      </MapContainer>
    </div>
  );
};

export default MidpointsMiniMap;