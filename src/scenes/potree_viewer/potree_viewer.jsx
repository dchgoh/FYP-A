import React, { useEffect, useRef, useState, useCallback } from "react";
import { Box, useTheme, IconButton, CircularProgress, Typography as MuiTypography } from "@mui/material";
import { useLocation } from "react-router-dom";
import { tokens } from "../../theme"; // Adjust path if necessary
import MapIcon from '@mui/icons-material/Map';
import CloseIcon from '@mui/icons-material/Close';
import MiniMap from "./MiniMap"; // Adjust path if MiniMap.jsx is elsewhere
import Draggable from 'react-draggable';

const Potree = window.Potree;
const API_BASE_URL = "/api"; // Use relative base so it works over LAN via CRA proxy

// Constants for positioning logic
const MINIMAP_ESTIMATED_WIDTH_SM = 300;
const MINIMAP_ESTIMATED_WIDTH_XS = 260;
const MINIMAP_ESTIMATED_HEIGHT_SM = 250;
const MINIMAP_ESTIMATED_HEIGHT_XS = 200;
const BUTTON_FIXED_SIZE = 40; // Matches IconButton width/height
const MINIMAP_BUTTON_GAP = 10; // Desired gap between button and minimap


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

  // State for draggable button position and refs
  const [buttonPosition, setButtonPosition] = useState({ x: 0, y: 0 }); // x, y are offsets for Draggable
  const draggableButtonRef = useRef(null);
  const viewerWrapperRef = useRef(null); // Ref for the main viewer area (Draggable's parent)

  // State for the entire style of the MiniMap container
  const [miniMapContainerStyle, setMiniMapContainerStyle] = useState(() => ({
    position: 'absolute',
    visibility: 'hidden', // Start hidden until position is calculated
    width: { xs: `${MINIMAP_ESTIMATED_WIDTH_XS}px`, sm: `${MINIMAP_ESTIMATED_WIDTH_SM}px` },
    height: { xs: `${MINIMAP_ESTIMATED_HEIGHT_XS}px`, sm: `${MINIMAP_ESTIMATED_HEIGHT_SM}px` },
    backgroundColor: `rgba(${theme.palette.mode === 'dark' ? '30,30,30' : '245,245,245'}, 0.9)`,
    border: `1px solid ${colors.grey[700]}`,
    borderRadius: '8px',
    zIndex: 1001, // Below toggle button
    boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
    overflow: 'hidden',
    // top, left will be calculated and added by updateMiniMapPosition
  }));

  // Load button position from localStorage
  useEffect(() => {
    const savedPosition = localStorage.getItem('miniMapButtonPosition');
    if (savedPosition) {
      try {
        const parsedPosition = JSON.parse(savedPosition);
        // Basic validation
        if (typeof parsedPosition.x === 'number' && typeof parsedPosition.y === 'number') {
          setButtonPosition(parsedPosition);
        } else {
            localStorage.removeItem('miniMapButtonPosition'); // Clear invalid data
        }
      } catch (e) {
        console.error("Error parsing saved button position:", e);
        localStorage.removeItem('miniMapButtonPosition');
      }
    }
  }, []);

  const handleDragStart = () => {
    if (draggableButtonRef.current) {
      draggableButtonRef.current.style.cursor = 'grabbing';
    }
  };

  const handleDragStop = (e, data) => {
    const newPosition = { x: data.x, y: data.y };
    setButtonPosition(newPosition);
    localStorage.setItem('miniMapButtonPosition', JSON.stringify(newPosition));
    if (draggableButtonRef.current) {
      draggableButtonRef.current.style.cursor = 'grab';
    }
    // Force immediate position update
    requestAnimationFrame(() => {
      updateMiniMapPosition();
    });
  };

  const updateMiniMapPosition = useCallback(() => {
    if (!showMiniMap || !draggableButtonRef.current || !viewerWrapperRef.current) {
      if (showMiniMap) {
        setMiniMapContainerStyle(prev => ({ ...prev, visibility: 'hidden' }));
      }
      return;
    }

    const buttonNode = draggableButtonRef.current;
    const parentNode = viewerWrapperRef.current;

    // Get the current transform matrix of the button
    const buttonTransform = window.getComputedStyle(buttonNode).transform;
    const matrix = new DOMMatrix(buttonTransform);
    
    // Get the button's position including the transform
    const buttonRect = buttonNode.getBoundingClientRect();
    const parentRect = parentNode.getBoundingClientRect();

    // Calculate the button's position relative to the parent, including transform
    const buttonTopInParent = buttonRect.top - parentRect.top;
    const buttonLeftInParent = buttonRect.left - parentRect.left;

    // Parent's dimensions
    const parentWidth = parentRect.width;
    const parentHeight = parentRect.height;

    // Determine current effective minimap size
    const currentMapEffectiveWidth = parentWidth < (MINIMAP_ESTIMATED_WIDTH_XS + MINIMAP_ESTIMATED_WIDTH_SM) / 2
        ? MINIMAP_ESTIMATED_WIDTH_XS
        : MINIMAP_ESTIMATED_WIDTH_SM;
    const currentMapEffectiveHeight = parentHeight < (MINIMAP_ESTIMATED_HEIGHT_XS + MINIMAP_ESTIMATED_HEIGHT_SM) / 2
        ? MINIMAP_ESTIMATED_HEIGHT_XS
        : MINIMAP_ESTIMATED_HEIGHT_SM;
    
    let idealTop, idealLeft;

    // Calculate ideal position based on button location
    if (buttonTopInParent + BUTTON_FIXED_SIZE / 2 > parentHeight / 2) {
      idealTop = buttonTopInParent - currentMapEffectiveHeight - MINIMAP_BUTTON_GAP;
    } else {
      idealTop = buttonTopInParent + BUTTON_FIXED_SIZE + MINIMAP_BUTTON_GAP;
    }

    if (buttonLeftInParent + BUTTON_FIXED_SIZE / 2 > parentWidth / 2) {
      idealLeft = buttonLeftInParent - currentMapEffectiveWidth - MINIMAP_BUTTON_GAP;
    } else {
      idealLeft = buttonLeftInParent + BUTTON_FIXED_SIZE + MINIMAP_BUTTON_GAP;
    }

    // Clamp values to stay within parent boundaries with padding
    const finalTop = Math.max(MINIMAP_BUTTON_GAP, Math.min(idealTop, parentHeight - currentMapEffectiveHeight - MINIMAP_BUTTON_GAP));
    const finalLeft = Math.max(MINIMAP_BUTTON_GAP, Math.min(idealLeft, parentWidth - currentMapEffectiveWidth - MINIMAP_BUTTON_GAP));
    
    // Update the minimap position with a smooth transition
    setMiniMapContainerStyle(prev => ({
      ...prev,
      top: `${finalTop}px`,
      left: `${finalLeft}px`,
      right: 'auto',
      bottom: 'auto',
      visibility: 'visible',
      width: `${currentMapEffectiveWidth}px`,
      height: `${currentMapEffectiveHeight}px`,
      transition: 'top 0.2s ease-out, left 0.2s ease-out', // Add smooth transition
    }));
  }, [showMiniMap]);

  // Effect to update MiniMap position on relevant changes
  useEffect(() => {
    updateMiniMapPosition(); 

    const handleResizeOrCollapse = () => {
      updateMiniMapPosition();
    };
    
    window.addEventListener('resize', handleResizeOrCollapse);
    // No direct event for sidebar collapse, but `isCollapsed` prop change will trigger this useEffect
    
    return () => {
      window.removeEventListener('resize', handleResizeOrCollapse);
    };
  }, [buttonPosition, showMiniMap, isCollapsed, updateMiniMapPosition]);

  // Initial positioning after mount
  useEffect(() => {
    const timer = setTimeout(() => {
      updateMiniMapPosition();
    }, 100); // Small delay to ensure DOM elements are rendered and refs populated
    return () => clearTimeout(timer);
  }, [updateMiniMapPosition]); // Runs once on mount because updateMiniMapPosition is memoized

  // Add a resize observer to handle container size changes
  useEffect(() => {
    if (!viewerWrapperRef.current) return;

    const resizeObserver = new ResizeObserver(() => {
      updateMiniMapPosition();
    });

    resizeObserver.observe(viewerWrapperRef.current);

    return () => {
      resizeObserver.disconnect();
    };
  }, [updateMiniMapPosition]);

  // Potree Annotation Patch
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

  // Potree Viewer Initialization & URL Handling
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
    } else if (!newTreeUrl && treeUrl) { // Handle case where URL is removed
      setTreeUrl(null);
      // Point cloud clearing will be handled by the next useEffect
    }
  }, [location.search, treeUrl]);

  // Potree Theme Override Styles
  useEffect(() => {
    const styleId = "potree-theme-override";
    let styleTag = document.getElementById(styleId);
  
    if (!styleTag) {
      styleTag = document.createElement("style");
      styleTag.id = styleId;
      document.head.appendChild(styleTag);
    }
  
    styleTag.innerHTML = `
      #sidebar_header { display: none; }
      #potree_sidebar_container {
        background-color: ${colors.grey[800]} !important; border-top: 1px solid grey;
        scrollbar-color: #e0e0e0 #888;
      }
      #menu_appearance, #menu_tools, #menu_scene, #menu_filters, #menu_about {
        background-color: ${colors.primary[700]} !important; color: ${colors.grey[100]} !important;
        text-shadow: none; font-family: "Inter", sans-serif;
        box-shadow: 0px 3px 3px ${colors.grey[800]}; border: 1px solid ${colors.grey[800]};
      }
      #potree_sidebar_container span, #potree_sidebar_container legend, 
      #potree_sidebar_container li, #potree_sidebar_container #scene_export, 
      #potree_sidebar_container i, #potree_sidebar_container b, 
      #potree_sidebar_container th, #potree_sidebar_container tr, 
      #potree_sidebar_container a, #potree_sidebar_container .heading, 
      #potree_sidebar_container #annotation_title, 
      #potree_sidebar_container #annotation_description {
        color: ${colors.grey[100]} !important; text-shadow: none !important; font-family: "Inter", sans-serif;
      }
      span.annotation-label, span.annotation-description-content { color: white !important; }
      label[data-i18n="appearance.point_size_type"], label[data-i18n="appearance.point_shape"] {
        color: ${colors.grey[100]} !important; font-family: "Inter", sans-serif !important; font-weight: 400;
      }
      .ui-selectmenu-text, .ui-menu-item-wrapper { color: black !important; }
      .jstree-default .jstree-clicked { background-color: ${colors.primary[700]} !important; }
      .jstree-anchor:hover { background-color: ${colors.primary[800]} !important; }
      .current-location-div-icon { background: transparent !important; border: none !important; }

      /* Hide camera animation icon */
      img[data-i18n="[title]tt.camera_animation"] {
        display: none !important;
      }

      /* Hide screen clip box icon */
      img[data-i18n="[title]tt.screen_clip_box"] {
        display: none !important;
      }
    `;
  }, [colors]);
  
  // Potree Point Cloud Loading/Unloading
  useEffect(() => {
    const viewer = viewRef.current; 

    const clearSceneCompletely = () => {
        if (viewer && viewer.scene) {
            if (typeof viewer.scene.removePointCloud === 'function' && viewer.scene.pointclouds && viewer.scene.pointclouds.length > 0) {
                const pointcloudsToRemove = [...viewer.scene.pointclouds];
                pointcloudsToRemove.forEach(pc => {
                    viewer.scene.removePointCloud(pc);
                });
            } else {
                viewer.setScene(new Potree.Scene(viewer));
            }
            setPointCloudLoaded(false);
        } else if (viewer) { // Fallback if scene is somehow null but viewer exists
            viewer.setScene(new Potree.Scene(viewer));
            setPointCloudLoaded(false);
        }
    };

    if (treeUrl && viewer) {
        if (!pointCloudLoaded || (viewer.scene && viewer.scene.pointclouds.length > 0 && viewer.scene.pointclouds[0].potree_url !== treeUrl) ) {
            console.log(`Loading new point cloud from URL: ${treeUrl}`);
            viewer.setScene(new Potree.Scene(viewer)); 

            Potree.loadPointCloud(treeUrl).then(
                (event) => {
                    if (!viewRef.current || !viewRef.current.scene) {
                        console.error("Potree viewer or scene became unavailable during point cloud load.");
                        setPointCloudLoaded(false);
                        return;
                    }
                    const currentViewer = viewRef.current;
                    const pointcloud = event.pointcloud;
                    pointcloud.potree_url = treeUrl; // Tag the pointcloud with its URL
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
                    if (viewRef.current) {
                       viewRef.current.setScene(new Potree.Scene(viewRef.current));
                    }
                    setPointCloudLoaded(false);
                }
            );
        }
    } else if (!treeUrl && viewer && pointCloudLoaded) {
        console.log("Tree URL removed or empty, clearing scene.");
        clearSceneCompletely();
    }
  }, [treeUrl, pointCloudLoaded]);

  // Potree Render on Window Resize
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

  const toggleMiniMap = () => {
    setShowMiniMap(prevShowState => {
        const newShowState = !prevShowState;
        if (!newShowState) {
            // If hiding, immediately make it invisible
            setMiniMapContainerStyle(prevStyle => ({...prevStyle, visibility: 'hidden'}));
        }
        // If showing, the useEffect watching showMiniMap will call updateMiniMapPosition
        return newShowState;
    });
  };

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
    viewerWrapper: { // This is the parent for Draggable and MiniMap
      flex: 1,
      display: "flex",
      position: "relative", // Crucial for absolute positioning of children
      overflow: "hidden",   // Important to contain absolutely positioned children
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
        <Box sx={styles.viewerWrapper} ref={viewerWrapperRef}> {/* Assign ref here */}
          <Box
            id="potree_render_area"
            ref={viewElemRef}
            sx={styles.renderArea}
          />
          <Box
            id="potree_sidebar_container"
            ref={sidebarContainerRef}
          />

          <Draggable
            nodeRef={draggableButtonRef} // Pass the ref here
            position={buttonPosition}    // Controlled position
            onStart={handleDragStart}
            onStop={handleDragStop}
            bounds="parent" // Constrain dragging within viewerWrapper
          >
            <IconButton
              ref={draggableButtonRef} // Assign the ref to the DOM element
              onClick={toggleMiniMap}
              sx={{
                position: 'absolute', // Needed for Draggable to apply transform
                // Initial CSS position if buttonPosition is {x:0, y:0}.
                // Draggable effectively translates from this spot.
                // We set some defaults here, but they are overridden by saved buttonPosition.
                bottom: '15px', 
                right: '15px',
                zIndex: 1002,
                backgroundColor: 'rgba(0, 0, 0, 0.1)',
                color: 'white',
                borderRadius: '50%',
                width: BUTTON_FIXED_SIZE, // Use constant
                height: BUTTON_FIXED_SIZE, // Use constant
                cursor: 'grab',
                '&:hover': {
                  backgroundColor: 'rgba(0, 0, 0, 0.3)',
                },
                boxShadow: '0 2px 5px rgba(0,0,0,0.3)',
              }}
              title={showMiniMap ? "Hide Mini-map (Drag to move)" : "Show Mini-map (Drag to move)"}
            >
              {showMiniMap ? <CloseIcon fontSize="small"/> : <MapIcon fontSize="small"/>}
            </IconButton>
          </Draggable>

          {/* Mini-map Container now uses miniMapContainerStyle */}
          {showMiniMap && (
            <Box sx={miniMapContainerStyle}>
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
                  mapHeight="100%" // MiniMap component itself should handle its internal layout
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