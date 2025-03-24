import { Box, Card, CardContent, Typography } from "@mui/material";
import { Pie, Line, Bar } from "react-chartjs-2";
import { Chart as ChartJS, ArcElement, Tooltip, Legend, LineElement, LinearScale, PointElement, CategoryScale, BarElement } from "chart.js";
import ChartDataLabels from "chartjs-plugin-datalabels";
import PeopleIcon from "@mui/icons-material/People";
import UploadIcon from '@mui/icons-material/Upload';
import Co2Icon from '@mui/icons-material/Co2';


ChartJS.register(ArcElement, Tooltip, Legend, LineElement, LinearScale, PointElement, CategoryScale, BarElement, ChartDataLabels);

const styles = {
  container: { display: "flex", minHeight: "100vh", bgcolor: "grey.100" },
  content: { flex: 1, p: 4 },
  statsGrid: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 3 },
  card: { minHeight: 160, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", p: 2 },
  cardTitle: { mb: 2, fontWeight: "bold" },
  cardIconBox: { display: "flex", alignItems: "center", gap: 1, color: "primary.main" },
  chartsGrid: { display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 3, mt: 4 },
  barChartGrid: { display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 3, mt: 1 },
  chartBox: { height: 300, width: "100%" },
  chartTitle: { marginBottom: 3, marginTop: 1, color:"#3498db" }
};

const pieData = {
  labels: ["Plot 1", "Plot 2", "Plot 3", "Plot 4", "Plot 5"],
  datasets: [
    {
      data: [10, 8, 4, 6, 4],
      backgroundColor: ["#3498db", "#b1b1ff", "#d8d8ff", "#ebebff", "#8989ff"],
    },
  ],
};

const pieOptions = {
  plugins: {
    datalabels: {
      color: "#fff",
      font: { size: 14 },
      formatter: (value, ctx) => `${value}`,
    },
  },
  maintainAspectRatio: false,
};

const lineData = {
  labels: ["2004", "2005", "2006", "2007"],
  datasets: [
    { label: "Plot 1", data: [1000, 1250, 750, 1000], borderColor: "#1f77b4", fill: false, tension: 0.4 },
    { label: "Plot 3", data: [400, 600, 1100, 500], borderColor: "#87CEEB", fill: false, tension: 0.4 },
  ],
};

const lineOptions = {
  maintainAspectRatio: false,
  plugins: {
    legend: {
      display: true,
      position: "bottom", // Move legend to the top
      align: "center"    // Align it to the start (left)
    },
    datalabels: { display: false }
  },
};


const barData = {
  labels: ["Plot 1", "Plot 2", "Plot 3", "Plot 4", "Plot 5"],
  datasets: [
    { label: "Bolivia", data: [1000, 1200, 900, 1100, 1050], backgroundColor: "#2c3e50" },
    { label: "Ecuador", data: [800, 1100, 950, 1200, 1000], backgroundColor: "#2980b9" },
    { label: "Madagascar", data: [700, 950, 850, 1000, 900], backgroundColor: "#16a085" },
    { label: "Papua New Guinea", data: [500, 700, 650, 800, 750], backgroundColor: "#8e44ad" },
    { label: "Rwanda", data: [300, 500, 400, 600, 500], backgroundColor: "#f39c12" }
  ]
};

const barOptions = {
  maintainAspectRatio: false,
  plugins: {
    legend: {
      display: true,
      position: "right", // Move legend to the right
      align:"start" // Align it to the end (right)
    },
    datalabels: { display: false }
  },
};


const Dashboard = () => {
  return (
    <Box sx={styles.container}>
      <Box sx={styles.content}>
        <Box sx={styles.statsGrid}>
          <Card sx={styles.card}>
            <Typography variant="h1" sx={styles.cardTitle}>20</Typography>
            <Box sx={styles.cardIconBox}>
              <PeopleIcon fontSize="medium" />
              <Typography variant="body2" fontWeight="bold">Total Members</Typography>
            </Box>
          </Card>
          <Card sx={styles.card}>
            <Typography variant="h1" sx={styles.cardTitle}>5</Typography>
            <Box sx={styles.cardIconBox}>
              <UploadIcon fontSize="medium" />
              <Typography variant="body2" fontWeight="bold">Files Uploaded</Typography>
            </Box>
          </Card>
          <Card sx={styles.card}>
            <Typography variant="h1" sx={styles.cardTitle}>5.1kg</Typography>
            <Box sx={styles.cardIconBox}>
              <Co2Icon fontSize="large" />
              <Typography variant="body2" fontWeight="bold">Carbon Estimation</Typography>
            </Box>
          </Card>
        </Box>
        <Box sx={styles.chartsGrid}>
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
          <Box sx={styles.barChartGrid}>
            <Card sx={{ gridColumn: "span 2" }}>
              <CardContent>
                <Typography variant="h5" sx={styles.chartTitle}>Tree Structure Count</Typography>
                <Box sx={styles.chartBox}><Bar data={barData} options={barOptions} /></Box>
              </CardContent>
            </Card>
          </Box>
        </Box>
      </Box>
    </Box>
  );
};

export default Dashboard;
