import { useState, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';

const API_BASE_URL = "http://localhost:5000/api";

export const useDashboardData = () => {
    // --- State Variables ---
    const [totalMembers, setTotalMembers] = useState(null);
    const [filesUploadedCount, setFilesUploadedCount] = useState(null);
    const [isFetchingFileCount, setIsFetchingFileCount] = useState(false);
    const [totalTreesCount, setTotalTreesCount] = useState(null);
    const [isFetchingTreeCount, setIsFetchingTreeCount] = useState(false);

    const [divisionsList, setDivisionsList] = useState([]);
    const [projectsList, setProjectsList] = useState([]);
    const [plotsList, setPlotsList] = useState([]);
    const [loadingFilters, setLoadingFilters] = useState(true);
    const [loadingPlots, setLoadingPlots] = useState(false);

    const [filterDivisionId, setFilterDivisionId] = useState('all');
    const [filterProjectId, setFilterProjectId] = useState('all');
    const [filterPlotName, setFilterPlotName] = useState('all');

    const [recentUploads, setRecentUploads] = useState([]);
    const [loadingTimeline, setLoadingTimeline] = useState(true);

    const [allTreeHeightsData, setAllTreeHeightsData] = useState([]);
    const [loadingHeightsChart, setLoadingHeightsChart] = useState(false);

    const [allTreeDbhsData, setAllTreeDbhsData] = useState([]);
    const [loadingDbhsChart, setLoadingDbhsChart] = useState(false);

    const [allTreeVolumesData, setAllTreeVolumesData] = useState([]);
    const [loadingVolumesChart, setLoadingVolumesChart] = useState(false);

    const [totalSumCarbonTonnes, setTotalSumCarbonTonnes] = useState(null);
    const [isFetchingSumCarbon, setIsFetchingSumCarbon] = useState(false);

    // --- Memoized Derived State ---
    const canFetchPlots = useMemo(() => {
        return filterDivisionId !== 'all' && filterProjectId !== 'all' && filterProjectId !== 'unassigned';
    }, [filterDivisionId, filterProjectId]);

    const areFiltersDefault = useMemo(() => {
        return filterDivisionId === 'all' && filterProjectId === 'all' && filterPlotName === 'all';
    }, [filterDivisionId, filterProjectId, filterPlotName]);

    // --- Data Fetching Callbacks ---
    const fetchFilterData = useCallback(async () => {
        const token = localStorage.getItem('authToken');
        if (!token) {
            setDivisionsList([]); setProjectsList([]); setLoadingFilters(false); return;
        }
        setLoadingFilters(true);
        try {
            const [divisionsRes, projectsRes] = await Promise.all([
                axios.get(`${API_BASE_URL}/divisions`, { headers: { 'Authorization': `Bearer ${token}` } }),
                axios.get(`${API_BASE_URL}/projects`, { headers: { 'Authorization': `Bearer ${token}` } })
            ]);
            setDivisionsList(Array.isArray(divisionsRes.data) ? divisionsRes.data : []);
            setProjectsList(Array.isArray(projectsRes.data) ? projectsRes.data : []);
        } catch (error) {
            console.error("Failed to fetch filter data:", error.response?.data?.message || error.message);
            setDivisionsList([]); setProjectsList([]);
        } finally {
            setLoadingFilters(false);
        }
    }, []);

    const fetchPlotsList = useCallback(async (divisionId, projectId) => {
        const token = localStorage.getItem('authToken');
        if (!token) { setPlotsList([]); return; }
        setLoadingPlots(true);
        setPlotsList([]);
        try {
            const params = { divisionId, projectId };
            const response = await axios.get(`${API_BASE_URL}/files/plots`, { headers: { 'Authorization': `Bearer ${token}` }, params });
            const plotsData = response.data?.plots;
            setPlotsList(Array.isArray(plotsData) ? plotsData : []);
        } catch (error) {
            console.error("Failed to fetch plot names:", error.response?.data?.message || error.message);
            setPlotsList([]);
        } finally {
            setLoadingPlots(false);
        }
    }, []);
    
    const fetchData = useCallback(async () => {
        const token = localStorage.getItem('authToken');
        if (!token) return;

        const baseParams = {};
        if (filterDivisionId !== 'all') baseParams.divisionId = filterDivisionId;
        if (filterProjectId !== 'all' && filterProjectId !== 'unassigned') baseParams.projectId = filterProjectId;
        else if (filterProjectId === 'unassigned') baseParams.projectId = 'unassigned';
        if (filterPlotName !== 'all' && canFetchPlots) baseParams.plotName = filterPlotName;

        const headers = { 'Authorization': `Bearer ${token}` };

        // Helper to run fetch and set state
        const fetchAndSet = async (url, params, setLoading, setData, dataKey, errorVal) => {
            setLoading(true);
            setData(null); // Setting to null is fine, but you could also keep the old data
            try {
                const res = await axios.get(url, { headers, params });
                // If a dataKey is provided, use it. Otherwise, use the entire res.data.
                const responseData = dataKey ? res.data[dataKey] : res.data;
                setData(responseData);
            } catch (error) {
                console.error(`Failed to fetch data from ${url}:`, error.response?.data?.message || error.message);
                setData(errorVal);
            } finally {
                setLoading(false);
            }
        };

        // Fetch all data points based on current filters
        fetchAndSet(`${API_BASE_URL}/files/count`, baseParams, setIsFetchingFileCount, setFilesUploadedCount, 'count', 'Error');
        fetchAndSet(`${API_BASE_URL}/files/count/trees`, baseParams, setIsFetchingTreeCount, setTotalTreesCount, 'count', 'Error');
        fetchAndSet(`${API_BASE_URL}/files/stats/sum-carbon-tonnes`, baseParams, setIsFetchingSumCarbon, setTotalSumCarbonTonnes, 'sum_carbon_tonnes', 'Error');
        fetchAndSet(`${API_BASE_URL}/files/recent`, { ...baseParams, limit: 5 }, setLoadingTimeline, setRecentUploads, 'data', []); 
        fetchAndSet(`${API_BASE_URL}/files/all-tree-heights-adjusted`, baseParams, setLoadingHeightsChart, setAllTreeHeightsData, 'heights', []);
        fetchAndSet(`${API_BASE_URL}/files/statistics/all-tree-dbhs-cm`, baseParams, setLoadingDbhsChart, setAllTreeDbhsData, 'dbhs_cm', []);
        fetchAndSet(`${API_BASE_URL}/files/statistics/all-tree-volumes-m3-data`, baseParams, setLoadingVolumesChart, setAllTreeVolumesData, 'volumes_m3', []);
    }, [filterDivisionId, filterProjectId, filterPlotName, canFetchPlots]);


    // --- Effects ---
    useEffect(() => {
        const fetchUserCount = async () => {
            const token = localStorage.getItem('authToken');
            if (!token) { setTotalMembers('Error'); return; }
            try {
                const response = await axios.get(`${API_BASE_URL}/users/count`, { headers: { 'Authorization': `Bearer ${token}` } });
                setTotalMembers(response.data.count);
            } catch (error) {
                console.error("Failed to fetch user count:", error.response?.data?.message || error.message);
                setTotalMembers('Error');
            }
        };
        fetchUserCount();
        fetchFilterData();
    }, [fetchFilterData]);

    useEffect(() => {
        if (canFetchPlots && !loadingFilters) {
            fetchPlotsList(filterDivisionId, filterProjectId);
        } else if (!canFetchPlots) {
            setPlotsList([]);
            if (filterPlotName !== 'all') setFilterPlotName('all');
        }
    }, [filterDivisionId, filterProjectId, loadingFilters, canFetchPlots, fetchPlotsList, filterPlotName]);

    useEffect(() => {
        if (!loadingFilters) {
            fetchData();
        }
    }, [filterDivisionId, filterProjectId, filterPlotName, loadingFilters, fetchData]);

    // --- Filter Handlers ---
    const handleDivisionFilterChange = (event) => {
        setFilterDivisionId(event.target.value);
        setFilterProjectId('all');
        setFilterPlotName('all');
    };

    const handleProjectFilterChange = (event) => {
        setFilterProjectId(event.target.value);
        setFilterPlotName('all');
    };

    const handlePlotFilterChange = (event) => {
        setFilterPlotName(event.target.value);
    };

    const handleResetFilters = () => {
        setFilterDivisionId('all');
        setFilterProjectId('all');
        setFilterPlotName('all');
    };

    const filteredProjectsForDropdown = useMemo(() => {
        if (filterDivisionId === 'all') return projectsList;
        return projectsList.filter(p => p.division_id === parseInt(filterDivisionId, 10));
    }, [projectsList, filterDivisionId]);

    // --- Return Value ---
    return {
        // Data
        totalMembers,
        filesUploadedCount,
        totalTreesCount,
        totalSumCarbonTonnes,
        recentUploads,
        allTreeHeightsData,
        allTreeDbhsData,
        allTreeVolumesData,
        divisionsList,
        plotsList,
        filteredProjectsForDropdown,
        // Loading States
        isFetchingFileCount,
        isFetchingTreeCount,
        isFetchingSumCarbon,
        loadingFilters,
        loadingPlots,
        loadingTimeline,
        loadingHeightsChart,
        loadingDbhsChart,
        loadingVolumesChart,
        // Filter State
        filterDivisionId,
        filterProjectId,
        filterPlotName,
        // Filter Derived State
        canFetchPlots,
        areFiltersDefault,
        // Filter Handlers
        handleDivisionFilterChange,
        handleProjectFilterChange,
        handlePlotFilterChange,
        handleResetFilters,
    };
};