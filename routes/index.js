const express = require('express');
const router = express.Router();
const pool = require('../db'); // Adjust path to db.js
const {
    isAuthenticated,
    isGuest,
    formatPhoneNumber
} = require('../middleware/auth'); // Adjust path to auth.js
const crypto = require('crypto');

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
        // --- FIX: Added ticket_type_id and description ---
        const [tickets] = await pool.query(
            "SELECT ticket_type_id, type_name, base_price, description FROM ticket_types WHERE is_active = TRUE AND is_member_type = FALSE ORDER BY base_price"
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


// GET /purchase-tickets
// Renders the new ticket purchase form
router.get('/purchase-tickets', isGuest, async (req, res) => {
    try {
        // Fetch active, non-member ticket types
        const [ticketTypes] = await pool.query(
            "SELECT * FROM ticket_types WHERE is_active = TRUE AND is_member_type = FALSE ORDER BY base_price",
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

        // 2. Fetch ticket prices from DB and create a Map for safe lookup
        const [ticketTypes] = await connection.query(
            "SELECT ticket_type_id, type_name, base_price FROM ticket_types WHERE is_active = TRUE AND is_member_type = FALSE"
        );
        const ticketTypeMap = new Map(ticketTypes.map(t => [t.ticket_type_id.toString(), t]));


        let totalCost = 0;
        const purchaseDate = new Date();
        const ticketsPurchased = []; // For the receipt

        const ticketSql = `
            INSERT INTO prepaid_tickets 
                (purchase_id, ticket_code, ticket_type_id, purchase_date, email, phone_number, base_price, discount_amount, is_redeemed)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, FALSE)
        `;

        // Generate one ID for this entire transaction
        const purchaseId = crypto.randomUUID();
        const formattedPhoneNumber = formatPhoneNumber(phone_number);

        // --- START: CRITICAL BUG FIX ---
        // 3. Loop through the 'quantities' object keys sent from the form
        for (const ticketIdKey in quantities) { //
            const quantity = parseInt(quantities[ticketIdKey], 10) || 0; //

            // 4. Check if quantity is > 0 AND if the key is a valid ticket type
            if (quantity > 0 && ticketTypeMap.has(ticketIdKey)) { //

                // 5. GET THE TYPE *INSIDE* THE LOOP
                // This ensures we get "Child" for the Child ticket, "Senior" for the Senior, etc.
                const type = ticketTypeMap.get(ticketIdKey); //

                const basePrice = parseFloat(type.base_price); //
                const discountAmount = basePrice * (currentDiscountPercent / 100);
                const finalPrice = basePrice - discountAmount;

                totalCost += finalPrice * quantity;

                // 6. Insert one e-ticket record *per ticket*
                for (let i = 0; i < quantity; i++) {
                    const ticketCode = crypto.randomUUID();

                    await connection.query(ticketSql, [
                        purchaseId,
                        ticketCode,
                        type.ticket_type_id, // This correctly uses the type's ID
                        purchaseDate,
                        email || null,
                        formattedPhoneNumber || null,
                        basePrice,
                        discountAmount
                    ]);

                    // 7. Add the full ticket info to our receipt list
                    ticketsPurchased.push({
                        name: type.type_name, // This correctly uses the type's name
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
                tickets: ticketsPurchased, // This is now an array of ticket objects
                total: totalCost
            }
        });

    } catch (error) {
        if (connection) await connection.rollback();
        console.error("Error processing ticket purchase:", error);

        // On error, re-render the purchase page
        const [ticketTypes] = await pool.query(
            "SELECT * FROM ticket_types WHERE is_active = TRUE AND is_member_type = FALSE ORDER BY base_price",
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
router.get('/dashboard', isAuthenticated, (req, res) => {
    res.render('dashboard');
});

module.exports = router;