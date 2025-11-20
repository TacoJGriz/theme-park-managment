const express = require('express');
const router = express.Router();
const pool = require('../db'); // Adjust path to db.js
const crypto = require('crypto'); // ADDED
const {
    isAuthenticated,
    isMaintenanceOrHigher,
    isAdminOrParkManager // ADDED for editing/reopening permission check
} = require('../middleware/auth'); // Adjust path to auth.js

// --- MAINTENANCE ROUTES ---

// GET /maintenance/ride/:public_ride_id
// Path changed to /ride/:public_ride_id
router.get('/ride/:public_ride_id', isAuthenticated, (req, res, next) => {
    const role = req.session.user ? req.session.user.role : null;
    if (role === 'Admin' || role === 'Park Manager' || role === 'Maintenance' || role === 'Location Manager') {
        return next();
    }
    res.status(403).send('Forbidden: Access denied.');
}, async (req, res) => {
    const { public_ride_id } = req.params;
    const { role, locationId } = req.session.user;

    // Capture the returnQuery passed from the rides.ejs link
    const ridesListQuery = req.query.returnQuery || '';
    let ride;

    try {
        const [rideResult] = await pool.query('SELECT ride_id, ride_name, location_id, public_ride_id FROM rides WHERE public_ride_id = ?', [public_ride_id]);
        if (rideResult.length === 0) {
            return res.status(404).send('Ride not found');
        }
        ride = rideResult[0];
        const internalRideId = ride.ride_id; // <-- FIX: Define internalRideId here

        if (role === 'Location Manager' && ride.location_id !== locationId) {
            return res.status(403).send('Forbidden: You can only view maintenance for rides in your location.');
        }

        const query = `
            SELECT m.*, CONCAT(e.first_name, ' ', e.last_name) as employee_name,
                   CONCAT(pending_emp.first_name, ' ', pending_emp.last_name) as pending_employee_name
            FROM maintenance m
            LEFT JOIN employee_demographics e ON m.employee_id = e.employee_id
            LEFT JOIN employee_demographics pending_emp ON m.pending_employee_id = pending_emp.employee_id
            WHERE m.ride_id = ?
            ORDER BY m.report_date DESC, m.maintenance_id DESC
        `;
        const [maintenance_logs] = await pool.query(query, [internalRideId]);

        res.render('maintenance-history', {
            ride: ride,
            maintenance_logs: maintenance_logs,
            ridesListQuery: ridesListQuery
        });
    } catch (error) {
        console.error(error);
        res.status(500).send('Error fetching maintenance history');
    }
});

// GET /maintenance/new/:public_ride_id
// Path changed to /new/:public_ride_id
router.get('/new/:public_ride_id', isAuthenticated, async (req, res) => {
    const { public_ride_id } = req.params; // CHANGED
    const { role, locationId } = req.session.user;

    try {
        const [rideResult] = await pool.query('SELECT ride_id, ride_name, location_id, public_ride_id FROM rides WHERE public_ride_id = ?', [public_ride_id]); // CHANGED
        if (rideResult.length === 0) {
            return res.status(404).send('Ride not found');
        }
        if (role === 'Location Manager' || role === 'Staff') {
            if (rideResult[0].location_id !== locationId) {
                return res.status(403).send('Forbidden: You can only report issues for rides in your location.');
            }
        }
        const ride = rideResult[0]; // This now contains the internal ride_id

        const [employees] = await pool.query(`
            SELECT employee_id, first_name, last_name, employee_type
            FROM employee_demographics
            WHERE employee_type IN ('Maintenance', 'Location Manager', 'Park Manager', 'Admin') AND is_active = TRUE
        `);

        // Pass ride object (with internal ride_id) to the view for the hidden form field
        res.render('add-maintenance', { ride: ride, employees: employees, error: null });
    } catch (error) {
        console.error(error);
        res.status(500).send('Error loading maintenance report page');
    }
});

