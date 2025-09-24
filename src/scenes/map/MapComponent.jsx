import React, { useState, useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import { Link } from 'react-router-dom';
import 'leaflet/dist/leaflet.css';
import {
  Select, MenuItem, FormControl, InputLabel, Box, Alert as MuiAlert,
  Typography, CircularProgress, Grid, useTheme
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import L from 'leaflet';
import MidpointsMiniMap from './MidpointsMiniMap';
import { tokens } from "../../theme";
import { useMapData } from '../../hooks/useMapData';

// --- Leaflet Icon Fix ---
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: require('leaflet/dist/images/marker-icon-2x.png'),
  iconUrl: require('leaflet/dist/images/marker-icon.png'),
  shadowUrl: require('leaflet/dist/images/marker-shadow.png'),
});

// --- Constants ---
const MAX_MAP_AND_TILE_ZOOM = 21;
const OSM_NATIVE_MAX_ZOOM = 19;
const INITIAL_POSITION = [1.55, 110.35]; // Sarawak, Malaysia approx.

// --- Helper Components ---
const MapEvents = ({ onZoomEnd }) => {
    const map = useMap();
    useEffect(() => {
        map.on('zoomend', () => onZoomEnd(map.getZoom()));
        onZoomEnd(map.getZoom()); // Set initial zoom
        return () => { map.off('zoomend'); };
    }, [map, onZoomEnd]);
    return null;
};

