import React, { useState, useEffect } from "react";
import { ProSidebar, Menu, MenuItem } from "react-pro-sidebar";
import { Box, IconButton, Typography, useTheme } from "@mui/material";
import { Link, useLocation } from "react-router-dom";
import "react-pro-sidebar/dist/css/styles.css";
import { tokens } from "../../theme";
import { routes } from "../../routesConfig"; // <-- IMPORT the new config
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
    const [userRole, setUserRole] = useState("Role"); // For display only, e.g., "Administrator"

    // Find the current page's title from the config based on the URL
    useEffect(() => {
        const currentRoute = routes.find(route => route.to === location.pathname);
        if (currentRoute) {
            setSelected(currentRoute.title);
        }
    }, [location.pathname]);

    // Get user details from localStorage on mount
    useEffect(() => {
        const storedUsername = localStorage.getItem("username");
        const storedUserRole = localStorage.getItem("userRole"); // e.g., "administrator"

        if (storedUsername) setUsername(storedUsername);
        if (storedUserRole) {
            // Capitalize for display
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
                "& .pro-sidebar-inner": { background: `${colors.grey[900]} !important` },
                "& .pro-icon-wrapper": { backgroundColor: "transparent !important" },
                "& .pro-inner-item": { padding: "5px 35px 5px 20px !important" },
                "& .pro-inner-item:hover": { color: `${colors.primary[200]} !important` },
                "& .pro-menu-item.active": { color: "white !important", backgroundColor: `${colors.primary[700]} !important`, borderRadius: "10px" },
            }}
        >
            <ProSidebar collapsed={isCollapsed}>
                <Menu iconShape="square">
                    <MenuItem onClick={() => setIsCollapsed(!isCollapsed)} icon={isCollapsed ? <MenuOutlinedIcon /> : undefined} style={{ margin: "10px 0 20px 0", color: colors.grey[100] }}>
                        {!isCollapsed && (
                            <Box display="flex" justifyContent="space-between" alignItems="center" ml="15px">
                                <Typography></Typography>
                                <IconButton onClick={() => setIsCollapsed(!isCollapsed)}><MenuOutlinedIcon /></IconButton>
                            </Box>
                        )}
                    </MenuItem>

                    {!isCollapsed && (
                        <Box mb="25px">
                            <Box display="flex" justifyContent="center" alignItems="center">
                                <img
                                    alt="profile-user"
                                    width="100px"
                                    height="100px"
                                    src={`/assets/user.png`} // <-- Use absolute path from public folder
                                    style={{ cursor: "pointer", borderRadius: "50%", border: `2px solid ${colors.primary[700]}` }}
                                />
                            </Box>
                            <Box textAlign="center">
                                <Typography variant="h2" color={colors.grey[100]} fontWeight="bold" sx={{ m: "10px 0 0 0" }}>{username}</Typography>
                                <Typography variant="h5" color={colors.grey[200]}>{userRole}</Typography>
                            </Box>
                        </Box>
                    )}

                    <Box paddingLeft={isCollapsed ? undefined : "10%"} paddingRight={isCollapsed ? undefined : "10%"}>
                        {routes.map((route) => {
                            // Logic to decide if the item should be rendered
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
            </ProSidebar>
        </Box>
    );
};

export default Sidebar;