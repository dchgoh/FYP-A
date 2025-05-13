import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet'; // Removed CircleMarker, Tooltip from here as they are in MidpointsMiniMap or no longer needed here for midpoints
import { Link } from 'react-router-dom';
import 'leaflet/dist/leaflet.css';
import { Select, MenuItem, FormControl, InputLabel, Box, Alert as MuiAlert, Typography, CircularProgress, Grid } from '@mui/material';
import L from 'leaflet';
import MidpointsMiniMap from './MidpointsMiniMap'; // Ensure this path is correct

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
// const ZOOM_THRESHOLD_FOR_MIDPOINTS = 14; // Less relevant now for this specific display logic
const MAX_MAP_AND_TILE_ZOOM = 21;
// const DECLUSTER_AT_ZOOM = 18; // Not needed as MarkerClusterGroup for midpoints is removed

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
  const [currentZoom, setCurrentZoom] = useState(5); // Still useful for main map behavior

  const initialPosition = [1.55, 110.35];

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
      setMapFiles(processedFiles);

    } catch (err) {
      console.error("Failed to fetch map files:", err);
      setErrorFiles(err.message || "An error occurred while fetching map files.");
      setMapFiles([]);
    } finally {
      setIsLoadingFiles(false);
    }
  }, [selectedProjectId, selectedDivisionId]);

  // --- Effect to Fetch Files when filters change ---
  useEffect(() => { fetchMapFiles(); }, [fetchMapFiles]);

  // --- Calculate Filtered Projects for Dropdown ---
  const filteredProjects = useMemo(() => {
    if (selectedDivisionId === 'all' || !projects || projects.length === 0) {
      return projects || [];
    }
    const divisionIdToCompare = parseInt(selectedDivisionId, 10);
    return projects.filter(project => project.division_id === divisionIdToCompare);
  }, [selectedDivisionId, projects]);

  // --- Handle Dropdown Changes ---
  const handleDivisionChange = (event) => {
    const newDivisionId = event.target.value;
    setSelectedDivisionId(newDivisionId);
    setSelectedProjectId('all');
  };

  const handleProjectChange = (event) => {
    setSelectedProjectId(event.target.value);
  };

  // --- Map View Logic ---
  let mapCenterToUse = initialPosition;
  // let mapZoomToUse = currentZoom; // currentZoom state is used directly in MapContainer

  const filesWithMainCoords = mapFiles.filter(file =>
    file.latitude !== null && typeof file.latitude === 'number' &&
    file.longitude !== null && typeof file.longitude === 'number'
  );

  // Adjust map center based on the first available file if needed (simple logic)
  if (filesWithMainCoords.length > 0) {
      // This logic might need refinement if you want the map to re-center
      // when filters change and new data appears. For now, it centers on first load.
      // If mapCenterToUse is meant to be dynamic with filtering, it needs more complex handling.
      // For now, let's assume initialPosition is fine or the first file is a good start.
      // if (mapCenterToUse === initialPosition) { // Only set if not already moved by user
         mapCenterToUse = [filesWithMainCoords[0].latitude, filesWithMainCoords[0].longitude];
      // }
  }


  const error = errorFiles || errorProjects || errorDivisions;

  // --- MapEvents Component to Track Zoom ---
  const MapEvents = () => {
    const map = useMap();
    useEffect(() => {
      const onZoomEnd = () => { setCurrentZoom(map.getZoom()); };
      map.on('zoomend', onZoomEnd);
      setCurrentZoom(map.getZoom()); // Initialize zoom
      return () => { map.off('zoomend', onZoomEnd); };
    }, [map]);
    return null;
  };

  // REMOVED useEffect for injecting midpoint-circle-svg styles, as it's not needed anymore.

  // Determine if any markers should be shown for the "No data" message
  // Simplified as we only show main file markers now.
  const hasAnyMarkersToShow = filesWithMainCoords.length > 0;

  const selectedDivisionName = selectedDivisionId === 'all'
    ? ''
    : divisions.find(d => d.id.toString() === selectedDivisionId)?.name || '';


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
                <FormControl fullWidth size="small" variant="outlined" sx={{ position: 'relative' }}>
                    <InputLabel id="division-filter-label">Filter by Division</InputLabel>
                    <Select
                        labelId="division-filter-label"
                        id="division-filter-select"
                        value={selectedDivisionId}
                        label="Filter by Division"
                        onChange={handleDivisionChange}
                        disabled={isLoadingDivisions || isLoadingFiles}
                        MenuProps={{ PaperProps: { sx: { maxHeight: 300 } } }}
                     >
                        <MenuItem value="all">All Divisions</MenuItem>
                        {divisions.map((division) => (
                            <MenuItem key={`div-${division.id}`} value={division.id.toString()}>{division.name}</MenuItem>
                         ))}
                    </Select>
                    {isLoadingDivisions && <CircularProgress size={20} sx={{ position: 'absolute', right: 35, top: '50%', transform: 'translateY(-50%)', zIndex: 1 }} />}
                </FormControl>
             </Grid>
             <Grid item xs={12} sm={6} md={4}>
                 <FormControl fullWidth size="small" variant="outlined" sx={{ position: 'relative' }}>
                    <InputLabel id="project-filter-label">Filter by Project</InputLabel>
                    <Select
                        labelId="project-filter-label"
                        id="project-filter-select"
                        value={selectedProjectId}
                        label="Filter by Project"
                        onChange={handleProjectChange}
                        disabled={isLoadingProjects || isLoadingFiles || (filteredProjects.length === 0 && selectedDivisionId !== 'all')}
                        MenuProps={{ PaperProps: { sx: { maxHeight: 300 } } }}
                     >
                        <MenuItem value="all">
                            All Projects {selectedDivisionName ? `in ${selectedDivisionName}` : ''}
                        </MenuItem>
                        {filteredProjects.map((project) => {
                            let projectDisplayName = project.name || `Project ID ${project.id}`;
                            if (selectedDivisionId === 'all' && project.division_id != null) {
                                const division = divisions.find(d => d.id?.toString() === project.division_id.toString());
                                if (division && division.name) {
                                    projectDisplayName = `${projectDisplayName} (${division.name})`;
                                }
                            }
                            return (
                                <MenuItem key={`proj-${project.id}`} value={project.id.toString()}>
                                    {projectDisplayName}
                                </MenuItem>
                            );
                        })}
                    </Select>
                    {isLoadingProjects && <CircularProgress size={20} sx={{ position: 'absolute', right: 35, top: '50%', transform: 'translateY(-50%)', zIndex: 1 }} />}
                </FormControl>
             </Grid>
         </Grid>
         {isLoadingFiles && <Typography variant="caption" sx={{ display: 'block', textAlign: 'center', mt: 1 }}>Loading map data...</Typography>}
         {error && !isLoadingFiles && <MuiAlert severity="error" sx={{ mt: 1 }}>Error: {error}</MuiAlert>}
      </Box>

      {/* --- Map Container --- */}
      <Box className="map-container" sx={{ flexGrow: 1, width: '100%', position: 'relative', border: '1px solid #ccc', borderRadius: '4px', overflow: 'hidden' }}>
         {isLoadingFiles && (
             <Box sx={{
                 position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                 backgroundColor: 'rgba(255,255,255,0.7)', display: 'flex',
                 justifyContent: 'center', alignItems: 'center', zIndex: 1100
             }}>
                 <CircularProgress />
             </Box>
         )}
        {!isLoadingFiles && !errorFiles && (
            <MapContainer
                center={mapCenterToUse}
                zoom={currentZoom} // Use currentZoom state for dynamic zoom
                maxZoom={MAX_MAP_AND_TILE_ZOOM}
                style={{ height: '100%', width: '100%' }}
                zoomControl={true}
                scrollWheelZoom={true}
            >
                <TileLayer
                    attribution='© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    maxZoom={MAX_MAP_AND_TILE_ZOOM}
                    maxNativeZoom={19}
                />
                <MapEvents />

                {/* --- RENDER MAIN FILE MARKERS WITH MidpointsMiniMap IN POPUP --- */}
                {filesWithMainCoords.map(file => {
                      const potreeViewPath = file.potreeUrl && typeof file.potreeUrl === 'string' && file.potreeUrl !== 'pending_refresh'
                          ? `/potree?url=${encodeURIComponent(file.potreeUrl)}`
                          : null;
                      return (
                          <Marker
                              position={[file.latitude, file.longitude]}
                              key={`file-main-${file.id}`} // Unique key
                          >
                              <Popup minWidth={450} maxWidth={500} minHeight={550} maxHeight={600} autoPanPaddingTopLeft={[50,50]} autoPanPaddingBottomRight={[50,50]}> {/* Adjusted popup dimensions and autoPanPadding */}
                                  <Box sx={{ lineHeight: 1.5, display: 'flex', flexDirection: 'column', height: '100%' }}>
                                      <Typography variant="h6" component="div" gutterBottom sx={{textAlign: 'center', flexShrink: 0 }}>
                                          {file.name || 'Unnamed File'}
                                      </Typography>

                                      {/* Render the MidpointsMiniMap */}
                                      {file.tree_midpoints && Object.keys(file.tree_midpoints).length > 0 ? (
                                          <Box sx={{ flexGrow: 1, minHeight: '300px', mb: 1 }}> {/* Ensure mini-map container has space */}
                                            <MidpointsMiniMap
                                                midpoints={file.tree_midpoints}
                                                centerCoords={[file.latitude, file.longitude]}
                                                mainFileName={file.name || file.id.toString()}
                                            />
                                          </Box>
                                      ) : (
                                          <Typography variant="body2" sx={{ mt: 1, mb: 2, fontStyle: 'italic', textAlign: 'center', flexShrink: 0 }}>
                                              No midpoints to display on a map for this file.
                                          </Typography>
                                      )}

                                      {/* Main File Info Section (below the mini-map) */}
                                      <Box sx={{mt: 'auto', borderTop: '1px solid #eee', pt: 1, flexShrink: 0}}> {/* Pushes to bottom */}
                                          <Typography variant="subtitle2" sx={{ fontWeight: 'bold' }}>File Details:</Typography>
                                          <Typography variant="body2">Main Coords: {file.latitude.toFixed(5)}, {file.longitude.toFixed(5)}</Typography>
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
                                      </Box>
                                  </Box>
                              </Popup>
                          </Marker>
                      );
                })}
                {/* REMOVED the previous block for currentZoom >= ZOOM_THRESHOLD_FOR_MIDPOINTS */}
                {/* REMOVED MarkerClusterGroup and individual CircleMarkers for midpoints from here */}
            </MapContainer>
        )}
         {!hasAnyMarkersToShow && !isLoadingFiles && !errorFiles && (
             <Box sx={{
                position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
                padding: '20px', backgroundColor: 'rgba(255, 255, 255, 0.9)', borderRadius: '8px',
                boxShadow: '0 2px 10px rgba(0,0,0,0.1)', textAlign: 'center', zIndex: 1000
             }}>
                 <Typography variant="h6" gutterBottom>No Data to Display</Typography>
                 <Typography variant="body2">
                     No data points found matching the current filters.
                 </Typography>
             </Box>
         )}
      </Box>
    </Box>
  );
};

export default MapComponent;