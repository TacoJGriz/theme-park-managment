const express = require('express');
const router = express.Router();
const pool = require('../db');
const crypto = require('crypto');
const {
    isAuthenticated,
    canViewInventory,
    canManageInventory,
    canManageRetail
} = require('../middleware/auth');

// --- INVENTORY VIEW ROUTES ---

// GET /inventory (Global Inventory View)
router.get('/', isAuthenticated, canViewInventory, async (req, res) => {
    try {
        const { role, locationId } = req.session.user;
        let queryParams = [];
        let locationFilter = "";

        if (role === 'Location Manager' || role === 'Staff') {
            locationFilter = 'WHERE v.location_id = ?';
            queryParams.push(locationId);
        }

        const query = `
            SELECT 
                v.vendor_id, v.vendor_name, v.public_vendor_id,
                it.item_id, it.item_name, it.public_item_id,
                i.count AS current_count,
                ir.request_id, ir.public_request_id,
                ir.requested_count AS pending_count,
                ir.requested_by_id
            FROM inventory i
            JOIN vendors v ON i.vendor_id = v.vendor_id
            JOIN item it ON i.item_id = it.item_id
            LEFT JOIN inventory_requests ir ON v.vendor_id = ir.vendor_id AND it.item_id = ir.item_id AND ir.status = 'Pending'
            ${locationFilter}
            ORDER BY v.vendor_name, it.item_name;
        `;

        const [inventory] = await pool.query(query, queryParams);
        res.render('inventory', { inventory: inventory });
    } catch (error) {
        console.error(error);
        res.status(500).send('Error fetching inventory');
    }
});

// GET /inventory/vendor/:public_vendor_id (Specific Vendor Inventory)
router.get('/vendor/:public_vendor_id', isAuthenticated, canViewInventory, async (req, res) => {
    const { public_vendor_id } = req.params;
    const { role, locationId } = req.session.user;
    const { returnTo } = req.query; // Capture return path

    // Determine Back Link Logic
    let backLink = '/vendors'; // Default
    let backText = 'Back to Vendors';

    if (returnTo === 'inventory') {
        backLink = '/inventory';
        backText = 'Back to Global Inventory';
    }

    try {
        const [vendorRes] = await pool.query('SELECT * FROM vendors WHERE public_vendor_id = ?', [public_vendor_id]);
        if (vendorRes.length === 0) return res.status(404).send('Vendor not found');
        const vendor = vendorRes[0];

        // Note: Staff can view, but Location Manager is restricted to their own location
        if (role === 'Location Manager' && vendor.location_id !== locationId) {
            return res.status(403).send('Forbidden: Access denied.');
        }

        const query = `
            SELECT 
                v.vendor_id, v.vendor_name, v.public_vendor_id,
                it.item_id, it.item_name, it.public_item_id,
                i.count AS current_count,
                ir.request_id, ir.public_request_id,
                ir.requested_count AS pending_count
            FROM inventory i
            JOIN vendors v ON i.vendor_id = v.vendor_id
            JOIN item it ON i.item_id = it.item_id
            LEFT JOIN inventory_requests ir ON v.vendor_id = ir.vendor_id AND it.item_id = ir.item_id AND ir.status = 'Pending'
            WHERE v.public_vendor_id = ?
            ORDER BY it.item_name;
        `;

        const [inventory] = await pool.query(query, [public_vendor_id]);

        res.render('vendor-inventory', {
            vendor: vendor,
            inventory: inventory,
            backLink: backLink,
            backText: backText,
            success: req.session.success,
            error: req.session.error
        });
        req.session.success = null;
        req.session.error = null;

    } catch (error) {
        console.error(error);
        res.status(500).send('Error fetching vendor inventory');
    }
});

// --- INVENTORY MANAGEMENT ROUTES ---

