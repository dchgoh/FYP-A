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
// (This fix should ideally be in a more global place, like index.js or App.js,
// but keeping it here if it's specific to this component's leaflet instance setup)
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: require('leaflet/dist/images/marker-icon-2x.png'),
  iconUrl: require('leaflet/dist/images/marker-icon.png'),
  shadowUrl: require('leaflet/dist/images/marker-shadow.png'),
});
// --- End Icon Fix ---

// Constants
const API_BASE_URL = "http://localhost:5000/api"; // Replace with your actual API base URL
const MAX_MAP_AND_TILE_ZOOM = 21;
const OSM_NATIVE_MAX_ZOOM = 19;

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
        const errorText = await response.text().catch(() => `Failed to read error response from ${url}`);
        throw new Error(`HTTP error! Status: ${response.status}, Endpoint: ${url.replace(API_BASE_URL,'')}, Details: ${errorText.substring(0,150)}`);
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
      const authError = "Authentication required. Please log in.";
      setErrorProjects(authError); setErrorDivisions(authError);
      setIsLoadingProjects(false); setIsLoadingDivisions(false);
      setMapFiles([]); setIsLoadingFiles(false);
      return;
    }
    fetchDropdownData(`${API_BASE_URL}/projects`, storedToken, setProjects, setIsLoadingProjects, setErrorProjects);
    fetchDropdownData(`${API_BASE_URL}/divisions`, storedToken, setDivisions, setIsLoadingDivisions, setErrorDivisions);
  }, [fetchDropdownData]);

  // --- Fetch Plots List ---
  const fetchPlotsList = useCallback(async (divisionId, projectId) => {
    const token = localStorage.getItem('authToken');
    if (!token) {
      setPlotsList([]); setErrorPlots("Authentication required for fetching plots."); setLoadingPlots(false); return;
    }
    if (!divisionId || divisionId === 'all' || !projectId || projectId === 'all' || projectId === 'unassigned') {
      setPlotsList([]); setFilterPlotName('all'); setLoadingPlots(false); return;
    }
    setLoadingPlots(true); setErrorPlots(null); setPlotsList([]);
    try {
      const params = new URLSearchParams({ divisionId, projectId });
      const response = await fetch(`${API_BASE_URL}/files/plots?${params.toString()}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Failed to read error response');
        throw new Error(`HTTP error fetching plots! Status: ${response.status}, Details: ${errorText.substring(0,100)}`);
      }
      const data = await response.json();
      setPlotsList(Array.isArray(data.plots) ? data.plots : []);
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
      setErrorFiles("Authentication required. Please log in."); setIsLoadingFiles(false); setMapFiles([]); return;
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
      if (filterPlotName !== 'all') setFilterPlotName('all');
    }
  }, [selectedDivisionId, selectedProjectId, canFetchPlots, fetchPlotsList, isLoadingDivisions, isLoadingProjects, filterPlotName]);

  // --- Effect to Fetch Map Files when any relevant filter changes ---
  useEffect(() => {
    if ((!isLoadingDivisions && !isLoadingProjects) || (!errorDivisions && !errorProjects)) {
        fetchMapFiles();
    }
  }, [fetchMapFiles, isLoadingDivisions, isLoadingProjects, errorDivisions, errorProjects]);

  // --- Calculate Filtered Projects for Dropdown ---
  const filteredProjects = useMemo(() => {
    const safeProjects = Array.isArray(projects) ? projects : [];
    if (isLoadingProjects || !safeProjects.length) return [];
    if (selectedDivisionId === 'all') return safeProjects;
    const divisionIdToCompare = parseInt(selectedDivisionId, 10);
    return safeProjects.filter(project => project.division_id === divisionIdToCompare);
  }, [selectedDivisionId, projects, isLoadingProjects]);

  // --- Handle Dropdown Changes ---
  const handleDivisionChange = (event) => {
    const newDivisionId = event.target.value;
    setSelectedDivisionId(newDivisionId); setSelectedProjectId('all'); setFilterPlotName('all');
  };
  const handleProjectChange = (event) => {
    setSelectedProjectId(event.target.value); setFilterPlotName('all');
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
    // Basic average for a slightly better default center if multiple files
    if (filesWithMainCoords.length > 1) {
        const avgLat = filesWithMainCoords.reduce((sum, f) => sum + f.latitude, 0) / filesWithMainCoords.length;
        const avgLng = filesWithMainCoords.reduce((sum, f) => sum + f.longitude, 0) / filesWithMainCoords.length;
        mapCenterToUse = [avgLat, avgLng];
    } else {
        mapCenterToUse = [filesWithMainCoords[0].latitude, filesWithMainCoords[0].longitude];
    }
  }

  const combinedError = errorFiles || errorProjects || errorDivisions || errorPlots;

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
    : (divisions.find(d => d.id.toString() === selectedDivisionId)?.name || '');

  // --- STYLES OBJECT ---
  const styles = {
    filterRow: {
      mb: 2,
      p: { xs: 1.5, sm: 2 },
      backgroundColor: colors.grey[900],
      borderRadius: theme.shape.borderRadius,
      flexShrink: 0,
    },
    filterFormControl: {
      minWidth: { xs: 120, sm: 150, md: 180 },
      width: '100%',
      '& .MuiInputLabel-root': {
        color: colors.grey[300],
        fontSize: { xs: '0.8rem', sm: '0.9rem', md: '1rem' },
        '&.Mui-focused': { color: colors.blueAccent[300] }
      },
      '& .MuiOutlinedInput-root': {
        color: colors.grey[100],
        fontSize: { xs: '0.8rem', sm: '0.9rem', md: '1rem' },
        '& .MuiOutlinedInput-notchedOutline': { borderColor: colors.grey[600] },
        '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: colors.primary[300] },
        '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: colors.blueAccent[400] },
        '& .MuiSelect-icon': { color: colors.grey[300] },
      }
    },
    mapContainerWrapper: {
      flexGrow: 1,
      width: '100%',
      position: 'relative',
      border: `1px solid ${colors.grey[700]}`,
      borderRadius: theme.shape.borderRadius,
      overflow: 'hidden',
      minHeight: { xs: 300, sm: 350, md: 400 } // Responsive minimum height for the map area
    },
    popupContentBox: {
        lineHeight: 1.5,
        display: 'flex',
        flexDirection: 'column',
        maxHeight: { xs: '65vh', sm: '60vh', md: '500px' }, // Max height for popup content
        overflowY: 'auto',
        width: '100%',
        p: {xs: 1, sm: 1.5} // Padding inside the popup content box
    },
    popupMiniMapContainer: {
        height: { xs: '180px', sm: '220px', md: '250px' }, // Responsive height for mini-map
        width: '100%',
        mb: 1.5, // Margin bottom for mini-map
        border: `1px solid ${colors.grey[700]}`,
        borderRadius: theme.shape.borderRadius
    },
    popupDetailsSection: {
        mt: 'auto', // Pushes details to bottom if content above is short
        borderTop: `1px solid ${colors.grey[700]}`,
        pt: 1.5, // Padding top for details section
        flexShrink: 0,
        color: colors.grey[200],
        fontSize: {xs: '0.75rem', sm: '0.875rem'}
    }
  };

  // --- COMMON MENU PROPS for Select Dropdowns ---
  const commonMenuProps = {
    PaperProps: {
      sx: {
          backgroundColor: colors.primary[700] || theme.palette.background.paper, // Theme aware background
          color: colors.grey[100],
          '& .MuiMenuItem-root': {
            fontSize: { xs: '0.8rem', sm: '0.9rem' }, // Responsive font size for menu items
          },
          '& .MuiMenuItem-root:hover': {
              backgroundColor: colors.blueAccent[600] || theme.palette.action.hover,
              color: colors.grey[100],
          },
          '& .MuiMenuItem-root.Mui-selected': {
              backgroundColor: `${colors.blueAccent[700]} !important`,
              color: `${colors.grey[100]} !important`,
          },
          '& .MuiMenuItem-root.Mui-selected:hover': {
              backgroundColor: `${colors.blueAccent[700]} !important`,
              color: `${colors.grey[100]} !important`,
          }
      }
  }
  };

  const anyFiltersLoading = isLoadingDivisions || isLoadingProjects || loadingPlots;

  return (
    <Box sx={{
        display: 'flex', flexDirection: 'column',
        height: `calc(100vh - ${theme.mixins.toolbar?.minHeight || 64}px - ${theme.spacing(4)})`,
        marginLeft: {
            xs: 0, // Assuming sidebar is overlaid or hidden on xs
            sm: isCollapsed ? "80px" : "270px"
        },
        transition: "margin-left 0.3s ease",
        overflow: 'hidden',
        p: { xs: 1, sm: 2 },
        boxSizing: 'border-box',
        backgroundColor: colors.grey[800]
    }}>
      <Box sx={styles.filterRow}>
        <Typography variant="h6" gutterBottom sx={{
            color: colors.grey[100],
            mb: 2,
            fontSize: {xs: '1rem', sm: '1.15rem', md: '1.25rem'}
        }}>
            Filter Map Data
        </Typography>
         <Grid container spacing={{xs: 1.5, sm: 2}} alignItems="flex-start"> {/* Changed to flex-start for better label alignment */}
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
                            : (divisions || []).length === 0 ? <MenuItem disabled sx={{fontStyle: 'italic'}}>No divisions found</MenuItem>
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
                         <MenuItem value="unassigned" sx={{fontStyle: 'italic'}}>Unassigned Files</MenuItem>
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
             <Grid item xs={12} sm={12} md={4}> {/* Plot filter takes full sm width if only 2 filters before it, or 1/3 on md */}
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
                                {selectedDivisionId === 'all' ? "Select Division & Project" : selectedProjectId === 'all' || selectedProjectId === 'unassigned' ? "Select Project" : "Fetching..."}
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
         {isLoadingFiles && <Typography variant="caption" sx={{ display: 'block', textAlign: 'center', mt: 1.5, color: colors.grey[300] }}>Loading map data...</Typography>}
         {combinedError && !isLoadingFiles && <MuiAlert severity="error" sx={{ mt: 1.5, backgroundColor: alpha(colors.redAccent[700] || '#C62828', 0.3), color: colors.redAccent[100] || '#FFCDD2' }}>Error: {combinedError}</MuiAlert>}
      </Box>

      <Box sx={styles.mapContainerWrapper}>
         {isLoadingFiles && (
             <Box sx={{
                 position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                 backgroundColor: alpha(colors.grey[800] || '#303030', 0.7), display: 'flex',
                 justifyContent: 'center', alignItems: 'center', zIndex: 1100 // Ensure overlay is above map tiles
             }}>
                 <CircularProgress sx={{color: colors.blueAccent[400]}}/>
             </Box>
         )}
        {!isLoadingFiles && !errorFiles && (
            <MapContainer
                key={`${mapCenterToUse.join(',')}-${currentZoom}-${mapFiles.length}`} // More robust key for re-renders
                center={mapCenterToUse}
                zoom={currentZoom}
                maxZoom={MAX_MAP_AND_TILE_ZOOM}
                style={{ height: '100%', width: '100%', borderRadius: 'inherit' }}
                zoomControl={true}
                scrollWheelZoom={true}
            >
                <TileLayer
                    attribution='© <a href="https://www.openstreetmap.org/copyright">OSM</a> contributors'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    maxZoom={MAX_MAP_AND_TILE_ZOOM}
                    maxNativeZoom={OSM_NATIVE_MAX_ZOOM}
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
                              <Popup minWidth={300} maxWidth={450} autoPanPadding={[40,40]}>
                                  <Box sx={styles.popupContentBox}>
                                      <Typography variant="subtitle1" component="div" gutterBottom sx={{textAlign: 'center', flexShrink: 0, color: colors.grey[100], fontWeight:'bold', fontSize: {xs: '0.9rem', sm: '1rem'} }}>
                                          {file.name || 'Unnamed File'}
                                      </Typography>
                                      {file.tree_midpoints && Object.keys(file.tree_midpoints).length > 0 ? (
                                          <Box sx={styles.popupMiniMapContainer}>
                                            <MidpointsMiniMap
                                                midpoints={file.tree_midpoints}
                                                centerCoords={[file.latitude, file.longitude]}
                                                mainFileName={file.name || file.id.toString()}
                                            />
                                          </Box>
                                      ) : (
                                          <Typography variant="body2" sx={{ mt: 1, mb: 2, fontStyle: 'italic', textAlign: 'center', flexShrink: 0, color: colors.grey[300], fontSize: {xs: '0.75rem', sm: '0.875rem'} }}>
                                              No midpoints map available for this file.
                                          </Typography>
                                      )}
                                      <Box sx={styles.popupDetailsSection}>
                                          <Typography variant="subtitle2" sx={{ fontWeight: 'bold', fontSize: 'inherit', mb: 0.5 }}>File Details:</Typography>
                                          <Typography variant="body2" sx={{fontSize: 'inherit'}}>Plot: {file.plot_name || 'N/A'}</Typography>
                                          <Typography variant="body2" sx={{fontSize: 'inherit'}}>Main Coords: {file.latitude.toFixed(5)}, {file.longitude.toFixed(5)}</Typography>
                                          <Typography variant="body2" sx={{fontSize: 'inherit'}}>Division: {file.divisionName}</Typography>
                                          <Typography variant="body2" sx={{fontSize: 'inherit'}}>Project: {file.projectName}</Typography>
                                          {potreeViewPath ? (
                                             <Link to={potreeViewPath} onClick={() => setTimeout(() => window.location.reload(true), 0)} style={{ textDecoration: 'none', color: colors.blueAccent[300], fontWeight: 'bold', display: 'block', marginTop: '8px', fontSize: 'inherit' }}>
                                               View Point Cloud
                                             </Link>
                                          ) : (
                                             <Typography variant="caption" style={{color: colors.grey[500], fontStyle: 'italic', display: 'block', marginTop: '8px', fontSize: '0.7rem'}}>
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
                p: {xs: 2, sm: 3}, backgroundColor: alpha(colors.grey[900] || '#212121', 0.95),
                color: colors.grey[100], borderRadius: theme.shape.borderRadius,
                boxShadow: `0 2px 10px ${alpha(colors.black || '#000000', 0.3)}`,
                textAlign: 'center', zIndex: 1000 // Ensure it's above map tiles
             }}>
                 <Typography variant="h6" gutterBottom sx={{fontSize: {xs: '1rem', sm: '1.25rem'}}}>No Data to Display</Typography>
                 <Typography variant="body2" sx={{fontSize: {xs: '0.8rem', sm: '0.9rem'}}}>
                     No data points found matching the current filters. Try adjusting the filters or upload new data.
                 </Typography>
             </Box>
         )}
      </Box>
    </Box>
  );
};

export default MapComponent;