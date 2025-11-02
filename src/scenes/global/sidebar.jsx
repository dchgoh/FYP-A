import React, { useState, useEffect } from "react";
import { ProSidebar, Menu, MenuItem } from "react-pro-sidebar";
import { Box, IconButton, Typography, useTheme } from "@mui/material";
import { Link, useLocation } from "react-router-dom";
import "react-pro-sidebar/dist/css/styles.css";
import { tokens } from "../../theme";
import { routes } from "../../routesConfig";
import MenuOutlinedIcon from "@mui/icons-material/MenuOutlined";

const Item = ({ title, to, icon, selected, setSelected }) => {
    const theme = useTheme();
    const colors = tokens(theme.palette.mode);
    return (
        <MenuItem
            active={selected === title}
            style={{ color: colors.grey[100] }}
            onClick={() => setSelected(title)}
            icon={icon}
        >
            <Typography>{title}</Typography>
            <Link to={to} />
        </MenuItem>
    );
};

const Sidebar = ({ isCollapsed, setIsCollapsed }) => {
    const theme = useTheme();
    const colors = tokens(theme.palette.mode);
    const location = useLocation();
    
    const [selected, setSelected] = useState("Dashboard");
    const [username, setUsername] = useState("User");
    const [userRole, setUserRole] = useState("Role");

    useEffect(() => {
        const currentRoute = routes.find(route => route.to === location.pathname);
        if (currentRoute) {
            setSelected(currentRoute.title);
        }
    }, [location.pathname]);

    useEffect(() => {
        const storedUsername = localStorage.getItem("username");
        const storedUserRole = localStorage.getItem("userRole");

        if (storedUsername) setUsername(storedUsername);
        if (storedUserRole) {
            setUserRole(storedUserRole.charAt(0).toUpperCase() + storedUserRole.slice(1));
        }
    }, []);

    const userRoleLower = userRole.toLowerCase();

    return (
        <Box
            sx={{
                position: "fixed",
                top: 0,
                left: 0,
                height: "100%",
                zIndex: 1000,
                "& .pro-sidebar": { height: "100%" },
                "& .pro-sidebar-inner": {
                    background: `${colors.grey[900]} !important`,
                    // --- CHANGE #1: Ensure the inner container is also a flex column to push content to the bottom ---
                    display: "flex",
                    flexDirection: "column",
                },
                "& .pro-menu": {
                    // --- CHANGE #2: Let the menu grow to fill available space ---
                    flexGrow: 1,
                },
                "& .pro-icon-wrapper": { backgroundColor: "transparent !important" },
                "& .pro-inner-item": { padding: "5px 35px 5px 20px !important" },
                "& .pro-inner-item:hover": { color: `${colors.primary[200]} !important` },
                "& .pro-menu-item.active": { color: "white !important", backgroundColor: `${colors.primary[700]} !important`, borderRadius: "10px" },
            }}
        >
            <ProSidebar collapsed={isCollapsed}>
                {/* The Menu component now correctly fills the space due to the styles above */}
                <Menu iconShape="square">
                    <MenuItem onClick={() => setIsCollapsed(!isCollapsed)} icon={isCollapsed ? <MenuOutlinedIcon /> : undefined} style={{ margin: "10px 0 20px 0", color: colors.grey[100] }}>
                        {!isCollapsed && (
                            <Box display="flex" justifyContent="space-between" alignItems="center" ml="15px">
                                <Typography></Typography>
                                <IconButton onClick={() => setIsCollapsed(!isCollapsed)}><MenuOutlinedIcon /></IconButton>
                            </Box>
                        )}
                    </MenuItem>

                    <Box paddingLeft={isCollapsed ? undefined : "7%"} paddingRight={isCollapsed ? undefined : "10%"}>
                        {routes.map((route) => {
                            if (route.omitFromSidebar) return null;
                            if (route.roles && !route.roles.includes(userRoleLower)) return null;

                            return (
                                <Item
                                    key={route.title}
                                    title={route.title}
                                    to={route.to}
                                    icon={route.icon}
                                    selected={selected}
                                    setSelected={setSelected}
                                />
                            );
                        })}
                    </Box>
                </Menu>

                {!isCollapsed && (
                    // --- CHANGE #3: This Box is now outside the Menu component and will be pushed to the bottom ---
                    <Box sx={{ padding: '20px', textAlign: 'center', borderTop: `1px solid ${colors.grey[700]}` }}>
                        <Typography variant="h4" color={colors.grey[100]} fontWeight="bold">
                            {username}
                        </Typography>
                        <Typography variant="body2" color={colors.grey[300]}>
                            {userRole}
                        </Typography>
                    </Box>
                )}
            </ProSidebar>
        </Box>
    );
};

export default Sidebar;