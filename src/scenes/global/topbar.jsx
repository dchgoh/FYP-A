import { Box, IconButton, useTheme, Typography } from "@mui/material";
import { useContext, useState, useEffect } from "react";
import { ColorModeContext } from "../../theme";
import { useLocation } from "react-router-dom";
import { routes } from "../../routesConfig"; // <-- IMPORT the new config

const Topbar = ({ isCollapsed, handleLogout }) => {
    const theme = useTheme();
    const colorMode = useContext(ColorModeContext);
    const location = useLocation();
    const [pageTitle, setPageTitle] = useState("Dashboard");

    // This useEffect is now much simpler and more reliable.
    useEffect(() => {
        const currentRoute = routes.find(route => route.to === location.pathname);
        if (currentRoute) {
            setPageTitle(currentRoute.title);
        } else {
             // Handle dynamic paths like /pointcloud/some-id if needed
            if (location.pathname.startsWith("/pointcloud")) {
                setPageTitle("Point Cloud Viewer");
            } else {
                setPageTitle("Dashboard"); // Default fallback
            }
        }
    }, [location.pathname]);

    return (
        <Box
            display="flex"
            justifyContent="space-between"
            alignItems="center"
            p={{ xs: 1, sm: 2 }}
            sx={{
                position: 'relative',
                marginLeft: isCollapsed ? "80px" : "270px",
                transition: "margin-left 0.3s ease",
            }}
        >
            {/* PAGE TITLE */}
            <Box display="flex" alignItems="center" sx={{ flexGrow: 1, minWidth: 0 }}>
                <Typography
                    variant="h3"
                    fontWeight="bold"
                    sx={{
                        fontSize: { xs: "1.1rem", sm: "1.4rem", md: "1.8rem" },
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        color: theme.palette.text.primary,
                    }}
                >
                    {pageTitle}
                </Typography>
            </Box>

            {/* COMPANY LOGO - Absolutely Centered */}
            <Box
                display={{ xs: 'none', md: 'flex' }}
                justifyContent="center"
                alignItems="center"
                sx={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}
            >
                <Box
                    component="img"
                    src="/assets/logo.png" // <-- Use absolute path from public folder
                    alt="Company Logo"
                    sx={{ maxHeight: { md: '60px' }, maxWidth: { md: '130px' }, display: 'block' }}
                />
            </Box>

            {/* ICONS */}
            <Box display="flex" alignItems="center">
                <IconButton onClick={colorMode.toggleColorMode} aria-label="toggle color mode">
                    {theme.palette.mode === "dark" ? (
                        <span className="material-symbols-outlined">dark_mode</span>
                    ) : (
                        <span className="material-symbols-outlined">light_mode</span>
                    )}
                </IconButton>
                <IconButton onClick={handleLogout} title="Logout" aria-label="logout">
                    <span className="material-symbols-outlined">logout</span>
                </IconButton>
            </Box>
        </Box>
    );
};

export default Topbar;