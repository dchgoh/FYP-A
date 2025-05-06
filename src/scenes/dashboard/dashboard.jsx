import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Box, Card, CardContent, Typography, useTheme, Grid,
  FormControl, InputLabel, Select, MenuItem, CircularProgress // Added MUI components
} from "@mui/material";
import { Pie, Line, Bar } from "react-chartjs-2";
import { Chart as ChartJS, ArcElement, Tooltip, Legend, LineElement, LinearScale, PointElement, CategoryScale, BarElement } from "chart.js";
import ChartDataLabels from "chartjs-plugin-datalabels";
import { Timeline, TimelineItem, TimelineSeparator, TimelineConnector, TimelineContent, TimelineDot } from "@mui/lab";
import { tokens } from "../../theme"; // Import theme tokens
import axios from 'axios'; // Import axios for easier requests

// --- CONSTANTS ---
const API_BASE_URL = "http://localhost:5000/api";

ChartJS.register(ArcElement, Tooltip, Legend, LineElement, LinearScale, PointElement, CategoryScale, BarElement, ChartDataLabels);

const Dashboard = ({ isCollapsed }) => {

  const theme = useTheme();
  const colors = tokens(theme.palette.mode); // Get colors from theme

  // --- State ---
  const [totalMembers, setTotalMembers] = useState(null);
  const [filesUploadedCount, setFilesUploadedCount] = useState(null); // State for dynamic file count
  const [isFetchingFileCount, setIsFetchingFileCount] = useState(false); // Loading state for file count

  const [divisionsList, setDivisionsList] = useState([]);
  const [projectsList, setProjectsList] = useState([]);
  const [loadingFilters, setLoadingFilters] = useState(false); // Combined loading for filters

  const [filterDivisionId, setFilterDivisionId] = useState('all');
  const [filterProjectId, setFilterProjectId] = useState('all');

  const [recentUploads, setRecentUploads] = useState([]); // State to hold fetched timeline data
  const [loadingTimeline, setLoadingTimeline] = useState(true); // Loading state for the timeline

  // --- Fetch User Count (existing) ---
  useEffect(() => {
    const fetchUserCount = async () => {
      const token = localStorage.getItem('authToken');
      if (!token) {
        console.error("Auth token not found for user count.");
        setTotalMembers('Error');
        return;
      }
      try {
        // Using axios now for consistency
        const response = await axios.get(`${API_BASE_URL}/users/count`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        setTotalMembers(response.data.count);
      } catch (error) {
        console.error("Failed to fetch user count:", error.response?.data?.message || error.message);
        setTotalMembers('Error');
      }
    };
    fetchUserCount();
  }, []);

  // --- Fetch Divisions and Projects for Filters ---
  const fetchFilterData = useCallback(async () => {
    const token = localStorage.getItem('authToken');
    if (!token) {
      console.error("Auth token not found for filter data.");
      // Optionally show an error message via Snackbar or state
      setDivisionsList([]);
      setProjectsList([]);
      return;
    }
    setLoadingFilters(true);
    try {
      const [divisionsRes, projectsRes] = await Promise.all([
        axios.get(`${API_BASE_URL}/divisions`, { headers: { 'Authorization': `Bearer ${token}` } }),
        axios.get(`${API_BASE_URL}/projects`, { headers: { 'Authorization': `Bearer ${token}` } })
      ]);
      setDivisionsList(divisionsRes.data || []);
      setProjectsList(projectsRes.data || []);
    } catch (error) {
      console.error("Failed to fetch filter data:", error.response?.data?.message || error.message);
      setDivisionsList([]);
      setProjectsList([]);
      // Optionally show error to user
    } finally {
      setLoadingFilters(false);
    }
  }, []); // Empty dependency array - runs once on mount

  useEffect(() => {
    fetchFilterData();
  }, [fetchFilterData]); // Call fetchFilterData on mount


  // --- NEW: Fetch Recent Uploads for Timeline ---
  const fetchRecentUploads = useCallback(async (divisionId, projectId) => { // Accept filters as args
    setLoadingTimeline(true);
    const token = localStorage.getItem('authToken');
    if (!token) {
      console.error("Auth token not found for recent uploads.");
      setRecentUploads([]);
      setLoadingTimeline(false);
      return;
    }
    try {
      // Prepare query parameters, including filters
      const params = { limit: 5 }; // Always include limit
      if (divisionId && divisionId !== 'all') {
        params.divisionId = divisionId; // Add divisionId if selected
      }
      if (projectId && projectId !== 'all') {
        params.projectId = projectId; // Add projectId if selected
      }

      console.log("Fetching recent uploads with params:", params); // Debug log

      const response = await axios.get(`${API_BASE_URL}/files/recent`, {
        headers: { 'Authorization': `Bearer ${token}` },
        params: params // Pass the constructed params object
      });
      setRecentUploads(response.data || []);
    } catch (error) {
      console.error("Failed to fetch recent uploads:", error.response?.data?.message || error.message);
      setRecentUploads([]);
    } finally {
      setLoadingTimeline(false);
    }
  }, []); // Keep dependency array empty as filters are passed in

  // --- Effect for Timeline Load & Update (MODIFIED) ---
  useEffect(() => {
    // Fetch recent uploads when component mounts OR when filters change
    // Only run if filter data has potentially loaded to avoid initial unnecessary calls
    if (!loadingFilters) {
      fetchRecentUploads(filterDivisionId, filterProjectId);
    }
  }, [filterDivisionId, filterProjectId, loadingFilters, fetchRecentUploads]);


  // --- Fetch Files Uploaded Count (Dynamic based on filters) ---
  const fetchFilesUploadedCount = useCallback(async (divisionId, projectId) => {
    const token = localStorage.getItem('authToken');
    console.log("Token for file count fetch:", token);
    if (!token) {
      console.error("Auth token not found for file count.");
      setFilesUploadedCount('Error');
      return;
    }
    setIsFetchingFileCount(true);
    setFilesUploadedCount(null); // Show loading state in card

    try {
      const params = {};
      if (divisionId && divisionId !== 'all') {
        params.divisionId = divisionId;
      }
      if (projectId && projectId !== 'all') {
        params.projectId = projectId;
      }

      const response = await axios.get(`${API_BASE_URL}/files/count`, {
        headers: { 'Authorization': `Bearer ${token}` },
        params: params // Add params to the request
      });
      setFilesUploadedCount(response.data.count);
    } catch (error) {
      console.error("Failed to fetch files uploaded count:", error.response?.data?.message || error.message);
      setFilesUploadedCount('Error');
    } finally {
      setIsFetchingFileCount(false);
    }
  }, []); // No dependencies needed here as params are passed in

  // --- Effect to fetch file count when filters change ---
  useEffect(() => {
    // Fetch initial count on mount (after filters are loaded) or when filters change
    if (!loadingFilters) { // Only fetch count once filters are potentially loaded
      fetchFilesUploadedCount(filterDivisionId, filterProjectId);
    }
    // Do not fetch if filters are still loading to avoid unnecessary calls
  }, [filterDivisionId, filterProjectId, loadingFilters, fetchFilesUploadedCount]); // Re-run when filters or loading state change

  // --- Filter Change Handlers ---
  const handleDivisionFilterChange = (event) => {
    const newDivisionId = event.target.value;
    setFilterDivisionId(newDivisionId);

    // Reset Project Filter if the current project doesn't belong to the new division
    if (newDivisionId !== 'all' && filterProjectId !== 'all') {
      const numericProjectId = parseInt(filterProjectId, 10);
      const numericDivisionId = parseInt(newDivisionId, 10);
      const projectStillValid = projectsList.find(
        p => p.id === numericProjectId && p.division_id === numericDivisionId
      );
      if (!projectStillValid) {
        setFilterProjectId('all'); // Reset project filter
      }
    }
    // fetchFilesUploadedCount will be triggered by the useEffect watching filterDivisionId
  };

  const handleProjectFilterChange = (event) => {
    setFilterProjectId(event.target.value);
    // fetchFilesUploadedCount will be triggered by the useEffect watching filterProjectId
  };

  // --- Memoized Filtered Project List for Dropdown ---
  const filteredProjectsForDropdown = useMemo(() => {
    if (loadingFilters) return []; // Don't filter while loading
    if (filterDivisionId === 'all') {
      return projectsList; // Show all projects if 'All Divisions' selected
    }
    const numericDivisionId = parseInt(filterDivisionId, 10);
    if (isNaN(numericDivisionId)) {
      return [];
    }
    return projectsList.filter(p => p.division_id === numericDivisionId);
  }, [projectsList, filterDivisionId, loadingFilters]);

  // --- Chart Data and Options (Keep existing) ---
  const pieData = { /* ... Same as before ... */
    labels: ["Plot 1", "Plot 2", "Plot 3", "Plot 4", "Plot 5"],
    datasets: [
      {
        data: [10, 8, 4, 6, 4],
        backgroundColor: ["#28ADE2", "#3674B5", "#578FCA", "#A1E3F9", "#D1F8EF"],
      },
    ],
  };
  const pieOptions = { /* ... Same as before ... */
    plugins: {
      legend: { display: true, position: "left", labels: { color: colors.grey[100], usePointStyle: true, boxWidth: 10, padding: 10, }, },
      datalabels: { color: (context) => { const colors = ["#fff", "#fff", "#fff", "#666", "#333"]; return colors[context.dataIndex] || "#fff"; }, font: { size: 14 }, formatter: (value) => `${value}`, },
    },
    elements: { arc: { borderWidth: 0, }, }, cutout: "0%", maintainAspectRatio: false,
  };
  const lineData = { /* ... Same as before ... */
    labels: ["2021", "2022", "2023", "2024"],
    datasets: [
      { label: "Plot 1", data: [1000, 1250, 750, 1000], borderColor: "#3674B5", fill: false, tension: 0.4 },
      { label: "Plot 3", data: [400, 600, 1100, 500], borderColor: "#A1E3F9", fill: false, tension: 0.4 },
    ],
  };
  const lineOptions = { /* ... Same as before ... */
    maintainAspectRatio: false,
    plugins: { legend: { display: true, position: "bottom", align: "center", labels: { color: colors.grey[100], usePointStyle: true, pointStyle: "line", }, }, datalabels: { display: false } },
    scales: { x: { ticks: { color: colors.grey[100] }, grid: { color: colors.grey[800] }, }, y: { ticks: { color: colors.grey[100] }, grid: { color: colors.grey[800] }, }, },
  };
  const barData = { /* ... Same as before ... */
    labels: ["Plot 1", "Plot 2", "Plot 3", "Plot 4", "Plot 5"],
    datasets: [
      { label: "Bolivia", data: [1000, 1200, 900, 1100, 1050], backgroundColor: "#28ADE2" },
      { label: "Ecuador", data: [800, 1100, 950, 1200, 1000], backgroundColor: "#A1E3F9" },
      { label: "Madagascar", data: [700, 950, 850, 1000, 900], backgroundColor: "#D1F8EF" },
      { label: "Papua New Guinea", data: [500, 700, 650, 800, 750], backgroundColor: "#3674B5" },
      { label: "Rwanda", data: [300, 500, 400, 600, 500], backgroundColor: "#28ADE2" }
    ]
  };
  const barOptions = { /* ... Same as before ... */
    maintainAspectRatio: false,
    plugins: { legend: { display: true, position: "right", align: "start", labels: { color: colors.grey[100], }, }, datalabels: { display: false } },
    scales: { x: { ticks: { color: colors.grey[100] }, grid: { color: colors.grey[800] }, }, y: { ticks: { color: colors.grey[100] }, grid: { color: colors.grey[800] }, }, },
  };

  // --- Styles ---
  const styles = {
    // Basic layout
    container: {
      display: "flex",
      minHeight: "100vh",
      bgcolor: colors.grey[800],
      marginLeft: isCollapsed ? "80px" : "270px",
      transition: "margin 0.3s ease",
    },
    content: { flex: 1, p: 4, overflowY: 'auto' }, // Added overflow

    // Filter row
    filterRow: {
      marginBottom: theme.spacing(3),
      padding: theme.spacing(2),
      backgroundColor: colors.grey[900], // Background for filter area
      borderRadius: theme.shape.borderRadius,
    },
    filterFormControl: { // Style for filter dropdowns
      minWidth: 180,
      '& .MuiInputLabel-root': { color: colors.grey[300], '&.Mui-focused': { color: colors.blueAccent[300] } },
      '& .MuiOutlinedInput-root': {
        color: colors.grey[100],
        '& .MuiOutlinedInput-notchedOutline': { borderColor: colors.grey[600] }, // Slightly lighter border
        '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: colors.primary[300] },
        '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: colors.blueAccent[400] },
        '& .MuiSelect-icon': { color: colors.grey[300] },
      },
      // Style for the dropdown menu itself
      '& .MuiMenu-paper': { // Target the Paper element of the Menu
          backgroundColor: colors.primary[600], // Darker background for dropdown
          color: colors.grey[100],
      },
      '& .MuiMenuItem-root': { // Style individual menu items
          '&:hover': {
              backgroundColor: colors.primary[500], // Hover effect
          },
          '&.Mui-selected': { // Style selected item
              backgroundColor: colors.blueAccent[700] + '!important', // Use !important cautiously if needed
              color: colors.grey[100],
          },
      },
    },

    // Stats grid (no change)
    statsGrid: {
      display: "grid",
      gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr", md: "repeat(3, 1fr)" },
      gap: 3,
      mt: 3, // Margin top after filters
    },
    card: {
      minHeight: 160, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", p: 2, bgcolor: colors.grey[900],
      position: 'relative', // Needed for absolute positioning of loader
    },
    cardTitle: { mb: 2, fontWeight: "bold", color: colors.grey[100] },
    cardIconBox: { display: "flex", alignItems: "center", gap: 1, color: colors.chartColor[100] }, // Assuming colors.chartColor exists
    body2Text: { fontWeight: "bold", color: colors.chartColor ? colors.chartColor[100] : colors.grey[100] }, // Fallback color

    // Loading overlay specifically for cards
    cardLoadingOverlay: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      zIndex: 2,
      borderRadius: 'inherit', // Match card's border radius
      color: colors.grey[100],
    },

    // Chart grids (no change)
    chartsGridRow2: { display: "grid", gridTemplateColumns: { xs: "1fr", md: "5fr 5fr" }, gap: 3, mt: 4 },
    chartsGridRow3: { display: "grid", gridTemplateColumns: { xs: "1fr", md: "6fr 4fr" }, gap: 3, mt: 4 },
    chartBox: { height: 300, width: "100%" },
    chartTitle: { marginBottom: 3, marginTop: 1, color: colors.chartColor ? colors.chartColor[100] : colors.grey[100] }, // Fallback
    timelineBox: { height: 393.5, width: "100%" }, // Keep height specific if needed
    timelineCardContent: { // Added to allow internal scrolling if needed
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
    },
    timelineScroll: { // Container for the timeline itself
        flexGrow: 1,
        overflowY: 'auto', // Allow timeline to scroll if it exceeds card height
        // Custom scrollbar styling (optional)
        "&::-webkit-scrollbar": { width: "6px" },
        "&::-webkit-scrollbar-track": { background: colors.grey[700] },
        "&::-webkit-scrollbar-thumb": { backgroundColor: colors.grey[500], borderRadius: "10px" },
    }
  };

  return (
    <Box sx={styles.container}>
      <Box sx={styles.content}>

        {/* --- Filter Controls Row --- */}
        <Box sx={styles.filterRow}>
          <Grid container spacing={2} alignItems="center">
            <Grid item xs={12} sm={6} md={4}>
              <FormControl fullWidth variant="outlined" size="small" sx={styles.filterFormControl}>
                <InputLabel id="division-filter-label-dash">Filter Division</InputLabel>
                <Select
                  labelId="division-filter-label-dash"
                  id="division-filter-select-dash"
                  value={filterDivisionId}
                  label="Filter Division"
                  onChange={handleDivisionFilterChange}
                  disabled={loadingFilters || isFetchingFileCount}
                  // Apply MenuProps directly here for dropdown styling
                   MenuProps={{
                      PaperProps: {
                          sx: {
                              backgroundColor: colors.primary[700], // Dark background for dropdown menu
                              color: colors.grey[100],
                              '& .MuiMenuItem-root:hover': {
                                  backgroundColor: colors.primary[500], // Hover color for items
                              },
                              '& .MuiMenuItem-root.Mui-selected': {
                                  backgroundColor: colors.blueAccent[700] + '!important', // Selected item color
                                  color: colors.grey[100],
                              },
                          },
                      },
                  }}
                >
                  <MenuItem value="all"><em>All Divisions</em></MenuItem>
                  {loadingFilters ? (
                    <MenuItem disabled><CircularProgress size={20} sx={{ mr: 1 }} /> Loading...</MenuItem>
                  ) : divisionsList.length === 0 ? (
                    <MenuItem disabled>No divisions found</MenuItem>
                  ) : (
                    divisionsList.map(d => (<MenuItem key={d.id} value={d.id}>{d.name}</MenuItem>))
                  )}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={6} md={4}>
              <FormControl fullWidth variant="outlined" size="small" sx={styles.filterFormControl}>
                <InputLabel id="project-filter-label-dash">Filter Project</InputLabel>
                <Select
                  labelId="project-filter-label-dash"
                  id="project-filter-select-dash"
                  value={filterProjectId}
                  label="Filter Project"
                  onChange={handleProjectFilterChange}
                  disabled={loadingFilters || isFetchingFileCount}
                   MenuProps={{
                      PaperProps: {
                          sx: {
                              backgroundColor: colors.primary[700],
                              color: colors.grey[100],
                              '& .MuiMenuItem-root:hover': {
                                  backgroundColor: colors.primary[500],
                              },
                              '& .MuiMenuItem-root.Mui-selected': {
                                  backgroundColor: colors.blueAccent[700] + '!important',
                                  color: colors.grey[100],
                              },
                          },
                      },
                  }}
                >
                  <MenuItem value="all"><em>All Projects</em></MenuItem>
                  {loadingFilters ? (
                     <MenuItem disabled><CircularProgress size={20} sx={{ mr: 1 }} /> Loading...</MenuItem>
                  ) : filterDivisionId !== 'all' && filteredProjectsForDropdown.length === 0 ? (
                     <MenuItem disabled sx={{ fontStyle: 'italic' }}>No projects in this division</MenuItem>
                  ) : filteredProjectsForDropdown.length === 0 && filterDivisionId === 'all' ? (
                     <MenuItem disabled>No projects found</MenuItem>
                  ) : (
                    filteredProjectsForDropdown.map(p => (
                      <MenuItem key={p.id} value={p.id}>
                        {p.name}
                        {/* Show division only if 'All Divisions' is selected */}
                        {filterDivisionId === 'all' && ` (${p.division_name || 'No Div'})`}
                      </MenuItem>
                    ))
                  )}
                </Select>
              </FormControl>
            </Grid>
            {/* Optional: Add a refresh button or clear filters button here */}
          </Grid>
        </Box>

        {/* Stats Section */}
        <Box sx={styles.statsGrid}>
          {/* Total Members Card */}
          <Card sx={styles.card}>
            {totalMembers === null && ( // Show loader only when null (initial loading)
              <Box sx={styles.cardLoadingOverlay}><CircularProgress color="inherit" size={30}/></Box>
            )}
            <Typography variant="h1" sx={{...styles.cardTitle, visibility: totalMembers === null ? 'hidden' : 'visible'}}>
              {totalMembers === 'Error' ? 'N/A' : totalMembers ?? '-'}
            </Typography>
            <Box sx={{...styles.cardIconBox, visibility: totalMembers === null ? 'hidden' : 'visible'}}>
              <span className="material-symbols-outlined">user_attributes</span>
              <Typography variant="body2" sx={styles.body2Text}>Total Members</Typography>
            </Box>
          </Card>

          {/* Files Uploaded Card (Dynamic) */}
          <Card sx={styles.card}>
             {isFetchingFileCount && ( // Show loader when fetching count
               <Box sx={styles.cardLoadingOverlay}><CircularProgress color="inherit" size={30}/></Box>
             )}
            <Typography variant="h1" sx={{...styles.cardTitle, visibility: isFetchingFileCount ? 'hidden' : 'visible'}}>
              {filesUploadedCount === 'Error' ? 'N/A' : filesUploadedCount ?? '-'}
            </Typography>
            <Box sx={{...styles.cardIconBox, visibility: isFetchingFileCount ? 'hidden' : 'visible'}}>
              <span className="material-symbols-outlined">publish</span>
              <Typography variant="body2" sx={styles.body2Text}>Files Uploaded</Typography>
            </Box>
          </Card>

          {/* Carbon Estimation Card (Static for now) */}
          <Card sx={styles.card}>
            <Typography variant="h1" sx={styles.cardTitle}>5.1 kg</Typography>
            <Box sx={styles.cardIconBox}>
              <span className="material-symbols-outlined">co2</span>
              <Typography variant="body2" sx={styles.body2Text}>Carbon Estimation</Typography>
            </Box>
          </Card>
        </Box>

        {/* Row 2: Pie Chart & Line Chart */}
        <Box sx={styles.chartsGridRow2}>
          <Card>
            <CardContent>
              <Typography variant="h5" sx={styles.chartTitle}>Numbers of Trees</Typography>
              <Box sx={styles.chartBox}><Pie data={pieData} options={pieOptions} /></Box>
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <Typography variant="h5" sx={styles.chartTitle}>Average Tree’s Height & Width</Typography>
              <Box sx={styles.chartBox}><Line data={lineData} options={lineOptions} /></Box>
            </CardContent>
          </Card>
        </Box>

        {/* Row 3: Bar Chart & Timeline */}
        <Box sx={styles.chartsGridRow3}>
          <Card>
            <CardContent>
              <Typography variant="h5" sx={styles.chartTitle}>Tree Structure Count</Typography>
              <Box sx={styles.chartBox}><Bar data={barData} options={barOptions} /></Box>
            </CardContent>
          </Card>

          {/* --- Timeline Card (UPDATED TO USE FETCHED DATA) --- */}
          <Card sx={{...styles.timelineBox, bgcolor: colors.grey[900]}}>
             <CardContent sx={styles.timelineCardContent}>
                 <Typography variant="h5" sx={{...styles.chartTitle, flexShrink: 0 }}>
                     Recent File Uploads
                 </Typography>
                 <Box sx={styles.timelineScroll}>
                     {loadingTimeline ? (
                         <Box display="flex" justifyContent="center" alignItems="center" height="100%">
                             <CircularProgress color="primary" />
                         </Box>
                     ) : recentUploads.length === 0 ? (
                        <Typography sx={{textAlign:'center', color: colors.grey[400], mt: 4}}>
                            {/* Adjust empty message based on filters */}
                            {filterDivisionId !== 'all' || filterProjectId !== 'all'
                                ? 'No recent uploads match the current filters.'
                                : 'No recent uploads found.'
                            }
                        </Typography>
                     ) : (
                         <Timeline position="alternate" sx={{ p: 0, mt: 1 }}>
                             {recentUploads.map((upload, index) => (
                                 <TimelineItem key={upload.id || index}>
                                     <TimelineSeparator>
                                         <TimelineDot color="primary" variant="outlined" />
                                         {index < recentUploads.length - 1 && <TimelineConnector sx={{ bgcolor: colors.primary[500] }} />}
                                     </TimelineSeparator>
                                     <TimelineContent sx={{ py: '12px', px: 2 }}>
                                         <Typography variant="caption" sx={{ color: colors.grey[400] }}>
                                             {upload.date} - {upload.time}
                                         </Typography>
                                         <Typography variant="body2" sx={{ fontWeight: "bold", color: colors.grey[100] }} title={upload.file}>
                                             {upload.file && upload.file.length > 30 ? `${upload.file.substring(0, 27)}...` : upload.file}
                                         </Typography>
                                         <Typography variant="body2" sx={{ color: colors.grey[300], fontSize: '0.75rem' }}>
                                             {upload.context}
                                         </Typography>
                                     </TimelineContent>
                                 </TimelineItem>
                             ))}
                         </Timeline>
                     )}
                 </Box>
             </CardContent>
          </Card>
          {/* --- End Updated Timeline Card --- */}
        </Box>

      </Box>
    </Box>
  );
};

export default Dashboard;