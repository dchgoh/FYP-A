# ReactJS: AI-Driven 3D Tree Organ Segmentation and Data Inventory for Forest Management

This project provides a web-based interface built with ReactJS for visualizing 3D point cloud data, performing AI-driven semantic segmentation of tree organs, managing forest inventory data, and streamlining point cloud processing workflows. It utilizes Potree for efficient rendering and interaction with large point clouds.

## Features

*   **Interactive 3D Point Cloud Visualization:** Display and navigate large point cloud datasets using Potree.
*   **Map Integration:** View forest data, point clouds, and tree locations overlaid on a geographical map.
*   **Automated Point Cloud Processing Pipeline:**
    *   **.LAS/.LAZ File Upload:** Directly upload raw point cloud files (e.g., `.las`, `.laz`).
    *   **Automatic Potree Conversion:** Uploaded files are automatically converted to the Potree format for efficient web visualization.
    *   **Automatic AI-Powered Semantic Segmentation of Tree Organs:**
        *   Following conversion, the system automatically performs AI-driven segmentation to identify and delineate key tree components from the point cloud, such as:
            *   Vegetation
            *   Stem
            *   Branches
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
*   **Potree Library Files:** You will need the `build` and `libs` folders from Potree for the frontend viewer. See step 3 in "Getting Started" for how to obtain these.

## Getting Started

Follow these steps to set up and run the project locally:

1.  **Clone this Repository:**
    ```bash
    git clone <your-repository-url>
    cd <project-directory-name>
    ```

2.  **Install Project Dependencies:**
    Install all the necessary Node.js packages for this application.
    ```bash
    npm install
    ```

3.  **Set up Potree Library Files (for Frontend Viewer):**
    The React application needs the Potree library files (`build` and `libs` folders) to render 3D point clouds in the browser.

    a.  **Create a `potree` directory in `public`:**
        If it doesn't already exist, create a `potree` folder inside your project's `public` directory:
        ```bash
        # Navigate to your project's root if you aren't already there
        mkdir public/potree
        ```

    b.  **Obtain Potree `build` and `libs` folders:**
        1.  In a separate directory (outside your project), clone the official Potree repository:
        ```bash
        git clone https://github.com/potree/potree.git
        cd potree
        ```
        2.  Install Potree's dependencies. This will also generate the necessary `build` folder.
        ```bash
        npm install
        ```
        3.  Copy the generated `build` folder and the existing `libs` folder from your local Potree clone into this project's `public/potree/` directory.

    c.  **Verify Structure:**
        Your project's `public/potree/` directory should look similar to this:
        ```text
        <project-directory-name>/
        ├── public/
        │   ├── potree/
        │   │   ├── build/
        │   │   │   └── potree/
        │   │   │       └── potree.js
        │   │   │       └── ... (other build files like potree.css, workers)
        │   │   ├── libs/
        │   │   │   └── ... (various JS libraries like three.js, laslaz, proj4, etc.)
        │   │   └── ... (other Potree assets like icons, resources if needed)
        │   ├── index.html
        │   └── ... (other public assets)
        ├── src/
        └── package.json
        └── ...
        ```
        *Note: Ensure `potree.js` and its associated CSS/worker files are correctly placed and accessible for the frontend viewer.*

4.  **Start Docker:**
    Open Docker Desktop and ensure it is running. The AI backend, which handles `.las` file uploads, Potree conversion (likely using PotreeConverter internally), and AI segmentation, is expected to run in Docker containers.
    *(If there are specific `docker-compose.yml` files or `Dockerfile`s for backend services, mention them here. For example: "Navigate to the `backend/` directory and run `docker-compose up -d`".)*

5.  **Run the Application:**
    Start the React development server.
    ```bash
    npm start
    ```
    This will typically open the application in your default web browser at `http://localhost:3000` (or the port configured in your project).

## Technologies Used

*   **Frontend:** ReactJS
*   **3D Visualization:** Potree
*   **Mapping Library:** Leaflet
*   **Styling:** CSS Modules, Styled Components
*   **AI/Machine Learning Backend:** PyTorch
    *   Includes logic for `.las`/`.laz` processing, Potree conversion (e.g., using PotreeConverter), and semantic segmentation.
*   **Package Management:** npm
*   **Containerization:** Docker (for AI backend and other services)