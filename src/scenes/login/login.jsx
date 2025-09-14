import React, { useState } from "react";
import { FaEnvelope, FaEye, FaShieldHalved } from "react-icons/fa6";
import {
  CircularProgress, Box, Typography, Alert, TextField, Button,
  IconButton, InputAdornment
} from "@mui/material";
import { authService } from "../../authService"; // Ensure this path is correct

const Login = ({ onLoginSuccess }) => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  
  const [mfaRequired, setMfaRequired] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // --- API Handlers ---
  const handleLogin = async (event) => {
    event.preventDefault();
    setIsLoading(true);
    setError("");
    setInfo("");
    try {
      const data = await authService.login(email, password);
      if (data.mfaRequired) {
        setMfaRequired(true);
        setInfo("A verification code has been sent to your email.");
      } else if (data.token) {
        onLoginSuccess(data.token, data.role, data.username);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const verifyMfa = async (event) => {
    event.preventDefault();
    setIsLoading(true);
    setError("");
    try {
      const data = await authService.verifyMfa(email, mfaCode);
      if (data.token) {
        onLoginSuccess(data.token, data.role, data.username);
      }
    } catch (err) {
      setError(err.message);
      setMfaCode("");
    } finally {
      setIsLoading(false);
    }
  };

  // --- STYLES OBJECT (CSS-in-JS using MUI sx prop) ---
  const styles = {
    background: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      bgcolor: '#eef2f6',
    },
    loginContainer: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      p: 2, // Padding for small screens
    },
    logo: {
      maxWidth: '150px',
      mb: 3,
    },
    loginBox: {
      bgcolor: 'white',
      p: { xs: 3, sm: 5 },
      borderRadius: '12px',
      boxShadow: '0px 10px 30px rgba(0, 0, 0, 0.07)',
      width: '100%',
      maxWidth: '450px',
      textAlign: 'center',
    },
    title: {
      color: '#1a202c',
      fontWeight: 700,
      mb: 1,
    },
    subtext: {
      color: '#718096',
      mb: 4,
    },
    form: {
      width: '100%',
      display: 'flex',
      flexDirection: 'column',
      gap: '20px'
    },
    loginButton: {
      py: '12px',
      borderRadius: '8px',
      fontWeight: 600,
      fontSize: '16px',
      textTransform: 'none',
      height: '52px',
      boxShadow: '0 4px 14px 0 rgba(0, 118, 255, 0.39)',
      '&:hover': {
        boxShadow: '0 6px 20px 0 rgba(0, 118, 255, 0.23)',
      },
    },
    alert: {
        width: '100%',
        mb: 2
    }
  };

  return (
    <Box sx={styles.background}>
      <Box sx={styles.loginContainer}>
        <Box component="img" src="/assets/logo.png" alt="UAS Logo" sx={styles.logo} />
        <Box
          component="form" // <-- FIX: The form is the container now
          onSubmit={mfaRequired ? verifyMfa : handleLogin}
          sx={styles.loginBox}
        >
          <Typography variant="h4" component="h1" sx={styles.title}>
            {mfaRequired ? "Two-Factor Authentication" : "Welcome Back"}
          </Typography>
          <Typography sx={styles.subtext}>
            {mfaRequired ? "Enter the code from your email to continue." : "Please enter your details to sign in."}
          </Typography>

          {error && <Alert severity="error" sx={styles.alert}>{error}</Alert>}
          {info && <Alert severity="success" sx={styles.alert}>{info}</Alert>}
          
          <Box sx={styles.form}>
            {!mfaRequired ? (
              <>
                <TextField
                  label="Email Address"
                  variant="outlined"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={isLoading}
                  required
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start"><FaEnvelope color="#718096" /></InputAdornment>
                    ),
                  }}
                />
                <TextField
                  label="Password"
                  variant="outlined"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isLoading}
                  required
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <IconButton
                          aria-label="toggle password visibility"
                          onClick={() => setShowPassword(!showPassword)}
                          edge="start"
                          tabIndex={-1}
                        >
                          <FaEye color={showPassword ? "#3182ce" : "#718096"} />
                        </IconButton>
                      </InputAdornment>
                    ),
                  }}
                />
              </>
            ) : (
              <TextField
                label="Verification Code"
                variant="outlined"
                type="text"
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value)}
                disabled={isLoading}
                required
                inputProps={{ maxLength: 6, inputMode: "numeric" }}
                autoFocus
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start"><FaShieldHalved color="#718096" /></InputAdornment>
                  ),
                }}
              />
            )}
            
            <Button
              type="submit"
              variant="contained"
              size="large"
              fullWidth
              sx={styles.loginButton}
              disabled={isLoading || (mfaRequired ? mfaCode.length !== 6 : !email || !password)}
            >
              {isLoading ? <CircularProgress color="inherit" size={24} /> : (mfaRequired ? "Verify & Sign In" : "Sign In")}
            </Button>
          </Box>
        </Box>
      </Box>
    </Box>
  );
};

export default Login;