// GET /inventory/add
router.get('/add', isAuthenticated, canManageRetail, async (req, res) => {
    const { preselected_vendor } = req.query;
    try {
        const { role, locationId } = req.session.user;

        let vendorQuery = 'SELECT vendor_id, public_vendor_id, vendor_name FROM vendors';
        let vendorParams = [];
        if (role === 'Location Manager') {
            vendorQuery += ' WHERE location_id = ?';
            vendorParams.push(locationId);
        }
        vendorQuery += ' ORDER BY vendor_name';
        const [vendors] = await pool.query(vendorQuery, vendorParams);

        const [items] = await pool.query('SELECT item_id, public_item_id, item_name FROM item ORDER BY item_name');

        const cancelLink = preselected_vendor ? `/inventory/vendor/${preselected_vendor}` : '/inventory';

        res.render('manage-inventory', {
            vendors: vendors,
            items: items,
            preselected_vendor: preselected_vendor || null,
            cancelLink: cancelLink,
            error: null,
            success: null
        });

    } catch (error) {
        console.error("Error loading add inventory page:", error);
        res.status(500).send("Error loading page.");
    }
});

// POST /inventory/add
router.post('/add', isAuthenticated, canManageRetail, async (req, res) => {
    const { public_vendor_id, public_item_id, count } = req.body;
    const { role, locationId } = req.session.user;

    try {
        const [vendorRes] = await pool.query('SELECT vendor_id, location_id, public_vendor_id FROM vendors WHERE public_vendor_id = ?', [public_vendor_id]);
        const [itemRes] = await pool.query('SELECT item_id FROM item WHERE public_item_id = ?', [public_item_id]);

        if (vendorRes.length === 0 || itemRes.length === 0) throw new Error("Invalid Vendor or Item.");
        const vendor = vendorRes[0];
        const item = itemRes[0];

        if (role === 'Location Manager' && vendor.location_id !== locationId) return res.status(403).send("Forbidden");

        const sql = `INSERT INTO inventory (vendor_id, item_id, count) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE count = VALUES(count)`;
        await pool.query(sql, [vendor.vendor_id, item.item_id, count]);

        res.redirect(`/inventory/vendor/${vendor.public_vendor_id}`);

    } catch (error) {
        console.error("Error adding inventory:", error);
        const cancelLink = public_vendor_id ? `/inventory/vendor/${public_vendor_id}` : '/inventory';
        const [vendors] = await pool.query('SELECT vendor_id, public_vendor_id, vendor_name FROM vendors');
        const [items] = await pool.query('SELECT item_id, public_item_id, item_name FROM item');

        res.render('manage-inventory', {
            vendors: vendors, items: items, preselected_vendor: public_vendor_id,
            cancelLink: cancelLink,
            error: error.message, success: null
        });
    }
});

// GET /inventory/destock/:public_vendor_id/:public_item_id
router.get('/destock/:public_vendor_id/:public_item_id', isAuthenticated, canManageRetail, async (req, res) => {
    const { public_vendor_id, public_item_id } = req.params;
    const { role, locationId } = req.session.user;
    const { returnTo } = req.query;

    try {
        const [itemResult] = await pool.query(`
            SELECT 
                v.vendor_id, v.vendor_name, v.location_id, v.public_vendor_id,
                it.item_id, it.item_name, it.public_item_id,
                i.count AS current_count
            FROM inventory i
            JOIN vendors v ON i.vendor_id = v.vendor_id
            JOIN item it ON i.item_id = it.item_id
            WHERE v.public_vendor_id = ? AND it.public_item_id = ?
        `, [public_vendor_id, public_item_id]);

        if (itemResult.length === 0) return res.status(404).send('Item or Vendor not found.');
        const item = itemResult[0];

        if (role === 'Location Manager' && item.location_id !== locationId) return res.status(403).send('Forbidden.');

        // CALCULATE LINKS
        const cancelLink = (returnTo === 'inventory') ? '/inventory' : `/inventory/vendor/${public_vendor_id}`;
        // Pass the full action URL including the query param to persist 'returnTo'
        const formAction = `/inventory/destock/${public_vendor_id}/${public_item_id}${returnTo ? '?returnTo=' + returnTo : ''}`;

        res.render('destock-item', {
            item: item,
            cancelLink: cancelLink,
            formAction: formAction,
            error: null
        });

    } catch (error) {
        console.error("Error loading destock form:", error);
        res.status(500).send("Error loading page.");
    }
});

