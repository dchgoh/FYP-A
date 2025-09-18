import React from 'react';
import { Grid, Button, Tooltip, FormControl, InputLabel, Select, MenuItem, Typography, CircularProgress } from '@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import TransformIcon from '@mui/icons-material/Transform';
import SettingsIcon from '@mui/icons-material/Settings';
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings';

const FileManagementToolbar = ({
    colors, theme, ROLES,
    canPerformAction, userRole, isUploading, isLoading, loadingProjectsList, deletingProjectId,
    isDeletingBulk, deletingDivisionId, getProcessingFiles, loadingDivisionsList,
    handleOpenUploadModal, handleOpenProcessingModal,
    handleOpenDivisionProjectSettingsModal, handleOpenProjectSettingsModal,
    filterDivisionId, handleDivisionFilterChange, divisionsList,
    filterProjectId, handleProjectFilterChange, filteredProjectsForDropdown,
    loadingModalDMs
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
        }
    };
    
    const isAnythingLoadingOrDeleting = isLoading || loadingProjectsList || loadingDivisionsList || !!deletingProjectId || isDeletingBulk || !!deletingDivisionId;

    return (
        <Grid container spacing={{ xs: 1, sm: 2 }} sx={{ mb: { xs: 2, sm: 3 } }} alignItems="center">
            <Grid item xs={12} sm={6} md="auto">
                {canPerformAction('upload') && (
                    <Button fullWidth variant="contained" startIcon={<UploadFileIcon />} size={theme.breakpoints.down('sm') ? "small" : "medium"} sx={{ backgroundColor: colors.primary[700], color: "white", "&:hover": { backgroundColor: colors.primary[400] }, textTransform: 'none', py: { xs: 0.8, sm: 1 } }} onClick={handleOpenUploadModal} disabled={isUploading || isAnythingLoadingOrDeleting}>Upload File</Button>
                )}
            </Grid>
            <Grid item xs={12} sm={6} md="auto">
                <Button fullWidth variant="outlined" startIcon={<TransformIcon />} size={theme.breakpoints.down('sm') ? "small" : "medium"} sx={{ borderColor: colors.primary[700], color: colors.primary[700], "&:hover": { borderColor: colors.primary[400], backgroundColor: colors.primary[50] }, textTransform: 'none', py: { xs: 0.8, sm: 1 } }} onClick={handleOpenProcessingModal} disabled={isLoading}>Processing ({getProcessingFiles().length})</Button>
            </Grid>
            <Grid item sx={{ flexGrow: 1, display: { xs: 'none', md: 'block' } }} />
            {userRole === ROLES.ADMIN && (
                <>
                    <Grid item xs={12} sm={6} md="auto" sx={{ mt: { xs: 1, sm: 0 } }}>
                        <Tooltip title="Manage Division and Project Settings"><Button fullWidth variant="outlined" size={theme.breakpoints.down('sm') ? "small" : "medium"} startIcon={<SettingsIcon />} sx={{ borderColor: colors.blueAccent[500], color: colors.blueAccent[400], '&:hover': { borderColor: colors.blueAccent[300], backgroundColor: 'rgba(75, 165, 248, 0.1)' }, textTransform: 'none', py: { xs: 0.8, sm: 1 } }} onClick={handleOpenDivisionProjectSettingsModal} disabled={isAnythingLoadingOrDeleting}><Typography component="span" sx={{ display: { xs: 'none', md: 'inline' } }}>Manage Structure</Typography><Typography component="span" sx={{ display: { xs: 'inline', md: 'none' } }}>Structure</Typography></Button></Tooltip>
                    </Grid>
                    <Grid item xs={12} sm={6} md="auto" sx={{ mt: { xs: 1, sm: 0 } }}>
                        <Tooltip title="Manage Data Manager Assignments"><Button fullWidth variant="outlined" size={theme.breakpoints.down('sm') ? "small" : "medium"} startIcon={<AdminPanelSettingsIcon />} sx={{ borderColor: colors.blueAccent[500], color: colors.blueAccent[400], '&:hover': { borderColor: colors.blueAccent[300], backgroundColor: 'rgba(75, 165, 248, 0.1)' }, textTransform: 'none', py: { xs: 0.8, sm: 1 } }} onClick={handleOpenProjectSettingsModal} disabled={isAnythingLoadingOrDeleting || loadingModalDMs}><Typography component="span" sx={{ display: { xs: 'none', md: 'inline' } }}>Assignments</Typography><Typography component="span" sx={{ display: { xs: 'inline', md: 'none' } }}>Assign</Typography></Button></Tooltip>
                    </Grid>
                </>
            )}
            <Grid item xs={12} sm={6} md="auto" sx={{ mt: { xs: 1, md: 0 } }}>
                <FormControl fullWidth variant="outlined" size="small" sx={styles.filterFormControl}>
                    <InputLabel id="division-filter-label">Filter Division</InputLabel>
                    <Select labelId="division-filter-label" value={filterDivisionId} label="Filter Division" onChange={handleDivisionFilterChange} disabled={isAnythingLoadingOrDeleting}>
                        <MenuItem value="all"><em>All Divisions</em></MenuItem>
                        {divisionsList.map(d=>(<MenuItem key={d.id} value={d.id}>{d.name}</MenuItem>))}
                    </Select>
                </FormControl>
            </Grid>
            <Grid item xs={12} sm={6} md="auto" sx={{ mt: { xs: 1, md: 0 } }}>
                <FormControl fullWidth variant="outlined" size="small" sx={styles.filterFormControl}>
                    <InputLabel id="project-filter-label">Filter Project</InputLabel>
                    <Select labelId="project-filter-label" value={filterProjectId} label="Filter Project" onChange={handleProjectFilterChange} disabled={isAnythingLoadingOrDeleting}>
                        <MenuItem value="all"><em>All Projects</em></MenuItem>
                        {loadingProjectsList ? <MenuItem disabled><CircularProgress size={20} sx={{mr: 1}}/> Loading...</MenuItem>
                            : filteredProjectsForDropdown.map(p => (<MenuItem key={p.id} value={p.id}>{p.name}{filterDivisionId === 'all' && ` (${p.division_name || 'No Div'})`}</MenuItem>))
                        }
                    </Select>
                </FormControl>
            </Grid>
        </Grid>
    );
};

export default FileManagementToolbar;