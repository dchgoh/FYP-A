import React from 'react';

// This array is now the single source of truth for your navigation.
// To add, remove, or change a page, you only need to edit this file.
export const routes = [
    {
        title: 'Dashboard',
        to: '/',
        icon: <span className="material-symbols-outlined">home</span>,
        // No role means it's visible to everyone
    },
    {
        title: 'Manage Team',
        to: '/team',
        icon: <span className="material-symbols-outlined">group</span>,
        roles: ['administrator', 'data manager'], // Only visible to these roles
    },
    {
        title: 'File Management', // Consistent title
        to: '/upload',
        icon: <span className="material-symbols-outlined">home_storage</span>,
    },
    {
        title: 'Map Overview',
        to: '/map',
        icon: <span className="material-symbols-outlined">map</span>,
    },
];