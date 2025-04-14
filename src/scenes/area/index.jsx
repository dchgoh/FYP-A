import { Box, Card, CardContent, useTheme } from "@mui/material";
import { Bar } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from "chart.js";
import ChartDataLabels from "chartjs-plugin-datalabels";
import { tokens } from "../../theme";

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
  ChartDataLabels
);

const AreaDataDashboard = ({ isCollapsed }) => {
  const theme = useTheme();
  const colors = tokens(theme.palette.mode);

  const barData = {
    labels: ["Plot 1", "Plot 2", "Plot 3", "Plot 4", "Plot 5"],
    datasets: [
      {
        label: "Bolivia",
        data: [1000, 1200, 900, 1100, 1050],
        backgroundColor: "#28ADE2",
      },
      {
        label: "Ecuador",
        data: [800, 1100, 950, 1200, 1000],
        backgroundColor: "#A1E3F9",
      },
      {
        label: "Madagascar",
        data: [700, 950, 850, 1000, 900],
        backgroundColor: "#D1F8EF",
      },
      {
        label: "Papua New Guinea",
        data: [500, 700, 650, 800, 750],
        backgroundColor: "#3674B5",
      },
      {
        label: "Rwanda",
        data: [300, 500, 400, 600, 500],
        backgroundColor: "#578FCA",
      },
    ],
  };

  const barOptions = {
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: true,
        position: "right",
        labels: {
          color: colors.grey[100],
        },
      },
      datalabels: {
        display: false,
      },
      tooltip: {
        enabled: true,
        backgroundColor: colors.primary[400],
        titleColor: colors.grey[100],
        bodyColor: colors.grey[100],
        borderColor: colors.grey[700],
        borderWidth: 1,
      },
    },
    scales: {
      x: {
        ticks: {
          display: true,
          color: colors.grey[100],
        },
        grid: {
          display: false,
        },
      },
      y: {
        ticks: {
          display: true, // Show y-axis labels
          color: colors.grey[100], // Set y-axis tick color
          beginAtZero: true,
          max: 1750,         // Set the maximum value for the y-axis
          stepSize: 250,      // Optional: Control the step size of the ticks
        },
        grid: {
          display: true, // or false, to show/hide grid lines
          color: colors.grey[700], // Y-axis grid line color
        },
        title: { // Add y-axis title
          display: true,
          text: 'Number of Points (Milions, M)', // Your y-axis title
          color: colors.grey[100], // Y-axis title color
          font: {
            size: 14,
            weight: 'bold',
          }
        }
      },
    },
  };

  const styles = {
    container: {
      display: "flex",
      minHeight: "90vh",
      bgcolor: colors.grey[800],
      marginLeft: isCollapsed ? "80px" : "270px",
      transition: "margin 0.3s ease",
    },
    content: { flex: 1, p: 4 },
    card: {
      p: 2,
      bgcolor: colors.grey[900],
      height: "100%",
      display: "flex",
      flexDirection: "column",
    },
    chartContainer: {
      flex: 1
    },
  };

  return (
    <Box sx={styles.container}>
      <Box sx={styles.content}>
        <Card sx={styles.card}>
          <CardContent sx={{ flex: 1, display: "flex", flexDirection: "column" }}>
            <Box sx={styles.chartContainer}>
              <Bar data={barData} options={barOptions} />
            </Box>
          </CardContent>
        </Card>
      </Box>
    </Box>
  );
};

export default AreaDataDashboard;