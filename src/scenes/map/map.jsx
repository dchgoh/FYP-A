import React, { useState, useEffect, useCallback } from 'react'; // Removed useMemo, Added useCallback
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import { Link } from 'react-router-dom';
import 'leaflet/dist/leaflet.css';
import { Select, MenuItem, FormControl, InputLabel, Box, Alert as MuiAlert, Typography, CircularProgress, Grid } from '@mui/material';

// --- Leaflet Icon Fix (keep this) ---
import L from 'leaflet';
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: require('leaflet/dist/images/marker-icon-2x.png'),
  iconUrl: require('leaflet/dist/images/marker-icon.png'),
  shadowUrl: require('leaflet/dist/images/marker-shadow.png'),
});
// --- End Icon Fix ---

// Constants
const API_BASE_URL = "http://localhost:5000/api";

const MapComponent = ({ isCollapsed }) => {
  // --- State Variables ---
  // Renamed allFilesWithCoords -> mapFiles to reflect it holds filtered results
  const [mapFiles, setMapFiles] = useState([]);
  const [projects, setProjects] = useState([]);
  const [divisions, setDivisions] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState('all');
  const [selectedDivisionId, setSelectedDivisionId] = useState('all');
  const [isLoadingFiles, setIsLoadingFiles] = useState(true); // Loading state specifically for map files
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);
  const [isLoadingDivisions, setIsLoadingDivisions] = useState(true);
  const [errorFiles, setErrorFiles] = useState(null); // Error state specifically for map files
  const [errorProjects, setErrorProjects] = useState(null);
  const [errorDivisions, setErrorDivisions] = useState(null);

  // --- Default Map View Settings ---
  const initialPosition = [1.55, 110.35];
  const initialZoomLevel = 5;

  // --- Helper for Fetching (Generic - used for Projects/Divisions) ---
  const fetchDropdownData = useCallback(async (url, token, setDataFunc, setLoadingFunc, setErrorFunc) => {
    setLoadingFunc(true);
    setErrorFunc(null);
    try {
      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Failed to read error response');
        throw new Error(`HTTP error! Status: ${response.status}, Endpoint: ${url.replace(API_BASE_URL,'')}, Details: ${errorText.substring(0,100)}`);
      }
      const data = await response.json();
      setDataFunc(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error(`Fetch error for ${url}:`, err);
      setErrorFunc(err.message || `An error occurred while fetching data from ${url.replace(API_BASE_URL,'')}.`);
      setDataFunc([]); // Clear data on error
    } finally {
      setLoadingFunc(false);
    }
  }, []); // No dependencies needed

  // --- Fetch Dropdown Data (Projects and Divisions) ONCE on Mount ---
  useEffect(() => {
    const storedToken = localStorage.getItem('authToken');
    if (!storedToken) {
      const authError = "Authentication required.";
      setErrorProjects(authError);
      setErrorDivisions(authError);
      setIsLoadingProjects(false);
      setIsLoadingDivisions(false);
      // Don't set file error here, let the file fetch handle it
      return;
    }

    fetchDropdownData(`${API_BASE_URL}/projects`, storedToken, setProjects, setIsLoadingProjects, setErrorProjects);
    fetchDropdownData(`${API_BASE_URL}/divisions`, storedToken, setDivisions, setIsLoadingDivisions, setErrorDivisions);

  }, [fetchDropdownData]); // Runs once

  // --- Fetch FILTERED Map Files ---
  const fetchMapFiles = useCallback(async () => {
    const storedToken = localStorage.getItem('authToken');
    if (!storedToken) {
      setErrorFiles("Authentication required. Please log in.");
      setIsLoadingFiles(false);
      setMapFiles([]); // Clear files if not authenticated
      return;
    }

    setIsLoadingFiles(true);
    setErrorFiles(null);
    setMapFiles([]); // Clear previous results immediately

    try {
      const params = new URLSearchParams();

      // Project Filter Logic (Keep as is)
      if (selectedProjectId && selectedProjectId !== 'all') {
          if (selectedProjectId === 'unassigned') {
            params.append('projectId', 'null'); // Send 'null' string for unassigned projects
          } else {
              params.append('projectId', selectedProjectId); // Send actual ID
          }
      }
      // Else: 'all' projects selected, don't add projectId parameter

      // --- CORRECTED: Division Filter Logic ---
      if (selectedDivisionId && selectedDivisionId !== 'all') {
          if (selectedDivisionId === 'unassigned') { // <<< ADD THIS CHECK
            params.append('divisionId', 'null');   // <<< Send 'null' string for unassigned divisions
          } else {
              params.append('divisionId', selectedDivisionId); // Send actual ID
          }
      }
      // Else: 'all' divisions selected, don't add divisionId parameter
      // --- End Correction ---

      const query = params.toString();
      const url = `${API_BASE_URL}/files${query ? `?${query}` : ''}`;

      // console.log("Fetching map files from:", url); // For debugging

      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${storedToken}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Failed to read error response');
        throw new Error(`HTTP error fetching files! Status: ${response.status}, URL: ${url}, Details: ${errorText.substring(0, 150)}`);
      }

      const filesData = await response.json();
      const filesArray = Array.isArray(filesData) ? filesData : [];

      const filesWithValidCoords = filesArray.filter(file =>
        file.latitude !== null && typeof file.latitude === 'number' &&
        file.longitude !== null && typeof file.longitude === 'number'
      );

       const processedFiles = filesWithValidCoords.map(f => ({
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
  // Dependencies remain the same as they correctly trigger the fetch
  }, [selectedProjectId, selectedDivisionId]);

  // --- Effect to Trigger Fetching Files when Filters Change ---
  useEffect(() => {
    // Fetch files when the component mounts initially AND
    // whenever fetchMapFiles is recreated (due to filter changes)
    fetchMapFiles();
  }, [fetchMapFiles]); // fetchMapFiles is the dependency


  // --- Handle Dropdown Changes ---
  const handleProjectChange = (event) => {
    setSelectedProjectId(event.target.value);
    // The useEffect listening to fetchMapFiles will trigger the refetch
  };

  const handleDivisionChange = (event) => {
    setSelectedDivisionId(event.target.value);
    // The useEffect listening to fetchMapFiles will trigger the refetch
  };

  // --- Combined Loading/Error States ---
  // Check loading state for dropdown data OR file data

  // Prioritize showing file fetching error, then project/division errors
  const error = errorFiles || errorProjects || errorDivisions;

  // --- Determine map center and zoom based on CURRENT mapFiles state ---
  let mapCenter = initialPosition;
  let mapZoom = initialZoomLevel;
  if (mapFiles.length > 0) {
      // Simple centering on the first marker in the list
      mapCenter = [mapFiles[0].latitude, mapFiles[0].longitude];
      mapZoom = 13; // Zoom in when markers are present
  }
  // If mapFiles is empty (due to filters or no data), use initial view

  return (
    <Box sx={{
        display: 'flex',
        flexDirection: 'column',
        height: 'calc(100vh - 64px)', // Adjust as needed
        marginLeft: isCollapsed ? "80px" : "270px",
        transition: "margin-left 0.3s ease",
        overflow: 'hidden',
        padding: '10px',
        boxSizing: 'border-box',
    }}>
      {/* --- Filter Controls Row --- */}
      <Box sx={{ marginBottom: '10px', flexShrink: 0 }}>
         <Grid container spacing={2} alignItems="center">
             {/* Division Filter */}
             <Grid item xs={12} sm={6} md={4}>
                <FormControl fullWidth size="small" variant="outlined">
                    <InputLabel id="division-filter-label">Filter by Division</InputLabel>
                    <Select
                        labelId="division-filter-label"
                        id="division-filter-select"
                        value={selectedDivisionId}
                        label="Filter by Division"
                        onChange={handleDivisionChange}
                        disabled={isLoadingDivisions || isLoadingFiles} // Disable while loading divisions OR files
                        MenuProps={{ PaperProps: { sx: { maxHeight: 300 } } }}
                    >
                        <MenuItem value="all">All Divisions</MenuItem>
                                 
                        {divisions.map((division) => (
                        <MenuItem key={`div-${division.id}`} value={division.id.toString()}>
                            {division.name}
                        </MenuItem>
                        ))}
                    </Select>
                </FormControl>
                {/* Show spinner inside if divisions are loading */}
                {isLoadingDivisions && <CircularProgress size={20} sx={{ position: 'absolute', right: 35, top: '50%', transform: 'translateY(-50%)', zIndex: 1 }} />}
             </Grid>

             {/* Project Filter */}
             <Grid item xs={12} sm={6} md={4}>
                <FormControl fullWidth size="small" variant="outlined">
                    <InputLabel id="project-filter-label">Filter by Project</InputLabel>
                    <Select
                        labelId="project-filter-label"
                        id="project-filter-select"
                        value={selectedProjectId}
                        label="Filter by Project"
                        onChange={handleProjectChange}
                        disabled={isLoadingProjects || isLoadingFiles} // Disable while loading projects OR files
                        MenuProps={{ PaperProps: { sx: { maxHeight: 300 } } }}
                    >
                        <MenuItem value="all">All Projects</MenuItem>
                        
                        
                        {projects.map((project) => (
                        <MenuItem key={`proj-${project.id}`} value={project.id.toString()}>
                            {project.name}
                        </MenuItem>
                        ))}
                    </Select>
                </FormControl>
                 {/* Show spinner inside if projects are loading */}
                {isLoadingProjects && <CircularProgress size={20} sx={{ position: 'absolute', right: 35, top: '50%', transform: 'translateY(-50%)', zIndex: 1 }} />}
             </Grid>
         </Grid>

         {/* Display combined loading/error states clearly */}
         {/* Show file loading text *only* if files are loading */}
         {isLoadingFiles && <Typography variant="caption" sx={{ display: 'block', textAlign: 'center', mt: 1 }}>Loading map data...</Typography>}
         {error && !isLoadingFiles && <MuiAlert severity="error" sx={{ mt: 1 }}>Error: {error}</MuiAlert>}
      </Box>


      {/* --- Map Container --- */}
      <Box className="map-container" sx={{ flexGrow: 1, width: '100%', position: 'relative', border: '1px solid #ccc', borderRadius: '4px', overflow: 'hidden' }}>
         {/* Map is rendered only when files are NOT loading and there's no file error */}
         {/* We assume dropdown data might still be loading but we can show the map */}
        {!isLoadingFiles && !errorFiles && (
            <MapContainer
            key={`${mapCenter.join(',')}-${mapZoom}`} // Force re-render on view change
            center={mapCenter}
            zoom={mapZoom}
            style={{ height: '100%', width: '100%' }}
            zoomControl={true}
            scrollWheelZoom={true}
            >
            <TileLayer
                attribution='© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />

            {/* Render markers from the mapFiles state */}
            {mapFiles.map(file => {
                const potreeViewPath = file.potreeUrl && typeof file.potreeUrl === 'string' && file.potreeUrl !== 'pending_refresh'
                    ? `/potree?url=${encodeURIComponent(file.potreeUrl)}`
                    : null;

                return (
                <Marker
                    position={[file.latitude, file.longitude]}
                    key={file.id} // Use file ID as key
                >
                    <Popup minWidth={200}>
                    <div style={{ lineHeight: 1.5 }}>
                        <Typography variant="subtitle2" component="strong" gutterBottom>
                            {file.name || 'Unnamed File'}
                        </Typography>
                        <Typography variant="body2">
                            Coords: {file.latitude.toFixed(5)}, {file.longitude.toFixed(5)}
                        </Typography>
                        <Typography variant="body2">
                             Division: {file.divisionName || 'N/A'} {/* Use processed name */}
                        </Typography>
                        <Typography variant="body2">
                            Project: {file.projectName || 'Unassigned'} {/* Use processed name */}
                        </Typography>
                        {potreeViewPath ? (
                           <Link to={potreeViewPath} style={{ textDecoration: 'none', color: '#3388cc', fontWeight: 'bold', display: 'block', marginTop: '8px' }}>
                             View Point Cloud
                           </Link>
                        ) : (
                           <Typography variant="caption" style={{color: '#999', fontStyle: 'italic', display: 'block', marginTop: '8px'}}>
                              Potree data not available
                           </Typography>
                        )}
                    </div>
                    </Popup>
                </Marker>
                );
            })}
            </MapContainer>
        )}
         {/* Message for no files found (only show if not loading files and no file error) */}
         {mapFiles.length === 0 && !isLoadingFiles && !errorFiles && (
           <Box sx={{ /* Styles for no results message */
               textAlign: 'center', padding: '10px', color: '#555', position: 'absolute',
               top: '10px', left: '50%', transform: 'translateX(-50%)',
               background: 'rgba(255,255,255,0.8)', zIndex: 1000,
               borderRadius: '4px', pointerEvents: 'none'
           }}>
             No files found matching the current filters.
           </Box>
         )}
         {/* Loading overlay specifically for the map area during file fetch */}
         {isLoadingFiles && (
             <Box sx={{ /* Styles for map loading overlay */
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