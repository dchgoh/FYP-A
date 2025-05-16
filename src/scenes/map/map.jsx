import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
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
const MAX_MAP_AND_TILE_ZOOM = 21;

const MapComponent = ({ isCollapsed }) => {
  // --- State Variables ---
  const [mapFiles, setMapFiles] = useState([]);
  const [projects, setProjects] = useState([]);
  const [divisions, setDivisions] = useState([]);
  const [plotsList, setPlotsList] = useState([]); // New state for plots

  const [selectedProjectId, setSelectedProjectId] = useState('all');
  const [selectedDivisionId, setSelectedDivisionId] = useState('all');
  const [filterPlotName, setFilterPlotName] = useState('all'); // New state for selected plot

  const [isLoadingFiles, setIsLoadingFiles] = useState(true);
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);
  const [isLoadingDivisions, setIsLoadingDivisions] = useState(true);
  const [loadingPlots, setLoadingPlots] = useState(false); // New loading state for plots

  const [errorFiles, setErrorFiles] = useState(null);
  const [errorProjects, setErrorProjects] = useState(null);
  const [errorDivisions, setErrorDivisions] = useState(null);
  const [errorPlots, setErrorPlots] = useState(null); // New error state for plots

  const [currentZoom, setCurrentZoom] = useState(5);
  const initialPosition = [1.55, 110.35];

  // --- DERIVED STATE/CONDITIONS (useMemo) ---
  const canFetchPlots = useMemo(() => {
    return selectedDivisionId !== 'all' && selectedProjectId !== 'all' && selectedProjectId !== 'unassigned';
  }, [selectedDivisionId, selectedProjectId]);

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

  // --- Fetch Dropdown Data ONCE (Divisions, Projects) ---
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

  // --- Fetch Plots List ---
  const fetchPlotsList = useCallback(async (divisionId, projectId) => {
    const token = localStorage.getItem('authToken');
    if (!token) {
      setPlotsList([]);
      setErrorPlots("Authentication required for fetching plots.");
      setLoadingPlots(false);
      return;
    }

    // Guard: Only fetch if divisionId and projectId are valid (not 'all' or 'unassigned' for projectId)
    if (!divisionId || divisionId === 'all' || !projectId || projectId === 'all' || projectId === 'unassigned') {
      setPlotsList([]);
      setFilterPlotName('all'); // Ensure plot filter is reset if conditions aren't met
      setLoadingPlots(false);
      return;
    }

    setLoadingPlots(true);
    setErrorPlots(null);
    setPlotsList([]); // Clear previous plots

    try {
      const params = new URLSearchParams();
      params.append('divisionId', divisionId);
      params.append('projectId', projectId);

      const response = await fetch(`${API_BASE_URL}/files/plots?${params.toString()}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Failed to read error response');
        throw new Error(`HTTP error fetching plots! Status: ${response.status}, Details: ${errorText.substring(0,100)}`);
      }
      const data = await response.json();
      setPlotsList(data.plots || []);
    } catch (error) {
      console.error("Failed to fetch plot names:", error);
      setErrorPlots(error.message || "An error occurred while fetching plot names.");
      setPlotsList([]);
    } finally {
      setLoadingPlots(false);
    }
  }, []); // API_BASE_URL is a constant

  // --- Fetch FILTERED Map Files (now includes plotName) ---
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
      // Add plotName to filter if selected and valid
      if (filterPlotName && filterPlotName !== 'all' && canFetchPlots) {
          params.append('plotName', filterPlotName);
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
  }, [selectedProjectId, selectedDivisionId, filterPlotName, canFetchPlots]); // Added filterPlotName and canFetchPlots

  // --- Effect to Fetch Plots when division or project filters change ---
  useEffect(() => {
    if (canFetchPlots && !isLoadingDivisions && !isLoadingProjects) {
      fetchPlotsList(selectedDivisionId, selectedProjectId);
    } else {
      // Not ready to fetch plots (e.g., division/project not selected, or they are still loading)
      setPlotsList([]);
      if (filterPlotName !== 'all') { // Only reset if it's not already 'all' to prevent unnecessary re-renders
        setFilterPlotName('all');
      }
    }
  }, [selectedDivisionId, selectedProjectId, canFetchPlots, fetchPlotsList, isLoadingDivisions, isLoadingProjects]);

  // --- Effect to Fetch Map Files when any relevant filter changes ---
  useEffect(() => {
    fetchMapFiles();
  }, [fetchMapFiles]); // fetchMapFiles dependency array now includes filterPlotName

  // --- Calculate Filtered Projects for Dropdown ---
  const filteredProjects = useMemo(() => {
    if (isLoadingProjects || !projects) return [];
    if (selectedDivisionId === 'all' || projects.length === 0) {
      return projects || [];
    }
    const divisionIdToCompare = parseInt(selectedDivisionId, 10);
    return projects.filter(project => project.division_id === divisionIdToCompare);
  }, [selectedDivisionId, projects, isLoadingProjects]);

  // --- Handle Dropdown Changes ---
  const handleDivisionChange = (event) => {
    const newDivisionId = event.target.value;
    setSelectedDivisionId(newDivisionId);
    setSelectedProjectId('all'); // Reset project
    setFilterPlotName('all');   // Reset plot
    // plotsList will be reset by the useEffect for fetchPlotsList
  };

  const handleProjectChange = (event) => {
    setSelectedProjectId(event.target.value);
    setFilterPlotName('all'); // Reset plot
    // plotsList will be reset by the useEffect for fetchPlotsList
  };

  const handlePlotFilterChange = (event) => {
    setFilterPlotName(event.target.value);
  };

  // --- Map View Logic ---
  let mapCenterToUse = initialPosition;
  const filesWithMainCoords = mapFiles.filter(file =>
    file.latitude !== null && typeof file.latitude === 'number' &&
    file.longitude !== null && typeof file.longitude === 'number'
  );

  if (filesWithMainCoords.length > 0) {
    mapCenterToUse = [filesWithMainCoords[0].latitude, filesWithMainCoords[0].longitude];
  }

  const error = errorFiles || errorProjects || errorDivisions || errorPlots; // Include plot errors if any

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

  const hasAnyMarkersToShow = filesWithMainCoords.length > 0;
  const selectedDivisionName = selectedDivisionId === 'all'
    ? ''
    : divisions.find(d => d.id.toString() === selectedDivisionId)?.name || '';

  const commonMenuProps = { // For styling dropdowns, similar to Dashboard
    PaperProps: {
      sx: {
        maxHeight: 300,
        // Add more styling if needed, e.g., from Dashboard's commonMenuProps
        // backgroundColor: colors.primary[700], color: colors.grey[100],
        // '& .MuiMenuItem-root:hover': { backgroundColor: colors.primary[500] },
        // '& .MuiMenuItem-root.Mui-selected': { backgroundColor: colors.blueAccent[700] + '!important', color: colors.grey[100] },
      },
    },
  };

  return (
    <Box sx={{
        display: 'flex', flexDirection: 'column', height: 'calc(100vh - 64px)',
        marginLeft: isCollapsed ? "80px" : "270px", transition: "margin-left 0.3s ease",
        overflow: 'hidden', padding: '10px', boxSizing: 'border-box',
    }}>
      {/* --- Filter Controls Row --- */}
      <Box sx={{ marginBottom: '10px', flexShrink: 0 }}>
         <Grid container spacing={2} alignItems="center">
             <Grid item xs={12} sm={6} md={4}> {/* Division Filter */}
                <FormControl fullWidth size="small" variant="outlined" sx={{ position: 'relative' }}>
                    <InputLabel id="division-filter-label">Filter by Division</InputLabel>
                    <Select
                        labelId="division-filter-label"
                        id="division-filter-select"
                        value={selectedDivisionId}
                        label="Filter by Division"
                        onChange={handleDivisionChange}
                        disabled={isLoadingDivisions || isLoadingFiles}
                        MenuProps={commonMenuProps}
                     >
                        <MenuItem value="all">All Divisions</MenuItem>
                        {isLoadingDivisions ? <MenuItem disabled><CircularProgress size={20} sx={{ mr: 1 }} /> Loading...</MenuItem>
                            : divisions.map((division) => (
                                <MenuItem key={`div-${division.id}`} value={division.id.toString()}>{division.name}</MenuItem>
                            ))
                        }
                    </Select>
                    {isLoadingDivisions && !divisions.length && <CircularProgress size={20} sx={{ position: 'absolute', right: 35, top: '50%', transform: 'translateY(-50%)', zIndex: 1 }} />}
                </FormControl>
             </Grid>
             <Grid item xs={12} sm={6} md={4}> {/* Project Filter */}
                 <FormControl fullWidth size="small" variant="outlined" sx={{ position: 'relative' }}>
                    <InputLabel id="project-filter-label">Filter by Project</InputLabel>
                    <Select
                        labelId="project-filter-label"
                        id="project-filter-select"
                        value={selectedProjectId}
                        label="Filter by Project"
                        onChange={handleProjectChange}
                        disabled={isLoadingProjects || isLoadingFiles || (selectedDivisionId !== 'all' && filteredProjects.length === 0 && !isLoadingProjects)}
                        MenuProps={commonMenuProps}
                     >
                        <MenuItem value="all">
                            All Projects {selectedDivisionName ? `in ${selectedDivisionName}` : ''}
                        </MenuItem>
                        {isLoadingProjects ? <MenuItem disabled><CircularProgress size={20} sx={{ mr: 1 }} /> Loading...</MenuItem>
                            : (filteredProjects.length === 0 && selectedDivisionId !== 'all') ? <MenuItem disabled sx={{ fontStyle: 'italic' }}>No projects in division</MenuItem>
                            : (projects.length === 0 && selectedDivisionId === 'all' && !isLoadingProjects) ? <MenuItem disabled sx={{ fontStyle: 'italic' }}>No projects available</MenuItem>
                            : filteredProjects.map((project) => {
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
                            })
                        }
                    </Select>
                    {isLoadingProjects && !filteredProjects.length && <CircularProgress size={20} sx={{ position: 'absolute', right: 35, top: '50%', transform: 'translateY(-50%)', zIndex: 1 }} />}
                </FormControl>
             </Grid>
             <Grid item xs={12} sm={6} md={4}> {/* Plot Filter - NEW */}
                <FormControl fullWidth size="small" variant="outlined" sx={{ position: 'relative' }}>
                    <InputLabel id="plot-filter-label">Filter by Plot</InputLabel>
                    <Select
                        labelId="plot-filter-label"
                        id="plot-filter-select"
                        value={filterPlotName}
                        label="Filter by Plot"
                        onChange={handlePlotFilterChange}
                        disabled={!canFetchPlots || loadingPlots || isLoadingFiles}
                        MenuProps={commonMenuProps}
                    >
                        <MenuItem value="all">All Plots</MenuItem>
                        {loadingPlots ? (
                            <MenuItem disabled>
                                <CircularProgress size={20} sx={{ mr: 1 }} /> Loading plots...
                            </MenuItem>
                        ) : !canFetchPlots ? (
                            <MenuItem disabled sx={{ fontStyle: 'italic' }}>
                                Select project to see plots
                            </MenuItem>
                        ) : plotsList.length === 0 && !loadingPlots ? (
                            <MenuItem disabled sx={{ fontStyle: 'italic' }}>
                                No plots for this project
                            </MenuItem>
                        ) : (
                            plotsList.map((plotName) => (
                                <MenuItem key={`plot-${plotName}`} value={plotName}>
                                    {plotName}
                                </MenuItem>
                            ))
                        )}
                    </Select>
                    {loadingPlots && <CircularProgress size={20} sx={{ position: 'absolute', right: 35, top: '50%', transform: 'translateY(-50%)', zIndex: 1 }} />}
                </FormControl>
             </Grid>
         </Grid>
         {isLoadingFiles && <Typography variant="caption" sx={{ display: 'block', textAlign: 'center', mt: 1 }}>Loading map data...</Typography>}
         {error && !isLoadingFiles && <MuiAlert severity="error" sx={{ mt: 1 }}>Error: {error}</MuiAlert>}
         {errorPlots && <MuiAlert severity="warning" sx={{ mt: 1 }}>Plot Filter Error: {errorPlots}</MuiAlert>}
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
        {!isLoadingFiles && !errorFiles && ( // Only render map if no critical file loading error
            <MapContainer
                center={mapCenterToUse}
                zoom={currentZoom}
                maxZoom={MAX_MAP_AND_TILE_ZOOM}
                style={{ height: '100%', width: '100%' }}
                zoomControl={true}
                scrollWheelZoom={true}
            >
                <TileLayer
                    attribution='© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    maxZoom={MAX_MAP_AND_TILE_ZOOM}
                    maxNativeZoom={19} // Default for OpenStreetMap
                />
                <MapEvents />

                {filesWithMainCoords.map(file => {
                      const potreeViewPath = file.potreeUrl && typeof file.potreeUrl === 'string' && file.potreeUrl !== 'pending_refresh'
                          ? `/potree?url=${encodeURIComponent(file.potreeUrl)}`
                          : null;
                      return (
                          <Marker
                              position={[file.latitude, file.longitude]}
                              key={`file-main-${file.id}`}
                          >
                              <Popup minWidth={450} maxWidth={500} minHeight={550} maxHeight={600} autoPanPaddingTopLeft={[50,50]} autoPanPaddingBottomRight={[50,50]}>
                                  <Box sx={{ lineHeight: 1.5, display: 'flex', flexDirection: 'column', height: '100%' }}>
                                      <Typography variant="h6" component="div" gutterBottom sx={{textAlign: 'center', flexShrink: 0 }}>
                                          {file.name || 'Unnamed File'}
                                      </Typography>

                                      {file.tree_midpoints && Object.keys(file.tree_midpoints).length > 0 ? (
                                          <Box sx={{ flexGrow: 1, minHeight: '300px', mb: 1 }}>
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

                                      <Box sx={{mt: 'auto', borderTop: '1px solid #eee', pt: 1, flexShrink: 0}}>
                                          <Typography variant="subtitle2" sx={{ fontWeight: 'bold' }}>File Details:</Typography>
                                          <Typography variant="body2">Plot: {file.plot_name || 'N/A'}</Typography>
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