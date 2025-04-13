import React, { useState, useEffect } from 'react';
import { Box, Card, CardContent, Typography, useTheme } from "@mui/material";
import { Pie, Line, Bar } from "react-chartjs-2";
import { Chart as ChartJS, ArcElement, Tooltip, Legend, LineElement, LinearScale, PointElement, CategoryScale, BarElement } from "chart.js";
import ChartDataLabels from "chartjs-plugin-datalabels";
import { Timeline, TimelineItem, TimelineSeparator, TimelineConnector, TimelineContent, TimelineDot } from "@mui/lab";
import { tokens } from "../../theme"; // Import theme tokens

ChartJS.register(ArcElement, Tooltip, Legend, LineElement, LinearScale, PointElement, CategoryScale, BarElement, ChartDataLabels);

const Dashboard = ({ isCollapsed }) => {

  const theme = useTheme();
  const colors = tokens(theme.palette.mode); // Get colors from theme

  // --- State to hold the user count ---
  const [totalMembers, setTotalMembers] = useState(null); // Initialize as null or a loading indicator like '...'
  const [fetchError, setFetchError] = useState(null);     // Optional: state for error handling

  // --- Fetch user count when component mounts ---
  useEffect(() => {
    const fetchUserCount = async () => {

      const token = localStorage.getItem('authToken');

      // 2. Check if the token exists
      if (!token) {
        console.error("Authentication token not found.");
        setFetchError("Not authenticated."); // Set appropriate error
        setTotalMembers('Error');
        // Optional: redirect to login or call logout function here
        return; // Stop execution if no token
      }

      try {
        // Replace with your actual backend URL if different
        const response = await fetch('http://localhost:5000/api/users/count', {
          method: 'GET', // Explicitly specify method (optional for GET but good practice)
          headers: {
            'Content-Type': 'application/json', // Keep content type if needed (though GET usually doesn't send body)
            'Authorization': `Bearer ${token}` // <-- THE IMPORTANT PART
          }
        });

        if (!response.ok) {
          // Handle specific auth errors if possible
          if (response.status === 401 || response.status === 403) {
             console.error("Authorization failed.");
             setFetchError("Authorization failed.");
             // Optional: Clear token and redirect?
             // localStorage.removeItem('authToken');
             // window.location.href = '/login'; // Force redirect
          } else {
            // Handle other HTTP errors
             throw new Error(`HTTP error! status: ${response.status}`);
          }
          setTotalMembers('Error'); // Set error state
          return; // Stop if response not OK
        }

        const data = await response.json();
        setTotalMembers(data.count);
        setFetchError(null);

      } catch (error) {
        // Catch network errors or errors thrown above
        console.error("Failed to fetch user count:", error);
        setFetchError("Failed to load member count.");
        setTotalMembers('Error');
      }
    };

    fetchUserCount(); // Call the fetch function

  }, []); // Empty dependency array means this runs only once on mount

  const pieData = {
    labels: ["Plot 1", "Plot 2", "Plot 3", "Plot 4", "Plot 5"],
    datasets: [
      {
        data: [10, 8, 4, 6, 4],
        backgroundColor: ["#28ADE2", "#3674B5", "#578FCA", "#A1E3F9", "#D1F8EF"],
      },
    ],
  };
  
  const pieOptions = {
    plugins: {
      legend: {
        display: true,
        position: "left", // Move labels to the left
        labels: {
          color: colors.grey[100],
          usePointStyle: true, // Makes labels look cleaner
          boxWidth: 10, // Reduce box size
          padding: 10, // Adjust spacing
        },
      },
      datalabels: {
        color: (context) => {
          const colors = ["#fff", "#fff", "#fff", "#666", "#333"]; // Different colors per section
          return colors[context.dataIndex] || "#fff"; // Default to white
        },
        font: { size: 14 },
        formatter: (value) => `${value}`,
      },
    },
    elements: {
      arc: {
        borderWidth: 0, // Remove border around pie sections
      },
    },
    cutout: "0%", // Ensures no extra border
    maintainAspectRatio: false,
  };
  
  
  const lineData = {
    labels: ["2021", "2022", "2023", "2024"],
    datasets: [
      { label: "Plot 1", data: [1000, 1250, 750, 1000], borderColor: "#3674B5", fill: false, tension: 0.4 },
      { label: "Plot 3", data: [400, 600, 1100, 500], borderColor: "#A1E3F9", fill: false, tension: 0.4 },
    ],
  };
  
  const lineOptions = {
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: true,
        position: "bottom", 
        align: "center",
        labels: {
          color: colors.grey[100],
          usePointStyle: true,
          pointStyle: "line",
        },    
      },
      datalabels: { display: false }
    },
    scales: {
      x: {
        ticks: { color: colors.grey[100] },
        grid: { color: colors.grey[800] },
      },
      y: {
        ticks: { color: colors.grey[100] },
        grid: { color: colors.grey[800] },
      },
    },
  };
  
  const barData = {
    labels: ["Plot 1", "Plot 2", "Plot 3", "Plot 4", "Plot 5"],
    datasets: [
      { label: "Bolivia", data: [1000, 1200, 900, 1100, 1050], backgroundColor: "#28ADE2" },
      { label: "Ecuador", data: [800, 1100, 950, 1200, 1000], backgroundColor: "#A1E3F9" },
      { label: "Madagascar", data: [700, 950, 850, 1000, 900], backgroundColor: "#D1F8EF" },
      { label: "Papua New Guinea", data: [500, 700, 650, 800, 750], backgroundColor: "#3674B5" },
      { label: "Rwanda", data: [300, 500, 400, 600, 500], backgroundColor: "#28ADE2" }
    ]
  };
  
  const barOptions = {
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: true,
        position: "right", 
        align:"start",
        labels: {
          color: colors.grey[100],
        }, 
      },
      datalabels: { display: false }
    },
    scales: {
      x: {
        ticks: { color: colors.grey[100] },
        grid: { color: colors.grey[800] },
      },
      y: {
        ticks: { color: colors.grey[100] },
        grid: { color: colors.grey[800] },
      },
    },
  };
  
  const fileUploads = [
    { date: "March 22, 2025", time: "10:30 AM", file: "report.pdf" },
    { date: "March 22, 2025", time: "11:15 AM", file: "tree_data.csv" },
    { date: "March 23, 2025", time: "01:45 PM", file: "project_docs.zip" },
    { date: "March 23, 2025", time: "03:00 PM", file: "analysis.xlsx" }
  ];

  const styles = {
    container: {
      display: "flex",
      minHeight: "100vh",
      bgcolor: colors.grey[800],
      marginLeft: isCollapsed ? "80px" : "270px",
      transition: "margin 0.3s ease",
    },
    content: { flex: 1, p: 4 },
    // Grid for Stats Row (Total Members, Files Uploaded, Carbon Estimation)
    statsGrid: {
      display: "grid",
      gridTemplateColumns: {
        xs: "1fr",  // Small screens → 1 column
        sm: "1fr 1fr",  // Medium screens → 2 columns
        md: "repeat(3, 1fr)",  // Large screens → 3 columns
      },
      gap: 3,
    },

    // Grid for Row 2 (Pie & Line Chart) -> 5:5
    chartsGridRow2: {
      display: "grid",
      gridTemplateColumns: {
        xs: "1fr",  // Small screens → 1 column
        md: "5fr 5fr",  // Medium & large screens → 2 columns (5:5)
      },
      gap: 3,
      mt: 4,
    },

    // Grid for Row 3 (Bar Chart & Timeline) -> 6:4
    chartsGridRow3: {
      display: "grid",
      gridTemplateColumns: {
        xs: "1fr",  // Small screens → 1 column
        md: "6fr 4fr",  // Medium & large screens → 2 columns (6:4)
      },
      gap: 3,
      mt: 4,
    },
    card: {
      minHeight: 160,
      display: "flex",
      flexDirection: "column",
      justifyContent: "center",
      alignItems: "center",
      p: 2,
      bgcolor: colors.grey[900],
    },
    cardTitle: { mb: 2, fontWeight: "bold", color: colors.grey[100] },
    cardIconBox: { display: "flex", alignItems: "center", gap: 1, color: colors.chartColor[100] },
    chartsGrid: { display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 3, mt: 4 },
    chartBox: { height: 300, width: "100%" },
    chartTitle: { marginBottom: 3, marginTop: 1, color: colors.chartColor[100] },
    body2Text: { fontWeight: "bold", color: colors.chartColor[100] },
    timelineBox: { height: 393.5, width: "100%" },
  };
  return (

    <Box sx={styles.container}>
      <Box sx={styles.content}>
        
        {/* Stats Section */}
        <Box sx={styles.statsGrid}>
          <Card sx={styles.card}>
            <Typography variant="h1" sx={styles.cardTitle}>
              {totalMembers === null ? '...' : totalMembers} {/* Show '...' while loading */}
            </Typography>
            <Box sx={styles.cardIconBox}>
              <span className="material-symbols-outlined">user_attributes</span>
              <Typography variant="body2" sx={styles.body2Text}>Total Members</Typography>
            </Box>
          </Card>
          <Card sx={styles.card}>
            <Typography variant="h1" sx={styles.cardTitle}>5</Typography>
            <Box sx={styles.cardIconBox}>
              <span className="material-symbols-outlined">publish</span>
              <Typography variant="body2" sx={styles.body2Text}>Files Uploaded</Typography>
            </Box>
          </Card>
          <Card sx={styles.card}>
            <Typography variant="h1" sx={styles.cardTitle}>5.1 kg</Typography>
            <Box sx={styles.cardIconBox}>
              <span className="material-symbols-outlined">co2</span>
              <Typography variant="body2" sx={styles.body2Text}>Carbon Estimation</Typography>
            </Box>
          </Card>
        </Box>
  
        {/* Row 2: Pie Chart & Line Chart (5:5) */}
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
  
        {/* Row 3: Bar Chart & Timeline (6:4) */}
        <Box sx={styles.chartsGridRow3}>
          <Card>
            <CardContent>
              <Typography variant="h5" sx={styles.chartTitle}>Tree Structure Count</Typography>
              <Box sx={styles.chartBox}><Bar data={barData} options={barOptions} /></Box>
            </CardContent>
          </Card>
          <Card sx={styles.timelineBox}>
            <CardContent>
              <Typography variant="h5" sx={styles.chartTitle}>File Upload Timeline</Typography>
              <Timeline position="alternate">
                {fileUploads.map((upload, index) => (
                  <TimelineItem key={index}>
                    <TimelineSeparator>
                      <TimelineDot color="primary" />
                      {index < fileUploads.length - 1 && <TimelineConnector />}
                    </TimelineSeparator>
                    <TimelineContent>
                      <Typography variant="subtitle2" color="textSecondary">
                        {upload.date}
                      </Typography>
                      <Typography variant="body1" sx={{ fontWeight: "bold" }}>
                        {upload.time}
                      </Typography>
                      <Typography variant="body2" color="textSecondary">
                        {upload.file}
                      </Typography>
                    </TimelineContent>
                  </TimelineItem>
                ))}
              </Timeline>
            </CardContent>
          </Card>
        </Box>
  
      </Box>

    </Box>
  );
};

export default Dashboard;
