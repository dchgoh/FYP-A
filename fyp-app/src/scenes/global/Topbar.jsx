import { Box, IconButton, useTheme, Typography } from "@mui/material";
import { useContext, useState, useEffect } from "react";
import { ColorModeContext } from "../../theme";
import { useLocation } from "react-router-dom";

const Topbar = () => {
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
      case "/invoices":
        setPageTitle("Tree Count");
        break;
      case "/form":
        setPageTitle("Area Data");
        break;
      default:
        setPageTitle("Dashboard"); // Default title
    }
  }, [location.pathname]);

  return (
    <Box display="flex" justifyContent="space-between" p={2}>
      {/* PAGE TITLE */}
      <Box display="flex" alignItems="center">
        <Typography variant="h3" fontWeight="bold">
          {pageTitle}
        </Typography>
      </Box>

      {/* COMPANY LOGO */}
      <Box display="flex" justifyContent="center" alignItems="center">
        <img
          src="../../assets/logo.png"
          alt="Company Logo"
          style={{ maxHeight: "55px" }}
        />
      </Box>

      {/* ICONS */}
      <Box display="flex">
        <IconButton onClick={colorMode.toggleColorMode}>
          {theme.palette.mode === "dark" ? (
            <span class="material-symbols-outlined">dark_mode</span>
          ) : (
            <span class="material-symbols-outlined">light_mode</span>
          )}
        </IconButton>
        <IconButton>
          <span class="material-symbols-outlined">account_circle</span>
        </IconButton>
      </Box>
    </Box>
  );
};

export default Topbar;
