import React from 'react';
import {
    Dialog, DialogTitle, DialogContent, DialogActions, Button, Typography, 
    Checkbox, FormControlLabel, Box, Divider, CircularProgress
} from '@mui/material';
import FileDownloadIcon from '@mui/icons-material/FileDownload';

const ExportModal = ({
    open, colors, theme, files, exportSelectedFiles, handleCloseExportModal,
    handleExportFileSelection, handleSelectAllForExport, handleExportToExcel
}) => {
    const readyFiles = files.filter(file => file.status === 'ready');
    const selectedCount = exportSelectedFiles.size;
    const totalCount = readyFiles.length;
    const isAllSelected = selectedCount === totalCount && totalCount > 0;
    const isIndeterminate = selectedCount > 0 && selectedCount < totalCount;

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
            backgroundColor: colors.grey[800],
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
        }
    };

    const handleExport = () => {
        handleExportToExcel(exportSelectedFiles);
        handleCloseExportModal();
    };

    return (
        <Dialog open={open} onClose={handleCloseExportModal} maxWidth="md" fullWidth sx={styles.dialog}>
            <DialogTitle sx={styles.title}>
                <Box display="flex" alignItems="center" gap={1}>
                    <FileDownloadIcon />
                    <Typography variant="h6">Export Tree Data to Excel</Typography>
                </Box>
            </DialogTitle>
            
            <DialogContent sx={styles.content}>
                <Typography variant="body2" color={colors.grey[300]} sx={{ marginBottom: '16px' }}>
                    Select the files you want to export. Only files with status "Ready" are available for export.
                </Typography>

                {readyFiles.length === 0 ? (
                    <Box textAlign="center" py={4}>
                        <Typography color={colors.grey[500]}>
                            No ready files available for export.
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
                                        onChange={(e) => handleSelectAllForExport(e.target.checked)}
                                        sx={{ color: colors.greenAccent[400] }}
                                    />
                                }
                                label={
                                    <Typography sx={{ color: colors.grey[100], fontWeight: 'medium' }}>
                                        Select All ({totalCount} files)
                                    </Typography>
                                }
                            />
                            <Typography sx={styles.summaryText}>
                                {selectedCount} of {totalCount} files selected
                            </Typography>
                        </Box>

                        <Divider sx={{ backgroundColor: colors.grey[700], marginBottom: '12px' }} />

                        {readyFiles.map((file) => (
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
                    onClick={handleCloseExportModal}
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
