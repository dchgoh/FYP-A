import { useState } from "react";
import { Routes, Route } from "react-router-dom";
import Topbar from "./scenes/global/Topbar";
import Sidebar from "./scenes/global/Sidebar";
import Dashboard from "./scenes/dashboard";
import Team from "./scenes/team";
import FileManagement from "./scenes/upload";
import TreeCountDashboard from "./scenes/treecount";
import AreaDataDashboard from "./scenes/area";
import { CssBaseline, ThemeProvider } from "@mui/material";
import { ColorModeContext, useMode } from "./theme";

function App() {
  const [theme, colorMode] = useMode();
  const [isSidebar, setIsSidebar] = useState(true);
  const [isCollapsed, setIsCollapsed] = useState(false);

  return (
    <ColorModeContext.Provider value={colorMode}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <div className="app">
          <Sidebar isSidebar={isSidebar} isCollapsed={isCollapsed} setIsCollapsed={setIsCollapsed} />
          <main className="content">
            <Topbar setIsSidebar={setIsSidebar} isCollapsed={isCollapsed} />
            <Routes>
              <Route path="/" element={<Dashboard isCollapsed={isCollapsed} />} />
              <Route path="/team" element={<Team isCollapsed={isCollapsed} />} />
              <Route path="/upload" element={<FileManagement isCollapsed={isCollapsed} />} />
              <Route path="/treecount" element={<TreeCountDashboard isCollapsed={isCollapsed}/>} />
              <Route path="/area" element={<AreaDataDashboard isCollapsed={isCollapsed}/>} />
            </Routes>
          </main>
        </div>
      </ThemeProvider>
    </ColorModeContext.Provider>
  );
}

export default App;
