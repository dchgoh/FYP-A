import React, { useState } from "react";
import "./login.css"; // Assuming you have this CSS file
import { FaEnvelope, FaEye, FaSpinner } from "react-icons/fa";
// Removed useNavigate here, navigation is handled by App.js after successful login

// Renamed prop: receive onLoginSuccess from App.js
const Login = ({ onLoginSuccess }) => {
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false); // Differentiate error messages
  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaCode, setMfaCode] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isMfaLoading, setIsMfaLoading] = useState(false);

  const handleLogin = async () => {
    setIsLoading(true);
    setMessage("");
    setIsError(false);
    setMfaRequired(false); // Reset MFA state on new login attempt

    try {
      const response = await fetch("http://localhost:5000/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        // Handle HTTP errors (4xx, 5xx)
        throw new Error(data.message || `HTTP error! Status: ${response.status}`);
      }

      // --- Check backend response ---
      if (data.success) {
        if (data.mfaRequired) {
          // MFA is needed. Show MFA form. DO NOT call onLoginSuccess yet.
          setMfaRequired(true);
          setMessage("MFA code sent to your email."); // Success message
          setIsError(false);
        } else if (data.token) {
          // Login successful WITHOUT MFA. Call onLoginSuccess with the FINAL token.
          // App.js will handle localStorage, setIsAuthenticated, and navigation.
          onLoginSuccess(data.token, data.role, data.username);
          // No need to setMessage or navigate here
        } else {
           // Should not happen if backend logic is correct, but handle defensively
           throw new Error("Login successful but missing token and MFA requirement.");
        }
      } else {
        // Backend indicated failure (e.g., wrong password)
        setMessage(data.message || "Invalid email or password.");
        setIsError(true);
        setMfaRequired(false); // Ensure MFA form is hidden
      }
      // --- End backend response check ---

    } catch (error) {
        console.error("Login error:", error);
        setMessage(error.message || "An error occurred during login.");
        setIsError(true);
        setMfaRequired(false);
    } finally {
      setIsLoading(false);
    }
  };

  const verifyMfa = async () => {
    setIsMfaLoading(true);
    setMessage("");
    setIsError(false);

    try {
        const response = await fetch("http://localhost:5000/api/verify-mfa", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            // Send email to identify user, and the code they entered
            body: JSON.stringify({ email, code: mfaCode }),
          });

          const data = await response.json();

          if (!response.ok) {
             // Handle HTTP errors (4xx, 5xx)
            throw new Error(data.message || `HTTP error! Status: ${response.status}`);
          }

          // --- Check backend response ---
          if (data.success && data.token) {
            // MFA verification successful. Call onLoginSuccess with the FINAL token.
            // App.js handles localStorage, state, and navigation.
            onLoginSuccess(data.token, data.role, data.username);
             // No need to setMessage or navigate here
          }
          else {
            // Backend indicated MFA failure (wrong code, expired, etc.)
            setMessage(data.message || "Invalid MFA code.");
            setIsError(true);
            setMfaCode(""); // Clear the code input on failure
          }
           // --- End backend response check ---

    } catch (error) {
        console.error("MFA verification error:", error);
        setMessage(error.message || "An error occurred during MFA verification.");
        setIsError(true);
    } finally {
        setIsMfaLoading(false);
    }
  };

  return (
    <div className="background">
      <div className="login-container">
        <img src="/assets/logo.png" alt="UAS Logo" className="logo" />
        <div className="login-box">
          <h2>{mfaRequired ? "Enter MFA Code" : "Login"}</h2>
          {!mfaRequired && (
            <p className="login-subtext">
              Please enter your details to sign in your account
            </p>
          )}

          {!mfaRequired ? (
            <>
              {/* Email Input */}
              <div className="input-group">
                <input
                  type="text" // Changed from email to text for flexibility if needed
                  placeholder="Enter your email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={isLoading}
                />
                <FaEnvelope className="icon" />
              </div>

              {/* Password Input */}
              <div className="input-group">
                <input
                  type={showPassword ? "text" : "password"}
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isLoading}
                />
                <span
                  className={`icon ${isLoading ? 'disabled-icon' : ''}`}
                  // Prevent toggling visibility when loading
                  onMouseDown={() => !isLoading && setShowPassword(true)}
                  onMouseUp={() => !isLoading && setShowPassword(false)}
                  onMouseLeave={() => !isLoading && setShowPassword(false)}
                  // Make it behave more like a button for accessibility if needed
                  role="button"
                  tabIndex={isLoading ? -1 : 0}
                  aria-pressed={showPassword}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  <FaEye />
                </span>
              </div>
            </>
          ) : (
             // MFA Input
            <div className="input-group">
              <input
                type="text" // Use text, maybe add pattern="[0-9]*" for numbers
                placeholder="MFA Code"
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value)}
                disabled={isMfaLoading}
                maxLength={6} // Typical TOTP length
                inputMode="numeric" // Hint for mobile keyboards
                autoComplete="one-time-code" // Help password managers/OS fill code
              />
              {/* Optional: Add an icon here too */}
            </div>
          )}

          {/* Display message */}
          {message && (
            <p className={`login-message ${isError ? 'error' : 'success'}`}>
              {message}
            </p>
          )}

          {/* Conditional Buttons */}
          {mfaRequired ? (
            <button
                className="login-button"
                onClick={verifyMfa}
                disabled={isMfaLoading || !mfaCode || mfaCode.length !== 6} // Basic validation
            >
              {/* Show spinner *inside* button text area */}
              {isMfaLoading ? <FaSpinner className="spinner"/> : "Verify MFA"}
            </button>
          ) : (
            <button
                className="login-button"
                onClick={handleLogin}
                disabled={isLoading || !email || !password}
            >
               {/* Show spinner *inside* button text area */}
              {isLoading ? <FaSpinner className="spinner"/> : "Login"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default Login;