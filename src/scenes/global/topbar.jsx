import { Box, IconButton, useTheme, Typography } from "@mui/material";
import { useContext, useState, useEffect } from "react";
import { ColorModeContext } from "../../theme";
import { useLocation } from "react-router-dom";

const Topbar = ({ isCollapsed, handleLogout }) => {
  const theme = useTheme();
  const colorMode = useContext(ColorModeContext);
  const location = useLocation();
  const [pageTitle, setPageTitle] = useState("");

  useEffect(() => {
    switch (location.pathname) {
      case "/":
        setPageTitle("Dashboard");
        break;
      case "/team":
        setPageTitle("Manage Team");
        break;
      case "/upload":
        setPageTitle("File Management");
        break;
      case "/treecount":
        setPageTitle("Tree Count");
        break;
      case "/area":
        setPageTitle("Area Data");
        break;
      case "/potree":
        setPageTitle("Point Cloud Viewer");
        break;
      default:
        if (location.pathname.startsWith("/potree")) {
            setPageTitle("Point Cloud Viewer");
        } else if (location.pathname.startsWith("/adminpanel")) {
            setPageTitle("Admin Panel");
        }
        // Add more dynamic path checks if needed
        else {
            setPageTitle("Dashboard"); // Default title
        }
    }
  }, [location.pathname]);

  // Define responsive sizes for the logo
  const logoMaxWidth = { xs: '90px', sm: '110px', md: '130px', lg: '150px' };
  const logoMaxHeight = { xs: '40px', sm: '50px', md: '60px', lg: '70px' };

  return (
    <Box
      display="flex"
      justifyContent="space-between" // Positions title group left, icons group right
      alignItems="center"
      p={{ xs: 1, sm: 1.5, md: 2 }} // Responsive padding for the topbar
      sx={{
        position: 'relative', // Crucial for absolute positioning of the logo
        marginLeft: isCollapsed ? "80px" : "270px",
        transition: "margin-left 0.3s ease",
        // Consider a minHeight if content can vary significantly
        // minHeight: { xs: '56px', sm: '64px' },
      }}
    >
      {/* PAGE TITLE */}
      <Box
        display="flex"
        alignItems="center"
        sx={{
          flexGrow: 1, // Allows title area to expand
          flexShrink: 1, // Allows title area to shrink
          minWidth: 0,   // Essential for text-overflow to work in flex items
        }}
      >
        <Typography
          variant="h3" // Base variant, font size overridden below
          fontWeight="bold"
          paddingLeft={{ xs: "8px", sm: "15px" }}
          sx={{
            fontSize: { // Responsive font sizes
              xs: "1.1rem",    // Smaller for extra-small screens
              sm: "1.4rem",    // Medium for small screens
              md: theme.typography.h3.fontSize, // Theme default h3 for medium and up
            },
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            color: theme.palette.text.primary, // Ensure text color follows theme
          }}
        >
          {pageTitle}
        </Typography>
      </Box>

      {/* COMPANY LOGO - Absolutely Centered */}
      <Box
        display={{ xs: 'none', md: 'flex' }} // Hidden on xs & sm, visible from md up
        justifyContent="center"
        alignItems="center"
        sx={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          transform: 'translate(-50%, -50%)',
          // pointerEvents: 'none', // Uncomment if logo is purely decorative and might overlap interactive elements
        }}
      >
        <Box
            component="img"
            src="../../assets/logo.png" // Make sure this path is correct (usually from public folder)
            alt="Company Logo"
            sx={{
              maxHeight: logoMaxHeight, // Applies responsive height
              maxWidth: logoMaxWidth,   // Applies responsive width
              display: 'block', // Removes potential extra space below the image
            }}
          />
      </Box>

      {/* ICONS */}
      <Box display="flex" alignItems="center" sx={{ flexShrink: 0 /* Prevents icons from shrinking */ }}>
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