import React, { useState, useEffect, useCallback } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import { Link } from 'react-router-dom';
import 'leaflet/dist/leaflet.css';
import { Select, MenuItem, FormControl, InputLabel, Box, Alert as MuiAlert, Typography, CircularProgress, Grid } from '@mui/material';
import L from 'leaflet';
import MarkerClusterGroup from 'react-leaflet-markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';

// --- Leaflet Icon Fix ---
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: require('leaflet/dist/images/marker-icon-2x.png'),
  iconUrl: require('leaflet/dist/images/marker-icon.png'),
  shadowUrl: require('leaflet/dist/images/marker-shadow.png'),
});
// --- End Icon Fix ---

// Constants
const API_BASE_URL = "http://localhost:5000/api";
const ZOOM_THRESHOLD_FOR_MIDPOINTS = 14; // Adjust as needed
const MAX_MAP_AND_TILE_ZOOM = 21;//Or whatever OSM's maxNativeZoom is for your area if it varies slightly
const DECLUSTER_AT_ZOOM = 18; // Ensure this is <= MAX_MAP_AND_TILE_ZOOM

const MapComponent = ({ isCollapsed }) => {
  // --- State Variables ---
  const [mapFiles, setMapFiles] = useState([]);
  const [projects, setProjects] = useState([]);
  const [divisions, setDivisions] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState('all');
  const [selectedDivisionId, setSelectedDivisionId] = useState('all');
  const [isLoadingFiles, setIsLoadingFiles] = useState(true);
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);
  const [isLoadingDivisions, setIsLoadingDivisions] = useState(true);
  const [errorFiles, setErrorFiles] = useState(null);
  const [errorProjects, setErrorProjects] = useState(null);
  const [errorDivisions, setErrorDivisions] = useState(null);
  const [currentZoom, setCurrentZoom] = useState(5); // Initialize with a default

  const initialPosition = [1.55, 110.35]; // Default map center if no data
  const initialZoomLevel = 5;

  // --- Helper for Fetching Dropdown Data ---
  const fetchDropdownData = useCallback(async (url, token, setDataFunc, setLoadingFunc, setErrorFunc) => {
    setLoadingFunc(true); setErrorFunc(null);
    try {
      const response = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Failed to read error response');
        throw new Error(`HTTP error! Status: ${response.status}, Endpoint: ${url.replace(API_BASE_URL,'')}, Details: ${errorText.substring(0,100)}`);
      }
      const data = await response.json();
      setDataFunc(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error(`Fetch error for ${url}:`, err);
      setErrorFunc(err.message || `An error occurred while fetching data from ${url.replace(API_BASE_URL,'')}.`);
      setDataFunc([]);
    } finally {
      setLoadingFunc(false);
    }
  }, []);

  // --- Fetch Dropdown Data ONCE ---
  useEffect(() => {
    const storedToken = localStorage.getItem('authToken');
    if (!storedToken) {
      const authError = "Authentication required.";
      setErrorProjects(authError); setErrorDivisions(authError);
      setIsLoadingProjects(false); setIsLoadingDivisions(false);
      return;
    }
    fetchDropdownData(`${API_BASE_URL}/projects`, storedToken, setProjects, setIsLoadingProjects, setErrorProjects);
    fetchDropdownData(`${API_BASE_URL}/divisions`, storedToken, setDivisions, setIsLoadingDivisions, setErrorDivisions);
  }, [fetchDropdownData]);

  // --- Fetch FILTERED Map Files ---
  const fetchMapFiles = useCallback(async () => {
    const storedToken = localStorage.getItem('authToken');
    if (!storedToken) {
      setErrorFiles("Authentication required. Please log in.");
      setIsLoadingFiles(false); setMapFiles([]); return;
    }
    setIsLoadingFiles(true); setErrorFiles(null); setMapFiles([]);

    try {
      const params = new URLSearchParams();
      if (selectedProjectId && selectedProjectId !== 'all') {
          params.append('projectId', selectedProjectId === 'unassigned' ? 'null' : selectedProjectId);
      }
      if (selectedDivisionId && selectedDivisionId !== 'all') {
          params.append('divisionId', selectedDivisionId);
      }
      const query = params.toString();
      const url = `${API_BASE_URL}/files${query ? `?${query}` : ''}`;

      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${storedToken}`, 'Content-Type': 'application/json' }
      });
      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Failed to read error response');
        throw new Error(`HTTP error fetching files! Status: ${response.status}, URL: ${url}, Details: ${errorText.substring(0, 150)}`);
      }
      const filesData = await response.json();
      const filesArray = Array.isArray(filesData) ? filesData : [];

      const processedFiles = filesArray.map(f => ({
            ...f,
            projectName: f.projectName || (f.project_id ? `Project ID ${f.project_id}` : 'Unassigned'),
            divisionName: f.divisionName || (f.division_id ? `Division ID ${f.division_id}` : 'N/A'),
       }));
       console.log("Processed Files for Map:", processedFiles);
      setMapFiles(processedFiles);

    } catch (err) {
      console.error("Failed to fetch map files:", err);
      setErrorFiles(err.message || "An error occurred while fetching map files.");
      setMapFiles([]);
    } finally {
      setIsLoadingFiles(false);
    }
  }, [selectedProjectId, selectedDivisionId]);

  // --- Effect to Fetch Files ---
  useEffect(() => { fetchMapFiles(); }, [fetchMapFiles]);

  // --- Handle Dropdown Changes ---
  const handleProjectChange = (event) => { setSelectedProjectId(event.target.value); };
  const handleDivisionChange = (event) => { setSelectedDivisionId(event.target.value); };

  // --- Map View Logic ---
  let mapCenterToUse = initialPosition;
  let mapZoomToUse = currentZoom; // Use currentZoom state which is updated by MapEvents

  const filesWithMainCoords = mapFiles.filter(file =>
    file.latitude !== null && typeof file.latitude === 'number' &&
    file.longitude !== null && typeof file.longitude === 'number'
  );

  // Adjust map center based on current data and zoom, primarily for initial load or filter changes
  // This logic might still cause some "jumps" if not carefully managed with map.setView/flyTo
  // For this version, we'll keep it simpler for initial centering.
  if (currentZoom < ZOOM_THRESHOLD_FOR_MIDPOINTS && filesWithMainCoords.length > 0) {
      mapCenterToUse = [filesWithMainCoords[0].latitude, filesWithMainCoords[0].longitude];
  } else if (currentZoom >= ZOOM_THRESHOLD_FOR_MIDPOINTS) {
      const firstFileWithMidpoints = mapFiles.find(f => f.tree_midpoints && Object.keys(f.tree_midpoints).length > 0);
      if (firstFileWithMidpoints) {
          const firstMidpointKey = Object.keys(firstFileWithMidpoints.tree_midpoints)[0];
          const firstMidpoint = firstFileWithMidpoints.tree_midpoints[firstMidpointKey];
          if (firstMidpoint && typeof firstMidpoint.latitude === 'number' && typeof firstMidpoint.longitude === 'number') {
              mapCenterToUse = [firstMidpoint.latitude, firstMidpoint.longitude];
          }
      }
  } // else it remains initialPosition or what user panned to


  const error = errorFiles || errorProjects || errorDivisions;

  // --- MapEvents Component to Track Zoom ---
  const MapEvents = () => {
    const map = useMap();
    useEffect(() => {
      const onZoomEnd = () => { setCurrentZoom(map.getZoom()); };
      map.on('zoomend', onZoomEnd);
      // Set currentZoom based on the map's actual initial zoom after it's created
      setCurrentZoom(map.getZoom());
      return () => { map.off('zoomend', onZoomEnd); };
    }, [map]); // map instance is a dependency
    return null;
  };

  // Determine if any markers should be shown for the "No data" message
  const hasAnyMarkersToShow =
    (currentZoom < ZOOM_THRESHOLD_FOR_MIDPOINTS && filesWithMainCoords.length > 0) ||
    (currentZoom >= ZOOM_THRESHOLD_FOR_MIDPOINTS && (
        mapFiles.some(f => f.tree_midpoints && Object.keys(f.tree_midpoints).length > 0) || // Has midpoints
        mapFiles.some(f => // Has main coord but NO midpoints (to show main marker when zoomed in)
            filesWithMainCoords.find(fwc => fwc.id === f.id) &&
            (!f.tree_midpoints || Object.keys(f.tree_midpoints).length === 0)
        )
    ));

  return (
    <Box sx={{
        display: 'flex', flexDirection: 'column', height: 'calc(100vh - 64px)',
        marginLeft: isCollapsed ? "80px" : "270px", transition: "margin-left 0.3s ease",
        overflow: 'hidden', padding: '10px', boxSizing: 'border-box',
    }}>
      {/* --- Filter Controls Row --- */}
      <Box sx={{ marginBottom: '10px', flexShrink: 0 }}>
         <Grid container spacing={2} alignItems="center">
             <Grid item xs={12} sm={6} md={4}>
                <FormControl fullWidth size="small" variant="outlined">
                    <InputLabel id="division-filter-label">Filter by Division</InputLabel>
                    <Select labelId="division-filter-label" id="division-filter-select" value={selectedDivisionId} label="Filter by Division" onChange={handleDivisionChange} disabled={isLoadingDivisions || isLoadingFiles} MenuProps={{ PaperProps: { sx: { maxHeight: 300 } } }} >
                        <MenuItem value="all">All Divisions</MenuItem>
                        {divisions.map((division) => ( <MenuItem key={`div-${division.id}`} value={division.id.toString()}>{division.name}</MenuItem> ))}
                    </Select>
                </FormControl>
                {isLoadingDivisions && <CircularProgress size={20} sx={{ position: 'absolute', right: 35, top: '50%', transform: 'translateY(-50%)', zIndex: 1 }} />}
             </Grid>
             <Grid item xs={12} sm={6} md={4}>
                <FormControl fullWidth size="small" variant="outlined">
                    <InputLabel id="project-filter-label">Filter by Project</InputLabel>
                    <Select labelId="project-filter-label" id="project-filter-select" value={selectedProjectId} label="Filter by Project" onChange={handleProjectChange} disabled={isLoadingProjects || isLoadingFiles} MenuProps={{ PaperProps: { sx: { maxHeight: 300 } } }} >
                        <MenuItem value="all">All Projects</MenuItem>
                        <MenuItem value="unassigned"><em>Unassigned Files</em></MenuItem>
                        {projects.map((project) => ( <MenuItem key={`proj-${project.id}`} value={project.id.toString()}>{project.name}</MenuItem> ))}
                    </Select>
                </FormControl>
                 {isLoadingProjects && <CircularProgress size={20} sx={{ position: 'absolute', right: 35, top: '50%', transform: 'translateY(-50%)', zIndex: 1 }} />}
             </Grid>
         </Grid>
         {isLoadingFiles && <Typography variant="caption" sx={{ display: 'block', textAlign: 'center', mt: 1 }}>Loading map data...</Typography>}
         {error && !isLoadingFiles && <MuiAlert severity="error" sx={{ mt: 1 }}>Error: {error}</MuiAlert>}
      </Box>

      {/* --- Map Container --- */}
      <Box className="map-container" sx={{ flexGrow: 1, width: '100%', position: 'relative', border: '1px solid #ccc', borderRadius: '4px', overflow: 'hidden' }}>
        {!isLoadingFiles && !errorFiles && (
            <MapContainer
                // REMOVED the dynamic key to prevent aggressive re-mounts
                center={mapCenterToUse} // Initial center
                zoom={mapZoomToUse}     // Initial zoom
                maxZoom={MAX_MAP_AND_TILE_ZOOM}
                style={{ height: '100%', width: '100%' }}
                zoomControl={true}
                scrollWheelZoom={true}
            >
                <TileLayer
                    attribution='© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    maxZoom={MAX_MAP_AND_TILE_ZOOM}     // Layer stops rendering tiles beyond this
                    maxNativeZoom={20}// Explicitly state OSM's native max
                />
                <MapEvents /> {/* Handles zoom state update */}

                {/* --- CONDITIONAL MARKER RENDERING BASED ON ZOOM --- */}

                {/* 1. Display overview markers if zoomed OUT */}
                {currentZoom < ZOOM_THRESHOLD_FOR_MIDPOINTS && filesWithMainCoords.map(file => {
                    const potreeViewPath = file.potreeUrl && typeof file.potreeUrl === 'string' && file.potreeUrl !== 'pending_refresh'
                        ? `/potree?url=${encodeURIComponent(file.potreeUrl)}`
                        : null;
                    return (
                        <Marker
                            position={[file.latitude, file.longitude]}
                            key={`file-main-overview-${file.id}`}
                        >
                            <Popup minWidth={200}>
                                <div style={{ lineHeight: 1.5 }}>
                                    <Typography variant="subtitle2" component="strong" gutterBottom>
                                        {file.name || 'Unnamed File'} (Overview)
                                    </Typography>
                                    <Typography variant="body2">Coords: {file.latitude.toFixed(5)}, {file.longitude.toFixed(5)}</Typography>
                                    <Typography variant="body2">Division: {file.divisionName}</Typography>
                                    <Typography variant="body2">Project: {file.projectName}</Typography>
                                    {potreeViewPath ? (
                                       <Link to={potreeViewPath} style={{ textDecoration: 'none', color: '#3388cc', fontWeight: 'bold', display: 'block', marginTop: '8px' }}>
                                         View Point Cloud
                                       </Link>
                                    ) : (
                                       <Typography variant="caption" style={{color: '#999', fontStyle: 'italic', display: 'block', marginTop: '8px'}}>
                                          Potree data not ready or file not converted.
                                       </Typography>
                                    )}
                                    <Typography variant="caption" sx={{ color: 'gray', display: 'block', mt: 1 }}>
                                        Zoom in to see individual tree midpoints.
                                    </Typography>
                                </div>
                            </Popup>
                        </Marker>
                    );
                })}

                {/* 2. Display detailed markers if zoomed IN */}
                {currentZoom >= ZOOM_THRESHOLD_FOR_MIDPOINTS && (
                    <>
                        {/* 2a. Midpoints (clustered) for files that HAVE them */}
                        <MarkerClusterGroup
                             spiderfyOnMaxZoom={true}
                             showCoverageOnHover={true}
                             zoomToBoundsOnClick={true} // This can cause the map to pan/zoom to fit cluster
                             maxClusterRadius={1}   // Default is 80, smaller might feel less jumpy
                             disableClusteringAtZoom={DECLUSTER_AT_ZOOM}
                        >
                            {mapFiles
                                .filter(file => file.tree_midpoints && Object.keys(file.tree_midpoints).length > 0)
                                .flatMap(file =>
                                    Object.entries(file.tree_midpoints).map(([treeId, midpoint]) => {
                                        if (midpoint && typeof midpoint.latitude === 'number' && typeof midpoint.longitude === 'number') {
                                            return (
                                                <Marker
                                                    position={[midpoint.latitude, midpoint.longitude]}
                                                    key={`file-${file.id}-tree-${treeId}`}
                                                >
                                                    <Popup minWidth={200}>
                                                        <div style={{ lineHeight: 1.5 }}>
                                                            <Typography variant="subtitle2" component="strong" gutterBottom>Tree ID: {treeId}</Typography>
                                                            <Typography variant="body2">File: {file.name || 'Unnamed File'}</Typography>
                                                            <Typography variant="body2">Midpoint: {midpoint.latitude.toFixed(5)}, {midpoint.longitude.toFixed(5)}</Typography>
                                                            {midpoint.z_original !== undefined && (<Typography variant="body2">Original Z: {midpoint.z_original.toFixed(2)}</Typography>)}
                                                            <Typography variant="body2">Division: {file.divisionName}</Typography>
                                                            <Typography variant="body2">Project: {file.projectName}</Typography>
                                                        </div>
                                                    </Popup>
                                                </Marker>
                                            );
                                        }
                                        return null;
                                    }).filter(Boolean)
                                )}
                        </MarkerClusterGroup>

                        {/* 2b. Main file marker for files WITHOUT midpoints but with main coords */}
                        {mapFiles
                            .filter(file =>
                                filesWithMainCoords.some(fwc => fwc.id === file.id) && // Has main coords
                                (!file.tree_midpoints || Object.keys(file.tree_midpoints).length === 0) // And NO midpoints
                            )
                            .map(file => {
                                const potreeViewPath = file.potreeUrl && typeof file.potreeUrl === 'string' && file.potreeUrl !== 'pending_refresh'
                                    ? `/potree?url=${encodeURIComponent(file.potreeUrl)}`
                                    : null;
                                return (
                                    <Marker
                                        position={[file.latitude, file.longitude]}
                                        key={`file-main-zoomed-${file.id}`} // Different key
                                    >
                                        <Popup minWidth={200}>
                                            <div style={{ lineHeight: 1.5 }}>
                                                <Typography variant="subtitle2" component="strong" gutterBottom>
                                                    {file.name || 'Unnamed File'}
                                                </Typography>
                                                <Typography variant="body2">Coords: {file.latitude.toFixed(5)}, {file.longitude.toFixed(5)}</Typography>
                                                <Typography variant="body2">Division: {file.divisionName}</Typography>
                                                <Typography variant="body2">Project: {file.projectName}</Typography>
                                                {potreeViewPath ? (
                                                   <Link to={potreeViewPath} style={{ textDecoration: 'none', color: '#3388cc', fontWeight: 'bold', display: 'block', marginTop: '8px' }} target="_blank" rel="noopener noreferrer">
                                                     View Point Cloud
                                                   </Link>
                                                ) : (
                                                   <Typography variant="caption" style={{color: '#999', fontStyle: 'italic', display: 'block', marginTop: '8px'}}>
                                                      Potree data not ready or file not converted.
                                                   </Typography>
                                                )}
                                                <Typography variant="caption" sx={{ color: 'gray', display: 'block', mt: 1 }}>
                                                    (No individual tree midpoints for this file)
                                                </Typography>
                                            </div>
                                        </Popup>
                                    </Marker>
                                );
                            })}
                    </>
                )}
            </MapContainer>
        )}
        {/* --- Message for no markers found --- */}
         {!hasAnyMarkersToShow && !isLoadingFiles && !errorFiles && (
           <Box sx={{
               textAlign: 'center', padding: '10px', color: '#555', position: 'absolute',
               top: '10px', left: '50%', transform: 'translateX(-50%)',
               background: 'rgba(255,255,255,0.8)', zIndex: 1000,
               borderRadius: '4px', pointerEvents: 'none'
           }}>
             No data points found matching the current filters and zoom level.
           </Box>
         )}
         {/* Loading overlay for map area */}
         {isLoadingFiles && (
             <Box sx={{
                 position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                 backgroundColor: 'rgba(255,255,255,0.7)', display: 'flex',
                 justifyContent: 'center', alignItems: 'center', zIndex: 1100
             }}>
                 <CircularProgress />
             </Box>
         )}
      </Box>
    </Box>
  );
};

export default MapComponent;