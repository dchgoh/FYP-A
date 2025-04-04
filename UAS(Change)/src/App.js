import { useState, useEffect, React } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import Topbar from "./scenes/global/Topbar";
import Sidebar from "./scenes/global/Sidebar";
import Dashboard from "./scenes/dashboard";
import Team from "./scenes/team";
import Upload from "./scenes/upload";
import Login from "./scenes/login/login";
import TreeCountDashboard from "./scenes/treecount"
import AreaDataDashboard from "./scenes/area"
import PotreeViewer from './PotreeViewer';
import { CssBaseline, ThemeProvider } from "@mui/material";
import { ColorModeContext, useMode } from "./theme";

function App() {

  const [theme, colorMode] = useMode();
  const [isSidebar, setIsSidebar] = useState(true);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    // Check authentication state from localStorage
    const auth = localStorage.getItem("authenticated");
    if (auth === "true") {
      setIsAuthenticated(true);
    }
  }, []);

  return (
    <ColorModeContext.Provider value={colorMode}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <div className="app">

          {isAuthenticated && <Sidebar isSidebar={isSidebar} isCollapsed={isCollapsed} setIsCollapsed={setIsCollapsed} />}
          <main className="content">
            {isAuthenticated && <Topbar setIsSidebar={setIsSidebar} isCollapsed={isCollapsed} />}
            <Routes>
              <Route path="/login" element={<Login setIsAuthenticated={setIsAuthenticated} />} />
              <Route path="/" element={isAuthenticated ? <Dashboard isCollapsed={isCollapsed} /> : <Navigate to="/login" />} />
              <Route path="/team" element={isAuthenticated ? <Team isCollapsed={isCollapsed} /> : <Navigate to="/login" />} />
              <Route path="/upload" element={isAuthenticated ? <Upload isCollapsed={isCollapsed} /> : <Navigate to="/login" />} />
              <Route path="/treecount" element={isAuthenticated ? <TreeCountDashboard isCollapsed={isCollapsed} /> : <Navigate to="/login" />} />
              <Route path="/area" element={isAuthenticated ? <AreaDataDashboard isCollapsed={isCollapsed} /> : <Navigate to="/login" />} />
              <Route path="/potree" element={isAuthenticated ? <PotreeViewer isCollapsed={isCollapsed} /> : <Navigate to="/login" />} />
            </Routes>
          </main>
        </div>
      </ThemeProvider>
    </ColorModeContext.Provider>
  );
}

export default App;
