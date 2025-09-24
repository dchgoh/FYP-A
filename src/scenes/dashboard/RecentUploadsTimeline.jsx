import React from 'react';
import { Card, CardContent, Box, Typography, CircularProgress } from '@mui/material';
import { Timeline, TimelineItem, TimelineSeparator, TimelineConnector, TimelineContent, TimelineDot } from "@mui/lab";

// --- FIX IS APPLIED HERE ---
// By adding `= []` we ensure that if 'uploads' is undefined, it defaults to an empty array.
const RecentUploadsTimeline = ({
    isLoading,
    uploads = [], // <--- THIS IS THE FIX. Default to an empty array.
    colors,
    loadingFilters,
    canFetchPlots,
    filterDivisionId,
    filterProjectId,
    filterPlotName
}) => {
    const styles = {
        timelineBox: { height: { xs: 320, sm: 370 }, width: "100%", bgcolor: colors.grey[900] },
        timelineCardContent: { height: '100%', display: 'flex', flexDirection: 'column' },
        chartTitleText: { marginBottom: 2, marginTop: 1, color: colors.grey[100], textAlign: 'center' },
        timelineScroll: { flexGrow: 1, overflowY: 'auto', "&::-webkit-scrollbar": { width: "6px" }, "&::-webkit-scrollbar-track": { background: colors.grey[700] }, "&::-webkit-scrollbar-thumb": { backgroundColor: colors.grey[500], borderRadius: "10px" } }
    };
    
    const noUploadsMessage = React.useMemo(() => {
        if (loadingFilters) return "Loading filters...";
        if (filterDivisionId !== 'all' || filterProjectId !== 'all' || (filterPlotName !== 'all' && canFetchPlots)) {
            return 'No recent uploads match filters.';
        }
        return 'No recent uploads found.';
    }, [loadingFilters, filterDivisionId, filterProjectId, filterPlotName, canFetchPlots]);

    return (
        <Card sx={styles.timelineBox}>
            <CardContent sx={styles.timelineCardContent}>
                <Typography variant="h5" sx={{ ...styles.chartTitleText, flexShrink: 0 }}>Recent File Uploads</Typography>
                <Box sx={styles.timelineScroll}>
                    {isLoading ? <Box display="flex" justifyContent="center" alignItems="center" height="100%"><CircularProgress /></Box>
                        // Now, uploads.length will always work because uploads is guaranteed to be an array.
                        : uploads.length === 0 ?
                            <Typography sx={{ textAlign: 'center', color: colors.grey[400], mt: 4, p: 1 }}>
                                {noUploadsMessage}
                            </Typography>
                            : <Timeline position="alternate" sx={{ p: 0, mt: 1 }}>
                                {uploads.map((upload, index) => (
                                    <TimelineItem key={upload.id || index}>
                                        <TimelineSeparator>
                                            <TimelineDot color="primary" variant="outlined" />
                                            {index < uploads.length - 1 && <TimelineConnector sx={{ bgcolor: colors.primary[500] }} />}
                                        </TimelineSeparator>
                                        <TimelineContent sx={{ py: '10px', px: 2 }}>
                                            <Typography variant="caption" sx={{ color: colors.grey[400] }}>{upload.date} - {upload.time}</Typography>
                                            <Typography variant="body2" sx={{ fontWeight: "bold", color: colors.grey[100], whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={upload.file}>{upload.file}</Typography>
                                            <Typography variant="caption" sx={{ color: colors.grey[300], display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={upload.context}>{upload.context}</Typography>
                                        </TimelineContent>
                                    </TimelineItem>
                                ))}
                            </Timeline>
                    }
                </Box>
            </CardContent>
        </Card>
    );
};

export default RecentUploadsTimeline;