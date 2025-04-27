import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  Box, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Paper, Typography, useTheme, IconButton, Menu, MenuItem, Button, Dialog,
  DialogTitle, DialogContent, DialogActions, Snackbar, Alert, CircularProgress,
  LinearProgress, ListItemIcon, ListItemText, Select, FormControl, InputLabel,
  TextField, Grid, Accordion, AccordionSummary, AccordionDetails, List, ListItem,
  Divider, Chip, Tooltip
} from "@mui/material";
// Icons
import VisibilityIcon from '@mui/icons-material/Visibility';
import TransformIcon from '@mui/icons-material/Transform';
import DownloadIcon from '@mui/icons-material/Download';
import DeleteIcon from '@mui/icons-material/Delete';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import AssignmentIcon from '@mui/icons-material/Assignment';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
import CloseIcon from '@mui/icons-material/Close';
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings';
import SettingsIcon from '@mui/icons-material/Settings';

// --- CONSTANTS ---
import { tokens } from "../../theme";
import { useNavigate } from "react-router-dom";
import axios from 'axios';
import { jwtDecode } from 'jwt-decode';

const API_BASE_URL = "http://localhost:5000/api";
const ROLES = {
  ADMIN: 'Administrator',
  DATA_MANAGER: 'Data Manager',
  REGULAR: 'Regular',
};

