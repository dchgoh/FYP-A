import { tokens } from '../../theme';

export const createStyles = (theme, colors) => ({
  container: {
    display: "flex",
    height: "calc(100vh - 112px)", // Adjusted for top bar
    bgcolor: colors.grey[900],
    transition: "margin 0.3s ease",
    position: 'relative',
    width: '100%',
  },
  
  content: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    position: "relative",
  },
  
  viewerWrapper: {
    flex: 1,
    display: "flex",
    position: "relative",
    overflow: "hidden",
    width: '100%',
    height: '100%',
  },
  
  controlsSidebar: {
    width: '300px',
    height: '100%',
    backgroundColor: colors.grey[800],
    borderTop: `1px solid ${colors.grey[700]}`,
    borderRight: `2px solid ${colors.grey[600]}`,
    borderBottom: `1px solid ${colors.grey[700]}`,
    display: 'flex',
    flexDirection: 'column',
    overflowY: 'auto',
  },
  
  controlsPaper: {
    p: 2,
    backgroundColor: 'transparent',
    borderRadius: 0,
    boxShadow: 'none',
    display: 'flex',
    flexDirection: 'column',
    minHeight: 'fit-content',
  },
  
  renderArea: {
    flex: 1,
    position: "relative",
    border: `1px solid ${colors.grey[700]}`,
  },
  
  canvas: {
    width: '100%',
    height: '100%',
    display: 'block'
  },
  
  controlsTitle: {
    color: colors.grey[100],
    fontWeight: "bold",
    mb: 2,
    textAlign: 'center'
  },
  
  selectedFileTextTop: {
    color: colors.blueAccent[400],
    fontSize: '0.9rem',
    fontWeight: 'bold',
    wordBreak: 'break-all',
    textAlign: 'center',
    p: 1,
    mb: 2,
  },
  
  controlsContent: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },
  
  fileInput: {
    display: 'none'
  },
  
  uploadButton: {
    backgroundColor: colors.blueAccent[500],
    color: '#FFFFFF',
    '&:hover': {
      backgroundColor: colors.blueAccent[600],
    },
  },
  
  visibilityButton: {
    borderColor: colors.greenAccent[500],
    color: colors.greenAccent[500],
    '&:hover': {
      borderColor: colors.greenAccent[600],
      backgroundColor: colors.greenAccent[500],
      color: colors.grey[100],
    },
  },
  
  selectedFileText: {
    color: colors.grey[200],
    fontSize: '0.875rem',
    wordBreak: 'break-all',
    textAlign: 'left',
    p: 1,
    backgroundColor: colors.grey[700],
    borderRadius: '4px',
    border: `1px solid ${colors.grey[600]}`,
  },
  
  errorAlert: {
    mt: 1
  },
  
  loadingContainer: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 1
  },
  
  loadingText: {
    color: colors.grey[200],
    fontSize: '0.875rem'
  },
  
  classificationSection: {
    mt: 2,
    p: 2,
    backgroundColor: colors.grey[700],
    borderRadius: '8px',
    border: `1px solid ${colors.grey[600]}`,
  },
  
  classificationTitle: {
    color: colors.grey[100],
    fontWeight: "bold",
    mb: 2,
    textAlign: 'center',
    fontSize: '1rem'
  },
  
  classificationItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 1,
    mb: 1,
    p: 1,
    backgroundColor: colors.grey[800],
    borderRadius: '4px',
    border: `1px solid ${colors.grey[600]}`,
  },
  
  classificationColor: {
    width: '20px',
    height: '20px',
    borderRadius: '50%',
    border: `1px solid ${colors.grey[500]}`,
    flexShrink: 0,
  },
  
  classificationName: {
    color: colors.grey[200],
    flex: 1,
    fontSize: '0.875rem'
  },
  
  classificationToggle: {
    minWidth: '60px',
    fontSize: '0.75rem',
    height: '28px',
    backgroundColor: colors.blueAccent[500],
    color: colors.grey[900],
    '&:hover': {
      backgroundColor: colors.blueAccent[600],
    },
    '&.MuiButton-outlined': {
      borderColor: colors.grey[500],
      color: colors.grey[200],
      backgroundColor: 'transparent',
    }
  }
});

export const getResponsiveMarginLeft = (isCollapsed) => ({
  xs: isCollapsed ? "80px" : "80px",
  sm: isCollapsed ? "80px" : "270px",
  md: isCollapsed ? "80px" : "270px",
  lg: isCollapsed ? "80px" : "270px",
  xl: isCollapsed ? "80px" : "270px",
});

