import React from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Box, Typography,
  List, ListItem, ListItemText, Tooltip, IconButton, Divider, CircularProgress
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import DeleteIcon from '@mui/icons-material/Delete';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';

const DivisionProjectSettingsModal = ({
    colors, theme, isDivisionProjectSettingsModalOpen, handleCloseDivisionProjectSettingsModal,
    deletingDivisionId, deletingProjectId, isDeletingBulk, loadingDivisionsList,
    divisionsList, handleDeleteDivision, userRole, ROLES, handleOpenCreateDivisionModal,
    loadingProjectsList, projectsList, handleDeleteProject, handleOpenCreateProjectModal
}) => {
    return (
        <Dialog open={isDivisionProjectSettingsModalOpen} onClose={handleCloseDivisionProjectSettingsModal} disableEscapeKeyDown={!!deletingDivisionId || !!deletingProjectId || isDeletingBulk} fullWidth maxWidth="sm" PaperProps={{ sx: { backgroundColor: colors.grey[800] } }}>
            <DialogTitle sx={{ textAlign: "center", fontWeight: 'bold', p: 2, borderBottom: `1px solid ${colors.grey[600]}` }}>
                Manage Divisions & Projects
                <IconButton aria-label="close" onClick={handleCloseDivisionProjectSettingsModal} sx={{ position: 'absolute', right: 8, top: 8, color: 'grey.500' }} disabled={!!deletingDivisionId || !!deletingProjectId || isDeletingBulk}><CloseIcon /></IconButton>
            </DialogTitle>
            <DialogContent sx={{ p: { xs: 1.5, sm: 3 } }}>
                <Box mb={3}>
                    <Typography variant="h6" gutterBottom>Divisions</Typography>
                    {loadingDivisionsList && <Box display="flex" justifyContent="center" my={2}><CircularProgress/></Box>}
                    {!loadingDivisionsList && divisionsList.length > 0 && (
                        <List dense>
                            {divisionsList.map((division) => {
                                const isDeletingThis = deletingDivisionId === division.id;
                                return (<ListItem key={division.id} secondaryAction={<Tooltip title={`Delete Division "${division.name}"`}><span><IconButton edge="end" onClick={() => handleDeleteDivision(division.id, division.name)} disabled={!!deletingDivisionId || !!deletingProjectId || isDeletingBulk} size="small">{isDeletingThis ? <CircularProgress size={20} color="inherit"/> : <DeleteIcon fontSize="small" sx={{ '&:hover': { color: colors.redAccent[500] } }}/>}</IconButton></span></Tooltip>} divider><ListItemText primary={division.name} /></ListItem>);
                            })}
                        </List>
                    )}
                    {userRole === ROLES.ADMIN && (<Button variant="contained" startIcon={<AddCircleOutlineIcon />} sx={{ mt: 1 }} onClick={handleOpenCreateDivisionModal} fullWidth disabled={!!deletingDivisionId || !!deletingProjectId || isDeletingBulk}>New Division</Button>)}
                </Box>
                <Divider sx={{ my: 2, borderColor: colors.grey[700] }} />
                <Box>
                    <Typography variant="h6" gutterBottom>Projects</Typography>
                    {loadingProjectsList && <Box display="flex" justifyContent="center" my={2}><CircularProgress/></Box>}
                    {!loadingProjectsList && projectsList.length > 0 && (
                        <List dense>
                            {projectsList.map((project) => {
                                const isDeletingThis = deletingProjectId === project.id;
                                return (<ListItem key={project.id} secondaryAction={<Tooltip title={`Delete Project "${project.name}"`}><span><IconButton edge="end" onClick={() => handleDeleteProject(project.id, project.name)} disabled={!!deletingDivisionId || !!deletingProjectId || isDeletingBulk} size="small">{isDeletingThis ? <CircularProgress size={20} color="inherit"/> : <DeleteIcon fontSize="small" sx={{ '&:hover': { color: colors.redAccent[500] } }}/>}</IconButton></span></Tooltip>} divider><ListItemText primary={project.name} secondary={`Division: ${project.division_name || 'N/A'}`}/></ListItem>);
                            })}
                        </List>
                    )}
                    {userRole === ROLES.ADMIN && (<Button variant="contained" startIcon={<AddCircleOutlineIcon />} sx={{ mt: 1 }} onClick={handleOpenCreateProjectModal} fullWidth disabled={!!deletingDivisionId || !!deletingProjectId || isDeletingBulk || loadingDivisionsList}>New Project</Button>)}
                </Box>
            </DialogContent>
        </Dialog>
    );
};

export default DivisionProjectSettingsModal;