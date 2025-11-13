import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import axios from 'axios';
import { jwtDecode } from 'jwt-decode';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';

// --- CONSTANTS ---
const API_BASE_URL = "/api";
const ROLES = {
  ADMIN: 'Administrator',
  DATA_MANAGER: 'Data Manager',
  REGULAR: 'Regular',
};
const ACTIVE_PIPELINE_PROCESSING_STATUSES = [
    'segmenting',
    'processing_las_data',
    'processing'
];
const CREATE_NEW_DIVISION_VALUE = "__CREATE_NEW_DIVISION__";
const CREATE_NEW_PROJECT_VALUE = "__CREATE_NEW_PROJECT__";

export const useFileManagement = () => {
    // --- HOOKS ---
    const navigate = useNavigate();
    const fileInputRef = useRef(null);

    // --- STATE MANAGEMENT ---
    const [files, setFiles] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [anchorEl, setAnchorEl] = useState(null);
    const [selectedFile, setSelectedFile] = useState(null);
    const [openUploadModal, setOpenUploadModal] = useState(false);
    const [newFile, setNewFile] = useState(null);
    const [uploadProgress, setUploadProgress] = useState(null);
    const [isUploading, setIsUploading] = useState(false);
    const [uploadAbortController, setUploadAbortController] = useState(null);
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
    const [snackbar, setSnackbar] = useState({ open: false, message: "", severity: "success" });
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
    const [selectedFileIds, setSelectedFileIds] = useState(new Set());
    const [isDeletingBulk, setIsDeletingBulk] = useState(false);
    const [exportSelectedFiles, setExportSelectedFiles] = useState(new Set());
    const [exportModalOpen, setExportModalOpen] = useState(false);

    // --- UTILITY FUNCTIONS ---
    const showSnackbar = useCallback((message, severity = "success") => {
        setSnackbar({ open: true, message, severity });
    }, []); 
    
    const areFiltersDefault = useMemo(() => {
        return filterDivisionId === 'all' && filterProjectId === 'all';
        // If you add a plot name filter to this toolbar later, you would add it here too:
        // && filterPlotName === 'all'
    }, [filterDivisionId, filterProjectId]);

    const handleSnackbarClose = (event, reason) => {
        if (reason === "clickaway") return;
        setSnackbar(prev => ({ ...prev, open: false }));
    };
    
      // Get files that are currently being processed or have processing status
      const getProcessingFiles = useCallback(() => {
        const processingStatuses = [
          'uploaded', 'processing_las_data', 'segmenting', 
          'ready', 'failed', 'error_las_processing', 'error_segmentation'
        ];
        return files.filter(file => processingStatuses.includes(file.status));
      }, [files]);
    
    
      // --- PERMISSION CHECK FUNCTION ---
      const canPerformAction = useCallback((action, file = null) => {
        if (isLoadingPermissions || !userRole) return false;
    
        const requiresFileContext = ['download', 'delete', 'assignProject', 'view', 'reassign', 'stop', 'start']; // Added start
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
                case 'assignProject': // DM can assign unassigned files or re-assign files from projects they manage
                    return true;
                case 'delete': // DM can delete unassigned files or files from projects they manage
                    return true;
                case 'reassign': // DM can reassign plot name/project for files they manage or unassigned
                    return true;
                case 'stop': // DM can stop processing for files they manage or unassigned
                     return file && (file.project_id === null || assignedProjectIdsForDM.includes(file.project_id)) && 
                            ['segmenting', 'processing_las_data', 'uploaded'].includes(file.status);
                case 'start': // DM can start processing for files they manage or unassigned
                     return file && (file.project_id === null || assignedProjectIdsForDM.includes(file.project_id)) && 
                            file.status === 'stopped';
                case 'createProject': // DMs typically don't create projects
                case 'createDivision': // DMs typically don't create divisions
                case 'manageAssignments': // This refers to the admin modal for assigning DMs to projects
                    return false;
                default:
                    return false;
            }
        }
    
        if (userRole === ROLES.REGULAR) {
            // Regular users can only view ready files
            switch (action) {
                case 'view':
                    return file && file.status === 'ready';
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
                  projectName: f.projectName || "Unassigned",
                  divisionName: f.divisionName || "N/A"
              }));
              setFiles(formatted);
    
              setFilesBeingProcessed(currentProcessing => {
                  const stillProcessing = new Set(currentProcessing);
                  const fetchedFileIds = new Set(formatted.map(f => f.id));
                  currentProcessing.forEach(id => {
                      const fileInData = formatted.find(f => f.id === id);
                      if (!fetchedFileIds.has(id) || (fileInData && fileInData.status === 'ready')) {
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
      
      const handleResetFilters = useCallback(() => {
        setFilterDivisionId('all');
        setFilterProjectId('all');
        // The useEffect that depends on these filters will automatically trigger a refetch of the files.
    }, []);
    
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
                activeProcessingStatesForPolling.includes(file.status) && file.status !== 'ready'
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
            showSnackbar("Session error. Log in.", "error");
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
      const handleMenuClose = (event) => {
        // It's good practice to check if the event object exists
        if (event && typeof event.stopPropagation === 'function') {
            event.stopPropagation();
        }
        setAnchorEl(null);
        /* setSelectedFile(null) potentially later if needed */
        };
    
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
        
        const conf = window.confirm(`Delete "${fileToRemove.name}" and associated data?`);
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

      const handleStopProcessing = async (fileToStop) => {
        if (!canPerformAction('stop', fileToStop)) { 
            showSnackbar("Permission denied.", "error"); 
            handleMenuClose(); 
            return; 
        }
        
        const fileId = fileToStop?.id;
        if (!fileId) { 
            handleMenuClose(); 
            return; 
        }
        
        handleMenuClose(); // Close menu before confirmation
        
        const conf = window.confirm(`Stop processing "${fileToStop.name}"? This will cancel the current operation.`);
        if (!conf) return;
    
        const token = localStorage.getItem('authToken');
        if (!token) { 
            showSnackbar("Auth required.", "error"); 
            return; 
        }
        
        try {
            const res = await axios.post(`${API_BASE_URL}/files/${fileId}/stop`, {}, { 
                headers: { 'Authorization': `Bearer ${token}` } 
            });
            
            if (res.data.success) {
                showSnackbar(`Processing stopped for "${fileToStop.name}".`, "success");
                fetchFiles(); // Refresh file list
            } else { 
                showSnackbar(res.data.message || "Stop processing failed.", "warning"); 
            }
        } catch (e) {
            console.error("Stop processing error:", e);
            showSnackbar(e.response?.data?.message || "Server error stopping processing.", "error");
        }
      };

      const handleStartProcessing = async (fileToStart) => {
        if (!canPerformAction('start', fileToStart)) { 
            showSnackbar("Permission denied.", "error"); 
            handleMenuClose(); 
            return; 
        }
        
        const fileId = fileToStart?.id;
        if (!fileId) { 
            handleMenuClose(); 
            return; 
        }
        
        handleMenuClose();

        // No confirmation needed for a quick action like this, but you can add it back if you prefer.
        // const conf = window.confirm(`Start processing "${fileToStart.name}"?`);
        // if (!conf) return;
    
        const token = localStorage.getItem('authToken');
        if (!token) { 
            showSnackbar("Auth required.", "error"); 
            return; 
        }

        // --- IMPROVEMENT: OPTIMISTIC UI UPDATE ---
        // This makes the spinner appear INSTANTLY for the user.
        setFilesBeingProcessed(prev => new Set(prev).add(fileToStart.id));
        
        try {
            const res = await axios.post(`${API_BASE_URL}/files/${fileId}/start`, {}, { 
                headers: { 'Authorization': `Bearer ${token}` } 
            });
            
            if (res.data.success) {
                showSnackbar(`Processing started for "${fileToStart.name}".`, "success");
                // The polling mechanism will eventually update the status, but a manual fetch ensures it happens sooner.
                fetchFiles(); 
            } else { 
                showSnackbar(res.data.message || "Start processing failed.", "warning"); 
                // If it fails, remove the spinner immediately.
                setFilesBeingProcessed(prev => {
                    const next = new Set(prev);
                    next.delete(fileToStart.id);
                    return next;
                });
            }
        } catch (e) {
            console.error("Start processing error:", e);
            showSnackbar(e.response?.data?.message || "Server error starting processing.", "error");
            // Also remove the spinner on error.
            setFilesBeingProcessed(prev => {
                const next = new Set(prev);
                next.delete(fileToStart.id);
                return next;
            });
        }
      };
    
      // Convert functionality removed - files are now directly ready for point cloud viewer
    
      const handleViewPointCloud = (fileToView) => {
        if (!canPerformAction('view', fileToView)) { showSnackbar("Permission denied.", "error"); handleMenuClose(); return; }
        if (fileToView?.status !== 'ready') { showSnackbar("File not ready for viewing.", "warning"); return; }
        handleMenuClose();
        console.log(`Navigating to Point Cloud Viewer for file: ${fileToView.name}`);
        navigate(`/pointcloud?fileId=${fileToView.id}`);
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
                showSnackbar(`File "${newFile.name}" uploaded. Processing queued for background execution.`, "success");
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
    
      // In useFileManagement.js

        const handleOpenReassignModal = (file) => {
            // It's good practice to close the menu first in case of an early return.
            handleMenuClose(); 

            if (!canPerformAction('reassign', file)) {
                showSnackbar("Permission denied.", "error");
                // We already closed the menu, so no need to call it again here.
                return;
            }

            if (!file) return;

            setFileToReassign(file);
            setSelectedProjectIdForReassign(file.project_id ?? '');
            setNewPlotNameForReassign(file.plot_name || '');
            setReassignModalOpen(true);
            
            // The menu is already closed. The call was here and should be removed.
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

    // --- EXPORT MODAL HANDLERS ---
    const handleOpenExportModal = useCallback(() => {
        const readyFiles = files.filter(file => file.status === 'ready');
        if (readyFiles.length === 0) {
            showSnackbar("No ready files available for export.", "warning");
            return;
        }
        setExportModalOpen(true);
        // Pre-select all ready files by default
        setExportSelectedFiles(new Set(readyFiles.map(file => file.id)));
    }, [files, showSnackbar]);

    const handleCloseExportModal = useCallback(() => {
        setExportModalOpen(false);
        setExportSelectedFiles(new Set());
    }, []);

    const handleExportFileSelection = useCallback((fileId, isSelected) => {
        setExportSelectedFiles(prev => {
            const newSet = new Set(prev);
            if (isSelected) {
                newSet.add(fileId);
            } else {
                newSet.delete(fileId);
            }
            return newSet;
        });
    }, []);

    const handleSelectAllForExport = useCallback((isSelected) => {
        const readyFiles = files.filter(file => file.status === 'ready');
        if (isSelected) {
            setExportSelectedFiles(new Set(readyFiles.map(file => file.id)));
        } else {
            setExportSelectedFiles(new Set());
        }
    }, [files]);

    // --- EXPORT FUNCTIONALITY ---
    const handleExportToExcel = useCallback(async (selectedFileIds = null) => {
        // Convert selectedFileIds to an array if it's a Set
        const selectedIdsArray = selectedFileIds instanceof Set ? Array.from(selectedFileIds) : selectedFileIds;
        
        console.log('DEBUG: selectedFileIds:', selectedFileIds);
        console.log('DEBUG: selectedIdsArray:', selectedIdsArray);
        console.log('DEBUG: All files count:', files.length);
        console.log('DEBUG: All file IDs and types:', files.map(f => ({ id: f.id, type: typeof f.id })));
        
        const filesToExport = selectedIdsArray && selectedIdsArray.length > 0 ? 
            files.filter(file => {
                const isSelected = selectedIdsArray.includes(file.id);
                console.log(`DEBUG: File ${file.id} (type: ${typeof file.id}) - isSelected: ${isSelected}`);
                return isSelected && file.status === 'ready';
            }) :
            files.filter(file => file.status === 'ready');
        
        console.log('DEBUG: filesToExport count:', filesToExport.length);
        console.log('DEBUG: filesToExport IDs:', filesToExport.map(f => f.id));

        if (filesToExport.length === 0) {
            showSnackbar("No ready files to export.", "warning");
            return;
        }

        const token = localStorage.getItem('authToken');
        if (!token) {
            showSnackbar("Authentication required for export.", "error");
            return;
        }

        try {
            showSnackbar("Preparing tree data export...", "info");

            // Fetch detailed tree data from the API for selected files
            const fileIds = filesToExport.map(file => file.id);
            const params = { fileIds: fileIds.join(',') };
            
            console.log('DEBUG: Sending to backend - fileIds:', fileIds);
            console.log('DEBUG: Sending to backend - params:', params);

            const response = await axios.get(`${API_BASE_URL}/files/export/tree-data`, {
                headers: { 'Authorization': `Bearer ${token}` },
                params: params
            });

            if (!response.data.success || !response.data.data) {
                showSnackbar("No tree data available for export.", "warning");
                return;
            }

            let treeData = response.data.data;
            const totalTrees = response.data.total_trees;
            const totalFiles = response.data.total_files;

            // IMPORTANT: Filter treeData to only include trees from selected files
            // The backend might return data for all files, so we filter it here
            const selectedFileIdsArray = filesToExport.map(f => f.id);
            const originalTreeDataCount = treeData.length;
            treeData = treeData.filter(tree => selectedFileIdsArray.includes(tree.file_id));
            
            console.log('DEBUG: Backend returned', originalTreeDataCount, 'trees');
            console.log('DEBUG: After filtering by selected files:', treeData.length, 'trees');
            console.log('DEBUG: Tree file_ids in response:', [...new Set(treeData.map(t => t.file_id))]);

            if (treeData.length === 0) {
                showSnackbar("No tree measurements found in the selected files.", "warning");
                return;
            }

            // Group trees by file for better organization
            const fileGroups = {};
            treeData.forEach(tree => {
                if (!fileGroups[tree.file_id]) {
                    fileGroups[tree.file_id] = {
                        metadata: {
                            file_id: tree.file_id,
                            file_name: tree.file_name,
                            plot_name: tree.plot_name,
                            division_name: tree.division_name,
                            project_name: tree.project_name,
                            upload_date: tree.upload_date,
                            file_latitude: tree.file_latitude,
                            file_longitude: tree.file_longitude,
                            tree_count_in_file: tree.tree_count_in_file
                        },
                        trees: []
                    };
                }
                fileGroups[tree.file_id].trees.push(tree);
            });

            // Create workbook
            const wb = XLSX.utils.book_new();
            
            // Build worksheet data manually for better control
            const wsData = [];
            
            // Add title row
            wsData.push(['TREE MEASUREMENTS EXPORT REPORT']);
            wsData.push(['Generated: ' + new Date().toLocaleString()]);
            wsData.push([]); // Empty row
            
            // Process each file group
            Object.values(fileGroups).forEach((fileGroup, fileIndex) => {
                const meta = fileGroup.metadata;
                
                // File metadata header
                wsData.push(['FILE INFORMATION']);
                wsData.push(['File ID:', meta.file_id]);
                wsData.push(['File Name:', meta.file_name]);
                wsData.push(['Plot Name:', meta.plot_name || 'N/A']);
                wsData.push(['Division:', meta.division_name || 'N/A']);
                wsData.push(['Project:', meta.project_name || 'N/A']);
                wsData.push(['Upload Date:', meta.upload_date]);
                wsData.push(['File Location:', `${meta.file_latitude || 'N/A'}, ${meta.file_longitude || 'N/A'}`]);
                wsData.push(['Total Trees in File:', meta.tree_count_in_file]);
                wsData.push([]); // Empty row
                
                // Tree measurements header
                wsData.push([
                    'Tree ID',
                    'Latitude',
                    'Longitude',
                    'Height (m)',
                    'DBH (cm)',
                    'Stem Volume (m³)',
                    'Above Ground Volume (m³)',
                    'Total Volume (m³)',
                    'Biomass (tonnes)',
                    'Carbon (tonnes)',
                    'CO2 Equivalent (tonnes)',
                    'Assumed D2 (cm)'
                ]);
                
                // Tree measurements data
                fileGroup.trees.forEach(tree => {
                    wsData.push([
                        tree.tree_id,
                        tree.tree_latitude,
                        tree.tree_longitude,
                        tree.tree_height_m,
                        tree.tree_dbh_cm,
                        tree.tree_stem_volume_m3,
                        tree.tree_above_ground_volume_m3,
                        tree.tree_total_volume_m3,
                        tree.tree_biomass_tonnes,
                        tree.tree_carbon_tonnes,
                        tree.tree_co2_equivalent_tonnes,
                        tree.assumed_d2_cm_for_volume
                    ]);
                });
                
                // Add spacing between files if there are more files
                if (fileIndex < Object.values(fileGroups).length - 1) {
                    wsData.push([]);
                    wsData.push([]);
                    wsData.push(['─'.repeat(50)]); // Separator line
                    wsData.push([]);
                }
            });

            // Create worksheet from array
            const ws = XLSX.utils.aoa_to_sheet(wsData);

            // Set column widths for better readability
            const colWidths = [
                { wch: 15 }, // Tree ID / Labels
                { wch: 15 }, // Latitude / Values
                { wch: 15 }, // Longitude
                { wch: 15 }, // Height
                { wch: 15 }, // DBH
                { wch: 20 }, // Stem Volume
                { wch: 25 }, // Above Ground Volume
                { wch: 18 }, // Total Volume
                { wch: 18 }, // Biomass
                { wch: 15 }, // Carbon
                { wch: 22 }, // CO2 Equivalent
                { wch: 18 }  // Assumed D2
            ];
            ws['!cols'] = colWidths;

            // Add worksheet to workbook
            XLSX.utils.book_append_sheet(wb, ws, 'Tree Measurements');

            // Generate Excel file
            const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
            const data = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

            // Generate filename with timestamp
            const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
            const filename = `tree_measurements_export_${timestamp}.xlsx`;

            // Download the file
            saveAs(data, filename);
            showSnackbar(`Tree measurements exported successfully! ${totalTrees} trees from ${filesToExport.length} selected files saved as ${filename}`, "success");

        } catch (error) {
            console.error("Error exporting tree data to Excel:", error);
            if (error.response?.status === 401 || error.response?.status === 403) {
                showSnackbar("Permission denied for export.", "error");
            } else if (error.response?.data?.message) {
                showSnackbar(`Export failed: ${error.response.data.message}`, "error");
            } else {
                showSnackbar("Failed to export tree measurements to Excel.", "error");
            }
        }
    }, [files, showSnackbar]);

    return {
        // Constants
        ROLES, CREATE_NEW_DIVISION_VALUE, CREATE_NEW_PROJECT_VALUE,

        // State & Refs
        files, isLoading, anchorEl, selectedFile, openUploadModal, newFile, uploadProgress, isUploading,
        filterProjectId, filterDivisionId, assignProjectModalOpen, fileToAssignProject,
        selectedProjectIdForAssignment, isAssigningProject, createProjectModalOpen, createDivisionModalOpen,
        newProjectName, newDivisionName, isCreatingDivision, isCreatingProject, userRole, userId,
        isProjectSettingsModalOpen, divisionsList, projectsList, allDataManagers, assignmentsInModal,
        selectedManagerToAddInModal, loadingDivisionsList, loadingProjectsList, loadingModalDMs,
        loadingAssignmentsForProjectId, processingAssignmentInModal,
        snackbar,
        deletingProjectId, plotName, selectedProjectId, selectedDivisionIdForCreation, isDivisionProjectSettingsModalOpen,
        deletingDivisionId, reassignModalOpen, fileToReassign, selectedProjectIdForReassign,
        newPlotNameForReassign, isReassigning, filesBeingProcessed, isPolling, skipSegmentation,
        selectedFileIds, isDeletingBulk, fileInputRef, isLoadingPermissions,
        exportSelectedFiles, exportModalOpen,

        // State Setters (for controlled components in modals/forms)
        setOpenUploadModal, setNewFile, setUploadProgress, setIsUploading, setPlotName, setSelectedProjectId,
        setSkipSegmentation, setAssignProjectModalOpen, setFileToAssignProject, setSelectedProjectIdForAssignment,
        setCreateProjectModalOpen, setNewProjectName, setSelectedDivisionIdForCreation, setCreateDivisionModalOpen,
        setNewDivisionName, setIsProjectSettingsModalOpen, setIsDivisionProjectSettingsModalOpen, setReassignModalOpen,
        setFileToReassign, setSelectedProjectIdForReassign, setNewPlotNameForReassign,
        setSelectedManagerToAddInModal,setSelectedFileIds,

        // Handlers
        handleMenuClick, handleMenuClose, handleDownload, handleRemove, handleStopProcessing, handleStartProcessing,
        handleViewPointCloud, handleFileUpload, handleAssignProject, handleReassignFile,
        handleBulkDelete, handleSelectAllClick, handleRowCheckboxClick, 
        handleSnackbarClose, showSnackbar, handleExportToExcel,
        handleProjectFilterChange, handleDivisionFilterChange, handleOpenUploadModal, handleCloseUploadModal,
        handleFileChange, triggerFileInput, handleCancelUpload, handleCloseAssignProjectModal,
        handleDeleteProject, handleOpenCreateProjectModal, handleOpenCreateDivisionModal,
        handleCloseCreateDivisionModal, handleCloseCreateProjectModal, handleCreateDivision, handleCreateProject,
        handleOpenDivisionProjectSettingsModal, handleCloseDivisionProjectSettingsModal, handleDeleteDivision,
        handleOpenProjectSettingsModal, handleCloseProjectSettingsModal, handleModalAccordionChange,
        handleSelectManagerChangeInModal, handleAssignManagerInModal, handleRemoveManagerInModal,
        handleOpenReassignModal, handleCloseReassignModal,
        handleOpenExportModal, handleCloseExportModal, handleExportFileSelection, handleSelectAllForExport, handleResetFilters,
        
        // Derived State & Utils
        canPerformAction, filteredProjectsForDropdown, getProcessingFiles, numTotalSelectableForDelete,
        getUnassignedManagersForModalProject, areFiltersDefault,
    };
};