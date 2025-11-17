const express = require('express');
const router = express.Router();
const pool = require('../db');
const crypto = require('crypto'); // ADDED
const {
    isAuthenticated,
    canViewInventory,
    canManageInventory
} = require('../middleware/auth');

// GET /inventory
// This is the root (/) because app.js adds the /inventory prefix
router.get('/', isAuthenticated, canViewInventory, async (req, res) => {
    try {
        const { role, locationId, id: userId } = req.session.user;

        let queryParams = [];
        let locationFilter = "";

        if (role === 'Location Manager' || role === 'Staff') {
            locationFilter = 'WHERE v.location_id = ?';
            queryParams.push(locationId);
        }

        const query = `
            SELECT 
                v.vendor_id, v.vendor_name, v.public_vendor_id, -- ADDED public_vendor_id
                it.item_id, it.item_name, it.public_item_id, -- ADDED public_item_id
                COALESCE(i.count, 0) AS current_count,
                ir.request_id, ir.public_request_id, -- ADDED public_request_id
                ir.requested_count AS pending_count,
                ir.requested_by_id
            FROM vendors v
            CROSS JOIN item it
            LEFT JOIN inventory i ON v.vendor_id = i.vendor_id AND it.item_id = i.item_id
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

// GET /inventory/request/edit/:public_request_id
// This path is /request/edit/:public_request_id
router.get('/request/edit/:public_request_id', isAuthenticated, canManageInventory, async (req, res) => {
    const { public_request_id } = req.params; // CHANGED
    const { id: actorId } = req.session.user;

    try {
        const [reqResult] = await pool.query(`
            SELECT ir.*, it.item_name, v.vendor_name
            FROM inventory_requests ir
            JOIN item it ON ir.item_id = it.item_id
            JOIN vendors v ON ir.vendor_id = v.vendor_id
            WHERE ir.public_request_id = ? -- CHANGED
        `, [public_request_id]); // CHANGED

        if (reqResult.length === 0) {
            return res.status(404).send('Request not found.');
        }
        const request = reqResult[0];

        if (request.requested_by_id !== actorId) {
            return res.status(403).send('Forbidden: You can only edit your own requests.');
        }
        if (request.status !== 'Pending') {
            return res.status(400).send('This request has already been processed and cannot be edited.');
        }

        res.render('inventory-request-edit', { request: request, error: null });

    } catch (error) {
        console.error("Error loading edit request form:", error);
        res.status(500).send("Error loading page.");
    }
});

// POST /inventory/request/edit/:public_request_id
// This path is /request/edit/:public_request_id
router.post('/request/edit/:public_request_id', isAuthenticated, canManageInventory, async (req, res) => {
    const { public_request_id } = req.params; // CHANGED
    const { requested_count } = req.body;
    const { id: actorId } = req.session.user;

    let request; // For catch block
    try {
        const [reqResult] = await pool.query('SELECT * FROM inventory_requests WHERE public_request_id = ?', [public_request_id]); // CHANGED
        if (reqResult.length === 0) {
            return res.status(404).send('Request not found.');
        }
        request = reqResult[0];

        if (request.requested_by_id !== actorId) {
            return res.status(403).send('Forbidden: You can only edit your own requests.');
        }
        if (request.status !== 'Pending') {
            return res.status(400).send('This request has already been processed and cannot be edited.');
        }
        if (requested_count <= 0) {
            throw new Error("Requested amount must be greater than zero.");
        }

        await pool.query('UPDATE inventory_requests SET requested_count = ? WHERE public_request_id = ?', [requested_count, public_request_id]); // CHANGED
        res.redirect('/inventory/requests');

    } catch (error) {
        console.error("Error updating request:", error);
        const [fullReqResult] = await pool.query(`
            SELECT ir.*, it.item_name, v.vendor_name
            FROM inventory_requests ir
            JOIN item it ON ir.item_id = it.item_id
            JOIN vendors v ON ir.vendor_id = v.vendor_id
            WHERE ir.public_request_id = ? -- CHANGED
        `, [public_request_id]); // CHANGED

        res.render('inventory-request-edit', {
            request: fullReqResult[0] || request,
            error: error.message
        });
    }
});

// GET /inventory/request/:public_vendor_id/:public_item_id
// This path is /request/:public_vendor_id/:public_item_id
router.get('/request/:public_vendor_id/:public_item_id', isAuthenticated, canManageInventory, async (req, res) => {
    const { public_vendor_id, public_item_id } = req.params; // CHANGED
    const { role, locationId } = req.session.user;

    try {
        const [itemResult] = await pool.query(`
            SELECT 
                v.vendor_id, v.vendor_name, v.location_id, v.public_vendor_id, -- ADDED public_vendor_id
                it.item_id, it.item_name, it.public_item_id, -- ADDED public_item_id
                COALESCE(i.count, 0) AS current_count
            FROM vendors v
            JOIN item it ON it.public_item_id = ? -- CHANGED
            LEFT JOIN inventory i ON v.vendor_id = i.vendor_id AND it.item_id = i.item_id
            WHERE v.public_vendor_id = ? -- CHANGED
        `, [public_item_id, public_vendor_id]); // CHANGED

        if (itemResult.length === 0) {
            return res.status(404).send('Item or Vendor not found.');
        }

        const item = itemResult[0];
        if ((role === 'Location Manager' || role === 'Staff') && item.location_id !== locationId) {
            return res.status(403).send('Forbidden: You can only restock items in your location.');
        }

        res.render('inventory-request-form', { item: item, error: null });

    } catch (error) {
        console.error("Error loading restock form:", error);
        res.status(500).send("Error loading page.");
    }
});

// POST /inventory/request/:public_vendor_id/:public_item_id
// This path is /request/:public_vendor_id/:public_item_id
router.post('/request/:public_vendor_id/:public_item_id', isAuthenticated, canManageInventory, async (req, res) => {
    const { public_vendor_id, public_item_id } = req.params; // CHANGED
    const { requested_count } = req.body;
    const { role, locationId, id: actorId } = req.session.user;
    let item;

    try {
        const [itemResult] = await pool.query(`
            SELECT v.vendor_id, v.vendor_name, v.location_id, v.public_vendor_id,
                   it.item_id, it.item_name, it.public_item_id, 
                   COALESCE(i.count, 0) AS current_count
            FROM vendors v
            JOIN item it ON it.public_item_id = ? -- CHANGED
            LEFT JOIN inventory i ON v.vendor_id = i.vendor_id AND it.item_id = i.item_id
            WHERE v.public_vendor_id = ? -- CHANGED
        `, [public_item_id, public_vendor_id]); // CHANGED

        if (itemResult.length === 0) {
            return res.status(404).send('Item or Vendor not found.');
        }
        item = itemResult[0]; // This contains the internal vendor_id and item_id

        if ((role === 'Location Manager' || role === 'Staff') && item.location_id !== locationId) {
            return res.status(403).send('Forbidden: You can only restock items in your location.');
        }

        if (requested_count <= 0) {
            throw new Error("Requested amount must be greater than zero.");
        }

        const publicRequestId = crypto.randomUUID(); // ADDED

        // ADDED public_request_id
        const sql = `
            INSERT INTO inventory_requests (public_request_id, vendor_id, item_id, requested_count, requested_by_id, location_id, request_date)
            VALUES (?, ?, ?, ?, ?, ?, CURDATE())
        `;
        // Use internal item.vendor_id and item.item_id from our SELECT
        await pool.query(sql, [publicRequestId, item.vendor_id, item.item_id, requested_count, actorId, item.location_id]);

        res.redirect('/inventory');

    } catch (error) {
        console.error("Error submitting restock request:", error);
        res.render('inventory-request-form', {
            item: item || { public_vendor_id, public_item_id, item_name: 'Error', vendor_name: 'Error', current_count: 0 },
            error: error.message
        });
    }
});

// GET /inventory/requests
// This path is /requests
router.get('/requests', isAuthenticated, canManageInventory, async (req, res) => {
    const { role, locationId } = req.session.user;

    try {
        let queryParams = [];
        let locationFilter = "";

        if (role === 'Location Manager' || role === 'Staff') {
            locationFilter = 'WHERE ir.location_id = ?';
            queryParams.push(locationId);
        }

        const query = `
            SELECT 
                ir.*,
                it.item_name,
                v.vendor_name,
                CONCAT(e.first_name, ' ', e.last_name) as requester_name
            FROM inventory_requests ir
            JOIN item it ON ir.item_id = it.item_id
            JOIN vendors v ON ir.vendor_id = v.vendor_id
            JOIN employee_demographics e ON ir.requested_by_id = e.employee_id
            ${locationFilter}
            ORDER BY
                CASE WHEN ir.status = 'Pending' THEN 1 ELSE 2 END,
                ir.request_date DESC
        `;

        const [requests] = await pool.query(query, queryParams);
        res.render('inventory-request-list', { requests: requests });

    } catch (error) {
        console.error("Error fetching inventory requests:", error);
        res.status(500).send("Error loading page.");
    }
});

module.exports = router;