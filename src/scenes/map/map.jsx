import React, { useState, useEffect, useCallback, useMemo } from 'react'; // Import useMemo
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
const ZOOM_THRESHOLD_FOR_MIDPOINTS = 14;
const MAX_MAP_AND_TILE_ZOOM = 21;
const DECLUSTER_AT_ZOOM = 18;

const MapComponent = ({ isCollapsed }) => {
  // --- State Variables ---
  const [mapFiles, setMapFiles] = useState([]);
  const [projects, setProjects] = useState([]); // Holds ALL projects fetched initially
  const [divisions, setDivisions] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState('all');
  const [selectedDivisionId, setSelectedDivisionId] = useState('all');
  const [isLoadingFiles, setIsLoadingFiles] = useState(true);
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);
  const [isLoadingDivisions, setIsLoadingDivisions] = useState(true);
  const [errorFiles, setErrorFiles] = useState(null);
  const [errorProjects, setErrorProjects] = useState(null);
  const [errorDivisions, setErrorDivisions] = useState(null);
  const [currentZoom, setCurrentZoom] = useState(5);

  const initialPosition = [1.55, 110.35];
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
      // *** IMPORTANT: Ensure project data has division_id here ***
      // Example: console.log('Fetched Projects:', data);
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
    // Fetch ALL projects (assuming they include division_id)
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
      // console.log("Processed Files for Map:", processedFiles); // Keep for debugging if needed
      setMapFiles(processedFiles);

    } catch (err) {
      console.error("Failed to fetch map files:", err);
      setErrorFiles(err.message || "An error occurred while fetching map files.");
      setMapFiles([]);
    } finally {
      setIsLoadingFiles(false);
    }
  }, [selectedProjectId, selectedDivisionId]); // Dependencies are correct here

  // --- Effect to Fetch Files when filters change ---
  useEffect(() => { fetchMapFiles(); }, [fetchMapFiles]);

  // --- Calculate Filtered Projects for Dropdown ---
  const filteredProjects = useMemo(() => {
    if (selectedDivisionId === 'all' || !projects || projects.length === 0) {
      return projects || []; // Show all projects if 'All Divisions' is selected or projects haven't loaded
    }
    // Filter projects based on selectedDivisionId
    // *** IMPORTANT: Adjust 'project.division_id' and the comparison logic
    // based on your actual data structure and ID types (number vs string) ***
    const divisionIdToCompare = parseInt(selectedDivisionId, 10); // Example if IDs are numbers
    // const divisionIdToCompare = selectedDivisionId; // Example if IDs are strings

    return projects.filter(project => project.division_id === divisionIdToCompare);

  }, [selectedDivisionId, projects]); // Recalculate when division or project list changes

  // --- Handle Dropdown Changes ---
  const handleDivisionChange = (event) => {
    const newDivisionId = event.target.value;
    setSelectedDivisionId(newDivisionId);
    // Reset project selection when division changes
    setSelectedProjectId('all');
  };

  const handleProjectChange = (event) => {
    setSelectedProjectId(event.target.value);
  };

  // --- Map View Logic ---
  let mapCenterToUse = initialPosition;
  let mapZoomToUse = currentZoom;

  const filesWithMainCoords = mapFiles.filter(file =>
    file.latitude !== null && typeof file.latitude === 'number' &&
    file.longitude !== null && typeof file.longitude === 'number'
  );

  // Adjust map center (simplified for clarity, could be more sophisticated)
  if (filesWithMainCoords.length > 0 && currentZoom < ZOOM_THRESHOLD_FOR_MIDPOINTS) {
      mapCenterToUse = [filesWithMainCoords[0].latitude, filesWithMainCoords[0].longitude];
  } else if (currentZoom >= ZOOM_THRESHOLD_FOR_MIDPOINTS) {
      const firstFileWithMidpoints = mapFiles.find(f => f.tree_midpoints && Object.keys(f.tree_midpoints).length > 0);
      if (firstFileWithMidpoints) {
          const firstMidpointKey = Object.keys(firstFileWithMidpoints.tree_midpoints)[0];
          const firstMidpoint = firstFileWithMidpoints.tree_midpoints[firstMidpointKey];
          if (firstMidpoint && typeof firstMidpoint.latitude === 'number' && typeof firstMidpoint.longitude === 'number') {
              mapCenterToUse = [firstMidpoint.latitude, firstMidpoint.longitude];
          }
      } else if (filesWithMainCoords.length > 0) {
          // Fallback to main coord if zoomed in but no midpoints found in filtered data
           mapCenterToUse = [filesWithMainCoords[0].latitude, filesWithMainCoords[0].longitude];
      }
  }


  const error = errorFiles || errorProjects || errorDivisions;

  // --- MapEvents Component to Track Zoom ---
  const MapEvents = () => {
    const map = useMap();
    useEffect(() => {
      const onZoomEnd = () => { setCurrentZoom(map.getZoom()); };
      map.on('zoomend', onZoomEnd);
      setCurrentZoom(map.getZoom());
      return () => { map.off('zoomend', onZoomEnd); };
    }, [map]);
    return null;
  };

  // Determine if any markers should be shown for the "No data" message
  const hasAnyMarkersToShow =
    (currentZoom < ZOOM_THRESHOLD_FOR_MIDPOINTS && filesWithMainCoords.length > 0) ||
    (currentZoom >= ZOOM_THRESHOLD_FOR_MIDPOINTS && (
        mapFiles.some(f => f.tree_midpoints && Object.keys(f.tree_midpoints).length > 0) ||
        mapFiles.some(f =>
            filesWithMainCoords.find(fwc => fwc.id === f.id) &&
            (!f.tree_midpoints || Object.keys(f.tree_midpoints).length === 0)
        )
    ));

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
                        onChange={handleDivisionChange} // Updated handler
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
                        value={selectedProjectId} // Stays the same
                        label="Filter by Project"
                        onChange={handleProjectChange} // Stays the same
                        disabled={isLoadingProjects || isLoadingFiles || filteredProjects.length === 0 && selectedDivisionId !== 'all'} // Disable if loading or no projects for selected division
                        MenuProps={{ PaperProps: { sx: { maxHeight: 300 } } }}
                     >
                         {/* Dynamic "All Projects" label */}
                        <MenuItem value="all">
                            All Projects {selectedDivisionName ? `in ${selectedDivisionName}` : ''}
                        </MenuItem>
                        {/* Iterate over the FILTERED list */}
                        {filteredProjects.map((project) => {
                            let projectDisplayName = project.name || `Project ID ${project.id}`; // Fallback name

                            // Add Division Name in parentheses ONLY if 'All Divisions' is selected
                            // and the project actually has a division_id
                            if (selectedDivisionId === 'all' && project.division_id != null) {
                                // Find the division based on project's division_id
                                // *** Ensure consistent ID type comparison (number vs string) ***
                                // Assuming project.division_id is number and division.id could be string/number
                                const division = divisions.find(d => d.id?.toString() === project.division_id.toString());

                                if (division && division.name) {
                                    projectDisplayName = `${projectDisplayName} (${division.name})`;
                                } else {
                                    // Optional: Handle if division name not found for the ID
                                    // projectDisplayName = `${projectDisplayName} (Unknown Division)`;
                                    // Or just leave it as the project name if division lookup fails
                                }
                            }
                            // If a specific division IS selected, filteredProjects only contains
                            // projects for that division, so we just use project.name (already set in projectDisplayName)

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
         {/* Loading overlay for map area */}
         {isLoadingFiles && (
             <Box sx={{
                 position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                 backgroundColor: 'rgba(255,255,255,0.7)', display: 'flex',
                 justifyContent: 'center', alignItems: 'center', zIndex: 1100 // Ensure it's above map controls
             }}>
                 <CircularProgress />
             </Box>
         )}
        {/* Conditionally render MapContainer only when not loading files to avoid issues with initial state */}
        {!isLoadingFiles && !errorFiles && (
            <MapContainer
                // Use a key that changes ONLY when absolutely necessary, e.g., initial load maybe,
                // but NOT on every filter change if possible.
                // key={mapFiles.length > 0 ? 'map-with-data' : 'map-no-data'} // Example minimal key change
                center={mapCenterToUse}
                zoom={mapZoomToUse}
                maxZoom={MAX_MAP_AND_TILE_ZOOM}
                style={{ height: '100%', width: '100%' }}
                zoomControl={true}
                scrollWheelZoom={true}
            >
                <TileLayer
                    attribution='© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    maxZoom={MAX_MAP_AND_TILE_ZOOM}
                    maxNativeZoom={19} // Set OSM's actual max native zoom
                />
                <MapEvents />

                {/* --- CONDITIONAL MARKER RENDERING --- */}
                {currentZoom < ZOOM_THRESHOLD_FOR_MIDPOINTS && filesWithMainCoords.map(file => {
                    /* ... existing overview marker code ... */
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
                                         <Link to={potreeViewPath} style={{ textDecoration: 'none', color: '#3388cc', fontWeight: 'bold', display: 'block', marginTop: '8px' }} target="_blank" rel="noopener noreferrer">
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

                {currentZoom >= ZOOM_THRESHOLD_FOR_MIDPOINTS && (
                    <>
                        {/* 2a. Midpoints (clustered) */}
                        <MarkerClusterGroup
                             spiderfyOnMaxZoom={true}
                             showCoverageOnHover={true}
                             zoomToBoundsOnClick={true}
                             maxClusterRadius={40} // Smaller radius can feel less jumpy
                             disableClusteringAtZoom={DECLUSTER_AT_ZOOM}
                        >
                            {mapFiles
                                .filter(file => file.tree_midpoints && Object.keys(file.tree_midpoints).length > 0)
                                .flatMap(file =>
                                    Object.entries(file.tree_midpoints).map(([treeId, midpoint]) => {
                                        /* ... existing midpoint marker code ... */
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

                        {/* 2b. Main file marker for files WITHOUT midpoints */}
                        {mapFiles
                            .filter(file =>
                                filesWithMainCoords.some(fwc => fwc.id === file.id) &&
                                (!file.tree_midpoints || Object.keys(file.tree_midpoints).length === 0)
                            )
                            .map(file => {
                                /* ... existing main marker code for zoomed-in view ... */
                                const potreeViewPath = file.potreeUrl && typeof file.potreeUrl === 'string' && file.potreeUrl !== 'pending_refresh'
                                    ? `/potree?url=${encodeURIComponent(file.potreeUrl)}`
                                    : null;
                                return (
                                    <Marker
                                        position={[file.latitude, file.longitude]}
                                        key={`file-main-zoomed-${file.id}`}
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
             <Box sx={{ /* ... existing styles ... */ }}>
                 No data points found matching the current filters and zoom level.
             </Box>
         )}
      </Box>
    </Box>
  );
};

export default MapComponent;