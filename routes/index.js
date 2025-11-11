const express = require('express');
const router = express.Router();
const pool = require('../db'); // Adjust path to db.js
const {
    isAuthenticated
} = require('../middleware/auth'); // Adjust path to auth.js

// GET / (Public Homepage)
router.get('/', async (req, res) => {
    // Check if anyone is logged in
    if (req.session && req.session.user) {
        return res.redirect('/dashboard'); // Employee redirect
    }
    if (req.session && req.session.member) {
        return res.redirect('/member/dashboard'); // Member redirect
    }

    try {
        // Query 1: Get active promotions
        const [promotions] = await pool.query(
            "SELECT event_name, event_type, start_date, end_date, discount_percent, summary FROM event_promotions WHERE end_date >= CURDATE() ORDER BY start_date LIMIT 3"
        );

        // Query 2: Get all locations
        const [locations] = await pool.query("SELECT location_id, location_name, summary FROM location ORDER BY location_name");

        // Query 3: Get all OPEN rides
        const [rides] = await pool.query(
            "SELECT ride_id, ride_name, ride_type, location_id FROM rides WHERE ride_status = 'OPEN' ORDER BY ride_name"
        );

        // Query 4: Get ticket & membership types
        const [tickets] = await pool.query(
            "SELECT type_name, base_price FROM ticket_types WHERE is_active = TRUE AND is_member_type = FALSE ORDER BY base_price"
        );

        // --- MODIFIED: Select new base_members column ---
        const [memberships] = await pool.query(
            "SELECT type_id, type_name, base_price, description, base_members FROM membership_type WHERE is_active = TRUE ORDER BY base_price"
        );

        // Render the new homepage view with all this data
        res.render('index', {
            promotions: promotions,
            locations: locations,
            allRides: rides,
            tickets: tickets,
            memberships: memberships
        });

    } catch (error) {
        console.error("Error loading homepage:", error);
        res.status(500).send("Error loading park homepage.");
    }
});

// GET /dashboard
router.get('/dashboard', isAuthenticated, (req, res) => {
    res.render('dashboard');
});

module.exports = router;