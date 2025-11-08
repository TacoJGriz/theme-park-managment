const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const pool = require('../db'); // Adjust path to db.js
const {
    isAuthenticated,
    isGuest
} = require('../middleware/auth'); // Adjust path to auth.js

const saltRounds = 10; // This was in app.js, we need it here for hashing

// --- LOGIN & LOGOUT ROUTES ---
// GET /login
router.get('/login', isGuest, (req, res) => {
    if (req.session.user) {
        return res.redirect('/dashboard');
    }
    res.render('global-login', { error: null });
});

// POST /login
router.post('/login', isGuest, async (req, res) => {
    try {
        const email = req.body.username;
        const password = req.body.password;

        // --- 1. Check for an EMPLOYEE match first ---
        const employeeQuery = `
            SELECT 
                demo.employee_id, demo.first_name, demo.last_name, demo.employee_type, 
                demo.location_id, loc.location_name, auth.password_hash
            FROM employee_demographics AS demo
            JOIN employee_auth AS auth ON demo.employee_id = auth.employee_id
            LEFT JOIN location AS loc ON demo.location_id = loc.location_id
            WHERE demo.email = ? AND demo.is_active = TRUE AND demo.is_pending_approval = FALSE
        `;
        const [employeeResults] = await pool.query(employeeQuery, [email]);

        if (employeeResults.length > 0) {
            // Employee email found, check password
            const user = employeeResults[0];
            const match = await bcrypt.compare(password, user.password_hash);

            if (match) {
                // Employee login successful
                return req.session.regenerate(function (err) {
                    if (err) {
                        console.error("Session regeneration error:", err);
                        return res.status(500).render('global-login', { error: 'Session error during login.' });
                    }
                    // Set EMPLOYEE session
                    req.session.user = {
                        id: user.employee_id,
                        firstName: user.first_name,
                        lastName: user.last_name,
                        role: user.employee_type,
                        locationId: user.location_id,
                        locationName: user.location_name
                    };
                    res.redirect('/dashboard');
                });
            }
        }

        // --- 2. No employee match, check for a MEMBER match ---
        const memberQuery = `
            SELECT 
                m.membership_id, m.first_name, m.last_name, m.email,
                auth.password_hash
            FROM membership AS m
            JOIN member_auth AS auth ON m.membership_id = auth.membership_id
            WHERE m.email = ?
        `;
        const [memberResults] = await pool.query(memberQuery, [email]);

        if (memberResults.length > 0) {
            // Member email found, check password
            const member = memberResults[0];
            const match = await bcrypt.compare(password, member.password_hash);

            if (match) {
                // Member login successful
                return req.session.regenerate(function (err) {
                    if (err) {
                        console.error("Session regeneration error:", err);
                        return res.status(500).render('global-login', { error: 'Session error during login.' });
                    }
                    // Set MEMBER session
                    req.session.member = {
                        id: member.membership_id,
                        firstName: member.first_name,
                        lastName: member.last_name,
                        email: member.email
                    };
                    res.redirect('/member/dashboard');
                });
            }
        }

        // --- 3. No match for either ---
        res.render('global-login', { error: 'Invalid email or password' });

    } catch (error) {
        console.error("Global login error:", error);
        return res.status(500).render('global-login', { error: 'An unexpected error occurred. Please try again later.' });
    }
});

// GET /employee/logout
router.get('/employee/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            console.error("Logout error:", err);
            return res.redirect('/dashboard');
        }
        res.clearCookie('connect.sid');
        res.redirect('/');
    });
});

// GET /change-password
router.get('/change-password', isAuthenticated, (req, res) => {
    res.render('change-password', { error: null, success: null });
});

// POST /change-password
router.post('/change-password', isAuthenticated, async (req, res) => {
    const { old_password, new_password, confirm_password } = req.body;
    const employeeId = req.session.user.id;

    if (new_password !== confirm_password) {
        return res.render('change-password', {
            error: "New passwords do not match.",
            success: null
        });
    }

    let connection;
    try {
        connection = await pool.getConnection();

        const [authResult] = await connection.query('SELECT password_hash FROM employee_auth WHERE employee_id = ?', [employeeId]);
        if (authResult.length === 0) {
            return res.render('change-password', {
                error: "Could not find user authentication record.",
                success: null
            });
        }
        const currentHash = authResult[0].password_hash;

        const match = await bcrypt.compare(old_password, currentHash);
        if (!match) {
            return res.render('change-password', {
                error: "Incorrect old password.",
                success: null
            });
        }

        const newHash = await bcrypt.hash(new_password, saltRounds);
        await connection.query('UPDATE employee_auth SET password_hash = ? WHERE employee_id = ?', [newHash, employeeId]);

        res.render('change-password', {
            error: null,
            success: "Password updated successfully!"
        });

    } catch (error) {
        console.error("Error changing password:", error);
        res.render('change-password', {
            error: "A database error occurred. Please try again.",
            success: null
        });
    } finally {
        if (connection) connection.release();
    }
});

module.exports = router;