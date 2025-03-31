import React, { useEffect, useRef } from "react"
const TreeUrl = "/pointclouds/metadata.json"

const Potree = window.Potree

const PotreeViewer = () => {
  const viewRef = useRef(null)
  const viewElemRef = useRef(null)

  useEffect(() => {
    // 场景初始化
    const viewer = new Potree.Viewer(viewElemRef.current)
    viewRef.current = viewer
    viewer.setEDLEnabled(true)
    viewer.setFOV(60)
    viewer.setPointBudget(1 * 1000 * 1000)
    viewer.setClipTask(Potree.ClipTask.SHOW_INSIDE)
    viewer.loadSettingsFromURL()
    viewer.setControls(viewer.earthControls)
    viewer.setBackground("black")

    // 加载 potree 转换出来的数据
    Potree.loadPointCloud(TreeUrl).then(
      (evet) => {
        let pointcloud = evet.pointcloud
        let material = pointcloud.material
        material.activeAttributeName = "rgba"
        material.minSize = 2
        material.pointSizeType = Potree.PointSizeType.FIXED
        
        viewer.scene.addPointCloud(pointcloud)
        viewer.fitToScreen()
        viewer.setLeftView()
      },
      (error) => console.error("ERROR: ", error)
    )
  }, [viewRef])

  return (
    <>
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: "100%",
          height: "100%"
        }}
        className="csm-viewer-container"
        id="csm-viewer-container"
        ref={viewElemRef}
      ></div>
    </>
  )
}

export default PotreeViewer