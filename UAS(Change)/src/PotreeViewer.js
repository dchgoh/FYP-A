import React, { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom"; // Import useLocation

const Potree = window.Potree;

const PotreeViewer = () => {
  const viewRef = useRef(null);
  const viewElemRef = useRef(null);
  const location = useLocation(); // Get the current location

  useEffect(() => {
    // Get the URL parameter
    const searchParams = new URLSearchParams(location.search);
    const treeUrl = searchParams.get("url");

    if (!treeUrl) {
      console.error("Potree URL not provided.");
      return;
    }

    // Scene initialization
    const viewer = new Potree.Viewer(viewElemRef.current);
    viewRef.current = viewer;
    viewer.setEDLEnabled(true);
    viewer.setFOV(60);
    viewer.setPointBudget(1 * 1000 * 1000);
    viewer.setClipTask(Potree.ClipTask.SHOW_INSIDE);
    viewer.loadSettingsFromURL();
    viewer.setControls(viewer.orbitControls);
    viewer.setBackground("black");

    // Load potree data
    Potree.loadPointCloud(treeUrl).then(
      (evet) => {
        let pointcloud = evet.pointcloud;
        let material = pointcloud.material;
        material.activeAttributeName = "rgba";
        material.minSize = 2;
        material.pointSizeType = Potree.PointSizeType.FIXED;

        viewer.scene.addPointCloud(pointcloud);
        viewer.fitToScreen();
        viewer.setLeftView();
      },
      (error) => console.error("ERROR: ", error)
    );
  }, [location.search]); // Re-run effect when location.search changes

  return (
    <>
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: "100%",
          height: "100%",
        }}
        className="csm-viewer-container"
        id="csm-viewer-container"
        ref={viewElemRef}
      ></div>
    </>
  );
};

export default PotreeViewer;