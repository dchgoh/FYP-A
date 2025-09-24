import React from 'react';
import { Card, Typography, Box, CircularProgress } from '@mui/material';

const StatCard = ({ title, value, icon, isLoading, colors }) => {
    const styles = {
        card: { minHeight: 150, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", p: 2, bgcolor: colors.grey[900], position: 'relative' },
        cardTitle: { mb: 1, fontWeight: "bold", color: colors.grey[100], textAlign: 'center' },
        cardIconBox: { display: "flex", alignItems: "center", gap: 1, color: colors.blueAccent[400], textAlign: 'center' },
        body2Text: { fontWeight: "bold", color: colors.blueAccent[300] },
        cardLoadingOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0, 0, 0, 0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 2, borderRadius: 'inherit', color: colors.grey[100] },
    };

    return (
        <Card sx={styles.card}>
            {isLoading && (<Box sx={styles.cardLoadingOverlay}><CircularProgress color="inherit" size={30} /></Box>)}
            <Typography variant="h1" sx={{ ...styles.cardTitle, fontSize: { xs: '2rem', md: '3rem' }, visibility: isLoading ? 'hidden' : 'visible' }}>
                {value === 'Error' ? 'N/A' : value ?? '-'}
            </Typography>
            <Box sx={{ ...styles.cardIconBox, visibility: isLoading ? 'hidden' : 'visible' }}>
                <span className="material-symbols-outlined" style={{ fontSize: '1.8rem' }}>{icon}</span>
                <Typography variant="body2" sx={styles.body2Text}>{title}</Typography>
            </Box>
        </Card>
    );
};

export default StatCard;