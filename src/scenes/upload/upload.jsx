import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  Box, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Paper, Typography, useTheme, IconButton, Menu, MenuItem, Button, Dialog,
  DialogTitle, DialogContent, DialogActions, Snackbar, Alert, CircularProgress,
  LinearProgress, ListItemIcon, ListItemText, Select, FormControl, InputLabel,
  TextField, Grid, Accordion, AccordionSummary, AccordionDetails, List, ListItem,
  Divider, Chip, Tooltip, Checkbox, Switch, FormControlLabel
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

// Define active processing states that make a file non-interactive for certain actions
const ACTIVE_PIPELINE_PROCESSING_STATUSES = [
    'segmenting',
    'processing_las_data',
    'converting_potree',
    'processing' // General/manual conversion status
];


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
    const [uploadAbortController, setUploadAbortController] = useState(null);
    // const [convertingFileId, setConvertingFileId] = useState(null); // Replaced by filesBeingProcessed for optimistic UI
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
    const [selectedProjectId, setSelectedProjectId] = useState('');
    const [selectedDivisionIdForCreation, setSelectedDivisionIdForCreation] = useState('');
    const [isDivisionProjectSettingsModalOpen, setIsDivisionProjectSettingsModalOpen] = useState(false);
    const [deletingDivisionId, setDeletingDivisionId] = useState(null); 
    const [reassignModalOpen, setReassignModalOpen] = useState(false);
    const [fileToReassign, setFileToReassign] = useState(null);
    const [selectedProjectIdForReassign, setSelectedProjectIdForReassign] = useState('');
    const [newPlotNameForReassign, setNewPlotNameForReassign] = useState('');
    const [isReassigning, setIsReassigning] = useState(false);
    const [filesBeingProcessed, setFilesBeingProcessed] = useState(new Set());
    const [isPolling, setIsPolling] = useState(false);
    const [skipSegmentation, setSkipSegmentation] = useState(false);

    // --- NEW STATE FOR BULK ACTIONS ---
    const [selectedFileIds, setSelectedFileIds] = useState(new Set());
    const [isDeletingBulk, setIsDeletingBulk] = useState(false);


  // --- UTILITY FUNCTIONS ---
  const showSnackbar = useCallback((message, severity = "success") => {
    setSnackbarMessage(message);
    setSnackbarSeverity(severity);
    setSnackbarOpen(true);
  }, []); 

  const handleSnackbarClose = (event, reason) => {
    if (reason === "clickaway") return;
    setSnackbarOpen(false);
  };

  // --- PERMISSION CHECK FUNCTION ---
  const canPerformAction = useCallback((action, file = null) => {
    if (isLoadingPermissions || !userRole) return false;

    const requiresFileContext = ['download', 'delete', 'convert', 'assignProject', 'view', 'reassign']; // Added reassign
    if (requiresFileContext.includes(action) && !file) {
         if (action !== 'upload' && action !== 'manageAssignments' && action !== 'createProject' && action !== 'createDivision') { // Added createProject, createDivision
             console.warn(`canPerformAction denied - missing file object for action: ${action}`);
            return false;
         }
     }

    if (userRole === ROLES.ADMIN) {
        // Admin can do almost anything except be assigned (that's for DMs)
        return action !== 'manageAssignments'; // This seems to be for a specific modal button, not a general permission
    }

    if (userRole === ROLES.DATA_MANAGER) {
        switch (action) {
            case 'upload':
            case 'view': // View any ready file
            case 'download': // Download any file
                return true;
            case 'convert': // DM can convert any file not yet converted or failed
                 return file && (!file.potreeUrl || file.status === 'failed');
            case 'assignProject': // DM can assign unassigned files or re-assign files from projects they manage
                 return file && (file.project_id === null || assignedProjectIdsForDM.includes(file.project_id));
            case 'delete': // DM can delete unassigned files or files from projects they manage
                 return file && (file.project_id === null || assignedProjectIdsForDM.includes(file.project_id));
            case 'reassign': // DM can reassign plot name/project for files they manage or unassigned
                 return file && (file.project_id === null || assignedProjectIdsForDM.includes(file.project_id));
            case 'createProject': // DMs typically don't create projects
            case 'createDivision': // DMs typically don't create divisions
            case 'manageAssignments': // This refers to the admin modal for assigning DMs to projects
                return false;
            default:
                return false;
        }
    }

    if (userRole === ROLES.REGULAR) {
        // Regular users can only view ready files or trigger conversion for non-ready files
        switch (action) {
            case 'view':
                return file && !!file.potreeUrl;
            case 'convert':
                return file && (!file.potreeUrl || file.status === 'failed');
            default:
                return false;
        }
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
},[showSnackbar]);

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
  }, [showSnackbar ]);

  const fetchFiles = useCallback(async (
    projectIdToFilter = filterProjectId,
    divisionIdToFilter = filterDivisionId
  ) => {
      if (isLoadingPermissions || !userRole) {
          setFiles([]); 
          setIsLoading(false);
          return;
      }
      setIsLoading(true); 
      const token = localStorage.getItem('authToken');
      if (!token) {
          showSnackbar("Authentication required to fetch files.", "error");
          setIsLoading(false);
          return;
      }

      try {
          const params = {};
          if (projectIdToFilter && projectIdToFilter !== 'all') {
              params.projectId = projectIdToFilter;
          }
          if (divisionIdToFilter && divisionIdToFilter !== 'all') {
              params.divisionId = divisionIdToFilter;
          }

          const res = await axios.get(`${API_BASE_URL}/files`, {
              headers: { 'Authorization': `Bearer ${token}` },
              params: params
          });
          const filesData = Array.isArray(res.data) ? res.data : [];
          const formatted = filesData.map(f => ({
              ...f, 
              size: f.size_bytes ? (f.size_bytes / 1024 / 1024).toFixed(2) + ' MB' : 'N/A',
              uploadDate: f.upload_date ? new Date(f.upload_date).toLocaleDateString() : 'N/A',
              potreeUrl: f.potreeUrl || null,
              projectName: f.projectName || "Unassigned",
              divisionName: f.divisionName || "N/A"
          }));
          setFiles(formatted);

          setFilesBeingProcessed(currentProcessing => {
              const stillProcessing = new Set(currentProcessing);
              const fetchedFileIds = new Set(formatted.map(f => f.id));
              currentProcessing.forEach(id => {
                  const fileInData = formatted.find(f => f.id === id);
                  if (!fetchedFileIds.has(id) || (fileInData && fileInData.potreeUrl)) {
                       if (stillProcessing.has(id)) {
                          console.log(`Optimistic state cleanup: Removing File ${id} from processing set.`);
                          stillProcessing.delete(id);
                       }
                  }
              });
              return stillProcessing;
          });
          // Clear selections if files list changes significantly (e.g. due to filter)
          // setSelectedFileIds(new Set()); // Or be more selective if needed

      } catch (e) {
          console.error("Error fetching files:", e);
          if (!(e.response?.status === 401 || e.response?.status === 403)) {
              showSnackbar("Failed to load files.", "error");
          }
          setFiles([]); 
          setSelectedFileIds(new Set()); // Clear selection on error too
      } finally {
          setIsLoading(false);
      }
  }, [
      filterProjectId,
      filterDivisionId,
      isLoadingPermissions,
      userRole,
      showSnackbar 
  ]);

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
  }, [showSnackbar]);

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
  }, [showSnackbar]);

  // --- EFFECTS ---

    useEffect(() => {
        const activeProcessingStatesForPolling = ACTIVE_PIPELINE_PROCESSING_STATUSES.concat(['uploaded']); // Add 'uploaded' for polling
        const shouldPoll = files.some(file =>
            activeProcessingStatesForPolling.includes(file.status) && !file.potreeUrl
        );

        if (shouldPoll && !isPolling) {
            setIsPolling(true);
        } else if (!shouldPoll && isPolling) {
            setIsPolling(false);
        }
    }, [files, isPolling]); 

    useEffect(() => {
        let intervalId;
        if (isPolling && !isLoadingPermissions && userRole && !isLoading) { 
            console.log("FileManagement: Starting polling interval.");
            intervalId = setInterval(() => {
                console.log("FileManagement: Polling for file status updates...");
                fetchFiles(); 
            }, 7000); // Poll every 7 seconds 
        } else if (intervalId) {
            console.log("FileManagement: Clearing polling interval (polling stopped or component unmounting).");
            clearInterval(intervalId);
        }
        return () => {
            if (intervalId) {
                console.log("FileManagement: Clearing polling interval on cleanup.");
                clearInterval(intervalId);
            }
        };
    }, [isPolling, isLoadingPermissions, userRole, fetchFiles, isLoading]);


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
        await fetchProjectsList(token); 

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
  }, [fetchProjectsList, fetchAllDataManagersForModal,fetchDivisionsList]); 

  useEffect(() => {
      if (!isLoadingPermissions && userRole) {
          fetchFiles();
      } else {
          setFiles([]); 
          setSelectedFileIds(new Set()); // Clear selection
      }
  }, [isLoadingPermissions, userRole, fetchFiles]);

  // Cleanup effect for abort controller
  useEffect(() => {
    return () => {
      if (uploadAbortController) {
        uploadAbortController.abort();
      }
    };
  }, [uploadAbortController]); 

  // --- ACTION HANDLERS ---
  const handleMenuClick = (event, file) => { setAnchorEl(event.currentTarget); setSelectedFile(file); };
  const handleMenuClose = () => { setAnchorEl(null); /* setSelectedFile(null) potentially later if needed */ };

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
    handleMenuClose(); // Close menu before confirmation
    
    const conf = window.confirm(`Delete "${fileToRemove.name}" and associated Potree data?`);
    if (!conf) return;

    const token = localStorage.getItem('authToken');
    if (!token) { showSnackbar("Auth required.", "error"); return; }
    try {
        const res = await axios.delete(`${API_BASE_URL}/files/${fileId}`, { headers: { 'Authorization': `Bearer ${token}` } });
        if (res.status === 200 || res.status === 204) {
            showSnackbar(`"${fileToRemove.name}" removed.`, "success");
            fetchFiles(); // Refresh file list
            setSelectedFileIds(prev => { // Remove from selection if it was selected
                const next = new Set(prev);
                next.delete(fileId);
                return next;
            });
        } else { showSnackbar(res.data?.message || "Remove failed.", "warning"); }
    } catch (e) {
        console.error("Remove error:", e);
        showSnackbar(e.response?.data?.message || "Server error removing file.", "error");
    }
  };

  const handleConvertPotree = async (fileToConvert) => {
    if (!canPerformAction('convert', fileToConvert)) { showSnackbar("Permission denied.", "error"); handleMenuClose(); return; }
    const fileId = fileToConvert?.id;

    if (fileToConvert?.potreeUrl || filesBeingProcessed.has(fileId) || ACTIVE_PIPELINE_PROCESSING_STATUSES.includes(fileToConvert?.status)) {
        showSnackbar(filesBeingProcessed.has(fileId) || ACTIVE_PIPELINE_PROCESSING_STATUSES.includes(fileToConvert?.status) ? "Conversion already in progress or queued." : "Already converted.", "info");
        handleMenuClose();
        return;
    }
    if (!fileId) { handleMenuClose(); return; }

    handleMenuClose();
    const token = localStorage.getItem('authToken');
    if (!token) { showSnackbar("Auth required.", "error"); return; }

    setFilesBeingProcessed(prev => new Set(prev).add(fileId));
    showSnackbar(`Starting conversion: "${fileToConvert.name}"...`, "info"); 

    try {
        const res = await axios.get(`${API_BASE_URL}/files/potreeconverter/${fileId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (res.data.success) {
            showSnackbar(`Conversion for "${fileToConvert.name}" initiated. Refreshing status...`, "info"); 
            fetchFiles(); // This will also update filesBeingProcessed if conversion is done quickly
        } else {
            showSnackbar(res.data.message || `Conversion failed: ${fileToConvert.name}.`, "error");
             setFilesBeingProcessed(prev => { const next = new Set(prev); next.delete(fileId); return next; });
        }
    } catch (e) {
        console.error("Conversion error:", e);
        showSnackbar(e.response?.data?.message || `Server error during conversion.`, "error");
         setFilesBeingProcessed(prev => { const next = new Set(prev); next.delete(fileId); return next; });
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
    setUploadAbortController(null);
    setPlotName('');
    setSelectedProjectId('');
  };

  const handleCloseUploadModal = () => {
    if (isUploading) return; 
    setOpenUploadModal(false);
    setNewFile(null);
    setUploadProgress(null);
    setUploadAbortController(null);
    if (fileInputRef.current) fileInputRef.current.value = ''; 
  };

  const handleFileChange = (e) => {
    if (e.target.files?.[0]) {
        setNewFile(e.target.files[0]);
        setUploadProgress(null); 
    }
  };

  const triggerFileInput = () => {
    fileInputRef.current?.click();
  };

  const handleFileUpload = async () => {
    if (!canPerformAction('upload')) {
      showSnackbar("Permission denied.", "error");
      return;
    }
    if (!newFile) {
      showSnackbar("Please select a file.", "warning");
      return;
    }
    const token = localStorage.getItem('authToken');
    if (!token) {
      showSnackbar("Authentication required.", "error");
      return;
    }

    const fd = new FormData();
    fd.append('file', newFile);
    if (plotName.trim()) {
        fd.append('plot_name', plotName.trim());
    }
    fd.append('project_id', selectedProjectId || ''); 

    // Create AbortController for cancellation
    const abortController = new AbortController();
    setUploadAbortController(abortController);

    fd.append('skipSegmentation', skipSegmentation); 
    
    setIsUploading(true);
    setUploadProgress(0);
    
    try {
        const uploadRes = await axios.post(`${API_BASE_URL}/files/upload`, fd, {
            headers: { 'Content-Type': 'multipart/form-data', 'Authorization': `Bearer ${token}` },
            signal: abortController.signal,
            onUploadProgress: (pe) => {
                setUploadProgress(pe.total ? Math.round((pe.loaded * 100) / pe.total) : 0);
            }
        });

        if (uploadRes.data.success && uploadRes.data.file && uploadRes.data.file.id) {
            showSnackbar(`File "${newFile.name}" uploaded. Backend processing pipeline initiated.`, "success");
            handleCloseUploadModal();
            await fetchFiles(); // This will refresh and potentially show the new file in "processing" state
        } else {
            showSnackbar(uploadRes.data.message || "File upload failed. Please check details or server logs.", "error");
            setUploadProgress(null); 
        }
    } catch (e) {
        console.error("Critical upload error:", e);
        
        // Check if the error is due to cancellation
        if (e.name === 'CanceledError' || e.code === 'ERR_CANCELED') {
            showSnackbar("Upload cancelled.", "info");
            setUploadProgress(null);
            return;
        }
        
        let errorMessage = "Server error during upload.";
        if (e.response) {
            errorMessage = e.response.data?.message || `Server responded with ${e.response.status}`;
        } else if (e.request) {
            errorMessage = "No response from server. Check network or server status.";
        } else {
            errorMessage = e.message || "Error setting up upload request.";
        }
        showSnackbar(errorMessage, "error");
        setUploadProgress(null); 
    } finally {
        setIsUploading(false);
        setUploadAbortController(null);
    }
  };

  const handleCancelUpload = () => {
    if (uploadAbortController) {
      uploadAbortController.abort();
      setUploadAbortController(null);
    }
  };

  const handleCloseAssignProjectModal = () => {
    if (isAssigningProject) return;
    setAssignProjectModalOpen(false);
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
            fetchFiles(); 
        } else { showSnackbar(res.data.message || "Assignment failed.", "error"); }
    } catch (e) {
        console.error("Assign project error:", e);
        showSnackbar(e.response?.data?.message || "Server error assigning project.", "error");
    } finally {
        setIsAssigningProject(false);
    }
  };

  const handleDeleteProject = async (projectId, projectName) => {
    if (userRole !== ROLES.ADMIN) {
        showSnackbar("Permission denied.", "error");
        return;
    }
    if (deletingProjectId || isDeletingBulk) {
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

    setDeletingProjectId(projectId); 
    try {
        const response = await axios.delete(`${API_BASE_URL}/projects/${projectId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (response.data.success) {
            showSnackbar(`Project "${projectName}" deleted successfully.`, "success");
            await fetchProjectsList(token); 
            setAssignmentsInModal(prev => {
                const newState = {...prev};
                delete newState[projectId];
                return newState;
            });
            await fetchFiles('all'); 
            setFilterProjectId('all'); 
            setSelectedFileIds(new Set()); // Clear selection as project context changed
        } else {
            showSnackbar(response.data.message || "Failed to delete project.", "error");
        }
    } catch (error) {
        console.error("Error deleting project:", error);
        showSnackbar(error.response?.data?.message || "Server error deleting project.", "error");
    } finally {
        setDeletingProjectId(null); 
    }
  };

  const handleProjectFilterChange = (event) => { 
    setFilterProjectId(event.target.value);
    setSelectedFileIds(new Set()); // Clear selection when filter changes
  };

  const handleDivisionFilterChange = (event) => {
    const newDivisionId = event.target.value;
    setFilterDivisionId(newDivisionId);
    setSelectedFileIds(new Set()); // Clear selection when filter changes

    if (newDivisionId === 'all') {
      return;
    }

    const currentProjectId = filterProjectId;
    if (currentProjectId !== 'all' && currentProjectId !== 'unassigned') {
      const numericProjectId = parseInt(currentProjectId, 10);
      const numericDivisionId = parseInt(newDivisionId, 10);
      const projectStillValid = projectsList.find(
        p => p.id === numericProjectId && p.division_id === numericDivisionId
      );
      if (!projectStillValid) {
        setFilterProjectId('all'); 
      }
    }
  };

  const handleOpenCreateProjectModal = () => {
    if (userRole !== ROLES.ADMIN) { showSnackbar("Permission denied.", "error"); return; }
    setNewProjectName('');
    setSelectedDivisionIdForCreation(''); 
    setCreateProjectModalOpen(true);
  };

  const handleOpenCreateDivisionModal = () => {
    if (userRole !== ROLES.ADMIN) { showSnackbar("Permission denied.", "error"); return; } // Or canPerformAction('createDivision')
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
    setSelectedDivisionIdForCreation(''); 
  };

  const handleCreateDivision = async () => {
    if (userRole !== ROLES.ADMIN) { 
        showSnackbar("Permission denied.", "error");
        return;
    }
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
            const createdDivision = res.data.division;
            showSnackbar(`Division "${res.data.division.name}" created!`, "success");
            await fetchDivisionsList(token); 
            setSelectedDivisionIdForCreation(createdDivision.id); // Pre-select in create project modal if open
            handleCloseCreateDivisionModal();
        } else {
             showSnackbar(res.data.message || "Create division failed.", "error");
        }
    } catch (e) {
        console.error("Create division error:", e);
        const msg = e.response?.status === 409 ? `Division "${newDivisionName.trim()}" already exists.` : e.response?.data?.message || "Server error creating division.";
        showSnackbar(msg, "error");
    } finally {
        setIsCreatingDivision(false);
    }
  };

    const handleCreateProject = async () => {
    if (userRole !== ROLES.ADMIN) { showSnackbar("Permission denied.", "error"); return; }
    if (!newProjectName.trim() || isCreatingProject) {
        if (!newProjectName.trim()) showSnackbar("Project name required.", "warning");
        return;
    }
    if (!selectedDivisionIdForCreation) {
        showSnackbar("Please select a Division for the project.", "warning");
        return;
    }

    const token = localStorage.getItem('authToken');
    if (!token) { showSnackbar("Auth required.", "error"); return; }

    setIsCreatingProject(true);
    try {
        const res = await axios.post(
            `${API_BASE_URL}/projects`,
            {
                name: newProjectName.trim(),
                divisionId: selectedDivisionIdForCreation
            },
            { headers: { 'Authorization': `Bearer ${token}` } }
        );

        if (res.data.success && res.data.project) {
            const createdProject = res.data.project;
            showSnackbar(`Project "${createdProject.name}" created!`, "success");
            await fetchProjectsList(token); // This is good, it refreshes the list

            // --- THIS IS THE KEY CHANGE ---
            // Pre-select the newly created project in the Upload Modal's dropdown
            setSelectedProjectId(createdProject.id.toString()); // Ensure it's a string if your Select expects string values

            // Keep these if they are still relevant for other modals
            setSelectedProjectIdForReassign(createdProject.id.toString());
            setSelectedProjectIdForAssignment(createdProject.id.toString());

            handleCloseCreateProjectModal();
        } else {
            showSnackbar(res.data.message || "Create project failed.", "error");
        }
    } catch (e) {
        console.error("Create project error:", e);
        let msg = "Server error creating project.";
        if (e.response?.status === 409 && e.response?.data?.message?.includes('already exists in this division')) {
            msg = `Project "${newProjectName.trim()}" already exists in the selected division.`;
        } else if (e.response?.status === 404 && e.response?.data?.message?.includes('Division')) {
             msg = "Selected division not found. Please refresh.";
        } else {
             msg = e.response?.data?.message || msg;
        }
        showSnackbar(msg, "error");
    } finally {
        setIsCreatingProject(false);
    }
  };

  const handleOpenDivisionProjectSettingsModal = () => {
     if (userRole !== ROLES.ADMIN) {
         showSnackbar("Permission denied. Administrator role required.", "error");
         return;
     }
     setDeletingDivisionId(null); 
     setDeletingProjectId(null);
     setIsDivisionProjectSettingsModalOpen(true);
 };

 const handleCloseDivisionProjectSettingsModal = () => {
     if (deletingDivisionId || deletingProjectId || isDeletingBulk) {
         showSnackbar("Please wait for the current operation to complete.", "warning");
         return;
     }
     setIsDivisionProjectSettingsModalOpen(false);
 };

 const handleDeleteDivision = async (divisionId, divisionName) => {
     if (userRole !== ROLES.ADMIN) {
         showSnackbar("Permission denied.", "error");
         return;
     }
     if (deletingDivisionId || deletingProjectId || isDeletingBulk) {
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

     setDeletingDivisionId(divisionId); 
     try {
         const response = await axios.delete(`${API_BASE_URL}/divisions/${divisionId}`, {
             headers: { 'Authorization': `Bearer ${token}` }
         });

         if (response.data.success) { 
             showSnackbar(`Division "${divisionName}" deleted successfully.`, "success");
             await fetchDivisionsList(token); 
             await fetchProjectsList(token);
             await fetchFiles('all', 'all'); 
             setFilterDivisionId('all'); 
             setFilterProjectId('all');
             setSelectedFileIds(new Set()); // Clear selection as division context changed
         } else {
             showSnackbar(response.data.message || "Failed to delete division.", "error");
         }
     } catch (error) {
         console.error("Error deleting division:", error);
         showSnackbar(error.response?.data?.message || "Server error deleting division.", "error");
     } finally {
         setDeletingDivisionId(null); 
     }
 };

  const handleOpenProjectSettingsModal = () => {
    setAssignmentsInModal({}); 
    setLoadingAssignmentsForProjectId(null);
    setProcessingAssignmentInModal(null);
    setIsProjectSettingsModalOpen(true);
  };

  const handleCloseProjectSettingsModal = () => {
    if (processingAssignmentInModal || isDeletingBulk) return;
    setIsProjectSettingsModalOpen(false);
  };

  const handleModalAccordionChange = (projectId) => (e, isExpanded) => {
    const token = localStorage.getItem('authToken');
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
        setSelectedManagerToAddInModal(prev => ({ ...prev, [projectId]: '' })); 
        await fetchAssignmentsForModal(projectId, token); 
    } catch (e) {
        console.error("Err assign modal:", e);
        showSnackbar(e.response?.data?.message || "Assign fail.", "error");
    } finally {
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
        await fetchAssignmentsForModal(projectId, token); 
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

  const filteredProjectsForDropdown = useMemo (() => {
    if (filterDivisionId === 'all') {
      return projectsList; 
    }
    if (!filterDivisionId) {
      return []; 
    }
    const numericDivisionId = parseInt(filterDivisionId, 10);
    if (isNaN(numericDivisionId)) {
      return []; 
    }
    return projectsList.filter(p => p.division_id === numericDivisionId);
  }, [projectsList, filterDivisionId]); 

  const handleOpenReassignModal = (file) => {
    if (!canPerformAction('reassign', file)) {
        showSnackbar("Permission denied.", "error");
        handleMenuClose();
        return;
    }
    if (!file) return;
    setFileToReassign(file);
    setSelectedProjectIdForReassign(file.project_id ?? ''); 
    setNewPlotNameForReassign(file.plot_name || ''); 
    setReassignModalOpen(true);
    handleMenuClose(); 
};

const handleCloseReassignModal = () => {
    if (isReassigning) return; 
    setReassignModalOpen(false);
    setTimeout(() => {
        setFileToReassign(null);
        setSelectedProjectIdForReassign('');
        setNewPlotNameForReassign('');
    }, 200);
};

const handleReassignFile = async () => {
    if (!fileToReassign || !canPerformAction('reassign', fileToReassign)) {
        showSnackbar("Permission denied.", "error");
        return;
    }
    if (!newPlotNameForReassign.trim()) {
        showSnackbar("Plot name cannot be empty.", "warning");
        return;
    }
    if (isReassigning) return; 

    const token = localStorage.getItem('authToken');
    if (!token) {
        showSnackbar("Authentication required.", "error");
        return;
    }

    const targetProjectId = selectedProjectIdForReassign === '' ? null : Number(selectedProjectIdForReassign);
    const targetPlotName = newPlotNameForReassign.trim();

    if (targetProjectId === fileToReassign.project_id && targetPlotName === fileToReassign.plot_name) {
        showSnackbar("No changes detected.", "info");
        return;
    }

    setIsReassigning(true);
    try {
        const response = await axios.patch(
            `${API_BASE_URL}/files/${fileToReassign.id}/reassign`,
            {
                projectId: targetProjectId, 
                plotName: targetPlotName
            },
            { headers: { 'Authorization': `Bearer ${token}` } }
        );

        if (response.data.success) {
            showSnackbar("File details updated successfully!", "success");
            handleCloseReassignModal();
            fetchFiles(); 
        } else {
            showSnackbar(response.data.message || "Failed to update file details.", "error");
        }
    } catch (error) {
        console.error("Error reassigning file:", error);
        showSnackbar(error.response?.data?.message || "Server error updating file details.", "error");
    } finally {
        setIsReassigning(false);
    }
};

const CREATE_NEW_DIVISION_VALUE = "__CREATE_NEW_DIVISION__"; 
const CREATE_NEW_PROJECT_VALUE = "__CREATE_NEW_PROJECT__";   


// --- BULK ACTION HANDLERS ---
const numTotalSelectableForDelete = useMemo(() => {
    return files.reduce((count, file) => {
        const isOptimisticallyProcessing = filesBeingProcessed.has(file.id);
        const backendFileStatus = file.status;
        const isFileCurrentlyConverting = ACTIVE_PIPELINE_PROCESSING_STATUSES.includes(backendFileStatus) || isOptimisticallyProcessing;

        if (!isFileCurrentlyConverting && canPerformAction('delete', file)) {
            return count + 1;
        }
        return count;
    }, 0);
}, [files, filesBeingProcessed, canPerformAction]); // canPerformAction needs to be stable

const handleSelectAllClick = (event) => {
    if (event.target.checked) {
        const newSelectedIds = new Set();
        files.forEach(file => {
            const isOptimisticallyProcessing = filesBeingProcessed.has(file.id);
            const backendFileStatus = file.status;
            const isFileCurrentlyConverting = ACTIVE_PIPELINE_PROCESSING_STATUSES.includes(backendFileStatus) || isOptimisticallyProcessing;

            if (!isFileCurrentlyConverting && canPerformAction('delete', file)) {
                newSelectedIds.add(file.id);
            }
        });
        setSelectedFileIds(newSelectedIds);
    } else {
        setSelectedFileIds(new Set());
    }
};

const handleRowCheckboxClick = (event, fileId) => {
    const newSelectedFileIds = new Set(selectedFileIds);
    if (event.target.checked) {
        newSelectedFileIds.add(fileId);
    } else {
        newSelectedFileIds.delete(fileId);
    }
    setSelectedFileIds(newSelectedFileIds);
};

const handleBulkDelete = async () => {
    if (selectedFileIds.size === 0) {
        showSnackbar("No files selected for deletion.", "warning");
        return;
    }

    // Close action menu if open
    setAnchorEl(null);
    setSelectedFile(null);

    const filesToDeleteObjects = files.filter(file => selectedFileIds.has(file.id)); // Get full objects
    const actuallyDeletableFiles = filesToDeleteObjects.filter(file => {
        const isOptimisticallyProcessing = filesBeingProcessed.has(file.id);
        const backendFileStatus = file.status;
        const isFileCurrentlyConverting = ACTIVE_PIPELINE_PROCESSING_STATUSES.includes(backendFileStatus) || isOptimisticallyProcessing;
        return !isFileCurrentlyConverting && canPerformAction('delete', file);
    });


    if (actuallyDeletableFiles.length === 0) {
        showSnackbar("None of the selected files can be deleted due to permissions or current status.", "warning");
        // Optionally clear selection if desired, or leave it for user to uncheck
        // setSelectedFileIds(new Set());
        return;
    }

    const numSelectedTotal = selectedFileIds.size;
    const numActuallyDeletable = actuallyDeletableFiles.length;
    const numNonDeletableInSelection = numSelectedTotal - numActuallyDeletable;

    let confirmMessage = `Are you sure you want to delete ${numActuallyDeletable} selected file(s)?`;
    if (numNonDeletableInSelection > 0) {
        confirmMessage += `\n(${numNonDeletableInSelection} other selected file(s) cannot be deleted at this time due to permissions or their current processing state.)`;
    }

    if (!window.confirm(confirmMessage)) {
        return;
    }

    setIsDeletingBulk(true);
    const token = localStorage.getItem('authToken');
    if (!token) {
        showSnackbar("Authentication required.", "error");
        setIsDeletingBulk(false);
        return;
    }

    let successCount = 0;
    let errorCount = 0;
    const deletionPromises = [];

    for (const file of actuallyDeletableFiles) {
        deletionPromises.push(
            axios.delete(`${API_BASE_URL}/files/${file.id}`, { headers: { 'Authorization': `Bearer ${token}` } })
                .then(res => {
                    if (res.status === 200 || res.status === 204) {
                        successCount++;
                    } else {
                        errorCount++;
                        console.warn(`Failed to delete ${file.name}: ${res.data?.message || 'Unknown error'}`);
                    }
                })
                .catch(err => {
                    errorCount++;
                    console.error(`Error deleting ${file.name}:`, err.response?.data?.message || err.message);
                })
        );
    }

    await Promise.allSettled(deletionPromises);

    let snackbarMsg = "";
    if (successCount > 0) snackbarMsg += `${successCount} file(s) deleted successfully. `;
    if (errorCount > 0) snackbarMsg += `${errorCount} file(s) failed to delete. `;
    if (numNonDeletableInSelection > 0 && successCount > 0 && errorCount === 0) snackbarMsg += `(${numNonDeletableInSelection} file(s) were not eligible for deletion).`;


    if (!snackbarMsg && numSelectedTotal > 0) { // Edge case if all failed or were non-deletable
        if (numNonDeletableInSelection === numSelectedTotal) {
            snackbarMsg = "No selected files were eligible for deletion.";
        } else {
             snackbarMsg = "Bulk deletion process completed. Check console for details if errors occurred.";
        }
    }


    showSnackbar(snackbarMsg, errorCount > 0 && successCount === 0 ? "error" : (errorCount > 0 ? "warning" : "success"));

    setSelectedFileIds(new Set()); // Clear selection
    setIsDeletingBulk(false);
    fetchFiles(); // Refresh the file list
};


    // --- STYLES ---
    const styles = {
        container: {
        display: "flex",
        minHeight: "100vh",
        bgcolor: colors.grey[800],
        // marginLeft and width are now applied directly in JSX sx prop for responsiveness
        // with isCollapsed state
        transition: "margin 0.3s ease",
        padding: 0
        // overflowX: 'hidden' will be on the JSX sx prop
        },
        content: {
        flex: 1,
        p: { xs: 1.5, sm: 2, md: 3 }, // Responsive padding
        overflowY: 'auto',
        overflowX: 'hidden', // Prevent content horizontal scroll
        maxWidth: '100%',    // Ensure content stays within bounds
        },
        controlsRow: {
        mb: { xs: 2, sm: 3 } // Responsive margin bottom
        },
        filterFormControl: {
        minWidth: { xs: 130, sm: 160, md: 180 }, // Responsive minWidth
        width: '100%', // Make form control take full width of its grid item
        '& .MuiInputLabel-root': {
            color: colors.grey[300],
            fontSize: { xs: '0.8rem', sm: '0.9rem', md: '1rem' }, // Responsive label
            '&.Mui-focused': { color: colors.blueAccent[300] }
        },
        '& .MuiOutlinedInput-root': {
            color: colors.grey[100],
            fontSize: { xs: '0.8rem', sm: '0.9rem', md: '1rem' }, // Responsive input text
            '& .MuiOutlinedInput-notchedOutline': { borderColor: colors.grey[500] },
            '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: colors.primary[300] },
            '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: colors.blueAccent[400] },
            '& .MuiSelect-icon': { color: colors.grey[300] },
        }
        },
        // --- Dialog Styles (Apply responsive principles here too) ---
        dialogPaper: {
        backgroundColor: colors.grey[800] || theme.palette.background.paper,
        color: colors.grey[100] || theme.palette.text.primary,
        // Consider responsive minWidth/maxWidth for dialogs if needed
        // e.g., minWidth: { xs: '90vw', sm: 'auto' }
        },
        dialogActions: {
        padding: { xs: theme.spacing(1.5, 2), sm: theme.spacing(2, 3) }, // Responsive padding
        backgroundColor: colors.primary[700] || theme.palette.action.hover,
        borderTop: `1px solid ${colors.grey[700] || theme.palette.divider}`,
        display: 'flex', // Added for flex properties
        flexDirection: { xs: 'column-reverse', sm: 'row' }, // Stack buttons on xs
        justifyContent: 'flex-end',
        '& > :not(style)': { // Spacing for buttons
            m: { xs: 0.5, sm: 0 },
            ml: { xs: 0, sm: 1 },
            width: { xs: '100%', sm: 'auto' } // Full width when stacked
        }
        },
        dialogSelectControl: {
        marginTop: theme.spacing(1),
        // Apply responsive font sizes to labels and selected values if needed
        '& .MuiInputLabel-root': { color: colors.grey[300], '&.Mui-focused': { color: colors.blueAccent[300] } },
        '& .MuiOutlinedInput-root': { /* ... */ color: colors.grey[300], /* ... */ }
        },
        dialogTextField: {
        // Apply responsive font sizes to labels and input text if needed
        '& label.Mui-focused': { color: colors.blueAccent[300] },
        '& .MuiOutlinedInput-root': { /* ... */ color: colors.grey[100], /* ... */ },
        '& .MuiInputLabel-root': { color: colors.grey[300] },
        },
        dialogTitle: {
        textAlign: "center",
        color: colors.grey?.[100] ?? "#000",
        paddingBottom: 0,
        fontWeight: 'bold',
        fontSize: { xs: '1.1rem', sm: '1.25rem', md: '1.5rem' } // Responsive font size
        },
        dialogContent: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        minWidth: { xs: '280px', sm: '350px' }, // Responsive minWidth
        padding: { xs: theme.spacing(1.5, 2), sm: theme.spacing(2,3) }, // Responsive padding
        color: colors.grey?.[100] ?? "#000"
        },
        fileDisplay: {
        textAlign: "center",
        padding: "15px",
        border: `1px dashed ${colors.grey?.[500] ?? "#888"}`,
        borderRadius: "5px",
        width: { xs: '95%', sm: '80%' }, // Responsive width
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
        width: { xs: '95%', sm: '80%' }, // Responsive width
        marginTop: theme.spacing(2)
        },
        // --- Table Styles ---
        tableContainer: {
        marginTop: selectedFileIds.size > 0 ? 1 : 2, // Dynamic margin based on bulk bar
        backgroundColor: colors.grey[900],
        borderRadius: 2,
        maxHeight: `calc(100vh - ${selectedFileIds.size > 0 ? '340px' : '280px'})`, // Dynamic height
        overflow: 'auto', // Enables both vertical and horizontal scroll
        position: 'relative',
        "&::-webkit-scrollbar": { width: "8px", height: "8px" }, // Added height for horizontal
        "&::-webkit-scrollbar-track": { background: colors.grey?.[700] },
        "&::-webkit-scrollbar-thumb": {
            backgroundColor: colors.grey?.[500] ?? "#888",
            borderRadius: "10px",
            border: `2px solid ${colors.grey?.[700] ?? "#3e4396"}`,
            "&:hover": { backgroundColor: colors.primary?.[300] ?? "#555" },
        }
        },
        table: {
        minWidth: { xs: 600, md: 750, lg: 900 }, // Responsive minWidth for the table
        width: '100%', // Ensures table tries to fit container before scrolling
        // tableLayout: 'fixed' // Uncomment if you want fixed column widths (more complex to manage)
        },
        tableHead: {
        backgroundColor: colors.primary[700],
        position: 'sticky', // Makes header sticky during vertical scroll
        top: 0,
        zIndex: 1 // Ensures header is above table body content
        },
        headCell: {
        color: colors.grey?.[100] ?? "white",
        fontWeight: "bold",
        whiteSpace: 'nowrap', // Prevents header text from wrapping
        borderBottom: `1px solid ${colors.grey[700]}`,
        p: { xs: '12px 6px', sm: '16px 8px' }, // Responsive padding
        fontSize: { xs: '0.75rem', sm: '0.875rem' }, // Responsive font size
        },
        bodyCell: {
        color: colors.grey?.[100] ?? "white",
        overflow: 'hidden', // Needed for textOverflow
        textOverflow: 'ellipsis', // Adds '...' for overflowed text
        whiteSpace: 'nowrap', // Prevents text from wrapping to next line
        borderBottom: `1px solid ${colors.grey[800]}`,
        p: { xs: '6px 6px', sm: '8px 8px' }, // Responsive padding
        fontSize: { xs: '0.75rem', sm: '0.875rem' }, // Responsive font size
        maxWidth: 150, // Default maxWidth for cells, override per column if needed
        },
        actionButton: {
        color: colors.grey?.[300] ?? '#cccccc',
        padding: { xs: '2px', sm: '4px' }, // Responsive padding for action icon
        '&:hover': {
            color: colors.blueAccent?.[400] ?? '#4ba5f8',
            backgroundColor: 'rgba(0, 123, 255, 0.1)',
        },
        '&.Mui-disabled': {
            color: colors.grey?.[600] ?? '#777777',
        }
        },
        statusText: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '4px',
        fontSize: { xs: '0.7rem', sm: '0.8rem' }, // Responsive font size for status
        },
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
        zIndex: 2, // Above table content, below sticky header if header zIndex is higher
        borderRadius: 'inherit'
        },
        // --- Styles for Settings Modals (Project Assignments, Division/Project Management) ---
        modalDialogPaper: { // For larger modals like settings
        backgroundColor: colors.grey[800],
        color: colors.grey[100],
        minWidth: { xs: '95vw', sm: '70vw', md: '600px' }, // Responsive minWidth
        maxWidth: {md: '800px'}, // Max width on larger screens
        },
        modalDialogContent: { // For settings modals
        padding: { xs: theme.spacing(1.5, 1.5), sm: theme.spacing(2, 3) }, // Responsive padding
        maxHeight: { xs: '80vh', sm: '70vh' }, // Responsive maxHeight
        overflowY: 'auto'
        },
        modalDialogActions: { // For settings modals
        padding: { xs: theme.spacing(1, 1.5), sm: theme.spacing(1, 3) }, // Responsive padding
        backgroundColor: colors.primary[700],
        borderTop: `1px solid ${colors.grey[700]}`,
        // Responsive flex direction handled in dialogActions above, can be reused or specified
        },
        modalAccordion: {
        backgroundColor: colors.grey[800], // Keep as is or make slightly different from paper for depth
        color: colors.grey[100],
        mb: 1,
        '&.Mui-expanded': { margin: '8px 0' }
        },
        modalAccordionDetails: {
        backgroundColor: colors.grey[800], // Or slightly darker/lighter than accordion summary
        p: { xs: 1, sm: 2 } // Responsive padding
        },
        modalListItemIcon: {
        color: colors.redAccent[400],
        minWidth: 'auto',
        '&:hover': {
            backgroundColor: 'rgba(255, 0, 0, 0.1)',
        }
        },
        settingsModalDeleteButton: {
        color: colors.redAccent[400],
        marginLeft: 'auto',
        padding: { xs: '2px', sm: '4px' }, // Responsive padding
        '&:hover': {
            backgroundColor: 'rgba(255, 0, 0, 0.1)',
        },
        '&.Mui-disabled': {
            color: colors.grey[600],
        }
        },
    };

  // --- RENDER LOGIC ---
  if (isLoadingPermissions) {
    return (
      <Box sx={{ ...styles.container, justifyContent: "center", alignItems: "center", ml: 0 }}>
        <CircularProgress />
        <Typography sx={{ ml: 2, color: colors.grey[300] }}>Loading Permissions...</Typography>
      </Box>
    );
  }

  if (!userRole || !userId) {
    return (
      <Box sx={{ ...styles.container, justifyContent: "center", alignItems: "center", ml: 0 }}>
        <Alert severity={snackbarSeverity || "error"} variant="filled" sx={{ maxWidth: '80%' }}>
          {snackbarMessage || "Authentication failed. Please log in."}
        </Alert>
        <Button variant="contained" onClick={() => navigate('/login')} sx={{ mt: 2 }}>Login</Button>
      </Box>
    );
  }

  return (
    <Box sx={{ 
        display: "flex",
        minHeight: "100vh",
        bgcolor: colors.grey[800],
        marginLeft: { // Responsive margin
            xs: isCollapsed ? "80px" : "80px",
            sm: isCollapsed ? "80px" : "270px",
        },
        transition: "margin 0.3s ease",
        padding: 0,
        width: { // Ensure it takes available width after margin
        xs: `calc(100% - ${isCollapsed ? "80px" : "80px"})`,
        sm: `calc(100% - ${isCollapsed ? "80px" : "270px"})`
        },
        overflowX: 'hidden',
    }}>
      <Box sx={styles.content}> 
        <Grid
          container
          spacing={{ xs: 1, sm: 2 }} // Responsive spacing between grid items
          sx={styles.controlsRow}
          alignItems="center"
          // justifyContent="space-between" // This can be tricky with conditional elements. We'll manage spacing with grid items.
        >
          {/* Upload Button - Takes full width on xs, auto on sm up */}
          <Grid item xs={12} sm={6} md="auto"> {/* Allow it to take more space initially */}
            {canPerformAction('upload') && (
              <Button
                fullWidth // Button will be fullWidth within its Grid item
                variant="contained"
                startIcon={<UploadFileIcon />}
                size={theme.breakpoints.down('sm') ? "small" : "medium"} // Responsive size
                sx={{
                    backgroundColor: colors.primary[700],
                    color: "white",
                    "&:hover": { backgroundColor: colors.primary[400] },
                    textTransform: 'none',
                    py: { xs: 0.8, sm: 1 },
                }}
                onClick={handleOpenUploadModal}
                disabled={isUploading || isLoading || loadingProjectsList || !!deletingProjectId || isDeletingBulk || !!deletingDivisionId }
              >
                Upload File
              </Button>
            )}
          </Grid>

          {/* Spacer: Pushes subsequent items to the right. Only active if not xs. */}
          <Grid item xs={false} sm />


          {/* Admin Buttons & Filters - Grouped for flex-end behavior */}
          {/* This inner Grid helps group items that should be pushed to the end */}
            {userRole === ROLES.ADMIN && (
                <>
                <Grid item xs={12} sm={6} md="auto" sx={{ mt: { xs: 1, sm: 0 } }}> {/* Margin top on xs if stacked */}
                    <Tooltip title="Manage Division and Project Settings">
                        <Button
                            fullWidth // Full width within its Grid item
                            variant="outlined"
                            size={theme.breakpoints.down('sm') ? "small" : "medium"}
                            startIcon={<SettingsIcon />}
                            sx={{
                                borderColor: colors.blueAccent[500], color: colors.blueAccent[400],
                                '&:hover': { borderColor: colors.blueAccent[300], backgroundColor: 'rgba(75, 165, 248, 0.1)' },
                                textTransform: 'none',
                                '.MuiButton-startIcon': { mr: {xs: 0.5, sm: 1} },
                                py: { xs: 0.8, sm: 1 },
                            }}
                            onClick={handleOpenDivisionProjectSettingsModal}
                            disabled={loadingProjectsList || loadingDivisionsList || isLoading || !!deletingProjectId || isDeletingBulk || !!deletingDivisionId}
                        >
                            {/* Conditional text rendering */}
                            <Typography component="span" sx={{ display: { xs: 'none', md: 'inline' } }}>Manage Structure</Typography>
                            <Typography component="span" sx={{ display: { xs: 'inline', md: 'none' } }}>Structure</Typography>
                        </Button>
                    </Tooltip>
                </Grid>
                <Grid item xs={12} sm={6} md="auto" sx={{ mt: { xs: 1, sm: 0 } }}>
                    <Tooltip title="Manage Data Manager Assignments">
                        <Button
                            fullWidth
                            variant="outlined"
                            size={theme.breakpoints.down('sm') ? "small" : "medium"}
                            startIcon={<AdminPanelSettingsIcon />}
                            sx={{
                                borderColor: colors.blueAccent[500], color: colors.blueAccent[400],
                                '&:hover': { borderColor: colors.blueAccent[300], backgroundColor: 'rgba(75, 165, 248, 0.1)' },
                                textTransform: 'none',
                                '.MuiButton-startIcon': { mr: {xs: 0.5, sm: 1} },
                                py: { xs: 0.8, sm: 1 },
                            }}
                            onClick={handleOpenProjectSettingsModal}
                            disabled={loadingProjectsList || loadingModalDMs || isLoading || !!deletingProjectId || isDeletingBulk || !!deletingDivisionId}
                        >
                            <Typography component="span" sx={{ display: { xs: 'none', md: 'inline' } }}>Assignments</Typography>
                            <Typography component="span" sx={{ display: { xs: 'inline', md: 'none' } }}>Assign</Typography>
                        </Button>
                    </Tooltip>
                </Grid>
                </>
            )}

            {/* Division Filter */}
            <Grid item xs={12} sm={userRole === ROLES.ADMIN ? 6 : 6} md="auto" sx={{ mt: { xs: 1, sm: (userRole === ROLES.ADMIN ? 0 : 0), md: 0 } }}>
                <FormControl fullWidth variant="outlined" size="small" sx={styles.filterFormControl}>
                    {/* Pass responsive fontSize to InputLabel if defined in styles.filterFormControl */}
                    <InputLabel id="division-filter-label" sx={{fontSize: styles.filterFormControl?.['& .MuiInputLabel-root']?.fontSize}}>
                        Filter Division
                    </InputLabel>
                    <Select
                        labelId="division-filter-label"
                        id="division-filter-select"
                        value={filterDivisionId}
                        label="Filter Division"
                        onChange={handleDivisionFilterChange}
                        disabled={isLoading || loadingDivisionsList || !!deletingProjectId || isDeletingBulk || !!deletingDivisionId}
                        MenuProps={{ /* ... your MenuProps ... */ }}
                    >
                        <MenuItem value="all"><em>All Divisions</em></MenuItem>
                        {divisionsList.map(d=>(<MenuItem key={d.id} value={d.id}>{d.name}</MenuItem>))}
                    </Select>
                </FormControl>
            </Grid>

            {/* Project Filter */}
            <Grid item xs={12} sm={userRole === ROLES.ADMIN ? 6 : 6} md="auto" sx={{ mt: { xs: 1, sm: (userRole === ROLES.ADMIN ? 0 : 0), md: 0 } }}>
                <FormControl fullWidth variant="outlined" size="small" sx={styles.filterFormControl}>
                    <InputLabel id="project-filter-label" sx={{fontSize: styles.filterFormControl?.['& .MuiInputLabel-root']?.fontSize}}>
                        Filter Project
                    </InputLabel>
                    <Select
                        labelId="project-filter-label"
                        id="project-filter-select"
                        value={filterProjectId}
                        label="Filter Project"
                        onChange={handleProjectFilterChange}
                        disabled={isLoading || loadingProjectsList || !!deletingProjectId || isDeletingBulk || !!deletingDivisionId}
                        MenuProps={{ /* ... your MenuProps ... */ }}
                    >
                        <MenuItem value="all"><em>All Projects</em></MenuItem>
                        {loadingProjectsList
                            ? <MenuItem disabled><CircularProgress size={20} sx={{mr: 1}}/> Loading...</MenuItem>
                            : filteredProjectsForDropdown.map(p => (
                                <MenuItem key={p.id} value={p.id}>
                                    {p.name}
                                    {filterDivisionId === 'all' && ` (${p.division_name || 'No Div'})`}
                                </MenuItem>
                            ))
                        }
                        {!loadingProjectsList && filterDivisionId !== 'all' && filteredProjectsForDropdown.length === 0 && (
                            <MenuItem disabled sx={{ fontStyle: 'italic' }}>No projects in this division</MenuItem>
                        )}
                    </Select>
                </FormControl>
            </Grid>
        </Grid>

        {/* --- Bulk Actions Bar --- */}
        {selectedFileIds.size > 0 && (
            <Paper
                elevation={3}
                sx={{
                    padding: theme.spacing(1.5, 2),
                    marginBottom: theme.spacing(2), // Space before the table
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    backgroundColor: colors.primary[700], // Darker background for contrast
                    border: `1px solid ${colors.blueAccent[700]}`,
                    borderRadius: '4px',
                    position: 'sticky', // Make it sticky if you want it to stay visible while scrolling table
                    top: theme.spacing(1), // Adjust as needed if you have a sticky header above
                    zIndex: 2, // Ensure it's above the table content but below modals
                }}
            >
                <Box display="flex" alignItems="center">
                    {/* --- WRAP CHECKBOX WITH TOOLTIP --- */}
                    <Tooltip title="Clear selection" arrow>
                        {/* MUI Tooltip needs a DOM element to attach to.
                            If the Checkbox itself doesn't forward refs or if it's disabled,
                            the Tooltip might not work directly. Wrapping with a span is a safe bet. */}
                        <span>
                            <Checkbox
                                checked={selectedFileIds.size > 0}
                                indeterminate={selectedFileIds.size > 0 && selectedFileIds.size < numTotalSelectableForDelete}
                                onClick={() => setSelectedFileIds(new Set())} // Clears selection
                                size="small"
                                sx={{
                                    color: colors.blueAccent[200],
                                    '&.Mui-checked': { color: colors.blueAccent[300] },
                                    '&.Mui-disabled': { color: colors.grey[600] },
                                    mr: 1
                                }}
                                disabled={isDeletingBulk /* || any other bulk action in progress */}
                            />
                        </span>
                    </Tooltip>
                    {/* --- END OF TOOLTIP WRAPPER --- */}
                    <Typography sx={{ color: colors.grey[100], fontWeight: 'bold' }}>
                        {selectedFileIds.size} file(s) selected
                    </Typography>
                </Box>
                <Tooltip title="Delete Selected Files">
                    <span> {/* Span for Tooltip when button is disabled */}
                        <Button
                            variant="contained"
                            startIcon={isDeletingBulk ? <CircularProgress size={20} color="inherit" /> : <DeleteIcon />}
                            onClick={handleBulkDelete}
                            disabled={isDeletingBulk || isLoading || !!deletingProjectId || !!deletingDivisionId} // Removed selectedFileIds.size === 0 here as the bar itself is conditional
                            sx={{
                                backgroundColor: colors.redAccent[600],
                                color: colors.grey[100],
                                '&:hover': { backgroundColor: colors.redAccent[700] },
                                '&.Mui-disabled': {
                                    backgroundColor: colors.grey[700],
                                    color: colors.grey[500]
                                }
                            }}
                        >
                            Delete Selected
                        </Button>
                    </span>
                </Tooltip>
            </Paper>
        )}

        {/* --- Dialogs --- */}
        <Dialog
            open={reassignModalOpen}
            onClose={handleCloseReassignModal}
            disableEscapeKeyDown={isReassigning}
            PaperProps={{ sx: styles.dialogPaper }}
        >
            <DialogTitle sx={styles.dialogTitle}>
                Edit Details for "{fileToReassign?.name}"
            </DialogTitle>
            <DialogContent sx={styles.dialogContent}>
                <TextField
                    autoFocus 
                    margin="dense"
                    id="reassign-plot-name"
                    label="Plot Name"
                    type="text"
                    fullWidth
                    required
                    variant="outlined"
                    value={newPlotNameForReassign}
                    onChange={(e) => setNewPlotNameForReassign(e.target.value)}
                    disabled={isReassigning}
                    sx={styles.dialogTextField}
                />
                <FormControl fullWidth variant="outlined" margin="dense" size="small" sx={styles.dialogSelectControl} disabled={isReassigning || loadingProjectsList}>
                    <InputLabel id="reassign-project-select-label">Project</InputLabel>
                    <Select
                        labelId="reassign-project-select-label"
                        id="reassign-project-select"
                        value={selectedProjectIdForReassign}
                        label="Project"
                        onChange={(e) => setSelectedProjectIdForReassign(e.target.value)}
                        MenuProps={{ PaperProps: { sx: { backgroundColor: colors.primary[600], color: colors.grey[100], '& .MuiMenuItem-root:hover': { backgroundColor: colors.primary[500], }, '& .MuiMenuItem-root.Mui-selected': { backgroundColor: colors.blueAccent[700]+'!important', color:colors.grey[100]}}},}}
                    >
                        <MenuItem value=""><em>Unassigned</em></MenuItem>
                        {loadingProjectsList ? <MenuItem disabled><CircularProgress size={20} sx={{mr: 1}}/> Loading...</MenuItem> : projectsList.map((p) => (
                            <MenuItem
                                key={p.id}
                                value={p.id}
                            >
                                {p.name} ({p.division_name || 'No Div'})
                            </MenuItem>
                        ))}
                    </Select>
                </FormControl>
            </DialogContent>
            <DialogActions sx={styles.dialogActions}>
                <Button onClick={handleCloseReassignModal} color="secondary" disabled={isReassigning}>
                    Cancel
                </Button>
                <Button
                    onClick={handleReassignFile}
                    color="primary"
                    disabled={
                        isReassigning ||
                        !newPlotNameForReassign.trim() || 
                        (selectedProjectIdForReassign === (fileToReassign?.project_id ?? '') && 
                        newPlotNameForReassign.trim() === (fileToReassign?.plot_name || '')) 
                        }
                    variant="contained"
                >
                    {isReassigning ? <CircularProgress size={24} color="inherit"/> : "Save Changes"}
                </Button>
            </DialogActions>
        </Dialog>
        
        <Dialog open={openUploadModal} onClose={handleCloseUploadModal} disableEscapeKeyDown={isUploading} PaperProps={{ sx: styles.dialogPaper }}>
            <DialogTitle sx={styles.dialogTitle}>Upload New File</DialogTitle>
            <DialogContent sx={styles.dialogContent}>
                <Button // THIS IS THE BUTTON TO STYLE
                    // variant="outlined" // PREVIOUS
                    variant="contained" // CHANGED TO "contained"
                    onClick={triggerFileInput}
                    disabled={isUploading}
                    sx={{
                        mb: 1,
                        color: colors.grey[100], // Light text for good contrast on solid blue
                        backgroundColor: 'rgb(40, 173, 226)', 
                        transition: theme.transitions.create(
                            ['background-color', 'color'], // Only need to transition these now
                            { duration: theme.transitions.duration.short }
                        ),
                        '&:hover': {
                            backgroundColor: 'rgb(58, 168, 211)', 
                        },
                        '&.Mui-disabled': {
                            backgroundColor: colors.grey[700], // Example of a specific disabled background
                            color: colors.grey[500],          // Example of a specific disabled text color
                        }
                    }}
                >
                    Select File (.las/.laz)
                </Button>
                <input type="file" ref={fileInputRef} style={{ display: "none" }} onChange={handleFileChange} disabled={isUploading} accept=".las,.laz"/>
                <Box sx={styles.fileDisplay}>
                    {newFile ? (<><Typography>{newFile.name}</Typography><Typography variant="body2" sx={{ color: colors.grey[300], mt: 0.5 }}>{(newFile.size/1024/1024).toFixed(2)} MB</Typography></>) : <Typography sx={{ color: colors.grey[400] }}>No file selected</Typography>}
                </Box>
                {isUploading && uploadProgress !== null && ( <Box sx={styles.uploadProgressContainer}><LinearProgress variant="determinate" value={uploadProgress} /><Typography variant="caption" display="block" sx={{ textAlign: 'center', mt: 0.5 }}>{uploadProgress}%</Typography></Box> )}
                <TextField
                  label="Plot Name (Required)"
                  value={plotName}
                  onChange={(e) => setPlotName(e.target.value)}
                  fullWidth
                  variant="outlined"
                  margin="dense"
                  sx={styles.dialogTextField}
                />
                <FormControlLabel
                    control={
                        <Switch
                            checked={skipSegmentation}
                            onChange={(e) => setSkipSegmentation(e.target.checked)}
                            disabled={isUploading}
                        />
                    }
                    label="Skip Tree Segmentation (Faster for Viewing Only)"
                    sx={{ mt: 1, color: colors.grey[300] }}
                />
                <FormControl fullWidth margin="dense" sx={styles.dialogSelectControl} disabled={isUploading}>
                  <InputLabel id="project-select-label-upload">Assign to Project (Required)</InputLabel>
                  <Select
                    labelId="project-select-label-upload"
                    value={selectedProjectId}
                    onChange={(e) => {
                        const value = e.target.value;
                        if (value === CREATE_NEW_PROJECT_VALUE) {
                            handleOpenCreateProjectModal();
                        } else {
                            setSelectedProjectId(value);
                        }
                    }}
                    label="Assign to Project (Required)"
                    MenuProps={{ PaperProps: { sx: { color: colors.grey[100], '& .MuiMenuItem-root:hover': { backgroundColor: colors.primary[500], }, '& .MuiMenuItem-root.Mui-selected': { backgroundColor: colors.blueAccent[700]+'!important', color:colors.grey[100]}}},}}
                  >
                    <MenuItem value=""><em>-- No Project Created --</em></MenuItem>
                     {loadingProjectsList ? <MenuItem disabled><CircularProgress size={20} sx={{mr: 1}}/> Loading...</MenuItem> : projectsList.map((proj) => (
                        <MenuItem key={proj.id} value={proj.id}>
                          {proj.name} ({proj.division_name || 'No Div'})
                        </MenuItem>
                      ))}
                    {userRole === ROLES.ADMIN && (
                      <MenuItem value={CREATE_NEW_PROJECT_VALUE} sx={{ fontStyle: 'italic', color: colors.greenAccent[400] }}>
                          <ListItemIcon sx={{ minWidth: '32px', color: 'inherit' }}><AddCircleOutlineIcon fontSize="small" /></ListItemIcon>
                          <ListItemText>New Project...</ListItemText>
                      </MenuItem>
                    )}
                  </Select>
                </FormControl>
            </DialogContent>
            <DialogActions sx={styles.dialogActions}>
                {isUploading ? (
                    // Show cancel upload button during upload
                    <Button
                        onClick={handleCancelUpload}
                        variant="outlined"
                        sx={{
                            color: colors.redAccent[400],
                            borderColor: colors.redAccent[400],
                            transition: theme.transitions.create(
                                ['color', 'border-color', 'background-color'],
                                { duration: theme.transitions.duration.short }
                            ),
                            '&:hover': {
                                color: colors.grey[100],
                                borderColor: colors.redAccent[500],
                                backgroundColor: colors.redAccent[500]
                            }
                        }}
                    >
                        Cancel Upload
                    </Button>
                ) : (
                    // Show regular cancel button when not uploading
                    <Button
                        onClick={handleCloseUploadModal}
                        variant="outlined"
                        sx={{
                            color: colors.grey[100],        // Default text color
                            borderColor: colors.grey[500],  // Default border color
                            transition: theme.transitions.create( // Optional: for a smoother transition
                                ['color', 'border-color', 'background-color'],
                                { duration: theme.transitions.duration.short }
                            ),
                            '&:hover': {
                                color: colors.black,
                                borderColor: colors.redAccent[400],   // Red border on hover
                                backgroundColor: colors.redAccent[500]
                            },
                            '&.Mui-disabled': {
                                color: colors.grey[600],
                                borderColor: colors.grey[700],
                            }
                        }}
                    >
                        Cancel
                    </Button>
                )}
                <Button // UPLOAD BUTTON - MODIFIED SX
                    onClick={handleFileUpload}
                    disabled={isUploading || !newFile || !selectedProjectId || !plotName.trim()}
                    variant="contained"
                    sx={{
                        // When the button is ENABLED (i.e., upload requirements are met and not uploading)
                        backgroundColor: colors.greenAccent[500], // Green color when ready
                        color: colors.grey[100], // Ensure text contrast on green
                        '&:hover': {
                            backgroundColor: colors.greenAccent[400], // Slightly darker or lighter green on hover
                        },
                        // When the button is DISABLED
                        '&.Mui-disabled': {
                            backgroundColor: colors.grey[600], // Standard disabled background
                            color: colors.grey[400],         // Standard disabled text color
                        }
                    }}
                >
                    {isUploading ? <CircularProgress size={24} color="inherit"/> : "Upload"}
                </Button>
            </DialogActions>
        </Dialog>

        <Dialog open={createDivisionModalOpen} onClose={handleCloseCreateDivisionModal} disableEscapeKeyDown={isCreatingDivision} PaperProps={{ sx: styles.dialogPaper }}>
            <DialogTitle sx={styles.dialogTitle}>Create New Division</DialogTitle>
            <DialogContent sx={styles.dialogContent}><TextField autoFocus margin="dense" id="new-division-name" label="Division Name" type="text" fullWidth variant="outlined" value={newDivisionName} onChange={(e) => setNewDivisionName(e.target.value.trimStart())} disabled={isCreatingDivision} required sx={styles.dialogTextField}/></DialogContent>
            <DialogActions sx={styles.dialogActions}><Button onClick={handleCloseCreateDivisionModal} color="secondary" disabled={isCreatingDivision}>Cancel</Button><Button onClick={handleCreateDivision} color="primary" disabled={isCreatingDivision || !newDivisionName.trim()} variant="contained">{isCreatingDivision ? <CircularProgress size={24} color="inherit"/> : "Create"}</Button></DialogActions>
        </Dialog>

        <Dialog open={createProjectModalOpen} onClose={handleCloseCreateProjectModal} disableEscapeKeyDown={isCreatingProject} PaperProps={{ sx: styles.dialogPaper }}>
            <DialogTitle sx={styles.dialogTitle}>Create New Project</DialogTitle>
            <DialogContent sx={styles.dialogContent}>
                 <FormControl fullWidth required variant="outlined" margin="dense" size="small" sx={styles.dialogSelectControl} disabled={isCreatingProject || loadingDivisionsList}>
                    <InputLabel id="create-project-division-label">Division</InputLabel>
                    <Select
                        labelId="create-project-division-label"
                        id="create-project-division-select"
                        value={selectedDivisionIdForCreation}
                        label="Division *" 
                        onChange={(e) => {
                          const value = e.target.value;
                          if (value === CREATE_NEW_DIVISION_VALUE) {
                              handleOpenCreateDivisionModal();
                          } else {
                              setSelectedDivisionIdForCreation(value);
                          }
                      }}
                      MenuProps={{ PaperProps: { sx: { color: colors.grey[100], '& .MuiMenuItem-root:hover': { backgroundColor: colors.primary[500], }, '& .MuiMenuItem-root.Mui-selected': { backgroundColor: colors.blueAccent[700]+'!important', color:colors.grey[100]}}},}}
                  >
                         <MenuItem value="" disabled><em>Select Division...</em></MenuItem>
                         {loadingDivisionsList ? <MenuItem disabled><CircularProgress size={20} sx={{mr: 1}}/> Loading...</MenuItem> : divisionsList.map((div) => ( <MenuItem key={div.id} value={div.id}>{div.name}</MenuItem> ))}
                         {userRole === ROLES.ADMIN && ( 
                            <MenuItem value={CREATE_NEW_DIVISION_VALUE} sx={{ fontStyle: 'italic', color: colors.greenAccent[400] }}>
                                <ListItemIcon sx={{ minWidth: '32px', color: 'inherit' }}>
                                   <AddCircleOutlineIcon fontSize="small" />
                                </ListItemIcon>
                               <ListItemText>New Division...</ListItemText>
                            </MenuItem>
                         )}
                    </Select>
                </FormControl>
                <TextField autoFocus margin="dense" id="new-project-name" label="Project Name" type="text" fullWidth required variant="outlined" value={newProjectName} onChange={(e) => setNewProjectName(e.target.value.trimStart())} disabled={isCreatingProject} sx={styles.dialogTextField}/>
            </DialogContent>
            <DialogActions sx={styles.dialogActions}>
                <Button onClick={handleCloseCreateProjectModal} color="secondary" disabled={isCreatingProject}>Cancel</Button>
                <Button
                    onClick={handleCreateProject}
                    color="primary"
                    disabled={isCreatingProject || !newProjectName.trim() || !selectedDivisionIdForCreation}
                    variant="contained"
                >
                    {isCreatingProject ? <CircularProgress size={24} color="inherit"/> : "Create"}
                </Button>
            </DialogActions>
        </Dialog>

        <Dialog open={assignProjectModalOpen} onClose={handleCloseAssignProjectModal} disableEscapeKeyDown={isAssigningProject} PaperProps={{ sx: styles.dialogPaper }}>
            <DialogTitle sx={styles.dialogTitle}>Assign Project to "{fileToAssignProject?.name}"</DialogTitle>
            <DialogContent sx={styles.dialogContent}>
                <FormControl fullWidth variant="outlined" size="small" sx={styles.dialogSelectControl}>
                    <InputLabel id="assign-project-select-label">Project</InputLabel>
                    <Select labelId="assign-project-select-label" id="assign-project-select" value={selectedProjectIdForAssignment} label="Project" onChange={(e) => setSelectedProjectIdForAssignment(e.target.value)} disabled={isAssigningProject || !!deletingProjectId} MenuProps={{ PaperProps: { sx: { backgroundColor: colors.primary[600], color: colors.grey[100], '& .MuiMenuItem-root:hover': { backgroundColor: colors.primary[500], }, '& .MuiMenuItem-root.Mui-selected': { backgroundColor: colors.blueAccent[700]+'!important', color:colors.grey[100]}}},}}>
                        <MenuItem value=""><em>Unassigned</em></MenuItem>
                        {projectsList.map((p) => ( <MenuItem key={p.id} value={p.id}>{p.name} ({p.division_name || 'No Div'})</MenuItem> ))}
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

        <Dialog open={isProjectSettingsModalOpen} onClose={handleCloseProjectSettingsModal} disableEscapeKeyDown={!!processingAssignmentInModal || !!deletingProjectId || isDeletingBulk} fullWidth maxWidth="md" PaperProps={{ sx: styles.modalDialogPaper }}>
             <DialogTitle sx={{ textAlign:"center", fontWeight:'bold', m:0, p:2, borderBottom:`1px solid ${colors.grey[600]}` }}>
                 Manage Data Manager Assignments
                 <IconButton aria-label="close" onClick={handleCloseProjectSettingsModal} sx={{ position:'absolute', right:8, top:8, color:(t)=>t.palette.grey[500] }} disabled={!!processingAssignmentInModal || !!deletingProjectId || isDeletingBulk}>
                     <CloseIcon />
                 </IconButton>
             </DialogTitle>
             <DialogContent sx={styles.modalDialogContent}>
                 {(loadingProjectsList || loadingModalDMs) && <Box display="flex" justifyContent="center" my={2}><CircularProgress/></Box>}
                 {!loadingProjectsList && !loadingModalDMs && projectsList.length === 0 && ( <Typography sx={{textAlign:'center', my:2, color:colors.grey[400]}}>No projects.</Typography> )}
                 {!loadingProjectsList && !loadingModalDMs && projectsList.length > 0 && allDataManagers.length === 0 && ( <Typography sx={{textAlign:'center', my:2, color:colors.grey[400]}}>No 'Data Manager' users.</Typography> )}
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
                                 <Accordion
                                     key={project.id}
                                     onChange={handleModalAccordionChange(project.id)}
                                     sx={styles.modalAccordion}
                                     TransitionProps={{ unmountOnExit: true }}
                                     disabled={isDeletingThisProject || isDeletingBulk} 
                                 >
                                     <AccordionSummary
                                         expandIcon={<ExpandMoreIcon sx={{color:colors.grey[100]}}/>}
                                         aria-controls={`modal-p${project.id}-content`}
                                         id={`modal-p${project.id}-header`}
                                         sx={{ opacity: isDeletingThisProject ? 0.5 : 1 }} 
                                     >
                                         <Typography sx={{ flexShrink:0, mr:2, fontWeight:'bold' }}>{project.name}</Typography>
                                         <Chip size="small" label={`${currentAssigned.length} Mgr(s)`} icon={<AdminPanelSettingsIcon fontSize="small"/>} sx={{ backgroundColor: colors.blueAccent[700], color: colors.grey[100] }}/>
                                         {isAccordionLoading && !isDeletingThisProject && <CircularProgress size={20} sx={{ ml: 2 }}/>}
                                         {userRole === ROLES.ADMIN && (
                                             <Tooltip title={`Delete Project "${project.name}"`}>
                                                 <span>
                                                     <IconButton
                                                         aria-label={`delete-project-${project.id}`}
                                                         onClick={(e) => {
                                                             e.stopPropagation(); 
                                                             handleDeleteProject(project.id, project.name);
                                                         }}
                                                         disabled={isProcessingThisProject || isAccordionLoading || !!deletingProjectId || isDeletingBulk}
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
                                                         <IconButton edge="end" aria-label="remove" onClick={()=>handleRemoveManagerInModal(project.id, m.id, m.username)} disabled={isProcessingThisProject || isAccordionLoading || isDeletingThisProject || isDeletingBulk} title={`Remove ${m.username}`} size="small">
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
                                                 <FormControl variant="outlined" size="small" sx={{ minWidth: 200, flexGrow: 1 }} disabled={isProcessingThisProject || isAccordionLoading || isDeletingThisProject || isDeletingBulk}>
                                                     <InputLabel id={`modal-adm-lbl-${project.id}`}>Select Manager</InputLabel>
                                                     <Select labelId={`modal-adm-lbl-${project.id}`} value={selectedUserIdInDropdown} label="Select Manager" onChange={(e)=>handleSelectManagerChangeInModal(project.id,e)} MenuProps={{ PaperProps:{ sx:{backgroundColor: colors.primary[600],color: colors.grey[100]}}}}>
                                                         <MenuItem value="" disabled><em>Select...</em></MenuItem>
                                                         {unassignedForDropdown.map(m=>(<MenuItem key={m.id} value={m.id}>{m.username} ({m.email})</MenuItem>))}
                                                     </Select>
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
                <Button onClick={handleCloseProjectSettingsModal} color="inherit" disabled={!!processingAssignmentInModal || !!deletingProjectId || isDeletingBulk}>Close</Button>
            </DialogActions>
        </Dialog>

       <Dialog
           open={isDivisionProjectSettingsModalOpen}
           onClose={handleCloseDivisionProjectSettingsModal}
           disableEscapeKeyDown={!!deletingDivisionId || !!deletingProjectId || isDeletingBulk}
           fullWidth
           maxWidth="sm" 
           PaperProps={{ sx: styles.modalDialogPaper }} 
       >
           <DialogTitle sx={{ textAlign:"center", fontWeight:'bold', m:0, p:2, borderBottom:`1px solid ${colors.grey[600]}` }}>
               Manage Divisions & Projects
               <IconButton
                   aria-label="close"
                   onClick={handleCloseDivisionProjectSettingsModal}
                   sx={{ position:'absolute', right:8, top:8, color:(t)=>t.palette.grey[500] }}
                   disabled={!!deletingDivisionId || !!deletingProjectId || isDeletingBulk}
               >
                   <CloseIcon />
               </IconButton>
           </DialogTitle>
           <DialogContent sx={styles.modalDialogContent}>
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
                                               <span>
                                                   <IconButton
                                                       edge="end"
                                                       aria-label={`delete-division-${division.id}`}
                                                       onClick={() => handleDeleteDivision(division.id, division.name)}
                                                       disabled={!!deletingDivisionId || !!deletingProjectId || isDeletingBulk}
                                                       size="small"
                                                       sx={{
                                                           ...styles.modalListItemIcon, 
                                                           opacity: (!!deletingDivisionId || !!deletingProjectId || isDeletingBulk) && !isDeletingThis ? 0.5 : 1, 
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
                   {userRole === ROLES.ADMIN && ( 
                    <Button
                      variant="contained" // CHANGED to "contained"
                      startIcon={<AddCircleOutlineIcon />}
                      sx={{
                        mt: 1,
                        backgroundColor: colors.greenAccent[500], // Green background
                        color: theme.palette.mode === 'dark' ? colors.grey[800] : 'black', // Black or dark grey text
                        textTransform: 'none',
                        '&:hover': {
                            backgroundColor: colors.greenAccent[600], // Slightly darker/different green on hover
                        },
                        '&.Mui-disabled': {
                            backgroundColor: colors.grey[700],
                            color: colors.grey[500],
                        },
                        // Ensure icon color matches text if needed
                        '.MuiButton-startIcon > *:nth-of-type(1)': {
                           color: theme.palette.mode === 'dark' ? colors.grey[800] : 'black',
                        }
                      }}
                      onClick={handleOpenCreateDivisionModal}
                      fullWidth
                      disabled={!!deletingDivisionId || !!deletingProjectId || isDeletingBulk}
                    >
                      New Division
                    </Button>
                  )}
               </Box>

               <Divider sx={{ my: 2, borderColor: colors.grey[700] }} />

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
                                               <span>
                                                   <IconButton
                                                       edge="end"
                                                       aria-label={`delete-project-${project.id}`}
                                                       onClick={() => handleDeleteProject(project.id, project.name)}
                                                       disabled={!!deletingDivisionId || !!deletingProjectId || isDeletingBulk}
                                                       size="small"
                                                        sx={{
                                                           ...styles.modalListItemIcon, 
                                                           opacity: (!!deletingDivisionId || !!deletingProjectId || isDeletingBulk) && !isDeletingThis ? 0.5 : 1, 
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
                                       <ListItemText 
                                         primary={project.name} 
                                         secondary={`Division: ${project.division_name || 'N/A'}`}
                                         primaryTypographyProps={{ sx: { color: colors.grey[100] } }}
                                         secondaryTypographyProps={{ sx: { color: colors.grey[400], fontSize: '0.8rem' } }}
                                       />
                                   </ListItem>
                               );
                           })}
                       </List>
                   )}
                  {userRole === ROLES.ADMIN && ( // Changed from canPerformAction
                    <Button
                      variant="contained" // CHANGED to "contained"
                      startIcon={<AddCircleOutlineIcon />}
                      sx={{
                        mt: 1,
                        backgroundColor: colors.greenAccent[500], // Green background
                        color: theme.palette.mode === 'dark' ? colors.grey[800] : 'black', // Black or dark grey text
                        textTransform: 'none',
                        '&:hover': {
                            backgroundColor: colors.greenAccent[600], // Slightly darker/different green on hover
                        },
                        '&.Mui-disabled': {
                            backgroundColor: colors.grey[700],
                            color: colors.grey[500],
                        },
                        // Ensure icon color matches text if needed
                        '.MuiButton-startIcon > *:nth-of-type(1)': {
                           color: theme.palette.mode === 'dark' ? colors.grey[800] : 'black',
                        }
                      }}
                      onClick={handleOpenCreateProjectModal}
                      fullWidth
                      disabled={!!deletingDivisionId || !!deletingProjectId || isDeletingBulk || loadingDivisionsList}
                    >
                      New Project
                    </Button>
                  )}
               </Box>
           </DialogContent>
            <DialogActions sx={styles.modalDialogActions}>
                <Button // CLOSE BUTTON - MODIFIED SX
                    onClick={handleCloseDivisionProjectSettingsModal}
                    // color="inherit" // Remove or keep, sx will override for specific states
                    disabled={!!deletingDivisionId || !!deletingProjectId || isDeletingBulk}
                    variant="outlined" // Add variant for consistent styling approach
                    sx={{
                        // Default state (when not hovered and enabled)
                        color: colors.grey[100],
                        borderColor: colors.grey[500],
                        transition: theme.transitions.create(
                            ['color', 'border-color', 'background-color'],
                            { duration: theme.transitions.duration.short }
                        ),
                        '&:hover': {
                            // Hover state (when not disabled)
                            backgroundColor: colors.redAccent[500], // Solid red background
                            color: colors.grey[100],                // Light text for contrast
                            borderColor: colors.redAccent[500],     // Border matches background
                        },
                        '&.Mui-disabled': {
                            // Disabled state
                            color: colors.grey[600],
                            borderColor: colors.grey[700],
                            backgroundColor: 'transparent', // Ensure no background from hover persists
                        }
                    }}
                >
                    Close
                </Button>
            </DialogActions>
       </Dialog>

        <TableContainer component={Paper} sx={styles.tableContainer}>
             {isLoading && !isDeletingBulk && (<Box sx={styles.loadingOverlay}><CircularProgress/></Box>)} {/* Don't show if bulk deleting */}
            {!isLoading && files.length===0 && !isLoadingPermissions && (
                <Typography sx={{textAlign:'center', p:4, color:colors.grey[500], fontStyle:'italic'}}>
                    No files found{filterProjectId==='all' && filterDivisionId ==='all' ? '' : ' for the current filter'}.
                </Typography>
            )}
            {!isLoading && files.length>0 && !isLoadingPermissions && (
                <Table sx={styles.table} aria-label="file table" size="small">
                    <TableHead sx={styles.tableHead}>
                        <TableRow>
                            {/* Checkbox Column */}
                            <TableCell sx={{...styles.headCell, width: {xs: 40, sm: 60}, p: {xs: '0 4px', sm: '0 8px'} }}>
                                <Checkbox /* ... select all props ... */ />
                            </TableCell>
                            {/* Name Column */}
                            <TableCell sx={{...styles.headCell, width: {xs: '30%', sm: '25%'}, minWidth: {xs: 100, sm: 120} }}>Name</TableCell>
                            {/* Plot Column - NO LONGER HIDDEN */}
                            <TableCell sx={{...styles.headCell, width: '15%', minWidth: 80 }}>Plot</TableCell>
                            {/* Division Column - NO LONGER HIDDEN */}
                            <TableCell sx={{...styles.headCell, width: '15%', minWidth: 100 }}>Division</TableCell>
                            {/* Project Column */}
                            <TableCell sx={{...styles.headCell, width: {xs: '25%', sm: '15%'}, minWidth: {xs: 80, sm:100} }}>Project</TableCell>
                            {/* Size Column - NO LONGER HIDDEN */}
                            <TableCell sx={{...styles.headCell, width: '10%', minWidth: 70 }}>Size</TableCell>
                            {/* Uploaded Column - NO LONGER HIDDEN */}
                            <TableCell sx={{...styles.headCell, width: '10%', minWidth: 80 }}>Uploaded</TableCell>
                            {/* Potree Status Column */}
                            <TableCell sx={{...styles.headCell, width: {xs: '20%', sm: '10%'}, textAlign:'center'}}>Potree</TableCell>
                            {/* Actions Column */}
                            <TableCell sx={{...styles.headCell, width: {xs: 50, sm: 70}, textAlign:'center', p: {xs: '0 2px', sm: '0 4px'}}}>Actions</TableCell>
                        </TableRow>
                    </TableHead>
                        <TableBody>
                        {files.map((file) => {
                            const isSelected = selectedFileIds.has(file.id);
                            const isOptimisticallyProcessing = filesBeingProcessed.has(file.id); 
                            const isReady = !!file.potreeUrl;
                            const backendFileStatus = file.status; 

                            let sT = "Not Ready";
                            let sC = colors.grey[500];
                            
                            // Determine if file is effectively converting/processing (for UI disabling)
                            const isEffectivelyConverting = ACTIVE_PIPELINE_PROCESSING_STATUSES.includes(backendFileStatus) || isOptimisticallyProcessing;


                            if (isReady) {
                                sT = "Ready";
                                sC = colors.greenAccent[400];
                            } else if (isEffectivelyConverting) {
                                sT = "Processing..."; 
                                sC = colors.blueAccent[300];
                            } else if (backendFileStatus === 'failed') {
                                sT = "Failed";
                                sC = colors.redAccent[400];
                            } else if (backendFileStatus === 'uploaded') {
                                sT = "Queued";
                                sC = colors.orangeAccent ? colors.orangeAccent[400] : colors.grey[400]; 
                            }
                            
                            const canDeleteThisFile = canPerformAction('delete',file);
                            const cA = canPerformAction('assignProject',file); // For reassign modal (old assignProject)
                            const cD = canPerformAction('download',file);
                            const cV = canPerformAction('view',file);
                            const cC = canPerformAction('convert',file);
                            const cReassign = canPerformAction('reassign', file);

                            const hasModifyActions = cReassign || cD; // Removed cA, cDel (handled by bulk or reassign)
                            const hasAnyAction = hasModifyActions || (cV && isReady) || (cC && !isReady && !isEffectivelyConverting && backendFileStatus !== 'failed');
                            
                            // A row is generally non-interactive if a global delete (project/division/bulk) is happening
                            const isGlobalDeleteActive = !!deletingProjectId || !!deletingDivisionId || isDeletingBulk;


                            return (
                                <TableRow
                                    key={file.id}
                                    hover
                                    onClick={(event) => {
                                        if (event.target.type !== 'checkbox' && !event.target.closest('button')) {
                                             if (!isEffectivelyConverting && canDeleteThisFile && !isGlobalDeleteActive) {
                                                handleRowCheckboxClick({ target: { checked: !isSelected } }, file.id);
                                            }
                                        }
                                    }}
                                    role="checkbox"
                                    aria-checked={isSelected}
                                    selected={isSelected}
                                    sx={{
                                        '&:last-child td,&:last-child th':{border:0},
                                        opacity: isEffectivelyConverting || isGlobalDeleteActive ? 0.6 : 1,
                                        cursor: (!isEffectivelyConverting && canDeleteThisFile && !isGlobalDeleteActive) ? 'pointer' : 'default',
                                        backgroundColor: isSelected ? `${colors.blueAccent[800]} !important` : 'transparent', // Persist selection color
                                        '&:hover': {
                                            // Only apply hover if not selected and not disabled by processing/global delete
                                            backgroundColor: (isSelected || isEffectivelyConverting || isGlobalDeleteActive || !canDeleteThisFile) ? undefined : colors.primary[800]
                                        },
                                    }}
                                >
                                    {/* ---- Checkbox Cell ---- */}
                                    <TableCell
                                        padding="checkbox"
                                        sx={{
                                            ...styles.bodyCell, // Inherit base bodyCell styles (like font size, default padding)
                                            width: {xs: 40, sm: 60}, // Responsive width
                                            p: {xs: '0 4px', sm: '0 8px'} // Specific responsive padding for this cell
                                        }}
                                    >
                                        <Checkbox
                                            color="primary"
                                            checked={isSelected}
                                            onChange={(event) => handleRowCheckboxClick(event, file.id)}
                                            onClick={(e) => e.stopPropagation()}
                                            inputProps={{ 'aria-labelledby': `file-name-${file.id}` }}
                                            disabled={isEffectivelyConverting || !canDeleteThisFile || isGlobalDeleteActive}
                                            sx={{
                                                color: colors.grey[300],
                                                '&.Mui-checked': {color: colors.blueAccent[300]},
                                                '&.Mui-disabled': {color: colors.grey[600]},
                                                p: {xs: 0.5, sm: 1} // Padding for the checkbox itself
                                            }}
                                            size="small"
                                        />
                                    </TableCell>

                                    {/* ---- Name Cell ---- */}
                                    <TableCell
                                        sx={{
                                            ...styles.bodyCell,
                                            width: {xs: '35%', sm: '30%', md: '25%'}, // Responsive width
                                            minWidth: {xs: 100, sm: 120},         // Responsive minWidth
                                            maxWidth: {xs: 120, sm: 150, md: 250}  // Responsive maxWidth for ellipsis
                                        }}
                                        title={file.name}
                                        id={`file-name-${file.id}`}
                                    >
                                        {file.name}
                                    </TableCell>

                                    {/* ---- Plot Cell (Hidden on xs) ---- */}
                                    <TableCell
                                        sx={{
                                            ...styles.bodyCell,
                                            width: '15%',
                                            minWidth: 80,
                                            maxWidth: 120,
                                            // display: { xs: 'none', md: 'table-cell' } // Hidden on xs & sm
                                        }}
                                    >
                                        {file.plot_name || 'N/A'}
                                    </TableCell>

                                    {/* ---- Division Cell (Hidden on xs & sm) ---- */}
                                    <TableCell
                                        sx={{
                                            ...styles.bodyCell,
                                            width: '15%',
                                            minWidth: 100,
                                            maxWidth: 150,
                                            // display: { xs: 'none', lg: 'table-cell' } // Hidden on xs, sm, md
                                        }}
                                    >
                                        {file.divisionName || 'N/A'}
                                    </TableCell>

                                    {/* ---- Project Cell ---- */}
                                    <TableCell
                                        sx={{
                                            ...styles.bodyCell,
                                            width: {xs: '30%', sm: '20%', md: '15%'},
                                            minWidth: {xs: 80, sm: 100},
                                            maxWidth: {xs: 100, sm: 120, md: 180}
                                        }}
                                        title={file.projectName}
                                    >
                                        {file.projectName}
                                    </TableCell>

                                    {/* ---- Size Cell (Hidden on xs & sm) ---- */}
                                    <TableCell
                                        sx={{
                                            ...styles.bodyCell,
                                            width: '10%',
                                            minWidth: 70,
                                            // display: { xs: 'none', lg: 'table-cell' }
                                        }}
                                    >
                                        {file.size}
                                    </TableCell>

                                    {/* ---- Uploaded Cell (Hidden on xs) ---- */}
                                    <TableCell
                                        sx={{
                                            ...styles.bodyCell,
                                            width: '10%',
                                            minWidth: 80,
                                            // display: { xs: 'none', md: 'table-cell' }
                                        }}
                                    >
                                        {file.uploadDate}
                                    </TableCell>

                                    {/* ---- Potree Status Cell ---- */}
                                    <TableCell
                                        sx={{
                                            ...styles.bodyCell,
                                            width: {xs: '20%', sm: '15%', md: '10%'},
                                            minWidth: {xs: 80, sm: 100},
                                            textAlign:'center'
                                        }}
                                    >
                                        {isEffectivelyConverting ? (
                                          <Box sx={styles.statusText}> {/* Ensure styles.statusText has responsive font */}
                                            <CircularProgress size={16} sx={{color:sC}}/>
                                            <Typography variant="caption" sx={{color:sC, ml:0.5, display: {xs: 'none', sm: 'inline'}}}>{sT}</Typography> {/* Hide text on xs */}
                                          </Box>
                                        ) : (
                                          <Typography variant="caption" sx={{color:sC, ...styles.statusText?.fontSize && {fontSize: styles.statusText.fontSize} }}>{sT}</Typography>
                                        )}
                                    </TableCell>

                                    {/* ---- Actions Cell ---- */}
                                    <TableCell
                                        sx={{
                                            ...styles.bodyCell,
                                            width: {xs: 50, sm: 70},
                                            textAlign:'center',
                                            p: {xs: '0 2px !important', sm: '0 4px !important'} // Override bodyCell padding if needed, using !important cautiously
                                        }}
                                    >
                                        <IconButton
                                            aria-label={`actions-for-${file.name}`}
                                            onClick={(e)=>{ e.stopPropagation(); handleMenuClick(e,file);}}
                                            sx={styles.actionButton} // styles.actionButton should have responsive padding
                                            size="small"
                                            disabled={isEffectivelyConverting || !hasAnyAction || isGlobalDeleteActive}
                                            title={!hasAnyAction?"No actions available":(isEffectivelyConverting?"Processing...":"More Actions")}
                                        >
                                            <MoreVertIcon fontSize="small"/>
                                        </IconButton>
                                        <Menu
                                            id={`menu-for-${file.id}`}
                                            anchorEl={anchorEl}
                                            keepMounted
                                            open={Boolean(anchorEl) && selectedFile?.id === file.id}
                                            onClose={(e) => {e.stopPropagation(); handleMenuClose();}}
                                            anchorOrigin={{vertical:'bottom',horizontal:'right'}}
                                            transformOrigin={{vertical:'top',horizontal:'right'}}
                                            PaperProps={{sx:{backgroundColor:colors.primary[800],color:colors.grey[100],mt:0.5}}}
                                        >
                                            {cReassign && (
                                                 <MenuItem onClick={() => { handleMenuClose(); handleOpenReassignModal(selectedFile); }} disabled={isEffectivelyConverting || isGlobalDeleteActive}>
                                                     <ListItemIcon sx={{...styles.menuItemIcon, color: colors.grey[300]}}><AssignmentIcon fontSize="small"/></ListItemIcon>
                                                     <ListItemText>Edit Details / Reassign</ListItemText>
                                                 </MenuItem>
                                             )}
                                            {cD && (<MenuItem onClick={()=>{ handleMenuClose(); handleDownload(selectedFile);}} disabled={isEffectivelyConverting || isGlobalDeleteActive}><ListItemIcon sx={{...styles.menuItemIcon, color:colors.grey[300]}}><DownloadIcon fontSize="small"/></ListItemIcon><ListItemText>Download</ListItemText></MenuItem>)}
                                            {cV && isReady && (<MenuItem onClick={()=>{ handleMenuClose(); handleViewPotree(selectedFile);}} disabled={isEffectivelyConverting || isGlobalDeleteActive}><ListItemIcon sx={{...styles.menuItemIcon, color:colors.grey[300]}}><VisibilityIcon fontSize="small"/></ListItemIcon><ListItemText>View Point Cloud</ListItemText></MenuItem>)}
                                            {cC && !isReady && !isEffectivelyConverting && backendFileStatus !== 'failed' && (<MenuItem onClick={()=>{ handleMenuClose(); handleConvertPotree(selectedFile);}} disabled={isGlobalDeleteActive}><ListItemIcon sx={{...styles.menuItemIcon, color:colors.grey[300]}}><TransformIcon fontSize="small"/></ListItemIcon><ListItemText>Convert to Potree</ListItemText></MenuItem>)}
                                            {canDeleteThisFile && (<MenuItem onClick={()=>{ handleMenuClose(); handleRemove(selectedFile);}} disabled={isEffectivelyConverting || isGlobalDeleteActive} sx={{ color: colors.redAccent[400], '.MuiListItemIcon-root': { color: colors.redAccent[400] } }} ><ListItemIcon sx={styles.menuItemIcon}><DeleteIcon fontSize="small"/></ListItemIcon><ListItemText>Remove File</ListItemText></MenuItem>)}

                                            {!hasAnyAction && (<MenuItem disabled sx={styles.menuItemDisabledText}><ListItemText>No actions permitted</ListItemText></MenuItem>)}
                                        </Menu>
                                    </TableCell>
                                </TableRow>
                           );
                        })}
                    </TableBody>
                </Table>
            )}
        </TableContainer>

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

export default FileManagement;