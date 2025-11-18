import React from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Box, Typography,
  TextField, FormControlLabel, Switch, LinearProgress, FormControl, InputLabel,
  Select, MenuItem, ListItemIcon, ListItemText, CircularProgress
} from '@mui/material';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';

const FileUploadModal = ({
    colors, theme, openUploadModal, handleCloseUploadModal, isUploading,
    triggerFileInput, fileInputRef, handleFileChange, newFile, uploadProgress,
    plotName, setPlotName, skipSegmentation, setSkipSegmentation,
    selectedProjectId, setSelectedProjectId, loadingProjectsList, projectsList,
    userRole, ROLES, CREATE_NEW_PROJECT_VALUE, handleOpenCreateProjectModal,
    handleCancelUpload, handleFileUpload
}) => {
    
    const styles = {
        dialogPaper: { backgroundColor: colors.grey[800], color: colors.grey[100] },
        dialogTitle: { textAlign: "center", color: colors.grey[100], padding: 2, fontWeight: 'bold', backgroundColor: colors.primary[700], marginBottom: 1 },
        dialogContent: { display: "flex", flexDirection: "column", alignItems: "center", minWidth: { xs: '280px', sm: '350px' }, p: theme.spacing(2, 3) },
        dialogActions: { p: theme.spacing(2, 3), backgroundColor: colors.primary[700], borderTop: `1px solid ${colors.grey[700]}` },
        dialogTextField: { '& label.Mui-focused': { color: colors.blueAccent[300] }, '& .MuiOutlinedInput-root': { color: colors.grey[100] }, '& .MuiInputLabel-root': { color: colors.grey[300] } },
        dialogSelectControl: { mt: 1 },
        fileDisplay: { textAlign: "center", p: "15px", border: `1px dashed ${colors.grey[500]}`, borderRadius: "5px", width: '80%', wordBreak: 'break-word', color: colors.grey[100], backgroundColor: colors.grey[800], minHeight: '80px', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' },
        uploadProgressContainer: { width: '80%', mt: 2 },
    };

    return (
        <Dialog open={openUploadModal} onClose={handleCloseUploadModal} disableEscapeKeyDown={isUploading} PaperProps={{ sx: styles.dialogPaper }}>
            <DialogTitle sx={styles.dialogTitle}>Upload New File</DialogTitle>
            <DialogContent sx={styles.dialogContent}>
                <Button variant="contained" onClick={triggerFileInput} disabled={isUploading} sx={{ mb: 1, color: colors.grey[100],margin: 1, backgroundColor: 'rgb(40, 173, 226)', '&:hover': { backgroundColor: 'rgb(58, 168, 211)' }, '&.Mui-disabled': { backgroundColor: colors.grey[700], color: colors.grey[500] } }}>
                    Select File (.las/.laz)
                </Button>
                <input type="file" ref={fileInputRef} style={{ display: "none" }} onChange={handleFileChange} disabled={isUploading} accept=".las,.laz"/>
                <Box sx={styles.fileDisplay}>
                    {newFile ? (<><Typography>{newFile.name}</Typography><Typography variant="body2" sx={{ color: colors.grey[300], mt: 0.5 }}>{(newFile.size/1024/1024).toFixed(2)} MB</Typography></>) : <Typography sx={{ color: colors.grey[400] }}>No file selected</Typography>}
                </Box>
                {isUploading && uploadProgress !== null && ( <Box sx={styles.uploadProgressContainer}><LinearProgress variant="determinate" value={uploadProgress} /><Typography variant="caption" display="block" sx={{ textAlign: 'center', mt: 0.5 }}>{uploadProgress}%</Typography></Box> )}
                <TextField label="Plot Name (Required)" value={plotName} onChange={(e) => setPlotName(e.target.value)} fullWidth variant="outlined" margin="dense" sx={styles.dialogTextField} />
                <FormControl fullWidth margin="dense" sx={styles.dialogSelectControl} disabled={isUploading}>
                    <InputLabel id="project-select-label-upload">Assign to Project (Required)</InputLabel>
                    <Select labelId="project-select-label-upload" value={selectedProjectId} onChange={(e) => { e.target.value === CREATE_NEW_PROJECT_VALUE ? handleOpenCreateProjectModal() : setSelectedProjectId(e.target.value); }} label="Assign to Project (Required)">
                        <MenuItem value=""><em>-- Select a Project --</em></MenuItem>
                        {loadingProjectsList ? <MenuItem disabled><CircularProgress size={20} sx={{mr: 1}}/> Loading...</MenuItem> : projectsList.map((proj) => (<MenuItem key={proj.id} value={proj.id}>{proj.name} ({proj.division_name || 'No Div'})</MenuItem>))}
                        {userRole === ROLES.ADMIN && (<MenuItem value={CREATE_NEW_PROJECT_VALUE} sx={{ fontStyle: 'italic', color: colors.greenAccent[400] }}><ListItemIcon sx={{ minWidth: '32px', color: 'inherit' }}><AddCircleOutlineIcon fontSize="small" /></ListItemIcon><ListItemText>New Project...</ListItemText></MenuItem>)}
                    </Select>
                </FormControl>
                <FormControlLabel control={<Switch checked={skipSegmentation} onChange={(e) => setSkipSegmentation(e.target.checked)} disabled={isUploading} />} label="Skip Tree Segmentation" sx={{ mt: 1, color: colors.grey[300] }} />
            </DialogContent>
            <DialogActions sx={styles.dialogActions}>
                {/* --- MODIFIED LINES --- */}
                {isUploading ? (<Button onClick={handleCancelUpload} variant="contained" color="warning">Cancel Upload</Button>)
                : (<Button onClick={handleCloseUploadModal} variant="contained" color="warning">Cancel</Button>)}
                <Button onClick={handleFileUpload} disabled={isUploading || !newFile || !selectedProjectId || !plotName.trim()} variant="contained" sx={{ backgroundColor: colors.greenAccent[500], color: colors.grey[100], '&:hover': { backgroundColor: colors.greenAccent[400] }, '&.Mui-disabled': { backgroundColor: colors.grey[600], color: colors.grey[400] } }}>
                    {isUploading ? <CircularProgress size={24} color="inherit"/> : "Upload"}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default FileUploadModal;