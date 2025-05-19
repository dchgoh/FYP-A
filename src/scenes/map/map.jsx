import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import { Link } from 'react-router-dom';
import 'leaflet/dist/leaflet.css';
import {
  Select, MenuItem, FormControl, InputLabel, Box, Alert as MuiAlert,
  Typography, CircularProgress, Grid, useTheme
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import L from 'leaflet';
import MidpointsMiniMap from './MidpointsMiniMap'; // Ensure this path is correct
import { tokens } from "../../theme"; // Assuming tokens is here for colors

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
  const theme = useTheme();
  const colors = tokens(theme.palette.mode);

  // --- State Variables ---
  const [mapFiles, setMapFiles] = useState([]);
  const [projects, setProjects] = useState([]);
  const [divisions, setDivisions] = useState([]);
  const [plotsList, setPlotsList] = useState([]);

  const [selectedProjectId, setSelectedProjectId] = useState('all');
  const [selectedDivisionId, setSelectedDivisionId] = useState('all');
  const [filterPlotName, setFilterPlotName] = useState('all');

  const [isLoadingFiles, setIsLoadingFiles] = useState(true);
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);
  const [isLoadingDivisions, setIsLoadingDivisions] = useState(true);
  const [loadingPlots, setLoadingPlots] = useState(false);

  const [errorFiles, setErrorFiles] = useState(null);
  const [errorProjects, setErrorProjects] = useState(null);
  const [errorDivisions, setErrorDivisions] = useState(null);
  const [errorPlots, setErrorPlots] = useState(null);

  const [currentZoom, setCurrentZoom] = useState(5);
  const initialPosition = [1.55, 110.35]; // Sarawak, Malaysia approx.

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
      setMapFiles([]); setIsLoadingFiles(false); // Also stop files loading
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

    if (!divisionId || divisionId === 'all' || !projectId || projectId === 'all' || projectId === 'unassigned') {
      setPlotsList([]);
      setFilterPlotName('all');
      setLoadingPlots(false);
      return;
    }

    setLoadingPlots(true);
    setErrorPlots(null);
    setPlotsList([]);

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
  }, []);

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
  }, [selectedProjectId, selectedDivisionId, filterPlotName, canFetchPlots]);

  // --- Effect to Fetch Plots when division or project filters change ---
  useEffect(() => {
    if (canFetchPlots && !isLoadingDivisions && !isLoadingProjects) {
      fetchPlotsList(selectedDivisionId, selectedProjectId);
    } else {
      setPlotsList([]);
      if (filterPlotName !== 'all') {
        setFilterPlotName('all');
      }
    }
  }, [selectedDivisionId, selectedProjectId, canFetchPlots, fetchPlotsList, isLoadingDivisions, isLoadingProjects, filterPlotName]);

  // --- Effect to Fetch Map Files when any relevant filter changes ---
  useEffect(() => {
    // Only fetch if initial dropdown data is loaded or not in an error state for auth
    if ((!isLoadingDivisions && !isLoadingProjects) || (!errorDivisions && !errorProjects)) {
        fetchMapFiles();
    }
  }, [fetchMapFiles, isLoadingDivisions, isLoadingProjects, errorDivisions, errorProjects]);

  // --- Calculate Filtered Projects for Dropdown ---
  const filteredProjects = useMemo(() => {
    const safeProjects = Array.isArray(projects) ? projects : [];
    if (isLoadingProjects || !safeProjects) return [];
    if (selectedDivisionId === 'all' || safeProjects.length === 0) {
      return safeProjects;
    }
    const divisionIdToCompare = parseInt(selectedDivisionId, 10);
    return safeProjects.filter(project => project.division_id === divisionIdToCompare);
  }, [selectedDivisionId, projects, isLoadingProjects]);

  // --- Handle Dropdown Changes ---
  const handleDivisionChange = (event) => {
    const newDivisionId = event.target.value;
    setSelectedDivisionId(newDivisionId);
    setSelectedProjectId('all');
    setFilterPlotName('all');
  };
  const handleProjectChange = (event) => {
    setSelectedProjectId(event.target.value);
    setFilterPlotName('all');
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

  const combinedError = errorFiles || errorProjects || errorDivisions || errorPlots;

  const MapEvents = () => {
    const map = useMap();
    useEffect(() => {
      const onZoomEnd = () => { setCurrentZoom(map.getZoom()); };
      map.on('zoomend', onZoomEnd);
      setCurrentZoom(map.getZoom()); // Set initial zoom
      return () => { map.off('zoomend', onZoomEnd); };
    }, [map]);
    return null;
  };

  const hasAnyMarkersToShow = filesWithMainCoords.length > 0;
  const selectedDivisionName = selectedDivisionId === 'all'
    ? ''
    : (divisions.find(d => d.id.toString() === selectedDivisionId)?.name || '');

  // --- STYLES OBJECT ---
  const styles = {
    filterRow: {
      marginBottom: theme.spacing(2),
      padding: theme.spacing(2),
      backgroundColor: colors.grey[900],
      borderRadius: theme.shape.borderRadius,
      flexShrink: 0,
    },
    filterFormControl: {
      minWidth: 180,
      '& .MuiInputLabel-root': {
        color: colors.grey[300],
        '&.Mui-focused': { color: colors.blueAccent[300] }
      },
      '& .MuiOutlinedInput-root': {
        color: colors.grey[100],
        '& .MuiOutlinedInput-notchedOutline': { borderColor: colors.grey[600] },
        '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: colors.primary[300] },
        '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: colors.blueAccent[400] },
        '& .MuiSelect-icon': { color: colors.grey[300] },
      }
    },
  };

  // --- COMMON MENU PROPS ---
  const commonMenuProps = {
    PaperProps: {
      sx: {
        backgroundColor: colors.primary?.[800] || colors.grey?.[800] || '#1F1F1F',
        color: colors.grey?.[100] || '#FFFFFF',
        borderRadius: theme.shape.borderRadius,
        marginTop: '4px',
        boxShadow: `0px 5px 15px ${alpha(colors.black || theme.palette.common.black || '#000000', 0.35)}`,
        border: `1px solid ${colors.grey?.[700] || '#424242'}`,
        maxHeight: 280,
        overflowY: 'auto',
        '&::-webkit-scrollbar': { width: '8px' },
        '&::-webkit-scrollbar-track': { backgroundColor: colors.primary?.[900] || colors.grey?.[900] || '#121212' },
        '&::-webkit-scrollbar-thumb': {
          backgroundColor: colors.grey?.[600] || '#616161',
          borderRadius: '4px',
          border: `2px solid ${colors.primary?.[900] || colors.grey?.[900] || '#121212'}`,
        },
        '&::-webkit-scrollbar-thumb:hover': { backgroundColor: colors.grey?.[500] || '#757575' },
        '& .MuiMenuItem-root': {
          padding: '10px 16px',
          fontSize: '0.9rem',
          '&:hover': {
            backgroundColor: alpha(colors.blueAccent?.[700] || colors.grey?.[700] || '#2A3F54', 0.8),
            color: colors.grey?.[100] || '#FFFFFF',
          },
          '&.Mui-selected': {
            backgroundColor: `${colors.blueAccent?.[500] || colors.grey?.[600] || '#1976D2'} !important`,
            color: colors.grey?.[50] || '#E0E0E0',
            fontWeight: '600',
            '&:hover': {
              backgroundColor: `${alpha(colors.blueAccent?.[400] || colors.grey?.[500] || '#4778A9', 0.9)} !important`,
            }
          },
          '&.Mui-disabled': {
            opacity: 0.45,
            color: `${colors.grey?.[600] || '#757575'} !important`,
            backgroundColor: 'transparent !important',
            cursor: 'not-allowed',
            '& em': { color: `${colors.grey?.[500] || '#9E9E9E'} !important` }
          },
        },
         '& .MuiMenuItem-root.Mui-disabled .MuiCircularProgress-root': {
            color: `${colors.grey?.[500] || '#9E9E9E'} !important`,
        },
      },
    },
    anchorOrigin: { vertical: 'bottom', horizontal: 'left' },
    transformOrigin: { vertical: 'top', horizontal: 'left' },
  };

  const anyFiltersLoading = isLoadingDivisions || isLoadingProjects || loadingPlots; // Don't include isLoadingFiles for disabling filters themselves

  return (
    <Box sx={{
        display: 'flex', flexDirection: 'column', height: 'calc(100vh - 64px)',
        marginLeft: isCollapsed ? "80px" : "270px", transition: "margin-left 0.3s ease",
        overflow: 'hidden', padding: theme.spacing(2), boxSizing: 'border-box',
        backgroundColor: colors.grey[800]
    }}>
      <Box sx={styles.filterRow}>
        <Typography variant="h6" gutterBottom sx={{ color: colors.grey[100], mb: 2 }}>
            Filter Map Data
        </Typography>
         <Grid container spacing={2} alignItems="center">
             <Grid item xs={12} sm={6} md={4}>
                <FormControl fullWidth size="small" variant="outlined" sx={styles.filterFormControl}>
                    <InputLabel id="division-filter-label">Filter by Division</InputLabel>
                    <Select
                        labelId="division-filter-label"
                        value={selectedDivisionId}
                        label="Filter by Division"
                        onChange={handleDivisionChange}
                        disabled={anyFiltersLoading || isLoadingFiles}
                        MenuProps={commonMenuProps}
                     >
                        <MenuItem value="all"><em>All Divisions</em></MenuItem>
                        {isLoadingDivisions ? <MenuItem disabled><CircularProgress size={20} sx={{ mr: 1 }} /> Loading...</MenuItem>
                            : (divisions || []).length === 0 ? <MenuItem disabled><em>No divisions</em></MenuItem>
                            : (divisions || []).map((division) => (
                                <MenuItem key={`div-${division.id}`} value={division.id.toString()}>{division.name}</MenuItem>
                            ))
                        }
                    </Select>
                </FormControl>
             </Grid>
             <Grid item xs={12} sm={6} md={4}>
                 <FormControl fullWidth size="small" variant="outlined" sx={styles.filterFormControl}>
                    <InputLabel id="project-filter-label">Filter by Project</InputLabel>
                    <Select
                        labelId="project-filter-label"
                        value={selectedProjectId}
                        label="Filter by Project"
                        onChange={handleProjectChange}
                        disabled={anyFiltersLoading || isLoadingFiles || (selectedDivisionId !== 'all' && filteredProjects.length === 0 && !isLoadingProjects)}
                        MenuProps={commonMenuProps}
                     >
                        <MenuItem value="all">
                            <em>All Projects {selectedDivisionName ? `in ${selectedDivisionName}` : ''}</em>
                        </MenuItem>
                        {isLoadingProjects ? <MenuItem disabled><CircularProgress size={20} sx={{ mr: 1 }} /> Loading...</MenuItem>
                            : (filteredProjects.length === 0 && selectedDivisionId !== 'all') ? <MenuItem disabled sx={{ fontStyle: 'italic' }}>No projects in division</MenuItem>
                            : (projects.length === 0 && selectedDivisionId === 'all' && !isLoadingProjects) ? <MenuItem disabled sx={{ fontStyle: 'italic' }}>No projects available</MenuItem>
                            : filteredProjects.map((project) => {
                                let projectDisplayName = project.name || `Project ID ${project.id}`;
                                if (selectedDivisionId === 'all' && project.division_id != null) {
                                    const divisionForProject = divisions.find(d => d.id?.toString() === project.division_id.toString());
                                    if (divisionForProject && divisionForProject.name) {
                                        projectDisplayName = `${projectDisplayName} (${divisionForProject.name})`;
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
                </FormControl>
             </Grid>
             <Grid item xs={12} sm={6} md={4}>
                <FormControl fullWidth size="small" variant="outlined" sx={styles.filterFormControl}>
                    <InputLabel id="plot-filter-label">Filter by Plot</InputLabel>
                    <Select
                        labelId="plot-filter-label"
                        value={filterPlotName}
                        label="Filter by Plot"
                        onChange={handlePlotFilterChange}
                        disabled={!canFetchPlots || anyFiltersLoading || isLoadingFiles}
                        MenuProps={commonMenuProps}
                    >
                        <MenuItem value="all"><em>All Plots</em></MenuItem>
                        {loadingPlots ? (
                            <MenuItem disabled>
                                <CircularProgress size={20} sx={{ mr: 1 }} /> Loading plots...
                            </MenuItem>
                        ) : !canFetchPlots ? (
                            <MenuItem disabled sx={{ fontStyle: 'italic' }}>
                                {selectedDivisionId === 'all' ? "Select Division & Project" : "Select Project to see plots"}
                            </MenuItem>
                        ) : (plotsList || []).length === 0 && !loadingPlots ? (
                            <MenuItem disabled sx={{ fontStyle: 'italic' }}>
                                No plots for this project
                            </MenuItem>
                        ) : (
                            (plotsList || []).map((plotNameItem) => (
                                <MenuItem key={`plot-${plotNameItem}`} value={plotNameItem}>
                                    {plotNameItem}
                                </MenuItem>
                            ))
                        )}
                    </Select>
                </FormControl>
             </Grid>
         </Grid>
         {isLoadingFiles && <Typography variant="caption" sx={{ display: 'block', textAlign: 'center', mt: 1, color: colors.grey[300] }}>Loading map data...</Typography>}
         {combinedError && !isLoadingFiles && <MuiAlert severity="error" sx={{ mt: 1, backgroundColor: alpha(colors.redAccent[700] || '#C62828', 0.3), color: colors.redAccent[100] || '#FFCDD2' }}>Error: {combinedError}</MuiAlert>}
         {/* Removed errorPlots specific message as combinedError will cover it */}
      </Box>

      <Box className="map-container" sx={{ flexGrow: 1, width: '100%', position: 'relative', border: `1px solid ${colors.grey[700]}`, borderRadius: theme.shape.borderRadius, overflow: 'hidden' }}>
         {isLoadingFiles && (
             <Box sx={{
                 position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                 backgroundColor: alpha(colors.grey[800] || '#303030', 0.7), display: 'flex',
                 justifyContent: 'center', alignItems: 'center', zIndex: 1100
             }}>
                 <CircularProgress sx={{color: colors.blueAccent[400]}}/>
             </Box>
         )}
        {!isLoadingFiles && !errorFiles && (
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
                    maxNativeZoom={19}
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
                              <Popup minWidth={450} maxWidth={500} autoPanPaddingTopLeft={[50,50]} autoPanPaddingBottomRight={[50,50]}>
                                  <Box sx={{ lineHeight: 1.5, display: 'flex', flexDirection: 'column', height: 'auto' }}>
                                      <Typography variant="h6" component="div" gutterBottom sx={{textAlign: 'center', flexShrink: 0, color: colors.grey[100] }}>
                                          {file.name || 'Unnamed File'}
                                      </Typography>
                                      {file.tree_midpoints && Object.keys(file.tree_midpoints).length > 0 ? (
                                          <Box sx={{ height: '300px', width: '100%', mb: 1, border: `1px solid ${colors.grey[700]}`, borderRadius: theme.shape.borderRadius }}>
                                            <MidpointsMiniMap
                                                midpoints={file.tree_midpoints}
                                                centerCoords={[file.latitude, file.longitude]}
                                                mainFileName={file.name || file.id.toString()}
                                            />
                                          </Box>
                                      ) : (
                                          <Typography variant="body2" sx={{ mt: 1, mb: 2, fontStyle: 'italic', textAlign: 'center', flexShrink: 0, color: colors.grey[300] }}>
                                              No midpoints to display on a map for this file.
                                          </Typography>
                                      )}
                                      <Box sx={{mt: 'auto', borderTop: `1px solid ${colors.grey[700]}`, pt: 1, flexShrink: 0, color: colors.grey[200]}}>
                                          <Typography variant="subtitle2" sx={{ fontWeight: 'bold' }}>File Details:</Typography>
                                          <Typography variant="body2">Plot: {file.plot_name || 'N/A'}</Typography>
                                          <Typography variant="body2">Main Coords: {file.latitude.toFixed(5)}, {file.longitude.toFixed(5)}</Typography>
                                          <Typography variant="body2">Division: {file.divisionName}</Typography>
                                          <Typography variant="body2">Project: {file.projectName}</Typography>
                                          {potreeViewPath ? (
                                             <Link to={potreeViewPath} style={{ textDecoration: 'none', color: colors.blueAccent[300], fontWeight: 'bold', display: 'block', marginTop: '8px' }}>
                                               View Point Cloud
                                             </Link>
                                          ) : (
                                             <Typography variant="caption" style={{color: colors.grey[500], fontStyle: 'italic', display: 'block', marginTop: '8px'}}>
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
                padding: '20px', backgroundColor: alpha(colors.grey[900] || '#212121', 0.95),
                color: colors.grey[100], borderRadius: theme.shape.borderRadius,
                boxShadow: `0 2px 10px ${alpha(colors.black || '#000000', 0.3)}`,
                textAlign: 'center', zIndex: 1000
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