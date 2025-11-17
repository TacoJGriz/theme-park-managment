const express = require('express');
const router = express.Router();
const pool = require('../db'); // Adjust path to db.js
const crypto = require('crypto'); // ADDED
const {
    isAuthenticated,
    isAdminOrParkManager,
    canManageRetail
} = require('../middleware/auth'); // Adjust path to auth.js

// --- LOCATION & VENDOR MANAGEMENT --- 
// ... (routes /locations, /vendors, /assign-manager are all unchanged) ...
// Path is '/locations'
router.get('/locations', isAuthenticated, isAdminOrParkManager, async (req, res) => {
    try {
        const query = `
            SELECT l.*, CONCAT(e.first_name, ' ', e.last_name) AS manager_name
            FROM location l
            LEFT JOIN employee_demographics e ON l.manager_id = e.employee_id
            ORDER BY l.location_name
        `;
        // Query now includes public_location_id from l.*
        const [locations] = await pool.query(query);
        res.render('locations', { locations: locations });
    } catch (error) {
        console.error(error);
        res.status(500).send('Error fetching locations');
    }
});

// Path is '/locations/new'
router.get('/locations/new', isAuthenticated, isAdminOrParkManager, (req, res) => {
    res.render('add-location', { error: null });
});

// Path is '/locations'
router.post('/locations', isAuthenticated, isAdminOrParkManager, async (req, res) => {
    const { location_name, summary } = req.body;
    let connection;
    try {
        connection = await pool.getConnection();
        const publicLocationId = crypto.randomUUID(); // ADDED
        // ADDED public_location_id
        const sql = "INSERT INTO location (public_location_id, location_name, summary) VALUES (?, ?, ?)";
        await connection.query(sql, [publicLocationId, location_name, summary || null]); // ADDED
        res.redirect('/locations');
    } catch (error) {
        console.error(error);
        res.render('add-location', { error: "Database error adding location. Name might be duplicate." });
    } finally {
        if (connection) connection.release();
    }
});

// Path is '/vendors'
router.get('/vendors', isAuthenticated, canManageRetail, async (req, res) => {
    try {
        const { role, locationId } = req.session.user;

        let query = `
            SELECT v.*, l.location_name
            FROM vendors v
            LEFT JOIN location l ON v.location_id = l.location_id
        `;
        // Query now includes public_vendor_id from v.*
        let params = [];

        if (role === 'Location Manager') {
            query += ' WHERE v.location_id = ?';
            params.push(locationId);
        }

        query += ' ORDER BY v.vendor_name';
        const [vendors] = await pool.query(query, params);
        res.render('vendors', { vendors: vendors });
    } catch (error) {
        console.error(error);
        res.status(500).send('Error fetching vendors');
    }
});

// Path is '/vendors/new'
router.get('/vendors/new', isAuthenticated, isAdminOrParkManager, async (req, res) => {
    try {
        const [locations] = await pool.query('SELECT location_id, location_name FROM location');
        res.render('add-vendor', { locations: locations, managers: [], error: null });
    } catch (error) {
        console.error(error);
        res.status(500).send('Error loading add vendor page');
    }
});

// Path is '/vendors'
router.post('/vendors', isAuthenticated, isAdminOrParkManager, async (req, res) => {
    const { vendor_name, location_id } = req.body;
    let connection;
    try {
        connection = await pool.getConnection();
        const publicVendorId = crypto.randomUUID(); // ADDED
        // ADDED public_vendor_id
        const sql = "INSERT INTO vendors (public_vendor_id, vendor_name, location_id) VALUES (?, ?, ?)";
        await connection.query(sql, [publicVendorId, vendor_name, location_id]); // ADDED
        res.redirect('/vendors');
    } catch (error) {
        console.error(error);
        const [locations] = await pool.query('SELECT location_id, location_name FROM location');
        res.render('add-vendor', {
            locations: locations,
            managers: [],
            error: "Database error adding vendor. Name might be duplicate."
        });
    } finally {
        if (connection) connection.release();
    }
});

