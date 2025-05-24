import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Box, Card, CardContent, Typography, useTheme, Grid,
  FormControl, InputLabel, Select, MenuItem, CircularProgress, Button, Tooltip as MuiTooltip
} from "@mui/material";
import { alpha } from '@mui/material/styles';
import { Bar } from "react-chartjs-2";
import { Chart as ChartJS, ArcElement, Tooltip, Legend, LineElement, LinearScale, PointElement, CategoryScale, BarElement } from "chart.js";
import ChartDataLabels from "chartjs-plugin-datalabels";
import { Timeline, TimelineItem, TimelineSeparator, TimelineConnector, TimelineContent, TimelineDot } from "@mui/lab";
import ReplayIcon from '@mui/icons-material/Replay';
// import EcoIcon from '@mui/icons-material/Eco'; // Example if you prefer a specific MUI icon
import { tokens } from "../../theme";
import axios from 'axios';

const API_BASE_URL = "http://localhost:5000/api";

ChartJS.register(ArcElement, Tooltip, Legend, LineElement, LinearScale, PointElement, CategoryScale, BarElement, ChartDataLabels);

const Dashboard = ({ isCollapsed }) => {
  const theme = useTheme();
  const colors = tokens(theme.palette.mode);

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

  // State for Tree Volume Distribution Chart (if you keep it)
  const [allTreeVolumesData, setAllTreeVolumesData] = useState([]);
  const [loadingVolumesChart, setLoadingVolumesChart] = useState(false);

  // --- State for Total Carbon Estimation ---
  const [totalSumCarbonTonnes, setTotalSumCarbonTonnes] = useState(null);
  const [isFetchingSumCarbon, setIsFetchingSumCarbon] = useState(false);
  // --- End State for Carbon ---


  const canFetchPlots = useMemo(() => {
    return filterDivisionId !== 'all' && filterProjectId !== 'all' && filterProjectId !== 'unassigned';
  }, [filterDivisionId, filterProjectId]);

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
    if (!token) {
      setPlotsList([]); return;
    }
    setLoadingPlots(true);
    setPlotsList([]); // Reset plots list before fetching
    try {
      const params = { divisionId: divisionId, projectId: projectId };
      const response = await axios.get(`${API_BASE_URL}/files/plots`, {
        headers: { 'Authorization': `Bearer ${token}` },
        params: params
      });
      const plotsData = response.data && response.data.plots;
      setPlotsList(Array.isArray(plotsData) ? plotsData : []);
    } catch (error) {
      console.error("Failed to fetch plot names:", error.response?.data?.message || error.message);
      setPlotsList([]);
    } finally {
      setLoadingPlots(false);
    }
  }, []);

  const fetchFilesUploadedCount = useCallback(async (divisionId, projectId, plotName) => {
    const token = localStorage.getItem('authToken');
    if (!token) { setFilesUploadedCount('Error'); return; }
    setIsFetchingFileCount(true); setFilesUploadedCount(null);
    try {
      const params = {};
      if (divisionId && divisionId !== 'all') params.divisionId = divisionId;
      if (projectId && projectId !== 'all' && projectId !== 'unassigned') params.projectId = projectId;
      else if (projectId === 'unassigned') params.projectId = 'unassigned';
      if (plotName && plotName !== 'all' && canFetchPlots) params.plotName = plotName;

      const response = await axios.get(`${API_BASE_URL}/files/count`, { headers: { 'Authorization': `Bearer ${token}` }, params: params });
      setFilesUploadedCount(response.data.count);
    } catch (error) { console.error("Failed to fetch files uploaded count:", error.response?.data?.message || error.message); setFilesUploadedCount('Error');
    } finally { setIsFetchingFileCount(false); }
  }, [canFetchPlots]);

  const fetchTotalTreesCount = useCallback(async (divisionId, projectId, plotName) => {
    const token = localStorage.getItem('authToken');
    if (!token) { setTotalTreesCount('Error'); return; }
    setIsFetchingTreeCount(true); setTotalTreesCount(null);
    try {
      const params = {};
      if (divisionId && divisionId !== 'all') params.divisionId = divisionId;
      if (projectId && projectId !== 'all' && projectId !== 'unassigned') params.projectId = projectId;
      else if (projectId === 'unassigned') params.projectId = 'unassigned';
      if (plotName && plotName !== 'all' && canFetchPlots) params.plotName = plotName;

      const response = await axios.get(`${API_BASE_URL}/files/count/trees`, { headers: { 'Authorization': `Bearer ${token}` }, params: params });
      setTotalTreesCount(response.data.count);
    } catch (error) { console.error("Failed to fetch total trees count:", error.response?.data?.message || error.message); setTotalTreesCount('Error');
    } finally { setIsFetchingTreeCount(false); }
  }, [canFetchPlots]);

  const fetchRecentUploads = useCallback(async (divisionId, projectId, plotName) => {
    setLoadingTimeline(true);
    const token = localStorage.getItem('authToken');
    if (!token) { setRecentUploads([]); setLoadingTimeline(false); return; }
    try {
      const params = { limit: 5 };
      if (divisionId && divisionId !== 'all') params.divisionId = divisionId;
      if (projectId && projectId !== 'all' && projectId !== 'unassigned') params.projectId = projectId;
      else if (projectId === 'unassigned') params.projectId = 'unassigned';
      if (plotName && plotName !== 'all' && canFetchPlots) params.plotName = plotName;

      const response = await axios.get(`${API_BASE_URL}/files/recent`, { headers: { 'Authorization': `Bearer ${token}` }, params: params });
      setRecentUploads(Array.isArray(response.data) ? response.data : []);
    } catch (error) { console.error("Failed to fetch recent uploads:", error.response?.data?.message || error.message); setRecentUploads([]);
    } finally { setLoadingTimeline(false); }
  }, [canFetchPlots]);

  const fetchAllTreeHeightsForChart = useCallback(async (divisionId, projectId, plotName) => {
    const token = localStorage.getItem('authToken');
    if (!token) { setAllTreeHeightsData([]); return; }
    setLoadingHeightsChart(true); setAllTreeHeightsData([]);
    try {
      const params = {};
      if (divisionId && divisionId !== 'all') params.divisionId = divisionId;
      if (projectId && projectId !== 'all' && projectId !== 'unassigned') params.projectId = projectId;
      else if (projectId === 'unassigned') params.projectId = 'unassigned';
      if (plotName && plotName !== 'all' && canFetchPlots) params.plotName = plotName;

      const response = await axios.get(`${API_BASE_URL}/files/all-tree-heights-adjusted`, { headers: { 'Authorization': `Bearer ${token}` }, params: params });
      const heights = response.data && response.data.heights;
      setAllTreeHeightsData(Array.isArray(heights) ? heights : []);
    } catch (error) { console.error("Failed to fetch all tree heights for chart:", error.response?.data?.message || error.message); setAllTreeHeightsData([]);
    } finally { setLoadingHeightsChart(false); }
  }, [canFetchPlots]);

  const fetchAllTreeDbhsForChart = useCallback(async (divisionId, projectId, plotName) => {
    const token = localStorage.getItem('authToken');
    if (!token) { setAllTreeDbhsData([]); return; }
    setLoadingDbhsChart(true); setAllTreeDbhsData([]);
    try {
      const params = {};
      if (divisionId && divisionId !== 'all') params.divisionId = divisionId;
      if (projectId && projectId !== 'all' && projectId !== 'unassigned') params.projectId = projectId;
      else if (projectId === 'unassigned') params.projectId = 'unassigned';
      if (plotName && plotName !== 'all' && canFetchPlots) params.plotName = plotName;

      const response = await axios.get(`${API_BASE_URL}/files/statistics/all-tree-dbhs-cm`, {
        headers: { 'Authorization': `Bearer ${token}` },
        params: params
      });
      const dbhs = response.data && response.data.dbhs_cm;
      setAllTreeDbhsData(Array.isArray(dbhs) ? dbhs : []);
    } catch (error) {
      console.error("Failed to fetch all tree DBHs for chart:", error.response?.data?.message || error.message);
      setAllTreeDbhsData([]);
    } finally {
      setLoadingDbhsChart(false);
    }
  }, [canFetchPlots]);

  // Fetch function for Tree Volume Distribution Chart (if kept)
  const fetchAllTreeVolumesForChart = useCallback(async (divisionId, projectId, plotName) => {
    const token = localStorage.getItem('authToken');
    if (!token) { setAllTreeVolumesData([]); return; }
    setLoadingVolumesChart(true); setAllTreeVolumesData([]);
    try {
      const params = {};
      if (divisionId && divisionId !== 'all') params.divisionId = divisionId;
      if (projectId && projectId !== 'all' && projectId !== 'unassigned') params.projectId = projectId;
      else if (projectId === 'unassigned') params.projectId = 'unassigned';
      if (plotName && plotName !== 'all' && canFetchPlots) params.plotName = plotName;

      const response = await axios.get(`${API_BASE_URL}/files/statistics/all-tree-volumes-m3-data`, {
        headers: { 'Authorization': `Bearer ${token}` },
        params: params
      });
      const volumes = response.data && response.data.volumes_m3;
      setAllTreeVolumesData(Array.isArray(volumes) ? volumes : []);
    } catch (error) {
      console.error("Failed to fetch all tree volumes for chart:", error.response?.data?.message || error.message);
      setAllTreeVolumesData([]);
    } finally {
      setLoadingVolumesChart(false);
    }
  }, [canFetchPlots]);

  // --- Fetch Sum of Carbon Tonnes ---
  const fetchSumCarbonTonnes = useCallback(async (divisionId, projectId, plotName) => {
    const token = localStorage.getItem('authToken');
    if (!token) { setTotalSumCarbonTonnes('Error'); return; }
    setIsFetchingSumCarbon(true); setTotalSumCarbonTonnes(null);
    try {
      const params = {};
      if (divisionId && divisionId !== 'all') params.divisionId = divisionId;
      if (projectId && projectId !== 'all' && projectId !== 'unassigned') params.projectId = projectId;
      else if (projectId === 'unassigned') params.projectId = 'unassigned';
      if (plotName && plotName !== 'all' && canFetchPlots) params.plotName = plotName;

      const response = await axios.get(`${API_BASE_URL}/files/stats/sum-carbon-tonnes`, {
        headers: { 'Authorization': `Bearer ${token}` },
        params: params
      });
      // Assuming backend returns { "sum_carbon_tonnes": VALUE }
      setTotalSumCarbonTonnes(response.data.sum_carbon_tonnes);
    } catch (error) {
      console.error("Failed to fetch sum of carbon tonnes:", error.response?.data?.message || error.message);
      setTotalSumCarbonTonnes('Error');
    } finally {
      setIsFetchingSumCarbon(false);
    }
  }, [canFetchPlots]);


  useEffect(() => {
    const fetchUserCount = async () => {
      const token = localStorage.getItem('authToken');
      if (!token) { setTotalMembers('Error'); return; }
      try {
        const response = await axios.get(`${API_BASE_URL}/users/count`, { headers: { 'Authorization': `Bearer ${token}` } });
        setTotalMembers(response.data.count);
      } catch (error) { console.error("Failed to fetch user count:", error.response?.data?.message || error.message); setTotalMembers('Error'); }
    };
    fetchUserCount();
  }, []);

  useEffect(() => {
    fetchFilterData();
  }, [fetchFilterData]);

  useEffect(() => {
    if (canFetchPlots && !loadingFilters) {
      fetchPlotsList(filterDivisionId, filterProjectId);
    } else if (!canFetchPlots) {
      setPlotsList([]);
      if (filterPlotName !== 'all') setFilterPlotName('all'); // Reset plot filter if project/division makes it invalid
    }
  }, [filterDivisionId, filterProjectId, loadingFilters, canFetchPlots, fetchPlotsList, filterPlotName]);


  useEffect(() => {
    if (!loadingFilters) { // Only fetch if initial filter data (divisions, projects) is loaded
      fetchRecentUploads(filterDivisionId, filterProjectId, filterPlotName);
      fetchFilesUploadedCount(filterDivisionId, filterProjectId, filterPlotName);
      fetchTotalTreesCount(filterDivisionId, filterProjectId, filterPlotName);
      fetchAllTreeHeightsForChart(filterDivisionId, filterProjectId, filterPlotName);
      fetchAllTreeDbhsForChart(filterDivisionId, filterProjectId, filterPlotName);
      fetchAllTreeVolumesForChart(filterDivisionId, filterProjectId, filterPlotName); // If volume chart is kept
      fetchSumCarbonTonnes(filterDivisionId, filterProjectId, filterPlotName); // Fetch carbon sum
    }
  }, [
    filterDivisionId, filterProjectId, filterPlotName, loadingFilters, // Key filter dependencies
    fetchRecentUploads, fetchFilesUploadedCount, fetchTotalTreesCount,
    fetchAllTreeHeightsForChart, fetchAllTreeDbhsForChart,
    fetchAllTreeVolumesForChart, // If volume chart is kept
    fetchSumCarbonTonnes // Dependency for carbon sum
  ]);

  const handleDivisionFilterChange = (event) => {
    const newDivisionId = event.target.value;
    setFilterDivisionId(newDivisionId);
    setFilterProjectId('all'); // Reset project when division changes
    setFilterPlotName('all');  // Reset plot when division changes
  };

  const handleProjectFilterChange = (event) => {
    const newProjectId = event.target.value;
    setFilterProjectId(newProjectId);
    setFilterPlotName('all'); // Reset plot when project changes
  };

  const handlePlotFilterChange = (event) => {
    setFilterPlotName(event.target.value);
  };

  const handleResetFilters = () => {
    setFilterDivisionId('all');
    setFilterProjectId('all');
    setFilterPlotName('all');
  };

  const areFiltersDefault = useMemo(() => {
    return filterDivisionId === 'all' && filterProjectId === 'all' && filterPlotName === 'all';
  }, [filterDivisionId, filterProjectId, filterPlotName]);


  const filteredProjectsForDropdown = useMemo(() => {
    const safeProjectsList = Array.isArray(projectsList) ? projectsList : [];
    if (loadingFilters || !safeProjectsList) return []; // Ensure projectsList is loaded and an array
    if (filterDivisionId === 'all') return safeProjectsList; // Show all if no division filter
    const numericDivisionId = parseInt(filterDivisionId, 10);
    return safeProjectsList.filter(p => p.division_id === numericDivisionId);
  }, [projectsList, filterDivisionId, loadingFilters]);

  const treeHeightHistogramData = useMemo(() => {
    const currentData = Array.isArray(allTreeHeightsData) ? allTreeHeightsData : [];
    if (currentData.length === 0) {
      return { labels: [], datasets: [] };
    }
    const bins = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, Infinity];
    const labels = bins.slice(0, -1).map((bin, index) =>
      index === bins.length - 2 ? `≥${bins[index]}m` : `${bin}-${bins[index + 1]}m`
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
      labels: labels,
      datasets: [{ label: "Tree Count by Adjusted Height", data: counts, backgroundColor: colors.greenAccent[500], borderColor: colors.greenAccent[700], borderWidth: 1 }],
    };
  }, [allTreeHeightsData, colors]);

  const treeHeightHistogramOptions = useMemo(() => ({
    maintainAspectRatio: false, responsive: true,
    plugins: {
      legend: { display: true, position: "bottom", labels: { color: colors.grey[100] } },
      title: { display: true, text: 'Tree Height Distribution (Adjusted)', color: colors.grey[100], font: { size: 16 }, padding: { bottom: 30 } },
      datalabels: { display: true, color: colors.grey[100], anchor: 'end', align: 'top', formatter: (value) => value > 0 ? value : '' },
    },
    scales: {
      x: { title: { display: true, text: 'Height Range (m)', color: colors.grey[300] }, ticks: { color: colors.grey[100] }, grid: { color: colors.grey[800] } },
      y: { title: { display: true, text: 'Number of Trees', color: colors.grey[300] }, ticks: { color: colors.grey[100], stepSize: 1 }, grid: { color: colors.grey[800] }, beginAtZero: true },
    },
  }), [colors]);

  const treeDbhHistogramData = useMemo(() => {
    const currentData = Array.isArray(allTreeDbhsData) ? allTreeDbhsData : [];
    if (currentData.length === 0) {
      return { labels: [], datasets: [] };
    }
    const bins = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, Infinity];
    const labels = bins.slice(0, -1).map((bin, index) =>
      index === bins.length - 2 ? `≥${bins[index]}cm` : `${bin}-${bins[index + 1]}cm`
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
      labels: labels,
      datasets: [{ label: "Tree Count by DBH", data: counts, backgroundColor: colors.blueAccent[500], borderColor: colors.blueAccent[700], borderWidth: 1 }],
    };
  }, [allTreeDbhsData, colors]);

  const treeDbhHistogramOptions = useMemo(() => ({
    maintainAspectRatio: false, responsive: true,
    plugins: {
      legend: { display: true, position: "bottom", labels: { color: colors.grey[100] } },
      title: { display: true, text: 'Tree Diameter (DBH) Distribution', color: colors.grey[100], font: { size: 16 }, padding: { bottom: 30 } },
      datalabels: { display: true, color: colors.grey[100], anchor: 'end', align: 'top', formatter: (value) => value > 0 ? value : '' },
    },
    scales: {
      x: { title: { display: true, text: 'DBH Range (cm)', color: colors.grey[300] }, ticks: { color: colors.grey[100] }, grid: { color: colors.grey[800] } },
      y: { title: { display: true, text: 'Number of Trees', color: colors.grey[300] }, ticks: { color: colors.grey[100], stepSize: 1 }, grid: { color: colors.grey[800] }, beginAtZero: true },
    },
  }), [colors]);

  // Tree Volume Distribution Chart Data & Options (if kept)
  const treeVolumeHistogramData = useMemo(() => {
    const currentData = Array.isArray(allTreeVolumesData) ? allTreeVolumesData : [];
    if (currentData.length === 0) {
      return { labels: [], datasets: [] };
    }
    const bins = [0, 0.25, 0.5, 0.75, 1, 1.5, 2, 2.5, 3, 5, Infinity];
    const labels = bins.slice(0, -1).map((bin, index) =>
      index === bins.length - 2 ? `≥${bins[index]}m³` : `${bin}-${bins[index + 1]}m³`
    );
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
      labels: labels,
      datasets: [{
        label: "Tree Count by Volume",
        data: counts,
        backgroundColor: colors.redAccent[500],
        borderColor: colors.redAccent[700],
        borderWidth: 1
      }],
    };
  }, [allTreeVolumesData, colors]);

  const treeVolumeHistogramOptions = useMemo(() => ({
    maintainAspectRatio: false,
    responsive: true,
    plugins: {
      legend: { display: true, position: "bottom", labels: { color: colors.grey[100] } },
      title: { display: true, text: 'Tree Volume Distribution (m³)', color: colors.grey[100], font: { size: 16 }, padding: { bottom: 30 } },
      datalabels: { display: true, color: colors.grey[100], anchor: 'end', align: 'top', formatter: (value) => value > 0 ? value : '' },
    },
    scales: {
      x: { title: { display: true, text: 'Volume Range (m³)', color: colors.grey[300] }, ticks: { color: colors.grey[100] }, grid: { color: colors.grey[800] } },
      y: { title: { display: true, text: 'Number of Trees', color: colors.grey[300] }, ticks: { color: colors.grey[100], stepSize: 1 }, grid: { color: colors.grey[800] }, beginAtZero: true },
    },
  }), [colors]);


  // Styles
  const styles = {
    container: { display: "flex", minHeight: "100vh", bgcolor: colors.grey[800], marginLeft: isCollapsed ? "80px" : "270px", transition: "margin 0.3s ease" },
    content: { flex: 1, p: { xs: 1, sm: 2, md: 3 }, overflowY: 'auto' },
    filterRow: { marginBottom: theme.spacing(3), padding: theme.spacing(2), backgroundColor: colors.grey[900], borderRadius: theme.shape.borderRadius },
    filterFormControl: { minWidth: 150,
      '& .MuiInputLabel-root': { color: colors.grey[300], '&.Mui-focused': { color: colors.blueAccent[300] } },
      '& .MuiOutlinedInput-root': {
        color: colors.grey[100],
        '& .MuiOutlinedInput-notchedOutline': { borderColor: colors.grey[600] },
        '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: colors.primary[300] },
        '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: colors.blueAccent[400] },
        '& .MuiSelect-icon': { color: colors.grey[300] }
      }
    },
    statsGrid: { display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)", md: "repeat(4, 1fr)" }, gap: theme.spacing(2), mt: 3 },
    card: { minHeight: 150, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", p: 2, bgcolor: colors.grey[900], position: 'relative' },
    cardTitle: { mb: 1, fontWeight: "bold", color: colors.grey[100], textAlign: 'center' },
    cardIconBox: { display: "flex", alignItems: "center", gap: 1, color: colors.blueAccent[400], textAlign: 'center' },
    body2Text: { fontWeight: "bold", color: colors.blueAccent[300] },
    cardLoadingOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0, 0, 0, 0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 2, borderRadius: 'inherit', color: colors.grey[100] },
    chartsGridRow2: { display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, gap: theme.spacing(2), mt: 3 },
    chartsGridRow3: { display: "grid", gridTemplateColumns: { xs: "1fr", lg: "3fr 2fr" }, gap: theme.spacing(2), mt: 3 },
    chartTitleText: { marginBottom: 2, marginTop: 1, color: colors.grey[100], textAlign: 'center' },
    timelineBox: { height: { xs: 320, sm: 370 }, width: "100%", bgcolor: colors.grey[900] },
    timelineCardContent: { height: '100%', display: 'flex', flexDirection: 'column' },
    timelineScroll: { flexGrow: 1, overflowY: 'auto', "&::-webkit-scrollbar": { width: "6px" }, "&::-webkit-scrollbar-track": { background: colors.grey[700] }, "&::-webkit-scrollbar-thumb": { backgroundColor: colors.grey[500], borderRadius: "10px" } }
  };
  const chartBoxHeight = { xs: 220, sm: 250, md: 280 };
  styles.chartContainer = { height: chartBoxHeight, width: "100%" };

  const commonMenuProps = {
    PaperProps: {
      sx: {
          color: colors.grey[100], // Default text color for menu items
          '& .MuiMenuItem-root:hover': {
              backgroundColor: '#28ade2', // Your desired hover background
              color: 'white',             // Your desired hover text color
          },
          '& .MuiMenuItem-root.Mui-selected': {
              backgroundColor: colors.blueAccent[700] + '!important', // Keep selected style
              color: colors.grey[100] + '!important',                // Keep selected text color (add !important)
          },
          // Ensure selected item maintains its style on hover
          '& .MuiMenuItem-root.Mui-selected:hover': {
              backgroundColor: colors.blueAccent[700] + '!important',
              color: colors.grey[100] + '!important',
          }
      }
  }
  };

  const filterDisabled = loadingFilters || isFetchingFileCount || isFetchingTreeCount || loadingPlots || loadingHeightsChart || loadingDbhsChart || loadingVolumesChart || isFetchingSumCarbon; // Updated to use isFetchingSumCarbon

  const plotFilterDisabledReason = useMemo(() => {
    if (filterDisabled) return ""; // If any main loading is active, no specific reason needed
    if (!canFetchPlots) {
      if (filterDivisionId === 'all' && (filterProjectId === 'all' || filterProjectId === 'unassigned')) {
        return "Select a Division and a specific Project to enable Plot filter.";
      } else if (filterDivisionId === 'all') {
        return "Select a Division first to see Projects and Plots.";
      } else if (filterProjectId === 'all' || filterProjectId === 'unassigned') {
        return "Select a specific Project to enable Plot filter.";
      }
    }
    return ""; // No reason if plots can be fetched or if filters are generally disabled
  }, [canFetchPlots, filterDivisionId, filterProjectId, filterDisabled]);


  return (
    <Box sx={styles.container}>
      <Box sx={styles.content}>

        <Box sx={styles.filterRow}>
          <Typography variant="h6" gutterBottom sx={{ color: colors.grey[100], mb: 2 }}>
            Filter Dashboard Data
          </Typography>
          <Grid container spacing={2} alignItems="flex-end">
            <Grid item xs={12} sm={6} md={3}>
              <FormControl fullWidth variant="outlined" size="small" sx={styles.filterFormControl}>
                <InputLabel id="division-filter-label-dash">Filter Division</InputLabel>
                <Select
                  labelId="division-filter-label-dash"
                  value={filterDivisionId}
                  label="Filter Division"
                  onChange={handleDivisionFilterChange}
                  disabled={filterDisabled}
                  MenuProps={commonMenuProps}
                >
                  <MenuItem value="all"><em>All Divisions</em></MenuItem>
                  {loadingFilters ? <MenuItem disabled><CircularProgress size={20} sx={{ mr: 1 }} /> Loading...</MenuItem>
                    : (divisionsList || []).length === 0 ? <MenuItem disabled><em>No divisions</em></MenuItem>
                    : (divisionsList || []).map(d => (<MenuItem key={d.id} value={d.id}>{d.name}</MenuItem>))
                  }
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <FormControl fullWidth variant="outlined" size="small" sx={styles.filterFormControl}>
                <InputLabel id="project-filter-label-dash">Filter Project</InputLabel>
                <Select
                  labelId="project-filter-label-dash"
                  value={filterProjectId}
                  label="Filter Project"
                  onChange={handleProjectFilterChange}
                  disabled={filterDisabled || (filterDivisionId === 'all' && (projectsList || []).length === 0 && !loadingFilters)}
                  MenuProps={commonMenuProps}
                >
                  <MenuItem value="all"><em>All Projects</em></MenuItem>
                  {loadingFilters ? <MenuItem disabled><CircularProgress size={20} sx={{ mr: 1 }} /> Loading...</MenuItem>
                    : (filteredProjectsForDropdown || []).length === 0 && filterDivisionId !== 'all' ? <MenuItem disabled><em>No projects in division</em></MenuItem>
                    : (projectsList || []).length === 0 && filterDivisionId === 'all' && !loadingFilters ? <MenuItem disabled><em>No projects available</em></MenuItem>
                    : (filteredProjectsForDropdown || []).map(p => (<MenuItem key={p.id} value={p.id}>{p.name}{filterDivisionId === 'all' && p.division_name && ` (${p.division_name})`}</MenuItem>))
                  }
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <MuiTooltip title={plotFilterDisabledReason} arrow placement="top">
                <span> {/* Span is necessary for Tooltip when child is disabled */}
                  <FormControl
                    fullWidth
                    variant="outlined"
                    size="small"
                    sx={{
                      ...styles.filterFormControl,
                      ...( (!canFetchPlots && !filterDisabled) && { opacity: 0.65, cursor: 'not-allowed' } )
                    }}
                  >
                    <InputLabel id="plot-filter-label-dash">Filter Plot</InputLabel>
                    <Select
                      labelId="plot-filter-label-dash"
                      value={filterPlotName}
                      label="Filter Plot"
                      onChange={handlePlotFilterChange}
                      disabled={!canFetchPlots || filterDisabled}
                      MenuProps={commonMenuProps}
                    >
                      <MenuItem value="all"><em>All Plots</em></MenuItem>
                      {loadingPlots ? <MenuItem disabled><CircularProgress size={20} sx={{ mr: 1 }} /> Loading plots...</MenuItem>
                        : !canFetchPlots && !filterDisabled ? (
                            <MenuItem disabled>
                                <em>{filterDivisionId === 'all' ? "Select Division & Project" : "Select Project"}</em>
                            </MenuItem>
                          )
                        : (plotsList || []).length === 0 && canFetchPlots && !filterDisabled ? (
                            <MenuItem disabled><em>No plots for this project</em></MenuItem>
                          )
                        : (plotsList || []).length > 0 && canFetchPlots && !filterDisabled ? (
                            (plotsList || []).map(plot => (<MenuItem key={plot} value={plot}>{plot}</MenuItem>))
                          )
                        : ( /* Fallback for other disabled states or if plotsList is unexpectedly not an array */
                            <MenuItem disabled>
                                <em>{filterDisabled ? "Filters loading..." : "Plot selection unavailable"}</em>
                            </MenuItem>
                          )
                      }
                    </Select>
                  </FormControl>
                </span>
              </MuiTooltip>
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <Button
                fullWidth
                variant="outlined"
                onClick={handleResetFilters}
                disabled={filterDisabled || areFiltersDefault}
                startIcon={<ReplayIcon />}
                sx={{
                  color: colors.grey?.[300] || '#B0BEC5',
                  borderColor: colors.grey?.[600] || '#616161',
                  height: '40px', 
                  textTransform: 'none',
                  '&:hover': {
                    borderColor: colors.primary?.[300] || colors.grey?.[500] || '#757575',
                    backgroundColor: alpha(colors.primary?.[700] || colors.grey?.[800] || '#2C2C2C', 0.3),
                  },
                  '&.Mui-disabled': {
                    color: colors.grey?.[700] || '#424242',
                    borderColor: colors.grey?.[800] || '#303030',
                  }
                }}
              >
                Reset Filters
              </Button>
            </Grid>
          </Grid>
        </Box>

        <Box sx={styles.statsGrid}>
            <Card sx={styles.card}>
                {totalMembers === null && (<Box sx={styles.cardLoadingOverlay}><CircularProgress color="inherit" size={30} /></Box>)}
                <Typography variant="h1" sx={{ ...styles.cardTitle, fontSize: {xs: '2rem', md: '3rem'}, visibility: totalMembers === null ? 'hidden' : 'visible' }}>
                {totalMembers === 'Error' ? 'N/A' : totalMembers ?? '-'}
                </Typography>
                <Box sx={{ ...styles.cardIconBox, visibility: totalMembers === null ? 'hidden' : 'visible' }}>
                <span className="material-symbols-outlined">group</span>
                <Typography variant="body2" sx={styles.body2Text}>Total Members</Typography>
                </Box>
            </Card>
            <Card sx={styles.card}>
                {isFetchingFileCount && (<Box sx={styles.cardLoadingOverlay}><CircularProgress color="inherit" size={30} /></Box>)}
                <Typography variant="h1" sx={{ ...styles.cardTitle, fontSize: {xs: '2rem', md: '3rem'}, visibility: isFetchingFileCount ? 'hidden' : 'visible' }}>
                {filesUploadedCount === 'Error' ? 'N/A' : filesUploadedCount ?? '-'}
                </Typography>
                <Box sx={{ ...styles.cardIconBox, visibility: isFetchingFileCount ? 'hidden' : 'visible' }}>
                <span className="material-symbols-outlined">upload_file</span>
                <Typography variant="body2" sx={styles.body2Text}>Files Uploaded</Typography>
                </Box>
            </Card>
            <Card sx={{ ...styles.card, justifyContent: 'center' }}>
                {isFetchingTreeCount && (<Box sx={styles.cardLoadingOverlay}><CircularProgress color="inherit" size={30} /></Box>)}
                <Typography variant="h1" sx={{ ...styles.cardTitle, fontSize: {xs: '2rem', md: '3rem'}, visibility: isFetchingTreeCount ? 'hidden' : 'visible', mb: 2 }}>
                {totalTreesCount === 'Error' ? 'N/A' : totalTreesCount ?? '-'}
                </Typography>
                <Box sx={{ ...styles.cardIconBox, visibility: isFetchingTreeCount ? 'hidden' : 'visible' }}>
                <span className="material-symbols-outlined" style={{ fontSize: '2rem' }}>forest</span>
                <Typography variant="h6" sx={{...styles.body2Text, fontSize: {xs: '0.9rem', md: '1.15rem'}}}>Total Trees</Typography>
                </Box>
            </Card>
            {/* --- Total Carbon Estimation Card --- */}
            <Card sx={styles.card}>
                {isFetchingSumCarbon && (<Box sx={styles.cardLoadingOverlay}><CircularProgress color="inherit" size={30}/></Box>)}
                <Typography variant="h1" sx={{...styles.cardTitle, fontSize: {xs: '1.7rem', md: '2.5rem'}, visibility: isFetchingSumCarbon ? 'hidden' : 'visible'}}>
                {totalSumCarbonTonnes === 'Error' ? 'N/A' : totalSumCarbonTonnes !== null ? `${parseFloat(totalSumCarbonTonnes).toFixed(2)} t` : '-'}
                </Typography>
                <Box sx={{...styles.cardIconBox, visibility: isFetchingSumCarbon ? 'hidden' : 'visible'}}>
                <span className="material-symbols-outlined">eco</span> {/* Using Google Material Symbols "eco" icon */}
                {/* Or if you imported EcoIcon: <EcoIcon sx={{ fontSize: '1.8rem' }} /> */}
                <Typography variant="body2" sx={styles.body2Text}>Total Carbon (t)</Typography>
                </Box>
            </Card>
        </Box>

        <Box sx={styles.chartsGridRow2}>
            {/* Tree Volume Distribution Chart (if kept) */}
            <Card>
                <CardContent sx={{ height: { xs: chartBoxHeight.xs + 50, sm: chartBoxHeight.sm + 50, md: chartBoxHeight.md + 60 }, display: 'flex', flexDirection: 'column' }}>
                <Box sx={{ flexGrow: 1, position: 'relative', width: '100%', height: '100%' }}>
                    {loadingVolumesChart ? (
                    <Box display="flex" justifyContent="center" alignItems="center" height="100%"><CircularProgress /></Box>
                    ) : treeVolumeHistogramData.datasets.length > 0 && treeVolumeHistogramData.datasets[0].data.some(d => d > 0) ? (
                    <Bar data={treeVolumeHistogramData} options={treeVolumeHistogramOptions} />
                    ) : (
                    <Typography sx={{ textAlign: 'center', color: colors.grey[400], mt: 'auto', mb: 'auto', p: 1 }}>
                        {loadingFilters ? "Loading filters..." : "No tree volume data for current selection."}
                    </Typography>
                    )}
                </Box>
                </CardContent>
            </Card>
            {/* Tree Height Distribution Chart */}
            <Card>
                <CardContent sx={{ height: { xs: chartBoxHeight.xs + 50, sm: chartBoxHeight.sm + 50, md: chartBoxHeight.md + 60 }, display: 'flex', flexDirection: 'column' }}>
                <Box sx={{ flexGrow: 1, position: 'relative', width: '100%', height: '100%' }}>
                    {loadingHeightsChart ? (
                    <Box display="flex" justifyContent="center" alignItems="center" height="100%"><CircularProgress /></Box>
                    ) : treeHeightHistogramData.datasets.length > 0 && treeHeightHistogramData.datasets[0].data.some(d => d > 0) ? (
                    <Bar data={treeHeightHistogramData} options={treeHeightHistogramOptions} />
                    ) : (
                    <Typography sx={{ textAlign: 'center', color: colors.grey[400], mt: 'auto', mb: 'auto', p: 1 }}>
                        {loadingFilters ? "Loading filters..." : "No tree height data for current selection."}
                    </Typography>
                    )}
                </Box>
                </CardContent>
            </Card>
        </Box>

        <Box sx={styles.chartsGridRow3}>
            {/* Tree DBH Distribution Chart */}
            <Card>
                <CardContent sx={{ height: { xs: chartBoxHeight.xs + 50, sm: chartBoxHeight.sm + 50, md: chartBoxHeight.md + 60 }, display: 'flex', flexDirection: 'column' }}>
                <Box sx={{ flexGrow: 1, position: 'relative', width: '100%', height: '100%' }}>
                    {loadingDbhsChart ? (
                    <Box display="flex" justifyContent="center" alignItems="center" height="100%"><CircularProgress /></Box>
                    ) : treeDbhHistogramData.datasets.length > 0 && treeDbhHistogramData.datasets[0].data.some(d => d > 0) ? (
                    <Bar data={treeDbhHistogramData} options={treeDbhHistogramOptions} />
                    ) : (
                    <Typography sx={{ textAlign: 'center', color: colors.grey[400], mt: 'auto', mb: 'auto', p: 1 }}>
                        {loadingFilters ? "Loading filters..." : "No tree diameter data for current selection."}
                    </Typography>
                    )}
                </Box>
                </CardContent>
            </Card>
            {/* Recent File Uploads Timeline */}
            <Card sx={styles.timelineBox}>
                <CardContent sx={styles.timelineCardContent}>
                <Typography variant="h5" sx={{ ...styles.chartTitleText, flexShrink: 0 }}>Recent File Uploads</Typography>
                <Box sx={styles.timelineScroll}>
                    {loadingTimeline ? <Box display="flex" justifyContent="center" alignItems="center" height="100%"><CircularProgress /></Box>
                    : (recentUploads || []).length === 0 ?
                        <Typography sx={{ textAlign: 'center', color: colors.grey[400], mt: 4, p: 1 }}>
                        {loadingFilters ? "Loading filters..." :
                            filterDivisionId !== 'all' || filterProjectId !== 'all' || (filterPlotName !== 'all' && canFetchPlots)
                            ? 'No recent uploads match filters.'
                            : 'No recent uploads found.'
                        }
                        </Typography>
                        : <Timeline position="alternate" sx={{ p: 0, mt: 1 }}>
                        {(recentUploads || []).map((upload, index) => (
                            <TimelineItem key={upload.id || index}>
                            <TimelineSeparator>
                                <TimelineDot color="primary" variant="outlined" />
                                {index < (recentUploads || []).length - 1 && <TimelineConnector sx={{ bgcolor: colors.primary[500] }} />}
                            </TimelineSeparator>
                            <TimelineContent sx={{ py: '10px', px: 2 }}>
                                <Typography variant="caption" sx={{ color: colors.grey[400] }}>{upload.date} - {upload.time}</Typography>
                                <Typography variant="body2" sx={{ fontWeight: "bold", color: colors.grey[100], whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={upload.file}>{upload.file}</Typography>
                                <Typography variant="caption" sx={{ color: colors.grey[300], display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={upload.context}>{upload.context}</Typography>
                            </TimelineContent>
                            </TimelineItem>
                        ))}
                        </Timeline>
                    }
                </Box>
                </CardContent>
            </Card>
        </Box>

      </Box>
    </Box>
  );
};

export default Dashboard;