import React, { useState, useMemo } from 'react';
import {
    Dialog, DialogTitle, DialogContent, DialogActions, Button, Typography, 
    Checkbox, FormControlLabel, Box, Divider, CircularProgress, Grid,
    FormControl, InputLabel, Select, MenuItem, Tooltip
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import ReplayIcon from '@mui/icons-material/Replay';

const ExportModal = ({
    open, colors, theme, files, exportSelectedFiles, handleCloseExportModal,
    handleExportFileSelection, handleSelectAllForExport, handleExportToExcel,
    divisionsList = [], filteredProjectsForDropdown = [], loadingProjectsList = false
}) => {
    // Local filter state for export modal (independent from main page filters)
    const [filterDivisionId, setFilterDivisionId] = useState('all');
    const [filterProjectId, setFilterProjectId] = useState('all');

    // Filter projects based on selected division
    const availableProjects = useMemo(() => {
        if (filterDivisionId === 'all') {
            return filteredProjectsForDropdown;
        }
        const numericDivisionId = parseInt(filterDivisionId, 10);
        if (isNaN(numericDivisionId)) {
            return [];
        }
        return filteredProjectsForDropdown.filter(p => p.division_id === numericDivisionId);
    }, [filteredProjectsForDropdown, filterDivisionId]);

    // Filter ready files based on selected division and project
    const filteredReadyFiles = useMemo(() => {
        let readyFiles = files.filter(file => file.status === 'ready');
        
        if (filterDivisionId !== 'all') {
            const numericDivisionId = parseInt(filterDivisionId, 10);
            if (!isNaN(numericDivisionId)) {
                readyFiles = readyFiles.filter(file => {
                    // File can have division_id property from backend
                    const fileDivisionId = typeof file.division_id === 'string' 
                        ? parseInt(file.division_id, 10) 
                        : file.division_id;
                    return fileDivisionId === numericDivisionId;
                });
            }
        }

        if (filterProjectId !== 'all' && filterProjectId !== 'unassigned') {
            const numericProjectId = parseInt(filterProjectId, 10);
            if (!isNaN(numericProjectId)) {
                readyFiles = readyFiles.filter(file => {
                    // File can have project_id property from backend
                    const fileProjectId = typeof file.project_id === 'string' 
                        ? parseInt(file.project_id, 10) 
                        : file.project_id;
                    return fileProjectId === numericProjectId;
                });
            }
        } else if (filterProjectId === 'unassigned') {
            readyFiles = readyFiles.filter(file => 
                !file.project_id || 
                file.project_id === null || 
                file.projectName === 'Unassigned'
            );
        }

        return readyFiles;
    }, [files, filterDivisionId, filterProjectId]);

    // Count only selected files that are in the filtered list
    const selectedCount = useMemo(() => {
        const filteredIds = new Set(filteredReadyFiles.map(f => f.id));
        return Array.from(exportSelectedFiles).filter(id => filteredIds.has(id)).length;
    }, [exportSelectedFiles, filteredReadyFiles]);

    const totalCount = filteredReadyFiles.length;
    const isAllSelected = selectedCount === totalCount && totalCount > 0;
    const isIndeterminate = selectedCount > 0 && selectedCount < totalCount;

    // Reset filters when modal closes
    const handleClose = () => {
        setFilterDivisionId('all');
        setFilterProjectId('all');
        handleCloseExportModal();
    };

    const handleDivisionFilterChange = (event) => {
        const newDivisionId = event.target.value;
        setFilterDivisionId(newDivisionId);
        
        // Reset project filter if division changes and current project is not valid for new division
        if (newDivisionId === 'all') {
            // Keep current project filter when showing all divisions
        } else {
            const numericDivisionId = parseInt(newDivisionId, 10);
            if (!isNaN(numericDivisionId)) {
                const currentProjectId = filterProjectId;
                if (currentProjectId !== 'all' && currentProjectId !== 'unassigned') {
                    const numericProjectId = parseInt(currentProjectId, 10);
                    const projectStillValid = availableProjects.find(
                        p => p.id === numericProjectId
                    );
                    if (!projectStillValid) {
                        setFilterProjectId('all');
                    }
                }
            }
        }
    };

    const handleProjectFilterChange = (event) => {
        setFilterProjectId(event.target.value);
    };

    const handleResetFilters = () => {
        setFilterDivisionId('all');
        setFilterProjectId('all');
    };

    const areFiltersDefault = filterDivisionId === 'all' && filterProjectId === 'all';

    const styles = {
        dialog: {
            '& .MuiDialog-paper': {
                backgroundColor: colors.grey[900],
                color: colors.grey[100],
                minWidth: '500px',
                maxWidth: '600px'
            }
        },
        title: {
            color: colors.grey[100],
            backgroundColor: colors.primary[700],
            padding: '16px 24px',
            margin: 0
        },
        content: {
            padding: '24px',
            maxHeight: '400px',
            overflowY: 'auto'
        },
        fileItem: {
            display: 'flex',
            alignItems: 'center',
            padding: '8px 0',
            borderBottom: `1px solid ${colors.grey[800]}`,
            '&:last-child': {
                borderBottom: 'none'
            }
        },
        fileInfo: {
            flex: 1,
            marginLeft: '12px'
        },
        fileName: {
            color: colors.grey[100],
            fontWeight: 'medium',
            fontSize: '0.9rem'
        },
        fileDetails: {
            color: colors.grey[400],
            fontSize: '0.8rem',
            marginTop: '2px'
        },
        actions: {
            padding: '16px 24px',
            backgroundColor: colors.primary[700],
            gap: '12px'
        },
        selectAllContainer: {
            padding: '12px 0',
            borderBottom: `1px solid ${colors.grey[700]}`,
            marginBottom: '12px'
        },
        summaryText: {
            color: colors.grey[300],
            fontSize: '0.9rem',
            marginTop: '8px'
        },
        filterContainer: {
            marginBottom: '16px',
            padding: '12px',
            backgroundColor: colors.grey[800],
            borderRadius: '8px'
        },
        filterFormControl: {
            minWidth: 140,
            width: '100%',
            '& .MuiInputLabel-root': {
                color: colors.grey[300],
                fontSize: '0.85rem',
                '&.Mui-focused': {
                    color: colors.blueAccent[300]
                }
            },
            '& .MuiOutlinedInput-root': {
                color: colors.grey[100],
                fontSize: '0.85rem',
                '& .MuiOutlinedInput-notchedOutline': {
                    borderColor: colors.grey[500]
                },
                '&:hover .MuiOutlinedInput-notchedOutline': {
                    borderColor: colors.primary[300]
                },
                '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
                    borderColor: colors.blueAccent[400]
                },
                '& .MuiSelect-icon': {
                    color: colors.grey[300]
                }
            }
        },
        resetButton: {
            height: '100%',
            color: colors.grey[300],
            borderColor: colors.grey[600],
            textTransform: 'none',
            fontSize: '0.85rem',
            '&:hover': {
                borderColor: colors.primary[300],
                backgroundColor: alpha(colors.primary[700] || '#2C2C2C', 0.3)
            },
            '&.Mui-disabled': {
                color: colors.grey[700],
                borderColor: colors.grey[800]
            }
        }
    };

    const handleExport = () => {
        console.log('DEBUG: ExportModal - exportSelectedFiles:', exportSelectedFiles);
        console.log('DEBUG: ExportModal - exportSelectedFiles size:', exportSelectedFiles.size);
        console.log('DEBUG: ExportModal - exportSelectedFiles as array:', Array.from(exportSelectedFiles));
        handleExportToExcel(exportSelectedFiles);
        handleClose();
    };

    return (
        <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth sx={styles.dialog}>
            <DialogTitle sx={styles.title}>
                <Box display="flex" alignItems="center" gap={1}>
                    <FileDownloadIcon />
                    <Typography variant="h6">Export Tree Data to Excel</Typography>
                </Box>
            </DialogTitle>
            
            <DialogContent sx={styles.content}>
                <Typography variant="body2" color={colors.grey[300]} sx={{ marginBottom: '16px', marginTop: '16px' }}>
                    Select the files you want to export. Only files with status "Ready" are available for export.
                </Typography>

                {/* Filter Section */}
                <Box sx={styles.filterContainer}>
                    <Grid container spacing={2} alignItems="center">
                        <Grid item xs={12} sm={4}>
                            <FormControl fullWidth variant="outlined" size="small" sx={styles.filterFormControl}>
                                <InputLabel id="export-division-filter-label">Division</InputLabel>
                                <Select
                                    labelId="export-division-filter-label"
                                    value={filterDivisionId}
                                    label="Division"
                                    onChange={handleDivisionFilterChange}
                                >
                                    <MenuItem value="all"><em>All Divisions</em></MenuItem>
                                    {divisionsList.map(d => (
                                        <MenuItem key={d.id} value={d.id}>{d.name}</MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                        </Grid>
                        <Grid item xs={12} sm={4}>
                            <FormControl fullWidth variant="outlined" size="small" sx={styles.filterFormControl}>
                                <InputLabel id="export-project-filter-label">Project</InputLabel>
                                <Select
                                    labelId="export-project-filter-label"
                                    value={filterProjectId}
                                    label="Project"
                                    onChange={handleProjectFilterChange}
                                >
                                    <MenuItem value="all"><em>All Projects</em></MenuItem>
                                    <MenuItem value="unassigned"><em>Unassigned</em></MenuItem>
                                    {loadingProjectsList ? (
                                        <MenuItem disabled>
                                            <CircularProgress size={16} sx={{ mr: 1 }} />
                                            Loading...
                                        </MenuItem>
                                    ) : (
                                        availableProjects.map(p => (
                                            <MenuItem key={p.id} value={p.id}>
                                                {p.name}
                                                {filterDivisionId === 'all' && ` (${p.division_name || 'No Div'})`}
                                            </MenuItem>
                                        ))
                                    )}
                                </Select>
                            </FormControl>
                        </Grid>
                        <Grid item xs={12} sm={4}>
                            <Tooltip title="Reset filters">
                                <span>
                                    <Button
                                        fullWidth
                                        variant="outlined"
                                        size="small"
                                        onClick={handleResetFilters}
                                        disabled={areFiltersDefault}
                                        startIcon={<ReplayIcon />}
                                        sx={styles.resetButton}
                                    >
                                        Reset
                                    </Button>
                                </span>
                            </Tooltip>
                        </Grid>
                    </Grid>
                </Box>

                {filteredReadyFiles.length === 0 ? (
                    <Box textAlign="center" py={4}>
                        <Typography color={colors.grey[500]}>
                            {files.filter(f => f.status === 'ready').length === 0
                                ? 'No ready files available for export.'
                                : 'No files match the current filters.'}
                        </Typography>
                    </Box>
                ) : (
                    <>
                        <Box sx={styles.selectAllContainer}>
                            <FormControlLabel
                                control={
                                    <Checkbox
                                        checked={isAllSelected}
                                        indeterminate={isIndeterminate}
                                        onChange={(e) => {
                                            // Only select/deselect filtered files
                                            filteredReadyFiles.forEach(file => {
                                                handleExportFileSelection(file.id, e.target.checked);
                                            });
                                        }}
                                        sx={{ color: colors.greenAccent[400] }}
                                    />
                                }
                                label={
                                    <Typography sx={{ color: colors.grey[100], fontWeight: 'medium' }}>
                                        Select All ({totalCount} file{totalCount !== 1 ? 's' : ''})
                                    </Typography>
                                }
                            />
                            <Typography sx={styles.summaryText}>
                                {selectedCount} of {totalCount} file{totalCount !== 1 ? 's' : ''} selected
                            </Typography>
                        </Box>

                        

                        {filteredReadyFiles.map((file) => (
                            <Box key={file.id} sx={styles.fileItem}>
                                <Checkbox
                                    checked={exportSelectedFiles.has(file.id)}
                                    onChange={(e) => handleExportFileSelection(file.id, e.target.checked)}
                                    sx={{ color: colors.greenAccent[400] }}
                                />
                                <Box sx={styles.fileInfo}>
                                    <Typography sx={styles.fileName}>
                                        {file.name}
                                    </Typography>
                                    <Typography sx={styles.fileDetails}>
                                        {file.plot_name && `Plot: ${file.plot_name} • `}
                                        {file.projectName && `Project: ${file.projectName} • `}
                                        {file.divisionName && `Division: ${file.divisionName} • `}
                                        Uploaded: {file.uploadDate}
                                    </Typography>
                                </Box>
                            </Box>
                        ))}
                    </>
                )}
            </DialogContent>

            <DialogActions sx={styles.actions}>
                <Button 
                    onClick={handleClose}
                    sx={{ color: colors.grey[300] }}
                >
                    Cancel
                </Button>
                <Button
                    onClick={handleExport}
                    variant="contained"
                    startIcon={<FileDownloadIcon />}
                    disabled={selectedCount === 0}
                    sx={{
                        backgroundColor: colors.greenAccent[600],
                        color: 'white',
                        '&:hover': {
                            backgroundColor: colors.greenAccent[500]
                        },
                        '&:disabled': {
                            backgroundColor: colors.grey[600],
                            color: colors.grey[400]
                        }
                    }}
                >
                    Export {selectedCount > 0 ? `${selectedCount} File${selectedCount > 1 ? 's' : ''}` : 'Files'}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default ExportModal;
