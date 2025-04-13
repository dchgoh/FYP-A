import React, { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom"; // Import useLocation

const Potree = window.Potree;

const PotreeViewer = () => {
  const viewRef = useRef(null);
  const viewElemRef = useRef(null);
  const sidebarContainerRef = useRef(null);
  const location = useLocation(); // Get the current location

  useEffect(() => {
    // Initialize viewer once
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
      // Load GUI - Ensure sidebar ref exists
      if (sidebarContainerRef.current) {
        viewer.loadGUI();
      }
    }

    // Load point cloud from URL query parameter
    const searchParams = new URLSearchParams(location.search);
    const treeUrl = searchParams.get("url");

    if (treeUrl && viewRef.current) {
      // Remove existing point clouds before loading new one
      if (viewRef.current.scene.pointclouds.length > 0) {
        viewRef.current.scene.removeAllPointClouds();
      }

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
        },
        (error) => console.error("Failed to load point cloud:", error)
      );
    } else if (!treeUrl) {
      console.error("Potree URL not provided.");
    }
  }, [location.search]);

  // Optional: Rerender viewer on window resize
  useEffect(() => {
    const handleResize = () => {
      if (viewRef.current) {
        viewRef.current.render();
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return (
    <div
      className="csm-viewer-container"
      id="csm-viewer-container"
      style={{
        position: "absolute",
        width: "100%",
        height: "100%",
        left: "0px",
        top: "0px",
        display: "flex",
        flexDirection: "row",
      }}
    >
      <div
        id="potree_render_area"
        ref={viewElemRef}
        style={{
          flexGrow: 1,
          height: "100%",
        }}
      />
      <div
        id="potree_sidebar_container"
        ref={sidebarContainerRef}
        style={{
          width: "350px",
          backgroundColor: "#444",
          color: "white",
          padding: "10px",
          overflowY: "auto",
        }}
      >
        {/* Potree GUI will be loaded here */}
      </div>
    </div>
  );
};

export default PotreeViewer;