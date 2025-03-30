import React, { useEffect, useState } from "react";
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
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  TextField,
  DialogActions,
  MenuItem,
  Snackbar,
  Alert,
  DialogContentText,
} from "@mui/material";
import { tokens } from "../../theme";
import { Edit, Delete, Add } from "@mui/icons-material";


const Team = ({ isCollapsed }) => { // Receive isCollapsed as a prop
  const theme = useTheme();
  const colors = tokens(theme.palette.mode);
  const [selected, setSelected] = useState([]);
  const [teamMembers, setTeamMembers] = useState([]);
  const [userRole, setUserRole] = useState(""); 
  const [open, setOpen] = useState(false); // Controls modal visibility
  const [openAddEditModal, setOpenAddEditModal] = useState(false); // Renamed for clarity
  const [openConfirmDeleteModal, setOpenConfirmDeleteModal] = useState(false); // State for delete confirmation
  const [userToDelete, setUserToDelete] = useState(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const [currentUserData, setCurrentUserData] = useState({
    id: null,
    username: "",
    email: "",
    password: "", // Keep password field, but handle carefully
    age: "",
    role: "manager", // Default role for new users
  });
  const [snackbarOpen, setSnackbarOpen] = useState(false); // State for Snackbar visibility
  const [snackbarMessage, setSnackbarMessage] = useState(""); // Message for Snackbar
  const [snackbarSeverity, setSnackbarSeverity] = useState("success"); // 'success' or 'error'

  // Fetch users from the database
  const fetchUsers = () => {
    fetch("http://localhost:5000/api/users")
      .then((response) => response.json())
      .then((data) => setTeamMembers(data))
      .catch((error) => console.error("Error fetching users:", error));
  };

  useEffect(() => {
    fetchUsers();
    // --- Read role from localStorage ---
    const storedRole = localStorage.getItem("userRole");
    if (storedRole) {
      setUserRole(storedRole);
      console.log("Role loaded from localStorage:", storedRole);
    }
  }, []);

  // --- Snackbar handler ---
  const showSnackbar = (message, severity = "success") => {
    setSnackbarMessage(message);
    setSnackbarSeverity(severity);
    setSnackbarOpen(true);
  };

  const handleSnackbarClose = (event, reason) => {
    if (reason === 'clickaway') {
      return;
    }
    setSnackbarOpen(false);
  };


  // --- Modal Open Handlers ---
  const handleOpenAddModal = () => {
    setIsEditMode(false);
    setCurrentUserData({ // Reset form for adding
      id: null,
      username: "",
      email: "",
      password: "",
      age: "",
      role: "manager", // Sensible default
    });
    setOpen(true);
  };

  const handleOpenEditModal = (user) => {
    setIsEditMode(true);
    setCurrentUserData({ // Populate form with user data
      id: user.id,
      username: user.username,
      email: user.email,
      password: "", // Clear password field for editing - DO NOT PREPOPULATE HASH
      age: user.age,
      role: user.role,
    });
    setOpen(true);
  };

  const handleCloseModal = () => {
    setOpen(false);
    // Consider resetting currentUserData here if desired when cancelling
    // setCurrentUserData({ id: null, username: "", /* ... */ });
  };

  // --- Form Change Handler ---
  const handleChange = (e) => {
    setCurrentUserData({ ...currentUserData, [e.target.name]: e.target.value });
  };

  // --- Submit Handlers ---
  const handleSubmit = async () => {
    const url = isEditMode ? `http://localhost:5000/api/users/${currentUserData.id}` : "http://localhost:5000/api/users";
    const method = isEditMode ? "PUT" : "POST";

    // Prepare data: Remove password if it's empty during edit
    const dataToSend = { ...currentUserData };
    if (isEditMode && !dataToSend.password) {
      delete dataToSend.password;
    }
    // Remove ID for POST requests if backend doesn't expect it
    if (!isEditMode) {
        delete dataToSend.id;
    }


    try {
      const response = await fetch(url, {
        method: method,
        headers: { "Content-Type": "application/json" },
        // SECURITY NOTE: Add Authorization header if using JWT/Tokens
        // headers: {
        //   "Content-Type": "application/json",
        //   "Authorization": `Bearer ${localStorage.getItem('token')}`
        // },
        body: JSON.stringify(dataToSend),
      });

      const result = await response.json(); // Get response body

      if (response.ok) {
        showSnackbar(result.message || `User ${isEditMode ? 'updated' : 'added'} successfully`, "success");
        handleCloseModal();
        fetchUsers(); // Refresh user list
      } else {
        showSnackbar(result.message || `Failed to ${isEditMode ? 'update' : 'add'} user`, "error");
        console.error("API Error:", result.message);
      }
    } catch (error) {
      console.error("Error submitting user data:", error);
      showSnackbar(`An error occurred: ${error.message}`, "error");
    }
  };

  const handleOpenConfirmDeleteModal = (user) => {
    setUserToDelete(user); // Store the whole user object (or just ID if preferred)
    setOpenConfirmDeleteModal(true);
  };

  const handleCloseConfirmDeleteModal = () => {
    setOpenConfirmDeleteModal(false);
    setUserToDelete(null); // Clear the user to delete
  };

  // --- Actual Delete Handler ---
  const handleDeleteUser = async () => {
    if (!userToDelete) return;

    const userId = userToDelete.id;
    const url = `http://localhost:5000/api/users/${userId}`;

    try {
      const response = await fetch(url, {
        method: "DELETE",
        // SECURITY NOTE: Add Authorization header if using JWT/Tokens
        // headers: {
        //   "Authorization": `Bearer ${localStorage.getItem('token')}`
        // },
      });

      // Check if response is ok OR if it's a 204 No Content (common for DELETE)
      if (response.ok || response.status === 204) {
        showSnackbar(`User '${userToDelete.username}' deleted successfully`, "success");
        handleCloseConfirmDeleteModal();
        fetchUsers(); // Refresh user list
      } else {
        // Try to parse error message from backend if available
        let errorMessage = `Failed to delete user '${userToDelete.username}'.`;
        try {
            const result = await response.json();
            errorMessage = result.message || errorMessage;
        } catch (parseError) {
            // Ignore if response body is not JSON or empty
            console.log("Could not parse error response body for delete.")
        }
        showSnackbar(errorMessage, "error");
        console.error("API Error deleting user:", response.status, response.statusText);
      }
    } catch (error) {
      console.error("Error deleting user:", error);
      showSnackbar(`An error occurred: ${error.message}`, "error");
    }
  };

  const styles = {
    container: {
      display: "flex",
      minHeight: "100vh",
      bgcolor: colors.grey[800],
      marginLeft: isCollapsed ? "80px" : "270px", // Use isCollapsed here
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
          backgroundColor: colors.primary[400],
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
      color: colors.grey[100],
      fontWeight: "bold",
    },
    bodyCell: {
      color: colors.grey[100],
    },
    checkbox: {
      color: `${colors.grey[100]} !important`,
    },
    accessCell: (access) => ({
      color:
        access === "admin"
          ? colors.greenAccent?.[400] ?? "#00ff00"
          : access === "manager"
          ? colors.primary[700] ?? "#0000ff"
          : colors.grey?.[100] ?? "#888888",
      fontWeight: "bold",
      textTransform: "capitalize",
    }),
    accessIcon: (access) => ({
      color:
        access === "admin"
          ? colors.greenAccent?.[400] ?? "#00ff00"
          : access === "manager"
          ? colors.primary[700] ?? "#0000ff"
          : colors.grey?.[100] ?? "#888888",
      paddingRight: "5px",
    }),
    footer: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      padding: "10px",
      color: colors.grey[100],
    },
    pagination: {
      color: colors.grey[100],
      "& .Mui-selected": {
        backgroundColor: `${colors.primary[400]} !important`,
        color: `${colors.grey[100]} !important`,
      },
    },
  };

  return (
    <Box sx={styles.container}>
      <Box sx={styles.content}>
        <Typography variant="h5" color={colors.grey[100]} fontWeight="bold" mb={2}>
        </Typography>
        {/* Add User Button */}
        {userRole === "admin" && (
          <Button
            variant="contained"
            color="primary"
            startIcon={<Add />}
            sx={{ mb: 2 }}
            onClick={handleOpenAddModal}
          >
            Add User
          </Button>
        )}
        {/* Pop-up Modal */}
        <Dialog open={open} onClose={handleCloseModal}>
          <DialogTitle>{isEditMode ? "Edit User" : "Add New User"}</DialogTitle>
          <DialogContent>
            <TextField name="username" label="Username" fullWidth margin="dense" value={currentUserData.username} onChange={handleChange} />
            <TextField name="email" label="Email" fullWidth margin="dense" value={currentUserData.email} onChange={handleChange} />
            {/* Conditionally render password explanation */}
            <TextField
              name="password"
              label={isEditMode ? "New Password (leave blank to keep current)" : "Password"}
              type="password"
              fullWidth
              margin="dense"
              value={currentUserData.password}
              onChange={handleChange}
            />
            <TextField name="age" label="Age" type="number" fullWidth margin="dense" value={currentUserData.age} onChange={handleChange} />
            <TextField select name="role" label="Role" fullWidth margin="dense" value={currentUserData.role} onChange={handleChange}>
              <MenuItem value="admin">Admin</MenuItem>
              <MenuItem value="manager">Manager</MenuItem>
            </TextField>
          </DialogContent>
          <DialogActions>
            <Button onClick={handleCloseModal} color="secondary">Cancel</Button>
            <Button onClick={handleSubmit} color="primary">{isEditMode ? "Save Changes" : "Add User"}</Button>
          </DialogActions>
        </Dialog>

        {/* Delete Confirmation Modal */}
        <Dialog
          open={openConfirmDeleteModal}
          onClose={handleCloseConfirmDeleteModal}
          aria-labelledby="alert-dialog-title"
          aria-describedby="alert-dialog-description"
        >
          <DialogTitle id="alert-dialog-title">Confirm Deletion</DialogTitle>
          <DialogContent>
            <DialogContentText id="alert-dialog-description">
              Are you sure you want to delete the user "{userToDelete?.username}" (ID: {userToDelete?.id})? This action cannot be undone.
            </DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button onClick={handleCloseConfirmDeleteModal} color="secondary">
              Cancel
            </Button>
            <Button onClick={handleDeleteUser} color="error" autoFocus>
              Delete
            </Button>
          </DialogActions>
        </Dialog>

        <TableContainer component={Paper} sx={styles.tableContainer}>
          <Table sx={styles.table} aria-label="simple table">
            <TableHead sx={styles.tableHead}>
              <TableRow>
                <TableCell sx={{ fontWeight: "bold", color: "#FFFFFF" }}>ID</TableCell>
                <TableCell sx={{ fontWeight: "bold", color: "#FFFFFF" }}>Username</TableCell>
                <TableCell sx={{ fontWeight: "bold", color: "#FFFFFF" }}>Email</TableCell>
                <TableCell sx={{ fontWeight: "bold", color: "#FFFFFF" }}>Age</TableCell>
                <TableCell sx={{ fontWeight: "bold", color: "#FFFFFF" }}>Role</TableCell>
                {userRole === "admin" && (
                  <TableCell sx={{ fontWeight: "bold", color: "#FFFFFF" }}>Action</TableCell>
                )}
              </TableRow>
            </TableHead>
            <TableBody>
            {teamMembers.length > 0 ? (
              teamMembers.map((user) => {
                return (
                  <TableRow key={user.id} hover>
                    <TableCell sx={{ color: colors.grey[100] }}>{user.id}</TableCell>
                    <TableCell sx={{ color: colors.grey[100] }}>{user.username}</TableCell>
                    <TableCell sx={{ color: colors.grey[100] }}>{user.email}</TableCell>
                    <TableCell sx={{ color: colors.grey[100] }}>{user.age}</TableCell>
                    <TableCell sx={styles.accessCell(user.role)}>
                      <span
                        className="material-symbols-outlined"
                        style={styles.accessIcon(user.role)}
                      >
                        {user.role === "admin"
                          ? "verified_user"
                          : user.role === "manager"
                          ? "security"
                          : "lock"}
                      </span>
                      {user.role}
                    </TableCell>
                    {userRole === "admin" && (
                      <TableCell>
                        <IconButton sx={{ color: colors.grey[100] }} onClick={() => handleOpenEditModal(user)} title="Edit User">
                          <Edit fontSize="small" />
                        </IconButton>
                        <IconButton sx={{ color: "red" }} onClick={() => handleOpenConfirmDeleteModal(user)} title="Delete User">
                          <Delete fontSize="small" />
                        </IconButton>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })
            ) : (
              <TableRow>
                <TableCell colSpan="4" className="text-center text-gray-500">
                  No users found
                </TableCell>
              </TableRow>
            )}
            </TableBody>
          </Table>
       </TableContainer>

       {/* Snackbar for Notifications */}
       <Snackbar
           open={snackbarOpen}
           autoHideDuration={6000} // Hide after 6 seconds
           onClose={handleSnackbarClose}
           anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} // Position
         >
           <Alert onClose={handleSnackbarClose} severity={snackbarSeverity} sx={{ width: '100%' }}>
             {snackbarMessage}
           </Alert>
         </Snackbar>
      </Box>
    </Box>
  );
};

export default Team;
