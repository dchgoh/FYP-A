import { useState, useEffect } from "react";
import { ProSidebar, Menu, MenuItem } from "react-pro-sidebar";
import { Box, IconButton, Typography, useTheme } from "@mui/material";
import { Link, useLocation } from "react-router-dom";
import "react-pro-sidebar/dist/css/styles.css";
import { tokens } from "../../theme";
import MenuOutlinedIcon from "@mui/icons-material/MenuOutlined";

const Item = ({ title, to, icon, selected, setSelected }) => {
  const theme = useTheme();
  const colors = tokens(theme.palette.mode);
  return (
    <MenuItem
      active={selected === title}
      style={{
        color: colors.grey[100],
      }}
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
  const [actualUserRole, setActualUserRole] = useState(null);

  // Add state for user details
  const [username, setUsername] = useState("User");
  const [userRole, setUserRole] = useState("Role");

  // Map of paths to menu titles
  const pathToTitle = {
    '/': 'Dashboard',
    '/team': 'Manage Team',
    '/upload': 'Files Upload',
    '/map': 'Map Overview',
    '/treecount': 'Tree Count',
    '/area': 'Area Data'
  };

  // Update selected menu item based on current path
  useEffect(() => {
    const currentPath = location.pathname;
    const title = pathToTitle[currentPath];
    if (title) {
      setSelected(title);
    }
  }, [location.pathname]);

  // Use useEffect to read from localStorage when the component mounts
  useEffect(() => {
    const storedUsername = localStorage.getItem("username");
    const storedUserRole = localStorage.getItem("userRole");

    if (storedUsername) {
      setUsername(storedUsername);
    }
    if (storedUserRole) {
      setUserRole(storedUserRole.charAt(0).toUpperCase() + storedUserRole.slice(1));
      setActualUserRole(storedUserRole.toLowerCase());
    }
  }, []);

  return (
    <Box
      sx={{
        position: "fixed",
        top: 0,
        left: 0,
        height: "300vh",
        zIndex: 1000,
        "& .pro-sidebar-inner": {
          background: `${colors.grey[900]} !important`,
        },
        "& .pro-icon-wrapper": {
          backgroundColor: "transparent !important",
        },
        "& .pro-inner-item": {
          padding: "5px 35px 5px 20px !important",
        },
        "& .pro-inner-item:hover": {
          color: `${colors.primary[200]} !important`,
        },
        "& .pro-menu-item.active": {
          color: "white !important",
          backgroundColor: `${colors.primary[700]} !important`,
          borderRadius: "10px",
        },
      }}
    >
      <ProSidebar collapsed={isCollapsed}>
        <Menu iconShape="square">
          {/* LOGO AND MENU ICON */}
          <MenuItem
            onClick={() => setIsCollapsed(!isCollapsed)}
            icon={isCollapsed ? <MenuOutlinedIcon /> : undefined}
            style={{
              margin: "10px 0 20px 0",
              color: colors.grey[100],
            }}
          >
            {!isCollapsed && (
              <Box
                display="flex"
                justifyContent="space-between"
                alignItems="center"
                ml="15px"
              >
                <Typography></Typography>
                <IconButton onClick={() => setIsCollapsed(!isCollapsed)}>
                  <MenuOutlinedIcon />
                </IconButton>
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
                  src={`../../assets/user.png`}
                  style={{ cursor: "pointer", borderRadius: "50%", border: `2px solid ${colors.primary[700]}` }}
                />
              </Box>
              <Box textAlign="center">
                <Typography
                  variant="h2"
                  color={colors.grey[100]}
                  fontWeight="bold"
                  sx={{ m: "10px 0 0 0" }}
                >
                  {/* Use state variable for username */}
                  {username}
                </Typography>
                <Typography variant="h5" color={colors.grey[200]}>
                  {/* Use state variable for role */}
                  {userRole}
                </Typography>
              </Box>
            </Box>
          )}

          <Box paddingLeft={isCollapsed ? undefined : "10%"} paddingRight={isCollapsed ? undefined : "10%"}>
            <Item
              title="Dashboard"
              to="/"
              icon={<span className="material-symbols-outlined">home</span>}
              selected={selected}
              setSelected={setSelected}
            />
            {actualUserRole !== "regular" && (
              <Item
                title="Manage Team"
                to="/team"
                icon={<span className="material-symbols-outlined">group</span>}
                selected={selected}
                setSelected={setSelected}
              />
            )}
            <Item
              title="Files Upload"
              to="/upload"
              icon={<span className="material-symbols-outlined">home_storage</span>}
              selected={selected}
              setSelected={setSelected}
            />
            <Item
              title="Map Overview"
              to="/map"
              icon={<span className="material-symbols-outlined">map</span>}
              selected={selected}
              setSelected={setSelected}
            />
            <Item
              title="Tree Count"
              to="/treecount"
              icon={<span className="material-symbols-outlined">nature</span>}
              selected={selected}
              setSelected={setSelected}
            />
            <Item
              title="Area Data"
              to="/area"
              icon={<span className="material-symbols-outlined">bar_chart</span>}
              selected={selected}
              setSelected={setSelected}
            />
          </Box>
        </Menu>
      </ProSidebar>
    </Box>
  );
};

export default Sidebar;
