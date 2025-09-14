import React from 'react';
import { Paper, Box, Typography, Tooltip, Checkbox, Button, CircularProgress } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';

const BulkActionsBar = ({
    colors, theme, selectedFileIds, numTotalSelectableForDelete, setSelectedFileIds,
    isDeletingBulk, handleBulkDelete, isLoading, deletingProjectId, deletingDivisionId
}) => {
    if (selectedFileIds.size === 0) {
        return null;
    }

    return (
        <Paper
            elevation={3}
            sx={{ padding: theme.spacing(1.5, 2), mb: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.primary[700], border: `1px solid ${colors.blueAccent[700]}`, borderRadius: '4px', position: 'sticky', top: theme.spacing(1), zIndex: 2 }}
        >
            <Box display="flex" alignItems="center">
                <Tooltip title="Clear selection" arrow>
                    <span><Checkbox checked={selectedFileIds.size > 0} indeterminate={selectedFileIds.size > 0 && selectedFileIds.size < numTotalSelectableForDelete} onClick={() => setSelectedFileIds(new Set())} size="small" sx={{ color: colors.blueAccent[200], '&.Mui-checked': { color: colors.blueAccent[300] }, '&.Mui-disabled': { color: colors.grey[600] }, mr: 1 }} disabled={isDeletingBulk} /></span>
                </Tooltip>
                <Typography sx={{ color: colors.grey[100], fontWeight: 'bold' }}>
                    {selectedFileIds.size} file(s) selected
                </Typography>
            </Box>
            <Tooltip title="Delete selected files">
                <span><Button variant="contained" startIcon={isDeletingBulk ? <CircularProgress size={20} color="inherit" /> : <DeleteIcon />} onClick={handleBulkDelete} disabled={isDeletingBulk || isLoading || !!deletingProjectId || !!deletingDivisionId} sx={{ backgroundColor: colors.redAccent[600], color: colors.grey[100], '&:hover': { backgroundColor: colors.redAccent[700] }, '&.Mui-disabled': { backgroundColor: colors.grey[700], color: colors.grey[500] } }}>Delete Selected</Button></span>
            </Tooltip>
        </Paper>
    );
};

export default BulkActionsBar;