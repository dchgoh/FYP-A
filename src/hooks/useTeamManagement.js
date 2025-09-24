import { useState, useEffect, useCallback, useMemo } from 'react';
import { jwtDecode } from 'jwt-decode';
import axios from 'axios';

const API_BASE_URL = "http://localhost:5000/api";

export const useTeamManagement = () => {
    // --- State Management ---
    const [teamMembers, setTeamMembers] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [userRole, setUserRole] = useState("");
    const [openAddEditModal, setOpenAddEditModal] = useState(false);
    const [openConfirmDeleteModal, setOpenConfirmDeleteModal] = useState(false);
    const [userToDelete, setUserToDelete] = useState(null);
    const [isEditMode, setIsEditMode] = useState(false);
    const [currentUserData, setCurrentUserData] = useState({ id: null, username: "", email: "", password: "", role: "Data Manager" });
    const [snackbar, setSnackbar] = useState({ open: false, message: "", severity: "success" });
    const [anchorEl, setAnchorEl] = useState(null);
    const [selectedUserForActions, setSelectedUserForActions] = useState(null);
    const [order, setOrder] = useState("asc");
    const [orderBy, setOrderBy] = useState('username');

    // --- Utility Functions ---
    const showSnackbar = useCallback((message, severity = "success") => {
        setSnackbar({ open: true, message, severity });
    }, []);

    const handleSnackbarClose = (event, reason) => {
        if (reason === "clickaway") return;
        setSnackbar(prev => ({ ...prev, open: false }));
    };

    // --- Data Fetching ---
    const fetchUsers = useCallback(async () => {
        setIsLoading(true);
        const token = localStorage.getItem('authToken');
        if (!token) {
            showSnackbar("Not authenticated. Please log in.", "error");
            setIsLoading(false);
            return;
        }
        try {
            const response = await axios.get(`${API_BASE_URL}/users`, { headers: { 'Authorization': `Bearer ${token}` } });
            setTeamMembers(Array.isArray(response.data) ? response.data : []);
        } catch (error) {
            console.error("Error fetching users:", error);
            showSnackbar(error.response?.data?.message || "Failed to fetch users.", "error");
        } finally {
            setIsLoading(false);
        }
    }, [showSnackbar]);

    useEffect(() => {
        const token = localStorage.getItem('authToken');
        if (token) {
            try {
                const decoded = jwtDecode(token);
                setUserRole(decoded.role);
            } catch (e) { console.error("Invalid token"); }
        }
        fetchUsers();
    }, [fetchUsers]);

    // --- Handlers for Modals and Actions ---
    const handleOpenAddModal = () => {
        setIsEditMode(false);
        setCurrentUserData({ id: null, username: "", email: "", password: "", role: "Data Manager" });
        setOpenAddEditModal(true);
    };

    const handleOpenEditModal = (user) => {
        setIsEditMode(true);
        setCurrentUserData({ id: user.id, username: user.username, email: user.email, password: "", role: user.role });
        setOpenAddEditModal(true);
    };

    const handleCloseModal = () => setOpenAddEditModal(false);

    const handleChange = (e) => setCurrentUserData({ ...currentUserData, [e.target.name]: e.target.value });

    const handleSubmit = async () => {
        const token = localStorage.getItem('authToken');
        if (!token) { showSnackbar("Authentication token not found.", "error"); return; }

        const url = isEditMode ? `${API_BASE_URL}/users/${currentUserData.id}` : `${API_BASE_URL}/users`;
        const method = isEditMode ? "PUT" : "POST";
        const dataToSend = { ...currentUserData };
        if (isEditMode && !dataToSend.password) delete dataToSend.password;
        if (!isEditMode) delete dataToSend.id;

        try {
            const response = await axios({ method, url, headers: { 'Authorization': `Bearer ${token}` }, data: dataToSend });
            showSnackbar(response.data.message || `User ${isEditMode ? "updated" : "added"} successfully`, "success");
            handleCloseModal();
            fetchUsers();
        } catch (error) {
            showSnackbar(error.response?.data?.message || `Failed to ${isEditMode ? "update" : "add"} user`, "error");
        }
    };

    const handleOpenConfirmDeleteModal = (user) => { setUserToDelete(user); setOpenConfirmDeleteModal(true); };
    const handleCloseConfirmDeleteModal = () => { setOpenConfirmDeleteModal(false); setUserToDelete(null); };

    const handleDeleteUser = async () => {
        if (!userToDelete) return;
        const token = localStorage.getItem('authToken');
        if (!token) { showSnackbar("Authentication token not found.", "error"); handleCloseConfirmDeleteModal(); return; }
        
        try {
            await axios.delete(`${API_BASE_URL}/users/${userToDelete.id}`, { headers: { 'Authorization': `Bearer ${token}` } });
            showSnackbar(`User '${userToDelete.username}' deleted.`, "success");
            handleCloseConfirmDeleteModal();
            fetchUsers();
        } catch (error) {
            showSnackbar(error.response?.data?.message || "Failed to delete user.", "error");
        }
    };
    
    const handleUnlockUser = async (user) => {
        const token = localStorage.getItem('authToken');
        if (!token) { showSnackbar("Authentication token not found.", "error"); return; }
        try {
            await axios.put(`${API_BASE_URL}/users/${user.id}/unlock`, {}, { headers: { 'Authorization': `Bearer ${token}` } });
            showSnackbar(`User '${user.username}' unlocked.`, "success");
            fetchUsers();
        } catch (error) {
            showSnackbar(error.response?.data?.message || "Failed to unlock user.", "error");
        } finally {
            handleMenuClose();
        }
    };

    const handleMenuOpen = (event, user) => { setAnchorEl(event.currentTarget); setSelectedUserForActions(user); };
    const handleMenuClose = () => { setAnchorEl(null); setSelectedUserForActions(null); };

    // --- Sorting Logic ---
    const handleRequestSort = (property) => {
        const isAsc = orderBy === property && order === "asc";
        setOrder(isAsc ? "desc" : "asc");
        setOrderBy(property);
    };

    const sortedTeamMembers = useMemo(() => {
        if (!orderBy) return teamMembers;
        // Simple comparator, can be expanded
        const comparator = (a, b) => {
            if (b[orderBy] < a[orderBy]) return -1;
            if (b[orderBy] > a[orderBy]) return 1;
            return 0;
        };
        const stabilized = teamMembers.map((el, index) => [el, index]);
        stabilized.sort((a, b) => {
            const orderVal = comparator(a[0], b[0]);
            if (orderVal !== 0) return order === 'asc' ? orderVal : -orderVal;
            return a[1] - b[1];
        });
        return stabilized.map(el => el[0]);
    }, [teamMembers, order, orderBy]);

    return {
        // State
        teamMembers: sortedTeamMembers,
        isLoading,
        userRole,
        openAddEditModal,
        openConfirmDeleteModal,
        userToDelete,
        isEditMode,
        currentUserData,
        snackbar,
        anchorEl,
        selectedUserForActions,
        order,
        orderBy,

        // Handlers
        handleOpenAddModal,
        handleOpenEditModal,
        handleCloseModal,
        handleChange,
        handleSubmit,
        handleOpenConfirmDeleteModal,
        handleCloseConfirmDeleteModal,
        handleDeleteUser,
        handleUnlockUser,
        handleMenuOpen,
        handleMenuClose,
        handleRequestSort,
        handleSnackbarClose,
    };
};