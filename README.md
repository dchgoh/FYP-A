# AI-Driven 3D Tree Organ Segmentation and Data Inventory for Forest Management

This project provides a web-based interface built with ReactJS for visualizing 3D point cloud data, performing AI-driven semantic segmentation of tree organs, managing forest inventory data, and streamlining point cloud processing workflows. It utilizes Potree for efficient rendering and interaction with large point clouds.

## Features

*   **Interactive 3D Point Cloud Visualization:** Display and navigate large point cloud datasets using Potree.
*   **Map Integration:** View forest data, point clouds, and tree locations overlaid on a geographical map.
*   **Automated Point Cloud Processing Pipeline:**
    *   **.LAS/.LAZ File Upload:** Directly upload raw point cloud files (e.g., `.las`, `.laz`).
    *   **Automatic Potree Conversion:** Uploaded files are automatically converted to the Potree format for efficient web visualization.
    *   **Automatic AI-Powered Semantic Segmentation of Tree Organs:**
        *   Following conversion, the system automatically performs AI-driven segmentation to identify and delineate key tree components from the point cloud, such as:
            *   Low-Vegetation
            *   Stem
            *   Live-Branches
            *   Woody-Branches
            *   Terrain
        *   *(Note: Segmentation of individual, distinct trees is a future development goal.)*
*   **Real-time Data Extraction & Display:**
    *   Automatic extraction and display of key tree metrics based on segmented organs:
        *   Tree Height
        *   Diameter at Breast Height (DBH) / Stem Diameter
        *   Crown Diameter/Area (derived from foliage/branch segmentation)
        *   Tree Volume (estimated stem/total volume)
*   **Carbon Stock Estimation:** Calculate and display estimated carbon sequestration for inventoried trees based on extracted metrics.
*   **Hierarchical Data Organization:**
    *   Manage data within a structured hierarchy: **Division -> Project -> Plot**.
*   **Data and File Filtering System:** Robust filtering capabilities to easily find and manage specific datasets, files, or inventory records.
*   **Team Management:** Functionality to manage users, assign roles, and control access to projects and data within a collaborative environment.
*   **User-Friendly Interface:** Built with ReactJS for a modern, responsive, and intuitive web experience.

## Prerequisites

Before you begin, ensure you have the following installed:

*   **Node.js and npm:** (e.g., v18.x or later for Node, npm usually comes with it)
    *   [Download Node.js](https://nodejs.org/)
*   **Git:** For cloning the repository.
    *   [Download Git](https://git-scm.com/)
*   **Docker Desktop:** Required for running dependent services, particularly the AI backend which handles file conversion and segmentation.
    *   [Download Docker Desktop](https://www.docker.com/products/docker-desktop/)

## Getting Started

Follow these steps to set up and run the project locally:

1. **Clone this Repository:**
   ```bash
   git clone git@github.com:dchgoh/FYP-A.git
   cd FYP-A
   ```

2. **Install Project Dependencies:**
   Install all the necessary Node.js packages for this application.
   ```bash
   npm install
   ```

4. **Start Docker:**
   Open Docker Desktop and ensure it is running.

5. **Run the Application:**
   Start the React development server.
   ```bash
   npm start
   ```
   This will typically open the application in your default web browser at `http://localhost:3000`

6. **Run test.las File:**
*   Go to the Upload section within the app interface.
*   Select and upload input (e.g. test.las) file.
*   The system will automatically begin processing the file.

## Technologies Used
*   **Frontend:** ReactJS
*   **3D Visualization:** Potree
*   **Mapping Library:** Leaflet
*   **Styling:** CSS Modules, Styled Components
*   **AI/Machine Learning:** PyTorch (framework for training and deployment), PointNet++ (deployed semantic segmentation model architecture), PointNet (model architecture used in training/evaluation)
*   **Package Management:** npm
*   **Containerization:** Docker


## Acknowledgements
This project acknowledges the foundational work and resources that made it possible:

*   **Dataset:** We utilized the **`for-instance` dataset** for training, testing and demonstrating point cloud processing. We thank **Gherardo Puliti** and co-authors for making this valuable resource available:
    ```
    Puliti, S, Pearse, G, Surový, P, Wallace, L, Hollaus, M, Wielgosz, M & Astrup, R 2023, FOR-instance: a UAV laser scanning benchmark dataset for semantic and instance segmentation of individual trees, Zenodo, viewed 30 April 2025, <https://zenodo.org/record/8287792>.
    ```

*   **Deep Learning Architectures:** Our AI segmentation is based on the pioneering work on deep learning for point clouds by **Charles R. Qi** and his colleagues. We acknowledge and reference the following key publications:
    ```
    Qi, CR, Su, H, Mo, K & Guibas, LJ 2017, PointNet: Deep Learning on Point Sets for 3D Classification and Segmentation, arXiv, viewed 30 April 2025, <http://arxiv.org/abs/1612.00593>.
    ```
    ```
    Qi, CR, Yi, L, Su, H & Guibas, LJ 2017, PointNet++: Deep Hierarchical Feature Learning on Point Sets in a Metric Space, arXiv, viewed 30 April 2025, <http://arxiv.org/abs/1706.02413>.
    ```
