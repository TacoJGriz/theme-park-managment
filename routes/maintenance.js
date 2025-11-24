const express = require('express');
const router = express.Router();
const pool = require('../db');
const crypto = require('crypto');
const {
    isAuthenticated,
    isMaintenanceOrHigher,
    canManageMaintenance,
    isAdminOrParkManager
} = require('../middleware/auth');

// get maintenance history for a ride
router.get('/ride/:public_ride_id', isAuthenticated, (req, res, next) => {
    const role = req.session.user ? req.session.user.role : null;
    if (role === 'Admin' || role === 'Park Manager' || role === 'Maintenance' || role === 'Location Manager') {
        return next();
    }
    res.status(403).send('Forbidden: Access denied.');
}, async (req, res) => {
    const {
        public_ride_id
    } = req.params;
    const {
        role,
        locationId
    } = req.session.user;

    const ridesListQuery = req.query.returnQuery || '';
    let ride;

    try {
        const [rideResult] = await pool.query('SELECT ride_id, ride_name, location_id, public_ride_id FROM rides WHERE public_ride_id = ?', [public_ride_id]);
        if (rideResult.length === 0) {
            return res.status(404).send('Ride not found');
        }
        ride = rideResult[0];
        const internalRideId = ride.ride_id;

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
            ride,
            maintenance_logs,
            ridesListQuery
        });
    } catch (error) {
        console.error(error);
        res.status(500).send('Error fetching maintenance history');
    }
});

