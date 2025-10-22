**ISBNet Inference Engine**



This guide is for developers who need to set up the engine and integrate it into a backend application, such as the project dashboard.



==================

**Table of Contents**

==================

1. How to Use (For Integration)
2. One-Time Local Setup (For Windows Users with NVIDIA GPU)
3. One-Time Local Setup (For CPU-Only Users)
4. Daily Workflow





============================

**How to Use (For Integration)**

============================

The core of this engine is a single Python script: run\_inference\_local.py



**Command Syntax:**

python run\_inference\_local.py <input\_las> <output\_las> <config> <checkpoint>



**Arguments:**

1. <input\_las>: The absolute path to the raw input .las file.

2\. <output\_las>: The absolute path where the final .las prediction file should be saved.

3\. <config>: The path to the model's configuration file (e.g., configs/config\_forinstance.yaml).

4\. <checkpoint>: The path to the trained model weights (e.g., configs/best.pth).



**Example Command (to be run from within WSL/Ubuntu):**

python run\_inference\_local.py \\

&nbsp;   /fred/oz419/brenda/isbnet\_inference\_engine/test\_samples/plot\_10\_annotated.las \\

&nbsp;   /fred/oz419/brenda/isbnet\_inference\_engine/output/plot\_10\_annotated\_prediction.las \\

&nbsp;   /fred/oz419/brenda/isbnet\_inference\_engine/configs/config\_forinstance.yaml \\

&nbsp;   /fred/oz419/brenda/isbnet\_inference\_engine/configs/best.pth



**Note:** The command should be run from the root of the isbnet\_inference\_engine directory.





==========================================================

**2. One-Time Local Setup (For Windows Users with NVIDIA GPU)**

===========================================================

Each developer must perform this one-time setup on their machine to compile the engine's dependencies. This setup requires the Windows Subsystem for Linux (WSL2).



**Phase A: Install WSL2 and System Tools**



1. **Install WSL2:** Follow the official Microsoft guide to install WSL2 ( https://learn.microsoft.com/en-us/windows/wsl/install ). Choose the Ubuntu distribution.



**2. Install NVIDIA Driver on Windows (CRITICAL):**

* Find your GPU model: Open Task Manager (Ctrl+Shift+Esc), go to the "Performance" tab, and click "GPU". The name is in the top-right corner (e.g., "NVIDIA GeForce RTX 3080").
* Go to the NVIDIA Driver Downloads page ( https://www.nvidia.com/Download/index.aspx ).
* Use the "Manual Driver Search" section to find your GPU.
* For "Download Type", select the Studio Driver (SD) for best stability.
* Download, install the driver using the "Express" option, and restart your computer.



**3. Install System Prerequisites inside WSL/Ubuntu:**

* Open your Ubuntu terminal (from the Start Menu).
* Run the following commands:

&nbsp;	sudo apt-get update

&nbsp;	sudo apt-get install build-essential libsparsehash-dev mamba -y



**4. Install the CUDA Toolkit inside WSL/Ubuntu:**

Run this command in your Ubuntu terminal. This step can take several minutes.

&nbsp;	sudo apt-get install cuda-toolkit -y



**5. Verify GPU and CUDA Setup:**

* Close and reopen your Ubuntu terminal.
* Run these two commands to confirm everything is working:

&nbsp;	1. This should show a table with your GPU name

&nbsp;		nvidia-smi



&nbsp;	2. This should print the CUDA compiler version.

&nbsp;		nvcc --version



* If both commands run successfully, your system is ready.





**Phase B: Set Up Python Environment \& Compile**



1. **Navigate to the Project:** In your Ubuntu terminal, navigate to this isbnet\_inference\_engine directory.



**Note:** Your Windows C:\\ drive is located at /mnt/c/.

**Example:** cd /mnt/c/Projects/isbnet\_inference\_engine



**2. Create the Conda Environment:**

&nbsp;	mamba env create -f environment.yml



**3. Activate the Environment:**

&nbsp;	mamba activate isbnet\_env



**4. Compile the Code:**

* You MUST set your GPU's architecture. Find its "Compute Capability" online (e.g., an RTX 3080 is 8.6).

&nbsp;	export TORCH\_CUDA\_ARCH\_LIST="8.6"

&nbsp;	**IMPORTANT:** Change this value ^ to match your GPU!

* Now, compile the two required components:



&nbsp;	1. Compile PointNet++ Extensions

&nbsp;		cd isbnet/pointnet2

&nbsp;		python setup.py install

&nbsp;		cd ../..



&nbsp;	2. Compile Other Extensions

&nbsp;		python setup.py build\_ext --inplace





=============================================

**3. One-Time Local Setup (For CPU-Only Users)**

=============================================

If you do not have an NVIDIA GPU, your setup is simpler. The script will run on your CPU, but be aware that it will be very slow.



**Phase A: Install WSL2 and System Tools**



1. **Install WSL2:** Follow the official Microsoft guide ( https://learn.microsoft.com/en-us/windows/wsl/install ). Choose Ubuntu.



**2. Install System Prerequisites:** In your Ubuntu terminal, run:

&nbsp;	sudo apt-get update

&nbsp;	sudo apt-get install build-essential libsparsehash-dev mamba -y



(You can SKIP all NVIDIA Driver and CUDA Toolkit steps).





**Phase B: Set Up Python Environment \& Compile**



1. **Navigate to the Project directory** in your Ubuntu terminal.



**2. Create the Conda Environment:** mamba env create -f environment.yml



**3. Activate the Environment:** mamba activate isbnet\_env



**4. Compile the Code (for CPU):**



\#You do NOT need to run the 'export TORCH\_CUDA\_ARCH\_LIST' command.



&nbsp;	1. Compile PointNet++ Extensions

&nbsp;		cd isbnet/pointnet2

&nbsp;		python setup.py install

&nbsp;		cd ../..



&nbsp;	2. Compile Other Extensions

&nbsp;		python setup.py build\_ext --inplace





==================

**4. Daily Workflow**

==================

After the one-time setup is complete, this is all you need to do to run an inference.



1. Open your Ubuntu terminal.

2\. Navigate to the isbnet\_inference\_engine directory.

3\. Activate the conda environment: mamba activate isbnet\_env

4\. Run the script with the desired file paths.



================

**Troubleshooting**

================

If you encounter deep compilation errors, you can refer to the original author's installation guide for additional context, but be aware that it may be outdated: https://github.com/VinAIResearch/ISBNet/blob/master/docs/INSTALL.md


