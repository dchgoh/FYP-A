import React from "react";
import {
    Box, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper, useTheme, IconButton,
    Button, Dialog, DialogTitle, DialogContent, TextField, DialogActions, MenuItem, Snackbar, Alert,
    DialogContentText, Menu, TableSortLabel, CircularProgress
} from "@mui/material";
import { visuallyHidden } from "@mui/utils";
import { tokens } from "../../theme";
import { MoreVert, Add as AddIcon } from "@mui/icons-material";
import { useTeamManagement } from '../../hooks/useTeamManagement'; // IMPORT THE HOOK

const headCells = [
    { id: "index", numeric: false, label: "No.", sortable: false },
    { id: "username", numeric: false, label: "Username", sortable: true },
    { id: "email", numeric: false, label: "Email", sortable: true },
    { id: "role", numeric: false, label: "Role", sortable: true },
    { id: "is_locked", numeric: false, label: "Status", sortable: true },
    { id: "actions", numeric: false, label: "Action", sortable: false },
];

const Team = ({ isCollapsed }) => {
    const theme = useTheme();
    const colors = tokens(theme.palette.mode);

    const {
        teamMembers, isLoading, userRole, openAddEditModal, openConfirmDeleteModal, userToDelete,
        isEditMode, currentUserData, snackbar, anchorEl, selectedUserForActions, order, orderBy,
        handleOpenAddModal, handleOpenEditModal, handleCloseModal, handleChange, handleSubmit,
        handleOpenConfirmDeleteModal, handleCloseConfirmDeleteModal, handleDeleteUser,
        handleUnlockUser, handleMenuOpen, handleMenuClose, handleRequestSort, handleSnackbarClose
    } = useTeamManagement();

    const styles = {
        container: { display: "flex", minHeight: "100vh", bgcolor: colors.grey[800], marginLeft: { sm: isCollapsed ? "80px" : "270px" }, transition: "margin 0.3s ease", width: { sm: `calc(100% - ${isCollapsed ? "80px" : "270px"})` }, overflowX: 'hidden' },
        content: { flex: 1, p: { xs: 1.5, md: 3 }, overflowY: 'auto' },
        tableContainer: { backgroundColor: colors.grey[900], borderRadius: 2, mt: 2, overflowX: "auto" },
        tableHead: { backgroundColor: colors.primary[700] },
        headCell: { color: colors.grey[100], fontWeight: "bold" },
        bodyCell: { color: colors.grey[100] },
        dialogTitle: { backgroundColor: colors.primary[700], color: colors.grey[100] },
        dialogContent: { backgroundColor: colors.white, marginTop: "20px" },
        dialogActions: { backgroundColor: colors.primary[700] }
    };

    return (
        <Box sx={styles.container}>
            <Box sx={styles.content}>
                {userRole === "Administrator" && (
                    <Button variant="contained" startIcon={<AddIcon />} sx={{ mb: 2, backgroundColor: colors.primary[700], "&:hover": { backgroundColor: colors.primary[400] } }} onClick={handleOpenAddModal}>
                        Add User
                    </Button>
                )}

                <Dialog open={openAddEditModal} onClose={handleCloseModal} fullWidth maxWidth="sm">
                    <DialogTitle sx={styles.dialogTitle}>{isEditMode ? "Edit User" : "Add New User"}</DialogTitle>
                    <DialogContent sx={styles.dialogContent}>
                        <TextField name="username" label="Username*" fullWidth margin="dense" value={currentUserData.username} onChange={handleChange} />
                        <TextField name="email" label="Email*" fullWidth margin="dense" value={currentUserData.email} onChange={handleChange} />
                        <TextField name="password" label={isEditMode ? "New Password" : "Password*"} type="password" fullWidth margin="dense" value={currentUserData.password} onChange={handleChange} />
                        <TextField select name="role" label="Role*" fullWidth margin="dense" value={currentUserData.role} onChange={handleChange}>
                            <MenuItem value="Administrator">Administrator</MenuItem>
                            <MenuItem value="Data Manager">Data Manager</MenuItem>
                            <MenuItem value="Regular">Regular</MenuItem>
                        </TextField>
                    </DialogContent>
                    <DialogActions sx={styles.dialogActions}>
                        <Button onClick={handleCloseModal} color="warning" variant="contained">Cancel</Button>
                        <Button onClick={handleSubmit} variant="contained" color="success">{isEditMode ? "Save Changes" : "Add User"}</Button>
                    </DialogActions>
                </Dialog>

                <Dialog open={openConfirmDeleteModal} onClose={handleCloseConfirmDeleteModal}>
                    <DialogTitle sx={styles.dialogTitle}>Confirm Deletion</DialogTitle>
                    <DialogContent sx={styles.dialogContent}>
                        <DialogContentText sx={{ color: colors.grey[200] }}>Are you sure you want to delete "{userToDelete?.username}"?</DialogContentText>
                    </DialogContent>
                    <DialogActions sx={styles.dialogActions}>
                        <Button onClick={handleCloseConfirmDeleteModal} color="warning" variant="contained">Cancel</Button>
                        <Button onClick={handleDeleteUser} color="error" variant="contained">Delete</Button>
                    </DialogActions>
                </Dialog>

                <TableContainer component={Paper} sx={styles.tableContainer}>
                    {isLoading && <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}><CircularProgress /></Box>}
                    {!isLoading && (
                        <Table sx={{ minWidth: 650 }}>
                            <TableHead sx={styles.tableHead}>
                                <TableRow>
                                    {headCells.map((headCell) => (headCell.id !== 'actions' || userRole === 'Administrator') && (
                                        <TableCell key={headCell.id} align="left" sortDirection={orderBy === headCell.id ? order : false} sx={styles.headCell}>
                                            {headCell.sortable ? (
                                                <TableSortLabel active={orderBy === headCell.id} direction={orderBy === headCell.id ? order : 'asc'} onClick={() => handleRequestSort(headCell.id)}>
                                                    {headCell.label}
                                                    {orderBy === headCell.id ? (<Box component="span" sx={visuallyHidden}>{order === 'desc' ? 'sorted descending' : 'sorted ascending'}</Box>) : null}
                                                </TableSortLabel>
                                            ) : headCell.label}
                                        </TableCell>
                                    ))}
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {teamMembers.map((user, index) => (
                                    <TableRow key={user.id}>
                                        <TableCell sx={styles.bodyCell}>{index + 1}</TableCell>
                                        <TableCell sx={styles.bodyCell}>{user.username}</TableCell>
                                        <TableCell sx={styles.bodyCell}>{user.email}</TableCell>
                                        <TableCell sx={{...styles.bodyCell, color: user.role === 'Administrator' ? colors.greenAccent[400] : colors.primary[300] }}>{user.role}</TableCell>
                                        <TableCell sx={{...styles.bodyCell, color: user.is_locked ? colors.redAccent[500] : colors.greenAccent[500] }}>{user.is_locked ? "Locked" : "Active"}</TableCell>
                                        {userRole === 'Administrator' && (
                                            <TableCell>
                                                <IconButton onClick={(e) => handleMenuOpen(e, user)}><MoreVert /></IconButton>
                                                <Menu anchorEl={anchorEl} open={Boolean(anchorEl) && selectedUserForActions?.id === user.id} onClose={handleMenuClose}>
                                                    <MenuItem onClick={() => { handleOpenEditModal(user); handleMenuClose(); }}>Edit</MenuItem>
                                                    <MenuItem onClick={() => { handleOpenConfirmDeleteModal(user); handleMenuClose(); }}>Delete</MenuItem>
                                                    {user.is_locked && (<MenuItem onClick={() => handleUnlockUser(user)}>Unlock User</MenuItem>)}
                                                </Menu>
                                            </TableCell>
                                        )}
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </TableContainer>

                <Snackbar open={snackbar.open} autoHideDuration={6000} onClose={handleSnackbarClose}>
                    <Alert onClose={handleSnackbarClose} severity={snackbar.severity} variant="filled">{snackbar.message}</Alert>
                </Snackbar>
            </Box>
        </Box>
    );
};

export default Team;