import React, { useEffect, useRef, useState } from "react";
import { Box, useTheme, IconButton, CircularProgress, Typography as MuiTypography } from "@mui/material";
import { useLocation } from "react-router-dom";
import { tokens } from "../../theme"; // Import theme tokens
import MapIcon from '@mui/icons-material/Map';
import CloseIcon from '@mui/icons-material/Close';
import MiniMap from "./MiniMap"; // Adjust path if MiniMap.jsx is elsewhere

const Potree = window.Potree;
const API_BASE_URL = "http://localhost:5000/api"; // Define or import your API base URL

const PotreeViewer = ({ isCollapsed }) => {
  const theme = useTheme();
  const colors = tokens(theme.palette.mode);

  const viewRef = useRef(null);
  const viewElemRef = useRef(null);
  const sidebarContainerRef = useRef(null);
  const location = useLocation();
  const [treeUrl, setTreeUrl] = useState(null);
  const [pointCloudLoaded, setPointCloudLoaded] = useState(false);

  // State for MiniMap
  const [showMiniMap, setShowMiniMap] = useState(true);
  const [miniMapFiles, setMiniMapFiles] = useState([]);
  const [isLoadingMiniMapFiles, setIsLoadingMiniMapFiles] = useState(false);
  const [errorMiniMapFiles, setErrorMiniMapFiles] = useState(null);

  useEffect(() => {
    if (Potree && Potree.Annotation && !Potree.Annotation._patched) {
      const originalHasView = Potree.Annotation.prototype.hasView;
      Potree.Annotation.prototype.hasView = function () {
        if (!this.view || !this.view.position || typeof this.view.position.x !== "number") {
          console.warn("Invalid annotation view position:", this);
          return false;
        }
        return originalHasView.call(this);
      };
      Potree.Annotation._patched = true;
    }
  }, []);

  useEffect(() => {
    if (!viewRef.current && Potree && viewElemRef.current) {
      const viewer = new Potree.Viewer(viewElemRef.current);
      viewRef.current = viewer;

      viewer.setEDLEnabled(true);
      viewer.setFOV(60);
      viewer.setPointBudget(1 * 1000 * 1000);
      viewer.setClipTask(Potree.ClipTask.SHOW_INSIDE);
      viewer.loadSettingsFromURL();
      viewer.setControls(viewer.earthControls);
      viewer.setBackground("skybox");
      if (sidebarContainerRef.current) {
        viewer.loadGUI(() => {
          viewer.toggleSidebar();
          const sceneMenu = document.getElementById("menu_scene");
          if (sceneMenu) {
            const nextElement = sceneMenu.nextElementSibling;
            if (nextElement && nextElement.style) {
              nextElement.style.display = "block";
            }
          }
        });
      }
    }

    const searchParams = new URLSearchParams(location.search);
    const newTreeUrl = searchParams.get("url");

    if (newTreeUrl && newTreeUrl !== treeUrl) {
      setTreeUrl(newTreeUrl);
      setPointCloudLoaded(false);
    }
  }, [location.search, treeUrl]);

  useEffect(() => {
    const styleId = "potree-theme-override";
    let styleTag = document.getElementById(styleId);
  
    if (!styleTag) {
      styleTag = document.createElement("style");
      styleTag.id = styleId;
      document.head.appendChild(styleTag);
    }
  
    // Added .current-location-div-icon style for MiniMap
    styleTag.innerHTML = `
      #sidebar_header {
        display: none;
      }
      #potree_sidebar_container {
        background-color: ${colors.grey[800]} !important;
        border-top: 1px solid grey;
        scrollbar-color: #e0e0e0 #888;
      }
      #menu_appearance, #menu_tools, #menu_scene, #menu_filters, #menu_about {
        background-color: ${colors.primary[700]} !important;
        color: ${colors.grey[100]} !important;
        text-shadow: none;
        font-family: "Inter", sans-serif;
        box-shadow: 0px 3px 3px ${colors.grey[800]};
        border: 1px solid ${colors.grey[800]};
      }
      #potree_sidebar_container span, #potree_sidebar_container legend, 
      #potree_sidebar_container li, #potree_sidebar_container #scene_export, 
      #potree_sidebar_container i, #potree_sidebar_container b, 
      #potree_sidebar_container th, #potree_sidebar_container tr, 
      #potree_sidebar_container a, #potree_sidebar_container .heading, 
      #potree_sidebar_container #annotation_title, 
      #potree_sidebar_container #annotation_description {
        color: ${colors.grey[100]} !important;
        text-shadow: none !important;
        font-family: "Inter", sans-serif;
      }
      span.annotation-label, span.annotation-description-content {
        color: white !important;
      }
      label[data-i18n="appearance.point_size_type"], label[data-i18n="appearance.point_shape"] {
        color: ${colors.grey[100]} !important;
        font-family: "Inter", sans-serif !important;
        font-weight: 400;
      }
      .ui-selectmenu-text, .ui-menu-item-wrapper {
        color: black !important;
      }
      .jstree-default .jstree-clicked {
        background-color: ${colors.primary[700]} !important;
      }
      .jstree-anchor:hover {
        background-color: ${colors.primary[800]} !important;
      }
      .current-location-div-icon { 
        background: transparent !important; 
        border: none !important; 
      }
      .current-location-div-icon svg {
        /* filter: drop-shadow(0px 1px 1px rgba(0,0,0,0.7)); // Already in SVG */
      }
    `;
  }, [colors]);
  
  useEffect(() => {
    const viewer = viewRef.current; // Get the viewer instance

    // Helper function to try and clear the scene when treeUrl is removed
    const clearSceneCompletely = () => {
        if (viewer && viewer.scene) {
            // Check if Potree's specific removePointCloud method exists
            if (typeof viewer.scene.removePointCloud === 'function' && viewer.scene.pointclouds && viewer.scene.pointclouds.length > 0) {
                console.log("Attempting to clear point clouds using viewer.scene.removePointCloud().");
                // Iterate over a copy as removePointCloud modifies the original array
                const pointcloudsToRemove = [...viewer.scene.pointclouds];
                pointcloudsToRemove.forEach(pc => {
                    viewer.scene.removePointCloud(pc);
                });
                console.log("Point clouds cleared via removePointCloud.");
            } else {
                // Fallback: If specific removal isn't available/reliable, reset the entire scene
                console.warn("removePointCloud not available or pointclouds array issue. Resetting scene entirely for unload.");
                viewer.setScene(new Potree.Scene(viewer)); // Pass viewer instance to constructor
            }
            setPointCloudLoaded(false);
        } else if (viewer) {
             // If scene object itself is problematic, still try to reset
            console.warn("viewer.scene object not fully available for targeted clear. Resetting scene entirely for unload.");
            viewer.setScene(new Potree.Scene(viewer));
            setPointCloudLoaded(false);
        }
    };


    if (treeUrl && viewer) {
        // Only proceed to load/reload if the treeUrl is new or point cloud wasn't marked as loaded
        // This handles both initial load and change of treeUrl
        if (!pointCloudLoaded || (viewer.scene && viewer.scene.pointclouds.length > 0 && viewer.scene.pointclouds[0].potree_url !== treeUrl) ) {
            console.log(`Loading new point cloud from URL: ${treeUrl}`);
            
            // Reset the scene: This clears everything (point clouds, measurements, etc.)
            console.log("Setting new scene for Potree URL.");
            viewer.setScene(new Potree.Scene(viewer)); // Potree.Scene constructor often takes viewer instance

            Potree.loadPointCloud(treeUrl).then(
                (event) => {
                    // Ensure viewer and scene are still valid after async operation
                    if (!viewRef.current || !viewRef.current.scene) {
                        console.error("Potree viewer or scene became unavailable during point cloud load.");
                        setPointCloudLoaded(false);
                        return;
                    }
                    const currentViewer = viewRef.current; // Use ref again to be safe
                    const pointcloud = event.pointcloud;
                    pointcloud.potree_url = treeUrl; // Tag the pointcloud with its URL for later comparison
                    const material = pointcloud.material;

                    material.activeAttributeName = "rgba";
                    material.minSize = 2;
                    material.pointSizeType = Potree.PointSizeType.FIXED;

                    currentViewer.scene.addPointCloud(pointcloud);
                    currentViewer.fitToScreen();

                    const classificationScheme = {
                        0: { visible: true, name: "Unclassified", color: [0.75, 0.75, 0.75, 1.0] },
                        1: { visible: true, name: "Low-vegetation", color: [0.6, 0.8, 0.2, 1.0] },
                        2: { visible: true, name: "Terrain", color: [0.545, 0.271, 0.075, 1.0] },
                        3: { visible: true, name: "Out-points", color: [1.0, 0.0, 1.0, 1.0] },
                        4: { visible: true, name: "Stem", color: [0.627, 0.322, 0.176, 1.0] },
                        5: { visible: true, name: "Live branches", color: [0.133, 0.545, 0.133, 1.0] },
                        6: { visible: true, name: "Woody branches", color: [0.36, 0.25, 0.2, 1.0] },
                    };
                    currentViewer.setClassifications(classificationScheme);
                    setPointCloudLoaded(true);
                },
                (error) => {
                    console.error("Failed to load point cloud:", error);
                    // If loading fails, ensure the scene is clean
                    if (viewRef.current) {
                       viewRef.current.setScene(new Potree.Scene(viewRef.current));
                    }
                    setPointCloudLoaded(false);
                }
            );
        }
    } else if (!treeUrl && viewer && pointCloudLoaded) {
        // treeUrl is null (or empty), but a point cloud was loaded. Clear it.
        console.log("Tree URL removed or empty, clearing scene.");
        clearSceneCompletely();
    }
}, [treeUrl, pointCloudLoaded]);

  useEffect(() => {
    const handleResize = () => {
      if (viewRef.current) {
        viewRef.current.render();
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Fetch files for the mini-map
  useEffect(() => {
    const fetchAllFilesForMap = async () => {
      const storedToken = localStorage.getItem('authToken');
      if (!storedToken) {
        setErrorMiniMapFiles("Authentication required for mini-map data.");
        setIsLoadingMiniMapFiles(false);
        return;
      }

      setIsLoadingMiniMapFiles(true);
      setErrorMiniMapFiles(null);
      try {
        const response = await fetch(`${API_BASE_URL}/files`, {
          headers: { 'Authorization': `Bearer ${storedToken}` }
        });
        if (!response.ok) {
          throw new Error(`HTTP error fetching files for mini-map! Status: ${response.status}`);
        }
        const filesData = await response.json();
        const filesArray = Array.isArray(filesData) ? filesData : [];

        const filesWithValidCoords = filesArray.filter(file =>
          file.latitude !== null && typeof file.latitude === 'number' &&
          file.longitude !== null && typeof file.longitude === 'number'
        ).map(f => ({
            ...f,
            projectName: f.projectName || (f.project_id ? `Project ID ${f.project_id}` : 'Unassigned'),
            divisionName: f.divisionName || (f.division_id ? `Division ID ${f.division_id}` : 'N/A'),
       }));
        setMiniMapFiles(filesWithValidCoords);
      } catch (err) {
        console.error("Failed to fetch mini-map files:", err);
        setErrorMiniMapFiles(err.message || "An error occurred while fetching mini-map files.");
        setMiniMapFiles([]);
      } finally {
        setIsLoadingMiniMapFiles(false);
      }
    };
    fetchAllFilesForMap();
  }, []);

  const toggleMiniMap = () => setShowMiniMap(prev => !prev);

  const styles = {
    container: {
      display: "flex",
      height: "calc(100vh - 112px)", // Adjusted for top bar
      bgcolor: colors.grey[900],
      marginLeft: isCollapsed ? "80px" : "270px",
      transition: "margin-left 0.3s ease",
      position: 'relative',
    },
    content: {
      flex: 1,
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
      position: "relative",
    },
    viewerWrapper: {
      flex: 1,
      display: "flex",
      position: "relative",
    },
    renderArea: {
      flex: 1,
      position: "relative",
      border: `1px solid ${colors.grey[700]}`,
    },
  };
  
  return (
    <Box sx={styles.container}>
      <Box sx={styles.content}>
        <Box sx={styles.viewerWrapper}>
          <Box
            id="potree_render_area"
            ref={viewElemRef}
            sx={styles.renderArea}
          />
          <Box
            id="potree_sidebar_container"
            ref={sidebarContainerRef}
          />

          {/* Mini-map Toggle Button */}
          <IconButton
            onClick={toggleMiniMap}
            sx={{
              position: 'absolute',
              bottom: '15px',
              right: '15px',
              zIndex: 1002,
              backgroundColor: 'rgba(0, 0, 0, 0.1)',
              color: 'white',
              borderRadius: '50%', // Circular
              width: 40,
              height: 40,
              '&:hover': {
                backgroundColor: 'rgba(0, 0, 0, 0)',
              },
              boxShadow: '0 2px 5px rgba(0,0,0,0.3)',
            }}
            title={showMiniMap ? "Hide Mini-map" : "Show Mini-map"}
          >
            {showMiniMap ? <CloseIcon fontSize="small"/> : <MapIcon fontSize="small"/>}
          </IconButton>

          {/* Mini-map Container */}
          {showMiniMap && (
            <Box
              sx={{
                position: 'absolute',
                bottom: '65px', // Below the toggle button
                right: '15px',
                width: { xs: '260px', sm: '300px' }, // Responsive width
                height: { xs: '200px', sm: '250px' }, // Responsive height
                backgroundColor: `rgba(${theme.palette.mode === 'dark' ? '30,30,30' : '245,245,245'}, 0.9)`,
                border: `1px solid ${colors.grey[700]}`,
                borderRadius: '8px',
                zIndex: 1001, // Below toggle, above most other things
                boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
                overflow: 'hidden',
              }}
            >
              {isLoadingMiniMapFiles && (
                <Box sx={{display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%'}}>
                  <CircularProgress size={30} />
                </Box>
              )}
              {errorMiniMapFiles && !isLoadingMiniMapFiles && (
                 <Box sx={{display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '100%', padding: 1, textAlign: 'center'}}>
                    <MuiTypography variant="caption" color="error" sx={{fontSize: '0.7rem'}}>Failed to load map data.</MuiTypography>
                    <MuiTypography variant="caption" color="error" sx={{fontSize: '0.65rem', wordBreak: 'break-all'}}>{errorMiniMapFiles.substring(0,100)}</MuiTypography>
                 </Box>
              )}
              {!isLoadingMiniMapFiles && !errorMiniMapFiles && miniMapFiles.length > 0 && (
                <MiniMap
                  files={miniMapFiles}
                  currentPointCloudUrl={treeUrl}
                  mapHeight="100%"
                  mapWidth="100%"
                />
              )}
               {!isLoadingMiniMapFiles && !errorMiniMapFiles && miniMapFiles.length === 0 && (
                 <Box sx={{display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', padding: 1}}>
                    <MuiTypography variant="caption" color="textSecondary" sx={{fontSize: '0.75rem'}}>No geolocated sites found.</MuiTypography>
                 </Box>
              )}
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  );
};

export default PotreeViewer;