// POST /maintenance
// Path changed to /
router.post('/', isAuthenticated, async (req, res) => {
    // Note: ride_id is the INTERNAL ID from the hidden form field
    const { ride_id, summary } = req.body;
    const employee_id = req.body.employee_id ? req.body.employee_id : null;
    const { returnQuery } = req.body; // <-- CAPTURE returnQuery from hidden input

    const { role, locationId } = req.session.user;

    let connection;
    let publicRideId;
    try {
        // Fetch ride info (including public_ride_id) based on internal ride_id
        const [rideResult] = await pool.query('SELECT location_id, public_ride_id FROM rides WHERE ride_id = ?', [ride_id]);
        if (rideResult.length === 0) {
            return res.status(404).send('Ride not found.');
        }
        const ride = rideResult[0];
        publicRideId = ride.public_ride_id; // Save for redirect

        if (role === 'Location Manager' || role === 'Staff') {
            if (ride.location_id !== locationId) {
                return res.status(403).send('Forbidden: You can only report issues for rides in your location.');
            }
        }

        connection = await pool.getConnection();
        await connection.beginTransaction();

        const publicMaintenanceId = crypto.randomUUID(); // ADDED

        // ADDED public_maintenance_id
        const maintSql = "INSERT INTO maintenance (public_maintenance_id, ride_id, summary, employee_id, report_date) VALUES (?, ?, ?, ?, CURDATE())";
        await connection.query(maintSql, [publicMaintenanceId, ride_id, summary, employee_id]);

        const rideSql = "UPDATE rides SET ride_status = 'BROKEN' WHERE ride_id = ?";
        await connection.query(rideSql, [ride_id]);

        await connection.commit();
        // Redirect back to the rides list if returnQuery is present, otherwise to the ride's maintenance log
        const redirectUrl = returnQuery ? `/rides?${returnQuery}` : `/maintenance/ride/${publicRideId}`;
        res.redirect(redirectUrl);

    } catch (error) {
        if (connection) await connection.rollback();
        console.error("Error submitting maintenance report:", error);
        try {
            const [rideResult] = await pool.query('SELECT ride_id, ride_name, public_ride_id FROM rides WHERE ride_id = ?', [ride_id]);
            const ride = rideResult.length > 0 ? rideResult[0] : { ride_name: 'Unknown', ride_id: ride_id, public_ride_id: publicRideId };
            const [employees] = await pool.query(`
                SELECT employee_id, first_name, last_name, employee_type
                FROM employee_demographics
                WHERE employee_type IN ('Maintenance', 'Location Manager', 'Park Manager', 'Admin') AND is_active = TRUE
            `);
            res.render('add-maintenance', {
                ride: ride,
                employees: employees,
                error: "Database error submitting report.",
                returnQuery: returnQuery || ''
            });
        } catch (fetchError) {
            console.error("Error fetching data for add maintenance error page:", fetchError);
            res.status(500).send("An error occurred while submitting the report and reloading the page.");
        }
    } finally {
        if (connection) connection.release();
    }
});