// Path is '/assign-manager/:type/:public_id'
router.get('/assign-manager/:type/:public_id', isAuthenticated, isAdminOrParkManager, async (req, res) => {
    const { type, public_id } = req.params; // CHANGED
    try {
        let entity = null;
        if (type === 'location') {
            // Query by public_location_id, select internal location_id
            const [loc] = await pool.query('SELECT location_id as id, location_name as name, public_location_id FROM location WHERE public_location_id = ?', [public_id]); // CHANGED
            if (loc.length > 0) entity = loc[0];
        } else if (type === 'vendor') {
            return res.status(404).send('Assigning managers to vendors is no longer supported.');
        }

        if (!entity) {
            return res.status(404).send('Location or Vendor not found');
        }

        let managerRolesToQuery = [];
        let redirectUrl = '/dashboard';

        if (type === 'location') {
            managerRolesToQuery = ['Location Manager', 'Park Manager', 'Admin'];
            redirectUrl = '/locations';
        } else {
            return res.status(400).send('Invalid entity type');
        }

        const [managers] = await pool.query("SELECT employee_id, first_name, last_name, employee_type FROM employee_demographics WHERE employee_type IN (?) AND is_active = TRUE", [managerRolesToQuery]);

        res.render('assign-manager', {
            entity: entity, // entity object now contains public_location_id as 'public_location_id' and internal id as 'id'
            managers: managers,
            type: type,
            error: null
        });
    } catch (error) {
        console.error(error);
        res.status(500).send('Error loading assign manager page');
    }
});

// Path is '/assign-manager/:type/:public_id'
router.post('/assign-manager/:type/:public_id', isAuthenticated, isAdminOrParkManager, async (req, res) => {
    const { type, public_id } = req.params; // CHANGED
    const { manager_id } = req.body;
    const manager_start = (type === 'location' && req.body.manager_start) ? req.body.manager_start : null;

    let connection;
    try {
        connection = await pool.getConnection();
        let sql = '';
        let params = [];
        let redirectUrl = '/dashboard';

        if (type === 'location') {
            if (!manager_start) {
                throw new Error("Manager Start Date is required for locations.");
            }
            // Update using public_location_id
            sql = "UPDATE location SET manager_id = ?, manager_start = ? WHERE public_location_id = ?"; // CHANGED
            params = [manager_id, manager_start, public_id]; // CHANGED
            redirectUrl = '/locations';
        } else if (type === 'vendor') {
            return res.status(404).send('Assigning managers to vendors is no longer supported.');
        } else {
            return res.status(400).send('Invalid entity type');
        }

        await connection.query(sql, params);
        res.redirect(redirectUrl);

    } catch (error) {
        console.error("Error assigning manager:", error);
        try {
            let entity = null;
            if (type === 'location') {
                const [loc] = await pool.query('SELECT location_id as id, location_name as name, public_location_id FROM location WHERE public_location_id = ?', [public_id]); // CHANGED
                if (loc.length > 0) entity = loc[0];
            } else {
                entity = { name: 'Unknown' };
            }

            let managerRolesToQuery = [];
            if (type === 'location') {
                managerRolesToQuery = ['Location Manager', 'Park Manager', 'Admin'];
            }

            const [managers] = await pool.query("SELECT employee_id, first_name, last_name, employee_type FROM employee_demographics WHERE employee_type IN (?) AND is_active = TRUE", [managerRolesToQuery]);

            res.render('assign-manager', {
                entity: entity || { name: 'Unknown' },
                managers: managers,
                type: type,
                error: `Database error assigning manager: ${error.message}`
            });
        } catch (fetchError) {
            console.error("Error fetching data for assign manager error page:", fetchError);
            res.status(500).send("An error occurred while assigning the manager and reloading the page.");
        }
    } finally {
        if (connection) connection.release();
    }
});

// --- MEMBERSHIP TYPE MANAGEMENT ---
// Path is '/memberships/types'
router.get('/memberships/types', isAuthenticated, isAdminOrParkManager, async (req, res) => {
    try {
        // --- MODIFIED: SELECT * to get new columns (including public_type_id) ---
        const [types] = await pool.query('SELECT * FROM membership_type ORDER BY is_active DESC, type_name');
        res.render('membership-types', {
            types: types,
            error: req.session.error,
            success: req.session.success
        });
        req.session.success = null;
        req.session.error = null;
    } catch (error) {
        console.error(error);
        res.status(500).send('Error fetching membership types');
    }
});

// Path is '/memberships/types/new'
router.get('/memberships/types/new', isAuthenticated, isAdminOrParkManager, (req, res) => {
    res.render('add-membership-type', { error: null });
});

