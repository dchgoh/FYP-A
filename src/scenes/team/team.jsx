import React, { useEffect, useState, useMemo, useCallback } from "react";
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
    Typography, // Added for better dialog titles on small screens
} from "@mui/material";
import { visuallyHidden } from "@mui/utils";
import { tokens } from "../../theme";
import { MoreVert, Add as AddIcon } from "@mui/icons-material"; // Import AddIcon

// Helper functions for sorting (no changes needed here)
function descendingComparator(a, b, orderBy) {
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
    { id: "index", numeric: false, disablePadding: false, label: "No.", sortable: false, sx: { width: { xs: '40px', sm: '60px' }, p: {xs: '8px 4px', sm: 1} } }, // Added sx for responsive width and padding
    { id: "username", numeric: false, disablePadding: false, label: "Username", sortable: true },
    { id: "email", numeric: false, disablePadding: false, label: "Email", sortable: true },
    { id: "role", numeric: false, disablePadding: false, label: "Role", sortable: true },
    { id: "is_locked", numeric: false, disablePadding: false, label: "Status", sortable: true },
    { id: "actions", numeric: false, disablePadding: false, label: "Action", sortable: false, sx: { width: { xs: '50px', sm: '70px' } } }, // Added sx for responsive width
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
    const [orderBy, setOrderBy] = useState(null);

    const isMenuOpen = Boolean(anchorEl);

    const showSnackbar = useCallback((message, severity = "success") => {
        setSnackbarMessage(message);
        setSnackbarSeverity(severity);
        setSnackbarOpen(true);
    }, []);

    const fetchUsers = useCallback(async () => {
        const token = localStorage.getItem('authToken');
        if (!token) {
            showSnackbar("Not authenticated. Please log in.", "error");
            setTeamMembers([]);
            return;
        }
        try {
            const response = await fetch("http://localhost:5000/api/users", {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!response.ok) {
                if (response.status === 401 || response.status === 403) {
                    showSnackbar("Session expired or invalid. Please log in again.", "error");
                } else {
                    const errorData = await response.json().catch(() => ({ message: `HTTP error! status: ${response.status}` }));
                    throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
                }
                setTeamMembers([]);
            } else {
                const data = await response.json();
                setTeamMembers(data);
            }
        } catch (error) {
            console.error("Error fetching users:", error);
            showSnackbar(`Failed to fetch users: ${error.message}`, "error");
            setTeamMembers([]);
        }
    }, [showSnackbar]);

    useEffect(() => {
        fetchUsers();
        const storedRole = localStorage.getItem("userRole");
        if (storedRole) {
            setUserRole(storedRole);
        }
    }, [fetchUsers]);

    const handleSnackbarClose = (event, reason) => {
        if (reason === "clickaway") return;
        setSnackbarOpen(false);
    };

    const handleOpenAddModal = () => {
        setIsEditMode(false);
        setCurrentUserData({ id: null, username: "", email: "", password: "", role: "Data Manager" });
        setOpen(true);
    };

    const handleOpenEditModal = (user) => {
        setIsEditMode(true);
        setCurrentUserData({ id: user.id, username: user.username, email: user.email, password: "", role: user.role });
        setOpen(true);
    };

    const handleCloseModal = () => setOpen(false);

    const handleChange = (e) => setCurrentUserData({ ...currentUserData, [e.target.name]: e.target.value });

    const handleSubmit = async () => {
        const token = localStorage.getItem('authToken');
        if (!token) {
            showSnackbar("Authentication token not found.", "error");
            return;
        }
        const url = isEditMode ? `http://localhost:5000/api/users/${currentUserData.id}` : "http://localhost:5000/api/users";
        const method = isEditMode ? "PUT" : "POST";
        const dataToSend = { ...currentUserData };
        if (isEditMode && !dataToSend.password) delete dataToSend.password;
        if (!isEditMode) delete dataToSend.id;

        try {
            const response = await fetch(url, {
                method: method,
                headers: { "Content-Type": "application/json", 'Authorization': `Bearer ${token}` },
                body: JSON.stringify(dataToSend),
            });
            let result = {};
            const contentType = response.headers.get("content-type");
            if (contentType?.includes("application/json")) result = await response.json();
            else result.message = response.statusText;

            if (response.ok) {
                showSnackbar(result.message || `User ${isEditMode ? "updated" : "added"} successfully`, "success");
                handleCloseModal();
                fetchUsers();
            } else {
                showSnackbar(result.message || `Failed to ${isEditMode ? "update" : "add"} user (Status: ${response.status})`, "error");
            }
        } catch (error) {
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
            showSnackbar("Authentication token not found.", "error");
            handleCloseConfirmDeleteModal();
            return;
        }
        const url = `http://localhost:5000/api/users/${userToDelete.id}`;
        try {
            const response = await fetch(url, { method: "DELETE", headers: { 'Authorization': `Bearer ${token}` } });
            if (response.ok || response.status === 204) {
                showSnackbar(`User '${userToDelete.username}' deleted.`, "success");
                handleCloseConfirmDeleteModal();
                fetchUsers();
            } else {
                let errorMessage = `Failed to delete '${userToDelete.username}'.`;
                const contentType = response.headers.get("content-type");
                if (contentType?.includes("application/json")) {
                    const result = await response.json().catch(() => ({}));
                    errorMessage = result.message || errorMessage;
                } else {
                    errorMessage = `${errorMessage} (Status: ${response.status} ${response.statusText})`;
                }
                showSnackbar(errorMessage, "error");
            }
        } catch (error) {
            showSnackbar(`An error occurred: ${error.message}`, "error");
        }
    };

    const handleUnlockUser = async (user) => {
        const token = localStorage.getItem('authToken');
        if (!token) {
            showSnackbar("Authentication token not found.", "error");
            return;
        }
        const url = `http://localhost:5000/api/users/${user.id}/unlock`;
        try {
            const response = await fetch(url, { method: "PUT", headers: { 'Authorization': `Bearer ${token}` } });
            if (response.ok) {
                showSnackbar(`User '${user.username}' unlocked.`, "success");
                fetchUsers();
            } else {
                let errorMessage = `Failed to unlock '${user.username}'.`;
                const result = await response.json().catch(() => ({}));
                errorMessage = result.message || `${errorMessage} (Status: ${response.status})`;
                showSnackbar(errorMessage, "error");
            }
        } catch (error) {
            showSnackbar(`Error unlocking user: ${error.message}`, "error");
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
        if (!orderBy) return teamMembers;
        return stableSort(teamMembers, getComparator(order, orderBy));
    }, [teamMembers, order, orderBy]);

    const styles = {
        container: {
            display: "flex",
            minHeight: "100vh", // Use minHeight instead of height for flexibility
            bgcolor: colors.grey[800],
            marginLeft: { // Responsive margin
                xs: isCollapsed ? "80px" : "80px", // On xs, always use collapsed margin or adjust as needed
                sm: isCollapsed ? "80px" : "270px",
            },
            transition: "margin 0.3s ease",
            width: { // Ensure it takes available width after margin
              xs: `calc(100% - ${isCollapsed ? "80px" : "80px"})`,
              sm: `calc(100% - ${isCollapsed ? "80px" : "270px"})`
            },
            overflowX: 'hidden', // Prevent horizontal scroll on the main container
        },
        content: {
            flex: 1,
            p: { xs: 1.5, sm: 2, md: 3 }, // Responsive padding for content area
            overflowY: 'auto', // Allow vertical scrolling for content if it overflows
            maxWidth: '100%', // Ensure content doesn't overflow its container
        },
        tableContainer: {
            backgroundColor: colors.grey[900],
            borderRadius: 2,
            mt: 2, // Margin top
            overflowX: "auto", // Crucial for table responsiveness
            "&::-webkit-scrollbar": { width: "8px", height: "8px" },
            "&::-webkit-scrollbar-track": { background: colors.grey[700] },
            "&::-webkit-scrollbar-thumb": {
                backgroundColor: colors.grey[500],
                borderRadius: "10px",
                border: `2px solid ${colors.grey[700]}`,
                "&:hover": { backgroundColor: colors.primary[400] },
            },
        },
        table: {
            minWidth: { xs: 500, sm: 650, md: 750 }, // Responsive minWidth
        },
        tableHead: {
            backgroundColor: colors.primary[700],
        },
        headCell: (customSx) => ({ // Allow passing custom sx
            color: colors.grey[100],
            fontWeight: "bold",
            whiteSpace: 'nowrap', // Prevent header text from wrapping
            p: { xs: '8px 12px', md: '12px 16px' }, // Responsive padding
            ...customSx
        }),
        bodyCell: (customSx) => ({ // Allow passing custom sx
            color: colors.grey[100],
            p: { xs: '8px 12px', md: '12px 16px' }, // Responsive padding
            whiteSpace: 'nowrap', // Prevent data from wrapping if too long (optional, consider ellipsis)
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            maxWidth: { xs: 100, sm: 150, md: 200 }, // Max width for cells that might overflow
            ...customSx
        }),
        accessCell: (access) => ({
            ...styles.bodyCell(), // Inherit base bodyCell styles
            color: access === "Administrator" ? colors.greenAccent?.[400] ?? "#00ff00"
                 : access === "Data Manager" ? colors.primary[700] ?? "#0000ff"
                 : colors.grey?.[100] ?? "#888888",
            fontWeight: "bold",
            textTransform: "capitalize",
            maxWidth: { xs: 120, sm: 150 }, // Specific max width for role
        }),
        accessIcon: (access) => ({
            color: access === "Administrator" ? colors.greenAccent?.[400] ?? "#00ff00"
                 : access === "Data Manager" ? colors.primary[700] ?? "#0000ff"
                 : colors.grey?.[100] ?? "#888888",
            paddingRight: "5px",
            verticalAlign: "middle",
            fontSize: { xs: '1rem', sm: '1.25rem' } // Responsive icon size
        }),
        accessContainer: {
            display: "inline-flex",
            alignItems: "center",
            gap: "5px",
        },
        isLocked: (isLocked) => ({
            ...styles.bodyCell(), // Inherit
            color: isLocked ? colors.redAccent[500] : colors.greenAccent[500],
            fontWeight: "bold",
            maxWidth: { xs: 60, sm: 80 }, // Specific max width for status
        }),
        dialogTitle: {
            backgroundColor: colors.primary[700],
            color: colors.grey[100],
            p: { xs: 1.5, sm: 2 }
        },
        dialogContent: {
            backgroundColor: colors.grey[800], // Slightly different from page bg for contrast
            p: { xs: 2, sm: 3 }
        },
        dialogActions: {
            padding: { xs: theme.spacing(1.5, 2), sm: theme.spacing(2, 3) },
            backgroundColor: colors.primary[700],
            borderTop: `1px solid ${colors.grey[700]}`,
            flexDirection: { xs: 'column-reverse', sm: 'row' }, // Stack buttons on small screens
            '& > :not(style)': { // Spacing for stacked buttons
                m: { xs: 0.5, sm: 0 },
                ml: { xs: 0, sm: 1 },
                width: { xs: '100%', sm: 'auto' }
            }
        }
    };


    return (
        <Box sx={styles.container}>
            <Box sx={styles.content}>
                {userRole === "Administrator" && (
                    <Button
                        variant="contained"
                        startIcon={<AddIcon />}
                        size={theme.breakpoints.down('sm') ? "small" : "medium"} // Responsive button size
                        sx={{
                            mb: { xs: 1.5, sm: 2 }, // Responsive margin bottom
                            backgroundColor: colors.primary[700],
                            color: "white",
                            "&:hover": { backgroundColor: colors.primary[400] },
                        }}
                        onClick={handleOpenAddModal}
                    >
                        Add User
                    </Button>
                )}

                <Dialog open={open} onClose={handleCloseModal} fullWidth maxWidth="sm">
                    <DialogTitle sx={styles.dialogTitle}>
                        <Typography variant="h5" component="div">
                            {isEditMode ? "Edit User" : "Add New User"}
                        </Typography>
                    </DialogTitle>
                    <DialogContent sx={styles.dialogContent}>
                        <TextField name="username" label="Username*" fullWidth margin="dense" value={currentUserData.username} onChange={handleChange} InputLabelProps={{ style: { color: colors.grey[300] } }} InputProps={{ style: { color: colors.grey[100] } }} />
                        <TextField name="email" label="Email*" fullWidth margin="dense" value={currentUserData.email} onChange={handleChange} InputLabelProps={{ style: { color: colors.grey[300] } }} InputProps={{ style: { color: colors.grey[100] } }} />
                        <TextField name="password" label={isEditMode ? "New Password (leave blank to keep current)" : "Password*"} type="password" fullWidth margin="dense" value={currentUserData.password} onChange={handleChange} InputLabelProps={{ style: { color: colors.grey[300] } }} InputProps={{ style: { color: colors.grey[100] } }} />
                        <TextField select name="role" label="Role*" fullWidth margin="dense" value={currentUserData.role} onChange={handleChange} InputLabelProps={{ style: { color: colors.grey[300] } }} SelectProps={{ style: { color: colors.grey[100] } }} MenuProps={{ PaperProps: { sx: { bgcolor: colors.grey[700], '& .MuiMenuItem-root': { color: colors.grey[100] } } } }}>
                            <MenuItem value="Administrator">Administrator</MenuItem>
                            <MenuItem value="Data Manager">Data Manager</MenuItem>
                            <MenuItem value="Regular">Regular</MenuItem>
                        </TextField>
                    </DialogContent>
                    <DialogActions sx={styles.dialogActions}>
                        <Button onClick={handleCloseModal} variant="outlined" sx={{ color: colors.grey[100], borderColor: colors.grey[500], '&:hover': { backgroundColor: colors.redAccent[700], borderColor: colors.redAccent[600] }}}>Cancel</Button>
                        <Button onClick={handleSubmit} variant="contained" disabled={!currentUserData.username.trim() || !currentUserData.email.trim() || (!isEditMode && !currentUserData.password.trim()) || !currentUserData.role} sx={{ backgroundColor: colors.greenAccent[600], color: colors.grey[900], '&:hover': { backgroundColor: colors.greenAccent[500] }, '&.Mui-disabled': { backgroundColor: colors.grey[700], color: colors.grey[500] }}}> {isEditMode ? "Save Changes" : "Add User"} </Button>
                    </DialogActions>
                </Dialog>

                <Dialog open={openConfirmDeleteModal} onClose={handleCloseConfirmDeleteModal} fullWidth maxWidth="xs">
                    <DialogTitle sx={styles.dialogTitle}>
                         <Typography variant="h5" component="div">Confirm Deletion</Typography>
                    </DialogTitle>
                    <DialogContent sx={styles.dialogContent}>
                        <DialogContentText sx={{ color: colors.grey[200] }}>
                            Are you sure you want to delete "{userToDelete?.username}"? This action cannot be undone.
                        </DialogContentText>
                    </DialogContent>
                    <DialogActions sx={styles.dialogActions}>
                        <Button onClick={handleCloseConfirmDeleteModal} sx={{ color: colors.grey[300] }}>Cancel</Button>
                        <Button onClick={handleDeleteUser} sx={{ color: colors.redAccent[400] }} autoFocus>Delete</Button>
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
                                        sx={styles.headCell(headCell.sx)} // Pass custom sx from headCells
                                    >
                                        {headCell.sortable ? (
                                            <TableSortLabel
                                                active={orderBy === headCell.id}
                                                direction={orderBy === headCell.id ? order : "asc"}
                                                onClick={(event) => handleRequestSort(event, headCell.id)}
                                                sx={{ '& .MuiTableSortLabel-icon': { color: orderBy === headCell.id ? colors.grey[100] : colors.grey[500] + ' !important' }, color: colors.grey[100] + ' !important' }}
                                            >
                                                {headCell.label}
                                                {orderBy === headCell.id ? (<Box component="span" sx={visuallyHidden}>{order === "desc" ? "sorted descending" : "sorted ascending"}</Box>) : null}
                                            </TableSortLabel>
                                        ) : headCell.label }
                                    </TableCell>
                                  ) : null
                                ))}
                            </TableRow>
                        </TableHead>
                         <TableBody>
                            {sortedTeamMembers.length > 0 ? (
                                sortedTeamMembers.map((user, index) => (
                                    <TableRow key={user.id} hover sx={{ '&:last-child td, &:last-child th': { border: 0 } }}>
                                        <TableCell sx={styles.bodyCell({ width: { xs: '40px', sm: '60px' }, p: {xs: '8px 4px', sm: 1} })}>{index + 1}</TableCell>
                                        <TableCell sx={styles.bodyCell({ maxWidth: {xs: 80, sm: 120, md: 150} })}>{user.username}</TableCell>
                                        <TableCell sx={styles.bodyCell({ maxWidth: {xs: 100, sm: 150, md: 250} })}>{user.email}</TableCell>
                                        <TableCell sx={styles.accessCell(user.role)}>
                                            <Box style={styles.accessContainer}>
                                                <Box component="span" className="material-symbols-outlined" style={styles.accessIcon(user.role)}>
                                                    {user.role === "Administrator" ? "verified_user" : user.role === "Data Manager" ? "security" : "person"}
                                                </Box>
                                                <Typography variant="body2" component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>
                                                    {user.role}
                                                </Typography>
                                            </Box>
                                        </TableCell>
                                        <TableCell sx={styles.isLocked(user.is_locked)}>
                                          {user.is_locked ? "Locked" : "Active"}
                                        </TableCell>
                                        {userRole === 'Administrator' && (
                                        <TableCell sx={styles.bodyCell({ width: { xs: '50px', sm: '70px' }, p: '0 !important', textAlign: 'center' })}>
                                            <IconButton
                                                aria-label="actions"
                                                onClick={(event) => handleMenuOpen(event, user)}
                                                sx={{ color: colors.grey[100], p: {xs: 0.5, sm: 1} }} // Responsive padding for icon button
                                                size="small"
                                            >
                                                <MoreVert fontSize="small" />
                                            </IconButton>
                                            <Menu
                                                anchorEl={anchorEl}
                                                open={isMenuOpen && selectedUserForActions?.id === user.id}
                                                onClose={handleMenuClose}
                                                PaperProps={{ sx: { bgcolor: colors.grey[700], '& .MuiMenuItem-root': { color: colors.grey[100], '&:hover': { bgcolor: colors.primary[600] } } } }}
                                            >
                                                <MenuItem onClick={() => { handleOpenEditModal(user); handleMenuClose(); }}>Edit</MenuItem>
                                                <MenuItem onClick={() => { handleOpenConfirmDeleteModal(user); handleMenuClose(); }}>Delete</MenuItem>
                                                {user.is_locked && (
                                                    <MenuItem onClick={() => { handleUnlockUser(user); handleMenuClose(); }}>Unlock User</MenuItem>
                                                )}
                                            </Menu>
                                        </TableCell>
                                        )}
                                    </TableRow>
                                ))
                            ) : (
                                <TableRow>
                                    <TableCell colSpan={headCells.filter(hc => hc.id !== 'actions' || userRole === 'Administrator').length} align="center" sx={styles.bodyCell()}> No users found </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </TableContainer>

                <Snackbar open={snackbarOpen} autoHideDuration={6000} onClose={handleSnackbarClose} anchorOrigin={{ vertical: "bottom", horizontal: "center" }}>
                    <Alert onClose={handleSnackbarClose} severity={snackbarSeverity} sx={{ width: "100%" }}>{snackbarMessage}</Alert>
                </Snackbar>
            </Box>
        </Box>
    );
};

export default Team;