import React from 'react';
import { Card, CardContent, Box, Typography, CircularProgress } from '@mui/material';
import { Bar } from 'react-chartjs-2';

const HistogramChart = ({ isLoading, data, options, noDataMessage, loadingFilters }) => {
    const chartBoxHeight = { xs: 220, sm: 250, md: 280 };
    const hasData = data && data.datasets.length > 0 && data.datasets[0].data.some(d => d > 0);

    return (
        <Card>
            <CardContent sx={{ height: { xs: chartBoxHeight.xs + 50, sm: chartBoxHeight.sm + 50, md: chartBoxHeight.md + 60 }, display: 'flex', flexDirection: 'column' }}>
                <Box sx={{ flexGrow: 1, position: 'relative', width: '100%', height: '100%' }}>
                    {isLoading ? (
                        <Box display="flex" justifyContent="center" alignItems="center" height="100%"><CircularProgress /></Box>
                    ) : hasData ? (
                        <Bar data={data} options={options} />
                    ) : (
                        <Typography sx={{ textAlign: 'center', color: 'grey.400', mt: 'auto', mb: 'auto', p: 1 }}>
                            {loadingFilters ? "Loading filters..." : noDataMessage}
                        </Typography>
                    )}
                </Box>
            </CardContent>
        </Card>
    );
};

export default HistogramChart;