// Path is '/memberships/types'
router.post('/memberships/types', isAuthenticated, isAdminOrParkManager, async (req, res) => {
    // --- MODIFIED: Get new fields from req.body ---
    const { type_name, base_price, description, base_members, additional_member_price } = req.body;

    // --- MODIFIED: Handle NULL values ---
    const baseMembersNum = parseInt(base_members, 10) || 1;
    const additionalPriceNum = (baseMembersNum > 1 && additional_member_price) ? parseFloat(additional_member_price) : null;
    const publicTypeId = crypto.randomUUID(); // ADDED

    let connection;
    try {
        connection = await pool.getConnection();
        // --- MODIFIED: Updated SQL query ---
        const sql = `
            INSERT INTO membership_type 
            (public_type_id, type_name, base_price, base_members, additional_member_price, description, is_active) 
            VALUES (?, ?, ?, ?, ?, ?, TRUE)
        `;
        await connection.query(sql, [publicTypeId, type_name, base_price, baseMembersNum, additionalPriceNum, description || null]); // ADDED
        req.session.success = "Membership type added successfully!";
        res.redirect('/memberships/types');
    } catch (error) {
        console.error(error);
        res.render('add-membership-type', { error: "Database error adding type. Name might be duplicate." });
    } finally {
        if (connection) connection.release();
    }
});

// Path is '/memberships/types/edit/:public_type_id'
router.get('/memberships/types/edit/:public_type_id', isAuthenticated, isAdminOrParkManager, async (req, res) => {
    const { public_type_id } = req.params; // CHANGED
    try {
        // --- MODIFIED: SELECT * to get all data for form, query by public_type_id ---
        const [typeResult] = await pool.query('SELECT * FROM membership_type WHERE public_type_id = ?', [public_type_id]); // CHANGED
        if (typeResult.length === 0) {
            return res.status(404).send('Membership type not found');
        }
        res.render('edit-membership-type', { type: typeResult[0], error: null });
    } catch (error) {
        console.error(error);
        res.status(500).send('Error loading edit page');
    }
});

// Path is '/memberships/types/edit/:public_type_id'
router.post('/memberships/types/edit/:public_type_id', isAuthenticated, isAdminOrParkManager, async (req, res) => {
    const { public_type_id } = req.params; // CHANGED
    // --- MODIFIED: Get new fields from req.body ---
    const { type_name, base_price, description, base_members, additional_member_price } = req.body;

    // --- MODIFIED: Handle NULL values ---
    const baseMembersNum = parseInt(base_members, 10) || 1;
    const additionalPriceNum = (baseMembersNum > 1 && additional_member_price) ? parseFloat(additional_member_price) : null;

    let connection;
    try {
        connection = await pool.getConnection();
        // --- MODIFIED: Updated SQL query to use public_type_id ---
        const sql = `
            UPDATE membership_type 
            SET type_name = ?, base_price = ?, base_members = ?, additional_member_price = ?, description = ?
            WHERE public_type_id = ? -- CHANGED
        `;
        await connection.query(sql, [type_name, base_price, baseMembersNum, additionalPriceNum, description || null, public_type_id]); // CHANGED
        req.session.success = "Membership type updated successfully!";
        res.redirect('/memberships/types');
    } catch (error) {
        console.error(error);
        const [typeResult] = await pool.query('SELECT * FROM membership_type WHERE public_type_id = ?', [public_type_id]); // CHANGED
        res.render('edit-membership-type', {
            type: typeResult.length > 0 ? typeResult[0] : {},
            error: "Database error updating type. Name might be duplicate."
        });
    } finally {
        if (connection) connection.release();
    }
});

// Path is '/memberships/types/toggle/:public_type_id'
router.post('/memberships/types/toggle/:public_type_id', isAuthenticated, isAdminOrParkManager, async (req, res) => {
    const { public_type_id } = req.params; // CHANGED
    let connection;
    try {
        connection = await pool.getConnection();

        const [current] = await pool.query('SELECT is_active FROM membership_type WHERE public_type_id = ?', [public_type_id]); // CHANGED
        if (current.length === 0) {
            return res.status(404).send('Membership type not found');
        }

        const newStatus = !current[0].is_active;

        await connection.query('UPDATE membership_type SET is_active = ? WHERE public_type_id = ?', [newStatus, public_type_id]); // CHANGED
        req.session.success = `Membership type ${newStatus ? 'activated' : 'deactivated'} successfully.`;
        res.redirect('/memberships/types');

    } catch (error) {
        console.error("Error toggling membership status:", error);
        req.session.error = "Database error toggling status.";
        res.redirect('/memberships/types');
    } finally {
        if (connection) connection.release();
    }
});