// GET /maintenance/complete/:public_maintenance_id
// Path changed to /complete/:public_maintenance_id
router.post('/complete/:public_maintenance_id', isAuthenticated, isMaintenanceOrHigher, async (req, res) => {
    const { public_maintenance_id } = req.params;
    // ride_id is the INTERNAL ID from the hidden form field
    const { ride_id, start_date, end_date, cost, ride_status, summary, returnQuery } = req.body; // <-- CAPTURE returnQuery

    if (!['OPEN', 'CLOSED'].includes(ride_status)) {
        return res.status(400).send('Invalid final ride status provided. Must be OPEN or CLOSED.');
    }

    let connection;
    try {
        // Fetch the public_ride_id for the redirect
        const [rideResult] = await pool.query('SELECT public_ride_id FROM rides WHERE ride_id = ?', [ride_id]);
        if (rideResult.length === 0) {
            return res.status(404).send('Associated ride not found.');
        }
        const publicRideId = rideResult[0].public_ride_id;

        connection = await pool.getConnection();
        await connection.beginTransaction();

        const maintSql = `
            UPDATE maintenance
            SET start_date = ?, end_date = ?, cost = ?, summary = ?
            WHERE public_maintenance_id = ?
        `;
        const costValue = cost === '' ? null : cost;
        await connection.query(maintSql, [start_date, end_date, costValue, summary, public_maintenance_id]);

        const rideSql = "UPDATE rides SET ride_status = ? WHERE ride_id = ?";
        await connection.query(rideSql, [ride_status, ride_id]);

        await connection.commit();
        const redirectQuery = returnQuery ? `?returnQuery=${returnQuery}` : '';
        res.redirect(`/maintenance/ride/${publicRideId}${redirectQuery}`);

    } catch (error) {
        if (connection) await connection.rollback();
        console.error("Error completing maintenance:", error);
        try {
            const query = `
                SELECT m.*, r.ride_name, r.public_ride_id
                FROM maintenance m
                JOIN rides r ON m.ride_id = r.ride_id
                WHERE m.public_maintenance_id = ?
            `;
            const [logResult] = await pool.query(query, [public_maintenance_id]);
            const log = logResult.length > 0 ? logResult[0] : {};
            res.render('complete-maintenance', {
                log: log,
                error: "Database error completing work order.",
                returnQuery: returnQuery || ''
            });
        } catch (fetchError) {
            console.error("Error fetching data for complete maintenance error page:", fetchError);
            res.status(500).send("An error occurred while completing the work order and reloading the page.");
        }
    } finally {
        if (connection) connection.release();
    }
});

// POST /maintenance/complete/:public_maintenance_id
// Path changed to /complete/:public_maintenance_id
router.post('/complete/:public_maintenance_id', isAuthenticated, isMaintenanceOrHigher, async (req, res) => {
    const { public_maintenance_id } = req.params; // CHANGED
    // ride_id is the INTERNAL ID from the hidden form field
    const { ride_id, start_date, end_date, cost, ride_status, summary } = req.body;

    if (!['OPEN', 'CLOSED'].includes(ride_status)) {
        return res.status(400).send('Invalid final ride status provided. Must be OPEN or CLOSED.');
    }

    let connection;
    try {
        // Fetch the public_ride_id for the redirect
        const [rideResult] = await pool.query('SELECT public_ride_id FROM rides WHERE ride_id = ?', [ride_id]);
        if (rideResult.length === 0) {
            return res.status(404).send('Associated ride not found.');
        }
        const publicRideId = rideResult[0].public_ride_id;

        connection = await pool.getConnection();
        await connection.beginTransaction();

        const maintSql = `
            UPDATE maintenance
            SET start_date = ?, end_date = ?, cost = ?, summary = ?
            WHERE public_maintenance_id = ? -- CHANGED
        `;
        const costValue = cost === '' ? null : cost;
        await connection.query(maintSql, [start_date, end_date, costValue, summary, public_maintenance_id]); // CHANGED

        const rideSql = "UPDATE rides SET ride_status = ? WHERE ride_id = ?";
        await connection.query(rideSql, [ride_status, ride_id]); // Use internal ID

        await connection.commit();
        res.redirect(`/maintenance/ride/${publicRideId}`); // CHANGED

    } catch (error) {
        if (connection) await connection.rollback();
        console.error("Error completing maintenance:", error);
        try {
            const query = `
                SELECT m.*, r.ride_name, r.public_ride_id
                FROM maintenance m
                JOIN rides r ON m.ride_id = r.ride_id
                WHERE m.public_maintenance_id = ? -- CHANGED
            `;
            const [logResult] = await pool.query(query, [public_maintenance_id]); // CHANGED
            const log = logResult.length > 0 ? logResult[0] : {};
            res.render('complete-maintenance', {
                log: log,
                error: "Database error completing work order."
            });
        } catch (fetchError) {
            console.error("Error fetching data for complete maintenance error page:", fetchError);
            res.status(500).send("An error occurred while completing the work order and reloading the page.");
        }
    } finally {
        if (connection) connection.release();
    }
});

