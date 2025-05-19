import React, { useEffect, useState, useMemo, useCallback } from "react"; // Import useCallback
import {
    Box,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Paper,
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
    TableSortLabel,
} from "@mui/material";
import { visuallyHidden } from "@mui/utils";
import { tokens } from "../../theme";
import { MoreVert } from "@mui/icons-material";

// Helper functions for sorting (no changes needed here)
function descendingComparator(a, b, orderBy) {
    // Ensure values are comparable, treat null/undefined as lowest
    const valA = a[orderBy] ?? -Infinity;
    const valB = b[orderBy] ?? -Infinity;
    if (valB < valA) {
        return -1;
    }
    if (valB > valA) {
        return 1;
    }
    return 0;
}

function getComparator(order, orderBy) {
    return order === "desc"
        ? (a, b) => descendingComparator(a, b, orderBy)
        : (a, b) => -descendingComparator(a, b, orderBy);
}

function stableSort(array, comparator) {
    const stabilizedThis = array.map((el, index) => [el, index]);
    stabilizedThis.sort((a, b) => {
        const order = comparator(a[0], b[0]);
        if (order !== 0) {
            return order;
        }
        return a[1] - b[1];
    });
    return stabilizedThis.map((el) => el[0]);
}

const headCells = [
    { id: "index", numeric: false, disablePadding: false, label: "No.", sortable: false },
    { id: "username", numeric: false, disablePadding: false, label: "Username", sortable: true },
    { id: "email", numeric: false, disablePadding: false, label: "Email", sortable: true },
    { id: "role", numeric: false, disablePadding: false, label: "Role", sortable: true },
    { id: "is_locked", numeric: false, disablePadding: false, label: "Status", sortable: true },
    { id: "actions", numeric: false, disablePadding: false, label: "Action", sortable: false },
];

