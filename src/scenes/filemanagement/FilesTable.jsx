import React, { useState } from 'react';
import { Box, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper, Typography, IconButton, Menu, MenuItem, CircularProgress, ListItemIcon, ListItemText, Checkbox } from '@mui/material';
import VisibilityIcon from '@mui/icons-material/Visibility';
import TransformIcon from '@mui/icons-material/Transform';
import DownloadIcon from '@mui/icons-material/Download';
import DeleteIcon from '@mui/icons-material/Delete';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import AssignmentIcon from '@mui/icons-material/Assignment';
import StopIcon from '@mui/icons-material/Stop';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';

const ACTIVE_PIPELINE_PROCESSING_STATUSES = ['segmenting', 'processing_las_data', 'processing'];

const FilesTable = ({
    colors, theme, files, isLoading, isLoadingPermissions, selectedFileIds,
    handleSelectAllClick, handleRowCheckboxClick, canPerformAction,
    filesBeingProcessed, deletingProjectId, deletingDivisionId, isDeletingBulk,
    handleDownload, handleRemove, handleViewPointCloud, handleStopProcessing, handleStartProcessing,
    handleOpenReassignModal, numTotalSelectableForDelete
}) => {
    const [anchorEl, setAnchorEl] = useState(null);
    const [selectedFile, setSelectedFile] = useState(null);

    const handleMenuClick = (event, file) => { event.stopPropagation(); setAnchorEl(event.currentTarget); setSelectedFile(file); };
    const handleMenuClose = (event) => { event.stopPropagation(); setAnchorEl(null); };

    const styles = {
        tableContainer: { marginTop: selectedFileIds.size > 0 ? 1 : 2, backgroundColor: colors.grey[900], borderRadius: 2, maxHeight: `calc(100vh - ${selectedFileIds.size > 0 ? '340px' : '280px'})`, overflow: 'auto', position: 'relative', "&::-webkit-scrollbar": { width: "8px", height: "8px" }, "&::-webkit-scrollbar-track": { background: colors.grey?.[700] }, "&::-webkit-scrollbar-thumb": { backgroundColor: colors.grey?.[500], borderRadius: "10px" } },
        table: { minWidth: { xs: 600, md: 750, lg: 900 }, width: '100%' },
        tableHead: { backgroundColor: colors.primary[700], position: 'sticky', top: 0, zIndex: 1 },
        headCell: { color: colors.grey?.[100], fontWeight: "bold", whiteSpace: 'nowrap', borderBottom: `1px solid ${colors.grey[700]}`, p: { xs: '12px 6px', sm: '16px 8px' }, fontSize: { xs: '0.75rem', sm: '0.875rem' } },
        bodyCell: { color: colors.grey?.[100], overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', borderBottom: `1px solid ${colors.grey[800]}`, p: { xs: '6px 6px', sm: '8px 8px' }, fontSize: { xs: '0.75rem', sm: '0.875rem' }, maxWidth: 150 },
        actionButton: { color: colors.grey?.[300], padding: { xs: '2px', sm: '4px' }, '&:hover': { color: colors.blueAccent?.[400], backgroundColor: 'rgba(0, 123, 255, 0.1)' }, '&.Mui-disabled': { color: colors.grey?.[600] } },
        statusText: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', fontSize: { xs: '0.7rem', sm: '0.8rem' } },
        menuItemIcon: { minWidth: '36px', color: 'inherit' },
        loadingOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0, 0, 0, 0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 2, borderRadius: 'inherit' },
    };

    if (isLoading && !isDeletingBulk) {
        return (<Box sx={{...styles.tableContainer, display: 'flex', justifyContent: 'center', alignItems: 'center'}}><CircularProgress /></Box>);
    }

    if (!isLoading && files.length === 0 && !isLoadingPermissions) {
        return (<Typography sx={{ textAlign: 'center', p: 4, color: colors.grey[500], fontStyle: 'italic' }}>No files found for the current filter.</Typography>);
    }

    return (
        <TableContainer component={Paper} sx={styles.tableContainer}>
            <Table sx={styles.table} aria-label="file table" size="small">
                <TableHead sx={styles.tableHead}>
                    <TableRow>
                        <TableCell padding="checkbox" sx={styles.headCell}><Checkbox indeterminate={selectedFileIds.size > 0 && selectedFileIds.size < numTotalSelectableForDelete} checked={numTotalSelectableForDelete > 0 && selectedFileIds.size === numTotalSelectableForDelete} onChange={handleSelectAllClick} disabled={isDeletingBulk || numTotalSelectableForDelete === 0} /></TableCell>
                        <TableCell sx={styles.headCell}>Name</TableCell>
                        <TableCell sx={styles.headCell}>Plot</TableCell>
                        <TableCell sx={styles.headCell}>Division</TableCell>
                        <TableCell sx={styles.headCell}>Project</TableCell>
                        <TableCell sx={styles.headCell}>Size</TableCell>
                        <TableCell sx={styles.headCell}>Uploaded</TableCell>
                        <TableCell sx={{...styles.headCell, textAlign:'center'}}>Status</TableCell>
                        <TableCell sx={{...styles.headCell, textAlign:'center'}}>Actions</TableCell>
                    </TableRow>
                </TableHead>
                <TableBody>
                    {files.map((file) => {
                        const isSelected = selectedFileIds.has(file.id);
                        const isReady = file.status === 'ready';
                        const isEffectivelyConverting = ACTIVE_PIPELINE_PROCESSING_STATUSES.includes(file.status) || filesBeingProcessed.has(file.id);
                        const isGlobalDeleteActive = !!deletingProjectId || !!deletingDivisionId || isDeletingBulk;
                        const canDeleteThisFile = canPerformAction('delete', file);

                        let statusText = "Not Ready"; let statusColor = colors.grey[500];
                        if (isReady) { statusText = "Ready"; statusColor = colors.greenAccent[400]; }
                        else if (isEffectivelyConverting) { statusText = "Processing..."; statusColor = colors.blueAccent[300]; }
                        else if (file.status === 'stopped') { statusText = "Stopped"; statusColor = colors.orangeAccent ? colors.orangeAccent[400] : colors.grey[400]; }
                        else if (file.status === 'failed' || file.status.startsWith('error')) { statusText = "Failed"; statusColor = colors.redAccent[400]; }
                        else if (file.status === 'uploaded') { statusText = "Queued"; statusColor = colors.orangeAccent ? colors.orangeAccent[400] : colors.grey[400]; }

                        const hasAnyAction = canPerformAction('reassign', file) || canPerformAction('download', file) || (canPerformAction('view', file) && isReady) || canDeleteThisFile;

                        const progressPercent = (() => {
                            const candidates = [
                                file?.segmentation_progress,
                                file?.processing_progress,
                                file?.progress_percent,
                                file?.progress
                            ];
                            for (const val of candidates) {
                                if (typeof val === 'number' && !isNaN(val)) return Math.round(val);
                            }
                            return null;
                        })();

                        return (
                            <TableRow key={file.id} hover selected={isSelected} onClick={() => { if (!isEffectivelyConverting && canDeleteThisFile && !isGlobalDeleteActive) { handleRowCheckboxClick({ target: { checked: !isSelected } }, file.id); } }} sx={{ opacity: isEffectivelyConverting || isGlobalDeleteActive ? 0.6 : 1, cursor: (!isEffectivelyConverting && canDeleteThisFile && !isGlobalDeleteActive) ? 'pointer' : 'default', backgroundColor: isSelected ? `${colors.blueAccent[800]} !important` : 'transparent' }}>
                                <TableCell padding="checkbox"><Checkbox checked={isSelected} onChange={(event) => handleRowCheckboxClick(event, file.id)} onClick={(e) => e.stopPropagation()} disabled={isEffectivelyConverting || !canDeleteThisFile || isGlobalDeleteActive} /></TableCell>
                                <TableCell sx={{ ...styles.bodyCell, maxWidth: 250 }} title={file.name}>{file.name}</TableCell>
                                <TableCell sx={styles.bodyCell}>{file.plot_name || 'N/A'}</TableCell>
                                <TableCell sx={styles.bodyCell}>{file.divisionName}</TableCell>
                                <TableCell sx={styles.bodyCell} title={file.projectName}>{file.projectName}</TableCell>
                                <TableCell sx={styles.bodyCell}>{file.size}</TableCell>
                                <TableCell sx={styles.bodyCell}>{file.uploadDate}</TableCell>
                                <TableCell sx={{ ...styles.bodyCell, textAlign: 'center' }}>
                                    {isEffectivelyConverting ? (
                                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1 }}>
                                            <Box sx={styles.statusText}>
                                                <CircularProgress size={16} sx={{ color: statusColor }} />
                                                <Typography variant="caption" sx={{ color: statusColor, ml: 0.5 }}>
                                                    {statusText}{progressPercent !== null ? ` ${progressPercent}%` : ''}
                                                </Typography>
                                            </Box>
                                            {canPerformAction('stop', file) && (
                                                <IconButton 
                                                    size="small" 
                                                    onClick={(e) => { e.stopPropagation(); handleStopProcessing(file); }}
                                                    sx={{ 
                                                        color: colors.redAccent[400], 
                                                        padding: '2px',
                                                        '&:hover': { 
                                                            backgroundColor: 'rgba(244, 67, 54, 0.1)',
                                                            color: colors.redAccent[300]
                                                        }
                                                    }}
                                                    title="Stop Processing"
                                                >
                                                    <StopIcon fontSize="small" />
                                                </IconButton>
                                            )}
                                        </Box>
                                    ) : file.status === 'stopped' ? (
                                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1 }}>
                                            <Typography variant="caption" sx={{ color: statusColor }}>{statusText}</Typography>
                                            {canPerformAction('start', file) && (
                                                <IconButton 
                                                    size="small" 
                                                    onClick={(e) => { e.stopPropagation(); handleStartProcessing(file); }}
                                                    sx={{ 
                                                        color: colors.greenAccent[400], 
                                                        padding: '2px',
                                                        '&:hover': { 
                                                            backgroundColor: 'rgba(76, 175, 80, 0.1)',
                                                            color: colors.greenAccent[300]
                                                        }
                                                    }}
                                                    title="Start Processing"
                                                >
                                                    <PlayArrowIcon fontSize="small" />
                                                </IconButton>
                                            )}
                                        </Box>
                                    ) : (
                                        <Typography variant="caption" sx={{ color: statusColor }}>{statusText}</Typography>
                                    )}
                                </TableCell>
                                <TableCell sx={{ ...styles.bodyCell, textAlign: 'center' }}>
                                    <IconButton aria-label={`actions for ${file.name}`} onClick={(e) => handleMenuClick(e, file)} sx={styles.actionButton} size="small" disabled={isEffectivelyConverting || !hasAnyAction || isGlobalDeleteActive} title="More Actions">
                                        <MoreVertIcon fontSize="small" />
                                    </IconButton>
                                    <Menu anchorEl={anchorEl} open={Boolean(anchorEl) && selectedFile?.id === file.id} onClose={handleMenuClose} PaperProps={{ sx: { backgroundColor: colors.primary[800], color: colors.grey[100] } }}>
                                        {canPerformAction('reassign', file) && (
                                            <MenuItem onClick={(event) => { handleMenuClose(event); handleOpenReassignModal(selectedFile); }}>
                                                <ListItemIcon sx={styles.menuItemIcon}><AssignmentIcon fontSize="small" /></ListItemIcon>
                                                <ListItemText>Edit / Reassign</ListItemText>
                                            </MenuItem>
                                        )}

                                        {canPerformAction('download', file) && (
                                            <MenuItem onClick={(event) => { handleMenuClose(event); handleDownload(selectedFile); }}>
                                                <ListItemIcon sx={styles.menuItemIcon}><DownloadIcon fontSize="small" /></ListItemIcon>
                                                <ListItemText>Download</ListItemText>
                                            </MenuItem>
                                        )}

                                        {canPerformAction('view', file) && isReady && (
                                            <MenuItem onClick={(event) => { handleMenuClose(event); handleViewPointCloud(selectedFile); }}>
                                                <ListItemIcon sx={styles.menuItemIcon}><VisibilityIcon fontSize="small" /></ListItemIcon>
                                                <ListItemText>View Point Cloud</ListItemText>
                                            </MenuItem>
                                        )}

                                        {canDeleteThisFile && (
                                            <MenuItem onClick={(event) => { handleMenuClose(event); handleRemove(selectedFile); }} sx={{ color: colors.redAccent[400] }}>
                                                <ListItemIcon sx={styles.menuItemIcon}><DeleteIcon fontSize="small" /></ListItemIcon>
                                                <ListItemText>Remove File</ListItemText>
                                            </MenuItem>
                                        )}
                                        
                                    </Menu>
                                </TableCell>
                            </TableRow>
                        );
                    })}
                </TableBody>
            </Table>
        </TableContainer>
    );
};
export default FilesTable;