// --- TICKET TYPE MANAGEMENT ---
// Path is '/ticket-types'
router.get('/ticket-types', isAuthenticated, isAdminOrParkManager, async (req, res) => {
    try {
        // ADDED public_ticket_type_id
        const [types] = await pool.query('SELECT *, public_ticket_type_id FROM ticket_types ORDER BY is_member_type DESC, is_active DESC, type_name');

        res.render('manage-ticket-types', {
            types: types,
            error: req.session.error,
            success: req.session.success
        });
        req.session.success = null;
        req.session.error = null;
    } catch (error) {
        console.error("Error fetching ticket types:", error);
        res.status(500).send('Error fetching ticket types');
    }
});

// Path is '/ticket-types/new'
router.get('/ticket-types/new', isAuthenticated, isAdminOrParkManager, (req, res) => {
    res.render('add-ticket-type', { error: null });
});

// Path is '/ticket-types'
router.post('/ticket-types', isAuthenticated, isAdminOrParkManager, async (req, res) => {
    const { type_name, base_price, description } = req.body;
    const publicTicketTypeId = crypto.randomUUID(); // ADDED
    let connection;
    try {
        connection = await pool.getConnection();
        // ADDED public_ticket_type_id
        const sql = "INSERT INTO ticket_types (public_ticket_type_id, type_name, base_price, description, is_active, is_member_type) VALUES (?, ?, ?, ?, TRUE, FALSE)";
        await connection.query(sql, [publicTicketTypeId, type_name, base_price, description || null]); // ADDED
        req.session.success = "Ticket type added successfully!";
        res.redirect('/ticket-types');
    } catch (error) {
        console.error("Error adding ticket type:", error);
        res.render('add-ticket-type', { error: "Database error adding type. Name might be duplicate." });
    } finally {
        if (connection) connection.release();
    }
});

// Path is '/ticket-types/edit/:public_ticket_type_id'
router.get('/ticket-types/edit/:public_ticket_type_id', isAuthenticated, isAdminOrParkManager, async (req, res) => {
    const { public_ticket_type_id } = req.params; // CHANGED
    try {
        const [typeResult] = await pool.query('SELECT * FROM ticket_types WHERE public_ticket_type_id = ?', [public_ticket_type_id]); // CHANGED
        if (typeResult.length === 0) {
            return res.status(404).send('Ticket type not found');
        }
        res.render('edit-ticket-type', { type: typeResult[0], error: null });
    } catch (error) {
        console.error("Error loading ticket edit page:", error);
        res.status(500).send('Error loading edit page');
    }
});

// Path is '/ticket-types/edit/:public_ticket_type_id'
router.post('/ticket-types/edit/:public_ticket_type_id', isAuthenticated, isAdminOrParkManager, async (req, res) => {
    const { public_ticket_type_id } = req.params; // CHANGED
    const { type_name, base_price, description } = req.body;
    let connection;
    let typeResult = [];

    try {
        connection = await pool.getConnection();

        const [typeResult] = await pool.query('SELECT * FROM ticket_types WHERE public_ticket_type_id = ?', [public_ticket_type_id]); // CHANGED
        if (typeResult.length === 0) {
            return res.status(404).send('Ticket type not found');
        }
        const ticketType = typeResult[0];

        if (ticketType.is_member_type) {
            req.session.error = "The 'Member' type is a system record and cannot be edited.";
            return res.redirect('/ticket-types');
        }

        const sql = `
            UPDATE ticket_types 
            SET type_name = ?, base_price = ?, description = ?
            WHERE public_ticket_type_id = ? AND is_member_type = FALSE -- CHANGED
        `;
        await connection.query(sql, [type_name, base_price, description || null, public_ticket_type_id]); // CHANGED

        req.session.success = "Ticket type updated successfully!";
        res.redirect('/ticket-types');

    } catch (error) {
        console.error("Error updating ticket type:", error);
        res.render('edit-ticket-type', {
            type: typeResult.length > 0 ? typeResult[0] : { public_ticket_type_id: public_ticket_type_id }, // CHANGED
            error: "Database error updating type. Name might be duplicate."
        });
    } finally {
        if (connection) connection.release();
    }
});

