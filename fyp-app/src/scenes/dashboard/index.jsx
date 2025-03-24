import { Box, Card, CardContent, Typography } from "@mui/material";
import { Pie, Line, Bar } from "react-chartjs-2";
import { Chart as ChartJS, ArcElement, Tooltip, Legend, LineElement, LinearScale, PointElement, CategoryScale, BarElement } from "chart.js";
import ChartDataLabels from "chartjs-plugin-datalabels";
import PeopleIcon from "@mui/icons-material/People";
import UploadIcon from '@mui/icons-material/Upload';
import Co2Icon from '@mui/icons-material/Co2';
import { Timeline, TimelineItem, TimelineSeparator, TimelineConnector, TimelineContent, TimelineDot } from "@mui/lab";

ChartJS.register(ArcElement, Tooltip, Legend, LineElement, LinearScale, PointElement, CategoryScale, BarElement, ChartDataLabels);

const styles = {
  container: { display: "flex", minHeight: "100vh", bgcolor: "grey.100" },
  content: { flex: 1, p: 4 },
  statsGrid: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 3 },
  card: { minHeight: 160, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", p: 2 },
  cardTitle: { mb: 2, fontWeight: "bold" },
  cardIconBox: { display: "flex", alignItems: "center", gap: 1, color: "#3498db" },
  chartsGrid: { display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 3, mt: 4 },
  chartBox: { height: 300, width: "100%" },
  chartTitle: { marginBottom: 3, marginTop: 1, color:"#3498db" },
  body2Text: { fontWeight: "bold" },
  timelineBox: { height: 393.5, width: "100%" }
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
      position: "bottom", 
      align: "center"    
    },
    datalabels: { display: false }
  },
};

const barData = {
  labels: ["Plot 1", "Plot 2", "Plot 3", "Plot 4", "Plot 5"],
  datasets: [
    { label: "Bolivia", data: [1000, 1200, 900, 1100, 1050], backgroundColor: "#3498db" },
    { label: "Ecuador", data: [800, 1100, 950, 1200, 1000], backgroundColor: "#b1b1ff" },
    { label: "Madagascar", data: [700, 950, 850, 1000, 900], backgroundColor: "#d8d8ff" },
    { label: "Papua New Guinea", data: [500, 700, 650, 800, 750], backgroundColor: "#ebebff" },
    { label: "Rwanda", data: [300, 500, 400, 600, 500], backgroundColor: "#8989ff" }
  ]
};

const barOptions = {
  maintainAspectRatio: false,
  plugins: {
    legend: {
      display: true,
      position: "right", 
      align:"start" 
    },
    datalabels: { display: false }
  },
};

const fileUploads = [
  { date: "March 22, 2025", time: "10:30 AM", file: "report.pdf" },
  { date: "March 22, 2025", time: "11:15 AM", file: "tree_data.csv" },
  { date: "March 23, 2025", time: "01:45 PM", file: "project_docs.zip" },
  { date: "March 23, 2025", time: "03:00 PM", file: "analysis.xlsx" }
];


const Dashboard = () => {
  return (
    <Box sx={styles.container}>
      <Box sx={styles.content}>
        <Box sx={styles.statsGrid}>
          <Card sx={styles.card}>
            <Typography variant="h1" sx={styles.cardTitle}>20</Typography>
            <Box sx={styles.cardIconBox}>
              <PeopleIcon fontSize="medium" />
              <Typography variant="body2" sx={styles.body2Text} >Total Members</Typography>
            </Box>
          </Card>
          <Card sx={styles.card}>
            <Typography variant="h1" sx={styles.cardTitle}>5</Typography>
            <Box sx={styles.cardIconBox}>
              <UploadIcon fontSize="medium"/>
              <Typography variant="body2"  sx={styles.body2Text} >Files Uploaded</Typography>
            </Box>
          </Card>
          <Card sx={styles.card}>
            <Typography variant="h1" sx={styles.cardTitle}>5.1 kg</Typography>
            <Box sx={styles.cardIconBox}>
              <Co2Icon fontSize="large" />
              <Typography variant="body2"  sx={styles.body2Text}>Carbon Estimation</Typography>
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
            <Card>
              <CardContent>
                <Typography variant="h5" sx={styles.chartTitle}>Tree Structure Count</Typography>
                <Box sx={styles.chartBox}><Bar data={barData} options={barOptions} /></Box>
              </CardContent>
            </Card>
            </Box>
          <Box>
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
                        {upload.date} {/* Display the date here */}
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
    </Box>
  );
};

export default Dashboard;