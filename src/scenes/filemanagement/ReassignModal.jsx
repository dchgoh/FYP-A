import React from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button,
  TextField, FormControl, InputLabel, Select, MenuItem, CircularProgress
} from '@mui/material';

const ReassignModal = ({
    colors, theme, reassignModalOpen, handleCloseReassignModal, isReassigning,
    fileToReassign, newPlotNameForReassign, setNewPlotNameForReassign,
    selectedProjectIdForReassign, setSelectedProjectIdForReassign, loadingProjectsList,
    projectsList, handleReassignFile
}) => {
    
    const styles = {
        dialogPaper: { backgroundColor: colors.grey[800], color: colors.grey[100] },
        dialogTitle: { textAlign: "center", color: colors.grey[100], paddingBottom: 0, fontWeight: 'bold' },
        dialogContent: { display: "flex", flexDirection: "column", alignItems: "center", minWidth: { xs: '280px', sm: '350px' }, p: theme.spacing(2, 3) },
        dialogActions: { p: theme.spacing(2, 3), backgroundColor: colors.primary[700], borderTop: `1px solid ${colors.grey[700]}` },
        dialogTextField: { '& label.Mui-focused': { color: colors.blueAccent[300] }, '& .MuiOutlinedInput-root': { color: colors.grey[100] }, '& .MuiInputLabel-root': { color: colors.grey[300] } },
        dialogSelectControl: { mt: 1 },
    };

    return (
        <Dialog open={reassignModalOpen} onClose={handleCloseReassignModal} disableEscapeKeyDown={isReassigning} PaperProps={{ sx: styles.dialogPaper }}>
            <DialogTitle sx={styles.dialogTitle}>Edit Details for "{fileToReassign?.name}"</DialogTitle>
            <DialogContent sx={styles.dialogContent}>
                <TextField autoFocus margin="dense" label="Plot Name" type="text" fullWidth required variant="outlined" value={newPlotNameForReassign} onChange={(e) => setNewPlotNameForReassign(e.target.value)} disabled={isReassigning} sx={styles.dialogTextField} />
                <FormControl fullWidth variant="outlined" margin="dense" size="small" sx={styles.dialogSelectControl} disabled={isReassigning || loadingProjectsList}>
                    <InputLabel id="reassign-project-select-label">Project</InputLabel>
                    <Select labelId="reassign-project-select-label" value={selectedProjectIdForReassign} label="Project" onChange={(e) => setSelectedProjectIdForReassign(e.target.value)}>
                        <MenuItem value=""><em>Unassigned</em></MenuItem>
                        {loadingProjectsList ? <MenuItem disabled><CircularProgress size={20} sx={{mr: 1}}/> Loading...</MenuItem> : projectsList.map((p) => (<MenuItem key={p.id} value={p.id}>{p.name} ({p.division_name || 'No Div'})</MenuItem>))}
                    </Select>
                </FormControl>
            </DialogContent>
            <DialogActions sx={styles.dialogActions}>
                {/* --- MODIFIED CANCEL BUTTON --- */}
                <Button onClick={handleCloseReassignModal} color="warning" variant="contained" disabled={isReassigning}>Cancel</Button>
                {/* --- MODIFIED SAVE BUTTON --- */}
                <Button 
                    onClick={handleReassignFile} 
                    color="success" 
                    disabled={isReassigning || !newPlotNameForReassign.trim() || (selectedProjectIdForReassign === (fileToReassign?.project_id ?? '') && newPlotNameForReassign.trim() === (fileToReassign?.plot_name || ''))} 
                    variant="contained"
                >
                    {isReassigning ? <CircularProgress size={24} color="inherit"/> : "Save Changes"}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default ReassignModal;