// Path is '/ticket-types/toggle/:public_ticket_type_id'
router.post('/ticket-types/toggle/:public_ticket_type_id', isAuthenticated, isAdminOrParkManager, async (req, res) => {
    const { public_ticket_type_id } = req.params; // CHANGED
    let connection;
    try {
        connection = await pool.getConnection();

        const [current] = await pool.query('SELECT is_active, is_member_type FROM ticket_types WHERE public_ticket_type_id = ?', [public_ticket_type_id]); // CHANGED
        if (current.length === 0) {
            return res.status(404).send('Ticket type not found');
        }

        if (current[0].is_member_type) {
            req.session.error = "The 'Member' type is a system record and cannot be deactivated.";
            return res.redirect('/ticket-types');
        }

        const newStatus = !current[0].is_active;

        await connection.query('UPDATE ticket_types SET is_active = ? WHERE public_ticket_type_id = ?', [newStatus, public_ticket_type_id]); // CHANGED
        req.session.success = `Ticket type ${newStatus ? 'activated' : 'deactivated'} successfully.`;
        res.redirect('/ticket-types');

    } catch (error) {
        console.error("Error toggling ticket status:", error);
        req.session.error = "Database error toggling status.";
        res.redirect('/ticket-types');
    } finally {
        if (connection) connection.release();
    }
});

// --- PARK OPERATIONS (Weather, Promos) ---
// ... (All /weather and /promotions routes are unchanged, no IDs exposed) ...
// Path is '/weather'
router.get('/weather', isAuthenticated, isAdminOrParkManager, async (req, res) => {
    try {
        const [events] = await pool.query('SELECT * FROM weather_events ORDER BY event_date DESC');
        res.render('weather-events', { events: events });
    } catch (error) {
        console.error(error);
        res.status(500).send('Error fetching weather events');
    }
});

// Path is '/weather/new'
router.get('/weather/new', isAuthenticated, isAdminOrParkManager, async (req, res) => {
    res.render('add-weather-event', { error: null });
});

// Path is '/weather'
router.post('/weather', isAuthenticated, isAdminOrParkManager, async (req, res) => {
    const { event_date, weather_type } = req.body;
    const end_time = req.body.end_time ? req.body.end_time : null;
    const park_closure = req.body.park_closure === '1';

    let connection;
    try {
        connection = await pool.getConnection();
        const sql = `
            INSERT INTO weather_events (event_date, end_time, weather_type, park_closure)
            VALUES (?, ?, ?, ?)
        `;
        await connection.query(sql, [event_date, end_time, weather_type, park_closure]);
        res.redirect('/weather');
    } catch (error) {
        console.error(error);
        res.render('add-weather-event', { error: "Database error logging weather event." });
    } finally {
        if (connection) connection.release();
    }
});

// Path is '/promotions'
router.get('/promotions', isAuthenticated, isAdminOrParkManager, async (req, res) => {
    try {
        const [promotions] = await pool.query('SELECT * FROM event_promotions ORDER BY start_date DESC');
        res.render('promotions', { promotions: promotions });
    } catch (error) {
        console.error(error);
        res.status(500).send('Error fetching promotions');
    }
});

// Path is '/promotions/new'
router.get('/promotions/new', isAuthenticated, isAdminOrParkManager, async (req, res) => {
    res.render('add-promotion', { error: null });
});

// Path is '/promotions'
router.post('/promotions', isAuthenticated, isAdminOrParkManager, async (req, res) => {
    const { event_name, event_type, start_date, end_date, discount_percent, summary } = req.body;
    let connection;
    try {
        connection = await pool.getConnection();
        const sql = `
            INSERT INTO event_promotions (event_name, event_type, start_date, end_date, discount_percent, summary)
            VALUES (?, ?, ?, ?, ?, ?)
        `;
        await connection.query(sql, [event_name, event_type, start_date, end_date, discount_percent, summary || null]);
        res.redirect('/promotions');
    } catch (error) {
        console.error(error);
        res.render('add-promotion', { error: "Database error adding promotion. Name might be duplicate." });
    } finally {
        if (connection) connection.release();
    }
});

module.exports = router;