// --- COMPONENT DEFINITION ---
const FileManagement = ({ isCollapsed }) => {

  // --- HOOKS ---
  const theme = useTheme();
  const colors = tokens(theme.palette.mode);
  const navigate = useNavigate();
  const fileInputRef = useRef(null);

  // State Management
  const [files, setFiles] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [anchorEl, setAnchorEl] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [openUploadModal, setOpenUploadModal] = useState(false);
  const [newFile, setNewFile] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [convertingFileId, setConvertingFileId] = useState(null);
  const [filterProjectId, setFilterProjectId] = useState('all');
  const [filterDivisionId, setFilterDivisionId] = useState('all');
  const [assignProjectModalOpen, setAssignProjectModalOpen] = useState(false);
  const [fileToAssignProject, setFileToAssignProject] = useState(null);
  const [selectedProjectIdForAssignment, setSelectedProjectIdForAssignment] = useState('');
  const [isAssigningProject, setIsAssigningProject] = useState(false);
  const [createProjectModalOpen, setCreateProjectModalOpen] = useState(false);
  const [createDivisionModalOpen, setCreateDivisionModalOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newDivisionName, setNewDivisionName] = useState('');
  const [isCreatingDivision, setIsCreatingDivision] = useState(false);
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [userRole, setUserRole] = useState(null);
  const [userId, setUserId] = useState(null);
  const [assignedProjectIdsForDM, setAssignedProjectIdsForDM] = useState([]);
  const [isLoadingPermissions, setIsLoadingPermissions] = useState(true);
  const [isProjectSettingsModalOpen, setIsProjectSettingsModalOpen] = useState(false);
  const [divisionsList, setDivisionsList] = useState([]);
  const [projectsList, setProjectsList] = useState([]);
  const [allDataManagers, setAllDataManagers] = useState([]);
  const [assignmentsInModal, setAssignmentsInModal] = useState({});
  const [selectedManagerToAddInModal, setSelectedManagerToAddInModal] = useState({});
  const [loadingDivisionsList, setLoadingDivisionsList] = useState(false);
  const [loadingProjectsList, setLoadingProjectsList] = useState(false);
  const [loadingModalDMs, setLoadingModalDMs] = useState(false);
  const [loadingAssignmentsForProjectId, setLoadingAssignmentsForProjectId] = useState(null);
  const [processingAssignmentInModal, setProcessingAssignmentInModal] = useState(null);
  const [snackbarOpen, setSnackbarOpen] = useState(false);
  const [snackbarMessage, setSnackbarMessage] = useState("");
  const [snackbarSeverity, setSnackbarSeverity] = useState("success");
  const [deletingProjectId, setDeletingProjectId] = useState(null);
  const [plotName, setPlotName] = useState('');
  const [selectedDivisionId, setSelectedDivisionId] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [isDivisionProjectSettingsModalOpen, setIsDivisionProjectSettingsModalOpen] = useState(false);
  const [deletingDivisionId, setDeletingDivisionId] = useState(null); // State for division deletion


  // --- UTILITY FUNCTIONS ---
  const showSnackbar = useCallback((message, severity = "success") => {
    setSnackbarMessage(message);
    setSnackbarSeverity(severity);
    setSnackbarOpen(true);
  }, []); // <-- Add useCallback with empty dependency array

  const handleSnackbarClose = (event, reason) => {
    if (reason === "clickaway") return;
    setSnackbarOpen(false);
  };

  // --- PERMISSION CHECK FUNCTION ---
  const canPerformAction = useCallback((action, file = null) => {
    if (isLoadingPermissions || !userRole) return false;

    const requiresFileContext = ['download', 'delete', 'convert', 'assignProject', 'view'];
    if (requiresFileContext.includes(action) && !file) {
         if (action !== 'upload' && action !== 'manageAssignments') {
             console.warn(`canPerformAction denied - missing file object for action: ${action}`);
            return false;
         }
     }

    if (userRole === ROLES.ADMIN) {
        return action !== 'manageAssignments';
    }

    if (userRole === ROLES.DATA_MANAGER) {
        switch (action) {
            case 'upload':
            case 'view':
            case 'download':
            case 'convert':
                return true;
            case 'assignProject':
                return file?.project_id === null || assignedProjectIdsForDM.includes(file?.project_id);
            case 'delete':
                return file?.project_id !== null && assignedProjectIdsForDM.includes(file.project_id);
            case 'manageAssignments':
            case 'createProject':
                return false;
            default:
                return false;
        }
    }

    if (userRole === ROLES.REGULAR) {
        return ['view', 'convert'].includes(action);
    }

    return false;
  }, [isLoadingPermissions, userRole, assignedProjectIdsForDM]);

  // --- FETCH FUNCTIONS ---
  const fetchDivisionsList = useCallback(async (token) => {
    if (!token) return;
    setLoadingDivisionsList(true);
    try {
        const response = await axios.get(`${API_BASE_URL}/divisions`, { headers: { 'Authorization': `Bearer ${token}` } });
        setDivisionsList(response.data || []);
    } catch (error) {
        console.error("Err fetch divisions list:", error);
        showSnackbar("Failed load divisions.", "error");
        setDivisionsList([]);
    } finally {
        setLoadingDivisionsList(false);
    }
}, [/* showSnackbar is stable, removed for brevity */]);

  const fetchProjectsList = useCallback(async (token) => {
      if (!token) return;
      setLoadingProjectsList(true);
      try {
          const response = await axios.get(`${API_BASE_URL}/projects`, { headers: { 'Authorization': `Bearer ${token}` } });
          setProjectsList(response.data || []);
      } catch (error) {
          console.error("Err fetch projects list:", error);
          showSnackbar("Failed load projects.", "error");
          setProjectsList([]);
      } finally {
          setLoadingProjectsList(false);
      }
  }, [/* showSnackbar is stable, removed for brevity */]);

  const fetchFiles = useCallback(async (
    projectIdToFilter = filterProjectId,  // Gets current project filter state by default
    divisionIdToFilter = filterDivisionId // <-- ADDED: Gets current division filter state by default
  ) => {
      // Check permissions and authentication token first
      if (isLoadingPermissions || !userRole) {
          setFiles([]); // Clear files if not authorized
          setIsLoading(false);
          return;
      }
      setIsLoading(true); // Set loading state for the table
      const token = localStorage.getItem('authToken');
      if (!token) {
          showSnackbar("Authentication required to fetch files.", "error");
          setIsLoading(false);
          return;
      }

      try {
          // --- MODIFIED: Prepare parameters for the API request ---
          const params = {}; // Create an empty object to hold query parameters

          // Add projectId to params ONLY if it's selected (not 'all')
          if (projectIdToFilter && projectIdToFilter !== 'all') {
              params.projectId = projectIdToFilter;
          }

          // Add divisionId to params ONLY if it's selected (not 'all')
          if (divisionIdToFilter && divisionIdToFilter !== 'all') {
              params.divisionId = divisionIdToFilter; // <-- ADDED: Include divisionId parameter
          }
          // --- End Parameter Modification ---

          // Make the API call to fetch files, passing the params object
          const res = await axios.get(`${API_BASE_URL}/files`, {
              headers: { 'Authorization': `Bearer ${token}` },
              params: params // <-- MODIFIED: Send the potentially populated params object
          });

          // Process the response data
          const filesData = Array.isArray(res.data) ? res.data : []; // Ensure data is an array

          // Format the file data for display in the table
          const formatted = filesData.map(f => ({
              ...f, // Spread existing file properties
              // Calculate size in MB or show 'N/A'
              size: f.size_bytes ? (f.size_bytes / 1024 / 1024).toFixed(2) + ' MB' : 'N/A',
              // Format upload date or show 'N/A'
              uploadDate: f.upload_date ? new Date(f.upload_date).toLocaleDateString() : 'N/A',
              // Include potreeUrl if available
              potreeUrl: f.potreeUrl || null,
              // Include projectName, default to "Unassigned"
              projectName: f.projectName || "Unassigned",
              // <-- ADDED: Include divisionName, default to "N/A" (Ensure backend provides this!)
              divisionName: f.divisionName || "N/A"
          }));

          // Update the component's state with the formatted files
          setFiles(formatted);

      } catch (e) {
          // Handle errors during the fetch operation
          console.error("Error fetching files:", e);
          // Avoid showing snackbar for auth errors (handled elsewhere), show for others
          if (!(e.response?.status === 401 || e.response?.status === 403)) {
              showSnackbar("Failed to load files.", "error");
          }
          setFiles([]); // Clear files on error
      } finally {
          // Ensure loading state is turned off regardless of success or error
          setIsLoading(false);
      }
  }, [
      // Dependencies for useCallback: Re-create function if these change
      filterProjectId,    // State variable for project filter
      filterDivisionId,   // <-- ADDED: State variable for division filter
      isLoadingPermissions, // State variable for permission loading status
      userRole,           // State variable for user's role
      showSnackbar        // Include if showSnackbar is defined outside useCallback and might change (usually stable)
      // Note: API_BASE_URL is a constant, doesn't need to be listed
  ]); // <-- Dependency array updated

  const fetchAllDataManagersForModal = useCallback(async (token) => {
      if (!token) return;
      setLoadingModalDMs(true);
      try {
          const res = await axios.get(`${API_BASE_URL}/users`, { headers: { 'Authorization': `Bearer ${token}` } });
          setAllDataManagers((res.data || []).filter(u => u.role === ROLES.DATA_MANAGER));
      } catch (e) {
          console.error("Err fetch DMs:", e);
          showSnackbar("Failed load DMs.", "error");
      } finally {
          setLoadingModalDMs(false);
      }
  }, [/* showSnackbar */]);

  const fetchAssignmentsForModal = useCallback(async (projectId, token) => {
      if (!token || !projectId) return;
      setLoadingAssignmentsForProjectId(projectId);
      try {
          const res = await axios.get(`${API_BASE_URL}/projects/${projectId}/datamanagers`, { headers: { 'Authorization': `Bearer ${token}` } });
          setAssignmentsInModal(prev => ({ ...prev, [projectId]: res.data || [] }));
      } catch (e) {
          console.error(`Err fetch assigns P${projectId}:`, e);
          showSnackbar(`Failed load assigns P${projectId}.`, "error");
          setAssignmentsInModal(prev => ({ ...prev, [projectId]: [] }));
      } finally {
          setLoadingAssignmentsForProjectId(curr => curr === projectId ? null : curr);
      }
  }, [/* showSnackbar */]);

  // --- EFFECTS ---
  // Fetch User Info and Permissions on Mount
  useEffect(() => {
    const fetchUserAndPermissions = async () => {
      setIsLoadingPermissions(true);
      const token = localStorage.getItem('authToken');
      if (!token) {
        setUserRole(null); setUserId(null); setAssignedProjectIdsForDM([]); setIsLoadingPermissions(false); return;
      }
      try {
        const decodedToken = jwtDecode(token);
        if (!decodedToken.userId || !decodedToken.role || !Object.values(ROLES).includes(decodedToken.role)) throw new Error("Invalid token");
        const role = decodedToken.role; const uId = decodedToken.userId;
        setUserRole(role); setUserId(uId);

        await fetchDivisionsList(token);
        await fetchProjectsList(token); // Always fetch projects

        if (role === ROLES.DATA_MANAGER) {
          try {
            const res = await axios.get(`${API_BASE_URL}/users/me/projects`, { headers: { 'Authorization': `Bearer ${token}` } });
            setAssignedProjectIdsForDM(res.data?.assignedProjectIds || []);
          } catch (e) {
            console.error("Err fetch DM projects:", e); setAssignedProjectIdsForDM([]);
          }
        } else { setAssignedProjectIdsForDM([]); }

        if (role === ROLES.ADMIN) {
          await fetchAllDataManagersForModal(token);
        }

      } catch (error) {
        console.error("Err processing token/perms:", error);
        setSnackbarMessage("Session error. Log in."); setSnackbarSeverity("error");
        setUserRole(null); setUserId(null); setAssignedProjectIdsForDM([]);
        localStorage.removeItem('authToken');
      } finally {
        setIsLoadingPermissions(false);
      }
    };
    fetchUserAndPermissions();
  }, [fetchProjectsList, fetchAllDataManagersForModal]); // Added dependencies

  // Fetch Files when Permissions Loaded or Filters Change
  useEffect(() => {
      if (!isLoadingPermissions && userRole) {
          fetchFiles();
      } else {
          setFiles([]); // Clear files if not authenticated/authorized
      }
  }, [isLoadingPermissions, userRole, fetchFiles]); // Dependencies already include filterProjectId via fetchFiles

  // --- ACTION HANDLERS ---
  const handleMenuClick = (event, file) => { setAnchorEl(event.currentTarget); setSelectedFile(file); };
  const handleMenuClose = () => { setAnchorEl(null); /* Keep selectedFile for potential async actions */ };

  const handleDownload = async (fileToDownload) => {
    if (!canPerformAction('download', fileToDownload)) { showSnackbar("Permission denied.", "error"); handleMenuClose(); return; }
    if (!fileToDownload?.id) { showSnackbar("File info missing.", "error"); return; }
    handleMenuClose();
    const token = localStorage.getItem('authToken');
    if (!token) { showSnackbar("Auth required.", "error"); return; }
    const url = `${API_BASE_URL}/files/download/${fileToDownload.id}`;
    showSnackbar("Preparing download...", "info");
    try {
        const res = await axios.get(url, { headers: { 'Authorization': `Bearer ${token}` }, responseType: 'blob' });
        const dlUrl = window.URL.createObjectURL(new Blob([res.data]));
        const link = document.createElement('a');
        link.href = dlUrl;
        link.setAttribute('download', fileToDownload.name || 'downloaded-file');
        document.body.appendChild(link);
        link.click();
        link.parentNode.removeChild(link);
        window.URL.revokeObjectURL(dlUrl);
    } catch (e) {
        console.error("Download error:", e);
        let msg = "Download failed.";
        if (e.response?.data instanceof Blob) { try { const json = JSON.parse(await e.response.data.text()); msg = json.message || msg; } catch (_) { } }
        else { msg = e.response?.data?.message || msg; }
        showSnackbar(msg, "error");
    }
  };

  const handleRemove = async (fileToRemove) => {
    if (!canPerformAction('delete', fileToRemove)) { showSnackbar("Permission denied.", "error"); handleMenuClose(); return; }
    const fileId = fileToRemove?.id;
    if (!fileId) { handleMenuClose(); return; }
    handleMenuClose();
    const conf = window.confirm(`Delete "${fileToRemove.name}" and associated Potree data?`);
    if (!conf) return;
    const token = localStorage.getItem('authToken');
    if (!token) { showSnackbar("Auth required.", "error"); return; }
    try {
        const res = await axios.delete(`${API_BASE_URL}/files/${fileId}`, { headers: { 'Authorization': `Bearer ${token}` } });
        if (res.status === 200 || res.status === 204) {
            showSnackbar(`"${fileToRemove.name}" removed.`, "success");
            fetchFiles(); // Refresh file list
        } else { showSnackbar(res.data?.message || "Remove failed.", "warning"); }
    } catch (e) {
        console.error("Remove error:", e);
        showSnackbar(e.response?.data?.message || "Server error removing file.", "error");
    }
  };

  const handleConvertPotree = async (fileToConvert) => {
    if (!canPerformAction('convert', fileToConvert)) { showSnackbar("Permission denied.", "error"); handleMenuClose(); return; }
    const fileId = fileToConvert?.id;
    if (fileToConvert?.potreeUrl && fileToConvert.potreeUrl !== 'pending_refresh') { showSnackbar("Already converted.", "info"); handleMenuClose(); return; }
    if (!fileId || convertingFileId) { if (convertingFileId) showSnackbar("Conversion in progress.", "warning"); handleMenuClose(); return; }
    handleMenuClose();
    const token = localStorage.getItem('authToken');
    if (!token) { showSnackbar("Auth required.", "error"); return; }
    setConvertingFileId(fileId);
    showSnackbar(`Starting conversion: "${fileToConvert.name}"...`, "info");
    try {
        const res = await axios.get(`${API_BASE_URL}/files/potreeconverter/${fileId}`, { headers: { 'Authorization': `Bearer ${token}` } });
        if (res.data.success) {
            showSnackbar(`"${fileToConvert.name}" converted!`, "success");
            // Optimistic update first
            setFiles(cf => cf.map(f => f.id === fileId ? { ...f, potreeUrl: res.data.potreeUrl || 'pending_refresh' } : f));
            // Fetch updated list after a short delay to ensure server processed
            await new Promise(r => setTimeout(r, 500));
            fetchFiles();
        } else { showSnackbar(res.data.message || `Conversion failed: ${fileToConvert.name}.`, "error"); }
    } catch (e) {
        console.error("Conversion error:", e);
        showSnackbar(e.response?.data?.message || `Server error during conversion.`, "error");
    } finally {
        setConvertingFileId(null);
    }
  };

  const handleViewPotree = (fileToView) => {
    if (!canPerformAction('view', fileToView)) { showSnackbar("Permission denied.", "error"); handleMenuClose(); return; }
    const url = fileToView?.potreeUrl;
    if (!url || url === 'pending_refresh') { showSnackbar("Potree data not ready.", "warning"); return; }
    handleMenuClose();
    console.log(`Navigating to Potree: ${url}`);
    navigate(`/potree?url=${encodeURIComponent(url)}`);
  };

  const handleOpenUploadModal = () => {
    if (!canPerformAction('upload')) { showSnackbar("Permission denied.", "error"); return; }
    setOpenUploadModal(true);
    setNewFile(null);
    setUploadProgress(null);
    setIsUploading(false);
  };

  const handleCloseUploadModal = () => {
    if (isUploading) return; // Prevent closing during upload
    setOpenUploadModal(false);
    setNewFile(null);
    setUploadProgress(null);
    if (fileInputRef.current) fileInputRef.current.value = ''; // Reset file input
  };

  const handleFileChange = (e) => {
    if (e.target.files?.[0]) {
        setNewFile(e.target.files[0]);
        setUploadProgress(null); // Reset progress if a new file is selected
    }
  };

  const triggerFileInput = () => {
    fileInputRef.current?.click();
  };

  const handleFileUpload = async () => {
    if (!canPerformAction('upload')) { showSnackbar("Permission denied.", "error"); return; }
    if (!newFile) { showSnackbar("Please select a file.", "warning"); return; }
    const token = localStorage.getItem('authToken');
    if (!token) { showSnackbar("Auth required.", "error"); return; }
    const fd = new FormData();
    fd.append('file', newFile);
    fd.append('plot_name', plotName);
    fd.append('division_id', selectedDivisionId);
    fd.append('project_id', selectedProjectId);
    setIsUploading(true);
    setUploadProgress(0);
    try {
        const res = await axios.post(`${API_BASE_URL}/files/upload`, fd, {
            headers: {
                'Content-Type': 'multipart/form-data',
                'Authorization': `Bearer ${token}`
            },
            onUploadProgress: (pe) => {
                setUploadProgress(pe.total ? Math.round((pe.loaded * 100) / pe.total) : 0);
            }
        });
        if (res.data.success) {
            showSnackbar("File uploaded successfully!", "success");
            handleCloseUploadModal();
            fetchFiles(); // Refresh file list
        } else {
            showSnackbar(res.data.message || "File upload failed.", "error");
            setUploadProgress(null);
        }
    } catch (e) {
        console.error("Upload error:", e);
        showSnackbar(e.response?.data?.message || "Server error during upload.", "error");
        setUploadProgress(null);
    } finally {
        setIsUploading(false);
    }
  };

  const handleOpenAssignProjectModal = (file) => {
    if (!canPerformAction('assignProject', file)) { showSnackbar("Permission denied for this file's project.", "error"); handleMenuClose(); return; }
    if (!file) return;
    setFileToAssignProject(file);
    setSelectedProjectIdForAssignment(file.project_id ?? ''); // Set current assignment or empty for unassigned
    setAssignProjectModalOpen(true);
    handleMenuClose();
  };

  const handleCloseAssignProjectModal = () => {
    if (isAssigningProject) return;
    setAssignProjectModalOpen(false);
    // Delay reset to allow fade-out animation
    setTimeout(() => {
        setFileToAssignProject(null);
        setSelectedProjectIdForAssignment('');
    }, 200);
  };

  const handleAssignProject = async () => {
    if (!fileToAssignProject || !canPerformAction('assignProject', fileToAssignProject)) {
        showSnackbar("Permission denied.", "error"); return;
    }
    if (isAssigningProject) return;
    const token = localStorage.getItem('authToken');
    if (!token) { showSnackbar("Auth required.", "error"); return; }
    const pId = selectedProjectIdForAssignment === '' ? null : Number(selectedProjectIdForAssignment);
    // Prevent API call if assignment hasn't changed
    if (pId === fileToAssignProject.project_id) {
        showSnackbar("No change made.", "info");
        return;
    }
    setIsAssigningProject(true);
    try {
        const res = await axios.patch(`${API_BASE_URL}/files/${fileToAssignProject.id}`, { projectId: pId }, { headers: { 'Authorization': `Bearer ${token}` } });
        if (res.data.success && res.data.file) {
            const name = res.data.file.projectName || "Unassigned";
            showSnackbar(`File assigned to "${name}"!`, "success");
            handleCloseAssignProjectModal();
            fetchFiles(); // Refresh list
        } else { showSnackbar(res.data.message || "Assignment failed.", "error"); }
    } catch (e) {
        console.error("Assign project error:", e);
        showSnackbar(e.response?.data?.message || "Server error assigning project.", "error");
    } finally {
        setIsAssigningProject(false);
    }
  };

  const handleDeleteProject = async (projectId, projectName) => {
    // No specific 'deleteProject' in canPerformAction, check Admin role directly
    if (userRole !== ROLES.ADMIN) {
        showSnackbar("Permission denied.", "error");
        return;
    }
    if (deletingProjectId) {
        showSnackbar("Deletion already in progress.", "warning");
        return;
    }

    const confirmDelete = window.confirm(
        `Are you sure you want to delete project "${projectName}"?\n\n` +
        `This will:\n` +
        `- Permanently remove the project.\n` +
        `- Unassign all files currently in this project.\n` +
        `- Remove all Data Manager assignments for this project.`
    );

    if (!confirmDelete) {
        return;
    }

    const token = localStorage.getItem('authToken');
    if (!token) {
        showSnackbar("Authentication required.", "error");
        return;
    }

    setDeletingProjectId(projectId); // Set loading state for this specific project
    try {
        const response = await axios.delete(`${API_BASE_URL}/projects/${projectId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (response.data.success) {
            showSnackbar(`Project "${projectName}" deleted successfully.`, "success");
            // Refresh lists
            await fetchProjectsList(token); // Update the project list immediately
            // Clear assignments for the deleted project from modal state if present
            setAssignmentsInModal(prev => {
                const newState = {...prev};
                delete newState[projectId];
                return newState;
            });
            // Refresh the main file list (files might become unassigned)
            // Fetch with current filter or reset to 'all'? Resetting might be clearer UX.
            await fetchFiles('all'); // Fetch all to see unassigned files
            setFilterProjectId('all'); // Reset filter dropdown
        } else {
            showSnackbar(response.data.message || "Failed to delete project.", "error");
        }
    } catch (error) {
        console.error("Error deleting project:", error);
        showSnackbar(error.response?.data?.message || "Server error deleting project.", "error");
    } finally {
        setDeletingProjectId(null); // Clear loading state
    }
  };

  const handleProjectFilterChange = (event) => { // <-- RENAMED from handleFilterChange
    setFilterProjectId(event.target.value);
  };

  const handleDivisionFilterChange = (event) => { // <-- NEW Handler
    setFilterDivisionId(event.target.value);
  };

  const handleOpenCreateProjectModal = () => {
    if (!canPerformAction('createProject')) { showSnackbar("Permission denied.", "error"); return; }
    setNewProjectName('');
    setCreateProjectModalOpen(true);
  };

  const handleOpenCreateDivisionModal = () => {
    if (!canPerformAction('createDivision')) { showSnackbar("Permission denied.", "error"); return; }
    setNewDivisionName('');
    setCreateDivisionModalOpen(true);
  };

  const handleCloseCreateDivisionModal = () => {
    if (isCreatingDivision) return;
    setCreateDivisionModalOpen(false);
    setNewDivisionName('');
  };

  const handleCloseCreateProjectModal = () => {
    if (isCreatingProject) return;
    setCreateProjectModalOpen(false);
    setNewProjectName('');
  };

  const handleCreateDivision = async () => {
    if (!canPerformAction('createDivision')) { showSnackbar("Permission denied.", "error"); return; }
    if (!newDivisionName.trim() || isCreatingDivision) {
        if (!newDivisionName.trim()) showSnackbar("Division name required.", "warning");
        return;
    }
    const token = localStorage.getItem('authToken');
    if (!token) { showSnackbar("Auth required.", "error"); return; }
    setIsCreatingDivision(true);
    try {
        const res = await axios.post(`${API_BASE_URL}/divisions`, { name: newDivisionName.trim() }, { headers: { 'Authorization': `Bearer ${token}` } });
        if (res.data.success && res.data.division) {
            showSnackbar(`Division "${res.data.division.name}" created!`, "success");
            handleCloseCreateDivisionModal();
            await fetchDivisionsList(token); // Refresh division list
        } else { showSnackbar(res.data.message || "Create division failed.", "error"); }
    } catch (e) {
        console.error("Create division error:", e);
        const msg = e.response?.status === 409 ? `Division "${newDivisionName.trim()}" already exists.` : e.response?.data?.message || "Server error creating division.";
        showSnackbar(msg, "error");
    } finally {
        setIsCreatingDivision(false);
    }
  };

  const handleCreateProject = async () => {
    if (!canPerformAction('createProject')) { showSnackbar("Permission denied.", "error"); return; }
    if (!newProjectName.trim() || isCreatingProject) {
        if (!newProjectName.trim()) showSnackbar("Project name required.", "warning");
        return;
    }
    const token = localStorage.getItem('authToken');
    if (!token) { showSnackbar("Auth required.", "error"); return; }
    setIsCreatingProject(true);
    try {
        const res = await axios.post(`${API_BASE_URL}/projects`, { name: newProjectName.trim() }, { headers: { 'Authorization': `Bearer ${token}` } });
        if (res.data.success && res.data.project) {
            showSnackbar(`Project "${res.data.project.name}" created!`, "success");
            handleCloseCreateProjectModal();
            await fetchProjectsList(token); // Refresh project list
        } else { showSnackbar(res.data.message || "Create project failed.", "error"); }
    } catch (e) {
        console.error("Create project error:", e);
        const msg = e.response?.status === 409 ? `Project "${newProjectName.trim()}" already exists.` : e.response?.data?.message || "Server error creating project.";
        showSnackbar(msg, "error");
    } finally {
        setIsCreatingProject(false);
    }
  };

  const handleOpenDivisionProjectSettingsModal = () => {
     // Only Admins can open this modal
     if (userRole !== ROLES.ADMIN) {
         showSnackbar("Permission denied. Administrator role required.", "error");
         return;
     }
     setDeletingDivisionId(null); // Reset deletion states on open
     setDeletingProjectId(null);
     setIsDivisionProjectSettingsModalOpen(true);
     // Lists (divisions, projects) are already fetched on mount/login
 };

 const handleCloseDivisionProjectSettingsModal = () => {
     // Prevent closing if a deletion is actively in progress
     if (deletingDivisionId || deletingProjectId) {
         showSnackbar("Please wait for the current deletion to complete.", "warning");
         return;
     }
     setIsDivisionProjectSettingsModalOpen(false);
 };

 const handleDeleteDivision = async (divisionId, divisionName) => {
     // Double-check Admin role (though modal open should prevent non-admins)
     if (userRole !== ROLES.ADMIN) {
         showSnackbar("Permission denied.", "error");
         return;
     }
     // Prevent concurrent deletions
     if (deletingDivisionId || deletingProjectId) {
         showSnackbar("Another deletion is already in progress.", "warning");
         return;
     }

     const confirmDelete = window.confirm(
         `Are you sure you want to delete division "${divisionName}"?\n\n` +
         `This will:\n` +
         `- Permanently remove the division.\n` +
         `- Unassign all files currently belonging to this division (they will become unassigned).\n` +
         `NOTE: This does NOT delete associated projects or project assignments.`
     );

     if (!confirmDelete) {
         return;
     }

     const token = localStorage.getItem('authToken');
     if (!token) {
         showSnackbar("Authentication required.", "error");
         return;
     }

     setDeletingDivisionId(divisionId); // Set loading state for this division
     try {
         const response = await axios.delete(`${API_BASE_URL}/divisions/${divisionId}`, {
             headers: { 'Authorization': `Bearer ${token}` }
         });

         if (response.data.success) { // Check success flag or status code
             showSnackbar(`Division "${divisionName}" deleted successfully.`, "success");
             // Refresh lists
             await fetchDivisionsList(token); // Update the division list
             // Refresh the main file list (files might become unassigned)
             await fetchFiles('all', 'all'); // Fetch all files, regardless of previous filter
             setFilterDivisionId('all'); // Reset division filter dropdown
         } else {
             showSnackbar(response.data.message || "Failed to delete division.", "error");
         }
     } catch (error) {
         console.error("Error deleting division:", error);
         showSnackbar(error.response?.data?.message || "Server error deleting division.", "error");
     } finally {
         setDeletingDivisionId(null); // Clear loading state
     }
 };

  const handleOpenProjectSettingsModal = () => {
    setAssignmentsInModal({}); // Reset assignments state
    setLoadingAssignmentsForProjectId(null);
    setProcessingAssignmentInModal(null);
    setIsProjectSettingsModalOpen(true);
    // Fetching assignments will happen on accordion expand
  };

  const handleCloseProjectSettingsModal = () => {
    if (processingAssignmentInModal) return;
    setIsProjectSettingsModalOpen(false);
  };

  const handleModalAccordionChange = (projectId) => (e, isExpanded) => {
    const token = localStorage.getItem('authToken');
    // Fetch assignments only if expanding, not already loaded, not currently loading, and token exists
    if (isExpanded && !assignmentsInModal[projectId] && loadingAssignmentsForProjectId !== projectId && token) {
        fetchAssignmentsForModal(projectId, token);
    }
  };

  const handleSelectManagerChangeInModal = (projectId, e) => {
    setSelectedManagerToAddInModal(prev => ({ ...prev, [projectId]: e.target.value }));
  };

  const handleAssignManagerInModal = async (projectId) => {
    const userIdToAssign = selectedManagerToAddInModal[projectId];
    if (!userIdToAssign || processingAssignmentInModal) return;
    const token = localStorage.getItem('authToken');
    if (!token) { showSnackbar("Auth error.", "error"); return; }
    setProcessingAssignmentInModal({ type: 'assign', projectId, userId: userIdToAssign });
    try {
        await axios.post(`${API_BASE_URL}/projects/${projectId}/datamanagers`, { userId: userIdToAssign }, { headers: { 'Authorization': `Bearer ${token}` } });
        showSnackbar("Assigned.", "success");
        setSelectedManagerToAddInModal(prev => ({ ...prev, [projectId]: '' })); // Clear selection
        await fetchAssignmentsForModal(projectId, token); // Refresh assignments for this project
    } catch (e) {
        console.error("Err assign modal:", e);
        showSnackbar(e.response?.data?.message || "Assign fail.", "error");
    } finally {
        // Clear processing state only if it matches the current operation
        setProcessingAssignmentInModal(curr => (curr?.type === 'assign' && curr.projectId === projectId && curr.userId === userIdToAssign ? null : curr));
    }
  };

  const handleRemoveManagerInModal = async (projectId, userIdToRemove, username) => {
    if (processingAssignmentInModal) return;
    const conf = window.confirm(`Remove "${username}" from Project ${projectId}?`);
    if (!conf) return;
    const token = localStorage.getItem('authToken');
    if (!token) { showSnackbar("Auth error.", "error"); return; }
    setProcessingAssignmentInModal({ type: 'remove', projectId, userId: userIdToRemove });
    try {
        await axios.delete(`${API_BASE_URL}/projects/${projectId}/datamanagers/${userIdToRemove}`, { headers: { 'Authorization': `Bearer ${token}` } });
        showSnackbar("Manager removed.", "success");
        await fetchAssignmentsForModal(projectId, token); // Refresh assignments
    } catch (e) {
        console.error("Err remove modal:", e);
        showSnackbar(e.response?.data?.message || "Removal failed.", "error");
    } finally {
        setProcessingAssignmentInModal(curr => (curr?.type === 'remove' && curr.projectId === projectId && curr.userId === userIdToRemove ? null : curr));
    }
  };

  const getUnassignedManagersForModalProject = (projectId) => {
    const assignedIds = (assignmentsInModal[projectId] || []).map(m => m.id);
    return allDataManagers.filter(dm => !assignedIds.includes(dm.id));
  };

  // --- STYLES ---
  // (Keep the exact styles object as provided)
  const styles = {
    // --- Page Layout ---
    container: {
      display: "flex",
      minHeight: "100vh",
      bgcolor: colors.grey[800],
      marginLeft: isCollapsed ? "80px" : "270px",
      transition: "margin 0.3s ease",
      padding: 0
    },
    content: {
      flex: 1,
      p: 3,
      overflowY: 'auto'
    },

    // --- Top Controls Row ---
    controlsRow: {
      marginBottom: theme.spacing(3)
    },
    filterFormControl: {
      minWidth: 180,
      '& .MuiInputLabel-root': { color: colors.grey[300], '&.Mui-focused': { color: colors.blueAccent[300] } },
      '& .MuiOutlinedInput-root': {
        color: colors.grey[100],
        '& .MuiOutlinedInput-notchedOutline': { borderColor: colors.grey[500] },
        '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: colors.primary[300] },
        '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: colors.blueAccent[400] },
        '& .MuiSelect-icon': { color: colors.grey[300] },
      }
    },

    // --- General Dialog Styles ---
    dialogPaper: {
      backgroundColor: colors.grey[800] || theme.palette.background.paper,
      color: colors.grey[100] || theme.palette.text.primary
    },
    dialogActions: {
      padding: theme.spacing(2, 3),
      backgroundColor: colors.primary[700] || theme.palette.action.hover,
      borderTop: `1px solid ${colors.grey[700] || theme.palette.divider}`
    },
    dialogSelectControl: { // Used in Assign Project Dialog
      marginTop: theme.spacing(1),
      '& .MuiInputLabel-root': { color: colors.grey[300], '&.Mui-focused': { color: colors.blueAccent[300] } },
      '& .MuiOutlinedInput-root': {
        color: colors.grey[100],
        '& .MuiOutlinedInput-notchedOutline': { borderColor: colors.grey[500] },
        '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: colors.primary[300] },
        '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: colors.blueAccent[400] },
        '& .MuiSelect-icon': { color: colors.grey[300] },
      }
    },
    dialogTextField: { // Used in Create Project Dialog
      '& label.Mui-focused': { color: colors.blueAccent[300] },
      '& .MuiOutlinedInput-root': {
        color: colors.grey[100],
        '& fieldset': { borderColor: colors.grey[500] },
        '&:hover fieldset': { borderColor: colors.primary[300] },
        '&.Mui-focused fieldset': { borderColor: colors.blueAccent[400] },
      },
      '& .MuiInputLabel-root': { color: colors.grey[300] },
    },
    dialogTitle: {
      textAlign: "center",
      color: colors.grey?.[100] ?? "#000",
      paddingBottom: 0,
      fontWeight: 'bold'
    },
    dialogContent: {
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      minWidth: '350px',
      paddingTop: theme.spacing(2),
      paddingBottom: theme.spacing(1),
      color: colors.grey?.[100] ?? "#000"
    },

    // --- Upload Dialog Specific ---
    fileDisplay: {
      textAlign: "center",
      marginTop: "20px",
      padding: "15px",
      border: `1px dashed ${colors.grey?.[500] ?? "#888"}`,
      borderRadius: "5px",
      width: '80%',
      wordBreak: 'break-word',
      color: colors.grey?.[100] ?? "#000",
      backgroundColor: colors.grey[800],
      minHeight: '80px',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'center'
    },
    uploadProgressContainer: {
      width: '80%',
      marginTop: theme.spacing(2)
    },

    // --- File Table Styles ---
    tableContainer: {
      marginTop: theme.spacing(3),
      backgroundColor: colors.grey[900],
      borderRadius: 2,
      maxHeight: 'calc(100vh - 250px)',
      overflow: 'auto',
      position: 'relative',
      "&::-webkit-scrollbar": { width: "8px" },
      "&::-webkit-scrollbar-track": { background: colors.grey?.[700] },
      "&::-webkit-scrollbar-thumb": {
        backgroundColor: colors.grey?.[500] ?? "#888",
        borderRadius: "10px",
        border: `2px solid ${colors.grey?.[700] ?? "#3e4396"}`,
        "&:hover": { backgroundColor: colors.primary?.[300] ?? "#555" },
      }
    },
    table: {
      minWidth: 650,
      width: '100%',
      tableLayout: 'fixed'
    },
    tableHead: {
      backgroundColor: colors.primary[700],
      position: 'sticky',
      top: 0,
      zIndex: 1
    },
    headCell: {
      color: colors.grey?.[100] ?? "white",
      fontWeight: "bold",
      whiteSpace: 'nowrap',
      borderBottom: `1px solid ${colors.grey[700]}`
    },
    bodyCell: {
      color: colors.grey?.[100] ?? "white",
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      borderBottom: `1px solid ${colors.grey[800]}`
    },
    actionButton: { // Button within table cell for actions menu
      color: colors.grey?.[300] ?? '#cccccc',
      padding: '4px',
      '&:hover': {
        color: colors.blueAccent?.[400] ?? '#4ba5f8',
        backgroundColor: 'rgba(0, 123, 255, 0.1)',
      },
      '&.Mui-disabled': {
        color: colors.grey?.[600] ?? '#777777',
      }
    },
    statusText: { // Potree status text/icon container
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '4px'
    },

    // --- Action Menu Item Styles ---
    menuItemIcon: {
      minWidth: '36px',
      color: 'inherit'
    },
    menuItemDisabledText: {
      color: `${colors.grey[600]} !important`,
      '.MuiListItemIcon-root': {
        color: `${colors.grey[600]} !important`,
      }
    },

    // --- Loading Overlay ---
    loadingOverlay: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      zIndex: 2,
      borderRadius: 'inherit' // Inherit border radius from parent (table container)
    },

    // --- Project Settings (Assignments) Modal Styles ---
    modalDialogPaper: { // Different background for this modal
      backgroundColor: colors.grey[800],
      color: colors.grey[100],
      minWidth: '600px',
      maxWidth: '800px'
    },
    modalDialogContent: {
      padding: theme.spacing(0, 3, 2, 3),
      maxHeight: '70vh',
      overflowY: 'auto'
    },
    modalDialogActions: {
      padding: theme.spacing(1, 3),
      backgroundColor: colors.primary[700], // Slightly different from regular dialog actions
      borderTop: `1px solid ${colors.grey[700]}`
    },
    modalAccordion: {
      backgroundColor: colors.grey[800],
      color: colors.grey[100],
      mb: 1,
      '&.Mui-expanded': { margin: '8px 0' }
    },
    modalAccordionDetails: {
      backgroundColor: colors.grey[800], // Match action bar
      p: 2
    },
    modalListItemIcon: { // Used for remove button in assignments modal
      color: colors.redAccent[400],
      minWidth: 'auto',
      '&:hover': {
        backgroundColor: 'rgba(255, 0, 0, 0.1)',
      }
    },
    settingsModalDeleteButton: {
      color: colors.redAccent[400], // Use red color
      marginLeft: 'auto', // Push it to the right
      padding: '4px',
      '&:hover': {
        backgroundColor: 'rgba(255, 0, 0, 0.1)', // Reddish hover
      },
       '&.Mui-disabled': {
          color: colors.grey[600], // Disabled color
       }
    },
  };

  // --- RENDER LOGIC ---
  // Loading State
  if (isLoadingPermissions) {
    return (
      <Box sx={{ ...styles.container, justifyContent: "center", alignItems: "center", ml: 0 }}>
        <CircularProgress />
        <Typography sx={{ ml: 2, color: colors.grey[300] }}>Loading Auth...</Typography>
      </Box>
    );
  }

  // Authentication Failed State
  if (!userRole || !userId) {
    return (
      <Box sx={{ ...styles.container, justifyContent: "center", alignItems: "center", ml: 0 }}>
        <Alert severity={snackbarSeverity || "error"} variant="filled" sx={{ maxWidth: '80%' }}>
          {snackbarMessage || "Auth failed."}
        </Alert>
        <Button variant="contained" onClick={() => navigate('/login')} sx={{ mt: 2 }}>Login</Button>
      </Box>
    );
  }

  // Main Component Render
  return (
    <Box sx={styles.container}> {/* Adjusted to use original key */}
      <Box sx={styles.content}> {/* Adjusted to use original key */}
        {/* --- Controls Row --- */}
        <Grid container spacing={2} sx={styles.controlsRow} alignItems="center" justifyContent="space-between">
          <Grid item>
            {canPerformAction('upload') && (
              <Button
                variant="contained"
                startIcon={<UploadFileIcon />}
                sx={{ backgroundColor: colors.primary[700], color: "white", "&:hover": { backgroundColor: colors.primary[400] }, textTransform: 'none' }}
                onClick={handleOpenUploadModal}
                disabled={isUploading || isLoading || loadingProjectsList || !!convertingFileId || !!deletingProjectId} // Added deletingProjectId check
              >
                Upload File
              </Button>
            )}
          </Grid>
          <Grid item container xs spacing={2} justifyContent="flex-end" alignItems="center">
          {userRole === ROLES.ADMIN && (
                <Grid item>
                    <Tooltip title="Manage Division and Project">
                        <Button
                            variant="outlined"
                            startIcon={<SettingsIcon />}
                            sx={{ borderColor: colors.blueAccent[500], color: colors.blueAccent[400], '&:hover': { borderColor: colors.blueAccent[300], backgroundColor: 'rgba(75, 165, 248, 0.1)' }, textTransform: 'none' }}
                            onClick={handleOpenDivisionProjectSettingsModal}
                            disabled={loadingProjectsList || loadingModalDMs || isLoading || !!deletingProjectId} // Added deletingProjectId check
                        >
                            Manage Division & Project
                        </Button>
                    </Tooltip>
                </Grid>
             )}
             {userRole === ROLES.ADMIN && (
                <Grid item>
                    <Tooltip title="Manage Assignments">
                        <Button
                            variant="outlined"
                            startIcon={<SettingsIcon />}
                            sx={{ borderColor: colors.blueAccent[500], color: colors.blueAccent[400], '&:hover': { borderColor: colors.blueAccent[300], backgroundColor: 'rgba(75, 165, 248, 0.1)' }, textTransform: 'none' }}
                            onClick={handleOpenProjectSettingsModal}
                            disabled={loadingProjectsList || loadingModalDMs || isLoading || !!deletingProjectId} // Added deletingProjectId check
                        >
                            Assignments
                        </Button>
                    </Tooltip>
                </Grid>
             )}
             <Grid item xs={12} sm="auto">
                <FormControl fullWidth variant="outlined" size="small" sx={styles.filterFormControl}>
                    <InputLabel id="division-filter-label">Filter Division</InputLabel>
                    <Select
                        labelId="division-filter-label"
                        id="division-filter-select"
                        value={filterDivisionId}
                        label="Filter Division"
                        onChange={handleDivisionFilterChange}
                        disabled={isLoading || loadingDivisionsList || !!convertingFileId || !!deletingProjectId} // Added deletingProjectId check
                        MenuProps={{ PaperProps: { sx: { backgroundColor: colors.primary[600], color: colors.grey[100], '& .MuiMenuItem-root:hover': { backgroundColor: colors.primary[500] }, '& .MuiMenuItem-root.Mui-selected': { backgroundColor: colors.blueAccent[700]+'!important', color:colors.grey[100] }}} }}
                    >
                        <MenuItem value="all"><em>All Division</em></MenuItem>
                        {divisionsList.map(p=>(<MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>))}
                    </Select>
                </FormControl>
             </Grid>
             <Grid item xs={12} sm="auto">
                <FormControl fullWidth variant="outlined" size="small" sx={styles.filterFormControl}>
                    <InputLabel id="project-filter-label">Filter Project</InputLabel>
                    <Select
                        labelId="project-filter-label"
                        id="project-filter-select"
                        value={filterProjectId}
                        label="Filter Project"
                        onChange={handleProjectFilterChange}
                        disabled={isLoading || loadingProjectsList || !!convertingFileId || !!deletingProjectId} // Added deletingProjectId check
                        MenuProps={{ PaperProps: { sx: { backgroundColor: colors.primary[600], color: colors.grey[100], '& .MuiMenuItem-root:hover': { backgroundColor: colors.primary[500] }, '& .MuiMenuItem-root.Mui-selected': { backgroundColor: colors.blueAccent[700]+'!important', color:colors.grey[100] }}} }}
                    >
                        <MenuItem value="all"><em>All Project</em></MenuItem>
                        {projectsList.map(p=>(<MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>))}
                    </Select>
                </FormControl>
             </Grid>
          </Grid>
        </Grid>

        {/* --- Dialogs --- */}
        {/* Upload Dialog */}
        <Dialog open={openUploadModal} onClose={handleCloseUploadModal} disableEscapeKeyDown={isUploading} PaperProps={{ sx: styles.dialogPaper }}>
            <DialogTitle sx={styles.dialogTitle}>Upload New File</DialogTitle>
            <DialogContent sx={styles.dialogContent}>
                <Button variant="outlined" onClick={triggerFileInput} disabled={isUploading} sx={{ mb: 2, borderColor: colors.grey[500], color: colors.grey[100], '&:hover': {borderColor: colors.blueAccent[300]} }}>Select File (.las/.laz)</Button>
                <TextField
                  label="Plot Name"
                  value={plotName}
                  onChange={(e) => setPlotName(e.target.value)}
                  fullWidth
                  variant="outlined"
                  margin="dense"
                  sx={styles.dialogTextField}
                />
                {/* Select Existing Division */}
                <FormControl fullWidth margin="dense" sx={styles.dialogSelectControl}>
                  <InputLabel id="division-select-label">Division</InputLabel>
                  <Select
                    labelId="division-select-label"
                    value={selectedDivisionId}
                    onChange={(e) => setSelectedDivisionId(e.target.value)}
                    label="Division"
                  >
                    {divisionsList.length > 0 ? (
                      divisionsList.map((proj) => (
                        <MenuItem key={proj.id} value={proj.id}>
                          {proj.name}
                        </MenuItem>
                      ))
                    ) : (
                      <MenuItem value="" disabled>
                        No division available. Please create one.
                      </MenuItem>
                    )}
                  </Select>
                </FormControl>

                {/* Button to Create New Division */}
                {canPerformAction('createProject') && ( // you can add new 'createDivision' permission if needed
                  <Button
                    variant="outlined"
                    startIcon={<AddCircleOutlineIcon />}
                    sx={{ mt: 1, borderColor: colors.greenAccent[500], color: colors.greenAccent[400], '&:hover': { borderColor: colors.greenAccent[300] }, textTransform: 'none' }}
                    onClick={handleOpenCreateDivisionModal}
                    fullWidth
                  >
                    New Division
                  </Button>
                )}

                {/* Select Existing Project */}
                <FormControl fullWidth margin="dense" sx={styles.dialogSelectControl}>
                  <InputLabel id="project-select-label">Project</InputLabel>
                  <Select
                    labelId="project-select-label"
                    value={selectedProjectId}
                    onChange={(e) => setSelectedProjectId(e.target.value)}
                    label="Project"
                  >
                    {projectsList.length > 0 ? (
                      projectsList.map((proj) => (
                        <MenuItem key={proj.id} value={proj.id}>
                          {proj.name}
                        </MenuItem>
                      ))
                    ) : (
                      <MenuItem value="" disabled>
                        No projects available. Please create one.
                      </MenuItem>
                    )}
                  </Select>
                </FormControl>

                {/* Button to Create New Project */}
                {canPerformAction('createProject') && (
                  <Button
                    variant="outlined"
                    startIcon={<AddCircleOutlineIcon />}
                    sx={{ mt: 1, borderColor: colors.greenAccent[500], color: colors.greenAccent[400], '&:hover': { borderColor: colors.greenAccent[300] }, textTransform: 'none' }}
                    onClick={handleOpenCreateProjectModal}
                    fullWidth
                  >
                    New Project
                  </Button>
                )}


                <input type="file" ref={fileInputRef} style={{ display: "none" }} onChange={handleFileChange} disabled={isUploading} accept=".las,.laz"/>
                <Box sx={styles.fileDisplay}>
                    {newFile ? (<><Typography>{newFile.name}</Typography><Typography variant="body2" sx={{ color: colors.grey[300], mt: 0.5 }}>{(newFile.size/1024/1024).toFixed(2)} MB</Typography></>) : <Typography sx={{ color: colors.grey[400] }}>No file selected</Typography>}
                </Box>
                {isUploading && uploadProgress !== null && ( <Box sx={styles.uploadProgressContainer}><LinearProgress variant="determinate" value={uploadProgress} /><Typography variant="caption" display="block" sx={{ textAlign: 'center', mt: 0.5 }}>{uploadProgress}%</Typography></Box> )}
            </DialogContent>
            <DialogActions sx={styles.dialogActions}><Button onClick={handleCloseUploadModal} color="secondary" disabled={isUploading}>Cancel</Button><Button onClick={handleFileUpload} color="primary" disabled={isUploading || !newFile} variant="contained">{isUploading ? <CircularProgress size={24} color="inherit"/> : "Upload"}</Button></DialogActions>
        </Dialog>

        {/* Create Division Dialog */}
        <Dialog open={createDivisionModalOpen} onClose={handleCloseCreateDivisionModal} disableEscapeKeyDown={isCreatingDivision} PaperProps={{ sx: styles.dialogPaper }}>
            <DialogTitle sx={styles.dialogTitle}>Create New Division</DialogTitle>
            <DialogContent sx={styles.dialogContent}><TextField autoFocus margin="dense" id="new-division-name" label="Division Name" type="text" fullWidth variant="outlined" value={newDivisionName} onChange={(e) => setNewDivisionName(e.target.value.trimStart())} disabled={isCreatingDivision} required sx={styles.dialogTextField}/></DialogContent>
            <DialogActions sx={styles.dialogActions}><Button onClick={handleCloseCreateDivisionModal} color="secondary" disabled={isCreatingDivision}>Cancel</Button><Button onClick={handleCreateDivision} color="primary" disabled={isCreatingDivision || !newDivisionName.trim()} variant="contained">{isCreatingDivision ? <CircularProgress size={24} color="inherit"/> : "Create"}</Button></DialogActions>
        </Dialog>

        {/* Create Project Dialog */}
        <Dialog open={createProjectModalOpen} onClose={handleCloseCreateProjectModal} disableEscapeKeyDown={isCreatingProject} PaperProps={{ sx: styles.dialogPaper }}>
            <DialogTitle sx={styles.dialogTitle}>Create New Project</DialogTitle>
            <DialogContent sx={styles.dialogContent}><TextField autoFocus margin="dense" id="new-project-name" label="Project Name" type="text" fullWidth variant="outlined" value={newProjectName} onChange={(e) => setNewProjectName(e.target.value.trimStart())} disabled={isCreatingProject} required sx={styles.dialogTextField}/></DialogContent>
            <DialogActions sx={styles.dialogActions}><Button onClick={handleCloseCreateProjectModal} color="secondary" disabled={isCreatingProject}>Cancel</Button><Button onClick={handleCreateProject} color="primary" disabled={isCreatingProject || !newProjectName.trim()} variant="contained">{isCreatingProject ? <CircularProgress size={24} color="inherit"/> : "Create"}</Button></DialogActions>
        </Dialog>

        {/* Assign Project Dialog */}
        <Dialog open={assignProjectModalOpen} onClose={handleCloseAssignProjectModal} disableEscapeKeyDown={isAssigningProject} PaperProps={{ sx: styles.dialogPaper }}>
            <DialogTitle sx={styles.dialogTitle}>Assign Project to "{fileToAssignProject?.name}"</DialogTitle>
            <DialogContent sx={styles.dialogContent}>
                <FormControl fullWidth variant="outlined" size="small" sx={styles.dialogSelectControl}>
                    <InputLabel id="assign-project-select-label">Project</InputLabel>
                    <Select labelId="assign-project-select-label" id="assign-project-select" value={selectedProjectIdForAssignment} label="Project" onChange={(e) => setSelectedProjectIdForAssignment(e.target.value)} disabled={isAssigningProject || !!deletingProjectId} MenuProps={{ PaperProps: { sx: { backgroundColor: colors.primary[600], color: colors.grey[100], '& .MuiMenuItem-root:hover': { backgroundColor: colors.primary[500], }, '& .MuiMenuItem-root.Mui-selected': { backgroundColor: colors.blueAccent[700]+'!important', color:colors.grey[100]}}},}}>
                        <MenuItem value=""><em>Unassigned</em></MenuItem>
                        {projectsList.map((p) => ( <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem> ))}
                    </Select>
                </FormControl>
            </DialogContent>
            <DialogActions sx={styles.dialogActions}>
                <Button onClick={handleCloseAssignProjectModal} color="secondary" disabled={isAssigningProject || !!deletingProjectId}>Cancel</Button>
                <Button onClick={handleAssignProject} color="primary" disabled={isAssigningProject || !!deletingProjectId || selectedProjectIdForAssignment === (fileToAssignProject?.project_id ?? '')} variant="contained">
                    {isAssigningProject ? <CircularProgress size={24} color="inherit"/> : "Assign"}
                </Button>
            </DialogActions>
        </Dialog>


        {/* --- Project Settings MODAL --- */}
        <Dialog open={isProjectSettingsModalOpen} onClose={handleCloseProjectSettingsModal} disableEscapeKeyDown={!!processingAssignmentInModal || !!deletingProjectId} fullWidth maxWidth="md" PaperProps={{ sx: styles.modalDialogPaper }}>
             <DialogTitle sx={{ textAlign:"center", fontWeight:'bold', m:0, p:2, borderBottom:`1px solid ${colors.grey[600]}` }}>
                 Manage Data Manager Assignments
                 <IconButton aria-label="close" onClick={handleCloseProjectSettingsModal} sx={{ position:'absolute', right:8, top:8, color:(t)=>t.palette.grey[500] }}>
                     <CloseIcon />
                 </IconButton>
             </DialogTitle>
             <DialogContent sx={styles.modalDialogContent}>
                 {(loadingProjectsList || loadingModalDMs) && <Box display="flex" justifyContent="center" my={2}><CircularProgress/></Box>}
                 {!loadingProjectsList && !loadingModalDMs && projectsList.length === 0 && ( <Typography sx={{textAlign:'center', my:2, color:colors.grey[400]}}>No projects.</Typography> )}
                 {!loadingProjectsList && !loadingModalDMs && projectsList.length > 0 && allDataManagers.length === 0 && ( <Typography sx={{textAlign:'center', my:2, color:colors.grey[400]}}>No 'Data Manager' users.</Typography> )}
                 {!loadingProjectsList && !loadingModalDMs && projectsList.length > 0 && ( // Removed allDataManagers length check here, show projects even if no DMs exist
                     <Box mt={2}>
                          {projectsList.map((project) => {
                              const currentAssigned = assignmentsInModal[project.id] || [];
                              const unassignedForDropdown = getUnassignedManagersForModalProject(project.id);
                              const isAccordionLoading = loadingAssignmentsForProjectId === project.id;
                              const selectedUserIdInDropdown = selectedManagerToAddInModal[project.id] || '';
                              const isProcessingThisProject = processingAssignmentInModal?.projectId === project.id;
                              const isDeletingThisProject = deletingProjectId === project.id; // Check if this project is being deleted

                              return (
                                 <Accordion
                                     key={project.id}
                                     onChange={handleModalAccordionChange(project.id)}
                                     sx={styles.modalAccordion}
                                     TransitionProps={{ unmountOnExit: true }}
                                     disabled={isDeletingThisProject} // Disable accordion if deleting this project
                                 >
                                     <AccordionSummary
                                         expandIcon={<ExpandMoreIcon sx={{color:colors.grey[100]}}/>}
                                         aria-controls={`modal-p${project.id}-content`}
                                         id={`modal-p${project.id}-header`}
                                         sx={{ opacity: isDeletingThisProject ? 0.5 : 1 }} // Dim if deleting
                                     >
                                         <Typography sx={{ flexShrink:0, mr:2, fontWeight:'bold' }}>{project.name}</Typography>
                                         <Chip size="small" label={`${currentAssigned.length} Mgr(s)`} icon={<AdminPanelSettingsIcon fontSize="small"/>} sx={{ backgroundColor: colors.blueAccent[700], color: colors.grey[100] }}/>
                                         {isAccordionLoading && !isDeletingThisProject && <CircularProgress size={20} sx={{ ml: 2 }}/>}

                                         {/* *** Project Delete Button *** */}
                                         {userRole === ROLES.ADMIN && (
                                             <Tooltip title={`Delete Project "${project.name}"`}>
                                                 {/* Wrap IconButton to prevent Tooltip warning when disabled */}
                                                 <span>
                                                     <IconButton
                                                         aria-label={`delete-project-${project.id}`}
                                                         onClick={(e) => {
                                                             e.stopPropagation(); // Prevent accordion toggle
                                                             handleDeleteProject(project.id, project.name);
                                                         }}
                                                         // Disable if ANY processing/deleting is happening, or this accordion is loading
                                                         disabled={isProcessingThisProject || isAccordionLoading || !!deletingProjectId}
                                                         size="small"
                                                         sx={styles.settingsModalDeleteButton}
                                                     >
                                                        {isDeletingThisProject ? <CircularProgress size={20} color="inherit"/> : <DeleteIcon fontSize="small"/>}
                                                     </IconButton>
                                                 </span>
                                             </Tooltip>
                                         )}
                                     </AccordionSummary>
                                      <AccordionDetails sx={styles.modalAccordionDetails}>
                                         <Typography variant="subtitle1" gutterBottom>Currently Assigned:</Typography>
                                         {isAccordionLoading ? <CircularProgress size={24}/> : currentAssigned.length === 0 ? <Typography sx={{color:colors.grey[400], fontStyle:'italic'}}>None</Typography> : (
                                             <List dense>
                                                 {currentAssigned.map(m=>(
                                                     <ListItem key={m.id} secondaryAction={
                                                         <IconButton edge="end" aria-label="remove" onClick={()=>handleRemoveManagerInModal(project.id, m.id, m.username)} disabled={isProcessingThisProject || isAccordionLoading || isDeletingThisProject} title={`Remove ${m.username}`} size="small">
                                                             {(processingAssignmentInModal?.type==='remove'&&processingAssignmentInModal.userId===m.id)?<CircularProgress size={20} color="inherit"/>:<DeleteIcon fontSize="small" sx={styles.modalListItemIcon}/>}
                                                         </IconButton>
                                                     } sx={{pr:'50px', '&:hover':{backgroundColor:colors.primary[500]}}}>
                                                         <ListItemText primary={m.username} secondary={m.email}/>
                                                     </ListItem>
                                                 ))}
                                             </List>
                                         )}
                                          <Divider sx={{ my: 2, borderColor: colors.grey[700] }} />
                                          <Typography variant="subtitle1" gutterBottom>Assign Manager:</Typography>
                                         {allDataManagers.length === 0 ? <Typography sx={{ color: colors.grey[400] }}>No 'Data Manager' users available.</Typography> :
                                          unassignedForDropdown.length === 0 ? <Typography sx={{ color: colors.grey[400] }}>All DMs assigned.</Typography> : (
                                             <Box display="flex" alignItems="center" gap={2} mt={1}>
                                                 <FormControl variant="outlined" size="small" sx={{ minWidth: 200, flexGrow: 1 }} disabled={isProcessingThisProject || isAccordionLoading || isDeletingThisProject}>
                                                     <InputLabel id={`modal-adm-lbl-${project.id}`}>Select Manager</InputLabel>
                                                     <Select labelId={`modal-adm-lbl-${project.id}`} value={selectedUserIdInDropdown} label="Select Manager" onChange={(e)=>handleSelectManagerChangeInModal(project.id,e)} MenuProps={{ PaperProps:{ sx:{backgroundColor: colors.primary[600],color: colors.grey[100]}}}}>
                                                         <MenuItem value="" disabled><em>Select...</em></MenuItem>
                                                         {unassignedForDropdown.map(m=>(<MenuItem key={m.id} value={m.id}>{m.username} ({m.email})</MenuItem>))}
                                                     </Select>
                                                 </FormControl>
                                                 <Button variant="contained" color="secondary" size="medium" onClick={()=>handleAssignManagerInModal(project.id)} disabled={!selectedUserIdInDropdown||isProcessingThisProject||isAccordionLoading || isDeletingThisProject} startIcon={(processingAssignmentInModal?.type==='assign'&&processingAssignmentInModal.userId===selectedUserIdInDropdown)?<CircularProgress size={20} color="inherit"/>:<PersonAddIcon/>}>Assign</Button>
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
                <Button onClick={handleCloseProjectSettingsModal} color="inherit" disabled={!!processingAssignmentInModal || !!deletingProjectId}>Close</Button>
            </DialogActions>
        </Dialog>

        {/* --- NEW: Division & Project Management MODAL --- */}
       <Dialog
           open={isDivisionProjectSettingsModalOpen}
           onClose={handleCloseDivisionProjectSettingsModal}
           // Prevent closing via escape key during deletion
           disableEscapeKeyDown={!!deletingDivisionId || !!deletingProjectId}
           fullWidth
           maxWidth="sm" // Adjust width as needed
           PaperProps={{ sx: styles.modalDialogPaper }} // Reuse existing modal style
       >
           <DialogTitle sx={{ textAlign:"center", fontWeight:'bold', m:0, p:2, borderBottom:`1px solid ${colors.grey[600]}` }}>
               Manage Divisions & Projects
               <IconButton
                   aria-label="close"
                   onClick={handleCloseDivisionProjectSettingsModal}
                   sx={{ position:'absolute', right:8, top:8, color:(t)=>t.palette.grey[500] }}
                   // Disable close button during deletion
                   disabled={!!deletingDivisionId || !!deletingProjectId}
               >
                   <CloseIcon />
               </IconButton>
           </DialogTitle>
           <DialogContent sx={styles.modalDialogContent}>
               {/* --- Divisions Section --- */}
               <Box mb={3}>
                   <Typography variant="h6" gutterBottom sx={{ color: colors.grey[200] }}>Divisions</Typography>
                   {(loadingDivisionsList) && <Box display="flex" justifyContent="center" my={2}><CircularProgress/></Box>}
                   {!loadingDivisionsList && divisionsList.length === 0 && ( <Typography sx={{textAlign:'center', my:2, color:colors.grey[400]}}>No divisions found.</Typography> )}
                   {!loadingDivisionsList && divisionsList.length > 0 && (
                       <List dense>
                           {divisionsList.map((division) => {
                               const isDeletingThis = deletingDivisionId === division.id;
                               return (
                                   <ListItem
                                       key={`div-${division.id}`}
                                       secondaryAction={
                                           <Tooltip title={`Delete Division "${division.name}"`}>
                                               {/* Wrap IconButton in span for Tooltip when disabled */}
                                               <span>
                                                   <IconButton
                                                       edge="end"
                                                       aria-label={`delete-division-${division.id}`}
                                                       onClick={() => handleDeleteDivision(division.id, division.name)}
                                                       // Disable if ANY deletion is happening
                                                       disabled={!!deletingDivisionId || !!deletingProjectId}
                                                       size="small"
                                                       sx={{
                                                           ...styles.modalListItemIcon, // Use red color from assignments modal
                                                           opacity: (!!deletingDivisionId || !!deletingProjectId) && !isDeletingThis ? 0.5 : 1, // Dim if another is deleting
                                                       }}
                                                   >
                                                       {isDeletingThis ? <CircularProgress size={20} color="inherit"/> : <DeleteIcon fontSize="small"/>}
                                                   </IconButton>
                                               </span>
                                           </Tooltip>
                                       }
                                       sx={{pr:'50px', '&:hover':{backgroundColor:colors.primary[500]}, opacity: isDeletingThis ? 0.6 : 1}}
                                       divider
                                   >
                                       <ListItemText primary={division.name} sx={{color: colors.grey[100]}} />
                                   </ListItem>
                               );
                           })}
                       </List>
                   )}
                   {/* Button to Create New Division */}
                  {canPerformAction('createProject') && ( // you can add new 'createDivision' permission if needed
                    <Button
                      variant="outlined"
                      startIcon={<AddCircleOutlineIcon />}
                      sx={{ mt: 1, borderColor: colors.greenAccent[500], color: colors.greenAccent[400], '&:hover': { borderColor: colors.greenAccent[300] }, textTransform: 'none' }}
                      onClick={handleOpenCreateDivisionModal}
                      fullWidth
                    >
                      New Division
                    </Button>
                  )}
               </Box>

               <Divider sx={{ my: 2, borderColor: colors.grey[700] }} />

               {/* --- Projects Section --- */}
               <Box>
                   <Typography variant="h6" gutterBottom sx={{ color: colors.grey[200] }}>Projects</Typography>
                   {(loadingProjectsList) && <Box display="flex" justifyContent="center" my={2}><CircularProgress/></Box>}
                   {!loadingProjectsList && projectsList.length === 0 && ( <Typography sx={{textAlign:'center', my:2, color:colors.grey[400]}}>No projects found.</Typography> )}
                   {!loadingProjectsList && projectsList.length > 0 && (
                       <List dense>
                           {projectsList.map((project) => {
                               const isDeletingThis = deletingProjectId === project.id;
                               return (
                                   <ListItem
                                       key={`proj-${project.id}`}
                                       secondaryAction={
                                           <Tooltip title={`Delete Project "${project.name}"`}>
                                               {/* Wrap IconButton in span for Tooltip when disabled */}
                                               <span>
                                                   <IconButton
                                                       edge="end"
                                                       aria-label={`delete-project-${project.id}`}
                                                       // Reuse the existing handleDeleteProject function
                                                       onClick={() => handleDeleteProject(project.id, project.name)}
                                                       // Disable if ANY deletion is happening
                                                       disabled={!!deletingDivisionId || !!deletingProjectId}
                                                       size="small"
                                                        sx={{
                                                           ...styles.modalListItemIcon, // Use red color
                                                           opacity: (!!deletingDivisionId || !!deletingProjectId) && !isDeletingThis ? 0.5 : 1, // Dim if another is deleting
                                                       }}
                                                   >
                                                       {isDeletingThis ? <CircularProgress size={20} color="inherit"/> : <DeleteIcon fontSize="small"/>}
                                                   </IconButton>
                                               </span>
                                           </Tooltip>
                                       }
                                       sx={{pr:'50px', '&:hover':{backgroundColor:colors.primary[500]}, opacity: isDeletingThis ? 0.6 : 1}}
                                       divider
                                   >
                                       <ListItemText primary={project.name} sx={{color: colors.grey[100]}}/>
                                   </ListItem>
                               );
                           })}
                       </List>
                   )}
                   {/* Button to Create New Project */}
                  {canPerformAction('createProject') && (
                    <Button
                      variant="outlined"
                      startIcon={<AddCircleOutlineIcon />}
                      sx={{ mt: 1, borderColor: colors.greenAccent[500], color: colors.greenAccent[400], '&:hover': { borderColor: colors.greenAccent[300] }, textTransform: 'none' }}
                      onClick={handleOpenCreateProjectModal}
                      fullWidth
                    >
                      New Project
                    </Button>
                  )}
               </Box>
           </DialogContent>
       </Dialog>

        {/* --- File Table --- */}
        <TableContainer component={Paper} sx={styles.tableContainer}>
             {isLoading && (<Box sx={styles.loadingOverlay}><CircularProgress/></Box>)}
            {!isLoading && files.length===0 && !isLoadingPermissions && (
                <Typography sx={{textAlign:'center', p:4, color:colors.grey[500], fontStyle:'italic'}}>
                    No files found{filterProjectId==='all'?'':(filterProjectId==='unassigned'?' (unassigned)':' in project')}.
                </Typography>
            )}
            {!isLoading && files.length>0 && !isLoadingPermissions && (
                <Table sx={styles.table} aria-label="file table">
                    <TableHead sx={styles.tableHead}>
                        <TableRow>
                            <TableCell sx={styles.headCell}>Name</TableCell>
                            <TableCell sx={styles.headCell}>Plot</TableCell>
                            <TableCell sx={styles.headCell}>Division</TableCell>
                            <TableCell sx={styles.headCell}>Project</TableCell>
                            <TableCell sx={styles.headCell}>Size</TableCell>
                            <TableCell sx={styles.headCell}>Uploaded</TableCell>
                            <TableCell sx={{...styles.headCell, textAlign:'center'}}>Potree</TableCell>
                            <TableCell sx={{...styles.headCell, textAlign:'center'}}>Actions</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {files.map((file) => {
                            const isConverting = convertingFileId === file.id;
                            const isReady = !!file.potreeUrl && file.potreeUrl !== 'pending_refresh';
                            let sT="Not Converted"; let sC=colors.grey[500];
                            if(isConverting){sT="Converting...";sC=colors.blueAccent[300];}
                            else if(isReady){sT="Ready";sC=colors.greenAccent[400];}

                            const cA=canPerformAction('assignProject',file);
                            const cD=canPerformAction('download',file);
                            const cV=canPerformAction('view',file);
                            const cC=canPerformAction('convert',file);
                            const cDel=canPerformAction('delete',file);
                            const hasVisibleActions = cA || cD || (cC && !isReady && !isConverting) || cDel || (cV && isReady);

                            return (
                                <TableRow key={file.id} hover sx={{'&:last-child td,&:last-child th':{border:0}, opacity:isConverting?0.6:1}}>
                                    <TableCell sx={styles.bodyCell} title={file.name}>{file.name}</TableCell>
                                    <TableCell sx={styles.bodyCell}>{file.plot_name || 'N/A'}</TableCell>
                                    <TableCell sx={styles.bodyCell}>{file.divisionName || 'N/A'}</TableCell>
                                    <TableCell sx={styles.bodyCell} title={file.projectName}>{file.projectName}</TableCell>
                                    <TableCell sx={styles.bodyCell}>{file.size}</TableCell>
                                    <TableCell sx={styles.bodyCell}>{file.uploadDate}</TableCell>
                                    <TableCell sx={{...styles.bodyCell,textAlign:'center'}}>
                                        {isConverting ? (<Box sx={styles.statusText}><CircularProgress size={16} sx={{color:sC}}/><Typography variant="caption" sx={{color:sC,ml:1}}>{sT}</Typography></Box>) : (<Typography variant="caption" sx={{color:sC}}>{sT}</Typography>)}
                                    </TableCell>
                                    <TableCell sx={{...styles.bodyCell,textAlign:'center',p:'0 8px'}}>
                                        <IconButton
                                            aria-label={`actions-for-${file.name}`}
                                            onClick={(e)=>handleMenuClick(e,file)}
                                            sx={styles.actionButton}
                                            size="small"
                                            disabled={isConverting || !hasVisibleActions || !!deletingProjectId} // Added deletingProjectId check
                                            title={!hasVisibleActions?"Forbidden":"More"}
                                        >
                                            <MoreVertIcon fontSize="small"/>
                                        </IconButton>
                                        <Menu
                                            id={`menu-for-${file.id}`}
                                            anchorEl={anchorEl}
                                            keepMounted
                                            open={Boolean(anchorEl) && selectedFile?.id === file.id}
                                            onClose={handleMenuClose}
                                            anchorOrigin={{vertical:'bottom',horizontal:'right'}}
                                            transformOrigin={{vertical:'top',horizontal:'right'}}
                                            PaperProps={{sx:{backgroundColor:colors.primary[800],color:colors.grey[100],mt:0.5}}}
                                        >
                                            {cA && (<MenuItem onClick={()=>handleOpenAssignProjectModal(selectedFile)} disabled={isAssigningProject||!!convertingFileId || !!deletingProjectId}><ListItemIcon sx={{...styles.menuItemIcon, color:colors.grey[300]}}><AssignmentIcon fontSize="small"/></ListItemIcon><ListItemText>Assign File Project</ListItemText></MenuItem>)}
                                            {cD && (<MenuItem onClick={()=>handleDownload(selectedFile)} disabled={!!convertingFileId || !!deletingProjectId}><ListItemIcon sx={{...styles.menuItemIcon, color:colors.grey[300]}}><DownloadIcon fontSize="small"/></ListItemIcon><ListItemText>Download</ListItemText></MenuItem>)}
                                            {cV && isReady && (<MenuItem onClick={()=>handleViewPotree(selectedFile)} disabled={!isReady||!!convertingFileId || !!deletingProjectId}><ListItemIcon sx={{...styles.menuItemIcon, color:colors.grey[300]}}><VisibilityIcon fontSize="small"/></ListItemIcon><ListItemText>View Potree</ListItemText></MenuItem>)}
                                            {cC && !isReady && (<MenuItem onClick={()=>handleConvertPotree(selectedFile)} disabled={isReady||isConverting||!!convertingFileId || !!deletingProjectId}><ListItemIcon sx={{...styles.menuItemIcon, color:colors.grey[300]}}><TransformIcon fontSize="small"/></ListItemIcon><ListItemText>{isConverting?'Converting...':'Convert Potree'}</ListItemText></MenuItem>)}
                                            {cDel && (<MenuItem onClick={()=>handleRemove(selectedFile)} disabled={!!convertingFileId || !!deletingProjectId} sx={{ color: colors.redAccent[400], '.MuiListItemIcon-root': { color: colors.redAccent[400] } }} ><ListItemIcon sx={styles.menuItemIcon}><DeleteIcon fontSize="small"/></ListItemIcon><ListItemText>Remove</ListItemText></MenuItem>)}
                                            {!hasVisibleActions && (<MenuItem disabled sx={styles.menuItemDisabledText}><ListItemText>No actions permitted</ListItemText></MenuItem>)}
                                        </Menu>
                                    </TableCell>
                               </TableRow>
                           );
                        })}
                    </TableBody>
                </Table>
            )}
        </TableContainer>

        {/* --- Shared Snackbar --- */}
        <Snackbar
            open={snackbarOpen}
            autoHideDuration={6000}
            onClose={handleSnackbarClose}
            anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
        >
            <Alert onClose={handleSnackbarClose} severity={snackbarSeverity} variant="filled" sx={{ width:"100%" }}>
                {snackbarMessage}
            </Alert>
        </Snackbar>
      </Box>
    </Box>
  );
};

// --- EXPORT ---
export default FileManagement;