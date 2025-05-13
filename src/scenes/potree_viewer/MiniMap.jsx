import React, { useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
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

const MiniMapContent = ({ files, currentPointCloudUrl, initialCenter, initialZoom, colors }) => { // Added colors prop
  const map = useMap();
  const markerRefs = useRef({});

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
  
  useEffect(() => {
    const currentFile = files.find(file => file.potreeUrl === currentPointCloudUrl);
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
  }, [currentPointCloudUrl, files, map, initialCenter, initialZoom]);

  return (
    <>
      <TileLayer
        attribution='© <a href="https://www.openstreetmap.org/copyright">OSM</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {files.map(file => {
        const isCurrent = file.potreeUrl === currentPointCloudUrl;
        const potreeViewPath = file.potreeUrl && typeof file.potreeUrl === 'string' && file.potreeUrl !== 'pending_refresh'
          ? `/potree?url=${encodeURIComponent(file.potreeUrl)}`
          : null;
        
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
            <Popup minWidth={180} autoPanPadding={new L.Point(10, 10)}>
              <div style={{ lineHeight: 1.4 }}>
                <Typography variant="caption" component="strong" sx={{fontSize: '0.8rem', display: 'block', marginBottom: '2px'}}>
                  {file.name || 'Unnamed File'}
                </Typography>
                <Typography variant="caption" sx={{fontSize: '0.7rem'}}>
                  Coords: {file.latitude.toFixed(4)}, {file.longitude.toFixed(4)}
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
                      color: colors ? colors.greenAccent[500] : 'green', // Use color from theme if available
                      fontWeight: 'bold', 
                      display: 'block', 
                      marginTop: '5px', 
                      fontSize: '0.75rem'
                    }}
                  >
                    Currently Viewing
                  </Typography>
                ) : (
                  potreeViewPath ? (
                    <Link 
                      to={potreeViewPath} 
                      onClick={() => setTimeout(() => window.location.reload(true), 0)} 
                      style={{ 
                        fontSize: '0.75rem', 
                        textDecoration: 'none', 
                        color: colors ? colors.blueAccent[500] : '#3388cc', // Use theme color for link
                        fontWeight: 'bold', 
                        display: 'block', 
                        marginTop: '5px' 
                      }}
                    >
                      View Point Cloud
                    </Link>
                  ) : (
                    <Typography variant="caption" sx={{color: '#888', fontStyle: 'italic', display: 'block', marginTop: '5px', fontSize: '0.7rem'}}>
                      Potree data unavailable
                    </Typography>
                  )
                )}
              </div>
            </Popup>
          </Marker>
        );
      })}
    </>
  );
};

const MiniMap = ({ files = [], currentPointCloudUrl, mapHeight = '250px', mapWidth = '300px', colors }) => { // Added colors prop
  const defaultInitialCenter = [1.55, 110.35];
  const defaultInitialZoom = 5;

  let effectiveInitialCenter = defaultInitialCenter;
  let effectiveInitialZoom = defaultInitialZoom;

  const currentFile = files.find(file => file.potreeUrl === currentPointCloudUrl);

  if (currentFile) {
    effectiveInitialCenter = [currentFile.latitude, currentFile.longitude];
    effectiveInitialZoom = 13;
  } else if (files.length > 0) {
    effectiveInitialCenter = [files[0].latitude, files[0].longitude];
    effectiveInitialZoom = 7; 
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
      attributionControl={false}
      zoomControl={false}
    >
      <MiniMapContent
        files={files}
        currentPointCloudUrl={currentPointCloudUrl}
        initialCenter={effectiveInitialCenter}
        initialZoom={effectiveInitialZoom}
        colors={colors} // Pass colors down
      />
    </MapContainer>
  );
};

export default MiniMap;