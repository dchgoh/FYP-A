import React, { useState, useRef, useEffect } from "react";
import {
  Box,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Typography,
  useTheme,
  IconButton,
  Menu,
  MenuItem,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Snackbar,
  Alert,
  CircularProgress,
} from "@mui/material";
import { tokens } from "../../theme";
import FileSaver from "file-saver";
import { useNavigate } from "react-router-dom";

const FileManagement = ({ isCollapsed }) => {
  const theme = useTheme();
  const colors = tokens(theme.palette.mode);
  const navigate = useNavigate();

  const [anchorEl, setAnchorEl] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [openUploadModal, setOpenUploadModal] = useState(false);
  const [newFile, setNewFile] = useState(null);
  const [snackbarOpen, setSnackbarOpen] = useState(false);
  const [snackbarMessage, setSnackbarMessage] = useState("");
  const [snackbarSeverity, setSnackbarSeverity] = useState("success");
  const fileInputRef = useRef(null);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [uploadingFile, setUploadingFile] = useState(null);
  const [uploadCompleteSnackbarOpen, setUploadCompleteSnackbarOpen] = useState(false);

  const [files, setFiles] = useState([
    {
      id: 1,
      name: "sample.las",
      size: "39 MB",
      uploadDate: "2024-10-26",
      downloadLink: "/report.pdf",
      potreeUrl: "/pointclouds/sample/metadata.json",
    },
    {
      id: 2,
      name: "sample2.las",
      size: "823 MB",
      uploadDate: "2024-10-25",
      downloadLink: "/presentation.pptx",
      potreeUrl: "/pointclouds/sample2/metadata.json",
    },
    {
      id: 3,
      name: "data.csv",
      size: "1.2 MB",
      uploadDate: "2024-10-24",
      downloadLink: null,
      potreeUrl: null,
    },
    {
      id: 4,
      name: "image.jpg",
      size: "800 KB",
      uploadDate: "2024-10-23",
      downloadLink: "/image.jpg",
      potreeUrl: null,
    },
    {
      id: 5,
      name: "document.docx",
      size: "3.7 MB",
      uploadDate: "2024-10-22",
      downloadLink: null,
      potreeUrl: null,
    }
  ]);

  const showSnackbar = (message, severity = "success") => {
    setSnackbarMessage(message);
    setSnackbarSeverity(severity);
    setSnackbarOpen(true);
  };

  const handleSnackbarClose = (event, reason) => {
    if (reason === "clickaway") {
      return;
    }
    setSnackbarOpen(false);
  };

  const handleDownload = (file) => {
    if (file.downloadLink) {
      FileSaver.saveAs(file.downloadLink, file.name);
    } else {
      showSnackbar("File is not yet available for download", "warning");
    }
  };

  const handleRemove = (fileId) => {
    setFiles(files.filter((file) => file.id !== fileId));
    showSnackbar("File removed successfully", "success");
  };

  const handleMenuClick = (event, file) => {
    setAnchorEl(event.currentTarget);
    setSelectedFile(file);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
    setSelectedFile(null);
  };

  const handleViewPotree = (file) => {
    if (file.potreeUrl) {
      navigate(`/potree?url=${encodeURIComponent(file.potreeUrl)}`);
    } else {
      showSnackbar("Potree data not available for this file.", "warning");
    }
  };

  const handleOpenUploadModal = () => {
    setOpenUploadModal(true);
  };

  const handleCloseUploadModal = () => {
    setOpenUploadModal(false);
    setNewFile(null);
  };

  const handleFileChange = (e) => {
    setNewFile(e.target.files[0]);
  };

  const handleFileUpload = () => {
    if (!newFile) {
      showSnackbar("Please select a file.", "error");
      return;
    }
    setUploadingFile(newFile);
    setUploadProgress(0);

    const reader = new FileReader();

    reader.onprogress = (event) => {
      if (event.lengthComputable) {
        const percentLoaded = Math.round((event.loaded / event.total) * 100);
        setUploadProgress(percentLoaded);
      }
    };

    reader.onload = () => {
      const newFileData = {
        id: files.length + 1,
        name: newFile.name,
        size: `${(newFile.size / 1024 / 1024).toFixed(2)} MB`,
        uploadDate: new Date().toISOString().split('T')[0],
        downloadLink: "/path/to/uploaded/" + newFile.name,
        potreeUrl: null,
      };

      setFiles([...files, newFileData]);
      handleCloseUploadModal();
      setUploadCompleteSnackbarOpen(true);
      setUploadProgress(null);
      setUploadingFile(null);
    };

    reader.onerror = () => {
      showSnackbar("File upload failed.", "error");
      setUploadProgress(null);
      setUploadingFile(null);
    };

    reader.readAsArrayBuffer(newFile);
  };

  const triggerFileInput = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const styles = {
    container: {
      display: "flex",
      minHeight: "100vh",
      bgcolor: colors.grey[800],
      marginLeft: isCollapsed ? "80px" : "270px",
      transition: "margin 0.3s ease",
    },
    content: { flex: 1, p: 4 },
    tableContainer: {
      backgroundColor: colors.grey[900],
      borderRadius: 2,
      "&::-webkit-scrollbar": {
        width: "8px",
      },
      "&::-webkit-scrollbar-track": {
        background: colors.grey[700],
      },
      "&::-webkit-scrollbar-thumb": {
        backgroundColor: colors.grey[500],
        borderRadius: "10px",
        border: `2px solid ${colors.grey[700]}`,
        "&:hover": {
          backgroundColor: colors.primary?.[400] ?? "#007bff",
        },
      },
      overflowX: 'auto', // Add horizontal scroll if content overflows
    },
    table: {
      minWidth: 650,
      width: '100%', // Make table take full width of container
      tableLayout: 'fixed', // Fixed table layout
    },
    tableHead: {
      backgroundColor: colors.primary[700],
    },
    headCell: {
      color: "white",
      fontWeight: "bold",
    },
    bodyCell: {
      color: colors.grey[100],
      overflow: 'hidden', // Prevent text overflow
      textOverflow: 'ellipsis', // Add ellipsis (...) if text is too long
      whiteSpace: 'nowrap', // Prevent text wrapping
    },
    progressBar: {
      height: "10px",
      borderRadius: "5px",
    },
    actionButton: {
      color: colors.blueAccent?.[400] ?? "#007bff",
    },
    fileDisplay: {
      textAlign: "center",
      marginTop: "20px",
      padding: "15px",
      border: `1px dashed ${colors.grey[500]}`,
      borderRadius: "5px",
    },
    dialogTitle: {
      textAlign: "center",
    },
    dialogContent: {
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
    },
    uploadProgressContainer: {
      position: "fixed",
      bottom: "20px",
      right: "20px",
      backgroundColor: colors.grey[900],
      padding: "16px",
      borderRadius: "8px",
      boxShadow: "0px 2px 4px rgba(0, 0, 0, 0.2)",
      display: "flex",
      alignItems: "center",
      gap: "10px",
    },
  };

  useEffect(() => {
    if (uploadCompleteSnackbarOpen) {
      const timer = setTimeout(() => {
        setUploadCompleteSnackbarOpen(false);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [uploadCompleteSnackbarOpen]);

  return (
    <Box sx={styles.container}>
      <Box sx={styles.content}>
        <Button
          variant="contained"
          startIcon={<span className="material-symbols-outlined">upload_file</span>}
          sx={{
            mb: 2,
            backgroundColor: colors.primary[700],
            color: "white",
            "&:hover": { backgroundColor: colors.primary[400] },
          }}
          onClick={handleOpenUploadModal}
        >
          Upload File
        </Button>

        <Dialog open={openUploadModal} onClose={handleCloseUploadModal}>
          <DialogTitle sx={styles.dialogTitle}>Upload New File</DialogTitle>
          <DialogContent sx={styles.dialogContent}>
            <Button variant="outlined" onClick={triggerFileInput}>
              Select File
            </Button>
            <input
              type="file"
              ref={fileInputRef}
              style={{ display: "none" }}
              onChange={handleFileChange}
            />
            {newFile && (
              <Box sx={styles.fileDisplay}>
                <Typography>{newFile.name}</Typography>
                <Typography>{(newFile.size / 1024 / 1024).toFixed(2)} MB</Typography>
              </Box>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={handleCloseUploadModal} color="secondary">
              Cancel
            </Button>
            <Button onClick={handleFileUpload} color="primary">
              Upload
            </Button>
          </DialogActions>
        </Dialog>

        <TableContainer component={Paper} sx={styles.tableContainer}>
          <Table sx={styles.table} aria-label="file table">
            <TableHead sx={styles.tableHead}>
              <TableRow>
                <TableCell sx={styles.headCell}>File Name</TableCell>
                <TableCell sx={styles.headCell}>File Size</TableCell>
                <TableCell sx={styles.headCell}>Upload Date</TableCell>
                <TableCell sx={styles.headCell}>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {files.map((file) => (
                <TableRow key={file.id} hover>
                  <TableCell sx={styles.bodyCell}>{file.name}</TableCell>
                  <TableCell sx={styles.bodyCell}>{file.size}</TableCell>
                  <TableCell sx={styles.bodyCell}>{file.uploadDate}</TableCell>
                  <TableCell sx={styles.bodyCell}>
                    <IconButton
                      aria-controls="simple-menu"
                      aria-haspopup="true"
                      onClick={(event) => handleMenuClick(event, file)}
                      sx={styles.actionButton}
                    >
                      <span className="material-symbols-outlined">more_vert</span>
                    </IconButton>
                    <Menu
                      id="simple-menu"
                      anchorEl={anchorEl}
                      keepMounted
                      open={Boolean(anchorEl) && selectedFile === file}
                      onClose={handleMenuClose}
                    >
                      <MenuItem onClick={() => handleDownload(selectedFile)}>
                        Download
                      </MenuItem>
                      <MenuItem onClick={() => handleRemove(selectedFile?.id)}>
                        Remove
                      </MenuItem>
                      {selectedFile?.potreeUrl && (
                        <MenuItem onClick={() => handleViewPotree(selectedFile)}>
                          View Potree
                        </MenuItem>
                      )}
                    </Menu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        <Snackbar
          open={snackbarOpen}
          autoHideDuration={6000}
          onClose={handleSnackbarClose}
          anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
        >
          <Alert onClose={handleSnackbarClose} severity={snackbarSeverity} sx={{ width: "100%" }}>
            {snackbarMessage}
          </Alert>
        </Snackbar>
        {uploadProgress !== null && uploadingFile && (
          <Box sx={styles.uploadProgressContainer}>
            <CircularProgress variant="determinate" value={uploadProgress} />
            <Typography>{uploadingFile.name} - {uploadProgress}%</Typography>
          </Box>
        )}
        <Snackbar
          open={uploadCompleteSnackbarOpen}
          anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        >
          <Alert severity="success">File Uploaded Successfully!</Alert>
        </Snackbar>
      </Box>
    </Box>
  );
};

export default FileManagement;