const MapComponent = ({ isCollapsed }) => {
    const theme = useTheme();
    const colors = tokens(theme.palette.mode);

    // --- All state and logic now comes from this single hook! ---
    const {
        mapFiles, divisions, plotsList, filteredProjectsForDropdown,
        isLoadingFiles, isLoadingFilters, loadingPlots, error,
        selectedProjectId, selectedDivisionId, filterPlotName,
        handleDivisionChange, handleProjectChange, handlePlotFilterChange, canFetchPlots
    } = useMapData();

    const [currentZoom, setCurrentZoom] = useState(5);

    // --- UI-specific Logic & Derived State ---
    const filesWithMainCoords = useMemo(() => 
        mapFiles.filter(file => file.latitude != null && file.longitude != null), 
    [mapFiles]);
    
    const mapCenter = useMemo(() => {
        if (filesWithMainCoords.length === 0) return INITIAL_POSITION;
        if (filesWithMainCoords.length === 1) return [filesWithMainCoords[0].latitude, filesWithMainCoords[0].longitude];
        
        const avgLat = filesWithMainCoords.reduce((sum, f) => sum + f.latitude, 0) / filesWithMainCoords.length;
        const avgLng = filesWithMainCoords.reduce((sum, f) => sum + f.longitude, 0) / filesWithMainCoords.length;
        return [avgLat, avgLng];
    }, [filesWithMainCoords]);

    const anyFiltersLoading = isLoadingFilters || loadingPlots;
    
    // --- STYLES ---
    const styles = {
        filterRow: { mb: 2, p: { xs: 1.5, sm: 2 }, backgroundColor: colors.grey[900], borderRadius: theme.shape.borderRadius, flexShrink: 0 },
        filterFormControl: { minWidth: { xs: 120, sm: 150, md: 180 }, width: '100%', '& .MuiInputLabel-root': { color: colors.grey[300], '&.Mui-focused': { color: colors.blueAccent[300] } }, '& .MuiOutlinedInput-root': { color: colors.grey[100], '& .MuiOutlinedInput-notchedOutline': { borderColor: colors.grey[600] }, '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: colors.primary[300] }, '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: colors.blueAccent[400] }, '& .MuiSelect-icon': { color: colors.grey[300] } } },
        mapContainerWrapper: { flexGrow: 1, width: '100%', position: 'relative', border: `1px solid ${colors.grey[700]}`, borderRadius: theme.shape.borderRadius, overflow: 'hidden', minHeight: { xs: 300, md: 400 } },
        popupContentBox: { lineHeight: 1.5, display: 'flex', flexDirection: 'column', maxHeight: { xs: '65vh', md: '500px' }, overflowY: 'auto', width: '100%', p: {xs: 1, sm: 1.5} },
        popupMiniMapContainer: { height: { xs: '180px', md: '250px' }, width: '100%', mb: 1.5, border: `1px solid ${colors.grey[700]}`, borderRadius: theme.shape.borderRadius, overflow: 'hidden' },
        popupDetailsSection: { mt: 'auto', borderTop: `1px solid ${colors.grey[700]}`, pt: 1.5, flexShrink: 0, color: colors.grey[200], fontSize: {xs: '0.75rem', sm: '0.875rem'} }
    };

    const commonMenuProps = { PaperProps: { sx: {  color: colors.grey[100], '& .MuiMenuItem-root:hover': { backgroundColor: colors.blueAccent[600] }, '& .MuiMenuItem-root.Mui-selected': { backgroundColor: `${colors.blueAccent[700]} !important` } } } };

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', height: `calc(100vh - ${theme.mixins.toolbar?.minHeight || 64}px - ${theme.spacing(4)})`, marginLeft: { xs: 0, sm: isCollapsed ? "80px" : "270px" }, transition: "margin-left 0.3s ease", p: { xs: 1, sm: 2 }, backgroundColor: colors.grey[800] }}>
            <Box sx={styles.filterRow}>
                <Typography variant="h6" gutterBottom sx={{ color: colors.grey[100], mb: 2 }}>Filter Map Data</Typography>
                <Grid container spacing={{xs: 1.5, sm: 2}}>
                    <Grid item xs={12} sm={6} md={4}>
                        <FormControl fullWidth size="small" sx={styles.filterFormControl}>
                            <InputLabel>Filter by Division</InputLabel>
                            <Select value={selectedDivisionId} label="Filter by Division" onChange={handleDivisionChange} disabled={anyFiltersLoading || isLoadingFiles} MenuProps={commonMenuProps}>
                                <MenuItem value="all"><em>All Divisions</em></MenuItem>
                                {divisions.map(d => (<MenuItem key={d.id} value={d.id}>{d.name}</MenuItem>))}
                            </Select>
                        </FormControl>
                    </Grid>
                    <Grid item xs={12} sm={6} md={4}>
                        <FormControl fullWidth size="small" sx={styles.filterFormControl}>
                            <InputLabel>Filter by Project</InputLabel>
                            <Select value={selectedProjectId} label="Filter by Project" onChange={handleProjectChange} disabled={anyFiltersLoading || isLoadingFiles} MenuProps={commonMenuProps}>
                                <MenuItem value="all"><em>All Projects</em></MenuItem>
                                <MenuItem value="unassigned"><em>Unassigned Files</em></MenuItem>
                                {filteredProjectsForDropdown.map(p => (<MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>))}
                            </Select>
                        </FormControl>
                    </Grid>
                    <Grid item xs={12} sm={12} md={4}>
                        <FormControl fullWidth size="small" sx={styles.filterFormControl}>
                            <InputLabel>Filter by Plot</InputLabel>
                            <Select value={filterPlotName} label="Filter by Plot" onChange={handlePlotFilterChange} disabled={!canFetchPlots || anyFiltersLoading || isLoadingFiles} MenuProps={commonMenuProps}>
                                <MenuItem value="all"><em>All Plots</em></MenuItem>
                                {loadingPlots && <MenuItem disabled><CircularProgress size={20}/> Loading...</MenuItem>}
                                {plotsList.map(plot => (<MenuItem key={plot} value={plot}>{plot}</MenuItem>))}
                            </Select>
                        </FormControl>
                    </Grid>
                </Grid>
                {error && <MuiAlert severity="error" sx={{ mt: 1.5 }}>{error}</MuiAlert>}
            </Box>

            <Box sx={styles.mapContainerWrapper}>
                {isLoadingFiles && (
                    <Box sx={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: alpha(colors.grey[800], 0.7), display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1100 }}>
                        <CircularProgress sx={{color: colors.blueAccent[400]}}/>
                    </Box>
                )}
                <MapContainer key={mapCenter.join(',')} center={mapCenter} zoom={currentZoom} maxZoom={MAX_MAP_AND_TILE_ZOOM} style={{ height: '100%', width: '100%', borderRadius: 'inherit' }} scrollWheelZoom={true}>
                    <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" maxZoom={MAX_MAP_AND_TILE_ZOOM} maxNativeZoom={OSM_NATIVE_MAX_ZOOM} />
                    <MapEvents onZoomEnd={setCurrentZoom} />
                    {filesWithMainCoords.map(file => (
                        <Marker position={[file.latitude, file.longitude]} key={`file-main-${file.id}`}>
                            <Popup minWidth={400} maxWidth={450}>
                                <Box sx={styles.popupContentBox}>
                                    <Typography variant="subtitle1">{file.name || 'Unnamed File'}</Typography>
                                    {file.tree_midpoints && Object.keys(file.tree_midpoints).length > 0 ? (
                                        <Box sx={styles.popupMiniMapContainer}>
                                            <MidpointsMiniMap midpoints={file.tree_midpoints} centerCoords={[file.latitude, file.longitude]} />
                                        </Box>
                                    ) : ( <Typography variant="body2" sx={{ my: 2, fontStyle: 'italic', textAlign: 'center' }}>No individual tree data available.</Typography> )}
                                    <Box sx={styles.popupDetailsSection}>
                                        <Typography variant="body2">Plot: {file.plot_name || 'N/A'}</Typography>
                                        <Typography variant="body2">Project: {file.projectName}</Typography>
                                        {file.potreeUrl && <Link to={`/potree?url=${encodeURIComponent(file.potreeUrl)}`} style={{ color: colors.blueAccent[300], fontWeight: 'bold' }}>View Point Cloud</Link>}
                                    </Box>
                                </Box>
                            </Popup>
                        </Marker>
                    ))}
                </MapContainer>
                {!isLoadingFiles && !error && filesWithMainCoords.length === 0 && (
                    <Box sx={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', p: 3, backgroundColor: alpha(colors.grey[900], 0.95), textAlign: 'center', zIndex: 1000 }}>
                        <Typography variant="h6">No Data to Display</Typography>
                        <Typography variant="body2">No files with coordinates match the current filters.</Typography>
                    </Box>
                )}
            </Box>
        </Box>
    );
};

export default MapComponent;