// GET /maintenance/edit-completion/:public_maintenance_id
// Loads the completion form pre-filled for editing a completed log
router.get('/edit-completion/:public_maintenance_id', isAuthenticated, isMaintenanceOrHigher, async (req, res) => {
    const { public_maintenance_id } = req.params;
    const { returnQuery } = req.query; // <-- CAPTURE returnQuery
    try {
        const query = `
            SELECT m.*, r.ride_name, r.public_ride_id, r.ride_status
            FROM maintenance m
            JOIN rides r ON m.ride_id = r.ride_id
            WHERE m.public_maintenance_id = ?
        `;
        const [logResult] = await pool.query(query, [public_maintenance_id]);
        if (logResult.length === 0) {
            return res.status(404).send('Maintenance log not found');
        }
        const log = logResult[0];

        // If it's not completed, send them back to the history page
        if (!log.end_date) {
            return res.redirect(`/maintenance/ride/${log.public_ride_id}`);
        }

        res.render('complete-maintenance', {
            log: log,
            error: null,
            returnQuery: returnQuery || '' // <-- PASS
        });

    } catch (error) {
        console.error("Error loading edit completion page:", error);
        res.status(500).send('Error loading edit completion work order page');
    }
});

// GET /maintenance/edit/:public_maintenance_id (NEW ROUTE FOR EDITING UNCOMPLETED ENTRY)
router.get('/edit/:public_maintenance_id', isAuthenticated, isMaintenanceOrHigher, async (req, res) => {
    const { public_maintenance_id } = req.params;
    const { returnQuery } = req.query; // <-- CAPTURE returnQuery
    try {
        const [logResult] = await pool.query(
            `SELECT m.*, r.ride_name, r.public_ride_id
             FROM maintenance m
             JOIN rides r ON m.ride_id = r.ride_id
             WHERE m.public_maintenance_id = ?`,
            [public_maintenance_id]
        );
        if (logResult.length === 0) {
            return res.status(404).send('Maintenance log not found');
        }
        const log = logResult[0];

        const [employees] = await pool.query(`
            SELECT employee_id, first_name, last_name, employee_type
            FROM employee_demographics
            WHERE employee_type IN ('Maintenance', 'Location Manager', 'Park Manager', 'Admin') AND is_active = TRUE
        `);

        res.render('add-maintenance', {
            ride: { ride_name: log.ride_name, public_ride_id: log.public_ride_id },
            employees: employees,
            error: null,
            isEdit: true,
            initialSummary: log.summary,
            initialEmployeeId: log.employee_id,
            returnQuery: returnQuery || '' // <-- PASS
        });
    } catch (error) {
        console.error("Error loading edit work order page:", error);
        res.status(500).send('Error loading edit work order page');
    }
});


