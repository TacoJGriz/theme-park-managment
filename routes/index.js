const express = require('express');
const router = express.Router();
const pool = require('../db');
const {
    isAuthenticated,
    isGuest,
    formatPhoneNumber
} = require('../middleware/auth');
const crypto = require('crypto');

// design system reference
router.get('/style-guide', (req, res) => {
    res.render('style-guide', {
        user: req.session.user || null,
        member: req.session.member || null
    });
});

// public homepage
router.get('/', async (req, res) => {
    if (req.session && req.session.user) {
        return res.redirect('/dashboard');
    }
    if (req.session && req.session.member) {
        return res.redirect('/member/dashboard');
    }

    try {
        const [promotions] = await pool.query(
            "SELECT event_name, event_type, start_date, end_date, discount_percent, summary FROM event_promotions WHERE end_date >= CURDATE() ORDER BY start_date LIMIT 3"
        );

        const [locations] = await pool.query("SELECT location_id, location_name, summary FROM location ORDER BY location_name");

        const [rides] = await pool.query(
            "SELECT ride_id, ride_name, ride_type, location_id, ride_status FROM rides ORDER BY ride_name"
        );

        const [tickets] = await pool.query(
            "SELECT ticket_type_id, public_ticket_type_id, type_name, base_price, description FROM ticket_types WHERE is_active = TRUE AND is_member_type = FALSE ORDER BY base_price"
        );

        const [memberships] = await pool.query(
            "SELECT type_id, public_type_id, type_name, base_price, description, base_members FROM membership_type WHERE is_active = TRUE ORDER BY base_price"
        );

        const [vendors] = await pool.query(
            "SELECT vendor_name, location_id, vendor_status FROM vendors ORDER BY vendor_name"
        );

        const [weatherAlerts] = await pool.query(
            `SELECT weather_type, park_closure, event_date, end_time 
             FROM weather_events 
             WHERE event_date <= NOW() AND (end_time IS NULL OR end_time >= NOW())
             ORDER BY event_date DESC`
        );

        res.render('index', {
            promotions,
            locations,
            allRides: rides,
            allVendors: vendors,
            weatherAlerts,
            tickets,
            memberships
        });

    } catch (error) {
        console.error("Error loading homepage:", error);
        res.status(500).send("Error loading park homepage.");
    }
});

// ticket purchase form
router.get('/purchase-tickets', isGuest, async (req, res) => {
    try {
        const [ticketTypes] = await pool.query(
            "SELECT *, public_ticket_type_id FROM ticket_types WHERE is_active = TRUE AND is_member_type = FALSE ORDER BY base_price",
        );

        res.render('purchase-tickets', {
            ticketTypes,
            error: null
        });
    } catch (error) {
        console.error("Error loading ticket purchase page:", error);
        res.redirect('/');
    }
});

// process ticket purchase
router.post('/purchase-tickets', isGuest, async (req, res) => {
    const {
        quantities,
        email,
        phone_number
    } = req.body;
    let connection;

    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        // fetch active promo
        const [promos] = await connection.query(
            "SELECT event_name, discount_percent FROM event_promotions WHERE CURDATE() BETWEEN start_date AND end_date ORDER BY discount_percent DESC LIMIT 1"
        );
        const currentDiscountPercent = (promos.length > 0) ? promos[0].discount_percent : 0;
        const promoName = (promos.length > 0) ? promos[0].event_name : 'N/A';

        // fetch types ordered to match form array
        const [ticketTypes] = await connection.query(
            "SELECT ticket_type_id, type_name, base_price FROM ticket_types WHERE is_active = TRUE AND is_member_type = FALSE ORDER BY base_price"
        );

        let totalCost = 0;
        const purchaseDate = new Date();
        const ticketsPurchased = [];

        const ticketSql = `
            INSERT INTO prepaid_tickets 
                (purchase_id, ticket_code, ticket_type_id, purchase_date, email, phone_number, base_price, discount_amount, is_redeemed)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, FALSE)
        `;

        const purchaseId = crypto.randomUUID();
        const formattedPhoneNumber = formatPhoneNumber(phone_number);

        for (let i = 0; i < quantities.length; i++) {
            const quantity = parseInt(quantities[i], 10) || 0;

            if (quantity > 0 && ticketTypes[i]) {
                const type = ticketTypes[i];
                const basePrice = parseFloat(type.base_price);
                const discountAmount = basePrice * (currentDiscountPercent / 100);
                const finalPrice = basePrice - discountAmount;

                totalCost += finalPrice * quantity;

                for (let j = 0; j < quantity; j++) {
                    const ticketCode = crypto.randomUUID();

                    await connection.query(ticketSql, [
                        purchaseId,
                        ticketCode,
                        type.ticket_type_id,
                        purchaseDate,
                        email || null,
                        formattedPhoneNumber || null,
                        basePrice,
                        discountAmount
                    ]);

                    ticketsPurchased.push({
                        name: type.type_name,
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

        await connection.commit();

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

        const [ticketTypes] = await pool.query(
            "SELECT *, public_ticket_type_id FROM ticket_types WHERE is_active = TRUE AND is_member_type = FALSE ORDER BY base_price",
        );
        res.render('purchase-tickets', {
            ticketTypes,
            error: error.message || "An error occurred."
        });
    } finally {
        if (connection) connection.release();
    }
});

// employee dashboard
router.get('/dashboard', isAuthenticated, async (req, res) => {
    const user = req.session.user;
    let assignedRides = [];
    let assignedVendors = [];

    try {
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

        res.render('dashboard', {
            assignedRides,
            assignedVendors
        });

    } catch (error) {
        console.error("Error loading dashboard data:", error);
        res.render('dashboard', {
            assignedRides: [],
            assignedVendors: []
        });
    }
});

// public park map
router.get('/map', async (req, res) => {
    try {
        const [locations] = await pool.query("SELECT location_id, location_name, summary, pin_x, pin_y FROM location ORDER BY location_name");

        const [rides] = await pool.query(
            "SELECT ride_name, ride_type, ride_status, location_id, min_height, max_weight FROM rides ORDER BY ride_name"
        );

        const [vendors] = await pool.query(
            "SELECT vendor_name, vendor_status, location_id FROM vendors ORDER BY vendor_name"
        );

        res.render('public-map', {
            locations,
            rides,
            vendors
        });

    } catch (error) {
        console.error("Error loading map:", error);
        res.status(500).send("Error loading map.");
    }
});

module.exports = router;