import { useState, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';

const API_BASE_URL = "/api";

export const useMapData = () => {
    // --- State Management ---
    const [mapFiles, setMapFiles] = useState([]);
    const [projects, setProjects] = useState([]);
    const [divisions, setDivisions] = useState([]);
    const [plotsList, setPlotsList] = useState([]);

    const [selectedProjectId, setSelectedProjectId] = useState('all');
    const [selectedDivisionId, setSelectedDivisionId] = useState('all');
    const [filterPlotName, setFilterPlotName] = useState('all');

    const [isLoadingFiles, setIsLoadingFiles] = useState(true);
    const [isLoadingFilters, setIsLoadingFilters] = useState(true);
    const [loadingPlots, setLoadingPlots] = useState(false);

    const [error, setError] = useState(null);

    // --- Memoized Derived State ---
    const canFetchPlots = useMemo(() => {
        return selectedDivisionId !== 'all' && selectedProjectId !== 'all' && selectedProjectId !== 'unassigned';
    }, [selectedDivisionId, selectedProjectId]);

    const filteredProjectsForDropdown = useMemo(() => {
        if (selectedDivisionId === 'all') return projects;
        const numericId = parseInt(selectedDivisionId, 10);
        if (isNaN(numericId)) return [];
        return projects.filter(p => p.division_id === numericId);
    }, [selectedDivisionId, projects]);

    // --- Data Fetching Logic ---
    const fetchDropdownData = useCallback(async (token) => {
        setIsLoadingFilters(true);
        setError(null);
        try {
            const [divisionsRes, projectsRes] = await Promise.all([
                axios.get(`${API_BASE_URL}/divisions`, { headers: { 'Authorization': `Bearer ${token}` } }),
                axios.get(`${API_BASE_URL}/projects`, { headers: { 'Authorization': `Bearer ${token}` } })
            ]);
            setDivisions(Array.isArray(divisionsRes.data) ? divisionsRes.data : []);
            setProjects(Array.isArray(projectsRes.data) ? projectsRes.data : []);
        } catch (err) {
            console.error("Failed to fetch filter dropdown data:", err);
            setError("Failed to load filter options. Please try refreshing.");
        } finally {
            setIsLoadingFilters(false);
        }
    }, []);
    
    const fetchPlotsList = useCallback(async (divisionId, projectId) => {
        const token = localStorage.getItem('authToken');
        if (!token || !canFetchPlots) {
            setPlotsList([]);
            return;
        }
        setLoadingPlots(true);
        try {
            const params = { divisionId, projectId };
            const response = await axios.get(`${API_BASE_URL}/files/plots`, { headers: { 'Authorization': `Bearer ${token}` }, params });
            setPlotsList(Array.isArray(response.data?.plots) ? response.data.plots : []);
        } catch (error) {
            console.error("Failed to fetch plot names:", error);
            setPlotsList([]);
        } finally {
            setLoadingPlots(false);
        }
    }, [canFetchPlots]);

    const fetchMapFiles = useCallback(async () => {
        const token = localStorage.getItem('authToken');
        if (!token) {
            setError("Authentication required."); setIsLoadingFiles(false); return;
        }
        setIsLoadingFiles(true);
        setError(null);
        try {
            const params = {};
            if (selectedProjectId !== 'all') params.projectId = selectedProjectId;
            if (selectedDivisionId !== 'all') params.divisionId = selectedDivisionId;
            if (filterPlotName !== 'all' && canFetchPlots) params.plotName = filterPlotName;

            const response = await axios.get(`${API_BASE_URL}/files`, { headers: { 'Authorization': `Bearer ${token}` }, params });
            setMapFiles(Array.isArray(response.data) ? response.data : []);
        } catch (err) {
            console.error("Failed to fetch map files:", err);
            setError("Could not load map data. Please try adjusting filters or refreshing.");
            setMapFiles([]);
        } finally {
            setIsLoadingFiles(false);
        }
    }, [selectedProjectId, selectedDivisionId, filterPlotName, canFetchPlots]);

    // --- Effects to orchestrate fetching ---
    useEffect(() => {
        const token = localStorage.getItem('authToken');
        if (token) {
            fetchDropdownData(token);
        } else {
            setError("Authentication required. Please log in.");
            setIsLoadingFilters(false);
        }
    }, [fetchDropdownData]);

    useEffect(() => {
        if (!isLoadingFilters) {
            fetchMapFiles();
        }
    }, [isLoadingFilters, fetchMapFiles]);

    useEffect(() => {
        if (canFetchPlots && !isLoadingFilters) {
            fetchPlotsList(selectedDivisionId, selectedProjectId);
        } else {
            setPlotsList([]);
            if (filterPlotName !== 'all') setFilterPlotName('all');
        }
    }, [selectedDivisionId, selectedProjectId, canFetchPlots, isLoadingFilters, fetchPlotsList, filterPlotName]);

    // --- Filter Handlers ---
    const handleDivisionChange = (event) => {
        setSelectedDivisionId(event.target.value);
        setSelectedProjectId('all');
        setFilterPlotName('all');
    };
    const handleProjectChange = (event) => {
        setSelectedProjectId(event.target.value);
        setFilterPlotName('all');
    };
    const handlePlotFilterChange = (event) => {
        setFilterPlotName(event.target.value);
    };

    // --- Return all state and functions needed by the UI ---
    return {
        mapFiles, projects, divisions, plotsList,
        filteredProjectsForDropdown,
        isLoadingFiles, isLoadingFilters, loadingPlots, error,
        selectedProjectId, selectedDivisionId, filterPlotName,
        handleDivisionChange, handleProjectChange, handlePlotFilterChange,
        canFetchPlots,
    };
};