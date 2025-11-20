const express = require('express');
const router = express.Router();
const pool = require('../db'); // Adjust path to db.js
const {
    isAuthenticated,
    isGuest,
    formatPhoneNumber
} = require('../middleware/auth'); // Adjust path to auth.js
const crypto = require('crypto');

// GET /style-guide (Design System Reference)
router.get('/style-guide', (req, res) => {
    // Pass user/member objects so the header renders correctly for whoever is logged in
    res.render('style-guide', {
        user: req.session.user || null,
        member: req.session.member || null
    });
});

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

        // Query 3: Get ALL rides (Removed 'OPEN' filter to show total park capacity)
        const [rides] = await pool.query(
            "SELECT ride_id, ride_name, ride_type, location_id, ride_status FROM rides ORDER BY ride_name"
        );

        // Query 4: Get ticket & membership types
        const [tickets] = await pool.query(
            "SELECT ticket_type_id, public_ticket_type_id, type_name, base_price, description FROM ticket_types WHERE is_active = TRUE AND is_member_type = FALSE ORDER BY base_price"
        );

        const [memberships] = await pool.query(
            "SELECT type_id, public_type_id, type_name, base_price, description, base_members FROM membership_type WHERE is_active = TRUE ORDER BY base_price"
        );

        // Query 5: Get ALL Vendors (Removed 'OPEN' filter)
        const [vendors] = await pool.query(
            "SELECT vendor_name, location_id, vendor_status FROM vendors ORDER BY vendor_name"
        );

        // Query 6: Get Active/Ongoing Weather Alerts
        const [weatherAlerts] = await pool.query(
            `SELECT weather_type, park_closure, event_date, end_time 
             FROM weather_events 
             WHERE (event_date <= NOW() AND (end_time IS NULL OR end_time >= NOW())) 
                OR (DATE(event_date) = CURDATE() AND park_closure = TRUE)
             ORDER BY event_date DESC`
        );

        // Render the homepage view with all data
        res.render('index', {
            promotions: promotions,
            locations: locations,
            allRides: rides,
            allVendors: vendors,
            weatherAlerts: weatherAlerts,
            tickets: tickets,
            memberships: memberships
        });

    } catch (error) {
        console.error("Error loading homepage:", error);
        res.status(500).send("Error loading park homepage.");
    }
});


// GET /purchase-tickets
// Renders the new ticket purchase form
router.get('/purchase-tickets', isGuest, async (req, res) => {
    try {
        // Fetch active, non-member ticket types
        // ADDED public_ticket_type_id
        const [ticketTypes] = await pool.query(
            "SELECT *, public_ticket_type_id FROM ticket_types WHERE is_active = TRUE AND is_member_type = FALSE ORDER BY base_price",
        );

        res.render('purchase-tickets', {
            ticketTypes: ticketTypes,
            error: null
        });
    } catch (error) {
        console.error("Error loading ticket purchase page:", error);
        res.redirect('/');
    }
});

