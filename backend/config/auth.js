const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') }); // Adjust path

module.exports = {
    jwtSecret: process.env.JWT_SECRET,
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '1h'
};