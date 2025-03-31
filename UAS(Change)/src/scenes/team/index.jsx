import React, { useEffect, useState, useMemo } from "react"; // Import useMemo
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
  Menu,
  TableSortLabel, // Import TableSortLabel
} from "@mui/material";
import { visuallyHidden } from "@mui/utils"; // Helper for accessibility
import { tokens } from "../../theme";
import { Edit, Delete, Add, MoreVert } from "@mui/icons-material";

// Helper function for stable sorting
function descendingComparator(a, b, orderBy) {
  if (b[orderBy] < a[orderBy]) {
    return -1;
  }
  if (b[orderBy] > a[orderBy]) {
    return 1;
  }
  return 0;
}

// Helper function to get the comparator based on order and orderBy
function getComparator(order, orderBy) {
  return order === "desc"
    ? (a, b) => descendingComparator(a, b, orderBy)
    : (a, b) => -descendingComparator(a, b, orderBy);
}

// Helper function for stable sorting across browsers
function stableSort(array, comparator) {
  const stabilizedThis = array.map((el, index) => [el, index]);
  stabilizedThis.sort((a, b) => {
    const order = comparator(a[0], b[0]);
    if (order !== 0) {
      return order;
    }
    return a[1] - b[1]; // Use original index for stability
  });
  return stabilizedThis.map((el) => el[0]);
}

// Define which columns are sortable and their corresponding data keys
const headCells = [
  { id: "index", numeric: false, disablePadding: false, label: "No.", sortable: false },
  { id: "username", numeric: false, disablePadding: false, label: "Username", sortable: true },
  { id: "email", numeric: false, disablePadding: false, label: "Email", sortable: true },
  { id: "age", numeric: true, disablePadding: false, label: "Age", sortable: true },
  { id: "role", numeric: false, disablePadding: false, label: "Role", sortable: true },
  { id: "actions", numeric: false, disablePadding: false, label: "Action", sortable: false },
];


