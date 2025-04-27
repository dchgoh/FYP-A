import { Box, Card, CardContent, useTheme } from "@mui/material";
import { Pie } from "react-chartjs-2";
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from "chart.js";
import { tokens } from "../../theme"; // Import theme tokens

ChartJS.register(ArcElement, Tooltip, Legend);

const TreeCountDashboard = ({ isCollapsed }) => {
  const theme = useTheme();
  const colors = tokens(theme.palette.mode);

  const pieData = {
    labels: ["Plot 1", "Plot 2", "Plot 3", "Plot 4", "Plot 5"],
    datasets: [
      {
        data: [10, 8, 4, 6, 4], // Example tree counts
        backgroundColor: [
          "#28ADE2", "#3674B5", "#578FCA", "#A1E3F9", "#D1F8EF"
        ],
        borderColor: colors.grey[900], // Set border color to match card background
        borderWidth: 2,
      },
    ],
  };

  const pieOptions = {
    plugins: {
      legend: {
        display: true,
        position: "bottom",
        labels: {
          color: colors.grey[100],
          padding: 40,
          usePointStyle: true,
        },
      },
    },
    maintainAspectRatio: false, // Allow the chart to take up available space
    cutout: '50%', // This makes it a donut chart.  '50%' is a good starting point.
  };

  const styles = {
    container: {
      display: "flex",
      minHeight: "100vh",
      bgcolor: colors.grey[800],
      marginLeft: isCollapsed ? "80px" : "270px",
      transition: "margin 0.3s ease",
    },
    content: { flex: 1, p: 4 },
    card: {
      p: 2,
      bgcolor: colors.grey[900],
      height: "100%", // Make card fill container height
      display: "flex", // Use flexbox for layout
      flexDirection: "column", // Stack content vertically
    },
    cardTitle: { mb: 2, fontWeight: "bold", color: colors.grey[100] },
    chartContainer: {
      flex: 1, // Allow chart to grow and fill available space
      minHeight: 600, // Add minHeight to prevent chart collapsing
      position: 'relative', //Ensure the canvas takes up the full box
    },
  };

  return (
    <Box sx={styles.container}>
      <Box sx={styles.content}>
        <Card sx={styles.card}>
          <CardContent>
            <Box sx={styles.chartContainer}>
              <Pie data={pieData} options={pieOptions} />
            </Box>
          </CardContent>
        </Card>
      </Box>
    </Box>
  );
};

export default TreeCountDashboard;