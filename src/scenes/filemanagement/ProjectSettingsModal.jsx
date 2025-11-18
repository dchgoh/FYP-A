import React from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Box, Typography,
  Accordion, AccordionSummary, AccordionDetails, List, ListItem, ListItemText,
  Chip, Tooltip, IconButton, Divider, FormControl, InputLabel, Select, MenuItem,
  CircularProgress
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings';
import DeleteIcon from '@mui/icons-material/Delete';

const ProjectSettingsModal = ({
    colors, theme, isProjectSettingsModalOpen, handleCloseProjectSettingsModal,
    processingAssignmentInModal, deletingProjectId, isDeletingBulk,
    loadingProjectsList, loadingModalDMs, projectsList, allDataManagers,
    handleModalAccordionChange, assignmentsInModal, loadingAssignmentsForProjectId,
    getUnassignedManagersForModalProject, selectedManagerToAddInModal, userRole, ROLES,
    handleDeleteProject, handleSelectManagerChangeInModal, handleAssignManagerInModal,
    handleRemoveManagerInModal
}) => {
    
    const styles = {
        modalDialogPaper: { backgroundColor: colors.grey[800], color: colors.grey[100], minWidth: { xs: '95vw', sm: '70vw', md: '600px' }, maxWidth: {md: '800px'} },
        modalDialogContent: { p: { xs: 1.5, sm: 2, md: 3 }, maxHeight: { xs: '80vh', sm: '70vh' }, overflowY: 'auto' },
        modalDialogActions: { p: theme.spacing(1, 3), backgroundColor: colors.primary[700], borderTop: `1px solid ${colors.grey[700]}` },
        modalAccordion: { backgroundColor: colors.grey[800], color: colors.grey[100], mb: 1, '&.Mui-expanded': { margin: '8px 0' } },
        modalAccordionDetails: { backgroundColor: colors.grey[800], p: 2 },
        modalListItemIcon: { color: colors.redAccent[400], minWidth: 'auto', '&:hover': { backgroundColor: 'rgba(255, 0, 0, 0.1)' } },
        settingsModalDeleteButton: { color: colors.redAccent[400], ml: 'auto', '&:hover': { backgroundColor: 'rgba(255, 0, 0, 0.1)' }, '&.Mui-disabled': { color: colors.grey[600] } },
    };

    return (
        <Dialog open={isProjectSettingsModalOpen} onClose={handleCloseProjectSettingsModal} disableEscapeKeyDown={!!processingAssignmentInModal || !!deletingProjectId || isDeletingBulk} fullWidth maxWidth="md" PaperProps={{ sx: styles.modalDialogPaper }}>
            <DialogTitle sx={{ textAlign:"center", fontWeight:'bold', m:0, p:2, borderBottom:`1px solid ${colors.grey[600]}` }}>
                Manage Data Manager Assignments
                <IconButton aria-label="close" onClick={handleCloseProjectSettingsModal} sx={{ position:'absolute', right:8, top:8, color: (t) => t.palette.grey[500] }} disabled={!!processingAssignmentInModal || !!deletingProjectId || isDeletingBulk}><CloseIcon /></IconButton>
            </DialogTitle>
            <DialogContent sx={styles.modalDialogContent}>
                {(loadingProjectsList || loadingModalDMs) && <Box display="flex" justifyContent="center" my={2}><CircularProgress/></Box>}
                {!loadingProjectsList && !loadingModalDMs && projectsList.length === 0 && ( <Typography sx={{textAlign:'center', my:2, color:colors.grey[400]}}>No projects defined.</Typography> )}
                {!loadingProjectsList && !loadingModalDMs && projectsList.length > 0 && (
                    <Box mt={2}>
                        {projectsList.map((project) => {
                            const currentAssigned = assignmentsInModal[project.id] || [];
                            const unassignedForDropdown = getUnassignedManagersForModalProject(project.id);
                            const isAccordionLoading = loadingAssignmentsForProjectId === project.id;
                            const selectedUserIdInDropdown = selectedManagerToAddInModal[project.id] || '';
                            const isProcessingThisProject = processingAssignmentInModal?.projectId === project.id;
                            const isDeletingThisProject = deletingProjectId === project.id;

                            return (
                                <Accordion key={project.id} onChange={handleModalAccordionChange(project.id)} sx={styles.modalAccordion} TransitionProps={{ unmountOnExit: true }} disabled={isDeletingThisProject || isDeletingBulk}>
                                    <AccordionSummary expandIcon={<ExpandMoreIcon sx={{color:colors.grey[100]}}/>} sx={{ opacity: isDeletingThisProject ? 0.5 : 1 }}>
                                        <Typography sx={{ flexShrink:0, mr:2, fontWeight:'bold' }}>{project.name}</Typography>
                                        <Chip size="small" label={`${currentAssigned.length} Mgr(s)`} icon={<AdminPanelSettingsIcon fontSize="small"/>} sx={{ backgroundColor: colors.blueAccent[700], color: colors.grey[100] }}/>
                                        {isAccordionLoading && !isDeletingThisProject && <CircularProgress size={20} sx={{ ml: 2 }}/>}
                                        {userRole === ROLES.ADMIN && (
                                            <Tooltip title={`Delete Project "${project.name}"`}>
                                                <span><IconButton aria-label={`delete-project-${project.id}`} onClick={(e) => { e.stopPropagation(); handleDeleteProject(project.id, project.name); }} disabled={isProcessingThisProject || isAccordionLoading || !!deletingProjectId || isDeletingBulk} size="small" sx={styles.settingsModalDeleteButton}>
                                                    {isDeletingThisProject ? <CircularProgress size={20} color="inherit"/> : <DeleteIcon fontSize="small"/>}
                                                </IconButton></span>
                                            </Tooltip>
                                        )}
                                    </AccordionSummary>
                                    <AccordionDetails sx={styles.modalAccordionDetails}>
                                        <Typography variant="subtitle1" gutterBottom>Currently Assigned:</Typography>
                                        {isAccordionLoading ? <CircularProgress size={24}/> : currentAssigned.length === 0 ? <Typography sx={{color:colors.grey[400], fontStyle:'italic'}}>None</Typography> : (
                                            <List dense>
                                                {currentAssigned.map(m=>(<ListItem key={m.id} secondaryAction={<IconButton edge="end" onClick={()=>handleRemoveManagerInModal(project.id, m.id, m.username)} disabled={isProcessingThisProject || isAccordionLoading || isDeletingThisProject || isDeletingBulk} title={`Remove ${m.username}`} size="small">{(processingAssignmentInModal?.type==='remove'&&processingAssignmentInModal.userId===m.id)?<CircularProgress size={20} color="inherit"/>:<DeleteIcon fontSize="small" sx={styles.modalListItemIcon}/>}</IconButton>} sx={{pr:'50px'}}><ListItemText primary={m.username} secondary={m.email}/></ListItem>))}
                                            </List>
                                        )}
                                        <Divider sx={{ my: 2, borderColor: colors.grey[700] }} />
                                        <Typography variant="subtitle1" gutterBottom>Assign New Manager:</Typography>
                                        {unassignedForDropdown.length === 0 ? <Typography sx={{ color: colors.grey[400] }}>All available Data Managers are assigned.</Typography> : (
                                            <Box display="flex" alignItems="center" gap={2} mt={1}>
                                                <FormControl variant="outlined" size="small" sx={{ minWidth: 200, flexGrow: 1 }} disabled={isProcessingThisProject || isAccordionLoading || isDeletingThisProject || isDeletingBulk}>
                                                    <InputLabel>Select Manager</InputLabel>
                                                    <Select value={selectedUserIdInDropdown} label="Select Manager" onChange={(e)=>handleSelectManagerChangeInModal(project.id,e)}><MenuItem value="" disabled><em>Select...</em></MenuItem>{unassignedForDropdown.map(m=>(<MenuItem key={m.id} value={m.id}>{m.username} ({m.email})</MenuItem>))}</Select>
                                                </FormControl>
                                                <Button variant="contained" color="secondary" size="medium" onClick={()=>handleAssignManagerInModal(project.id)} disabled={!selectedUserIdInDropdown||isProcessingThisProject||isAccordionLoading || isDeletingThisProject || isDeletingBulk} startIcon={(processingAssignmentInModal?.type==='assign'&&processingAssignmentInModal.userId===selectedUserIdInDropdown)?<CircularProgress size={20} color="inherit"/>:<PersonAddIcon/>}>Assign</Button>
                                            </Box>
                                        )}
                                    </AccordionDetails>
                                </Accordion>
                            );
                        })}
                    </Box>
                )}
            </DialogContent>
                <DialogActions sx={styles.modalDialogActions}>
                    <Button 
                        onClick={handleCloseProjectSettingsModal} 
                        color="warning" 
                        variant="contained" 
                        disabled={!!processingAssignmentInModal || !!deletingProjectId || isDeletingBulk}
                    >
                        Close
                    </Button>
                </DialogActions>
            </Dialog>
    );
};

export default ProjectSettingsModal;