// POST /inventory/destock/:public_vendor_id/:public_item_id
router.post('/destock/:public_vendor_id/:public_item_id', isAuthenticated, canManageRetail, async (req, res) => {
    const { public_vendor_id, public_item_id } = req.params;
    const { remove_count } = req.body;
    const { role, locationId } = req.session.user;
    const { returnTo } = req.query;
    const countToRemove = parseInt(remove_count, 10);

    try {
        const [itemResult] = await pool.query(`
            SELECT i.count, v.vendor_id, it.item_id, v.location_id
            FROM inventory i
            JOIN vendors v ON i.vendor_id = v.vendor_id
            JOIN item it ON i.item_id = it.item_id
            WHERE v.public_vendor_id = ? AND it.public_item_id = ?
        `, [public_vendor_id, public_item_id]);

        if (itemResult.length === 0) return res.status(404).send('Item not found.');
        const item = itemResult[0];

        if (role === 'Location Manager' && item.location_id !== locationId) return res.status(403).send('Forbidden.');

        if (isNaN(countToRemove) || countToRemove <= 0) throw new Error("Invalid number.");
        if (countToRemove > item.count) throw new Error(`Cannot remove ${countToRemove}. Only ${item.count} in stock.`);

        await pool.query('UPDATE inventory SET count = count - ? WHERE vendor_id = ? AND item_id = ?', [countToRemove, item.vendor_id, item.item_id]);

        if (returnTo === 'inventory') {
            res.redirect('/inventory');
        } else {
            res.redirect(`/inventory/vendor/${public_vendor_id}`);
        }

    } catch (error) {
        // Fallback
        const cancelLink = `/inventory/vendor/${public_vendor_id}`;
        res.status(500).send(`Error: ${error.message}. <a href="${cancelLink}">Go Back</a>`);
    }
});

// POST /inventory/deshelf/:public_vendor_id/:public_item_id
router.post('/deshelf/:public_vendor_id/:public_item_id', isAuthenticated, canManageRetail, async (req, res) => {
    const { public_vendor_id, public_item_id } = req.params;
    const { role, locationId } = req.session.user;
    const { returnTo } = req.query;

    try {
        const [vendorRes] = await pool.query('SELECT vendor_id, location_id FROM vendors WHERE public_vendor_id = ?', [public_vendor_id]);
        const [itemRes] = await pool.query('SELECT item_id FROM item WHERE public_item_id = ?', [public_item_id]);

        if (vendorRes.length > 0 && itemRes.length > 0) {
            if (role === 'Location Manager' && vendorRes[0].location_id !== locationId) return res.status(403).send('Forbidden');
            await pool.query('DELETE FROM inventory WHERE vendor_id = ? AND item_id = ?', [vendorRes[0].vendor_id, itemRes[0].item_id]);
        }

        if (returnTo === 'inventory') {
            res.redirect('/inventory');
        } else {
            res.redirect(`/inventory/vendor/${public_vendor_id}`);
        }
    } catch (error) {
        console.error(error);
        res.status(500).send("Error removing item.");
    }
});

// --- RESTOCK REQUEST ROUTES ---

// GET /inventory/request/edit/:public_request_id
router.get('/request/edit/:public_request_id', isAuthenticated, canManageInventory, async (req, res) => {
    const { public_request_id } = req.params;
    const { id: actorId } = req.session.user;

    try {
        const [reqResult] = await pool.query(`
            SELECT ir.*, it.item_name, v.vendor_name
            FROM inventory_requests ir
            JOIN item it ON ir.item_id = it.item_id
            JOIN vendors v ON ir.vendor_id = v.vendor_id
            WHERE ir.public_request_id = ?
        `, [public_request_id]);

        if (reqResult.length === 0) return res.status(404).send('Request not found.');
        const request = reqResult[0];

        if (request.requested_by_id !== actorId) return res.status(403).send('Forbidden: You can only edit your own requests.');
        if (request.status !== 'Pending') return res.status(400).send('Request already processed.');

        res.render('inventory-request-edit', { request: request, error: null });

    } catch (error) {
        res.status(500).send("Error loading page.");
    }
});

// POST /inventory/request/edit/:public_request_id
router.post('/request/edit/:public_request_id', isAuthenticated, canManageInventory, async (req, res) => {
    const { public_request_id } = req.params;
    const { requested_count } = req.body;

    try {
        await pool.query('UPDATE inventory_requests SET requested_count = ? WHERE public_request_id = ? AND status = "Pending"', [requested_count, public_request_id]);
        res.redirect('/inventory/requests');
    } catch (error) {
        res.status(500).send("Error updating request.");
    }
});

