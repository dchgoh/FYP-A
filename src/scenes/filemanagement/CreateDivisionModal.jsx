import React from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField, CircularProgress } from '@mui/material';

const CreateDivisionModal = ({
    colors, theme, createDivisionModalOpen, handleCloseCreateDivisionModal,
    isCreatingDivision, newDivisionName, setNewDivisionName, handleCreateDivision
}) => {
    return (
        <Dialog open={createDivisionModalOpen} onClose={handleCloseCreateDivisionModal} disableEscapeKeyDown={isCreatingDivision} PaperProps={{ sx: { backgroundColor: colors.grey[800] } }}>
            <DialogTitle sx={{ textAlign: "center", fontWeight: 'bold' }}>Create New Division</DialogTitle>
            <DialogContent><TextField autoFocus margin="dense" label="Division Name" type="text" fullWidth variant="outlined" value={newDivisionName} onChange={(e) => setNewDivisionName(e.target.value)} disabled={isCreatingDivision} required /></DialogContent>
            <DialogActions sx={{ p: theme.spacing(2, 3) }}><Button onClick={handleCloseCreateDivisionModal} color="error" disabled={isCreatingDivision}>Cancel</Button><Button onClick={handleCreateDivision} color="primary" disabled={isCreatingDivision || !newDivisionName.trim()} variant="contained">{isCreatingDivision ? <CircularProgress size={24} color="inherit"/> : "Create"}</Button></DialogActions>
        </Dialog>
    );
};

export default CreateDivisionModal;