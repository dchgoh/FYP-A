import { useState, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';

// --- Imports for the Dashboard Component ---
import React from 'react';
import { Box, useTheme } from "@mui/material";
import { Chart as ChartJS, ArcElement, Tooltip, Legend, LineElement, LinearScale, PointElement, CategoryScale, BarElement } from "chart.js";
import ChartDataLabels from "chartjs-plugin-datalabels";

import { tokens } from "../../theme";

// --- Presentational Component Imports ---
import DashboardFilters from './DashboardFilters';
import StatCard from './StatCard';
import HistogramChart from './HistogramChart';
import RecentUploadsTimeline from './RecentUploadsTimeline';


const API_BASE_URL = "/api";

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
    const [filterDateRange, setFilterDateRange] = useState('all'); // NEW: Date filter state

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
        // MODIFIED: Include date filter in the check
        return filterDivisionId === 'all' && filterProjectId === 'all' && filterPlotName === 'all' && filterDateRange === 'all';
    }, [filterDivisionId, filterProjectId, filterPlotName, filterDateRange]);

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

        // NEW: Add date range parameters to API calls
        if (filterDateRange !== 'all') {
            const endDate = new Date();
            const startDate = new Date();
            switch (filterDateRange) {
                case '7d': startDate.setDate(endDate.getDate() - 7); break;
                case '30d': startDate.setMonth(endDate.getMonth() - 1); break;
                case '6m': startDate.setMonth(endDate.getMonth() - 6); break;
                case '1y': startDate.setFullYear(endDate.getFullYear() - 1); break;
                default: break;
            }
            // Format to YYYY-MM-DD for backend compatibility
            baseParams.startDate = startDate.toISOString().split('T')[0];
            baseParams.endDate = endDate.toISOString().split('T')[0];
        }


        const headers = { 'Authorization': `Bearer ${token}` };

        const fetchAndSet = async (url, params, setLoading, setData, dataKey, errorVal) => {
            setLoading(true);
            setData(null);
            try {
                const res = await axios.get(url, { headers, params });
                const responseData = dataKey ? res.data[dataKey] : res.data;
                setData(responseData);
            } catch (error) {
                console.error(`Failed to fetch data from ${url}:`, error.response?.data?.message || error.message);
                setData(errorVal);
            } finally {
                setLoading(false);
            }
        };

        fetchAndSet(`${API_BASE_URL}/files/count`, baseParams, setIsFetchingFileCount, setFilesUploadedCount, 'count', 'Error');
        fetchAndSet(`${API_BASE_URL}/files/count/trees`, baseParams, setIsFetchingTreeCount, setTotalTreesCount, 'count', 'Error');
        fetchAndSet(`${API_BASE_URL}/files/stats/sum-carbon-tonnes`, baseParams, setIsFetchingSumCarbon, setTotalSumCarbonTonnes, 'sum_carbon_tonnes', 'Error');
        fetchAndSet(`${API_BASE_URL}/files/recent`, { ...baseParams, limit: 5 }, setLoadingTimeline, setRecentUploads, 'data', []); 
        fetchAndSet(`${API_BASE_URL}/files/all-tree-heights-adjusted`, baseParams, setLoadingHeightsChart, setAllTreeHeightsData, 'heights', []);
        fetchAndSet(`${API_BASE_URL}/files/statistics/all-tree-dbhs-cm`, baseParams, setLoadingDbhsChart, setAllTreeDbhsData, 'dbhs_cm', []);
        fetchAndSet(`${API_BASE_URL}/files/statistics/all-tree-volumes-m3-data`, baseParams, setLoadingVolumesChart, setAllTreeVolumesData, 'volumes_m3', []);
    }, [filterDivisionId, filterProjectId, filterPlotName, canFetchPlots, filterDateRange]); // MODIFIED: Add date filter dependency


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
    }, [filterDivisionId, filterProjectId, filterPlotName, filterDateRange, loadingFilters, fetchData]); // MODIFIED: Add date filter dependency

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
    
    // NEW: Handler for the date filter
    const handleDateFilterChange = (event) => {
        setFilterDateRange(event.target.value);
    };

    const handleResetFilters = () => {
        setFilterDivisionId('all');
        setFilterProjectId('all');
        setFilterPlotName('all');
        setFilterDateRange('all'); // MODIFIED: Reset date filter
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
        filterDateRange, // NEW: Expose date filter state
        // Filter Derived State
        canFetchPlots,
        areFiltersDefault,
        // Filter Handlers
        handleDivisionFilterChange,
        handleProjectFilterChange,
        handlePlotFilterChange,
        handleDateFilterChange, // NEW: Expose date filter handler
        handleResetFilters,
    };
};


