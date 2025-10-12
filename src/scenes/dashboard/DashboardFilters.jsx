import React, { useMemo } from 'react';
import {
  Box,
  Typography,
  Grid,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  CircularProgress,
  Button,
  Tooltip as MuiTooltip
} from "@mui/material";
import { alpha } from '@mui/material/styles';
import ReplayIcon from '@mui/icons-material/Replay';

const DashboardFilters = ({
    colors,
    loadingFilters,
    isDataLoading,
    filterDivisionId,
    handleDivisionFilterChange,
    divisionsList,
    filterProjectId,
    handleProjectFilterChange,
    filteredProjectsForDropdown,
    filterPlotName,
    handlePlotFilterChange,
    canFetchPlots,
    loadingPlots,
    plotsList,
    handleResetFilters,
    areFiltersDefault,
    filterDateRange, // NEW: Prop for date filter value
    handleDateFilterChange, // NEW: Prop for date filter handler
}) => {
    const styles = {
        filterRow: {
            marginBottom: '24px',
            padding: '16px',
            backgroundColor: colors.grey[900],
            borderRadius: '4px'
        },
        filterFormControl: {
            minWidth: 150,
            '& .MuiInputLabel-root': { color: colors.grey[300], '&.Mui-focused': { color: colors.blueAccent[300] } },
            '& .MuiOutlinedInput-root': {
                color: colors.grey[100],
                '& .MuiOutlinedInput-notchedOutline': { borderColor: colors.grey[600] },
                '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: colors.primary[300] },
                '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: colors.blueAccent[400] },
                '& .MuiSelect-icon': { color: colors.grey[300] }
            }
        },
        resetButton: {
            color: colors.grey?.[300] || '#B0BEC5',
            borderColor: colors.grey?.[600] || '#616161',
            height: '40px',
            textTransform: 'none',
            '&:hover': {
                borderColor: colors.primary?.[300] || colors.grey?.[500] || '#757575',
                backgroundColor: alpha(colors.primary?.[700] || colors.grey?.[800] || '#2C2C2C', 0.3),
            },
            '&.Mui-disabled': {
                color: colors.grey?.[700] || '#424242',
                borderColor: colors.grey?.[800] || '#303030',
            }
        }
    };

    const commonMenuProps = {
        PaperProps: {
            sx: {
                backgroundColor: colors.grey[800],
                color: colors.grey[100],
                '& .MuiMenuItem-root:hover': {
                    backgroundColor: colors.blueAccent[700],
                    color: colors.grey[100],
                },
                '& .MuiMenuItem-root.Mui-selected': {
                    backgroundColor: colors.blueAccent[800] + '!important',
                },
                '& .MuiMenuItem-root.Mui-selected:hover': {
                    backgroundColor: colors.blueAccent[700] + '!important',
                }
            }
        }
    };

    const plotFilterDisabledReason = useMemo(() => {
        if (isDataLoading) return "";
        if (!canFetchPlots) {
            if (filterDivisionId === 'all') {
                return "Select a Division to enable Project and Plot filters.";
            }
            if (filterProjectId === 'all' || filterProjectId === 'unassigned') {
                return "Select a specific Project to enable Plot filter.";
            }
        }
        return "";
    }, [canFetchPlots, filterDivisionId, filterProjectId, isDataLoading]);


    return (
        <Box sx={styles.filterRow}>
            <Typography variant="h6" gutterBottom sx={{ color: colors.grey[100], mb: 2 }}>
                Filter Dashboard Data
            </Typography>
            {/* MODIFIED: Adjusted grid item sizing to fit the new filter */}
            <Grid container spacing={2} alignItems="center">
                {/* --- DIVISION FILTER --- */}
                <Grid item xs={12} sm={6} md={2.5}>
                    <FormControl fullWidth variant="outlined" size="small" sx={styles.filterFormControl}>
                        <InputLabel id="division-filter-label-dash">Filter Division</InputLabel>
                        <Select
                            labelId="division-filter-label-dash"
                            value={filterDivisionId}
                            label="Filter Division"
                            onChange={handleDivisionFilterChange}
                            disabled={isDataLoading}
                            MenuProps={commonMenuProps}
                        >
                            <MenuItem value="all"><em>All Divisions</em></MenuItem>
                            {loadingFilters ? <MenuItem disabled><CircularProgress size={20} sx={{ mr: 1 }} /> Loading...</MenuItem>
                                : (divisionsList || []).length === 0 ? <MenuItem disabled><em>No divisions</em></MenuItem>
                                    : (divisionsList || []).map(d => (<MenuItem key={d.id} value={d.id}>{d.name}</MenuItem>))
                            }
                        </Select>
                    </FormControl>
                </Grid>

                {/* --- PROJECT FILTER --- */}
                <Grid item xs={12} sm={6} md={2.5}>
                    <FormControl fullWidth variant="outlined" size="small" sx={styles.filterFormControl}>
                        <InputLabel id="project-filter-label-dash">Filter Project</InputLabel>
                        <Select
                            labelId="project-filter-label-dash"
                            value={filterProjectId}
                            label="Filter Project"
                            onChange={handleProjectFilterChange}
                            disabled={isDataLoading}
                            MenuProps={commonMenuProps}
                        >
                            <MenuItem value="all"><em>All Projects</em></MenuItem>
                            <MenuItem value="unassigned"><em>Unassigned</em></MenuItem>
                            {loadingFilters ? <MenuItem disabled><CircularProgress size={20} sx={{ mr: 1 }} /> Loading...</MenuItem>
                                : (filteredProjectsForDropdown || []).map(p => (
                                    <MenuItem key={p.id} value={p.id}>
                                        {p.name}{filterDivisionId === 'all' && p.division_name && ` (${p.division_name})`}
                                    </MenuItem>
                                ))
                            }
                        </Select>
                    </FormControl>
                </Grid>

                {/* --- PLOT FILTER --- */}
                <Grid item xs={12} sm={6} md={2.5}>
                    <MuiTooltip title={plotFilterDisabledReason} arrow placement="top">
                        <span>
                            <FormControl
                                fullWidth
                                variant="outlined"
                                size="small"
                                sx={{ ...styles.filterFormControl, ...((!canFetchPlots && !isDataLoading) && { opacity: 0.65, cursor: 'not-allowed' }) }}
                            >
                                <InputLabel id="plot-filter-label-dash">Filter Plot</InputLabel>
                                <Select
                                    labelId="plot-filter-label-dash"
                                    value={filterPlotName}
                                    label="Filter Plot"
                                    onChange={handlePlotFilterChange}
                                    disabled={!canFetchPlots || isDataLoading}
                                    MenuProps={commonMenuProps}
                                >
                                    <MenuItem value="all"><em>All Plots</em></MenuItem>
                                    {loadingPlots ? <MenuItem disabled><CircularProgress size={20} sx={{ mr: 1 }} /> Loading plots...</MenuItem>
                                        : (plotsList || []).length === 0 && canFetchPlots ? <MenuItem disabled><em>No plots in project</em></MenuItem>
                                            : (plotsList || []).map(plot => (<MenuItem key={plot} value={plot}>{plot}</MenuItem>))
                                    }
                                </Select>
                            </FormControl>
                        </span>
                    </MuiTooltip>
                </Grid>

                {/* --- NEW: DATE RANGE FILTER --- */}
                <Grid item xs={12} sm={6} md={2.5}>
                    <FormControl fullWidth variant="outlined" size="small" sx={styles.filterFormControl}>
                        <InputLabel id="date-filter-label-dash">Filter by Date</InputLabel>
                        <Select
                            labelId="date-filter-label-dash"
                            value={filterDateRange}
                            label="Filter by Date"
                            onChange={handleDateFilterChange}
                            disabled={isDataLoading}
                            MenuProps={commonMenuProps}
                        >
                            <MenuItem value="all"><em>All Time</em></MenuItem>
                            <MenuItem value="7d">Last 7 Days</MenuItem>
                            <MenuItem value="30d">Last 30 Days</MenuItem>
                            <MenuItem value="6m">Last 6 Months</MenuItem>
                            <MenuItem value="1y">Last 1 Year</MenuItem>
                        </Select>
                    </FormControl>
                </Grid>

                {/* --- RESET BUTTON --- */}
                <Grid item xs={12} sm={12} md={2}>
                    <Button
                        fullWidth
                        variant="outlined"
                        onClick={handleResetFilters}
                        disabled={isDataLoading || areFiltersDefault}
                        startIcon={<ReplayIcon />}
                        sx={{...styles.resetButton, height: '40px'}}
                    >
                        Reset
                    </Button>
                </Grid>
            </Grid>
        </Box>
    );
};

export default DashboardFilters;