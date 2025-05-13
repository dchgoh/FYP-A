// src/scenes/map/MidpointsMiniMap.jsx
import React, { useEffect, useRef } from 'react';
import { MapContainer, TileLayer, CircleMarker, FeatureGroup, Tooltip } from 'react-leaflet'; // Added Tooltip
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const miniMapTileUrl = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const MAX_MINI_MAP_ZOOM = 22;
const OSM_MAX_NATIVE_ZOOM = 19;

// --- Styling for Midpoint CircleMarkers in Mini-Map ---
const miniMidpointInitialRadius = 5;
const miniMidpointHoverRadius = 7; // Slightly larger on hover

const miniMidpointPathOptions = { // Initial style
  fillColor: "#ff7800", // Orange
  color: "#000",
  weight: 1,
  opacity: 1,
  fillOpacity: 0.8,
  className: 'mini-map-midpoint-circle' // Class for CSS transition
};

const miniMidpointHoverPathOptions = { // Style for hover
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
    // No cleanup needed for this simple global style injection in this context
  }, []);


useEffect(() => {
    // This effect runs when the component mounts or when the mainFileName changes (due to the key on MapContainer)
    // It's intended to set up the map correctly when it first appears or is re-instantiated.
    if (mapRef.current) {
      const map = mapRef.current;

      // Invalidate size after a short delay to ensure the popup DOM is ready
      const timer = setTimeout(() => {
        if (mapRef.current) { // Check if map still exists (component might have unmounted)
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
      }, 10); // Increased delay slightly, can be experimented with. 0 might be too fast for complex popups.

      return () => clearTimeout(timer); // Cleanup timer
    }
  }, [midpoints, centerCoords, mainFileName]); 

  if (!midpoints || Object.keys(midpoints).length === 0) {
    return <div style={{padding: '10px', textAlign: 'center', fontStyle: 'italic'}}>No midpoints to display on map for {mainFileName}.</div>;
  }

  let initialCenter = centerCoords || [0,0];
  let initialZoom = centerCoords ? 15 : 2;
  const validMidpoints = Object.values(midpoints).filter(m => m && typeof m.latitude === 'number' && typeof m.longitude === 'number');

  if (validMidpoints.length > 0) {
    initialCenter = [validMidpoints[0].latitude, validMidpoints[0].longitude];
    initialZoom = validMidpoints.length === 1 ? MAX_MINI_MAP_ZOOM - 3 : 16;
  }

  return (
    <div ref={mapContainerRef} style={{ height: '300px', width: '100%', marginBottom: '10px', border: '1px solid #ccc' }}>
      <MapContainer
        key={mainFileName || 'mini-map'}
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
          {Object.entries(midpoints).map(([treeId, midpoint]) => {
            if (midpoint && typeof midpoint.latitude === 'number' && typeof midpoint.longitude === 'number') {
              return (
                <CircleMarker
                  key={treeId}
                  center={[midpoint.latitude, midpoint.longitude]}
                  radius={miniMidpointInitialRadius}         // Use initial radius
                  pathOptions={miniMidpointPathOptions}     // Use initial pathOptions (with className)
                  eventHandlers={{
                    mouseover: (event) => {
                        const layer = event.target;
                        layer.setStyle(miniMidpointHoverPathOptions);
                        layer.setRadius(miniMidpointHoverRadius);
                        layer.bringToFront();
                    },
                    mouseout: (event) => {
                        const layer = event.target;
                        // Reset to original style, excluding className
                        const { className, ...restInitialOptions } = miniMidpointPathOptions;
                        layer.setStyle(restInitialOptions);
                        layer.setRadius(miniMidpointInitialRadius);
                    },
                  }}
                >
                  <Tooltip sticky> {/* Sticky tooltip on hover */}
                    Tree ID: {treeId} <br />
                    Coords: {midpoint.latitude.toFixed(4)}, {midpoint.longitude.toFixed(4)}
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