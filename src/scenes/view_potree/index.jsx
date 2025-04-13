import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Box,
    Typography,
    CircularProgress,
    Alert as MuiAlert,
    useTheme,
    Grid,
    Card,
    CardActionArea,
    CardContent,
    Select,
    MenuItem,
    FormControl,
    InputLabel // Make sure InputLabel is imported
} from '@mui/material';
import { Visibility, VisibilityOff, ScatterPlot } from '@mui/icons-material';
import { tokens } from "../../theme";

// Accept isCollapsed prop for layout consistency
const ViewPotreePage = ({ isCollapsed }) => {
    const theme = useTheme();
    const colors = tokens(theme.palette.mode);
    const navigate = useNavigate();

    // --- State ---
    const [files, setFiles] = useState([]); // Holds ALL fetched files
    const [isLoadingFiles, setIsLoadingFiles] = useState(true);
    const [errorFiles, setErrorFiles] = useState(null);
    const [projects, setProjects] = useState([]); // List of projects
    const [selectedProjectId, setSelectedProjectId] = useState('all'); // Filter state
    const [isLoadingProjects, setIsLoadingProjects] = useState(true);
    const [errorProjects, setErrorProjects] = useState(null);

    // --- Fetch Data (Files and Projects) ---
    useEffect(() => {
        const storedToken = localStorage.getItem('authToken');

        if (!storedToken) {
            setErrorFiles("Authentication required. Please log in.");
            setErrorProjects("Authentication required.");
            setIsLoadingFiles(false);
            setIsLoadingProjects(false);
            return;
        }

        const fetchFiles = async () => {
            setIsLoadingFiles(true);
            setErrorFiles(null);
            try {
                const response = await fetch('http://localhost:5000/api/files', {
                    headers: { 'Authorization': `Bearer ${storedToken}`, 'Content-Type': 'application/json' }
                });
                if (!response.ok) {
                    let errorMessage = `HTTP error fetching files! status: ${response.status}`;
                     try { const errorData = await response.json(); errorMessage = errorData.message || errorMessage; } catch (e) { /* ignore if not json */ }
                     if (response.status === 401 || response.status === 403) errorMessage = "Session invalid. Please log in.";
                     throw new Error(errorMessage);
                 }
                const fetchedFiles = await response.json();
                fetchedFiles.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
                setFiles(fetchedFiles || []);
            } catch (err) {
                console.error("Failed to fetch files:", err);
                setErrorFiles(err.message || "An error occurred while fetching files.");
                setFiles([]);
            } finally {
                setIsLoadingFiles(false);
            }
        };

        const fetchProjects = async () => {
            setIsLoadingProjects(true);
            setErrorProjects(null);
            try {
                const response = await fetch('http://localhost:5000/api/projects', {
                    headers: { 'Authorization': `Bearer ${storedToken}` }
                });
                 if (!response.ok) {
                     let errorMessage = `HTTP error fetching projects! status: ${response.status}`;
                     try { const errorData = await response.json(); errorMessage = errorData.message || errorMessage; } catch (e) { /* ignore if not json */ }
                     if (response.status === 401 || response.status === 403) errorMessage = "Session invalid. Please log in.";
                     throw new Error(errorMessage);
                 }
                const data = await response.json();
                setProjects(data || []);
            } catch (err) {
                console.error("Failed to fetch projects:", err);
                setErrorProjects(err.message || "An error occurred while fetching projects.");
            } finally {
                setIsLoadingProjects(false);
            }
        };

        Promise.all([fetchFiles(), fetchProjects()]);

    }, []); // Runs once on mount

    // Handle card click
    const handleCardClick = (file) => {
        if (file.potreeUrl) {
            const potreeViewPath = `/potree?url=${encodeURIComponent(file.potreeUrl)}`;
            navigate(potreeViewPath);
        }
    };

    // Handle project filter change
    const handleProjectChange = (event) => {
        setSelectedProjectId(event.target.value);
    };

    // Filter cards based on selected project
    const filteredCards = useMemo(() => {
        if (selectedProjectId === 'all') {
            return files;
        }
        if (selectedProjectId === 'unassigned') {
            return files.filter(file => file.project_id === null);
        }
        return files.filter(file => file.project_id === parseInt(selectedProjectId, 10));
    }, [files, selectedProjectId]);

    // --- Styles ---
    const styles = {
        container: {
            display: "flex",
            flexDirection: 'column',
            // Adjust height based on your Topbar's height (e.g., 64px, 70px, 80px)
            minHeight: "calc(100vh - 80px)", // Example: Assuming Topbar is 80px
            paddingTop: '10px', // Reduced padding below Topbar
            marginLeft: isCollapsed ? "80px" : "270px",
            transition: "margin-left 0.3s ease",
            overflow: 'hidden', // Prevent scrollbars on main container
        },
        content: {
            flex: 1, // Allow content to grow
            padding: theme.spacing(2),
            paddingTop: 0, // Remove top padding to use header box padding
            overflowY: 'auto', // Allow content area (grid) to scroll if needed
            display: 'flex',
            flexDirection: 'column',
        },
        headerBox: {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingTop: theme.spacing(1), // Restore some padding here
            paddingBottom: theme.spacing(2), // Space below header
            flexShrink: 0, // Prevent header from shrinking
        },
        filterControl: {
             minWidth: 200,
             maxWidth: 300,
        },
        gridContainer: {
            paddingTop: theme.spacing(1),
        },
        // --- Adjusted Card Style ---
        card: {
            backgroundColor: '#ffffff',
            // Removed height: '30%'
            height: 120, // Set fixed height (adjust 180px as needed)
            display: 'flex',
            flexDirection: 'column',
        },
        // --- End Adjusted Card Style ---
        cardAvailable: {
             borderLeft: `5px solid #28ade2`,
            '&:hover': { boxShadow: `0px 4px 15px 0px rgba(0, 0, 0, 0.15)`, }
        },
        cardUnavailable: {
            opacity: 0.65,
            cursor: 'default',
            borderLeft: `5px solid ${colors.grey[700]}`,
        },
        cardContent: {
            flexGrow: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', paddingBottom: '16px !important' // Ensure padding below status
        },
         cardTitle: {
            color: colors.grey[100], fontWeight: 'bold', marginBottom: theme.spacing(1),
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        },
        cardText: { color: colors.grey[300], fontSize: '0.85rem', },
        cardStatus: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end', // Pushes content to the right
            marginTop: theme.spacing(1.5),
            fontSize: '0.9rem',
        },
        iconAvailable: { color: '#28ade2', marginRight: theme.spacing(1), },
        iconUnavailable: { color: colors.grey[500], marginRight: theme.spacing(1), },
        loadingErrorContainer: { // Center loading/error/no files message
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            flexGrow: 1, // Take up available space
            padding: theme.spacing(4)
        }
    };

    // --- Combined Loading/Error ---
    const isLoading = isLoadingFiles || isLoadingProjects;
    const error = errorFiles || errorProjects; // Show first error encountered

    return (
        <Box sx={styles.container}>
            <Box sx={styles.content}>
                {/* --- Header with Title and Filter --- */}
                <Box sx={styles.headerBox}>
                    <Typography variant="h4" sx={{ color: colors.grey[100], mr: 2 /* Add margin if title is long */ }}>
                        Tree Cloud Viewer
                    </Typography>

                    <FormControl size="small" sx={styles.filterControl}>
                        <InputLabel id="project-card-filter-label" sx={{ color: colors.grey[300] }}>Filter by Project</InputLabel>
                        <Select
                            labelId="project-card-filter-label"
                            id="project-card-filter-select"
                            value={selectedProjectId}
                            label="Filter by Project"
                            onChange={handleProjectChange}
                            disabled={isLoading} // Disable if loading anything
                            sx={{
                                color: colors.grey[100],
                                '.MuiOutlinedInput-notchedOutline': { borderColor: colors.grey[700] },
                                '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: colors.primary[400] },
                                '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: colors.grey[500] },
                                '.MuiSvgIcon-root ': { fill: colors.grey[300] + " !important" }
                            }}
                            MenuProps={{
                                PaperProps: {
                                    sx: {
                                        backgroundColor: colors.primary[800], color: colors.grey[100],
                                        '& .MuiMenuItem-root:hover': { backgroundColor: colors.primary[700] },
                                        '& .Mui-selected': { backgroundColor: colors.primary[600] + ' !important' },
                                    },
                                },
                            }}
                        >
                            <MenuItem value="all">All Projects</MenuItem>
                            <MenuItem value="unassigned">Unassigned Files</MenuItem>
                            {/* You might want a Divider here: import { Divider } from '@mui/material'; <Divider sx={{ my: 0.5 }} /> */}
                            {projects.map((project) => (
                                <MenuItem key={project.id} value={project.id.toString()}>
                                    {project.name}
                                </MenuItem>
                            ))}
                        </Select>
                         {errorProjects && !isLoadingProjects && <Typography variant="caption" color="error" sx={{ position: 'absolute', bottom: '-15px', right: 0 }}>Could not load projects</Typography>}
                    </FormControl>
                </Box>
                {/* --- End Header --- */}


                {/* --- Main Content Area --- */}
                {isLoading && (
                    <Box sx={styles.loadingErrorContainer}>
                        <CircularProgress />
                    </Box>
                )}

                {error && !isLoading && (
                     <Box sx={styles.loadingErrorContainer}>
                        <MuiAlert severity="error" sx={{ width: '100%', justifyContent: 'center' }}>{error}</MuiAlert>
                     </Box>
                )}

                {/* Grid for Cards */}
                {!isLoading && !error && filteredCards.length > 0 && (
                    <Grid container spacing={3} sx={styles.gridContainer}>
                        {filteredCards.map((file) => (
                            // Force 2 columns from 'sm' breakpoint up
                            <Grid item xs={12} sm={6} key={file.id}>
                                <Card sx={{ ...styles.card, ...(file.potreeUrl ? styles.cardAvailable : styles.cardUnavailable) }}>
                                    {file.potreeUrl ? (
                                        <CardActionArea onClick={() => handleCardClick(file)} sx={{ flexGrow: 1, display: 'flex' }}>
                                            <CardContent sx={styles.cardContent}>
                                                {/* Top part of content */}
                                                <Box>
                                                    <Typography variant="h6" sx={styles.cardTitle} title={file.name || 'Unnamed File'}>
                                                        {file.name || 'Unnamed File'}
                                                    </Typography>
                                                    <Typography sx={styles.cardText}>
                                                        Project: {file.projectName || 'Unassigned'}
                                                    </Typography>
                                                </Box>
                                                {/* Status part at the bottom */}
                                                <Box sx={styles.cardStatus}>
                                                    <ScatterPlot sx={styles.iconAvailable} />
                                                    <Typography variant="body2" sx={{ color: '#28ade2' }}>Click to view</Typography>
                                                </Box>
                                            </CardContent>
                                        </CardActionArea>
                                    ) : (
                                        <CardContent sx={styles.cardContent}>
                                            {/* Top part of content */}
                                             <Box>
                                                <Typography variant="h6" sx={styles.cardTitle} title={file.name || 'Unnamed File'}>
                                                    {file.name || 'Unnamed File'}
                                                </Typography>
                                                <Typography sx={styles.cardText}>
                                                    Project: {file.projectName || 'Unassigned'}
                                                </Typography>
                                            </Box>
                                            {/* Status part at the bottom */}
                                            <Box sx={styles.cardStatus}>
                                                <VisibilityOff sx={styles.iconUnavailable} />
                                                <Typography variant="body2" sx={{ color: colors.grey[500] }}>Potree view not available</Typography>
                                            </Box>
                                        </CardContent>
                                    )}
                                </Card>
                            </Grid>
                        ))}
                    </Grid>
                )}

                 {/* Message when no cards match filter (and not loading/error) */}
                 {!isLoading && !error && filteredCards.length === 0 && (
                     <Box sx={styles.loadingErrorContainer}>
                        <Typography sx={{ color: colors.grey[300] }}>
                             {files.length === 0 ? 'No files found.' : 'No files match the selected project filter.'}
                        </Typography>
                    </Box>
                 )}

            </Box>
        </Box>
    );
};

export default ViewPotreePage;