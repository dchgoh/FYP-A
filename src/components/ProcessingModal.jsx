import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  LinearProgress,
  Chip,
  IconButton,
  Collapse,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  Divider,
  Paper,
  useTheme
} from '@mui/material';
import {
  Close as CloseIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  CheckCircle as CheckCircleIcon,
  Error as ErrorIcon,
  Info as InfoIcon,
  Warning as WarningIcon,
  PlayArrow as PlayArrowIcon,
  Pause as PauseIcon
} from '@mui/icons-material';

const ProcessingModal = ({ 
  open, 
  onClose, 
  processingFiles = [], 
  onToggleModal 
}) => {
  const theme = useTheme();
  const [expandedFiles, setExpandedFiles] = useState(new Set());
  const [autoRefresh, setAutoRefresh] = useState(true);

  // Auto-refresh every 2 seconds when modal is open
  useEffect(() => {
    if (!open || !autoRefresh) return;
    
    const interval = setInterval(() => {
      // Trigger a refresh of the parent component's data
      if (onToggleModal) {
        onToggleModal();
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [open, autoRefresh, onToggleModal]);

  // Debug logging for processing files
  useEffect(() => {
    if (processingFiles.length > 0) {
      console.log('ProcessingModal: Processing files received:', processingFiles);
      processingFiles.forEach(file => {
        if (file.processing_progress) {
          console.log(`ProcessingModal: File ${file.id} has progress data:`, file.processing_progress);
        }
      });
    }
  }, [processingFiles]);

  const handleToggleExpanded = (fileId) => {
    setExpandedFiles(prev => {
      const newSet = new Set(prev);
      if (newSet.has(fileId)) {
        newSet.delete(fileId);
      } else {
        newSet.add(fileId);
      }
      return newSet;
    });
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'uploaded':
        return 'info';
      case 'processing_las_data':
        return 'warning';
      case 'segmenting':
        return 'primary';
      case 'ready':
        return 'success';
      case 'failed':
      case 'error_las_processing':
      case 'error_segmentation':
      default:
        return 'default';
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'ready':
        return <CheckCircleIcon />;
      case 'failed':
      case 'error_las_processing':
      case 'error_segmentation':
      case 'processing_las_data':
      case 'segmenting':
      default:
        return <InfoIcon />;
    }
  };

  const getStatusMessage = (status, processingProgress = null) => {
    switch (status) {
      case 'uploaded':
        return 'File uploaded, waiting for processing...';
      case 'processing_las_data':
        return 'Processing LAS data and extracting tree information...';
      case 'segmenting':
        if (processingProgress) {
          return `AI Segmentation Progress: ${processingProgress.percentage}% complete (${processingProgress.current}/${processingProgress.total} chunks)`;
        }
        return 'Starting AI segmentation to identify tree components...';
      case 'ready':
        return 'Processing completed successfully!';
      case 'failed':
        return 'Processing failed';
      case 'error_las_processing':
        return 'LAS data processing failed';
      case 'error_segmentation':
        return 'AI segmentation failed';
      default:
        return 'Unknown status';
    }
  };

  const getProgressValue = (status, processingProgress = null) => {
    switch (status) {
      case 'uploaded':
        return 10;
      case 'processing_las_data':
        return 30;
      case 'segmenting':
        if (processingProgress && processingProgress.percentage) {
          // For segmentation, show the actual segmentation progress (0-100%)
          // This makes the progress bar start from 0% when segmentation begins
          return processingProgress.percentage;
        }
        return 0; // Start at 0% when segmentation begins but no progress data yet
      case 'ready':
        return 100;
      case 'failed':
      case 'error_las_processing':
      case 'error_segmentation':
      default:
        return 0;
    }
  };

  const isProcessing = (status) => {
    return ['uploaded', 'processing_las_data', 'segmenting'].includes(status);
  };

  const hasError = (status) => {
    return ['failed', 'error_las_processing', 'error_segmentation'].includes(status);
  };

  const processingCount = processingFiles.filter(file => isProcessing(file.status)).length;
  const completedCount = processingFiles.filter(file => file.status === 'ready').length;
  const errorCount = processingFiles.filter(file => hasError(file.status)).length;

  return (
    <Dialog 
      open={open} 
      onClose={onClose}
      maxWidth="md"
      fullWidth
      PaperProps={{
        sx: {
          minHeight: '500px',
          maxHeight: '80vh'
        }
      }}
    >
      <DialogTitle sx={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center',
        pb: 1
      }}>
        <Box>
          <Typography variant="h6" component="div">
            File Processing Status
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {processingCount} processing • {completedCount} completed • {errorCount} errors
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <IconButton
            onClick={() => setAutoRefresh(!autoRefresh)}
            size="small"
            color={autoRefresh ? 'primary' : 'default'}
            title={autoRefresh ? 'Auto-refresh enabled' : 'Auto-refresh disabled'}
          >
            {autoRefresh ? <PauseIcon /> : <PlayArrowIcon />}
          </IconButton>
          <IconButton onClick={onClose} size="small">
            <CloseIcon />
          </IconButton>
        </Box>
      </DialogTitle>

      <DialogContent sx={{ p: 0 }}>
        {processingFiles.length === 0 ? (
          <Box sx={{ 
            display: 'flex', 
            flexDirection: 'column', 
            alignItems: 'center', 
            justifyContent: 'center', 
            py: 4,
            textAlign: 'center'
          }}>
            <InfoIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 2 }} />
            <Typography variant="h6" color="text.secondary">
              No files currently processing
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Upload a file to see processing status here
            </Typography>
          </Box>
        ) : (
          <List sx={{ p: 0 }}>
            {processingFiles.map((file, index) => (
              <React.Fragment key={file.id}>
                <ListItem 
                  sx={{ 
                    flexDirection: 'column', 
                    alignItems: 'stretch',
                    py: 2,
                    px: 3
                  }}
                >
                  <Box sx={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'space-between',
                    width: '100%',
                    mb: 1
                  }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flex: 1 }}>
                      {getStatusIcon(file.status)}
                      <Typography variant="subtitle1" sx={{ fontWeight: 500 }}>
                        {file.name}
                      </Typography>
                      <Chip 
                        label={file.status.replace(/_/g, ' ').toUpperCase()} 
                        color={getStatusColor(file.status)}
                        size="small"
                        variant={isProcessing(file.status) ? 'filled' : 'outlined'}
                      />
                    </Box>
                    <IconButton
                      onClick={() => handleToggleExpanded(file.id)}
                      size="small"
                    >
                      {expandedFiles.has(file.id) ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                    </IconButton>
                  </Box>

                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    {getStatusMessage(file.status, file.processing_progress)}
                  </Typography>

                  {/* ETA Display for segmentation */}
                  {file.status === 'segmenting' && file.processing_progress && (
                    <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
                      ETA: {file.processing_progress.eta} | Rate: {file.processing_progress.rate}
                    </Typography>
                  )}

                  <LinearProgress
                    variant={isProcessing(file.status) && !file.processing_progress ? 'indeterminate' : 'determinate'}
                    value={getProgressValue(file.status, file.processing_progress)}
                    color={hasError(file.status) ? 'error' : getStatusColor(file.status)}
                    sx={{ 
                      height: 6, 
                      borderRadius: 3,
                      mb: 1
                    }}
                  />

                  <Collapse in={expandedFiles.has(file.id)}>
                    <Paper 
                      variant="outlined" 
                      sx={{ 
                        p: 2, 
                        mt: 1, 
                        bgcolor: 'background.default'
                      }}
                    >
                      <Typography variant="subtitle2" gutterBottom>
                        File Details
                      </Typography>
                      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, mb: 2 }}>
                        <Typography variant="body2">
                          <strong>Size:</strong> {file.size || 'N/A'}
                        </Typography>
                        <Typography variant="body2">
                          <strong>Upload Date:</strong> {file.uploadDate || 'N/A'}
                        </Typography>
                        <Typography variant="body2">
                          <strong>Project:</strong> {file.projectName || 'Unassigned'}
                        </Typography>
                        <Typography variant="body2">
                          <strong>Division:</strong> {file.divisionName || 'N/A'}
                        </Typography>
                      </Box>
                      
                      {file.processing_progress && (
                        <Box sx={{ mt: 2 }}>
                          <Typography variant="subtitle2" gutterBottom>
                            Processing Progress
                          </Typography>
                          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, mb: 1 }}>
                            <Typography variant="body2">
                              <strong>Progress:</strong> {file.processing_progress.percentage}%
                            </Typography>
                            <Typography variant="body2">
                              <strong>Chunks:</strong> {file.processing_progress.current}/{file.processing_progress.total}
                            </Typography>
                            <Typography variant="body2">
                              <strong>Elapsed:</strong> {file.processing_progress.elapsed}
                            </Typography>
                            <Typography variant="body2">
                              <strong>ETA:</strong> {file.processing_progress.eta}
                            </Typography>
                            <Typography variant="body2" sx={{ gridColumn: '1 / -1' }}>
                              <strong>Rate:</strong> {file.processing_progress.rate}
                            </Typography>
                          </Box>
                        </Box>
                      )}

                      {file.processing_error && (
                        <Box sx={{ mt: 2 }}>
                          <Typography variant="subtitle2" color="error" gutterBottom>
                            Error Details
                          </Typography>
                          <Typography 
                            variant="body2" 
                            color="error" 
                            sx={{ 
                              fontFamily: 'monospace',
                              bgcolor: 'error.light',
                              p: 1,
                              borderRadius: 1,
                              wordBreak: 'break-word'
                            }}
                          >
                            {file.processing_error}
                          </Typography>
                        </Box>
                      )}

                      {file.tree_count && (
                        <Box sx={{ mt: 2 }}>
                          <Typography variant="subtitle2" gutterBottom>
                            Processing Results
                          </Typography>
                          <Typography variant="body2">
                            <strong>Trees Detected:</strong> {file.tree_count}
                          </Typography>
                        </Box>
                      )}
                    </Paper>
                  </Collapse>
                </ListItem>
                {index < processingFiles.length - 1 && <Divider />}
              </React.Fragment>
            ))}
          </List>
        )}
      </DialogContent>

      <DialogActions sx={{ p: 2, pt: 1 }}>
        <Button onClick={onClose} variant="outlined">
          Close
        </Button>
        <Button 
          onClick={() => {
            if (onToggleModal) onToggleModal();
          }} 
          variant="contained"
          startIcon={<PlayArrowIcon />}
        >
          Refresh Status
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default ProcessingModal;
