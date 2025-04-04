import React, { useState, useEffect } from "react";
import "./login.css";
import { FaEnvelope, FaEye } from "react-icons/fa";
import { useNavigate } from "react-router-dom";

const Login = ({ setIsAuthenticated }) => {
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaCode, setMfaCode] = useState("");

  const navigate = useNavigate();

  useEffect(() => {
    localStorage.removeItem("authenticated");
    localStorage.removeItem("userRole");
    localStorage.removeItem("username");
    setIsAuthenticated(false);
  }, [setIsAuthenticated]);
  
  const handleLogin = async () => {
    const response = await fetch("http://localhost:5000/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    const data = await response.json();
    if (response.ok && data.success && data.mfaRequired) {
      setMfaRequired(true);
      setMessage("MFA code sent to your email.");
    } else if (response.ok && data.success) {
      localStorage.setItem("authenticated", "true"); // Store authentication
      setIsAuthenticated(true);
      navigate("/");
    } else {
      setMessage(data.message || "Invalid email or password.");
    }
  };

  const verifyMfa = async () => {
    const response = await fetch("http://localhost:5000/api/verify-mfa", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, code: mfaCode }),
    });

    const data = await response.json();
    if (response.ok && data.success) {
      localStorage.setItem("authenticated", "true"); // Store authentication
      if (data.role) {
        localStorage.setItem("userRole", data.role); // Store the role received from backend
      }
      if (data.username) { // Check if username exists in response
        localStorage.setItem("username", data.username); // Store the username
      }
      setIsAuthenticated(true);
      navigate("/");
    } else {
      setMessage(data.message);
      setMfaCode("");
    }
  };

  return (
    <div className="background">
      <div className="login-container">
        <img src="/assets/logo.png" alt="UAS Logo" className="logo" />
        <div className="login-box">
          <h2>{mfaRequired ? "Enter MFA Code" : "Login"}</h2>
          {!mfaRequired && <p className="login-subtext">Please enter your details to sign in your account</p>}

          {!mfaRequired ? (
            <>
              <div className="input-group">
                <input
                  type="text"
                  placeholder="Enter your email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
                <FaEnvelope className="icon" />
              </div>

              <div className="input-group">
                <input
                  type={showPassword ? "text" : "password"}
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <span
                  className="icon"
                  onMouseDown={() => setShowPassword(true)}
                  onMouseUp={() => setShowPassword(false)}
                  onMouseLeave={() => setShowPassword(false)}
                >
                  <FaEye />
                </span>
              </div>
            </>
          ) : (
            <div className="input-group">
              <input
                type="text"
                placeholder="MFA Code"
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value)}
              />
            </div>
          )}

          {message && <p className="login-message">{message}</p>}

          {mfaRequired ? (
            <button className="login-button" onClick={verifyMfa}>Verify MFA</button>
          ) : (
            <button className="login-button" onClick={handleLogin}>Login</button>
          )}
        </div>
      </div>
    </div>
  );
};

export default Login;
