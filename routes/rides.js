const express = require('express');
const router = express.Router();
const pool = require('../db');
const crypto = require('crypto');
const {
    isAuthenticated,
    canViewRides,
    isAdminOrParkManager,
    canLogRideRun,
    canViewRideHistory
} = require('../middleware/auth');

// --- RIDE & MAINTENANCE MANAGEMENT ---

// GET /rides (Main rides list)
router.get('/', isAuthenticated, canViewRides, async (req, res) => {
    try {
        const { role, locationId } = req.session.user;

        // --- 1. Get query params ---
        const {
            search, sort, dir, filter_type, filter_status, filter_location
        } = req.query;

        let orderBy = ' ORDER BY r.ride_name ASC';
        let whereClauses = [];
        let params = [];

        // --- 2. Fetch data for filters ---
        const [allLocations] = await pool.query('SELECT location_id, public_location_id, location_name FROM location ORDER BY location_name');
        const [allTypes] = await pool.query('SELECT DISTINCT ride_type FROM rides ORDER BY ride_type');

        const [schemaResult] = await pool.query(
            `SELECT COLUMN_TYPE 
             FROM INFORMATION_SCHEMA.COLUMNS 
             WHERE TABLE_NAME = 'rides' AND COLUMN_NAME = 'ride_status' AND TABLE_SCHEMA = DATABASE()`
        );

        let allStatuses = [];
        if (schemaResult.length > 0) {
            const enumString = schemaResult[0].COLUMN_TYPE;
            const values = enumString.substring(5, enumString.length - 1).replace(/'/g, '').split(',');
            allStatuses = values.map(status => ({ ride_status: status }));
        } else {
            const [distinctStatuses] = await pool.query('SELECT DISTINCT ride_status FROM rides ORDER BY ride_status');
            allStatuses = distinctStatuses;
        }

        // --- 3. Handle Location Manager Scope ---
        if (role === 'Location Manager' || role === 'Staff') {
            whereClauses.push('r.location_id = ?');
            params.push(locationId);
        }

        // --- 4. Handle Search Query ---
        if (search) {
            whereClauses.push(
                '(r.ride_name LIKE ? OR l.location_name LIKE ? OR r.ride_status LIKE ? OR r.ride_type LIKE ?)'
            );
            const searchTerm = `%${search}%`;
            params.push(searchTerm, searchTerm, searchTerm, searchTerm);
        }

        // --- 5. Handle Specific Filters ---
        if (filter_type) {
            whereClauses.push('r.ride_type = ?');
            params.push(filter_type);
        }
        if (filter_status) {
            whereClauses.push('r.ride_status = ?');
            params.push(filter_status);
        }
        if (filter_location) {
            whereClauses.push('r.location_id = ?');
            params.push(filter_location);
        }

        // --- 6. Build and Run Summary Query ---
        let summaryQuery = `
            SELECT
                COUNT(r.ride_id) AS totalRides,
                SUM(CASE WHEN r.ride_status = 'OPEN' THEN 1 ELSE 0 END) AS countOpen,
                SUM(CASE WHEN r.ride_status = 'CLOSED' THEN 1 ELSE 0 END) AS countClosed,
                SUM(CASE WHEN r.ride_status = 'BROKEN' THEN 1 ELSE 0 END) AS countBroken,
                SUM(CASE WHEN r.ride_type = 'Rollercoaster' THEN 1 ELSE 0 END) AS countRollercoaster,
                SUM(CASE WHEN r.ride_type = 'Water Ride' THEN 1 ELSE 0 END) AS countWaterRide,
                SUM(CASE WHEN r.ride_type = 'Flat Ride' THEN 1 ELSE 0 END) AS countFlatRide,
                SUM(CASE WHEN r.ride_type = 'Show' THEN 1 ELSE 0 END) AS countShow,
                SUM(CASE WHEN r.ride_type = 'Other' THEN 1 ELSE 0 END) AS countOther
            FROM rides r
            LEFT JOIN location l ON r.location_id = l.location_id
        `;

        let whereQuery = "";
        if (whereClauses.length > 0) {
            whereQuery = ` WHERE ${whereClauses.join(' AND ')}`;
        }

        const [summaryResult] = await pool.query(summaryQuery + whereQuery, params);
        const counts = summaryResult[0];

        // --- 7. Handle Sort Query ---
        if (sort && dir && (dir === 'asc' || dir === 'desc')) {
            const validSorts = {
                name: 'r.ride_name',
                type: 'r.ride_type',
                location: 'l.location_name',
                status: 'r.ride_status'
            };
            if (validSorts[sort]) {
                orderBy = ` ORDER BY ${validSorts[sort]} ${dir.toUpperCase()}`;
            }
        }

        // --- 8. Build Main Query ---
        let query = `
            SELECT r.*, l.location_name
            FROM rides r
            LEFT JOIN location l ON r.location_id = l.location_id
        `;

        query += whereQuery + orderBy;

        const [rides] = await pool.query(query, params);

        // --- 9. Capture the current query string for Smart Recall ---
        const queryParams = new URLSearchParams(req.query);
        const currentQueryString = queryParams.toString();

        // --- 10. Render with all data ---
        res.render('rides', {
            rides: rides,
            search: search || "",
            currentSort: sort,
            currentDir: dir,
            locations: allLocations,
            types: allTypes,
            statuses: allStatuses,
            filters: {
                type: filter_type || "",
                status: filter_status || "",
                location: filter_location || ""
            },
            counts: counts,
            currentQueryString: currentQueryString,
            success: req.session.success, // ADDED
            error: req.session.error      // ADDED
        });

        // Clear messages after display
        req.session.success = null; // ADDED
        req.session.error = null;   // ADDED

    } catch (error) {
        console.error(error);
        res.status(500).send('Error fetching rides');
    }
});

// GET /rides/new
router.get('/new', isAuthenticated, isAdminOrParkManager, async (req, res) => {
    try {
        const { returnQuery } = req.query;
        const [locations] = await pool.query('SELECT location_id, location_name FROM location');
        res.render('add-ride', { locations: locations, error: null, returnQuery: returnQuery || '' });
    } catch (error) {
        console.error(error);
        res.status(500).send('Error loading add ride page');
    }
});

// POST /rides
router.post('/', isAuthenticated, isAdminOrParkManager, async (req, res) => {
    const { ride_name, ride_type, ride_status, location_id, capacity, min_height, max_weight, returnQuery } = req.body;
    const publicRideId = crypto.randomUUID();
    let connection;
    try {
        connection = await pool.getConnection();
        const sql = `
            INSERT INTO rides (public_ride_id, ride_name, ride_type, ride_status, location_id, capacity, min_height, max_weight)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `;
        await connection.query(sql, [
            publicRideId,
            ride_name, ride_type, ride_status, location_id,
            capacity || null, min_height || null, max_weight || null
        ]);

        req.session.success = 'Ride added successfully.'; // ADDED

        const redirectUrl = returnQuery ? `/rides?${returnQuery}` : '/rides';
        res.redirect(redirectUrl);
    } catch (error) {
        console.error(error);
        const [locations] = await pool.query('SELECT location_id, location_name FROM location');
        res.render('add-ride', {
            locations: locations,
            error: "Database error adding ride. Name might be duplicate.",
            returnQuery: returnQuery || ''
        });
    } finally {
        if (connection) connection.release();
    }
});

// POST /rides/status/:public_ride_id
router.post('/status/:public_ride_id', isAuthenticated, async (req, res) => {
    const { public_ride_id } = req.params;
    const { ride_status, returnQuery } = req.body;
    const { role, locationId } = req.session.user;

    const [schemaResult] = await pool.query(
        `SELECT COLUMN_TYPE 
         FROM INFORMATION_SCHEMA.COLUMNS 
         WHERE TABLE_NAME = 'rides' AND COLUMN_NAME = 'ride_status' AND TABLE_SCHEMA = DATABASE()`
    );

    let validStatuses = [];
    if (schemaResult.length > 0) {
        const enumString = schemaResult[0].COLUMN_TYPE;
        validStatuses = enumString.substring(5, enumString.length - 1).replace(/'/g, '').split(',');
    }

    if (!validStatuses.includes(ride_status)) {
        return res.status(400).send('Invalid ride status provided.');
    }

    let connection;
    try {
        connection = await pool.getConnection();

        let hasPermission = false;
        if (role === 'Admin' || role === 'Park Manager') {
            hasPermission = true;
        } else if (role === 'Location Manager') {
            const [rideLoc] = await pool.query('SELECT location_id FROM rides WHERE public_ride_id = ?', [public_ride_id]);
            if (rideLoc.length > 0 && rideLoc[0].location_id === locationId) {
                hasPermission = true;
            }
        }

        if (!hasPermission) {
            return res.status(403).send('Forbidden: You do not have permission to update this ride.');
        }

        const sql = "UPDATE rides SET ride_status = ? WHERE public_ride_id = ?";
        await connection.query(sql, [ride_status, public_ride_id]);

        // req.session.success = 'Status updated.'; // Optional: feedback for status change

        const redirectUrl = returnQuery ? `/rides?${returnQuery}` : '/rides';
        res.redirect(redirectUrl);

    } catch (error) {
        console.error(error);
        res.status(500).send('Error updating ride status');
    } finally {
        if (connection) connection.release();
    }
});

// GET /rides/log/:public_ride_id
router.get('/log/:public_ride_id', isAuthenticated, canLogRideRun, async (req, res) => {
    const { public_ride_id } = req.params;
    const { role, locationId } = req.session.user;
    const { returnQuery } = req.query;
    let ride;

    try {
        const [rideResult] = await pool.query('SELECT ride_id, ride_name, location_id, capacity, public_ride_id FROM rides WHERE public_ride_id = ?', [public_ride_id]);
        if (rideResult.length === 0) {
            return res.status(404).send('Ride not found');
        }
        ride = rideResult[0];

        if (role === 'Location Manager' || role === 'Staff') {
            if (ride.location_id !== locationId) {
                return res.status(403).send('Forbidden: You can only log runs for rides in your location.');
            }
        }

        res.render('log-ride-run', { ride: ride, error: null, returnQuery: returnQuery || '' });

    } catch (error) {
        console.error("Error loading log ride run page:", error);
        res.render('log-ride-run', {
            ride: ride || { public_ride_id: public_ride_id, ride_name: 'Unknown Ride' },
            error: 'Error loading page. Please try again.',
            returnQuery: returnQuery || ''
        });
    }
});

// POST /rides/run/:public_ride_id
router.post('/run/:public_ride_id', isAuthenticated, canLogRideRun, async (req, res) => {
    const { public_ride_id } = req.params;
    const { rider_count, returnQuery } = req.body;
    const { role, locationId } = req.session.user;
    let connection;
    let ride;

    try {
        connection = await pool.getConnection();

        const [rideResult] = await pool.query('SELECT ride_id, capacity, location_id, ride_name, public_ride_id FROM rides WHERE public_ride_id = ?', [public_ride_id]);
        if (rideResult.length === 0) {
            return res.status(404).send('Ride not found');
        }
        ride = rideResult[0];
        const internalRideId = ride.ride_id;

        if (role === 'Location Manager' || role === 'Staff') {
            if (ride.location_id !== locationId) {
                return res.status(403).send('Forbidden: You can only log runs for rides in your location.');
            }
        }

        const numRiders = parseInt(rider_count, 10);
        const maxCapacity = parseInt(ride.capacity, 10);

        if (isNaN(numRiders) || numRiders < 0) {
            return res.render('log-ride-run', {
                ride: ride,
                error: 'Invalid number of riders submitted.',
                returnQuery: returnQuery || ''
            });
        }

        if (numRiders > maxCapacity) {
            return res.render('log-ride-run', {
                ride: ride,
                error: `Error: Number of riders (${numRiders}) cannot exceed the max capacity of ${maxCapacity}.`,
                returnQuery: returnQuery || ''
            });
        }

        const estimatedRiders = numRiders;
        const today = new Date().toISOString().substring(0, 10);

        await connection.beginTransaction();

        await connection.query(
            'INSERT INTO daily_stats (date_rec, visitor_count) VALUES (?, 0) ON DUPLICATE KEY UPDATE visitor_count = visitor_count',
            [today]
        );

        await connection.query(
            'INSERT INTO daily_ride (ride_id, dat_date, run_count, ride_count) VALUES (?, ?, 1, ?) ON DUPLICATE KEY UPDATE run_count = run_count + 1, ride_count = ride_count + ?',
            [internalRideId, today, estimatedRiders, estimatedRiders]
        );

        await connection.commit();

        req.session.success = 'Ride run logged successfully.'; // ADDED

        const redirectUrl = returnQuery ? `/rides?${returnQuery}` : '/rides';
        res.redirect(redirectUrl);

    } catch (error) {
        if (connection) await connection.rollback();
        console.error("Error logging ride run:", error);

        res.render('log-ride-run', {
            ride: ride || { public_ride_id: public_ride_id, ride_name: 'Unknown Ride', capacity: 0 },
            error: 'Error saving ride data. Please try again.',
            returnQuery: returnQuery || ''
        });
    } finally {
        if (connection) connection.release();
    }
});

// GET /rides/history/:public_ride_id
router.get('/history/:public_ride_id', isAuthenticated, canViewRideHistory, async (req, res) => {
    const { public_ride_id } = req.params;
    const { returnQuery } = req.query;
    const { role, locationId } = req.session.user;
    const today = new Date().toISOString().substring(0, 10);
    let ride;

    try {
        const [rideResult] = await pool.query('SELECT ride_id, ride_name, location_id, capacity, public_ride_id FROM rides WHERE public_ride_id = ?', [public_ride_id]);
        if (rideResult.length === 0) {
            return res.status(404).send('Ride not found');
        }
        ride = rideResult[0];
        const internalRideId = ride.ride_id;

        if ((role === 'Location Manager' || role === 'Staff') && ride.location_id !== locationId) {
            return res.status(403).send('Forbidden: You can only view history for rides in your location.');
        }

        const [todayStatsResult] = await pool.query(
            'SELECT SUM(run_count) as today_runs, SUM(ride_count) as today_riders FROM daily_ride WHERE ride_id = ? AND dat_date = ?',
            [internalRideId, today]
        );
        const todayStats = {
            today_runs: todayStatsResult[0].today_runs || 0,
            today_riders: todayStatsResult[0].today_riders || 0
        };

        const [allTimeStatsResult] = await pool.query(
            'SELECT SUM(run_count) as total_runs, SUM(ride_count) as total_riders FROM daily_ride WHERE ride_id = ?',
            [internalRideId]
        );
        const allTimeStats = {
            total_runs: allTimeStatsResult[0].total_runs || 0,
            total_riders: allTimeStatsResult[0].total_riders || 0
        };

        const [dailyHistory] = await pool.query(
            'SELECT dat_date, run_count, ride_count FROM daily_ride WHERE ride_id = ? ORDER BY dat_date DESC',
            [internalRideId]
        );

        res.render('ride-run-history', {
            ride: ride,
            todayStats: todayStats,
            allTimeStats: allTimeStats,
            dailyHistory: dailyHistory,
            returnQuery: returnQuery || ''
        });

    } catch (error) {
        console.error("Error fetching ride run history:", error);
        res.status(500).send('Error loading ride history page.');
    }
});

router.get('/edit/:public_ride_id', isAuthenticated, isAdminOrParkManager, async (req, res) => {
    const { public_ride_id } = req.params;
    const { returnQuery } = req.query;
    try {
        const [rideResult] = await pool.query('SELECT * FROM rides WHERE public_ride_id = ?', [public_ride_id]);
        if (rideResult.length === 0) {
            return res.status(404).send('Ride not found');
        }
        const ride = rideResult[0];
        const [locations] = await pool.query('SELECT location_id, location_name FROM location ORDER BY location_name');

        res.render('edit-ride', {
            ride: ride,
            locations: locations,
            error: null,
            returnQuery: returnQuery || ''
        });

    } catch (error) {
        console.error("Error loading edit ride page:", error);
        res.status(500).send('Error loading page');
    }
});

router.post('/edit/:public_ride_id', isAuthenticated, isAdminOrParkManager, async (req, res) => {
    const { public_ride_id } = req.params;
    const { ride_name, ride_type, ride_status, location_id, capacity, min_height, max_weight, returnQuery } = req.body;

    try {
        const sql = `
            UPDATE rides 
            SET ride_name = ?, ride_type = ?, ride_status = ?, location_id = ?, 
                capacity = ?, min_height = ?, max_weight = ?
            WHERE public_ride_id = ?
        `;
        await pool.query(sql, [
            ride_name, ride_type, ride_status, location_id,
            capacity || null, min_height || null, max_weight || null,
            public_ride_id
        ]);

        req.session.success = 'Ride details updated.'; // ADDED

        const redirectUrl = returnQuery ? `/rides?${returnQuery}` : '/rides';
        res.redirect(redirectUrl);

    } catch (error) {
        console.error("Error updating ride:", error);
        const [locations] = await pool.query('SELECT location_id, location_name FROM location ORDER BY location_name');
        const [rideResult] = await pool.query('SELECT * FROM rides WHERE public_ride_id = ?', [public_ride_id]);

        res.render('edit-ride', {
            ride: rideResult[0] || req.body,
            locations: locations,
            error: "Database error updating ride. Name might be duplicate.",
            returnQuery: returnQuery || ''
        });
    }
});

// POST /delete/:public_ride_id
// UPDATED: Deletes dependencies first to prevent Foreign Key Errors
router.post('/delete/:public_ride_id', isAuthenticated, isAdminOrParkManager, async (req, res) => {
    const { public_ride_id } = req.params;
    const { returnQuery } = req.body;

    let connection;
    try {
        connection = await pool.getConnection();

        // 1. Get Internal ID
        const [ride] = await connection.query('SELECT ride_id, ride_name FROM rides WHERE public_ride_id = ?', [public_ride_id]);
        if (ride.length === 0) {
            req.session.error = 'Ride not found.';
            const redirectUrl = returnQuery ? `/rides?${returnQuery}` : '/rides';
            return res.redirect(redirectUrl);
        }
        const rideId = ride[0].ride_id;

        // 2. Start Transaction
        await connection.beginTransaction();

        // 3. Delete Dependencies (Order matters!)
        // Delete maintenance logs first
        await connection.query('DELETE FROM maintenance WHERE ride_id = ?', [rideId]);

        // Delete daily_ride history
        await connection.query('DELETE FROM daily_ride WHERE ride_id = ?', [rideId]);

        // 4. Delete Ride
        await connection.query('DELETE FROM rides WHERE ride_id = ?', [rideId]);

        // 5. Commit
        await connection.commit();

        // Set Success Message for the "Custom Alert"
        req.session.success = `Ride "${ride[0].ride_name}" and its history were deleted successfully.`;

        const redirectUrl = returnQuery ? `/rides?${returnQuery}` : '/rides';
        res.redirect(redirectUrl);

    } catch (error) {
        if (connection) await connection.rollback();
        console.error("Error deleting ride:", error);

        // Set Error Message for the "Custom Alert"
        req.session.error = "Error deleting ride. Database constraint error.";

        const redirectUrl = returnQuery ? `/rides?${returnQuery}` : '/rides';
        res.redirect(redirectUrl);
    } finally {
        if (connection) connection.release();
    }
});
module.exports = router;