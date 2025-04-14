import React, { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";

const Potree = window.Potree;

const PotreeViewer = () => {
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
  }, [location.search]);

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
            2: { visible: true, name: "Ground", color: [0.545, 0.271, 0.075, 1.0] },
            3: { visible: true, name: "Trunk", color: [0.627, 0.322, 0.176, 1.0] },
            5: { visible: true, name: "Vegetation", color: [0.133, 0.545, 0.133, 1.0] },
            DEFAULT: { visible: true, name: "Unclassified", color: [0.75, 0.75, 0.75, 1.0] }
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