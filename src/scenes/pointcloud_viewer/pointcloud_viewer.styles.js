import { tokens } from '../../theme';

export const createStyles = (theme, colors) => ({
  container: {
    display: "flex",
    minHeight: "100vh",
    bgcolor: colors.grey[800],
    marginLeft: {
      xs: "80px",
      sm: "270px",
    },
    transition: "margin 0.3s ease",
    padding: 0,
    overflowX: 'hidden'
  },
  
  content: {
    flex: 1,
    p: { xs: 1.5, sm: 2, md: 3 },
    overflowY: 'auto',
    overflowX: 'hidden',
    maxWidth: '100%'
  },
  
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center"
  },
  
  title: {
    color: colors.grey[100],
    fontWeight: "bold"
  },
  
  uploadSection: {
    mt: "20px"
  },
  
  uploadPaper: {
    p: 3,
    backgroundColor: colors.primary[400],
    borderRadius: "10px"
  },
  
  uploadContent: {
    display: "flex",
    flexDirection: "column",
    gap: 2
  },
  
  uploadTitle: {
    color: colors.grey[100]
  },
  
  buttonContainer: {
    display: "flex",
    gap: 2,
    alignItems: "center"
  },
  
  fileInput: {
    display: 'none'
  },
  
  uploadButton: {
    backgroundColor: colors.blueAccent[500],
    color: colors.grey[800],
    '&:hover': {
      backgroundColor: colors.blueAccent[600],
    },
  },
  
  visibilityButton: {
    backgroundColor: colors.greenAccent[500],
    color: colors.grey[100],
    '&:hover': {
      backgroundColor: colors.greenAccent[600],
    },
  },
  
  selectedFileText: {
    color: colors.grey[200]
  },
  
  errorAlert: {
    mt: 2
  },
  
  loadingContainer: {
    display: "flex",
    alignItems: "center",
    gap: 2
  },
  
  loadingText: {
    color: colors.grey[200]
  },
  
  canvasSection: {
    mt: "20px"
  },
  
  canvasPaper: {
    height: '600px',
    backgroundColor: colors.primary[400],
    borderRadius: "10px",
    overflow: 'hidden'
  },
  
  canvas: {
    width: '100%',
    height: '100%',
    display: 'block'
  }
});

export const getResponsiveMarginLeft = (isCollapsed) => ({
  xs: isCollapsed ? "80px" : "80px",
  sm: isCollapsed ? "80px" : "270px",
});