// =================================================================================
// The Dashboard component itself remains unchanged, as all logic is handled by the hook.
// =================================================================================
ChartJS.register(ArcElement, Tooltip, Legend, LineElement, LinearScale, PointElement, CategoryScale, BarElement, ChartDataLabels);

const Dashboard = ({ isCollapsed }) => {
    const theme = useTheme();
    const colors = tokens(theme.palette.mode);

    const dashboardData = useDashboardData();

    // --- Chart Data Transformation & Options ---
    const treeHeightHistogramData = useMemo(() => {
        const currentData = Array.isArray(dashboardData.allTreeHeightsData) ? dashboardData.allTreeHeightsData : [];
        if (currentData.length === 0) return { labels: [], datasets: [] };
        
        const bins = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, Infinity];
        const labels = bins.slice(0, -1).map((bin, index) => 
            index === bins.length - 2 ? `≥${bins[index]}` : `${bin}-${bins[index + 1]}`
        );
        const counts = Array(labels.length).fill(0);

        currentData.forEach(height => {
            if (height === null || height === undefined || isNaN(height)) return;
            for (let i = 0; i < bins.length - 1; i++) {
                if (height >= bins[i] && (i === bins.length - 2 ? height >= bins[i] : height < bins[i + 1])) {
                    counts[i]++;
                    break;
                }
            }
        });
        return {
            labels,
            datasets: [{ label: "Tree Count by Adjusted Height", data: counts, backgroundColor: colors.greenAccent[500], borderColor: colors.greenAccent[700], borderWidth: 1 }],
        };
    }, [dashboardData.allTreeHeightsData, colors]);

    const treeHeightHistogramOptions = useMemo(() => {
        const dataValues = treeHeightHistogramData.datasets[0]?.data || [0];
        const maxValue = Math.max(...dataValues);
        const suggestedMax = maxValue > 0 ? Math.ceil(maxValue * 1.2) : 10;

        return {
            maintainAspectRatio: false, responsive: true,
            plugins: {
                legend: { display: true, position: "bottom", labels: { color: colors.grey[100] } },
                title: { display: true, text: 'Tree Height Distribution (Adjusted)', color: colors.grey[100], font: { size: 16 }, padding: { bottom: 30 } },
                datalabels: { display: true, color: colors.grey[100], anchor: 'end', align: 'top', formatter: (value) => value > 0 ? value : '' },
            },
            scales: {
                x: { title: { display: true, text: 'Height Range (m)', color: colors.grey[300] }, ticks: { color: colors.grey[100] }, grid: { color: colors.grey[800] } },
                y: { 
                    title: { display: true, text: 'Number of Trees', color: colors.grey[300] }, 
                    ticks: { color: colors.grey[100] }, 
                    grid: { color: colors.grey[800] }, 
                    beginAtZero: true,
                    max: suggestedMax 
                },
            },
        };
    }, [colors, treeHeightHistogramData]);

    const treeDbhHistogramData = useMemo(() => {
        const currentData = Array.isArray(dashboardData.allTreeDbhsData) ? dashboardData.allTreeDbhsData : [];
        if (currentData.length === 0) return { labels: [], datasets: [] };

        const bins = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, Infinity];
        const labels = bins.slice(0, -1).map((bin, index) => 
            index === bins.length - 2 ? `≥${bins[index]}` : `${bin}-${bins[index + 1]}`
        );
        const counts = Array(labels.length).fill(0);

        currentData.forEach(dbh => {
             if (dbh === null || dbh === undefined || isNaN(dbh)) return;
            for (let i = 0; i < bins.length - 1; i++) {
                if (dbh >= bins[i] && (i === bins.length - 2 ? dbh >= bins[i] : dbh < bins[i + 1])) {
                    counts[i]++;
                    break;
                }
            }
        });
        return {
            labels,
            datasets: [{ label: "Tree Count by DBH", data: counts, backgroundColor: colors.blueAccent[500], borderColor: colors.blueAccent[700], borderWidth: 1 }],
        };
    }, [dashboardData.allTreeDbhsData, colors]);

    const treeDbhHistogramOptions = useMemo(() => {
        const dataValues = treeDbhHistogramData.datasets[0]?.data || [0];
        const maxValue = Math.max(...dataValues);
        const suggestedMax = maxValue > 0 ? Math.ceil(maxValue * 1.2) : 10;

        return {
            maintainAspectRatio: false, responsive: true,
            plugins: {
                legend: { display: true, position: "bottom", labels: { color: colors.grey[100] } },
                title: { display: true, text: 'Tree Diameter (DBH) Distribution', color: colors.grey[100], font: { size: 16 }, padding: { bottom: 30 } },
                datalabels: { display: true, color: colors.grey[100], anchor: 'end', align: 'top', formatter: (value) => value > 0 ? value : '' },
            },
            scales: {
                x: { title: { display: true, text: 'DBH Range (cm)', color: colors.grey[300] }, ticks: { color: colors.grey[100] }, grid: { color: colors.grey[800] } },
                y: { 
                    title: { display: true, text: 'Number of Trees', color: colors.grey[300] }, 
                    ticks: { color: colors.grey[100] },
                    grid: { color: colors.grey[800] }, 
                    beginAtZero: true,
                    max: suggestedMax
                },
            },
        };
    }, [colors, treeDbhHistogramData]);

    const treeVolumeHistogramData = useMemo(() => {
        const currentData = Array.isArray(dashboardData.allTreeVolumesData) ? dashboardData.allTreeVolumesData : [];
        if (currentData.length === 0) return { labels: [], datasets: [] };

        const bins = [0, 0.25, 0.5, 0.75, 1, 1.5, 2, 2.5, 3, 5, Infinity];
        const labels = bins.slice(0, -1).map((bin, index) => index === bins.length - 2 ? `≥${bins[index]}` : `${bin}-${bins[index + 1]}`);
        const counts = Array(labels.length).fill(0);

        currentData.forEach(volume => {
            if (volume === null || volume === undefined || isNaN(volume)) return;
            for (let i = 0; i < bins.length - 1; i++) {
                if (volume >= bins[i] && (i === bins.length - 2 ? volume >= bins[i] : volume < bins[i + 1])) {
                    counts[i]++;
                    break;
                }
            }
        });
        return {
            labels,
            datasets: [{ label: "Tree Count by Volume", data: counts, backgroundColor: colors.redAccent[500], borderColor: colors.redAccent[700], borderWidth: 1 }],
        };
    }, [dashboardData.allTreeVolumesData, colors]);

    const treeVolumeHistogramOptions = useMemo(() => {
        const dataValues = treeVolumeHistogramData.datasets[0]?.data || [0];
        const maxValue = Math.max(...dataValues);
        const suggestedMax = maxValue > 0 ? Math.ceil(maxValue * 1.2) : 10;

        return {
            maintainAspectRatio: false, responsive: true,
            plugins: {
                legend: { display: true, position: "bottom", labels: { color: colors.grey[100] } },
                title: { display: true, text: 'Tree Volume Distribution (m³)', color: colors.grey[100], font: { size: 16 }, padding: { bottom: 30 } },
                datalabels: { display: true, color: colors.grey[100], anchor: 'end', align: 'top', formatter: (value) => value > 0 ? value : '' },
            },
            scales: {
                x: { title: { display: true, text: 'Volume Range (m³)', color: colors.grey[300] }, ticks: { color: colors.grey[100] }, grid: { color: colors.grey[800] } },
                y: { 
                    title: { display: true, text: 'Number of Trees', color: colors.grey[300] }, 
                    ticks: { color: colors.grey[100] },
                    grid: { color: colors.grey[800] }, 
                    beginAtZero: true,
                    max: suggestedMax
                },
            },
        };
    }, [colors, treeVolumeHistogramData]);

    // --- Main Component Styles ---
    const styles = {
        container: { display: "flex", minHeight: "100vh", bgcolor: colors.grey[800], marginLeft: isCollapsed ? "80px" : "270px", transition: "margin 0.3s ease" },
        content: { flex: 1, p: { xs: 1, sm: 2, md: 3 }, overflowY: 'auto' },
        statsGrid: { display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)", md: "repeat(4, 1fr)" }, gap: '16px', mt: 3 },
        chartsGridRow2: { display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, gap: '16px', mt: 3 },
        chartsGridRow3: { display: "grid", gridTemplateColumns: { xs: "1fr", lg: "3fr 2fr" }, gap: '16px', mt: 3 },
    };

    const isDataLoading = dashboardData.loadingFilters || dashboardData.isFetchingFileCount || dashboardData.isFetchingTreeCount || dashboardData.loadingPlots || dashboardData.loadingHeightsChart || dashboardData.loadingDbhsChart || dashboardData.loadingVolumesChart || dashboardData.isFetchingSumCarbon;

    return (
        <Box sx={styles.container}>
            <Box sx={styles.content}>
                
                <DashboardFilters
                    colors={colors}
                    isDataLoading={isDataLoading}
                    {...dashboardData}
                />
                
                <Box sx={styles.statsGrid}>
                    <StatCard title="Total Members" value={dashboardData.totalMembers} icon="group" isLoading={dashboardData.totalMembers === null} colors={colors} />
                    <StatCard title="Files Uploaded" value={dashboardData.filesUploadedCount} icon="upload_file" isLoading={dashboardData.isFetchingFileCount} colors={colors} />
                    <StatCard title="Total Trees" value={dashboardData.totalTreesCount} icon="forest" isLoading={dashboardData.isFetchingTreeCount} colors={colors} />
                    <StatCard
                        title="Total Carbon (t)"
                        value={dashboardData.totalSumCarbonTonnes !== null ? `${parseFloat(dashboardData.totalSumCarbonTonnes).toFixed(2)}` : null}
                        icon="eco"
                        isLoading={dashboardData.isFetchingSumCarbon}
                        colors={colors}
                    />
                </Box>

                <Box sx={styles.chartsGridRow2}>
                    <HistogramChart
                        isLoading={dashboardData.loadingVolumesChart}
                        data={treeVolumeHistogramData}
                        options={treeVolumeHistogramOptions}
                        noDataMessage="No tree volume data for current selection."
                        loadingFilters={dashboardData.loadingFilters}
                    />
                    <HistogramChart
                        isLoading={dashboardData.loadingHeightsChart}
                        data={treeHeightHistogramData}
                        options={treeHeightHistogramOptions}
                        noDataMessage="No tree height data for current selection."
                        loadingFilters={dashboardData.loadingFilters}
                    />
                </Box>

                <Box sx={styles.chartsGridRow3}>
                    <HistogramChart
                        isLoading={dashboardData.loadingDbhsChart}
                        data={treeDbhHistogramData}
                        options={treeDbhHistogramOptions}
                        noDataMessage="No tree diameter data for current selection."
                        loadingFilters={dashboardData.loadingFilters}
                    />
                    <RecentUploadsTimeline
                        isLoading={dashboardData.loadingTimeline}
                        uploads={dashboardData.recentUploads}
                        colors={colors}
                        loadingFilters={dashboardData.loadingFilters}
                        filterDivisionId={dashboardData.filterDivisionId}
                        filterProjectId={dashboardData.filterProjectId}
                        filterPlotName={dashboardData.filterPlotName}
                        canFetchPlots={dashboardData.canFetchPlots}
                    />
                </Box>

            </Box>
        </Box>
    );
};

export default Dashboard;