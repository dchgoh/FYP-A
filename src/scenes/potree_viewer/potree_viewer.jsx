import React, { useEffect, useRef, useState } from "react";
import { Box, useTheme } from "@mui/material";
import { useLocation } from "react-router-dom";
import { tokens } from "../../theme"; // Import theme tokens

const Potree = window.Potree;

const PotreeViewer = ({ isCollapsed }) => {

  const theme = useTheme();
  const colors = tokens(theme.palette.mode); // Get colors from theme

  const viewRef = useRef(null);
  const viewElemRef = useRef(null);
  const sidebarContainerRef = useRef(null);
  const location = useLocation();
  const [treeUrl, setTreeUrl] = useState(null);
  const [pointCloudLoaded, setPointCloudLoaded] = useState(false);

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
          // Show the sidebar and scene panel by default
          viewer.toggleSidebar();
          const sceneMenu = document.getElementById("menu_scene");
          if (sceneMenu) {
            const nextElement = sceneMenu.nextElementSibling;
            if (nextElement && nextElement.style) {
              nextElement.style.display = "block"; // Show scene panel
            }
          }
        });
      }
    }

    const searchParams = new URLSearchParams(location.search);
    const newTreeUrl = searchParams.get("url");

    if (newTreeUrl && newTreeUrl !== treeUrl) {
      setTreeUrl(newTreeUrl);
      setPointCloudLoaded(false); // Reset the loaded flag when the URL changes.
    } else if (!newTreeUrl) {
      console.error("Potree URL not provided.");
    }
  }, [colors, location.search]);

  useEffect(() => {
    const styleId = "potree-theme-override";
    let styleTag = document.getElementById(styleId);
  
    if (!styleTag) {
      styleTag = document.createElement("style");
      styleTag.id = styleId;
      document.head.appendChild(styleTag);
    }
  
    styleTag.innerHTML = `
      #sidebar_header {
        display: none;
      }

      #potree_sidebar_container {
        background-color: ${colors.grey[800]} !important;
        border-top: 1px solid grey;
        scrollbar-color: #e0e0e0 #888;
      }
  
      #menu_appearance,
      #menu_tools,
      #menu_scene,
      #menu_filters,
      #menu_about {
        background-color: ${colors.primary[700]} !important;
        color: ${colors.grey[100]} !important;
        text-shadow: none;
        font-family: "Inter", sans-serif;
        box-shadow: 0px 3px 3px ${colors.grey[800]};
        border: 1px solid ${colors.grey[800]};
      }

      #potree_sidebar_container span, 
      #potree_sidebar_container legend, 
      #potree_sidebar_container li, 
      #potree_sidebar_container #scene_export, 
      #potree_sidebar_container i, 
      #potree_sidebar_container b, 
      #potree_sidebar_container th, 
      #potree_sidebar_container tr, 
      #potree_sidebar_container a, 
      #potree_sidebar_container .heading, 
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

    `;
  }, [colors]);
  

  useEffect(() => {
    if (treeUrl && viewRef.current && !pointCloudLoaded) {
      viewRef.current.setScene(new Potree.Scene(viewRef.current));
      Potree.loadPointCloud(treeUrl).then(
        (event) => {
          const pointcloud = event.pointcloud;
          const material = pointcloud.material;

          material.activeAttributeName = "rgba";
          material.minSize = 2;
          material.pointSizeType = Potree.PointSizeType.FIXED;

          viewRef.current.scene.addPointCloud(pointcloud);
          viewRef.current.fitToScreen();
          viewRef.current.setLeftView();

          const classificationScheme = {
            0: { visible: true, name: "Unclassified", color: [0.75, 0.75, 0.75, 1.0] },         // Gray
            1: { visible: true, name: "Low-vegetation", color: [0.6, 0.8, 0.2, 1.0] },          // Light green
            2: { visible: true, name: "Terrain", color: [0.545, 0.271, 0.075, 1.0] },           // Brown (Ground)
            3: { visible: true, name: "Out-points", color: [1.0, 0.0, 1.0, 1.0] },              // Magenta
            4: { visible: true, name: "Stem", color: [0.627, 0.322, 0.176, 1.0] },              // Dark brown (Trunk)
            5: { visible: true, name: "Live branches", color: [0.133, 0.545, 0.133, 1.0] },     // Forest green
            6: { visible: true, name: "Woody branches", color: [0.36, 0.25, 0.2, 1.0] },        // Darker brown-gray
          };

          viewRef.current.setClassifications(classificationScheme);
          setPointCloudLoaded(true); // Set the loaded flag after successful load.
        },
        (error) => console.error("Failed to load point cloud:", error)
      );
    }
  }, [treeUrl, viewRef, pointCloudLoaded]);

  useEffect(() => {
    const handleResize = () => {
      if (viewRef.current) {
        viewRef.current.render();
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const styles = {
    container: {
      display: "flex",
      height: "100vh", // full viewport height
      bgcolor: colors.grey[800],
      marginLeft: isCollapsed ? "80px" : "270px",
      transition: "margin 0.3s ease",
    },
    content: {
      flex: 1,
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
    },
    viewerWrapper: {
      flex: 1,
      display: "flex",
      position: "relative",
    },
    renderArea: {
      flex: 1,
      position: "relative",
      border: "1px solid grey",
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
            sx={styles.sidebar}
          >
            {/* Potree GUI will be loaded here */}
          </Box>
        </Box>
      </Box>
    </Box>
  );
};

export default PotreeViewer;