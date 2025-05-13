import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Box, Card, CardContent, Typography, useTheme, Grid,
  FormControl, InputLabel, Select, MenuItem, CircularProgress
} from "@mui/material";
import { Pie, Line, Bar } from "react-chartjs-2";
import { Chart as ChartJS, ArcElement, Tooltip, Legend, LineElement, LinearScale, PointElement, CategoryScale, BarElement } from "chart.js";
import ChartDataLabels from "chartjs-plugin-datalabels";
import { Timeline, TimelineItem, TimelineSeparator, TimelineConnector, TimelineContent, TimelineDot } from "@mui/lab";
import { tokens } from "../../theme";
import axios from 'axios';

const API_BASE_URL = "http://localhost:5000/api";

ChartJS.register(ArcElement, Tooltip, Legend, LineElement, LinearScale, PointElement, CategoryScale, BarElement, ChartDataLabels);

const Dashboard = ({ isCollapsed }) => {
  const theme = useTheme();
  const colors = tokens(theme.palette.mode);

  const [totalMembers, setTotalMembers] = useState(null);
  const [filesUploadedCount, setFilesUploadedCount] = useState(null);
  const [isFetchingFileCount, setIsFetchingFileCount] = useState(false);

  const [divisionsList, setDivisionsList] = useState([]);
  const [projectsList, setProjectsList] = useState([]);
  const [plotsList, setPlotsList] = useState([]);
  const [loadingFilters, setLoadingFilters] = useState(false);
  const [loadingPlots, setLoadingPlots] = useState(false);

  const [filterDivisionId, setFilterDivisionId] = useState('all');
  const [filterProjectId, setFilterProjectId] = useState('all');
  const [filterPlotName, setFilterPlotName] = useState('all');

  const [recentUploads, setRecentUploads] = useState([]);
  const [loadingTimeline, setLoadingTimeline] = useState(true);

  // --- Condition to enable plot filter ---
  const canFetchPlots = useMemo(() => {
    return filterDivisionId !== 'all' && filterProjectId !== 'all' && filterProjectId !== 'unassigned';
  }, [filterDivisionId, filterProjectId]);

  // Fetch User Count
  useEffect(() => {
    const fetchUserCount = async () => {
      const token = localStorage.getItem('authToken');
      if (!token) { setTotalMembers('Error'); return; }
      try {
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

  // Fetch Divisions and Projects for Filters
  const fetchFilterData = useCallback(async () => {
    const token = localStorage.getItem('authToken');
    if (!token) {
      setDivisionsList([]); setProjectsList([]); return;
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
      setDivisionsList([]); setProjectsList([]);
    } finally {
      setLoadingFilters(false);
    }
  }, []);

  useEffect(() => {
    fetchFilterData();
  }, [fetchFilterData]);

  // Fetch Plot Names for Filter
  const fetchPlotsList = useCallback(async (divisionId, projectId) => {
    const token = localStorage.getItem('authToken');
    if (!token) {
      setPlotsList([]); return;
    }
    setLoadingPlots(true);
    setPlotsList([]); // Clear previous plots
    try {
      // Backend expects actual IDs, not 'all' for filtering plots
      const params = {
        divisionId: divisionId, // Will be the actual ID due to canFetchPlots condition
        projectId: projectId    // Will be the actual ID
      };

      const response = await axios.get(`${API_BASE_URL}/files/plots`, {
        headers: { 'Authorization': `Bearer ${token}` },
        params: params
      });
      setPlotsList(response.data.plots || []);
    } catch (error) {
      console.error("Failed to fetch plot names:", error.response?.data?.message || error.message);
      setPlotsList([]);
    } finally {
      setLoadingPlots(false);
    }
  }, []);

  // Effect to fetch plot names when division or project filters change
  useEffect(() => {
    if (canFetchPlots && !loadingFilters) { // Only fetch if a specific division AND project are selected
      fetchPlotsList(filterDivisionId, filterProjectId);
    } else {
      setPlotsList([]); // Clear plots if condition is not met
      setFilterPlotName('all'); // Reset plot filter selection
    }
  }, [filterDivisionId, filterProjectId, loadingFilters, fetchPlotsList, canFetchPlots]);


  // Fetch Recent Uploads for Timeline
  const fetchRecentUploads = useCallback(async (divisionId, projectId, plotName) => {
    setLoadingTimeline(true);
    const token = localStorage.getItem('authToken');
    if (!token) {
      setRecentUploads([]); setLoadingTimeline(false); return;
    }
    try {
      const params = { limit: 5 };
      if (divisionId && divisionId !== 'all') params.divisionId = divisionId;
      if (projectId && projectId !== 'all' && projectId !== 'unassigned') params.projectId = projectId;
      else if (projectId === 'unassigned') params.projectId = 'unassigned'; // Handle unassigned case for backend

      // Only add plotName to params if it's specific and plots can be fetched
      if (plotName && plotName !== 'all' && canFetchPlots) params.plotName = plotName;

      console.log("Fetching recent uploads with params:", params);

      const response = await axios.get(`${API_BASE_URL}/files/recent`, {
        headers: { 'Authorization': `Bearer ${token}` },
        params: params
      });
      setRecentUploads(response.data || []);
    } catch (error) {
      console.error("Failed to fetch recent uploads:", error.response?.data?.message || error.message);
      setRecentUploads([]);
    } finally {
      setLoadingTimeline(false);
    }
  }, [canFetchPlots]); // Add canFetchPlots dependency

  // Effect for Timeline Load & Update
  useEffect(() => {
    // Fetch timeline data if filters are not loading.
    // loadingPlots is implicitly handled by canFetchPlots for plotName parameter.
    if (!loadingFilters) {
      fetchRecentUploads(filterDivisionId, filterProjectId, filterPlotName);
    }
  }, [filterDivisionId, filterProjectId, filterPlotName, loadingFilters, fetchRecentUploads]);


  // Fetch Files Uploaded Count
  const fetchFilesUploadedCount = useCallback(async (divisionId, projectId, plotName) => {
    const token = localStorage.getItem('authToken');
    if (!token) {
      setFilesUploadedCount('Error'); return;
    }
    setIsFetchingFileCount(true);
    setFilesUploadedCount(null);

    try {
      const params = {};
      if (divisionId && divisionId !== 'all') params.divisionId = divisionId;
      if (projectId && projectId !== 'all' && projectId !== 'unassigned') params.projectId = projectId;
      else if (projectId === 'unassigned') params.projectId = 'unassigned'; // Handle unassigned

      // Only add plotName to params if it's specific and plots can be fetched
      if (plotName && plotName !== 'all' && canFetchPlots) params.plotName = plotName;


      const response = await axios.get(`${API_BASE_URL}/files/count`, {
        headers: { 'Authorization': `Bearer ${token}` },
        params: params
      });
      setFilesUploadedCount(response.data.count);
    } catch (error) {
      console.error("Failed to fetch files uploaded count:", error.response?.data?.message || error.message);
      setFilesUploadedCount('Error');
    } finally {
      setIsFetchingFileCount(false);
    }
  }, [canFetchPlots]); // Add canFetchPlots dependency

  // Effect to fetch file count when filters change
  useEffect(() => {
    if (!loadingFilters) {
      fetchFilesUploadedCount(filterDivisionId, filterProjectId, filterPlotName);
    }
  }, [filterDivisionId, filterProjectId, filterPlotName, loadingFilters, fetchFilesUploadedCount]);

  // Filter Change Handlers
  const handleDivisionFilterChange = (event) => {
    const newDivisionId = event.target.value;
    setFilterDivisionId(newDivisionId);
    setFilterProjectId('all');
    setFilterPlotName('all');
    // setPlotsList([]); // Plots will be cleared by the useEffect for fetchPlotsList
  };

  const handleProjectFilterChange = (event) => {
    const newProjectId = event.target.value;
    setFilterProjectId(newProjectId);
    setFilterPlotName('all');
    // setPlotsList([]); // Plots will be cleared by the useEffect for fetchPlotsList
  };

  const handlePlotFilterChange = (event) => {
    setFilterPlotName(event.target.value);
  };

  // Memoized Filtered Project List for Dropdown
  const filteredProjectsForDropdown = useMemo(() => {
    if (loadingFilters) return [];
    if (filterDivisionId === 'all') return projectsList; // Show all projects if 'All Divisions' selected
    const numericDivisionId = parseInt(filterDivisionId, 10);
    if (isNaN(numericDivisionId)) return []; // Should not happen if filterDivisionId is 'all' or a number
    return projectsList.filter(p => p.division_id === numericDivisionId);
  }, [projectsList, filterDivisionId, loadingFilters]);


  const pieData = { /* ... Same as before ... */
    labels: ["Plot 1", "Plot 2", "Plot 3", "Plot 4", "Plot 5"],
    datasets: [ { data: [10, 8, 4, 6, 4], backgroundColor: ["#28ADE2", "#3674B5", "#578FCA", "#A1E3F9", "#D1F8EF"],}, ],
  };
  const pieOptions = { /* ... Same as before ... */
    plugins: { legend: { display: true, position: "left", labels: { color: colors.grey[100], usePointStyle: true, boxWidth: 10, padding: 10, }, }, datalabels: { color: (context) => { const pal = ["#fff", "#fff", "#fff", "#666", "#333"]; return pal[context.dataIndex] || "#fff"; }, font: { size: 14 }, formatter: (value) => `${value}`, }, }, elements: { arc: { borderWidth: 0, }, }, cutout: "0%", maintainAspectRatio: false,
  };
  const lineData = { /* ... Same as before ... */
    labels: ["2021", "2022", "2023", "2024"],
    datasets: [ { label: "Plot 1", data: [1000, 1250, 750, 1000], borderColor: "#3674B5", fill: false, tension: 0.4 }, { label: "Plot 3", data: [400, 600, 1100, 500], borderColor: "#A1E3F9", fill: false, tension: 0.4 }, ],
  };
  const lineOptions = { /* ... Same as before ... */
    maintainAspectRatio: false, plugins: { legend: { display: true, position: "bottom", align: "center", labels: { color: colors.grey[100], usePointStyle: true, pointStyle: "line", }, }, datalabels: { display: false } }, scales: { x: { ticks: { color: colors.grey[100] }, grid: { color: colors.grey[800] }, }, y: { ticks: { color: colors.grey[100] }, grid: { color: colors.grey[800] }, }, },
  };
  const barData = { /* ... Same as before ... */
    labels: ["Plot 1", "Plot 2", "Plot 3", "Plot 4", "Plot 5"],
    datasets: [ { label: "Bolivia", data: [1000, 1200, 900, 1100, 1050], backgroundColor: "#28ADE2" }, { label: "Ecuador", data: [800, 1100, 950, 1200, 1000], backgroundColor: "#A1E3F9" }, { label: "Madagascar", data: [700, 950, 850, 1000, 900], backgroundColor: "#D1F8EF" }, { label: "Papua New Guinea", data: [500, 700, 650, 800, 750], backgroundColor: "#3674B5" }, { label: "Rwanda", data: [300, 500, 400, 600, 500], backgroundColor: "#28ADE2" } ]
  };
  const barOptions = { /* ... Same as before ... */
    maintainAspectRatio: false, plugins: { legend: { display: true, position: "right", align: "start", labels: { color: colors.grey[100], }, }, datalabels: { display: false } }, scales: { x: { ticks: { color: colors.grey[100] }, grid: { color: colors.grey[800] }, }, y: { ticks: { color: colors.grey[100] }, grid: { color: colors.grey[800] }, }, },
  };

  const styles = { // Keep your existing styles
    container: { display: "flex", minHeight: "100vh", bgcolor: colors.grey[800], marginLeft: isCollapsed ? "80px" : "270px", transition: "margin 0.3s ease", },
    content: { flex: 1, p: 3, overflowY: 'auto' },
    filterRow: { marginBottom: theme.spacing(3), padding: theme.spacing(2), backgroundColor: colors.grey[900], borderRadius: theme.shape.borderRadius, },
    filterFormControl: { minWidth: 180, '& .MuiInputLabel-root': { color: colors.grey[300], '&.Mui-focused': { color: colors.blueAccent[300] } }, '& .MuiOutlinedInput-root': { color: colors.grey[100], '& .MuiOutlinedInput-notchedOutline': { borderColor: colors.grey[600] }, '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: colors.primary[300] }, '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: colors.blueAccent[400] }, '& .MuiSelect-icon': { color: colors.grey[300] }, }, '& .MuiMenu-paper': { backgroundColor: colors.primary[600], color: colors.grey[100], }, '& .MuiMenuItem-root': { '&:hover': { backgroundColor: colors.primary[500], }, '&.Mui-selected': { backgroundColor: colors.blueAccent[700] + '!important', color: colors.grey[100], }, }, },
    statsGrid: { display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(3, 1fr)" }, gap: 2, mt: 3, },
    card: { minHeight: 150, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", p: 2, bgcolor: colors.grey[900], position: 'relative', },
    cardTitle: { mb: 1, fontWeight: "bold", color: colors.grey[100] },
    cardIconBox: { display: "flex", alignItems: "center", gap: 1, color: colors.blueAccent[400] },
    body2Text: { fontWeight: "bold", color: colors.blueAccent[300] },
    cardLoadingOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0, 0, 0, 0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 2, borderRadius: 'inherit', color: colors.grey[100], },
    chartsGridRow2: { display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, gap: 2, mt: 3 },
    chartsGridRow3: { display: "grid", gridTemplateColumns: { xs: "1fr", lg: "3fr 2fr" }, gap: 2, mt: 3 },
    chartBox: { height: 280, width: "100%" },
    chartTitle: { marginBottom: 2, marginTop: 1, color: colors.grey[100] },
    timelineBox: { height: 370, width: "100%", bgcolor: colors.grey[900] },
    timelineCardContent: { height: '100%', display: 'flex', flexDirection: 'column', },
    timelineScroll: { flexGrow: 1, overflowY: 'auto', "&::-webkit-scrollbar": { width: "6px" }, "&::-webkit-scrollbar-track": { background: colors.grey[700] }, "&::-webkit-scrollbar-thumb": { backgroundColor: colors.grey[500], borderRadius: "10px" }, }
  };

  const commonMenuProps = {
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
        '& .MuiMenuItem-root.Mui-disabled': {
            opacity: 0.5,
            color: colors.grey[500],
        }
      },
    },
  };

  return (
    <Box sx={styles.container}>
      <Box sx={styles.content}>

        <Box sx={styles.filterRow}>
          <Grid container spacing={2} alignItems="center">
            {/* Division Filter */}
            <Grid item xs={12} sm={6} md={4} lg={3}>
              <FormControl fullWidth variant="outlined" size="small" sx={styles.filterFormControl}>
                <InputLabel id="division-filter-label-dash">Filter Division</InputLabel>
                <Select
                  labelId="division-filter-label-dash"
                  value={filterDivisionId}
                  label="Filter Division"
                  onChange={handleDivisionFilterChange}
                  disabled={loadingFilters || isFetchingFileCount || loadingPlots} // loadingPlots added here
                  MenuProps={commonMenuProps}
                >
                  <MenuItem value="all"><em>All Divisions</em></MenuItem>
                  {loadingFilters ? (
                    <MenuItem disabled><CircularProgress size={20} sx={{ mr: 1 }} /> Loading...</MenuItem>
                  ) : divisionsList.length === 0 ? (
                    <MenuItem disabled>No divisions</MenuItem>
                  ) : (
                    divisionsList.map(d => (<MenuItem key={d.id} value={d.id}>{d.name}</MenuItem>))
                  )}
                </Select>
              </FormControl>
            </Grid>
            {/* Project Filter */}
            <Grid item xs={12} sm={6} md={4} lg={3}>
              <FormControl fullWidth variant="outlined" size="small" sx={styles.filterFormControl}>
                <InputLabel id="project-filter-label-dash">Filter Project</InputLabel>
                <Select
                  labelId="project-filter-label-dash"
                  value={filterProjectId}
                  label="Filter Project"
                  onChange={handleProjectFilterChange}
                  disabled={
                    loadingFilters || 
                    isFetchingFileCount || 
                    loadingPlots || // loadingPlots added here
                    (filterDivisionId === 'all' && projectsList.length === 0 && !loadingFilters) // Disable if no projects and all divisions
                  }
                  MenuProps={commonMenuProps}
                >
                  <MenuItem value="all"><em>All Projects</em></MenuItem>
                  {loadingFilters ? (
                     <MenuItem disabled><CircularProgress size={20} sx={{ mr: 1 }} /> Loading...</MenuItem>
                  ) : filteredProjectsForDropdown.length === 0 && filterDivisionId !== 'all' ? ( // More specific condition
                     <MenuItem disabled sx={{ fontStyle: 'italic' }}>
                       No projects in division
                     </MenuItem>
                  ) : projectsList.length === 0 && filterDivisionId === 'all' && !loadingFilters ? ( // Global no projects
                     <MenuItem disabled sx={{ fontStyle: 'italic' }}>
                       No projects available
                     </MenuItem>
                  ): (
                    filteredProjectsForDropdown.map(p => (
                      <MenuItem key={p.id} value={p.id}>
                        {p.name}
                        {filterDivisionId === 'all' && ` (${p.division_name || 'No Div'})`}
                      </MenuItem>
                    ))
                  )}
                </Select>
              </FormControl>
            </Grid>
            {/* Plot Filter - MODIFIED */}
            <Grid item xs={12} sm={6} md={4} lg={3}>
              <FormControl fullWidth variant="outlined" size="small" sx={styles.filterFormControl}>
                <InputLabel id="plot-filter-label-dash">Filter Plot</InputLabel>
                <Select
                  labelId="plot-filter-label-dash"
                  value={filterPlotName}
                  label="Filter Plot"
                  onChange={handlePlotFilterChange}
                  disabled={
                    !canFetchPlots || // Main condition: disable if division OR project not selected
                    loadingPlots || 
                    isFetchingFileCount
                  }
                  MenuProps={commonMenuProps}
                >
                  <MenuItem value="all"><em>All Plots</em></MenuItem>
                  {loadingPlots ? (
                    <MenuItem disabled><CircularProgress size={20} sx={{ mr: 1 }} /> Loading plots...</MenuItem>
                  ) : !canFetchPlots ? ( // If plots cannot be fetched (due to div/proj selection)
                    <MenuItem disabled sx={{ fontStyle: 'italic' }}>
                        Select project to see plots
                    </MenuItem>
                  ) : plotsList.length === 0 ? ( // If plots can be fetched, but none exist for selection
                    <MenuItem disabled sx={{ fontStyle: 'italic' }}>
                        No plots for this project
                    </MenuItem>
                  ) : (
                    plotsList.map(plot => (
                      <MenuItem key={plot} value={plot}>{plot}</MenuItem>
                    ))
                  )}
                </Select>
              </FormControl>
            </Grid>
          </Grid>
        </Box>

        {/* Stats Section */}
        <Box sx={styles.statsGrid}>
          <Card sx={styles.card}>
            {totalMembers === null && (<Box sx={styles.cardLoadingOverlay}><CircularProgress color="inherit" size={30}/></Box>)}
            <Typography variant="h1" sx={{...styles.cardTitle, visibility: totalMembers === null ? 'hidden' : 'visible'}}>
              {totalMembers === 'Error' ? 'N/A' : totalMembers ?? '-'}
            </Typography>
            <Box sx={{...styles.cardIconBox, visibility: totalMembers === null ? 'hidden' : 'visible'}}>
              <span className="material-symbols-outlined">group</span>
              <Typography variant="body2" sx={styles.body2Text}>Total Members</Typography>
            </Box>
          </Card>

          <Card sx={styles.card}>
             {isFetchingFileCount && (<Box sx={styles.cardLoadingOverlay}><CircularProgress color="inherit" size={30}/></Box>)}
            <Typography variant="h1" sx={{...styles.cardTitle, visibility: isFetchingFileCount ? 'hidden' : 'visible'}}>
              {filesUploadedCount === 'Error' ? 'N/A' : filesUploadedCount ?? '-'}
            </Typography>
            <Box sx={{...styles.cardIconBox, visibility: isFetchingFileCount ? 'hidden' : 'visible'}}>
              <span className="material-symbols-outlined">upload_file</span>
              <Typography variant="body2" sx={styles.body2Text}>Files Uploaded</Typography>
            </Box>
          </Card>

          <Card sx={styles.card}>
            <Typography variant="h1" sx={styles.cardTitle}>5.1 kg</Typography>
            <Box sx={styles.cardIconBox}>
              <span className="material-symbols-outlined">eco</span>
              <Typography variant="body2" sx={styles.body2Text}>Carbon Estimation</Typography>
            </Box>
          </Card>
        </Box>

        {/* Row 2: Pie Chart & Line Chart */}
        <Box sx={styles.chartsGridRow2}>
          <Card>
            <CardContent>
              <Typography variant="h5" sx={styles.chartTitle}>Trees per Plot (Sample)</Typography>
              <Box sx={styles.chartBox}><Pie data={pieData} options={pieOptions} /></Box>
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <Typography variant="h5" sx={styles.chartTitle}>Avg. Tree Dimensions (Sample)</Typography>
              <Box sx={styles.chartBox}><Line data={lineData} options={lineOptions} /></Box>
            </CardContent>
          </Card>
        </Box>

        {/* Row 3: Bar Chart & Timeline */}
        <Box sx={styles.chartsGridRow3}>
          <Card>
            <CardContent>
              <Typography variant="h5" sx={styles.chartTitle}>Tree Structure Count (Sample)</Typography>
              <Box sx={styles.chartBox}><Bar data={barData} options={barOptions} /></Box>
            </CardContent>
          </Card>

          <Card sx={styles.timelineBox}>
             <CardContent sx={styles.timelineCardContent}>
                 <Typography variant="h5" sx={{...styles.chartTitle, flexShrink: 0 }}>
                     Recent File Uploads
                 </Typography>
                 <Box sx={styles.timelineScroll}>
                     {loadingTimeline ? (
                         <Box display="flex" justifyContent="center" alignItems="center" height="100%"><CircularProgress /></Box>
                     ) : recentUploads.length === 0 ? (
                        <Typography sx={{textAlign:'center', color: colors.grey[400], mt: 4, p:1}}>
                            {filterDivisionId !== 'all' || filterProjectId !== 'all' || (filterPlotName !== 'all' && canFetchPlots)
                                ? 'No recent uploads match filters.'
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
                                     <TimelineContent sx={{ py: '10px', px: 2 }}>
                                         <Typography variant="caption" sx={{ color: colors.grey[400] }}>
                                             {upload.date} - {upload.time}
                                         </Typography>
                                         <Typography variant="body2" sx={{ fontWeight: "bold", color: colors.grey[100], whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={upload.file}>
                                             {upload.file}
                                         </Typography>
                                         <Typography variant="caption" sx={{ color: colors.grey[300], display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={upload.context}>
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
        </Box>
      </Box>
    </Box>
  );
};

export default Dashboard;