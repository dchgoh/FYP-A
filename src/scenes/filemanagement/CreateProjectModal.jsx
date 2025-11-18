import React from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField,
  FormControl, InputLabel, Select, MenuItem, CircularProgress, ListItemIcon, ListItemText
} from '@mui/material';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';

const CreateProjectModal = ({
    colors, theme, createProjectModalOpen, handleCloseCreateProjectModal,
    isCreatingProject, newProjectName, setNewProjectName,
    selectedDivisionIdForCreation, setSelectedDivisionIdForCreation,
    loadingDivisionsList, divisionsList, userRole, ROLES, CREATE_NEW_DIVISION_VALUE,
    handleOpenCreateDivisionModal, handleCreateProject
}) => {
    return (
        <Dialog open={createProjectModalOpen} onClose={handleCloseCreateProjectModal} disableEscapeKeyDown={isCreatingProject} PaperProps={{ sx: { backgroundColor: colors.grey[800] } }}>
            <DialogTitle sx={{ textAlign: "center", fontWeight: 'bold' }}>Create New Project</DialogTitle>
            <DialogContent>
                <FormControl fullWidth required variant="outlined" margin="dense" size="small" disabled={isCreatingProject || loadingDivisionsList}>
                    <InputLabel>Division</InputLabel>
                    <Select value={selectedDivisionIdForCreation} label="Division *" onChange={(e) => { e.target.value === CREATE_NEW_DIVISION_VALUE ? handleOpenCreateDivisionModal() : setSelectedDivisionIdForCreation(e.target.value); }}>
                        <MenuItem value="" disabled><em>Select Division...</em></MenuItem>
                        {loadingDivisionsList ? <MenuItem disabled><CircularProgress size={20} sx={{mr: 1}}/> Loading...</MenuItem> : divisionsList.map((div) => ( <MenuItem key={div.id} value={div.id}>{div.name}</MenuItem> ))}
                        {userRole === ROLES.ADMIN && (<MenuItem value={CREATE_NEW_DIVISION_VALUE} sx={{ fontStyle: 'italic', color: colors.greenAccent[400] }}><ListItemIcon sx={{ minWidth: '32px', color: 'inherit' }}><AddCircleOutlineIcon fontSize="small" /></ListItemIcon><ListItemText>New Division...</ListItemText></MenuItem>)}
                    </Select>
                </FormControl>
                <TextField autoFocus margin="dense" label="Project Name" type="text" fullWidth required variant="outlined" value={newProjectName} onChange={(e) => setNewProjectName(e.target.value)} disabled={isCreatingProject} />
            </DialogContent>
            <DialogActions sx={{ p: theme.spacing(2, 3) }}>
                <Button 
                    onClick={handleCloseCreateProjectModal} 
                    color="warning" 
                    variant="contained" 
                    disabled={isCreatingProject}
                >
                    Cancel
                </Button>
                <Button 
                    onClick={handleCreateProject} 
                    color="success" 
                    disabled={isCreatingProject || !newProjectName.trim() || !selectedDivisionIdForCreation} 
                    variant="contained"
                >
                    {isCreatingProject ? <CircularProgress size={24} color="inherit"/> : "Create"}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default CreateProjectModal;