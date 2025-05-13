const jwt = require('jsonwebtoken');
const { pool } = require('../config/db'); // Import the pool
const { jwtSecret } = require('../config/auth'); // Import the secret

const protect = async (req, res, next) => {
    let token;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        try {
            token = req.headers.authorization.split(' ')[1];
            const decoded = jwt.verify(token, jwtSecret);

            // Fetch fresh user data
            const userResult = await pool.query("SELECT id, username, role, is_locked FROM users WHERE id = $1", [decoded.userId]);
            if (!userResult.rows[0]) {
                throw new Error('User associated with token not found.');
            }
            const currentUser = userResult.rows[0];

            if (currentUser.is_locked) {
                return res.status(403).json({ success: false, message: 'Your account is locked. Please contact support.' });
            }

            // Attach user to the request object
            req.user = {
                userId: currentUser.id,
                username: currentUser.username,
                role: currentUser.role
            };
            next();
        } catch (error) {
             console.error('Token verification failed:', error.message);
             let status = 401;
             let message = 'Not authorized, token failed';
             if (error.name === 'TokenExpiredError') message = 'Not authorized, token expired';
             if (error.message === 'User associated with token not found.') message = 'Not authorized, user not found';
             return res.status(status).json({ success: false, message });
        }
    } else {
        res.status(401).json({ success: false, message: 'Not authorized, no token' });
    }
};

module.exports = { protect };