const Team = ({ isCollapsed }) => {
  // Receive isCollapsed as a prop
  const theme = useTheme();
  const colors = tokens(theme.palette.mode);
  const [selected, setSelected] = useState([]);
  const [teamMembers, setTeamMembers] = useState([]);
  const [userRole, setUserRole] = useState("");
  const [open, setOpen] = useState(false); // Controls modal visibility
  // const [openAddEditModal, setOpenAddEditModal] = useState(false); // You might not need this if `open` handles both
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

  // State for the action menu
  const [anchorEl, setAnchorEl] = useState(null);
  const [selectedUserForActions, setSelectedUserForActions] = useState(null);

  // --- Sorting State ---
  const [order, setOrder] = useState("asc"); // 'asc' or 'desc'
  const [orderBy, setOrderBy] = useState(null); // Property name to sort by (e.g., 'username', 'age')

  const isMenuOpen = Boolean(anchorEl);

  // Fetch users from the database
  const fetchUsers = () => {
    fetch("http://localhost:5000/api/users")
      .then((response) => response.json())
      .then((data) => setTeamMembers(data))
      .catch((error) => console.error("Error fetching users:", error));
  };

  useEffect(() => {
    fetchUsers();
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
    if (reason === "clickaway") {
      return;
    }
    setSnackbarOpen(false);
  };

  // --- Modal Open Handlers ---
  const handleOpenAddModal = () => {
    setIsEditMode(false);
    setCurrentUserData({
      id: null, username: "", email: "", password: "", age: "", role: "manager",
    });
    setOpen(true);
  };

  const handleOpenEditModal = (user) => {
    setIsEditMode(true);
    setCurrentUserData({
      id: user.id, username: user.username, email: user.email, password: "", age: user.age, role: user.role,
    });
    setOpen(true);
  };

  const handleCloseModal = () => {
    setOpen(false);
  };

  // --- Form Change Handler ---
  const handleChange = (e) => {
    setCurrentUserData({ ...currentUserData, [e.target.name]: e.target.value });
  };

  // --- Submit Handlers ---
  const handleSubmit = async () => {
    const url = isEditMode
      ? `http://localhost:5000/api/users/${currentUserData.id}`
      : "http://localhost:5000/api/users";
    const method = isEditMode ? "PUT" : "POST";

    const dataToSend = { ...currentUserData };
    if (isEditMode && !dataToSend.password) {
      delete dataToSend.password;
    }
    if (!isEditMode) {
      delete dataToSend.id;
    }

    try {
      const response = await fetch(url, {
        method: method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(dataToSend),
      });

      const result = await response.json();

      if (response.ok) {
        showSnackbar(
          result.message || `User ${isEditMode ? "updated" : "added"} successfully`,
          "success"
        );
        handleCloseModal();
        fetchUsers();
      } else {
        showSnackbar(
          result.message || `Failed to ${isEditMode ? "update" : "add"} user`,
          "error"
        );
        console.error("API Error:", result.message);
      }
    } catch (error) {
      console.error("Error submitting user data:", error);
      showSnackbar(`An error occurred: ${error.message}`, "error");
    }
  };

  const handleOpenConfirmDeleteModal = (user) => {
    setUserToDelete(user);
    setOpenConfirmDeleteModal(true);
  };

  const handleCloseConfirmDeleteModal = () => {
    setOpenConfirmDeleteModal(false);
    setUserToDelete(null);
  };

  // --- Actual Delete Handler ---
  const handleDeleteUser = async () => {
    if (!userToDelete) return;

    const userId = userToDelete.id;
    const url = `http://localhost:5000/api/users/${userId}`;

    try {
      const response = await fetch(url, { method: "DELETE" });

      if (response.ok || response.status === 204) {
        showSnackbar(`User '${userToDelete.username}' deleted successfully`, "success");
        handleCloseConfirmDeleteModal();
        fetchUsers();
      } else {
        let errorMessage = `Failed to delete user '${userToDelete.username}'.`;
        try {
          const result = await response.json();
          errorMessage = result.message || errorMessage;
        } catch (parseError) {
          console.log("Could not parse error response body for delete.");
        }
        showSnackbar(errorMessage, "error");
        console.error("API Error deleting user:", response.status, response.statusText);
      }
    } catch (error) {
      console.error("Error deleting user:", error);
      showSnackbar(`An error occurred: ${error.message}`, "error");
    }
  };

  // --- Action Menu Handlers ---
  const handleMenuOpen = (event, user) => {
    setAnchorEl(event.currentTarget);
    setSelectedUserForActions(user);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
    setSelectedUserForActions(null);
  };

  // --- Sorting Handler ---
  const handleRequestSort = (event, property) => {
    const isAsc = orderBy === property && order === "asc";
    setOrder(isAsc ? "desc" : "asc");
    setOrderBy(property);
  };

  // --- Calculate Sorted Data ---
  // Use useMemo to avoid recalculating the sorted array on every render
  const sortedTeamMembers = useMemo(() => {
    if (!orderBy) {
      // If no sort is applied, return the original array (or apply a default sort if desired)
      return teamMembers;
    }
    // Ensure age is treated as a number for sorting
    const processedTeamMembers = teamMembers.map(member => ({
        ...member,
        age: Number(member.age) || 0 // Convert age to number, default to 0 if invalid
    }));
    return stableSort(processedTeamMembers, getComparator(order, orderBy));
  }, [teamMembers, order, orderBy]); // Dependencies for useMemo

  const styles = {
    // ... (keep your existing styles object) ...
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
      verticalAlign: "middle", // Align icon vertically
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
    accessContainer: {
      display: "inline-flex", // Use inline-flex
      alignItems: "center",     // Vertically align items
      gap: "5px",              // Add some space between icon and text
      verticalAlign: "middle",  // Ensure vertical alignment
    },
  };

  return (
    <Box sx={styles.container}>
      <Box sx={styles.content}>
        {/* Add User Button */}
        {userRole === "admin" && (
          <Button
            variant="contained"
            startIcon={<span className="material-symbols-outlined">add</span>}
            sx={{
              mb: 2,
              backgroundColor: colors.primary[700],
              color: "white",
              "&:hover": { backgroundColor: colors.primary[400] },
            }}
            onClick={handleOpenAddModal}
          >
            Add User
          </Button>
        )}
        {/* Pop-up Modal */}
        <Dialog open={open} onClose={handleCloseModal}>
          <DialogTitle>{isEditMode ? "Edit User" : "Add New User"}</DialogTitle>
          <DialogContent>
            {/* ... (keep your text fields) */}
             <TextField
              name="username"
              label="Username"
              fullWidth
              margin="dense"
              value={currentUserData.username}
              onChange={handleChange}
            />
            <TextField
              name="email"
              label="Email"
              fullWidth
              margin="dense"
              value={currentUserData.email}
              onChange={handleChange}
            />
            <TextField
              name="password"
              label={isEditMode ? "New Password (leave blank to keep current)" : "Password"}
              type="password"
              fullWidth
              margin="dense"
              value={currentUserData.password}
              onChange={handleChange}
            />
            <TextField
              name="age"
              label="Age"
              type="number"
              fullWidth
              margin="dense"
              value={currentUserData.age}
              onChange={handleChange}
              InputProps={{ inputProps: { min: 0 } }} // Optional: prevent negative age
            />
            <TextField
              select
              name="role"
              label="Role"
              fullWidth
              margin="dense"
              value={currentUserData.role}
              onChange={handleChange}
            >
              <MenuItem value="admin">Admin</MenuItem>
              <MenuItem value="manager">Manager</MenuItem>
              {/* Add other roles if needed */}
            </TextField>
          </DialogContent>
          <DialogActions>
            <Button onClick={handleCloseModal} color="secondary">
              Cancel
            </Button>
            <Button onClick={handleSubmit} color="primary">
              {isEditMode ? "Save Changes" : "Add User"}
            </Button>
          </DialogActions>
        </Dialog>

        {/* Delete Confirmation Modal */}
        <Dialog
          open={openConfirmDeleteModal}
          onClose={handleCloseConfirmDeleteModal}
          aria-labelledby="alert-dialog-title"
          aria-describedby="alert-dialog-description"
        >
            {/* ... (keep your delete confirmation dialog content) */}
            <DialogTitle id="alert-dialog-title">Confirm Deletion</DialogTitle>
            <DialogContent>
                <DialogContentText id="alert-dialog-description">
                Are you sure you want to delete the user "{userToDelete?.username}" (ID:{" "}
                {userToDelete?.id})? This action cannot be undone.
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
          <Table sx={styles.table} aria-label="team members table">
            {/* --- Enhanced Table Head for Sorting --- */}
            <TableHead sx={styles.tableHead}>
              <TableRow>
                {headCells.map((headCell) => {
                  // Only render Action column if user is admin
                  if (headCell.id === 'actions' && userRole !== 'admin') {
                    return null;
                  }
                  // Only render sort label for sortable columns
                  const isSortable = headCell.sortable;
                  return (
                    <TableCell
                      key={headCell.id}
                      align={headCell.numeric ? "right" : "left"}
                      padding={headCell.disablePadding ? "none" : "normal"}
                      sortDirection={orderBy === headCell.id ? order : false}
                      sx={styles.headCell}
                    >
                      {isSortable ? (
                        <TableSortLabel
                          active={orderBy === headCell.id}
                          direction={orderBy === headCell.id ? order : "asc"}
                          onClick={(event) => handleRequestSort(event, headCell.id)}
                          sx={{
                            // Style the sort label itself if needed
                            '& .MuiTableSortLabel-icon': {
                                color: orderBy === headCell.id ? colors.grey[100] : colors.grey[500] + ' !important', // Ensure icon visibility
                            },
                            color: colors.grey[100] + ' !important', // Make text white
                          }}
                        >
                          {headCell.label}
                          {orderBy === headCell.id ? (
                            <Box component="span" sx={visuallyHidden}>
                              {order === "desc" ? "sorted descending" : "sorted ascending"}
                            </Box>
                          ) : null}
                        </TableSortLabel>
                      ) : (
                        headCell.label // Render label without sort functionality
                      )}
                    </TableCell>
                  );
                })}
              </TableRow>
            </TableHead>
            <TableBody>
              {/* --- Use sortedTeamMembers for mapping --- */}
              {sortedTeamMembers.length > 0 ? (
                sortedTeamMembers.map((user, index) => { // index here is the sorted index, not stable ID
                  const originalIndex = teamMembers.findIndex(originalUser => originalUser.id === user.id); // Find original index if needed for display
                  return (
                    <TableRow key={user.id} hover>
                       {/* Use originalIndex + 1 if you want the number based on original fetch order */}
                       {/* Or just use index + 1 for the sorted row number */}
                      <TableCell sx={styles.bodyCell}>{index + 1}</TableCell>
                      <TableCell sx={styles.bodyCell}>{user.username}</TableCell>
                      <TableCell sx={styles.bodyCell}>{user.email}</TableCell>
                      <TableCell sx={styles.bodyCell} align="right">{user.age}</TableCell> {/* Align numeric data */}
                      <TableCell sx={styles.accessCell(user.role)}>
                        <div style={styles.accessContainer}>
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
                        </div>
                      </TableCell>
                      {userRole === "admin" && (
                        <TableCell>
                           {/* ... (keep your action menu IconButton and Menu) */}
                           <IconButton
                            aria-label="actions"
                            aria-controls={`actions-menu-${user.id}`}
                            aria-haspopup="true"
                            onClick={(event) => handleMenuOpen(event, user)}
                            sx={{ color: colors.grey[100] }}
                          >
                            <MoreVert />
                          </IconButton>
                          <Menu
                            id={`actions-menu-${user.id}`}
                            anchorEl={anchorEl}
                            open={isMenuOpen && selectedUserForActions?.id === user.id}
                            onClose={handleMenuClose}
                            MenuListProps={{
                              'aria-labelledby': `actions-button-${user.id}`,
                            }}
                          >
                            <MenuItem onClick={() => { handleOpenEditModal(user); handleMenuClose(); }}>Edit</MenuItem>
                            <MenuItem onClick={() => { handleOpenConfirmDeleteModal(user); handleMenuClose(); }}>Delete</MenuItem>
                          </Menu>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })
              ) : (
                <TableRow>
                  <TableCell
                    colSpan={userRole === "admin" ? headCells.length : headCells.length -1} // Adjust colspan based on role
                    align="center"
                    sx={styles.bodyCell}
                  >
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
          autoHideDuration={6000}
          onClose={handleSnackbarClose}
          anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
        >
          <Alert onClose={handleSnackbarClose} severity={snackbarSeverity} sx={{ width: "100%" }}>
            {snackbarMessage}
          </Alert>
        </Snackbar>
      </Box>
    </Box>
  );
};

export default Team;