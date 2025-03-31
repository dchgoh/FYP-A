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
  LinearProgress,
  IconButton,
  Menu,
  MenuItem,
} from "@mui/material";
import { tokens } from "../../theme";
import { useState } from "react";
import FileSaver from 'file-saver';
import { useNavigate } from 'react-router-dom'; // Import useNavigate

const FileManagement = ({ isCollapsed }) => {
  const theme = useTheme();
  const colors = tokens(theme.palette.mode);
  const navigate = useNavigate(); // Initialize useNavigate

  const [anchorEl, setAnchorEl] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);

  // Dummy file data (replace with actual data fetching)
  const [files, setFiles] = useState([
    {
      id: 1,
      name: "report.pdf",
      size: "2.5 MB",
      status: "complete",
      progress: 100,
      downloadLink: "/report.pdf",
      potreeUrl: "/pointclouds/metadata.json", // Add Potree URL
    },
    {
      id: 2,
      name: "presentation.pptx",
      size: "5.1 MB",
      status: "complete",
      progress: 100,
      downloadLink: "/presentation.pptx",
      potreeUrl: "/pointclouds/metadata2.json", // Add Potree URL
    },
    {
      id: 3,
      name: "data.csv",
      size: "1.2 MB",
      status: "incomplete",
      progress: 60,
      downloadLink: null,
      potreeUrl: null, // Add Potree URL
    },
    {
      id: 4,
      name: "image.jpg",
      size: "800 KB",
      status: "complete",
      progress: 100,
      downloadLink: "/image.jpg",
      potreeUrl: "/pointclouds/metadata3.json", // Add Potree URL
    },
    {
      id: 5,
      name: "document.docx",
      size: "3.7 MB",
      status: "incomplete",
      progress: 25,
      downloadLink: null,
      potreeUrl: null, // Add Potree URL
    },
  ]);

  const handleDownload = (file) => {
    if (file.downloadLink) {
      FileSaver.saveAs(file.downloadLink, file.name);
    } else {
      alert("File is not yet available for download");
    }
  };

  const handleRemove = (fileId) => {
    setFiles(files.filter((file) => file.id !== fileId));
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
      navigate(`/potree?url=${encodeURIComponent(file.potreeUrl)}`); // Navigate with URL param
    } else {
      alert("Potree data not available for this file.");
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
          backgroundColor: colors.primary?.[400] ?? "#007bff", // Optional chaining and default
        },
      },
    },
    table: {
      minWidth: 650,
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
    },
    statusCell: (status) => ({
      color:
        status === "complete"
          ? colors.greenAccent?.[400] ?? "#28a745"
          : colors.redAccent?.[400] ?? "#dc3545", // Optional chaining and defaults
      fontWeight: "bold",
    }),
    progressBar: {
      height: "10px",
      borderRadius: "5px",
    },
    actionButton: {
      color: colors.blueAccent?.[400] ?? "#007bff", // Optional chaining and default
    },
  };

  return (
    <Box sx={styles.container}>
      <Box sx={styles.content}>
        <TableContainer component={Paper} sx={styles.tableContainer}>
          <Table sx={styles.table} aria-label="file table">
            <TableHead sx={styles.tableHead}>
              <TableRow>
                <TableCell sx={styles.headCell}>File Name</TableCell>
                <TableCell sx={styles.headCell}>File Size</TableCell>
                <TableCell sx={styles.headCell}>Upload Status</TableCell>
                <TableCell sx={styles.headCell}>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {files.map((file) => (
                <TableRow key={file.id} hover>
                  <TableCell sx={styles.bodyCell}>{file.name}</TableCell>
                  <TableCell sx={styles.bodyCell}>{file.size}</TableCell>
                  <TableCell sx={styles.statusCell(file.status)}>
                    {file.status === "complete" ? (
                      "Complete"
                    ) : (
                      <>
                        <LinearProgress
                          variant="determinate"
                          value={file.progress}
                          sx={styles.progressBar}
                          color={file.progress < 50 ? "error" : "success"}
                        />
                        <Typography variant="caption">{file.progress}%</Typography>
                      </>
                    )}
                  </TableCell>
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
                      <MenuItem onClick={() => handleDownload(selectedFile)}>Download</MenuItem>
                      <MenuItem onClick={() => handleRemove(selectedFile?.id)}>Remove</MenuItem>
                      {selectedFile?.potreeUrl && <MenuItem onClick={() => handleViewPotree(selectedFile)}>View Potree</MenuItem>}
                    </Menu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Box>
    </Box>
  );
};

export default FileManagement;