// GET /maintenance/reassign/:public_maintenance_id
// Path changed to /reassign/:public_maintenance_id
router.get('/reassign/:public_maintenance_id', isAuthenticated, (req, res, next) => {
    const role = req.session.user ? req.session.user.role : null;
    if (role === 'Admin' || role === 'Park Manager' || role === 'Location Manager' || role === 'Maintenance') {
        return next();
    }
    res.status(403).send('Forbidden: You do not have permission to reassign work orders.');
}, async (req, res) => {
    try {
        const { public_maintenance_id } = req.params;
        const { role, locationId } = req.session.user;
        const { returnQuery } = req.query; // <-- CAPTURE returnQuery

        const [logResult] = await pool.query(
            `SELECT m.*, r.ride_name, r.location_id, r.public_ride_id
             FROM maintenance m 
             JOIN rides r ON m.ride_id = r.ride_id 
             WHERE m.public_maintenance_id = ?`,
            [public_maintenance_id]
        );

        if (logResult.length === 0) {
            return res.status(404).send('Maintenance log not found.');
        }
        const log = logResult[0];

        if (role === 'Location Manager' && log.location_id !== locationId) {
            return res.status(403).send('Forbidden: You can only reassign work for rides in your location.');
        }

        const [employees] = await pool.query(
            `SELECT employee_id, first_name, last_name 
             FROM employee_demographics 
             WHERE employee_type = 'Maintenance' AND is_active = TRUE`
        );

        res.render('reassign-maintenance', {
            log: log,
            employees: employees,
            error: null,
            returnQuery: returnQuery || '' // <-- PASS
        });

    } catch (error) {
        console.error("Error loading reassignment page:", error);
        res.status(500).send('Error loading page.');
    }
});

// POST /maintenance/reassign/:public_maintenance_id
router.post('/reassign/:public_maintenance_id', isAuthenticated, (req, res, next) => {
    const role = req.session.user ? req.session.user.role : null;
    if (role === 'Admin' || role === 'Park Manager' || role === 'Location Manager' || role === 'Maintenance') {
        return next();
    }
    res.status(403).send('Forbidden: You do not have permission to reassign work orders.');
}, async (req, res) => {
    const { public_maintenance_id } = req.params;
    // ride_id is the INTERNAL ID from the hidden form field
    const { new_employee_id, ride_id, returnQuery } = req.body; // <-- CAPTURE returnQuery
    const { role, id: actorId, locationId } = req.session.user;

    let publicRideId;
    try {
        // Fetch ride info for permission check and redirect
        const [rideResult] = await pool.query('SELECT location_id, public_ride_id FROM rides WHERE ride_id = ?', [ride_id]);
        if (rideResult.length === 0) {
            return res.status(404).send('Ride not found.');
        }
        const ride = rideResult[0];
        publicRideId = ride.public_ride_id; // Save for redirect

        if (role === 'Location Manager') {
            if (ride.location_id !== locationId) {
                return res.status(403).send('Forbidden: You can only reassign work for rides in your location.');
            }
        }

        if (role === 'Maintenance') {
            await pool.query(
                'UPDATE maintenance SET pending_employee_id = ?, assignment_requested_by = ? WHERE public_maintenance_id = ?',
                [new_employee_id, actorId, public_maintenance_id]
            );
        } else {
            await pool.query(
                'UPDATE maintenance SET employee_id = ?, pending_employee_id = NULL, assignment_requested_by = NULL WHERE public_maintenance_id = ?',
                [new_employee_id, public_maintenance_id]
            );
        }

        const redirectQuery = returnQuery ? `?returnQuery=${returnQuery}` : '';
        res.redirect(`/maintenance/ride/${publicRideId}${redirectQuery}`);

    } catch (error) {
        console.error("Error reassigning maintenance:", error);
        try {
            const [logResult] = await pool.query(
                `SELECT m.*, r.ride_name, r.public_ride_id 
                 FROM maintenance m 
                 JOIN rides r ON m.ride_id = r.ride_id 
                 WHERE m.public_maintenance_id = ?`,
                [public_maintenance_id]
            );
            const [employees] = await pool.query(
                `SELECT employee_id, first_name, last_name 
                 FROM employee_demographics 
                 WHERE employee_type = 'Maintenance' AND is_active = TRUE`
            );
            res.render('reassign-maintenance', {
                log: logResult[0] || { ride_id: ride_id, ride_name: 'Unknown', summary: 'Error', public_ride_id: publicRideId },
                employees: employees,
                error: "Error submitting reassignment.",
                returnQuery: returnQuery || ''
            });
        } catch (fetchError) {
            res.status(500).send("An error occurred while reassigning the work order.");
        }
    }
});

module.exports = router;