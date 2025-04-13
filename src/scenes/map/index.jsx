import React, { useState, useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import { Link } from 'react-router-dom';
import 'leaflet/dist/leaflet.css';
import { Select, MenuItem, FormControl, InputLabel, Box, CircularProgress, Alert as MuiAlert, Typography } from '@mui/material'; // Added Typography

// --- Leaflet Icon Fix (keep this) ---
import L from 'leaflet';
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: require('leaflet/dist/images/marker-icon-2x.png'),
  iconUrl: require('leaflet/dist/images/marker-icon.png'),
  shadowUrl: require('leaflet/dist/images/marker-shadow.png'),
});
// --- End Icon Fix ---

// *** MODIFICATION 1: Accept isCollapsed prop ***
const MapComponent = ({ isCollapsed }) => {
  // --- State Variables ---
  const [allFilesWithCoords, setAllFilesWithCoords] = useState([]);
  const [projects, setProjects] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState('all');
  const [isLoadingFiles, setIsLoadingFiles] = useState(true);
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);
  const [errorFiles, setErrorFiles] = useState(null);
  const [errorProjects, setErrorProjects] = useState(null);

  // --- Default Map View Settings ---
  const initialPosition = [1.55, 110.35];
  const initialZoomLevel = 5;

  // --- Fetch Data (Files and Projects) ---
  useEffect(() => {
    // (Fetch logic remains the same - no changes needed here)
    const storedToken = localStorage.getItem('authToken');

    if (!storedToken) {
      setErrorFiles("Authentication required. Please log in.");
      setErrorProjects("Authentication required.");
      setIsLoadingFiles(false);
      setIsLoadingProjects(false);
      return;
    }

    const fetchFiles = async () => {
        setIsLoadingFiles(true);
        setErrorFiles(null);
        try {
            const response = await fetch('http://localhost:5000/api/files', {
                headers: {
                    'Authorization': `Bearer ${storedToken}`,
                    'Content-Type': 'application/json'
                }
            });
            if (!response.ok) {
                // Simplified error handling for brevity
                const errorData = await response.text(); // Get text in case it's HTML
                throw new Error(`HTTP error! status: ${response.status} - ${errorData.substring(0, 100)}`);
            }
            const allFiles = await response.json();
            const filesWithValidCoords = allFiles.filter(file =>
                file.latitude !== null && typeof file.latitude === 'number' &&
                file.longitude !== null && typeof file.longitude === 'number'
            );
            setAllFilesWithCoords(filesWithValidCoords);
        } catch (err) {
            console.error("Failed to fetch files:", err);
            setErrorFiles(err.message || "An error occurred while fetching files.");
        } finally {
            setIsLoadingFiles(false);
        }
    };


    const fetchProjects = async () => {
        setIsLoadingProjects(true);
        setErrorProjects(null);
        try {
            const response = await fetch('http://localhost:5000/api/projects', {
                headers: { 'Authorization': `Bearer ${storedToken}` }
            });
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const data = await response.json();
            setProjects(data || []);
        } catch (err) {
            console.error("Failed to fetch projects:", err);
            setErrorProjects(err.message || "An error occurred while fetching projects.");
        } finally {
            setIsLoadingProjects(false);
        }
    };

    Promise.all([fetchFiles(), fetchProjects()]);

  }, []); // Runs once on mount


  // --- Filter Markers Based on Selected Project ---
  const filteredMarkers = useMemo(() => {
    if (selectedProjectId === 'all') {
      return allFilesWithCoords;
    }
    if (selectedProjectId === 'unassigned') {
      return allFilesWithCoords.filter(file => file.project_id === null);
    }
    return allFilesWithCoords.filter(file => file.project_id === parseInt(selectedProjectId, 10));
  }, [allFilesWithCoords, selectedProjectId]);

  // --- Handle Dropdown Change ---
  const handleProjectChange = (event) => {
    setSelectedProjectId(event.target.value);
  };

  // --- Render Logic ---
  const isLoading = isLoadingFiles || isLoadingProjects;
  const error = errorFiles || errorProjects;

  // --- Determine map center and zoom ---
  let mapCenter = initialPosition;
  let mapZoom = initialZoomLevel;
  if (filteredMarkers.length > 0) {
      mapCenter = [filteredMarkers[0].latitude, filteredMarkers[0].longitude];
      mapZoom = 13;
  }

  return (
    // *** MODIFICATION 2: Apply dynamic margin and transition to the outermost Box ***
    <Box sx={{
        display: 'flex',
        flexDirection: 'column',
        height: 'calc(96vh - 80px)', // Example: Adjust height to account for Topbar (adjust 80px as needed)
        paddingTop: '10px', // Add some padding if needed below the topbar
        marginLeft: isCollapsed ? "80px" : "270px", // Dynamic margin like Topbar
        transition: "margin-left 0.3s ease",    // Smooth transition like Topbar
        overflow: 'hidden', // Prevent potential scrollbars on this container
    }}>
      {/* --- Project Filter Dropdown --- */}
      {/* Added flexShrink: 0 so it doesn't shrink */}
      <Box sx={{ padding: '0 10px 10px 10px', backgroundColor: 'transparent', flexShrink: 0 }}>
        <FormControl fullWidth size="small">
          <InputLabel id="project-filter-label">Filter by Project</InputLabel>
          <Select
            labelId="project-filter-label"
            id="project-filter-select"
            value={selectedProjectId}
            label="Filter by Project"
            onChange={handleProjectChange}
            disabled={isLoadingProjects}
          >
            <MenuItem value="all">All Projects</MenuItem>
            <MenuItem value="unassigned">Unassigned Files</MenuItem>
            {projects.map((project) => (
              <MenuItem key={project.id} value={project.id.toString()}>
                {project.name} (ID: {project.id})
              </MenuItem>
            ))}
          </Select>
        </FormControl>
         {/* Display loading/error states clearly */}
         {isLoading && <Typography variant="caption" sx={{ display: 'block', textAlign: 'center', mt: 1 }}>Loading data...</Typography>}
         {error && !isLoading && <MuiAlert severity="error" sx={{ mt: 1 }}>{error}</MuiAlert>}
      </Box>

      {/* --- Map Container --- */}
      {/* Use flexGrow: 1 to make map take remaining space */}
      <Box className="map-container" sx={{ flexGrow: 1, width: '100%', position: 'relative' /* Needed for absolute positioning of message */ }}>
        {!isLoading && !error && ( // Only render map if not loading and no errors
            <MapContainer
            center={mapCenter}
            zoom={mapZoom}
            style={{ height: '100%', width: '100%' }}
            zoomControl={true}
            >
            <TileLayer
                attribution='© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />

            {filteredMarkers.map(file => {
                const potreeViewPath = file.potreeUrl
                    ? `/potree?url=${encodeURIComponent(file.potreeUrl)}`
                    : null;
                return (
                <Marker
                    position={[file.latitude, file.longitude]}
                    key={file.id}
                >
                    <Popup>
                    <div>
                        <strong>{file.name || 'Unnamed File'}</strong>
                        <br />
                        Coords: {file.latitude.toFixed(5)}, {file.longitude.toFixed(5)}
                        <br />
                        Project: {file.projectName || 'Unassigned'}
                        <br />
                        {potreeViewPath ? (
                           <Link to={potreeViewPath} style={{ textDecoration: 'none', color: '#3388cc', fontWeight: 'bold', display: 'block', marginTop: '5px' }}>
                             View Point Cloud
                           </Link>
                        ) : (
                           <span style={{color: '#999', fontStyle: 'italic', display: 'block', marginTop: '5px'}}>
                              Potree data not available
                           </span>
                        )}
                    </div>
                    </Popup>
                </Marker>
                );
            })}
            </MapContainer>
        )}
         {/* Message for no filtered markers */}
         {filteredMarkers.length === 0 && !isLoading && !error && (
           <div style={{ textAlign: 'center', padding: '10px', color: '#555', position: 'absolute', top: '10px', /* Adjusted top position */ left: '50%', transform: 'translateX(-50%)', background: 'rgba(255,255,255,0.8)', zIndex: 1000, borderRadius: '4px' }}>
             No files found for the selected project filter.
           </div>
         )}
      </Box>
    </Box>
  );
};

export default MapComponent;