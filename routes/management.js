const express = require('express');
const router = express.Router();
const pool = require('../db'); // Adjust path to db.js
const crypto = require('crypto'); // ADDED
const {
    isAuthenticated,
    isAdminOrParkManager,
    canManageRetail,
    canViewInventory
} = require('../middleware/auth'); // Adjust path to auth.js

// --- LOCATION & VENDOR MANAGEMENT --- 
// ... (routes /locations, /vendors, /assign-manager are all unchanged) ...
// Path is '/locations'
// GET /locations
router.get('/locations', isAuthenticated, isAdminOrParkManager, async (req, res) => {
    try {
        // 1. Capture Query Params
        const { search, sort, dir, filter_assigned } = req.query;

        // 2. Build Filtering Logic
        let whereClauses = [];
        let params = [];

        if (search) {
            const likeTerm = `%${search}%`;
            // Search against ID, Name, Summary, or Manager Name
            whereClauses.push(`(
                l.public_location_id LIKE ? OR
                l.location_name LIKE ? OR
                l.summary LIKE ? OR
                e.first_name LIKE ? OR
                e.last_name LIKE ?
            )`);
            params.push(likeTerm, likeTerm, likeTerm, likeTerm, likeTerm);
        }

        if (filter_assigned) {
            if (filter_assigned === 'assigned') {
                whereClauses.push('l.manager_id IS NOT NULL');
            } else if (filter_assigned === 'unassigned') {
                whereClauses.push('l.manager_id IS NULL');
            }
        }

        let whereQuery = "";
        if (whereClauses.length > 0) {
            whereQuery = ` WHERE ${whereClauses.join(' AND ')}`;
        }

        // 3. Get Counts for Stats Bar
        const countQuery = `
            SELECT
                COUNT(*) as total,
                SUM(CASE WHEN l.manager_id IS NOT NULL THEN 1 ELSE 0 END) as assigned,
                SUM(CASE WHEN l.manager_id IS NULL THEN 1 ELSE 0 END) as unassigned
            FROM location l
            LEFT JOIN employee_demographics e ON l.manager_id = e.employee_id
            ${whereQuery}
        `;
        const [countResult] = await pool.query(countQuery, params);
        const counts = countResult[0];

        // 4. Sorting Logic
        let orderBy = ' ORDER BY l.location_name ASC'; // Default sort
        if (sort && dir) {
            const direction = (dir === 'desc') ? 'DESC' : 'ASC';
            switch (sort) {
                // Sort by internal ID is implicitly chronological
                case 'id': orderBy = ` ORDER BY l.location_id ${direction}`; break;
                case 'name': orderBy = ` ORDER BY l.location_name ${direction}`; break;
                case 'manager': orderBy = ` ORDER BY e.last_name ${direction}, e.first_name ${direction}`; break;
            }
        }

        // 5. Main Data Query
        const query = `
            SELECT l.*, CONCAT(e.first_name, ' ', e.last_name) AS manager_name
            FROM location l
            LEFT JOIN employee_demographics e ON l.manager_id = e.employee_id
            ${whereQuery}
            ${orderBy}
        `;

        const [locations] = await pool.query(query, params);

        // 6. Render View
        res.render('locations', {
            locations: locations,
            counts: counts,
            // Pass back state to maintain UI
            search: search || "",
            currentSort: sort || "",
            currentDir: dir || "",
            filters: { assigned: filter_assigned || "" }
        });

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
router.get('/vendors', isAuthenticated, canViewInventory, async (req, res) => {
    try {
        const { role, locationId } = req.session.user;
        const { search, sort, dir, filter_location, filter_status } = req.query; // Added filter_status

        const queryParams = new URLSearchParams(req.query);
        const currentQueryString = queryParams.toString();

        const [allLocations] = await pool.query('SELECT location_id, location_name FROM location ORDER BY location_name');

        let whereClauses = [];
        let params = [];

        if (role === 'Location Manager' || role === 'Staff') {
            whereClauses.push('v.location_id = ?');
            params.push(locationId);
        }

        if (search) {
            const likeTerm = `%${search}%`;
            whereClauses.push(`(
                v.public_vendor_id LIKE ? OR
                v.vendor_name LIKE ? OR
                l.location_name LIKE ?
            )`);
            params.push(likeTerm, likeTerm, likeTerm);
        }

        if (filter_location) {
            whereClauses.push('v.location_id = ?');
            params.push(filter_location);
        }

        // NEW: Filter by Status
        if (filter_status) {
            whereClauses.push('v.vendor_status = ?');
            params.push(filter_status);
        }

        let whereQuery = "";
        if (whereClauses.length > 0) {
            whereQuery = ` WHERE ${whereClauses.join(' AND ')}`;
        }

        // UPDATED: Count Query for Statuses
        const countQuery = `
            SELECT
                COUNT(*) as total,
                SUM(CASE WHEN v.vendor_status = 'OPEN' THEN 1 ELSE 0 END) as open_count,
                SUM(CASE WHEN v.vendor_status = 'CLOSED' THEN 1 ELSE 0 END) as closed_count
            FROM vendors v
            LEFT JOIN location l ON v.location_id = l.location_id
            ${whereQuery}
        `;
        const [countResult] = await pool.query(countQuery, params);
        const counts = countResult[0];

        let orderBy = ' ORDER BY v.vendor_name ASC';
        if (sort && dir) {
            const direction = (dir === 'desc') ? 'DESC' : 'ASC';
            switch (sort) {
                case 'id': orderBy = ` ORDER BY v.vendor_id ${direction}`; break;
                case 'name': orderBy = ` ORDER BY v.vendor_name ${direction}`; break;
                case 'location': orderBy = ` ORDER BY l.location_name ${direction}`; break;
                case 'status': orderBy = ` ORDER BY v.vendor_status ${direction}`; break; // New Sort
            }
        }

        // UPDATED: Main Query includes status
        const query = `
            SELECT v.*, l.location_name
            FROM vendors v
            LEFT JOIN location l ON v.location_id = l.location_id
            ${whereQuery}
            ${orderBy}
        `;

        const [vendors] = await pool.query(query, params);

        res.render('vendors', {
            vendors: vendors,
            counts: counts,
            locations: allLocations,
            search: search || "",
            currentSort: sort || "",
            currentDir: dir || "",
            filters: {
                location: filter_location || "",
                status: filter_status || "" // New Filter
            },
            currentQueryString: currentQueryString,
            success: req.session.success,
            error: req.session.error
        });
        req.session.success = null;
        req.session.error = null;

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
    const { vendor_name, location_id, vendor_status } = req.body;
    let connection;
    try {
        connection = await pool.getConnection();
        const publicVendorId = crypto.randomUUID();
        const sql = "INSERT INTO vendors (public_vendor_id, vendor_name, location_id, vendor_status) VALUES (?, ?, ?, ?)";
        await connection.query(sql, [publicVendorId, vendor_name, location_id, vendor_status || 'OPEN']);
        res.redirect('/vendors');
    } catch (error) {
        console.error(error);
        const [locations] = await pool.query('SELECT location_id, location_name FROM location');
        res.render('add-vendor', {
            locations: locations,
            error: "Database error adding vendor. Name might be duplicate."
        });
    } finally {
        if (connection) connection.release();
    }
});

router.get('/vendors/edit/:public_vendor_id', isAuthenticated, canManageRetail, async (req, res) => {
    const { public_vendor_id } = req.params;
    const { role, locationId } = req.session.user;

    try {
        const [vendorRes] = await pool.query('SELECT * FROM vendors WHERE public_vendor_id = ?', [public_vendor_id]);
        if (vendorRes.length === 0) {
            return res.status(404).send('Vendor not found');
        }
        const vendor = vendorRes[0];

        // Check Location Manager permissions
        if (role === 'Location Manager' && vendor.location_id !== locationId) {
            return res.status(403).send('Forbidden: You can only edit vendors in your location.');
        }

        const [locations] = await pool.query('SELECT location_id, location_name FROM location ORDER BY location_name');

        res.render('edit-vendor', {
            vendor: vendor,
            locations: locations,
            error: null
        });

    } catch (error) {
        console.error("Error loading edit vendor page:", error);
        res.status(500).send('Error loading page');
    }
});

// POST /vendors/edit/:public_vendor_id (NEW)
router.post('/vendors/edit/:public_vendor_id', isAuthenticated, canManageRetail, async (req, res) => {
    const { public_vendor_id } = req.params;
    const { vendor_name, location_id, vendor_status } = req.body;
    const { role, locationId } = req.session.user;

    try {
        // Permission check logic...
        if (role === 'Location Manager') {
            // Ensure they aren't moving it to a location they don't own, 
            // and ensure the vendor they are editing is currently in their location.
            const [current] = await pool.query('SELECT location_id FROM vendors WHERE public_vendor_id = ?', [public_vendor_id]);
            if (current.length > 0 && current[0].location_id !== locationId) {
                return res.status(403).send('Forbidden');
            }
            if (parseInt(location_id) !== locationId) {
                return res.status(403).send('Forbidden: You cannot move a vendor to a location you do not manage.');
            }
        }

        const sql = "UPDATE vendors SET vendor_name = ?, location_id = ?, vendor_status = ? WHERE public_vendor_id = ?";
        await pool.query(sql, [vendor_name, location_id, vendor_status, public_vendor_id]);

        req.session.success = "Vendor updated successfully.";
        res.redirect('/vendors');

    } catch (error) {
        console.error("Error updating vendor:", error);
        // Fetch data to re-render form
        const [vendorRes] = await pool.query('SELECT * FROM vendors WHERE public_vendor_id = ?', [public_vendor_id]);
        const [locations] = await pool.query('SELECT location_id, location_name FROM location ORDER BY location_name');

        res.render('edit-vendor', {
            vendor: vendorRes[0] || req.body,
            locations: locations,
            error: "Database error updating vendor."
        });
    }
});

// POST /vendors/delete/:public_vendor_id (NEW)
router.post('/vendors/delete/:public_vendor_id', isAuthenticated, canManageRetail, async (req, res) => {
    const { public_vendor_id } = req.params;
    const { role, locationId } = req.session.user;

    try {
        // Check existence and permission
        const [vendorRes] = await pool.query('SELECT location_id, vendor_name FROM vendors WHERE public_vendor_id = ?', [public_vendor_id]);
        if (vendorRes.length === 0) return res.redirect('/vendors');

        if (role === 'Location Manager' && vendorRes[0].location_id !== locationId) {
            return res.status(403).send('Forbidden');
        }

        await pool.query('DELETE FROM vendors WHERE public_vendor_id = ?', [public_vendor_id]);
        req.session.success = `Vendor "${vendorRes[0].vendor_name}" deleted successfully.`;
        res.redirect('/vendors');

    } catch (error) {
        console.error("Error deleting vendor:", error);
        if (error.code === 'ER_ROW_IS_REFERENCED_2') {
            req.session.error = "Cannot delete this vendor because it has inventory items or history associated with it.";
        } else {
            req.session.error = "Database error deleting vendor.";
        }
        res.redirect('/vendors');
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
        const { search, sort, dir, filter_type, filter_closure } = req.query;
        const queryParams = new URLSearchParams(req.query);
        const currentQueryString = queryParams.toString();

        let whereClauses = [];
        let params = [];

        // 1. Search (Matches Type or Date in MM/DD/YYYY format)
        if (search) {
            // UPDATED: Search against the formatted date string to match UI display
            whereClauses.push("(weather_type LIKE ? OR DATE_FORMAT(event_date, '%m/%d/%Y') LIKE ?)");
            params.push(`%${search}%`, `%${search}%`);
        }

        // 2. Filters
        if (filter_type) {
            whereClauses.push('weather_type = ?');
            params.push(filter_type);
        }
        if (filter_closure) {
            if (filter_closure === 'yes') whereClauses.push('park_closure = TRUE');
            if (filter_closure === 'no') whereClauses.push('park_closure = FALSE');
        }

        let whereQuery = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

        // 3. Stats
        const countQuery = `
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN park_closure = TRUE THEN 1 ELSE 0 END) as closure_count
            FROM weather_events ${whereQuery}
        `;
        const [stats] = await pool.query(countQuery, params);
        const counts = stats[0];

        // 4. Sorting (Supports 3-state: if sort/dir missing, use default)
        let orderBy = 'ORDER BY event_date DESC'; // Default sort (Undo state)

        if (sort && dir) {
            const d = dir === 'asc' ? 'ASC' : 'DESC';
            if (sort === 'date') orderBy = `ORDER BY event_date ${d}`;
            if (sort === 'end_time') orderBy = `ORDER BY end_time ${d}`; // ADDED
            if (sort === 'type') orderBy = `ORDER BY weather_type ${d}`;
            if (sort === 'closure') orderBy = `ORDER BY park_closure ${d}`;
        }

        // 5. Fetch Data
        const [events] = await pool.query(`SELECT * FROM weather_events ${whereQuery} ${orderBy}`, params);
        const [types] = await pool.query('SELECT DISTINCT weather_type FROM weather_events ORDER BY weather_type');

        res.render('weather-events', {
            events, counts, types,
            search: search || '',
            filters: { type: filter_type || '', closure: filter_closure || '' },
            currentSort: sort || '',
            currentDir: dir || '',
            currentQueryString,
            success: req.session.success, error: req.session.error
        });
        req.session.success = null; req.session.error = null;

    } catch (error) {
        console.error(error);
        res.status(500).send('Error fetching weather events');
    }
});

// Path is '/weather/edit/:id'
router.get('/weather/edit/:id', isAuthenticated, isAdminOrParkManager, async (req, res) => {
    try {
        const [event] = await pool.query('SELECT * FROM weather_events WHERE weather_id = ?', [req.params.id]);
        if (event.length === 0) return res.status(404).send('Event not found');

        // Pass the query string back to the view for "Smart Cancel"
        res.render('edit-weather-event', {
            event: event[0],
            returnQuery: req.query.returnQuery || '',
            error: null
        });
    } catch (error) {
        res.status(500).send('Error loading edit page');
    }
});

// Path is '/weather/edit/:id'
router.post('/weather/edit/:id', isAuthenticated, isAdminOrParkManager, async (req, res) => {
    const { event_date, end_time, weather_type, park_closure, returnQuery } = req.body;
    const weatherId = req.params.id;

    // --- SERVER-SIDE VALIDATION: Check for future end_time ---
    if (end_time) {
        const endTimeDate = new Date(end_time);
        const now = new Date();
        // Allow a small buffer (5 seconds) to account for transmission time
        if (endTimeDate.getTime() > now.getTime() + 5000) {
            req.session.error = "Error: End time cannot be set in the future.";
            return res.redirect(`/weather/edit/${weatherId}` + (returnQuery ? `?returnQuery=${returnQuery}` : ''));
        }
    }
    // --- END VALIDATION ---

    try {
        const isClosed = park_closure === '1';
        const sql = "UPDATE weather_events SET event_date = ?, end_time = ?, weather_type = ?, park_closure = ? WHERE weather_id = ?";
        await pool.query(sql, [event_date, end_time || null, weather_type, isClosed, weatherId]);

        req.session.success = "Weather event updated.";
        res.redirect('/weather' + (returnQuery ? `?${returnQuery}` : ''));
    } catch (error) {
        console.error(error);
        req.session.error = "Database error updating event.";
        res.redirect('/weather');
    }
});

// Path is '/weather/delete/:id'
router.post('/weather/delete/:id', isAuthenticated, isAdminOrParkManager, async (req, res) => {
    try {
        await pool.query('DELETE FROM weather_events WHERE weather_id = ?', [req.params.id]);
        req.session.success = "Weather event deleted.";
        res.redirect('/weather');
    } catch (error) {
        console.error(error);
        req.session.error = "Error deleting event.";
        res.redirect('/weather');
    }
});

// Path is '/weather/new'
router.get('/weather/new', isAuthenticated, isAdminOrParkManager, async (req, res) => {
    res.render('add-weather-event', { error: null });
});

// Path is '/weather'
router.post('/weather', isAuthenticated, isAdminOrParkManager, async (req, res) => {
    const { event_date, weather_type, park_closure } = req.body;
    const end_time = req.body.end_time ? req.body.end_time : null;
    const isClosed = park_closure === '1';

    // --- SERVER-SIDE VALIDATION: Check for future end_time ---
    if (end_time) {
        const endTimeDate = new Date(end_time);
        const now = new Date();
        // Allow a small buffer (5 seconds)
        if (endTimeDate.getTime() > now.getTime() + 5000) {
            return res.render('add-weather-event', {
                error: "Error: End time cannot be set in the future."
            });
        }
    }
    // --- END VALIDATION ---

    let connection;
    try {
        connection = await pool.getConnection();
        const sql = `
            INSERT INTO weather_events (event_date, end_time, weather_type, park_closure)
            VALUES (?, ?, ?, ?)
        `;
        await connection.query(sql, [event_date, end_time, weather_type, isClosed]);
        req.session.success = "Weather event logged successfully.";
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
        const { search, sort, dir, filter_type, filter_status } = req.query;
        const queryParams = new URLSearchParams(req.query);
        const currentQueryString = queryParams.toString();
        const currentYear = new Date().getFullYear(); // Get current year for the view

        let whereClauses = [];
        let params = [];

        // 1. Search (Name or Summary)
        if (search) {
            whereClauses.push('(event_name LIKE ? OR summary LIKE ?)');
            params.push(`%${search}%`, `%${search}%`);
        }

        // 2. Filters
        if (filter_type) {
            whereClauses.push('event_type = ?');
            params.push(filter_type);
        }

        if (filter_status === 'active') {
            whereClauses.push('CURDATE() BETWEEN start_date AND end_date');
        } else if (filter_status === 'upcoming') {
            whereClauses.push('start_date > CURDATE()');
        } else if (filter_status === 'past') {
            whereClauses.push('end_date < CURDATE()');
        }

        let whereQuery = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

        // 3. Stats (Updated to count Remaining in Current Year)
        // "Remaining" means the promotion has not ended yet (end_date >= today)
        const countQuery = `
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN end_date >= CURDATE() AND YEAR(end_date) = YEAR(CURDATE()) THEN 1 ELSE 0 END) as remaining_count
            FROM event_promotions ${whereQuery}
        `;
        const [stats] = await pool.query(countQuery, params);
        const counts = stats[0];

        // 4. Sorting (Added Type and End Date)
        let orderBy = 'ORDER BY start_date DESC'; // Default sort
        if (sort && dir) {
            const d = dir === 'asc' ? 'ASC' : 'DESC';
            if (sort === 'name') orderBy = `ORDER BY event_name ${d}`;
            if (sort === 'type') orderBy = `ORDER BY event_type ${d}`;      // ADDED
            if (sort === 'start_date') orderBy = `ORDER BY start_date ${d}`;
            if (sort === 'end_date') orderBy = `ORDER BY end_date ${d}`;    // ADDED
            if (sort === 'discount') orderBy = `ORDER BY discount_percent ${d}`;
        }

        // 5. Fetch Data
        const [promotions] = await pool.query(`SELECT * FROM event_promotions ${whereQuery} ${orderBy}`, params);
        const [types] = await pool.query('SELECT DISTINCT event_type FROM event_promotions ORDER BY event_type');

        res.render('promotions', {
            promotions, counts, types,
            search: search || '',
            filters: { type: filter_type || '', status: filter_status || '' },
            currentSort: sort || '',
            currentDir: dir || '',
            currentQueryString,
            currentYear,
            success: req.session.success, error: req.session.error
        });
        req.session.success = null; req.session.error = null;

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
    const { event_name, event_type, start_date, end_date, discount_percent, summary, is_recurring } = req.body;
    try {
        // Checkbox returns '1' if checked, undefined if not
        const isRecurring = is_recurring === '1';

        const sql = `
            INSERT INTO event_promotions (event_name, event_type, start_date, end_date, discount_percent, summary, is_recurring)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `;
        await pool.query(sql, [event_name, event_type, start_date, end_date, discount_percent, summary || null, isRecurring]);
        req.session.success = "Promotion created successfully.";
        res.redirect('/promotions');
    } catch (error) {
        console.error(error);
        res.render('add-promotion', { error: "Database error adding promotion. Name might be duplicate." });
    }
});

// Path is '/promotions/edit/:id' (Edit Page)
router.get('/promotions/edit/:id', isAuthenticated, isAdminOrParkManager, async (req, res) => {
    try {
        const [promo] = await pool.query('SELECT * FROM event_promotions WHERE event_id = ?', [req.params.id]);
        if (promo.length === 0) return res.status(404).send('Promotion not found');

        res.render('edit-promotion', {
            promotion: promo[0],
            returnQuery: req.query.returnQuery || '',
            error: null
        });
    } catch (error) {
        console.error(error);
        res.status(500).send('Error loading edit page');
    }
});

// Path is '/promotions/edit/:id' (Update Action)
router.post('/promotions/edit/:id', isAuthenticated, isAdminOrParkManager, async (req, res) => {
    const { event_name, event_type, start_date, end_date, discount_percent, summary, is_recurring, returnQuery } = req.body;
    try {
        const isRecurring = is_recurring === '1';

        const sql = `
            UPDATE event_promotions 
            SET event_name = ?, event_type = ?, start_date = ?, end_date = ?, discount_percent = ?, summary = ?, is_recurring = ?
            WHERE event_id = ?
        `;
        await pool.query(sql, [event_name, event_type, start_date, end_date, discount_percent, summary || null, isRecurring, req.params.id]);

        req.session.success = "Promotion updated successfully.";
        res.redirect('/promotions' + (returnQuery ? `?${returnQuery}` : ''));
    } catch (error) {
        console.error(error);
        req.session.error = "Error updating promotion.";
        res.redirect('/promotions');
    }
});

// GET /locations/edit/:public_location_id
router.get('/locations/edit/:public_location_id', isAuthenticated, isAdminOrParkManager, async (req, res) => {
    const { public_location_id } = req.params;
    try {
        const [locResult] = await pool.query('SELECT * FROM location WHERE public_location_id = ?', [public_location_id]);
        if (locResult.length === 0) {
            return res.status(404).send('Location not found');
        }
        res.render('edit-location', { location: locResult[0], error: null });
    } catch (error) {
        console.error("Error loading edit location page:", error);
        res.status(500).send('Error loading page');
    }
});

// Path is '/promotions/delete/:id' (Delete Action)
router.post('/promotions/delete/:id', isAuthenticated, isAdminOrParkManager, async (req, res) => {
    try {
        await pool.query('DELETE FROM event_promotions WHERE event_id = ?', [req.params.id]);
        req.session.success = "Promotion deleted.";
        res.redirect('/promotions');
    } catch (error) {
        console.error(error);
        req.session.error = "Error deleting promotion.";
        res.redirect('/promotions');
    }
});

// POST /locations/edit/:public_location_id
router.post('/locations/edit/:public_location_id', isAuthenticated, isAdminOrParkManager, async (req, res) => {
    const { public_location_id } = req.params;
    const { location_name, summary } = req.body;

    try {
        const sql = "UPDATE location SET location_name = ?, summary = ? WHERE public_location_id = ?";
        await pool.query(sql, [location_name, summary || null, public_location_id]);

        req.session.success = "Location updated successfully.";
        res.redirect('/locations');

    } catch (error) {
        console.error("Error updating location:", error);
        const [locResult] = await pool.query('SELECT * FROM location WHERE public_location_id = ?', [public_location_id]);
        res.render('edit-location', {
            location: locResult[0] || req.body,
            error: "Database error updating location. Name might be duplicate."
        });
    }
});

// POST /locations/delete/:public_location_id
router.post('/locations/delete/:public_location_id', isAuthenticated, isAdminOrParkManager, async (req, res) => {
    const { public_location_id } = req.params;

    let connection;
    try {
        connection = await pool.getConnection();

        // 1. Check if location exists
        const [loc] = await connection.query('SELECT location_id, location_name FROM location WHERE public_location_id = ?', [public_location_id]);
        if (loc.length === 0) {
            req.session.error = "Location not found.";
            return res.redirect('/locations');
        }

        // 2. Attempt Delete
        // Note: This will fail if Rides or Employees are still assigned (Foreign Key Constraints)
        await connection.query('DELETE FROM location WHERE public_location_id = ?', [public_location_id]);

        req.session.success = `Location "${loc[0].location_name}" removed successfully.`;
        res.redirect('/locations');

    } catch (error) {
        console.error("Error deleting location:", error);

        // Handle Foreign Key Constraint Violation (Error 1451)
        if (error.code === 'ER_ROW_IS_REFERENCED_2') {
            req.session.error = "Cannot remove this location because it still has Rides or Employees assigned to it. Please reassign or remove them first.";
        } else {
            req.session.error = "An error occurred while trying to remove the location.";
        }
        res.redirect('/locations');
    } finally {
        if (connection) connection.release();
    }
});

// POST /locations/update-coords (Save Map Pins)
router.post('/locations/update-coords', isAuthenticated, isAdminOrParkManager, async (req, res) => {
    const { pins } = req.body; // Array of { id, x, y }

    if (!pins || !Array.isArray(pins)) {
        return res.status(400).json({ success: false, message: 'Invalid data' });
    }

    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        for (const pin of pins) {
            await connection.query(
                "UPDATE location SET pin_x = ?, pin_y = ? WHERE location_id = ?",
                [pin.x, pin.y, pin.id]
            );
        }

        await connection.commit();
        res.json({ success: true, message: 'Map updated successfully' });
    } catch (error) {
        if (connection) await connection.rollback();
        console.error("Error updating map pins:", error);
        res.status(500).json({ success: false, message: 'Database error' });
    } finally {
        if (connection) connection.release();
    }
});

module.exports = router;