// form to create new maintenance ticket
router.get('/new/:public_ride_id', isAuthenticated, async (req, res) => {
    const {
        public_ride_id
    } = req.params;
    const {
        returnQuery
    } = req.query;
    const {
        role,
        locationId
    } = req.session.user;

    try {
        const [rideResult] = await pool.query('SELECT ride_id, ride_name, location_id, public_ride_id FROM rides WHERE public_ride_id = ?', [public_ride_id]);
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
            WHERE employee_type IN ('Maintenance', 'Location Manager', 'Park Manager', 'Admin') AND is_active = TRUE
        `);

        res.render('add-maintenance', {
            ride,
            employees,
            error: null,
            returnQuery: returnQuery || ''
        });
    } catch (error) {
        console.error(error);
        res.status(500).send('Error loading maintenance report page');
    }
});

// create ticket and auto-assign staff
router.post('/', isAuthenticated, async (req, res) => {
    const {
        ride_id,
        summary,
        report_date,
        returnQuery
    } = req.body;
    const {
        role,
        locationId
    } = req.session.user;

    let connection;
    let publicRideId;

    try {
        const [rideResult] = await pool.query('SELECT location_id, public_ride_id FROM rides WHERE ride_id = ?', [ride_id]);
        if (rideResult.length === 0) {
            return res.status(404).send('Ride not found.');
        }
        const ride = rideResult[0];
        publicRideId = ride.public_ride_id;

        if (role === 'Location Manager' || role === 'Staff') {
            if (ride.location_id !== locationId) {
                return res.status(403).send('Forbidden: You can only report issues for rides in your location.');
            }
        }

        connection = await pool.getConnection();
        await connection.beginTransaction();

        // find staff with fewest active tickets
        const [bestStaff] = await connection.query(`
            SELECT e.employee_id
            FROM employee_demographics e
            LEFT JOIN maintenance m ON e.employee_id = m.employee_id AND m.end_date IS NULL
            WHERE e.employee_type = 'Maintenance' AND e.is_active = TRUE
            GROUP BY e.employee_id
            ORDER BY COUNT(m.maintenance_id) ASC, RAND()
            LIMIT 1
        `);

        const assignedEmployeeId = (bestStaff.length > 0) ? bestStaff[0].employee_id : null;

        const publicMaintenanceId = crypto.randomUUID();
        const maintSql = "INSERT INTO maintenance (public_maintenance_id, ride_id, summary, employee_id, report_date) VALUES (?, ?, ?, ?, ?)";

        // use provided date or fallback to DB default
        const finalReportDate = report_date || new Date();

        await connection.query(maintSql, [publicMaintenanceId, ride_id, summary, assignedEmployeeId, finalReportDate]);

        const rideSql = "UPDATE rides SET ride_status = 'BROKEN' WHERE ride_id = ?";
        await connection.query(rideSql, [ride_id]);

        await connection.commit();
        const redirectUrl = returnQuery ? `/rides?${returnQuery}` : `/maintenance/ride/${publicRideId}`;
        res.redirect(redirectUrl);

    } catch (error) {
        if (connection) await connection.rollback();
        console.error("Error submitting maintenance report:", error);

        const [rideResult] = await pool.query('SELECT ride_id, ride_name, public_ride_id FROM rides WHERE ride_id = ?', [ride_id]);
        const rideObj = rideResult.length > 0 ? rideResult[0] : {
            ride_name: 'Unknown',
            ride_id: ride_id,
            public_ride_id: publicRideId
        };

        res.render('add-maintenance', {
            ride: rideObj,
            isEdit: false,
            error: "Database error submitting report.",
            returnQuery: returnQuery || ''
        });
    } finally {
        if (connection) connection.release();
    }
});

// form to mark maintenance as complete
router.get('/complete/:public_maintenance_id', isAuthenticated, isMaintenanceOrHigher, async (req, res) => {
    const {
        public_maintenance_id
    } = req.params;
    const {
        returnQuery
    } = req.query;
    const {
        role,
        locationId
    } = req.session.user;

    try {
        const query = `
            SELECT m.*, r.ride_name, r.ride_status, r.public_ride_id, r.location_id
            FROM maintenance m
            JOIN rides r ON m.ride_id = r.ride_id
            WHERE m.public_maintenance_id = ?
        `;
        const [logResult] = await pool.query(query, [public_maintenance_id]);

        if (logResult.length === 0) {
            return res.status(404).send('Maintenance log not found');
        }
        const log = logResult[0];

        if (role === 'Location Manager' && log.location_id !== locationId) {
            return res.status(403).send('Forbidden: You can only manage rides in your location.');
        }

        res.render('complete-maintenance', {
            log,
            error: null,
            returnQuery: returnQuery || ''
        });

    } catch (error) {
        console.error("Error loading complete page:", error);
        res.status(500).send('Error loading page');
    }
});

// process maintenance completion
router.post('/complete/:public_maintenance_id', isAuthenticated, isMaintenanceOrHigher, async (req, res) => {
    const {
        public_maintenance_id
    } = req.params;
    const {
        ride_id,
        start_date,
        end_date,
        cost,
        ride_status,
        summary,
        returnQuery
    } = req.body;

    if (!['OPEN', 'CLOSED'].includes(ride_status)) {
        return res.status(400).send('Invalid final ride status provided. Must be OPEN or CLOSED.');
    }

    let connection;
    try {
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
                log,
                error: "Database error completing work order. Ensure 'Work Started' date is not before the 'Reported' date.",
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

// form to edit a previously completed ticket
router.get('/edit-completion/:public_maintenance_id', isAuthenticated, canManageMaintenance, async (req, res) => {
    const {
        public_maintenance_id
    } = req.params;
    const {
        returnQuery
    } = req.query;
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

        if (!log.end_date) {
            return res.redirect(`/maintenance/ride/${log.public_ride_id}`);
        }

        res.render('complete-maintenance', {
            log,
            error: null,
            returnQuery: returnQuery || ''
        });

    } catch (error) {
        console.error("Error loading edit completion page:", error);
        res.status(500).send('Error loading edit completion work order page');
    }
});

// form to edit an active ticket
router.get('/edit/:public_maintenance_id', isAuthenticated, canManageMaintenance, async (req, res) => {
    const {
        public_maintenance_id
    } = req.params;
    const {
        returnQuery
    } = req.query;
    try {
        const [logResult] = await pool.query(
            `SELECT m.*, r.ride_name, r.public_ride_id,
                    CONCAT(e.first_name, ' ', e.last_name) as employee_name
             FROM maintenance m
             JOIN rides r ON m.ride_id = r.ride_id
             LEFT JOIN employee_demographics e ON m.employee_id = e.employee_id
             WHERE m.public_maintenance_id = ?`,
            [public_maintenance_id]
        );
        if (logResult.length === 0) {
            return res.status(404).send('Maintenance log not found');
        }
        const log = logResult[0];

        res.render('add-maintenance', {
            ride: {
                ride_name: log.ride_name,
                public_ride_id: log.public_ride_id
            },
            maintenance: log,
            error: null,
            isEdit: true,
            returnQuery: returnQuery || ''
        });
    } catch (error) {
        console.error("Error loading edit work order page:", error);
        res.status(500).send('Error loading edit work order page');
    }
});

// update existing ticket
router.post('/edit/:public_maintenance_id', isAuthenticated, canManageMaintenance, async (req, res) => {
    const {
        public_maintenance_id
    } = req.params;
    const {
        summary,
        returnQuery
    } = req.body;

    try {
        const [ticket] = await pool.query(`
            SELECT r.public_ride_id 
            FROM maintenance m 
            JOIN rides r ON m.ride_id = r.ride_id 
            WHERE m.public_maintenance_id = ?
        `, [public_maintenance_id]);

        if (ticket.length === 0) return res.status(404).send("Ticket not found");

        await pool.query('UPDATE maintenance SET summary = ? WHERE public_maintenance_id = ?', [summary, public_maintenance_id]);

        const redirectUrl = returnQuery ? `/rides?${returnQuery}` : `/maintenance/ride/${ticket[0].public_ride_id}`;
        res.redirect(redirectUrl);

    } catch (error) {
        console.error("Error updating maintenance ticket:", error);
        res.status(500).send("Error updating ticket.");
    }
});

// reassign staff form
router.get('/reassign/:public_maintenance_id', isAuthenticated, (req, res, next) => {
    const role = req.session.user ? req.session.user.role : null;
    if (role === 'Admin' || role === 'Park Manager' || role === 'Location Manager' || role === 'Maintenance') {
        return next();
    }
    res.status(403).send('Forbidden: You do not have permission to reassign work orders.');
}, async (req, res) => {
    try {
        const {
            public_maintenance_id
        } = req.params;
        const {
            role,
            locationId
        } = req.session.user;
        const {
            returnQuery
        } = req.query;

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
            log,
            employees,
            error: null,
            returnQuery: returnQuery || ''
        });

    } catch (error) {
        console.error("Error loading reassignment page:", error);
        res.status(500).send('Error loading page.');
    }
});

// process reassignment
router.post('/reassign/:public_maintenance_id', isAuthenticated, (req, res, next) => {
    const role = req.session.user ? req.session.user.role : null;
    if (role === 'Admin' || role === 'Park Manager' || role === 'Location Manager' || role === 'Maintenance') {
        return next();
    }
    res.status(403).send('Forbidden: You do not have permission to reassign work orders.');
}, async (req, res) => {
    const {
        public_maintenance_id
    } = req.params;
    const {
        new_employee_id,
        ride_id,
        returnQuery
    } = req.body;
    const {
        role,
        id: actorId,
        locationId
    } = req.session.user;

    let publicRideId;
    try {
        const [rideResult] = await pool.query('SELECT location_id, public_ride_id FROM rides WHERE ride_id = ?', [ride_id]);
        if (rideResult.length === 0) {
            return res.status(404).send('Ride not found.');
        }
        const ride = rideResult[0];
        publicRideId = ride.public_ride_id;

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
                log: logResult[0] || {
                    ride_id: ride_id,
                    ride_name: 'Unknown',
                    summary: 'Error',
                    public_ride_id: publicRideId
                },
                employees,
                error: "Error submitting reassignment.",
                returnQuery: returnQuery || ''
            });
        } catch (fetchError) {
            res.status(500).send("An error occurred while reassigning the work order.");
        }
    }
});

// reopen ticket form
router.get('/reopen/:public_maintenance_id', isAuthenticated, canManageMaintenance, async (req, res) => {
    const {
        public_maintenance_id
    } = req.params;
    const {
        returnQuery
    } = req.query;

    try {
        const query = `
            SELECT m.*, r.ride_name, r.public_ride_id
            FROM maintenance m
            JOIN rides r ON m.ride_id = r.ride_id
            WHERE m.public_maintenance_id = ?
        `;
        const [logResult] = await pool.query(query, [public_maintenance_id]);

        if (logResult.length === 0) {
            return res.status(404).send('Maintenance log not found');
        }

        res.render('reopen-maintenance', {
            log: logResult[0],
            returnQuery: returnQuery || ''
        });
    } catch (error) {
        console.error("Error loading reopen page:", error);
        res.status(500).send('Error loading page');
    }
});

// process ticket reopen
router.post('/reopen/:public_maintenance_id', isAuthenticated, canManageMaintenance, async (req, res) => {
    const {
        public_maintenance_id
    } = req.params;
    const {
        summary,
        cost,
        returnQuery
    } = req.body;
    const {
        role,
        locationId
    } = req.session.user;

    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        const [ticket] = await connection.query(`
            SELECT m.maintenance_id, m.ride_id, r.location_id, r.public_ride_id
            FROM maintenance m
            JOIN rides r ON m.ride_id = r.ride_id
            WHERE m.public_maintenance_id = ?
        `, [public_maintenance_id]);

        if (ticket.length === 0) throw new Error("Maintenance ticket not found.");
        const {
            maintenance_id,
            ride_id,
            location_id,
            public_ride_id
        } = ticket[0];

        if (role === 'Location Manager' && location_id !== locationId) {
            throw new Error("Forbidden: You cannot manage tickets for other locations.");
        }

        const [bestStaff] = await connection.query(`
            SELECT e.employee_id
            FROM employee_demographics e
            LEFT JOIN maintenance m ON e.employee_id = m.employee_id AND m.end_date IS NULL
            WHERE e.employee_type = 'Maintenance' AND e.is_active = TRUE
            GROUP BY e.employee_id
            ORDER BY COUNT(m.maintenance_id) ASC, RAND()
            LIMIT 1
        `);

        const newAssigneeId = (bestStaff.length > 0) ? bestStaff[0].employee_id : null;

        await connection.query(`
            UPDATE maintenance 
            SET end_date = NULL, employee_id = ?, summary = ?, cost = ?
            WHERE maintenance_id = ?
        `, [newAssigneeId, summary, cost || null, maintenance_id]);

        await connection.query(`
            UPDATE rides SET ride_status = 'BROKEN' WHERE ride_id = ?
        `, [ride_id]);

        await connection.commit();

        const redirectUrl = returnQuery ? `/rides?${returnQuery}` : `/maintenance/ride/${public_ride_id}`;
        res.redirect(redirectUrl);

    } catch (error) {
        if (connection) await connection.rollback();
        console.error("Error reopening ticket:", error);
        res.status(500).send(`Error reopening ticket: ${error.message}`);
    } finally {
        if (connection) connection.release();
    }
});

module.exports = router;