// GET /inventory/request/:public_vendor_id/:public_item_id
router.get('/request/:public_vendor_id/:public_item_id', isAuthenticated, canManageInventory, async (req, res) => {
    const { public_vendor_id, public_item_id } = req.params;
    const { role, locationId } = req.session.user;
    const { returnTo } = req.query;

    try {
        const [itemResult] = await pool.query(`
            SELECT 
                v.vendor_id, v.vendor_name, v.location_id, v.public_vendor_id,
                it.item_id, it.item_name, it.public_item_id,
                COALESCE(i.count, 0) AS current_count
            FROM vendors v
            JOIN item it ON it.public_item_id = ?
            LEFT JOIN inventory i ON v.vendor_id = i.vendor_id AND it.item_id = i.item_id
            WHERE v.public_vendor_id = ?
        `, [public_item_id, public_vendor_id]);

        if (itemResult.length === 0) return res.status(404).send('Item or Vendor not found.');
        const item = itemResult[0];

        if ((role === 'Location Manager' || role === 'Staff') && item.location_id !== locationId) {
            return res.status(403).send('Forbidden.');
        }

        // CALCULATE LINKS
        const cancelLink = (returnTo === 'inventory') ? '/inventory' : `/inventory/vendor/${public_vendor_id}`;
        // Pass full action URL including query param
        const formAction = `/inventory/request/${public_vendor_id}/${public_item_id}${returnTo ? '?returnTo=' + returnTo : ''}`;

        res.render('inventory-request-form', {
            item: item,
            cancelLink: cancelLink,
            formAction: formAction,
            error: null
        });

    } catch (error) {
        res.status(500).send("Error loading page.");
    }
});

// POST /inventory/request/:public_vendor_id/:public_item_id
router.post('/request/:public_vendor_id/:public_item_id', isAuthenticated, canManageInventory, async (req, res) => {
    const { public_vendor_id, public_item_id } = req.params;
    const { requested_count } = req.body;
    const { id: actorId } = req.session.user;
    const { returnTo } = req.query;

    try {
        const [itemResult] = await pool.query(`SELECT vendor_id, location_id FROM vendors WHERE public_vendor_id = ?`, [public_vendor_id]);
        const [itemRes] = await pool.query(`SELECT item_id FROM item WHERE public_item_id = ?`, [public_item_id]);

        if (itemResult.length > 0 && itemRes.length > 0) {
            const publicRequestId = crypto.randomUUID();
            await pool.query(`INSERT INTO inventory_requests (public_request_id, vendor_id, item_id, requested_count, requested_by_id, location_id, request_date) VALUES (?, ?, ?, ?, ?, ?, CURDATE())`,
                [publicRequestId, itemResult[0].vendor_id, itemRes[0].item_id, requested_count, actorId, itemResult[0].location_id]);
        }

        if (returnTo === 'inventory') {
            res.redirect('/inventory');
        } else {
            res.redirect(`/inventory/vendor/${public_vendor_id}`);
        }

    } catch (error) {
        res.status(500).send(`Error: ${error.message}`);
    }
});

// GET /inventory/requests
router.get('/requests', isAuthenticated, canManageInventory, async (req, res) => {
    const { role, locationId } = req.session.user;
    try {
        let queryParams = [];
        let locationFilter = "";
        if (role === 'Location Manager' || role === 'Staff') {
            locationFilter = 'WHERE ir.location_id = ?';
            queryParams.push(locationId);
        }

        // FIXED BUG: Use single quotes in ORDER BY clause
        let query = `
            SELECT ir.*, it.item_name, v.vendor_name, CONCAT(e.first_name, ' ', e.last_name) as requester_name
            FROM inventory_requests ir
            JOIN item it ON ir.item_id = it.item_id
            JOIN vendors v ON ir.vendor_id = v.vendor_id
            JOIN employee_demographics e ON ir.requested_by_id = e.employee_id
            ${locationFilter}
            ORDER BY CASE WHEN ir.status = 'Pending' THEN 1 ELSE 2 END, ir.request_date DESC
        `;

        const [requests] = await pool.query(query, queryParams);
        res.render('inventory-request-list', { requests: requests });
    } catch (error) {
        console.error("Error fetching requests:", error);
        res.status(500).send("Error loading requests.");
    }
});

module.exports = router;