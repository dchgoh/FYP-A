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
    backgroundImage: 'url(/assets/background.png)',
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    backgroundRepeat: 'no-repeat',
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
  
  controlsContent: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },
  
  fileInput: {
    display: 'none'
  },
  
  uploadButton: {
    backgroundColor: colors.primary[700],
    color: '#FFFFFF',
    '&:hover': {
      backgroundColor: colors.primary[500],
    },
  },

  checkbox: {
    color: colors.primary[300],
    '&.Mui-checked': {
      color: colors.primary[400],
    },
    '&:hover': {
      backgroundColor: colors.primary[500] + '20',
    },
  },

  checkboxLabel: {
    color: colors.grey[200],
    fontWeight: 'bold',
    '& .MuiFormControlLabel-label': {
      fontSize: '0.9rem',
    },
  },

  filterModeSelect: {
    mt: 1,
    '& .MuiOutlinedInput-root': {
      color: colors.grey[200],
      '& fieldset': {
        borderColor: colors.grey[600],
      },
      '&:hover fieldset': {
        borderColor: colors.primary[500],
      },
      '&.Mui-focused fieldset': {
        borderColor: colors.primary[500],
      },
    },
    '& .MuiInputLabel-root': {
      color: colors.grey[400],
      '&.Mui-focused': {
        color: colors.primary[500],
      },
    },
    '& .MuiSelect-icon': {
      color: colors.grey[400],
    },
  },

  moreItemsText: {
    color: colors.grey[400],
    fontSize: '0.75rem',
    textAlign: 'center',
    fontStyle: 'italic',
    mt: 1,
  },

  selectAllItem: {
    display: 'flex',
    alignItems: 'center',
  },

  selectAllText: {
    color: colors.grey[200],
    flex: 1,
    fontSize: '0.875rem',
    fontWeight: 'bold',
  },
  
  selectedFileText: {
    color: colors.grey[100],
    fontSize: '0.9rem',
    textAlign: 'center',
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
    mt: 1,
    p: 2,
    backgroundColor: colors.grey[800],
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
    backgroundColor: colors.grey[800],

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
  
});

export const getResponsiveMarginLeft = (isCollapsed) => ({
  xs: isCollapsed ? "80px" : "80px",
  sm: isCollapsed ? "80px" : "270px",
  md: isCollapsed ? "80px" : "270px",
  lg: isCollapsed ? "80px" : "270px",
  xl: isCollapsed ? "80px" : "270px",
});

