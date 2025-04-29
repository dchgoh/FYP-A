import { useState, React, useEffect } from "react"; // Import useEffect
import { Routes, Route, Navigate, useNavigate, useLocation } from "react-router-dom";
import { jwtDecode } from "jwt-decode";
import Topbar from "./scenes/global/Topbar";
import Sidebar from "./scenes/global/Sidebar";
import Dashboard from "./scenes/dashboard";
import Team from "./scenes/team";
import Upload from "./scenes/upload";
import Login from "./scenes/login/login";
import TreeCountDashboard from "./scenes/treecount";
import AreaDataDashboard from "./scenes/area";
import MapDashboard from "./scenes/map";
import PotreeViewer from './scenes/potree_viewer';
import { CssBaseline, ThemeProvider } from "@mui/material";
import { ColorModeContext, useMode } from "./theme";

function App() {
  const [theme, colorMode] = useMode();
  const [isSidebar, setIsSidebar] = useState(true);
  const [isCollapsed, setIsCollapsed] = useState(() => {
    // Initialize isCollapsed from localStorage, default to false if not present
    const storedCollapsed = localStorage.getItem("isCollapsed");
    return storedCollapsed ? JSON.parse(storedCollapsed) : false;
  });
  const navigate = useNavigate();
  const location = useLocation(); // Get the current location

  // --- Initialize Authentication State with JWT Validation ---
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    const token = localStorage.getItem("authToken");

    if (!token) {
      return false; // No token means not authenticated
    }

    try {
      const decodedToken = jwtDecode(token);
      const currentTime = Date.now() / 1000; // Get current time in seconds

      if (decodedToken.exp < currentTime) {
        // Token has expired, clear storage
        localStorage.removeItem("authToken");
        localStorage.removeItem("userRole");
        localStorage.removeItem("username");
        return false; // Not authenticated
      } else {
        // Token exists and is not expired
        return true; // Authenticated
      }
    } catch (error) {
      // If decoding fails, token is invalid/malformed
      console.error("App Load: Failed to decode token:", error);
      localStorage.removeItem("authToken"); // Clear the invalid token
      localStorage.removeItem("userRole");
      localStorage.removeItem("username");
      return false; // Not authenticated
    }
  });
  // --- End Authentication State Initialization ---


  // --- Handle Successful Login (Called by Login component AFTER MFA if needed) ---
  // Accepts final token and user details provided by the Login component
  const handleLoginSuccess = (token, role, username) => {
    localStorage.setItem("authToken", token);
    if (role) {
      localStorage.setItem("userRole", role);
    } else {
      localStorage.removeItem("userRole"); // Clear if no role provided
    }
    if (username) {
      localStorage.setItem("username", username);
    } else {
      localStorage.removeItem("username"); // Clear if no username provided
    }
    setIsAuthenticated(true);
  };
  // --- End Handle Successful Login ---


  // --- Handle Logout ---
  const handleLogout = () => {
    localStorage.removeItem("authToken");
    localStorage.removeItem("userRole");
    localStorage.removeItem("username");
    setIsAuthenticated(false);
    navigate("/login");
  };
  // --- End Handle Logout ---

  // --- Persist isCollapsed state to localStorage ---
  useEffect(() => {
    localStorage.setItem("isCollapsed", JSON.stringify(isCollapsed));
  }, [isCollapsed]);

  // Determine if the sidebar should be shown based on the current route
  const showSidebar = isAuthenticated;
  const showTopbar = isAuthenticated;

  return (
    <ColorModeContext.Provider value={colorMode}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <div className="app">
          {showSidebar && (
            <Sidebar
              isSidebar={isSidebar}
              isCollapsed={isCollapsed}
              setIsCollapsed={setIsCollapsed}
            />
          )}
          <main className="content" style={{ marginLeft: showSidebar ? undefined : 0 }}>
            {showTopbar && (
              <Topbar
                setIsSidebar={setIsSidebar}
                isCollapsed={isCollapsed}
                handleLogout={handleLogout} // Pass logout handler to Topbar
              />
            )}
            <Routes>
              {/* Login Route */}
              <Route
                path="/login"
                element={
                  !isAuthenticated ? (
                    // Render Login component, passing the success handler
                    <Login onLoginSuccess={handleLoginSuccess} />
                  ) : (
                    // If already authenticated, redirect from /login to dashboard
                    <Navigate to="/" replace />
                  )
                }
              />

              {/* Protected Routes - Render component only if authenticated, otherwise redirect */}
              <Route
                path="/"
                element={isAuthenticated ? <Dashboard isCollapsed={isCollapsed} /> : <Navigate to="/login" replace />}
              />
              <Route
                path="/team"
                element={isAuthenticated ? <Team isCollapsed={isCollapsed} /> : <Navigate to="/login" replace />}
              />
              <Route
                path="/upload"
                element={isAuthenticated ? <Upload isCollapsed={isCollapsed} /> : <Navigate to="/login" replace />}
              />
              <Route
                path="/treecount"
                element={isAuthenticated ? <TreeCountDashboard isCollapsed={isCollapsed} /> : <Navigate to="/login" replace />}
              />
              <Route
                path="/area"
                element={isAuthenticated ? <AreaDataDashboard isCollapsed={isCollapsed} /> : <Navigate to="/login" replace />}
              />
              <Route
                path="/map"
                element={isAuthenticated ? <MapDashboard isCollapsed={isCollapsed} /> : <Navigate to="/login" replace />}
              />
              <Route
                path="/potree"
                element={isAuthenticated ? <PotreeViewer isCollapsed={isCollapsed} /> : <Navigate to="/login" replace />}
              />

              {/* Fallback Route for unknown paths */}
              <Route
                path="*"
                element={<Navigate to={isAuthenticated ? "/" : "/login"} replace />}
              />

            </Routes>
          </main>
        </div>
      </ThemeProvider>
    </ColorModeContext.Provider>
  );
}

export default App;