const express = require('express');
const router = express.Router();
const pool = require('../db'); // Adjust path to db.js
const { 
    isAuthenticated,
    isMaintenanceOrHigher
} = require('../middleware/auth'); // Adjust path to auth.js

// --- MAINTENANCE ROUTES ---

// GET /maintenance/ride/:ride_id
// Path changed to /ride/:ride_id
router.get('/ride/:ride_id', isAuthenticated, (req, res, next) => {
    const role = req.session.user ? req.session.user.role : null;
    if (role === 'Admin' || role === 'Park Manager' || role === 'Maintenance' || role === 'Location Manager') {
        return next();
    }
    res.status(403).send('Forbidden: Access denied.');
}, async (req, res) => {
    const rideId = req.params.ride_id;
    const { role, locationId } = req.session.user;
    let ride;

    try {
        const [rideResult] = await pool.query('SELECT ride_id, ride_name, location_id FROM rides WHERE ride_id = ?', [rideId]);
        if (rideResult.length === 0) {
            return res.status(404).send('Ride not found');
        }
        ride = rideResult[0];
        
        if (role === 'Location Manager') {
            if (ride.location_id !== locationId) {
                return res.status(403).send('Forbidden: You can only view maintenance for rides in your location.');
            }
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
        const [maintenance_logs] = await pool.query(query, [rideId]);
        
        // This is a guess, but let's assume you've updated maintenance-history.ejs
        // If not, the pending_employee_name field might not be used, but it's good to have.
        res.render('maintenance-history', { ride: ride, maintenance_logs: maintenance_logs });
    } catch (error) {
        console.error(error);
        res.status(500).send('Error fetching maintenance history');
    }
});

// GET /maintenance/new/:ride_id
// Path changed to /new/:ride_id
router.get('/new/:ride_id', isAuthenticated, async (req, res) => {
    const rideId = req.params.ride_id;
    const { role, locationId } = req.session.user;

    try {
        const [rideResult] = await pool.query('SELECT ride_id, ride_name, location_id FROM rides WHERE ride_id = ?', [rideId]);
        if (rideResult.length === 0) {
            return res.status(404).send('Ride not found');
        }
        if (role === 'Location Manager' || role === 'Staff') {
            if (rideResult[0].location_id !== locationId) {
                return res.status(403).send('Forbidden: You can only report issues for rides in your location.');
            }
        }
        const ride = rideResult[0];

        const [employees] = await pool.query(`
            SELECT employee_id, first_name, last_name, employee_type
            FROM employee_demographics
            WHERE employee_type IN ('Maintenance', 'Manager', 'Admin') AND is_active = TRUE
        `);

        res.render('add-maintenance', { ride: ride, employees: employees, error: null });
    } catch (error) {
        console.error(error);
        res.status(500).send('Error loading maintenance report page');
    }
});

// POST /maintenance
// Path changed to /
router.post('/', isAuthenticated, async (req, res) => {
    const { ride_id, summary } = req.body;
    const employee_id = req.body.employee_id ? req.body.employee_id : null;

    const { role, locationId } = req.session.user;

    let connection;
    try {
        if (role === 'Location Manager' || role === 'Staff') {
            const [rideLoc] = await pool.query('SELECT location_id FROM rides WHERE ride_id = ?', [ride_id]);
            if (rideLoc.length === 0) {
                return res.status(404).send('Ride not found.');
            }
            if (rideLoc[0].location_id !== locationId) {
                return res.status(403).send('Forbidden: You can only report issues for rides in your location.');
            }
        }
        
        connection = await pool.getConnection();
        await connection.beginTransaction();

        const maintSql = "INSERT INTO maintenance (ride_id, summary, employee_id, report_date) VALUES (?, ?, ?, CURDATE())";
        await connection.query(maintSql, [ride_id, summary, employee_id]);

        const rideSql = "UPDATE rides SET ride_status = 'BROKEN' WHERE ride_id = ?";
        await connection.query(rideSql, [ride_id]);

        await connection.commit();
        if (['Admin', 'Park Manager', 'Location Manager', 'Maintenance'].includes(req.session.user.role)) {
            res.redirect(`/maintenance/ride/${ride_id}`);
        } else {
            res.redirect('/rides');
        }

    } catch (error) {
        if (connection) await connection.rollback();
        console.error("Error submitting maintenance report:", error);
        try {
            const [rideResult] = await pool.query('SELECT ride_id, ride_name FROM rides WHERE ride_id = ?', [ride_id]);
            const ride = rideResult.length > 0 ? rideResult[0] : { ride_name: 'Unknown' };
            const [employees] = await pool.query(`
                SELECT employee_id, first_name, last_name, employee_type
                FROM employee_demographics
                WHERE employee_type IN ('Maintenance', 'Manager', 'Admin') AND is_active = TRUE
            `);
            res.render('add-maintenance', {
                ride: ride,
                employees: employees,
                error: "Database error submitting report."
            });
        } catch (fetchError) {
            console.error("Error fetching data for add maintenance error page:", fetchError);
            res.status(500).send("An error occurred while submitting the report and reloading the page.");
        }
    } finally {
        if (connection) connection.release();
    }
});

// GET /maintenance/complete/:maintenance_id
// Path changed to /complete/:maintenance_id
router.get('/complete/:maintenance_id', isAuthenticated, isMaintenanceOrHigher, async (req, res) => {
    const maintenanceId = req.params.maintenance_id;
    try {
        const query = `
            SELECT m.*, r.ride_name
            FROM maintenance m
            JOIN rides r ON m.ride_id = r.ride_id
            WHERE m.maintenance_id = ?
        `;
        const [logResult] = await pool.query(query, [maintenanceId]);
        if (logResult.length === 0) {
            return res.status(404).send('Maintenance log not found');
        }
        const log = logResult[0];

        if (log.end_date) {
            return res.redirect(`/maintenance/ride/${log.ride_id}`);
        }

        res.render('complete-maintenance', { log: log, error: null });
    } catch (error) {
        console.error(error);
        res.status(500).send('Error loading complete work order page');
    }
});

// POST /maintenance/complete/:maintenance_id
// Path changed to /complete/:maintenance_id
router.post('/complete/:maintenance_id', isAuthenticated, isMaintenanceOrHigher, async (req, res) => {
    const maintenanceId = req.params.maintenance_id;
    const { ride_id, start_date, end_date, cost, ride_status, summary } = req.body;

    if (!['OPEN', 'CLOSED'].includes(ride_status)) {
        return res.status(400).send('Invalid final ride status provided. Must be OPEN or CLOSED.');
    }

    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        const maintSql = `
            UPDATE maintenance
            SET start_date = ?, end_date = ?, cost = ?, summary = ?
            WHERE maintenance_id = ?
        `;
        const costValue = cost === '' ? null : cost;
        await connection.query(maintSql, [start_date, end_date, costValue, summary, maintenanceId]);

        const rideSql = "UPDATE rides SET ride_status = ? WHERE ride_id = ?";
        await connection.query(rideSql, [ride_status, ride_id]);

        await connection.commit();
        res.redirect(`/maintenance/ride/${ride_id}`);

    } catch (error) {
        if (connection) await connection.rollback();
        console.error("Error completing maintenance:", error);
        try {
            const query = `
                SELECT m.*, r.ride_name
                FROM maintenance m
                JOIN rides r ON m.ride_id = r.ride_id
                WHERE m.maintenance_id = ?
            `;
            const [logResult] = await pool.query(query, [maintenanceId]);
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

// GET /maintenance/reassign/:maintenance_id
// Path changed to /reassign/:maintenance_id
router.get('/reassign/:maintenance_id', isAuthenticated, (req, res, next) => {
    const role = req.session.user ? req.session.user.role : null;
    if (role === 'Admin' || role === 'Park Manager' || role === 'Location Manager' || role === 'Maintenance') {
        return next();
    }
    res.status(403).send('Forbidden: You do not have permission to reassign work orders.');
}, async (req, res) => {
    try {
        const { maintenance_id } = req.params;
        const { role, locationId } = req.session.user;

        const [logResult] = await pool.query(
            `SELECT m.*, r.ride_name, r.location_id 
             FROM maintenance m 
             JOIN rides r ON m.ride_id = r.ride_id 
             WHERE m.maintenance_id = ?`,
            [maintenance_id]
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
            error: null
        });

    } catch (error) {
        console.error("Error loading reassignment page:", error);
        res.status(500).send('Error loading page.');
    }
});

// POST /maintenance/reassign/:maintenance_id
// Path changed to /reassign/:maintenance_id
router.post('/reassign/:maintenance_id', isAuthenticated, (req, res, next) => {
    const role = req.session.user ? req.session.user.role : null;
    if (role === 'Admin' || role === 'Park Manager' || role === 'Location Manager' || role === 'Maintenance') {
        return next();
    }
    res.status(403).send('Forbidden: You do not have permission to reassign work orders.');
}, async (req, res) => {
    const { maintenance_id } = req.params;
    const { new_employee_id, ride_id } = req.body;
    const { role, id: actorId, locationId } = req.session.user;

    try {
        if (role === 'Location Manager') {
            const [rideLoc] = await pool.query('SELECT location_id FROM rides WHERE ride_id = ?', [ride_id]);
            if (rideLoc.length === 0 || rideLoc[0].location_id !== locationId) {
                return res.status(403).send('Forbidden: You can only reassign work for rides in your location.');
            }
        }

        if (role === 'Maintenance') {
            await pool.query(
                'UPDATE maintenance SET pending_employee_id = ?, assignment_requested_by = ? WHERE maintenance_id = ?',
                [new_employee_id, actorId, maintenance_id]
            );
        } else {
            await pool.query(
                'UPDATE maintenance SET employee_id = ?, pending_employee_id = NULL, assignment_requested_by = NULL WHERE maintenance_id = ?',
                [new_employee_id, maintenance_id]
            );
        }

        res.redirect(`/maintenance/ride/${ride_id}`);

    } catch (error) {
        console.error("Error reassigning maintenance:", error);
        try {
            const [logResult] = await pool.query(
                `SELECT m.*, r.ride_name 
                 FROM maintenance m 
                 JOIN rides r ON m.ride_id = r.ride_id 
                 WHERE m.maintenance_id = ?`,
                [maintenance_id]
            );
            const [employees] = await pool.query(
                `SELECT employee_id, first_name, last_name 
                 FROM employee_demographics 
                 WHERE employee_type = 'Maintenance' AND is_active = TRUE`
            );
            res.render('reassign-maintenance', {
                log: logResult[0] || { ride_id: ride_id, ride_name: 'Unknown', summary: 'Error' },
                employees: employees,
                error: "Error submitting reassignment."
            });
        } catch (fetchError) {
            res.status(500).send("An error occurred while reassigning the work order.");
        }
    }
});

module.exports = router;