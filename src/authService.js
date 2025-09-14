import axios from 'axios';

const API_BASE_URL = "http://localhost:5000/api/auth";

/**
 * Handles the initial login request.
 * @param {string} email - The user's email.
 * @param {string} password - The user's password.
 * @returns {Promise<object>} - The full data object from the backend.
 */
const login = async (email, password) => {
    try {
        const response = await axios.post(`${API_BASE_URL}/login`, { email, password });
        return response.data;
    } catch (error) {
        // Re-throw a clean, simple error message for the component to display.
        throw new Error(error.response?.data?.message || "An unknown error occurred during login.");
    }
};

/**
 * Handles the MFA verification request.
 * @param {string} email - The user's email to identify them.
 * @param {string} code - The MFA code entered by the user.
 * @returns {Promise<object>} - The full data object from the backend, including the final token.
 */
const verifyMfa = async (email, code) => {
    try {
        const response = await axios.post(`${API_BASE_URL}/verify-mfa`, { email, code });
        return response.data;
    } catch (error) {
        throw new Error(error.response?.data?.message || "An unknown error occurred during MFA verification.");
    }
};

// Export the functions as a single service object.
export const authService = {
    login,
    verifyMfa,
};