const Team = ({ isCollapsed }) => {
    const theme = useTheme();
    const colors = tokens(theme.palette.mode);
    const [teamMembers, setTeamMembers] = useState([]);
    const [userRole, setUserRole] = useState("");
    const [open, setOpen] = useState(false);
    const [openConfirmDeleteModal, setOpenConfirmDeleteModal] = useState(false);
    const [userToDelete, setUserToDelete] = useState(null);
    const [isEditMode, setIsEditMode] = useState(false);
    const [currentUserData, setCurrentUserData] = useState({
        id: null,
        username: "",
        email: "",
        password: "",
        role: "Data Manager",
    });
    const [snackbarOpen, setSnackbarOpen] = useState(false);
    const [snackbarMessage, setSnackbarMessage] = useState("");
    const [snackbarSeverity, setSnackbarSeverity] = useState("success");

    const [anchorEl, setAnchorEl] = useState(null);
    const [selectedUserForActions, setSelectedUserForActions] = useState(null);

    const [order, setOrder] = useState("asc");
    const [orderBy, setOrderBy] = useState(null); // Default to null, no initial sort

    const isMenuOpen = Boolean(anchorEl);

    // --- Start of Changes ---

    // Memoize showSnackbar as it's a dependency of fetchUsers
    const showSnackbar = useCallback((message, severity = "success") => {
        setSnackbarMessage(message);
        setSnackbarSeverity(severity);
        setSnackbarOpen(true);
    }, []); // No external dependencies changing over time

    // Memoize fetchUsers using useCallback
    const fetchUsers = useCallback(async () => {
        const token = localStorage.getItem('authToken');
        if (!token) {
            showSnackbar("Not authenticated. Please log in.", "error");
            setTeamMembers([]); // Clear data if not authenticated
            return;
        }

        try {
            const response = await fetch("http://localhost:5000/api/users", {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (!response.ok) {
                if (response.status === 401 || response.status === 403) {
                    showSnackbar("Session expired or invalid. Please log in again.", "error");
                    // Potentially redirect to login here
                } else {
                    const errorData = await response.json().catch(() => ({ message: `HTTP error! status: ${response.status}` }));
                    throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
                }
                setTeamMembers([]); // Clear data on error
            } else {
                const data = await response.json();
                setTeamMembers(data);
            }
        } catch (error) {
            console.error("Error fetching users:", error);
            showSnackbar(`Failed to fetch users: ${error.message}`, "error");
            setTeamMembers([]); // Clear data on fetch error
        }
    }, [showSnackbar]); // Add showSnackbar as a dependency


    useEffect(() => {
        fetchUsers(); // Fetch users on mount
        const storedRole = localStorage.getItem("userRole");
        if (storedRole) {
            setUserRole(storedRole);
        }
    }, [fetchUsers]); // Add fetchUsers to dependency array

    const handleSnackbarClose = (event, reason) => {
        if (reason === "clickaway") {
            return;
        }
        setSnackbarOpen(false);
    };

    const handleOpenAddModal = () => {
        setIsEditMode(false);
        setCurrentUserData({
            id: null, username: "", email: "", password: "", role: "Data Manager",
        });
        setOpen(true);
    };

    const handleOpenEditModal = (user) => {
        setIsEditMode(true);
        setCurrentUserData({
            id: user.id, username: user.username, email: user.email, password: "", role: user.role,
        });
        setOpen(true);
    };

    const handleCloseModal = () => {
        setOpen(false);
    };

    const handleChange = (e) => {
        setCurrentUserData({ ...currentUserData, [e.target.name]: e.target.value });
    };

    const handleSubmit = async () => {
        const token = localStorage.getItem('authToken');
        if (!token) {
            showSnackbar("Authentication token not found. Cannot save.", "error");
            return;
        }

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
                headers: {
                    "Content-Type": "application/json",
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(dataToSend),
            });

            let result = {};
            const contentType = response.headers.get("content-type");
            if (contentType && contentType.indexOf("application/json") !== -1) {
                result = await response.json();
            } else {
                result.message = response.statusText;
            }

            if (response.ok) {
                showSnackbar(
                    result.message || `User ${isEditMode ? "updated" : "added"} successfully`,
                    "success"
                );
                handleCloseModal();
                fetchUsers();
            } else {
                showSnackbar(
                    result.message || `Failed to ${isEditMode ? "update" : "add"} user (Status: ${response.status})`,
                    "error"
                );
                console.error("API Error:", response.status, result.message);
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

    const handleDeleteUser = async () => {
        if (!userToDelete) return;

        const token = localStorage.getItem('authToken');
        if (!token) {
            showSnackbar("Authentication token not found. Cannot delete.", "error");
            handleCloseConfirmDeleteModal();
            return;
        }

        const userId = userToDelete.id;
        const url = `http://localhost:5000/api/users/${userId}`;

        try {
            const response = await fetch(url, {
                method: "DELETE",
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (response.ok || response.status === 204) {
                showSnackbar(`User '${userToDelete.username}' deleted successfully`, "success");
                handleCloseConfirmDeleteModal();
                fetchUsers();
            } else {
                let errorMessage = `Failed to delete user '${userToDelete.username}'.`;
                const contentType = response.headers.get("content-type");
                if (contentType && contentType.indexOf("application/json") !== -1) {
                    try {
                        const result = await response.json();
                        errorMessage = result.message || errorMessage;
                    } catch (parseError) {
                        console.log("Could not parse error response body for delete.");
                    }
                } else {
                    errorMessage = `${errorMessage} (Status: ${response.status} ${response.statusText})`;
                }

                showSnackbar(errorMessage, "error");
                console.error("API Error deleting user:", response.status, response.statusText);
            }
        } catch (error) {
            console.error("Error deleting user:", error);
            showSnackbar(`An error occurred: ${error.message}`, "error");
        }
    };

    const handleUnlockUser = async (user) => {
        const token = localStorage.getItem('authToken');
        if (!token) {
            showSnackbar("Authentication token not found. Cannot unlock user.", "error");
            return;
        }

        const userId = user.id;
        const url = `http://localhost:5000/api/users/${userId}/unlock`;

        try {
            const response = await fetch(url, {
                method: "PUT",
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (response.ok) {
                showSnackbar(`User '${user.username}' unlocked successfully`, "success");
                fetchUsers();
            } else {
                let errorMessage = `Failed to unlock user '${user.username}'.`;
                try {
                    const result = await response.json();
                    errorMessage = result.message || errorMessage;
                } catch (parseError) {
                    console.log("Could not parse error response for unlock.");
                    errorMessage = `${errorMessage} (Status: ${response.status})`;
                }
                showSnackbar(errorMessage, "error");
                console.error("API Error unlocking user:", response.status);
            }
        } catch (error) {
            console.error("Error unlocking user:", error);
            showSnackbar(`An error occurred while unlocking user: ${error.message}`, "error");
        } finally {
            handleMenuClose();
        }
    };

    const handleMenuOpen = (event, user) => {
        setAnchorEl(event.currentTarget);
        setSelectedUserForActions(user);
    };

    const handleMenuClose = () => {
        setAnchorEl(null);
        setSelectedUserForActions(null);
    };

    const handleRequestSort = (event, property) => {
        const isAsc = orderBy === property && order === "asc";
        setOrder(isAsc ? "desc" : "asc");
        setOrderBy(property);
    };

    const sortedTeamMembers = useMemo(() => {
        if (!orderBy) {
            return teamMembers;
        }
        const processedTeamMembers = teamMembers.map(member => ({
            ...member,
            age: Number(member.age) || 0
        }));
        return stableSort(processedTeamMembers, getComparator(order, orderBy));
    }, [teamMembers, order, orderBy]);

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
        accessCell: (access) => ({
            color:
                access === "Administrator"
                    ? colors.greenAccent?.[400] ?? "#00ff00"
                    : access === "Data Manager"
                        ? colors.primary[700] ?? "#0000ff"
                        : colors.grey?.[100] ?? "#888888",
            fontWeight: "bold",
            textTransform: "capitalize",
        }),
        accessIcon: (access) => ({
            color:
                access === "Administrator"
                    ? colors.greenAccent?.[400] ?? "#00ff00"
                    : access === "Data Manager"
                        ? colors.primary[700] ?? "#0000ff"
                        : colors.grey?.[100] ?? "#888888",
            paddingRight: "5px",
            verticalAlign: "middle",
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
            display: "inline-flex",
            alignItems: "center",
            gap: "5px",
            verticalAlign: "middle",
        },
        isLocked: (isLocked) => ({
            color: isLocked ? colors.redAccent[500] : colors.greenAccent[500],
            fontWeight: "bold",
        }),
    };

    return (
        <Box sx={styles.container}>
            <Box sx={styles.content}>
                {/* Add User Button */}
                {userRole === "Administrator" && (
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
                        <TextField
                            name="username"
                            label="Username*"
                            fullWidth
                            margin="dense"
                            value={currentUserData.username}
                            onChange={handleChange}
                        />
                        <TextField
                            name="email"
                            label="Email*"
                            fullWidth
                            margin="dense"
                            value={currentUserData.email}
                            onChange={handleChange}
                        />
                        <TextField
                            name="password"
                            label={isEditMode ? "New Password (leave blank to keep current)" : "Password*"}
                            type="password"
                            fullWidth
                            margin="dense"
                            value={currentUserData.password}
                            onChange={handleChange}
                        />
                        <TextField
                            select
                            name="role"
                            label="Role*"
                            fullWidth
                            margin="dense"
                            value={currentUserData.role}
                            onChange={handleChange}
                        >
                            <MenuItem value="Administrator">Administrator</MenuItem>
                            <MenuItem value="Data Manager">Data Manager</MenuItem>
                            <MenuItem value="Regular">Regular</MenuItem>
                        </TextField>
                    </DialogContent>
                    <DialogActions
                        sx={{ // Optional: Add padding and border like in FileManagement if desired
                            padding: theme.spacing(2, 3),
                            backgroundColor: colors.primary[700], // Match FileManagement
                            borderTop: `1px solid ${colors.grey[700]}` // Match FileManagement
                        }}
                    >
                        <Button // CANCEL BUTTON
                            onClick={handleCloseModal}
                            variant="outlined"
                            sx={{
                                color: colors.grey[100],
                                borderColor: colors.grey[500],
                                transition: theme.transitions.create(
                                    ['color', 'border-color', 'background-color'],
                                    { duration: theme.transitions.duration.short }
                                ),
                                '&:hover': {
                                    backgroundColor: colors.redAccent[500],
                                    color: colors.grey[100], // Or colors.black if redAccent is light
                                    borderColor: colors.redAccent[500],
                                },
                                '&.Mui-disabled': { // Though cancel is rarely disabled
                                    color: colors.grey[600],
                                    borderColor: colors.grey[700],
                                    backgroundColor: 'transparent',
                                }
                            }}
                        >
                            Cancel
                        </Button>
                        <Button // ADD USER / SAVE CHANGES BUTTON
                            onClick={handleSubmit}
                            variant="contained"
                            disabled={
                                !currentUserData.username.trim() ||
                                !currentUserData.email.trim() ||
                                (!isEditMode && !currentUserData.password.trim()) || // Password required for new user
                                !currentUserData.role // Role is also required
                            }
                            sx={{
                                backgroundColor: colors.greenAccent[500],
                                color: colors.grey[100],
                                '&:hover': {
                                    backgroundColor: colors.greenAccent[400],
                                },
                                '&.Mui-disabled': {
                                    backgroundColor: colors.grey[600],
                                    color: colors.grey[400],
                                }
                            }}
                        >
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
                        <TableHead sx={styles.tableHead}>
                            <TableRow>
                                {headCells.map((headCell) => (
                                  (headCell.id !== 'actions' || userRole === 'Administrator') ? (
                                    <TableCell
                                        key={headCell.id}
                                        align={headCell.numeric ? "right" : "left"}
                                        padding={headCell.disablePadding ? "none" : "normal"}
                                        sortDirection={orderBy === headCell.id ? order : false}
                                        sx={styles.headCell}
                                    >
                                        {headCell.sortable ? (
                                            <TableSortLabel
                                                active={orderBy === headCell.id}
                                                direction={orderBy === headCell.id ? order : "asc"}
                                                onClick={(event) => handleRequestSort(event, headCell.id)}
                                                sx={{
                                                    '& .MuiTableSortLabel-icon': {
                                                        color: orderBy === headCell.id ? colors.grey[100] : colors.grey[500] + ' !important',
                                                    },
                                                    color: colors.grey[100] + ' !important',
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
                                            headCell.label
                                        )}
                                    </TableCell>
                                  ) : null
                                ))}
                            </TableRow>
                        </TableHead>
                         <TableBody>
                            {sortedTeamMembers.length > 0 ? (
                                sortedTeamMembers.map((user, index) => (
                                    <TableRow key={user.id} hover>
                                        <TableCell sx={styles.bodyCell}>{index + 1}</TableCell>
                                        <TableCell sx={styles.bodyCell}>{user.username}</TableCell>
                                        <TableCell sx={styles.bodyCell}>{user.email}</TableCell>
                                        {/* <TableCell sx={styles.bodyCell} align="right">{user.age}</TableCell> */}{/* REMOVE THIS LINE */}
                                        <TableCell sx={styles.accessCell(user.role)}> {/* This is now the 4th data cell, matching "Role" header */}
                                            <div style={styles.accessContainer}>
                                                <span
                                                    className="material-symbols-outlined"
                                                    style={styles.accessIcon(user.role)}
                                                >
                                                    {user.role === "Administrator"
                                                        ? "verified_user"
                                                        : user.role === "Data Manager"
                                                            ? "security"
                                                            : "person"}
                                                </span>
                                                {user.role}
                                            </div>
                                        </TableCell>
                                        <TableCell sx={styles.bodyCell}> {/* This is now the 5th data cell, matching "Status" header */}
                                          {user.is_locked ? "Locked" : "Active"}
                                        </TableCell>
                                        {userRole === 'Administrator' && (
                                        <TableCell> {/* This is now the 6th data cell, matching "Action" header */}
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
                                                {user.is_locked && ( // Conditionally render Unlock User
                                                    <MenuItem onClick={() => { handleUnlockUser(user); handleMenuClose(); }}>Unlock User</MenuItem>
                                                )}
                                            </Menu>
                                        </TableCell>
                                        )}
                                    </TableRow>
                                ))
                            ) : (
                                <TableRow>
                                    <TableCell
                                        colSpan={headCells.length} // This will correctly reflect the new number of columns
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