// POST /purchase-tickets
// Processes the ticket purchase
router.post('/purchase-tickets', isGuest, async (req, res) => {
    // req.body.quantities is an ARRAY: [ '2', '0', '0' ]
    const { quantities, email, phone_number } = req.body;
    let connection;

    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        // 1. Get current promotion
        const [promos] = await connection.query(
            "SELECT event_name, discount_percent FROM event_promotions WHERE CURDATE() BETWEEN start_date AND end_date ORDER BY discount_percent DESC LIMIT 1"
        );
        const currentDiscountPercent = (promos.length > 0) ? promos[0].discount_percent : 0;
        const promoName = (promos.length > 0) ? promos[0].event_name : 'N/A';

        // 2. Fetch the ticket types IN THE SAME ORDER as the form
        const [ticketTypes] = await connection.query(
            "SELECT ticket_type_id, type_name, base_price FROM ticket_types WHERE is_active = TRUE AND is_member_type = FALSE ORDER BY base_price"
        );

        let totalCost = 0;
        const purchaseDate = new Date();
        const ticketsPurchased = []; // For the receipt

        const ticketSql = `
            INSERT INTO prepaid_tickets 
                (purchase_id, ticket_code, ticket_type_id, purchase_date, email, phone_number, base_price, discount_amount, is_redeemed)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, FALSE)
        `;

        const purchaseId = crypto.randomUUID();
        const formattedPhoneNumber = formatPhoneNumber(phone_number);

        // 3. Loop over the 'quantities' array using a numeric index
        for (let i = 0; i < quantities.length; i++) {
            const quantity = parseInt(quantities[i], 10) || 0;

            // Check if quantity is > 0 and a ticket type exists at this index
            if (quantity > 0 && ticketTypes[i]) {

                // Get the 'type' using the *index* from our ordered array
                const type = ticketTypes[i];

                const basePrice = parseFloat(type.base_price);
                const discountAmount = basePrice * (currentDiscountPercent / 100);
                const finalPrice = basePrice - discountAmount;

                totalCost += finalPrice * quantity;

                // 6. Insert one e-ticket record *per ticket*
                for (let j = 0; j < quantity; j++) {
                    const ticketCode = crypto.randomUUID();

                    await connection.query(ticketSql, [
                        purchaseId,
                        ticketCode,
                        type.ticket_type_id, // This will now be correct (4, 3, or 2)
                        purchaseDate,
                        email || null,
                        formattedPhoneNumber || null,
                        basePrice,
                        discountAmount
                    ]);

                    // 7. Add the full ticket info to our receipt list
                    ticketsPurchased.push({
                        name: type.type_name, // This will now be correct
                        code: ticketCode,
                        price: finalPrice,
                        promo: promoName,
                        basePrice: basePrice,
                        discount: discountAmount
                    });
                }
            }
        }

        if (ticketsPurchased.length === 0) {
            throw new Error("No tickets were selected.");
        }

        // 8. Commit
        await connection.commit();

        // 9. Render the new receipt page
        res.render('ticket-purchase-success', {
            receipt: {
                email: email,
                phone: formattedPhoneNumber,
                purchaseDate: purchaseDate.toLocaleString(),
                tickets: ticketsPurchased,
                total: totalCost
            }
        });

    } catch (error) {
        if (connection) await connection.rollback();
        console.error("Error processing ticket purchase:", error);

        // On error, re-render the purchase page
        const [ticketTypes] = await pool.query(
            "SELECT *, public_ticket_type_id FROM ticket_types WHERE is_active = TRUE AND is_member_type = FALSE ORDER BY base_price", // ADDED
        );
        res.render('purchase-tickets', {
            ticketTypes: ticketTypes,
            error: error.message || "An error occurred."
        });
    } finally {
        if (connection) connection.release();
    }
});

// GET /dashboard
router.get('/dashboard', isAuthenticated, async (req, res) => {
    const user = req.session.user;
    let assignedRides = [];
    let assignedVendors = [];

    try {
        // Only fetch details if the user has a location assignment (Staff or Location Manager)
        if ((user.role === 'Staff' || user.role === 'Location Manager') && user.locationId) {
            const [rides] = await pool.query(
                'SELECT ride_name FROM rides WHERE location_id = ? ORDER BY ride_name',
                [user.locationId]
            );
            const [vendors] = await pool.query(
                'SELECT vendor_name FROM vendors WHERE location_id = ? ORDER BY vendor_name',
                [user.locationId]
            );

            assignedRides = rides;
            assignedVendors = vendors;
        }

        // Pass these new arrays to the view
        res.render('dashboard', {
            assignedRides,
            assignedVendors
        });

    } catch (error) {
        console.error("Error loading dashboard data:", error);
        // If error, just render dashboard without the extra info rather than crashing
        res.render('dashboard', {
            assignedRides: [],
            assignedVendors: []
        });
    }
});

// GET /map (Interactive Park Map)
router.get('/map', async (req, res) => {
    try {
        // 1. Fetch Locations
        const [locations] = await pool.query("SELECT location_id, location_name, summary, pin_x, pin_y FROM location ORDER BY location_name");

        // 2. Fetch All Rides
        const [rides] = await pool.query(
            "SELECT ride_name, ride_type, ride_status, location_id, min_height, max_weight FROM rides ORDER BY ride_name"
        );

        // 3. Fetch Vendors (SIMPLE SELECT - No Group By!)
        const [vendors] = await pool.query(
            "SELECT vendor_name, vendor_status, location_id FROM vendors ORDER BY vendor_name"
        );

        res.render('public-map', {
            locations: locations,
            rides: rides,
            vendors: vendors
        });

    } catch (error) {
        console.error("Error loading map:", error);
        res.status(500).send("Error loading map.");
    }
});

module.exports = router;