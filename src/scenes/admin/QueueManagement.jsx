import React from 'react';
import {
    Box,
    Card,
    CardContent,
    Typography,
    Grid,
    Button,
    LinearProgress,
    Chip,
    Alert,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Paper,
    IconButton,
    Tooltip,
} from '@mui/material';
import {
    PlayArrow,
    Pause,
    Clear,
    Refresh,
    Memory,
    Storage,
    Speed,
    Computer,
} from '@mui/icons-material';
import { useQueueStatus } from '../../hooks/useQueueStatus';

const QueueManagement = ({ colors, theme }) => {
    const {
        queueStatus,
        systemHealth,
        isLoading,
        error,
        queueEfficiency,
        resourceUtilization,
        actions,
    } = useQueueStatus();

    const handlePauseQueue = async () => {
        const result = await actions.pauseQueue();
        if (result.success) {
            // Show success message
        } else {
            // Show error message
        }
    };

    const handleResumeQueue = async () => {
        const result = await actions.resumeQueue();
        if (result.success) {
            // Show success message
        } else {
            // Show error message
        }
    };

    const handleClearQueue = async () => {
        if (window.confirm('Are you sure you want to clear the processing queue? This will remove all pending jobs.')) {
            const result = await actions.clearQueue();
            if (result.success) {
                // Show success message
            } else {
                // Show error message
            }
        }
    };

    const getStatusColor = (status) => {
        switch (status) {
            case 'healthy': return 'success';
            case 'warning': return 'warning';
            case 'error': return 'error';
            default: return 'default';
        }
    };

    const getResourceColor = (usage) => {
        if (usage >= 90) return 'error';
        if (usage >= 70) return 'warning';
        return 'success';
    };

    return (
        <Box sx={{ p: 3 }}>
            <Typography variant="h4" sx={{ mb: 3, color: colors.grey[100] }}>
                Queue Management & System Health
            </Typography>

            {error && (
                <Alert severity="error" sx={{ mb: 3 }}>
                    {error}
                </Alert>
            )}

            {/* System Health Overview */}
            <Card sx={{ mb: 3, backgroundColor: colors.primary[400] }}>
                <CardContent>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                        <Typography variant="h6" sx={{ color: colors.grey[100] }}>
                            System Health
                        </Typography>
                        <Chip
                            label={systemHealth.status}
                            color={getStatusColor(systemHealth.status)}
                            size="small"
                        />
                    </Box>
                    
                    <Grid container spacing={3}>
                        <Grid item xs={12} sm={6} md={3}>
                            <Box sx={{ textAlign: 'center' }}>
                                <Computer sx={{ fontSize: 40, color: colors.grey[300], mb: 1 }} />
                                <Typography variant="h6" sx={{ color: colors.grey[100] }}>
                                    {resourceUtilization.cpu}%
                                </Typography>
                                <Typography variant="body2" sx={{ color: colors.grey[300] }}>
                                    CPU Usage
                                </Typography>
                                <LinearProgress
                                    variant="determinate"
                                    value={resourceUtilization.cpu}
                                    color={getResourceColor(resourceUtilization.cpu)}
                                    sx={{ mt: 1 }}
                                />
                            </Box>
                        </Grid>
                        
                        <Grid item xs={12} sm={6} md={3}>
                            <Box sx={{ textAlign: 'center' }}>
                                <Memory sx={{ fontSize: 40, color: colors.grey[300], mb: 1 }} />
                                <Typography variant="h6" sx={{ color: colors.grey[100] }}>
                                    {resourceUtilization.memory}%
                                </Typography>
                                <Typography variant="body2" sx={{ color: colors.grey[300] }}>
                                    Memory Usage
                                </Typography>
                                <LinearProgress
                                    variant="determinate"
                                    value={resourceUtilization.memory}
                                    color={getResourceColor(resourceUtilization.memory)}
                                    sx={{ mt: 1 }}
                                />
                            </Box>
                        </Grid>
                        
                        <Grid item xs={12} sm={6} md={3}>
                            <Box sx={{ textAlign: 'center' }}>
                                <Storage sx={{ fontSize: 40, color: colors.grey[300], mb: 1 }} />
                                <Typography variant="h6" sx={{ color: colors.grey[100] }}>
                                    {resourceUtilization.database}%
                                </Typography>
                                <Typography variant="body2" sx={{ color: colors.grey[300] }}>
                                    DB Connections
                                </Typography>
                                <LinearProgress
                                    variant="determinate"
                                    value={resourceUtilization.database}
                                    color={getResourceColor(resourceUtilization.database)}
                                    sx={{ mt: 1 }}
                                />
                            </Box>
                        </Grid>
                        
                        <Grid item xs={12} sm={6} md={3}>
                            <Box sx={{ textAlign: 'center' }}>
                                <Speed sx={{ fontSize: 40, color: colors.grey[300], mb: 1 }} />
                                <Typography variant="h6" sx={{ color: colors.grey[100] }}>
                                    {resourceUtilization.gpu}%
                                </Typography>
                                <Typography variant="body2" sx={{ color: colors.grey[300] }}>
                                    GPU Usage
                                </Typography>
                                <LinearProgress
                                    variant="determinate"
                                    value={resourceUtilization.gpu}
                                    color={getResourceColor(resourceUtilization.gpu)}
                                    sx={{ mt: 1 }}
                                />
                            </Box>
                        </Grid>
                    </Grid>
                </CardContent>
            </Card>

            {/* Queue Status */}
            <Card sx={{ mb: 3, backgroundColor: colors.primary[400] }}>
                <CardContent>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                        <Typography variant="h6" sx={{ color: colors.grey[100] }}>
                            Processing Queue
                        </Typography>
                        <Box>
                            <Tooltip title="Refresh">
                                <IconButton onClick={actions.refreshAll} sx={{ color: colors.grey[300] }}>
                                    <Refresh />
                                </IconButton>
                            </Tooltip>
                        </Box>
                    </Box>
                    
                    <Grid container spacing={3} sx={{ mb: 3 }}>
                        <Grid item xs={6} sm={3}>
                            <Box sx={{ textAlign: 'center' }}>
                                <Typography variant="h4" sx={{ color: colors.grey[100] }}>
                                    {queueStatus.waiting}
                                </Typography>
                                <Typography variant="body2" sx={{ color: colors.grey[300] }}>
                                    Waiting
                                </Typography>
                            </Box>
                        </Grid>
                        
                        <Grid item xs={6} sm={3}>
                            <Box sx={{ textAlign: 'center' }}>
                                <Typography variant="h4" sx={{ color: colors.grey[100] }}>
                                    {queueStatus.active}
                                </Typography>
                                <Typography variant="body2" sx={{ color: colors.grey[300] }}>
                                    Active
                                </Typography>
                            </Box>
                        </Grid>
                        
                        <Grid item xs={6} sm={3}>
                            <Box sx={{ textAlign: 'center' }}>
                                <Typography variant="h4" sx={{ color: colors.grey[100] }}>
                                    {queueStatus.completed}
                                </Typography>
                                <Typography variant="body2" sx={{ color: colors.grey[300] }}>
                                    Completed
                                </Typography>
                            </Box>
                        </Grid>
                        
                        <Grid item xs={6} sm={3}>
                            <Box sx={{ textAlign: 'center' }}>
                                <Typography variant="h4" sx={{ color: colors.grey[100] }}>
                                    {queueStatus.failed}
                                </Typography>
                                <Typography variant="body2" sx={{ color: colors.grey[300] }}>
                                    Failed
                                </Typography>
                            </Box>
                        </Grid>
                    </Grid>

                    <Box sx={{ mb: 2 }}>
                        <Typography variant="body2" sx={{ color: colors.grey[300], mb: 1 }}>
                            Queue Efficiency: {queueEfficiency}%
                        </Typography>
                        <LinearProgress
                            variant="determinate"
                            value={queueEfficiency}
                            color={queueEfficiency >= 90 ? 'success' : queueEfficiency >= 70 ? 'warning' : 'error'}
                        />
                    </Box>

                    {/* Queue Controls */}
                    <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                        <Button
                            variant="contained"
                            startIcon={<PlayArrow />}
                            onClick={handleResumeQueue}
                            disabled={isLoading}
                            sx={{
                                backgroundColor: colors.greenAccent[500],
                                '&:hover': { backgroundColor: colors.greenAccent[600] }
                            }}
                        >
                            Resume Queue
                        </Button>
                        
                        <Button
                            variant="contained"
                            startIcon={<Pause />}
                            onClick={handlePauseQueue}
                            disabled={isLoading}
                            sx={{
                                backgroundColor: colors.orangeAccent[500],
                                '&:hover': { backgroundColor: colors.orangeAccent[600] }
                            }}
                        >
                            Pause Queue
                        </Button>
                        
                        <Button
                            variant="contained"
                            startIcon={<Clear />}
                            onClick={handleClearQueue}
                            disabled={isLoading}
                            color="error"
                        >
                            Clear Queue
                        </Button>
                    </Box>
                </CardContent>
            </Card>

            {/* System Alerts */}
            {systemHealth.alerts && systemHealth.alerts.length > 0 && (
                <Card sx={{ mb: 3, backgroundColor: colors.primary[400] }}>
                    <CardContent>
                        <Typography variant="h6" sx={{ color: colors.grey[100], mb: 2 }}>
                            System Alerts
                        </Typography>
                        {systemHealth.alerts.map((alert, index) => (
                            <Alert
                                key={index}
                                severity={alert.level}
                                sx={{ mb: 1 }}
                            >
                                {alert.message}
                            </Alert>
                        ))}
                    </CardContent>
                </Card>
            )}

            {/* GPU Details */}
            {systemHealth.metrics?.gpu?.totalGPUs > 0 && (
                <Card sx={{ backgroundColor: colors.primary[400] }}>
                    <CardContent>
                        <Typography variant="h6" sx={{ color: colors.grey[100], mb: 2 }}>
                            GPU Details
                        </Typography>
                        <TableContainer component={Paper} sx={{ backgroundColor: 'transparent' }}>
                            <Table>
                                <TableHead>
                                    <TableRow>
                                        <TableCell sx={{ color: colors.grey[300] }}>GPU ID</TableCell>
                                        <TableCell sx={{ color: colors.grey[300] }}>Name</TableCell>
                                        <TableCell sx={{ color: colors.grey[300] }}>Memory</TableCell>
                                        <TableCell sx={{ color: colors.grey[300] }}>Status</TableCell>
                                        <TableCell sx={{ color: colors.grey[300] }}>Allocated To</TableCell>
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {systemHealth.metrics.gpu.gpuDetails.map((gpu) => (
                                        <TableRow key={gpu.id}>
                                            <TableCell sx={{ color: colors.grey[100] }}>{gpu.id}</TableCell>
                                            <TableCell sx={{ color: colors.grey[100] }}>{gpu.name}</TableCell>
                                            <TableCell sx={{ color: colors.grey[100] }}>
                                                {gpu.usedMemory}MB / {gpu.totalMemory}MB
                                            </TableCell>
                                            <TableCell>
                                                <Chip
                                                    label={gpu.available ? 'Available' : 'In Use'}
                                                    color={gpu.available ? 'success' : 'warning'}
                                                    size="small"
                                                />
                                            </TableCell>
                                            <TableCell sx={{ color: colors.grey[100] }}>
                                                {gpu.allocatedTo.length > 0 ? gpu.allocatedTo.join(', ') : 'None'}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </TableContainer>
                    </CardContent>
                </Card>
            )}
        </Box>
    );
};

export default QueueManagement;
