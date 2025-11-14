import React from 'react';
import { Grid, Button, Tooltip, FormControl, InputLabel, Select, MenuItem, Typography, CircularProgress } from '@mui/material';
import { alpha } from '@mui/material/styles'; // <-- IMPORT alpha for hover effect
import UploadFileIcon from '@mui/icons-material/UploadFile';
import SettingsIcon from '@mui/icons-material/Settings';
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import ReplayIcon from '@mui/icons-material/Replay'; // <-- IMPORT the reset icon

const FileManagementToolbar = ({
    colors, theme, ROLES,
    canPerformAction, userRole, isUploading, isLoading, loadingProjectsList, deletingProjectId,
    isDeletingBulk, deletingDivisionId, loadingDivisionsList,
    handleOpenUploadModal, handleOpenExportModal,
    handleOpenDivisionProjectSettingsModal, handleOpenProjectSettingsModal,
    filterDivisionId, handleDivisionFilterChange, divisionsList,
    filterProjectId, handleProjectFilterChange, filteredProjectsForDropdown,
    loadingModalDMs,
    handleResetFilters, // <-- PROP ADDED
    areFiltersDefault,  // <-- PROP ADDED
}) => {
    
    const styles = {
        filterFormControl: {
            minWidth: { xs: 130, sm: 160, md: 180 }, width: '100%',
            '& .MuiInputLabel-root': { color: colors.grey[300], fontSize: { xs: '0.8rem', sm: '0.9rem', md: '1rem' }, '&.Mui-focused': { color: colors.blueAccent[300] } },
            '& .MuiOutlinedInput-root': { color: colors.grey[100], fontSize: { xs: '0.8rem', sm: '0.9rem', md: '1rem' }, '& .MuiOutlinedInput-notchedOutline': { borderColor: colors.grey[500] }, '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: colors.primary[300] }, '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: colors.blueAccent[400] }, '& .MuiSelect-icon': { color: colors.grey[300] } }
        },
        button: {
            textTransform: 'none', py: { xs: 0.8, sm: 1 },
        },
        adminButton: {
            borderColor: colors.blueAccent[500], color: colors.blueAccent[400],
            '&:hover': { borderColor: colors.blueAccent[300], backgroundColor: 'rgba(75, 165, 248, 0.1)' }
        },
        // --- NEW STYLE FOR THE RESET BUTTON ---
        resetButton: {
            height: '100%', // Match height of select inputs
            color: colors.grey?.[300] || '#B0BEC5',
            borderColor: colors.grey?.[600] || '#616161',
            textTransform: 'none',
            '&:hover': {
                borderColor: colors.primary?.[300] || '#757575',
                backgroundColor: alpha(colors.primary?.[700] || '#2C2C2C', 0.3),
            },
            '&.Mui-disabled': {
                color: colors.grey?.[700] || '#424242',
                borderColor: colors.grey?.[800] || '#303030',
            }
        }
    };
    
    const isAnythingLoadingOrDeleting = isLoading || loadingProjectsList || loadingDivisionsList || !!deletingProjectId || isDeletingBulk || !!deletingDivisionId;

    return (
        <Grid container spacing={{ xs: 1, sm: 2 }} sx={{ mb: { xs: 2, sm: 3 } }} alignItems="center">
            {/* --- ACTION BUTTONS (Upload, Export, etc.) --- */}
            <Grid item xs={12} sm={6} md="auto">
                {canPerformAction('upload') && (
                    <Button fullWidth variant="contained" startIcon={<UploadFileIcon />} size={theme.breakpoints.down('sm') ? "small" : "medium"} sx={{ ...styles.button, backgroundColor: colors.primary[700], color: "white", "&:hover": { backgroundColor: colors.primary[400] } }} onClick={handleOpenUploadModal} disabled={isUploading || isAnythingLoadingOrDeleting}>Upload File</Button>
                )}
            </Grid>
            <Grid item xs={12} sm={6} md="auto" sx={{ mt: { xs: 1, sm: 0 } }}>
                <Tooltip title="Export tree measurements (height, DBH, volume, coordinates) to Excel">
                    <span> {/* Tooltip needs a span for disabled buttons */}
                        <Button fullWidth variant="outlined" startIcon={<FileDownloadIcon />} size={theme.breakpoints.down('sm') ? "small" : "medium"} sx={{ ...styles.button, borderColor: colors.greenAccent[500], color: colors.greenAccent[400], '&:hover': { borderColor: colors.greenAccent[300], backgroundColor: 'rgba(76, 175, 80, 0.1)' } }} onClick={handleOpenExportModal} disabled={isAnythingLoadingOrDeleting}>
                            <Typography component="span" sx={{ display: { xs: 'none', md: 'inline' } }}>Export Tree Data</Typography>
                            <Typography component="span" sx={{ display: { xs: 'inline', md: 'none' } }}>Export</Typography>
                        </Button>
                    </span>
                </Tooltip>
            </Grid>
            
            {/* This spacer pushes filters to the right on larger screens */}
            <Grid item sx={{ flexGrow: 1, display: { xs: 'none', md: 'block' } }} />

            {/* --- ADMIN BUTTONS --- */}
            {userRole === ROLES.ADMIN && (
                <>
                    <Grid item xs={12} sm={6} md="auto" sx={{ mt: { xs: 1, md: 0 } }}>
                        <Tooltip title="Manage Division and Project Settings">
                            <span>
                                <Button fullWidth variant="outlined" size={theme.breakpoints.down('sm') ? "small" : "medium"} startIcon={<SettingsIcon />} sx={{...styles.button, ...styles.adminButton}} onClick={handleOpenDivisionProjectSettingsModal} disabled={isAnythingLoadingOrDeleting}><Typography component="span" sx={{ display: { xs: 'none', md: 'inline' } }}>Manage Structure</Typography><Typography component="span" sx={{ display: { xs: 'inline', md: 'none' } }}>Structure</Typography></Button>
                            </span>
                        </Tooltip>
                    </Grid>
                    <Grid item xs={12} sm={6} md="auto" sx={{ mt: { xs: 1, md: 0 } }}>
                        <Tooltip title="Manage Data Manager Assignments">
                            <span>
                                <Button fullWidth variant="outlined" size={theme.breakpoints.down('sm') ? "small" : "medium"} startIcon={<AdminPanelSettingsIcon />} sx={{...styles.button, ...styles.adminButton}} onClick={handleOpenProjectSettingsModal} disabled={isAnythingLoadingOrDeleting || loadingModalDMs}><Typography component="span" sx={{ display: { xs: 'none', md: 'inline' } }}>Assignments</Typography><Typography component="span" sx={{ display: { xs: 'inline', md: 'none' } }}>Assign</Typography></Button>
                            </span>
                        </Tooltip>
                    </Grid>
                </>
            )}

            {/* --- FILTERS & NEW RESET BUTTON --- */}
            <Grid item xs={12} sm={4} md="auto" sx={{ mt: { xs: 1, md: 0 } }}>
                <FormControl fullWidth variant="outlined" size="small" sx={styles.filterFormControl}>
                    <InputLabel id="division-filter-label">Filter Division</InputLabel>
                    <Select labelId="division-filter-label" value={filterDivisionId} label="Filter Division" onChange={handleDivisionFilterChange} disabled={isAnythingLoadingOrDeleting}>
                        <MenuItem value="all"><em>All Divisions</em></MenuItem>
                        {divisionsList.map(d=>(<MenuItem key={d.id} value={d.id}>{d.name}</MenuItem>))}
                    </Select>
                </FormControl>
            </Grid>
            <Grid item xs={12} sm={4} md="auto" sx={{ mt: { xs: 1, md: 0 } }}>
                <FormControl fullWidth variant="outlined" size="small" sx={styles.filterFormControl}>
                    <InputLabel id="project-filter-label">Filter Project</InputLabel>
                    <Select labelId="project-filter-label" value={filterProjectId} label="Filter Project" onChange={handleProjectFilterChange} disabled={isAnythingLoadingOrDeleting}>
                        <MenuItem value="all"><em>All Projects</em></MenuItem>
                        <MenuItem value="unassigned"><em>Unassigned</em></MenuItem>
                        {loadingProjectsList ? <MenuItem disabled><CircularProgress size={20} sx={{mr: 1}}/> Loading...</MenuItem>
                            : filteredProjectsForDropdown.map(p => (<MenuItem key={p.id} value={p.id}>{p.name}{filterDivisionId === 'all' && ` (${p.division_name || 'No Div'})`}</MenuItem>))
                        }
                    </Select>
                </FormControl>
            </Grid>

            {/* vvv --- THIS IS THE NEW RESET BUTTON --- vvv */}
            <Grid item xs={12} sm={4} md="auto" sx={{ mt: { xs: 1, md: 0 } }}>
                <Tooltip title="Reset all filters to default">
                    <span>
                        <Button
                            fullWidth
                            variant="outlined"
                            onClick={handleResetFilters}
                            disabled={isAnythingLoadingOrDeleting || areFiltersDefault}
                            startIcon={<ReplayIcon />}
                            sx={{ ...styles.resetButton, ...styles.button }}
                        >
                            Reset
                        </Button>
                    </span>
                </Tooltip>
            </Grid>
             {/* ^^^ --- END OF NEW RESET BUTTON --- ^^^ */}

        </Grid>
    );
};

export default FileManagementToolbar;