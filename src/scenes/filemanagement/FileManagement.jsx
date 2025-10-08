import React from 'react';
import {
  Box, Snackbar, Alert, CircularProgress, Typography, useTheme, Button
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useFileManagement } from '../../hooks/useFileManagement';
import { tokens } from "../../theme";

// --- THIS IS THE CRUCIAL PART THAT WAS MISSING ---
// Import all the new presentational components that make up the page.
// The paths assume all these files are in the same 'filemanagement' folder.
import FileManagementToolbar from './FileManagementToolbar';
import FilesTable from './FilesTable';
import BulkActionsBar from './BulkActionsBar';
import FileUploadModal from './FileUploadModal';
import ReassignModal from './ReassignModal';
import ProjectSettingsModal from './ProjectSettingsModal';
import DivisionProjectSettingsModal from './DivisionProjectSettingsModal';
import CreateDivisionModal from './CreateDivisionModal';
import CreateProjectModal from './CreateProjectModal';
import ExportModal from './ExportModal';
// --- END OF CRUCIAL IMPORTS ---

const FileManagement = ({ isCollapsed }) => {
    const theme = useTheme();
    const colors = tokens(theme.palette.mode);
    const navigate = useNavigate();

    // All logic is now in this single hook call.
    const fileManagementProps = useFileManagement();
    
    // Destructure values needed for top-level render logic and passing down.
    const {
        isLoadingPermissions, userRole, userId, snackbar, handleSnackbarClose,
        openUploadModal, createProjectModalOpen, createDivisionModalOpen,
        reassignModalOpen, isProjectSettingsModalOpen, isDivisionProjectSettingsModalOpen,
        exportModalOpen,
    } = fileManagementProps;

    // --- STYLES ---
    const styles = {
        container: { display: "flex", minHeight: "100vh", bgcolor: colors.grey[800], transition: "margin 0.3s ease", padding: 0, overflowX: 'hidden' },
        content: { flex: 1, p: { xs: 1.5, sm: 2, md: 3 }, overflowY: 'auto', overflowX: 'hidden', maxWidth: '100%' },
        // ... other styles if needed ...
    };
    
    // --- RENDER LOGIC for loading and auth states ---
    if (isLoadingPermissions) {
        return (
            <Box sx={{ ...styles.container, justifyContent: "center", alignItems: "center", ml: 0, width: '100%' }}>
                <CircularProgress />
                <Typography sx={{ ml: 2, color: colors.grey[300] }}>Loading Permissions...</Typography>
            </Box>
        );
    }

    if (!userRole || !userId) {
        return (
            <Box sx={{ ...styles.container, justifyContent: "center", alignItems: "center", ml: 0, width: '100%' }}>
                <Alert severity={snackbar.severity || "error"} variant="filled" sx={{ maxWidth: '80%' }}>
                    {snackbar.message || "Authentication failed. Please log in."}
                </Alert>
                <Button variant="contained" onClick={() => navigate('/login')} sx={{ mt: 2 }}>Login</Button>
            </Box>
        );
    }

    // --- MAIN COMPONENT RENDER ---
    return (
        <Box sx={{ ...styles.container, marginLeft: { xs: '80px', sm: isCollapsed ? "80px" : "270px" } }}>
            <Box sx={styles.content}>
                
                <FileManagementToolbar colors={colors} theme={theme} {...fileManagementProps} />

                <BulkActionsBar colors={colors} theme={theme} {...fileManagementProps} />

                <FilesTable colors={colors} theme={theme} {...fileManagementProps} />
                
                {/* Modals are rendered here. Their open state is controlled by the hook. */}
                <FileUploadModal open={openUploadModal} colors={colors} theme={theme} {...fileManagementProps} />
                <ReassignModal open={reassignModalOpen} colors={colors} theme={theme} {...fileManagementProps} />
                <ProjectSettingsModal open={isProjectSettingsModalOpen} colors={colors} theme={theme} {...fileManagementProps} />
                <DivisionProjectSettingsModal open={isDivisionProjectSettingsModalOpen} colors={colors} theme={theme} {...fileManagementProps} />
                <CreateDivisionModal open={createDivisionModalOpen} colors={colors} theme={theme} {...fileManagementProps} />
                <CreateProjectModal open={createProjectModalOpen} colors={colors} theme={theme} {...fileManagementProps} />
                <ExportModal open={exportModalOpen} colors={colors} theme={theme} {...fileManagementProps} />
                

                <Snackbar
                    open={snackbar.open}
                    autoHideDuration={6000}
                    onClose={handleSnackbarClose}
                    anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
                >
                    <Alert onClose={handleSnackbarClose} severity={snackbar.severity} variant="filled" sx={{ width: "100%" }}>
                        {snackbar.message}
                    </Alert>
                </Snackbar>

            </Box>
        </Box>
    );
};

export default FileManagement;