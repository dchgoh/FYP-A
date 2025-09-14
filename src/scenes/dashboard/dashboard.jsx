import React, { useMemo } from 'react';
import { Box, useTheme } from "@mui/material";
import { Chart as ChartJS, ArcElement, Tooltip, Legend, LineElement, LinearScale, PointElement, CategoryScale, BarElement } from "chart.js";
import ChartDataLabels from "chartjs-plugin-datalabels";

import { tokens } from "../../theme";
import { useDashboardData } from '../../hooks/useDashboardData';

// Import the new presentational components
import DashboardFilters from './DashboardFilters';
import StatCard from './StatCard';
import HistogramChart from './HistogramChart';
import RecentUploadsTimeline from './RecentUploadsTimeline';

// Register Chart.js components
ChartJS.register(ArcElement, Tooltip, Legend, LineElement, LinearScale, PointElement, CategoryScale, BarElement, ChartDataLabels);

const Dashboard = ({ isCollapsed }) => {
    const theme = useTheme();
    const colors = tokens(theme.palette.mode);

    // --- All state, data fetching, and logic is now encapsulated in this single hook call! ---
    const dashboardData = useDashboardData();

    // --- Chart Data Transformation & Options ---
    // This logic stays in the UI component because it's purely for presentation and depends on the `colors` theme prop.
    const treeHeightHistogramData = useMemo(() => {
        const currentData = Array.isArray(dashboardData.allTreeHeightsData) ? dashboardData.allTreeHeightsData : [];
        if (currentData.length === 0) return { labels: [], datasets: [] };
        
        const bins = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, Infinity];
        const labels = bins.slice(0, -1).map((bin, index) => index === bins.length - 2 ? `≥${bins[index]}m` : `${bin}-${bins[index + 1]}m`);
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

    const treeHeightHistogramOptions = useMemo(() => ({
        maintainAspectRatio: false, responsive: true,
        plugins: {
            legend: { display: true, position: "bottom", labels: { color: colors.grey[100] } },
            title: { display: true, text: 'Tree Height Distribution (Adjusted)', color: colors.grey[100], font: { size: 16 }, padding: { bottom: 30 } },
            datalabels: { display: true, color: colors.grey[100], anchor: 'end', align: 'top', formatter: (value) => value > 0 ? value : '' },
        },
        scales: {
            x: { title: { display: true, text: 'Height Range (m)', color: colors.grey[300] }, ticks: { color: colors.grey[100] }, grid: { color: colors.grey[800] } },
            y: { title: { display: true, text: 'Number of Trees', color: colors.grey[300] }, ticks: { color: colors.grey[100], stepSize: Math.max(1, Math.ceil(Math.max(...(treeHeightHistogramData.datasets[0]?.data || [0])) / 10)) }, grid: { color: colors.grey[800] }, beginAtZero: true },
        },
    }), [colors, treeHeightHistogramData]);

    const treeDbhHistogramData = useMemo(() => {
        const currentData = Array.isArray(dashboardData.allTreeDbhsData) ? dashboardData.allTreeDbhsData : [];
        if (currentData.length === 0) return { labels: [], datasets: [] };

        const bins = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, Infinity];
        const labels = bins.slice(0, -1).map((bin, index) => index === bins.length - 2 ? `≥${bins[index]}cm` : `${bin}-${bins[index + 1]}cm`);
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

    const treeDbhHistogramOptions = useMemo(() => ({
        maintainAspectRatio: false, responsive: true,
        plugins: {
            legend: { display: true, position: "bottom", labels: { color: colors.grey[100] } },
            title: { display: true, text: 'Tree Diameter (DBH) Distribution', color: colors.grey[100], font: { size: 16 }, padding: { bottom: 30 } },
            datalabels: { display: true, color: colors.grey[100], anchor: 'end', align: 'top', formatter: (value) => value > 0 ? value : '' },
        },
        scales: {
            x: { title: { display: true, text: 'DBH Range (cm)', color: colors.grey[300] }, ticks: { color: colors.grey[100] }, grid: { color: colors.grey[800] } },
            y: { title: { display: true, text: 'Number of Trees', color: colors.grey[300] }, ticks: { color: colors.grey[100], stepSize: Math.max(1, Math.ceil(Math.max(...(treeDbhHistogramData.datasets[0]?.data || [0])) / 10)) }, grid: { color: colors.grey[800] }, beginAtZero: true },
        },
    }), [colors, treeDbhHistogramData]);

    const treeVolumeHistogramData = useMemo(() => {
        const currentData = Array.isArray(dashboardData.allTreeVolumesData) ? dashboardData.allTreeVolumesData : [];
        if (currentData.length === 0) return { labels: [], datasets: [] };

        const bins = [0, 0.25, 0.5, 0.75, 1, 1.5, 2, 2.5, 3, 5, Infinity];
        const labels = bins.slice(0, -1).map((bin, index) => index === bins.length - 2 ? `≥${bins[index]}m³` : `${bin}-${bins[index + 1]}m³`);
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

    const treeVolumeHistogramOptions = useMemo(() => ({
        maintainAspectRatio: false, responsive: true,
        plugins: {
            legend: { display: true, position: "bottom", labels: { color: colors.grey[100] } },
            title: { display: true, text: 'Tree Volume Distribution (m³)', color: colors.grey[100], font: { size: 16 }, padding: { bottom: 30 } },
            datalabels: { display: true, color: colors.grey[100], anchor: 'end', align: 'top', formatter: (value) => value > 0 ? value : '' },
        },
        scales: {
            x: { title: { display: true, text: 'Volume Range (m³)', color: colors.grey[300] }, ticks: { color: colors.grey[100] }, grid: { color: colors.grey[800] } },
            y: { title: { display: true, text: 'Number of Trees', color: colors.grey[300] }, ticks: { color: colors.grey[100], stepSize: Math.max(1, Math.ceil(Math.max(...(treeVolumeHistogramData.datasets[0]?.data || [0])) / 10)) }, grid: { color: colors.grey[800] }, beginAtZero: true },
        },
    }), [colors, treeVolumeHistogramData]);

    // --- Main Component Styles ---
    const styles = {
        container: { display: "flex", minHeight: "100vh", bgcolor: colors.grey[800], marginLeft: isCollapsed ? "80px" : "270px", transition: "margin 0.3s ease" },
        content: { flex: 1, p: { xs: 1, sm: 2, md: 3 }, overflowY: 'auto' },
        statsGrid: { display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)", md: "repeat(4, 1fr)" }, gap: '16px', mt: 3 },
        chartsGridRow2: { display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, gap: '16px', mt: 3 },
        chartsGridRow3: { display: "grid", gridTemplateColumns: { xs: "1fr", lg: "3fr 2fr" }, gap: '16px', mt: 3 },
    };

    // Calculate a general loading state to pass to the filters component
    const isDataLoading = dashboardData.loadingFilters || dashboardData.isFetchingFileCount || dashboardData.isFetchingTreeCount || dashboardData.loadingPlots || dashboardData.loadingHeightsChart || dashboardData.loadingDbhsChart || dashboardData.loadingVolumesChart || dashboardData.isFetchingSumCarbon;

    return (
        <Box sx={styles.container}>
            <Box sx={styles.content}>
                
                <DashboardFilters
                    colors={colors}
                    isDataLoading={isDataLoading}
                    {...dashboardData} // Spread the rest of the props from the hook
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