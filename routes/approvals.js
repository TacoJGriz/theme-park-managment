const express = require('express');
const router = express.Router();
const pool = require('../db');
const {
    isAuthenticated,
    canViewApprovals,
    canApproveMaintenance,
    canApproveInventory
} = require('../middleware/auth');

// view pending requests
router.get('/approvals', isAuthenticated, canViewApprovals, async (req, res) => {
    try {
        const { role, locationId } = req.session.user;
        let reassignments = [];
        let inventoryRequests = [];

        // maintenance requests
        if (role === 'Admin' || role === 'Park Manager') {
            const reassignmentQuery = `
                SELECT
                    m.maintenance_id,
                    m.public_maintenance_id,
                    r.ride_name,
                    r.public_ride_id,
                    m.summary,
                    CONCAT(current_emp.first_name, ' ', current_emp.last_name) as current_employee_name,
                    CONCAT(pending_emp.first_name, ' ', pending_emp.last_name) as pending_employee_name,
                    pending_emp.public_employee_id as assignee_public_id,
                    CONCAT(requester.first_name, ' ', requester.last_name) as requester_name,
                    requester.public_employee_id as requester_public_id
                FROM maintenance m
                JOIN rides r ON m.ride_id = r.ride_id
                LEFT JOIN employee_demographics current_emp ON m.employee_id = current_emp.employee_id
                JOIN employee_demographics pending_emp ON m.pending_employee_id = pending_emp.employee_id
                JOIN employee_demographics requester ON m.assignment_requested_by = requester.employee_id
                WHERE m.pending_employee_id IS NOT NULL AND m.end_date IS NULL
            `;
            const [reassignmentResults] = await pool.query(reassignmentQuery);
            reassignments = reassignmentResults;
        }

        // inventory requests
        if (role === 'Admin' || role === 'Park Manager' || role === 'Location Manager') {
            let inventoryQuery = `
                SELECT 
                    ir.request_id, 
                    ir.public_request_id,
                    ir.requested_count,
                    v.vendor_name,
                    v.public_vendor_id,
                    i.item_name,
                    i.public_item_id,
                    COALESCE(CONCAT(e.first_name, ' ', e.last_name), 'System Auto-Restock') as requester_name,
                    e.public_employee_id as requester_public_id,
                    COALESCE(inv.count, 0) as current_count
                FROM inventory_requests ir
                JOIN vendors v ON ir.vendor_id = v.vendor_id
                JOIN item i ON ir.item_id = i.item_id
                LEFT JOIN employee_demographics e ON ir.requested_by_id = e.employee_id
                LEFT JOIN inventory inv ON ir.vendor_id = inv.vendor_id AND ir.item_id = inv.item_id
                WHERE ir.status = 'Pending'
            `;
            let inventoryParams = [];

            if (role === 'Location Manager') {
                inventoryQuery += ' AND v.location_id = ?';
                inventoryParams.push(locationId);
            }

            const [invResults] = await pool.query(inventoryQuery, inventoryParams);
            inventoryRequests = invResults;
        }

        req.session.lastApprovalCheckCount = reassignments.length + inventoryRequests.length;

        res.render('approvals', {
            rateChanges: [],
            reassignments,
            inventoryRequests
        });
    } catch (error) {
        console.error("Error fetching approvals:", error);
        res.status(500).send("Error loading approvals page.");
    }
});

// approve maintenance transfer
router.post('/approve/reassignment/:public_maintenance_id', isAuthenticated, canApproveMaintenance, async (req, res) => {
    try {
        const sql = `
            UPDATE maintenance
            SET employee_id = pending_employee_id,
                pending_employee_id = NULL,
                assignment_requested_by = NULL
            WHERE public_maintenance_id = ?
        `;
        await pool.query(sql, [req.params.public_maintenance_id]);
        res.redirect('/approvals');
    } catch (error) {
        console.error("Error approving reassignment:", error);
        res.status(500).send("Error processing approval.");
    }
});

// reject maintenance transfer
router.post('/reject/reassignment/:public_maintenance_id', isAuthenticated, canApproveMaintenance, async (req, res) => {
    try {
        const sql = `
            UPDATE maintenance
            SET pending_employee_id = NULL,
                assignment_requested_by = NULL
            WHERE public_maintenance_id = ?
        `;
        await pool.query(sql, [req.params.public_maintenance_id]);
        res.redirect('/approvals');
    } catch (error) {
        console.error("Error rejecting reassignment:", error);
        res.status(500).send("Error processing rejection.");
    }
});

// approve inventory restock
router.post('/approve/inventory/:public_request_id', isAuthenticated, canApproveInventory, async (req, res) => {
    const { public_request_id } = req.params;
    const { role, locationId } = req.session.user;

    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        const [reqResult] = await connection.query(
            `SELECT ir.request_id, ir.vendor_id, ir.item_id, ir.requested_count, v.location_id
             FROM inventory_requests ir
             JOIN vendors v ON ir.vendor_id = v.vendor_id
             WHERE ir.public_request_id = ? AND ir.status = 'Pending'`,
            [public_request_id]
        );

        if (reqResult.length === 0) {
            throw new Error("Request not found or already processed.");
        }
        const request = reqResult[0];

        if (role === 'Location Manager' && request.location_id !== locationId) {
            return res.status(403).send('Forbidden: You can only approve requests for your location.');
        }

        const updateSql = `
            INSERT INTO inventory (vendor_id, item_id, count)
            VALUES (?, ?, ?)
            ON DUPLICATE KEY UPDATE count = count + ?
        `;
        await connection.query(updateSql, [
            request.vendor_id,
            request.item_id,
            request.requested_count,
            request.requested_count
        ]);

        await connection.query(
            "UPDATE inventory_requests SET status = 'Approved' WHERE request_id = ?",
            [request.request_id]
        );

        await connection.commit();
        res.redirect('/approvals');

    } catch (error) {
        if (connection) await connection.rollback();
        console.error("Error approving inventory request:", error);
        res.status(500).send("Error processing approval.");
    } finally {
        if (connection) connection.release();
    }
});

// reject inventory restock
router.post('/reject/inventory/:public_request_id', isAuthenticated, canApproveInventory, async (req, res) => {
    const { public_request_id } = req.params;
    const { role, locationId } = req.session.user;

    let connection;
    try {
        connection = await pool.getConnection();

        const [reqResult] = await connection.query(
            `SELECT ir.request_id, v.location_id
             FROM inventory_requests ir
             JOIN vendors v ON ir.vendor_id = v.vendor_id
             WHERE ir.public_request_id = ?`,
            [public_request_id]
        );

        if (reqResult.length > 0) {
            const request = reqResult[0];
            if (role === 'Location Manager' && request.location_id !== locationId) {
                return res.status(403).send('Forbidden: You can only reject requests for your location.');
            }

            await connection.query(
                "UPDATE inventory_requests SET status = 'Rejected' WHERE request_id = ?",
                [request.request_id]
            );
        }
        res.redirect('/approvals');
    } catch (error) {
        console.error("Error rejecting inventory request:", error);
        res.status(500).send("Error processing rejection.");
    } finally {
        if (connection) connection.release();
    }
});

module.exports = router;