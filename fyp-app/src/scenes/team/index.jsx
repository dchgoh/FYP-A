import {
  Box,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Checkbox,
  Typography,
  useTheme,
} from "@mui/material";
import { tokens } from "../../theme";
import { useState } from "react";

const Team = ({ isCollapsed }) => { // Receive isCollapsed as a prop
  const theme = useTheme();
  const colors = tokens(theme.palette.mode);

  const [selected, setSelected] = useState([]);

  const teamMembers = [
    { id: 1, name: "Jon Snow", age: 35, email: "jonsnow@gmail.com", access: "admin" },
    { id: 2, name: "Cersei Lannister", age: 42, email: "cerseilannister@gmail.com", access: "manager" },
    { id: 3, name: "Jaime Lannister", age: 45, email: "jaimelannister@gmail.com", access: "user" },
    { id: 4, name: "Anya Stark", age: 16, email: "anyastark@gmail.com", access: "admin" },
    { id: 5, name: "Daenerys Targaryen", age: 31, email: "daenerystargaryen@gmail.com", access: "user" },
    { id: 6, name: "Ever Melisandre", age: 150, email: "evermelisandre@gmail.com", access: "manager" },
    { id: 7, name: "Ferrara Clifford", age: 44, email: "ferraraclifford@gmail.com", access: "user" },
    { id: 8, name: "Rossini Frances", age: 36, email: "rossinifrances@gmail.com", access: "user" },
    { id: 9, name: "Harvey Roxie", age: 65, email: "harveyroxie@gmail.com", access: "admin" },
  ];

  const handleSelectAllClick = (event) => {
    if (event.target.checked) {
      const newSelecteds = teamMembers.map((n) => n.id);
      setSelected(newSelecteds);
      return;
    }
    setSelected([]);
  };

  const handleClick = (event, id) => {
    const selectedIndex = selected.indexOf(id);
    let newSelected = [];

    if (selectedIndex === -1) {
      newSelected = newSelected.concat(selected, id);
    } else if (selectedIndex === 0) {
      newSelected = newSelected.concat(selected.slice(1));
    } else if (selectedIndex === selected.length - 1) {
      newSelected = newSelected.concat(selected.slice(0, -1));
    } else if (selectedIndex > 0) {
      newSelected = newSelected.concat(
        selected.slice(0, selectedIndex),
        selected.slice(selectedIndex + 1),
      );
    }

    setSelected(newSelected);
  };

  const isSelected = (id) => selected.indexOf(id) !== -1;

  const styles = {
    container: {
      display: "flex",
      minHeight: "100vh",
      bgcolor: colors.grey[800],
      marginLeft: isCollapsed ? "80px" : "270px", // Use isCollapsed here
      transition: "margin 0.3s ease",
    },
    content: { flex: 1, p: 4 },
    tableContainer: {
      backgroundColor: colors.grey[900],
      borderRadius: 2,
      "&::-webkit-scrollbar": {
        width: "8px",
      },
      "&::-webkit-scrollbar-track": {
        background: colors.grey[700],
      },
      "&::-webkit-scrollbar-thumb": {
        backgroundColor: colors.grey[500],
        borderRadius: "10px",
        border: `2px solid ${colors.grey[700]}`,
        "&:hover": {
          backgroundColor: colors.primary[400],
        },
      },
    },
    table: {
      minWidth: 650,
    },
    tableHead: {
      backgroundColor: colors.primary[700],
    },
    headCell: {
      color: colors.grey[100],
      fontWeight: "bold",
    },
    bodyCell: {
      color: colors.grey[100],
    },
    checkbox: {
      color: `${colors.grey[100]} !important`,
    },
    accessCell: (access) => ({
      color:
        access === "admin"
          ? colors.greenAccent?.[400] ?? "#00ff00"
          : access === "manager"
          ? colors.primary[700] ?? "#0000ff"
          : colors.grey?.[100] ?? "#888888",
      fontWeight: "bold",
      textTransform: "capitalize",
    }),
    accessIcon: (access) => ({
      color:
        access === "admin"
          ? colors.greenAccent?.[400] ?? "#00ff00"
          : access === "manager"
          ? colors.primary[700] ?? "#0000ff"
          : colors.grey?.[100] ?? "#888888",
      paddingRight: "5px",
    }),
    footer: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      padding: "10px",
      color: colors.grey[100],
    },
    pagination: {
      color: colors.grey[100],
      "& .Mui-selected": {
        backgroundColor: `${colors.primary[400]} !important`,
        color: `${colors.grey[100]} !important`,
      },
    },
  };

  return (
    <Box sx={styles.container}>
      <Box sx={styles.content}>
        <Typography variant="h5" color={colors.grey[100]} fontWeight="bold" mb={2}>
        </Typography>
        <TableContainer component={Paper} sx={styles.tableContainer}>
          <Table sx={styles.table} aria-label="simple table">
            <TableHead sx={styles.tableHead}>
              <TableRow>
                <TableCell padding="checkbox">
                  <Checkbox
                    color="primary"
                    indeterminate={selected.length > 0 && selected.length < teamMembers.length}
                    checked={teamMembers.length > 0 && selected.length === teamMembers.length}
                    onChange={handleSelectAllClick}
                    slotProps={{ input: { 'aria-label': 'select all members' } }}
                    sx={styles.checkbox}
                  />
                </TableCell>
                <TableCell sx={styles.headCell}>ID</TableCell>
                <TableCell sx={styles.headCell}>Name</TableCell>
                <TableCell sx={styles.headCell}>Age</TableCell>
                <TableCell sx={styles.headCell}>Email</TableCell>
                <TableCell sx={styles.headCell}>Access Level</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {teamMembers.map((member) => {
                const isItemSelected = isSelected(member.id);
                return (
                  <TableRow
                    key={member.id}
                    hover
                    onClick={(event) => handleClick(event, member.id)}
                    role="checkbox"
                    aria-checked={isItemSelected}
                    tabIndex={-1}
                    selected={isItemSelected}
                  >
                    <TableCell padding="checkbox">
                      <Checkbox
                        checked={isItemSelected}
                        slotProps={{ input: { 'aria-labelledby': `enhanced-table-checkbox-${member.id}` } }}
                        sx={styles.checkbox}
                      />
                    </TableCell>
                    <TableCell sx={styles.bodyCell}>{member.id}</TableCell>
                    <TableCell sx={styles.bodyCell}>{member.name}</TableCell>
                    <TableCell sx={styles.bodyCell}>{member.age}</TableCell>
                    <TableCell sx={styles.bodyCell}>{member.email}</TableCell>
                    <TableCell sx={styles.accessCell(member.access)}>
                      <span
                        className="material-symbols-outlined"
                        style={styles.accessIcon(member.access)}
                      >
                        {member.access === "admin"
                          ? "verified_user"
                          : member.access === "manager"
                          ? "security"
                          : "lock"}
                      </span>
                      {member.access}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>

        {/* Footer */}
        <Box sx={styles.footer}>
          <Typography>{selected.length} rows selected</Typography>

          <Box>
            <Typography sx={{ display: "inline-block", marginRight: "5px" }}>
              Rows per page:{" "}
            </Typography>
            <Typography sx={{ display: "inline-block", marginRight: "25px" }}>100</Typography>

            <Typography sx={{ display: "inline-block", marginRight: "5px" }}>1-9 of 9</Typography>
            <span
              className="material-symbols-outlined"
              style={{
                cursor: "pointer",
                verticalAlign: "middle",
                marginRight: "5px",
                color: colors.grey[100],
              }}
            >
              chevron_left
            </span>
            <span
              className="material-symbols-outlined"
              style={{ cursor: "pointer", verticalAlign: "middle", color: colors.grey[100] }}
            >
              chevron_right
            </span>
          </Box>
        </Box>
      </Box>
    </Box>
  );
};

export default Team;