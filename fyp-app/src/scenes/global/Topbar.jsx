import { Box, IconButton, useTheme, Typography } from "@mui/material";
import { useContext, useState, useEffect } from "react";
import { ColorModeContext } from "../../theme";
import { useLocation } from "react-router-dom";

const Topbar = ({ isCollapsed }) => {
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
        setPageTitle("Files Upload");
        break;
      case "/treecount":
        setPageTitle("Tree Count");
        break;
      case "/area":
        setPageTitle("Area Data");
        break;
      default:
        setPageTitle("Dashboard"); // Default title
    }
  }, [location.pathname]);

  return (
    <Box
      display="flex"
      justifyContent="space-between"
      p={2}
      sx={{
        marginLeft: isCollapsed ? "80px" : "270px",
        transition: "margin-left 0.3s ease",
      }}
    >
      {/* PAGE TITLE */}
      <Box display="flex" alignItems="center" minWidth="200px">
        <Typography variant="h3" fontWeight="bold" paddingLeft={"15px"}>
          {pageTitle}
        </Typography>
      </Box>

      {/* COMPANY LOGO */}
      <Box
        display="flex"
        justifyContent="center"
        alignItems="center"
        ml="-120px"
        height="100%"
      >
        <img
          src="../../assets/logo.png"
          alt="Company Logo"
          style={{ maxHeight: "80px", maxWidth: "150px" }}
        />
      </Box>

      {/* ICONS */}
      <Box display="flex" alignItems="center">
        <IconButton onClick={colorMode.toggleColorMode}>
          {theme.palette.mode === "dark" ? (
            <span className="material-symbols-outlined">dark_mode</span>
          ) : (
            <span className="material-symbols-outlined">light_mode</span>
          )}
        </IconButton>
        <IconButton>
          <span className="material-symbols-outlined">account_circle</span>
        </IconButton>
      </Box>
    </Box>
  );
};

export default Topbar;