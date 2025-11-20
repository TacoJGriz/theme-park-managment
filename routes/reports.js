const express = require('express');
const router = express.Router();
const pool = require('../db'); // Adjust path to db.js
const {
    isAuthenticated,
    canViewReports,
    getReportSettings
} = require('../middleware/auth'); // Adjust path to auth.js

// GET /reports/attendance
router.get('/attendance', isAuthenticated, canViewReports, async (req, res) => {
    try {
        const [membershipTypes] = await pool.query('SELECT type_id, type_name FROM membership_type WHERE is_active = TRUE ORDER BY type_name');
        const [locations] = await pool.query('SELECT location_id, location_name FROM location ORDER BY location_name');
        const [ticketTypes] = await pool.query('SELECT ticket_type_id, type_name FROM ticket_types WHERE is_active = TRUE AND is_member_type = FALSE ORDER BY base_price DESC');
        const defaultDate = new Date().toISOString().substring(0, 10);

        res.render('attendance-report', {
            membership_types: membershipTypes,
            locations: locations,
            ticket_types: ticketTypes,
            selected_date: defaultDate,
            grouping: 'day',
            membership_type_id: 'all',
            location_id: 'all',
            ticket_type_id: 'all',
            attendance_data: null,
            labelFormat: 'Time Period',
            error: null
        });
    } catch (error) {
        console.error("Error loading attendance report page:", error);
        res.render('attendance-report', {
            membership_types: [],
            locations: [],
            ticket_types: [],
            selected_date: new Date().toISOString().substring(0, 10),
            grouping: 'day',
            membership_type_id: 'all',
            location_id: 'all',
            ticket_type_id: 'all',
            attendance_data: null,
            labelFormat: 'Time Period',
            error: 'Error loading page setup data. Please try again.'
        });
    }
});

// POST /reports/attendance
router.post('/attendance', isAuthenticated, canViewReports, async (req, res) => {
    const { selected_date, grouping, membership_type_id, location_id, ticket_type_id } = req.body;
    let membershipTypes = [];
    let locations = [];
    let ticketTypes = [];

    try {
        [membershipTypes] = await pool.query('SELECT type_id, type_name FROM membership_type WHERE is_active = TRUE ORDER BY type_name');
        [locations] = await pool.query('SELECT location_id, location_name FROM location ORDER BY location_name');
        [ticketTypes] = await pool.query('SELECT ticket_type_id, type_name FROM ticket_types WHERE is_active = TRUE AND is_member_type = FALSE ORDER BY base_price DESC');

        const { startDate, endDate, sqlDateFormat, labelFormat } = getReportSettings(selected_date, grouping);

        let reportQuery = `
            SELECT
                DATE_FORMAT(v.visit_date, ?) as report_interval,
                COUNT(v.visit_id) as total_count
            FROM visits v
        `;
        let joinClause = `
            LEFT JOIN employee_demographics e ON v.logged_by_employee_id = e.employee_id
            LEFT JOIN location l ON e.location_id = l.location_id
            LEFT JOIN membership m ON v.membership_id = m.membership_id
            LEFT JOIN membership_type mt ON m.type_id = mt.type_id
            LEFT JOIN ticket_types tt ON v.ticket_type_id = tt.ticket_type_id 
        `;
        let whereClause = ' WHERE DATE(v.visit_date) BETWEEN ? AND ? ';
        let params = [sqlDateFormat, startDate, endDate];

        if (membership_type_id === 'non-member') {
            whereClause += 'AND v.membership_id IS NULL ';
        } else if (membership_type_id !== 'all') {
            whereClause += 'AND m.type_id = ? ';
            params.push(membership_type_id);
        }
        if (location_id && location_id !== 'all') {
            whereClause += 'AND l.location_id = ? ';
            params.push(location_id);
        }
        if (ticket_type_id && ticket_type_id !== 'all') {
            whereClause += 'AND v.ticket_type_id = ? ';
            params.push(ticket_type_id);
        }

        reportQuery += joinClause + whereClause + ' GROUP BY report_interval ORDER BY report_interval';
        const [reportData] = await pool.query(reportQuery, params);

        // Spike Detection
        const totalSum = reportData.reduce((sum, row) => sum + row.total_count, 0);
        const mean = reportData.length > 0 ? totalSum / reportData.length : 0;
        const variance = reportData.reduce((sum, row) => {
            const diff = row.total_count - mean;
            return sum + (diff * diff);
        }, 0) / (reportData.length || 1);
        const stdDev = Math.sqrt(variance);
        const Z_SCORE_THRESHOLD = 1.25;

        const chartData = reportData.map(row => {
            let isSpike = false;
            let zScore = 0;
            if (stdDev > 0) {
                zScore = (row.total_count - mean) / stdDev;
            }
            if (zScore >= Z_SCORE_THRESHOLD && reportData.length > 3) {
                isSpike = true;
            }
            return {
                label: row.report_interval,
                count: row.total_count,
                isSpike: isSpike,
                zScore: zScore.toFixed(1)
            };
        });

        res.render('attendance-report', {
            membership_types: membershipTypes,
            locations: locations,
            ticket_types: ticketTypes,
            selected_date: selected_date,
            grouping: grouping,
            membership_type_id: membership_type_id,
            location_id: location_id,
            ticket_type_id: ticket_type_id,
            attendance_data: chartData,
            labelFormat: labelFormat,
            error: null
        });
    } catch (error) {
        console.error("Error generating attendance report:", error);
        try {
            [membershipTypes] = await pool.query('SELECT type_id, type_name FROM membership_type WHERE is_active = TRUE ORDER BY type_name');
            [locations] = await pool.query('SELECT location_id, location_name FROM location ORDER BY location_name');
            [ticketTypes] = await pool.query('SELECT ticket_type_id, type_name FROM ticket_types WHERE is_active = TRUE AND is_member_type = FALSE ORDER BY base_price DESC');
        } catch (e) { }
        res.render('attendance-report', {
            membership_types: membershipTypes,
            locations: locations,
            ticket_types: ticketTypes,
            selected_date: selected_date,
            grouping: grouping,
            membership_type_id: membership_type_id,
            location_id: location_id,
            ticket_type_id: ticket_type_id,
            attendance_data: null,
            labelFormat: 'Time Period',
            error: `Error generating report: ${error.message}`
        });
    }
});

// --- GET /reports/visit-log ---
router.get('/visit-log', isAuthenticated, canViewReports, async (req, res) => {
    const { grouping, interval, mem_type, loc_id, ticket_id, back_query } = req.query;
    if (!grouping || !interval) {
        return res.status(400).send('Missing required report parameters.');
    }
    try {
        let whereClause = ' WHERE 1=1 ';
        let params = [];

        if (grouping === 'day') {
            const dateHour = interval.trim();
            const nextHour = new Date(dateHour);
            nextHour.setHours(nextHour.getHours() + 1);
            const nextHourString = nextHour.toISOString().replace('T', ' ').substring(0, 19);
            whereClause += 'AND v.visit_date >= ? AND v.visit_date < ? ';
            params.push(dateHour + ':00', nextHourString);
        } else if (grouping === 'week' || grouping === 'month') {
            const date = interval.trim();
            const nextDay = new Date(date);
            nextDay.setDate(nextDay.getDate() + 1);
            const nextDayString = nextDay.toISOString().substring(0, 10);
            whereClause += 'AND DATE(v.visit_date) >= ? AND DATE(v.visit_date) < ? ';
            params.push(date, nextDayString);
        } else if (grouping === 'year') {
            const [year, month] = interval.split('-');
            const startDate = `${year}-${month}-01`;
            const nextMonthInt = parseInt(month, 10) === 12 ? 1 : parseInt(month, 10) + 1;
            const nextYear = parseInt(month, 10) === 12 ? parseInt(year) + 1 : parseInt(year);
            const endDate = `${nextYear}-${String(nextMonthInt).padStart(2, '0')}-01`;
            whereClause += 'AND v.visit_date >= ? AND v.visit_date < ? ';
            params.push(startDate, endDate);
        }

        if (mem_type === 'non-member') whereClause += 'AND v.membership_id IS NULL ';
        else if (mem_type !== 'all') { whereClause += 'AND m.type_id = ? '; params.push(mem_type); }

        if (loc_id && loc_id !== 'all') { whereClause += 'AND l.location_id = ? '; params.push(loc_id); }

        if (ticket_id && ticket_id !== 'all') { whereClause += 'AND v.ticket_type_id = ? '; params.push(ticket_id); }

        const logQuery = `
            SELECT v.visit_id, v.visit_date, v.ticket_price, v.discount_amount, tt.type_name AS ticket_type,
                COALESCE(CONCAT(m.first_name, ' ', m.last_name), 'Day Guest') AS visitor_name,
                COALESCE(m.public_membership_id, 'N/A') AS member_id,
                COALESCE(CONCAT(e.first_name, ' ', e.last_name), 'System') AS logged_by_employee
            FROM visits v
            LEFT JOIN ticket_types tt ON v.ticket_type_id = tt.ticket_type_id
            LEFT JOIN membership m ON v.membership_id = m.membership_id
            LEFT JOIN employee_demographics e ON v.logged_by_employee_id = e.employee_id
            LEFT JOIN location l ON e.location_id = l.location_id
            ${whereClause}
            ORDER BY v.visit_date ASC
        `;
        const [visitLogs] = await pool.query(logQuery, params);
        res.render('visit-detail-log', {
            visitLogs: visitLogs,
            grouping: grouping,
            interval: interval,
            back_query: back_query
        });
    } catch (error) {
        console.error("Error fetching detailed visit log:", error);
        res.status(500).send("Error loading visit log.");
    }
});

// --- RIDE POPULARITY ROUTES ---
router.get('/ride-popularity', isAuthenticated, canViewReports, async (req, res) => {
    try {
        const defaultDate = new Date().toISOString().substring(0, 10);
        const [locations] = await pool.query('SELECT location_id, location_name FROM location ORDER BY location_name');
        const [rideTypes] = await pool.query('SELECT DISTINCT ride_type FROM rides ORDER BY ride_type');
        res.render('ride-popularity-report', {
            selected_date: defaultDate,
            report_data: null,
            chartTitle: 'Ride Popularity Report',
            locations: locations,
            rideTypes: rideTypes,
            filters: { location: '', type: '' },
            error: null
        });
    } catch (error) {
        res.render('ride-popularity-report', {
            selected_date: new Date().toISOString().substring(0, 10),
            report_data: null,
            chartTitle: 'Ride Popularity Report',
            locations: [], rideTypes: [], filters: { location: '', type: '' },
            error: 'Error loading page. Please try again.'
        });
    }
});

router.post('/ride-popularity', isAuthenticated, canViewReports, async (req, res) => {
    let { selected_date, filter_location, filter_type } = req.body;
    let locations = [], rideTypes = [];
    try {
        [locations] = await pool.query('SELECT location_id, location_name FROM location ORDER BY location_name');
        [rideTypes] = await pool.query('SELECT DISTINCT ride_type FROM rides ORDER BY ride_type');

        const dateForHelper = selected_date.length === 7 ? selected_date + '-01' : selected_date;
        const { startDate, endDate } = getReportSettings(dateForHelper, 'month');
        const monthYearFormat = new Date(dateForHelper + 'T00:00:00').toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
        const chartTitle = `Total Riders for ${monthYearFormat}`;

        let whereClauses = ['dr.dat_date BETWEEN ? AND ?'];
        let params = [startDate, endDate];
        if (filter_location && filter_location !== 'all') { whereClauses.push('l.location_id = ?'); params.push(filter_location); }
        if (filter_type && filter_type !== 'all') { whereClauses.push('r.ride_type = ?'); params.push(filter_type); }

        let whereQuery = `WHERE ${whereClauses.join(' AND ')}`;
        const reportQuery = `
            SELECT r.public_ride_id, r.ride_name, r.ride_type, l.location_name, SUM(dr.ride_count) AS total_riders
            FROM daily_ride dr
            JOIN rides r ON dr.ride_id = r.ride_id
            JOIN location l ON r.location_id = l.location_id
            ${whereQuery}
            GROUP BY r.ride_id, r.public_ride_id, r.ride_name, r.ride_type, l.location_name
            HAVING total_riders > 0
            ORDER BY total_riders DESC
        `;
        const [reportData] = await pool.query(reportQuery, params);

        res.render('ride-popularity-report', {
            selected_date: selected_date,
            report_data: reportData,
            chartTitle: chartTitle,
            locations: locations,
            rideTypes: rideTypes,
            filters: { location: filter_location || '', type: filter_type || '' },
            error: null
        });
    } catch (error) {
        console.error(error);
        res.render('ride-popularity-report', {
            selected_date: selected_date,
            report_data: null,
            chartTitle: 'Ride Popularity Report',
            locations: locations, rideTypes: rideTypes, filters: { location: filter_location || '', type: filter_type || '' },
            error: `Error generating report: ${error.message}`
        });
    }
});

router.get('/ride-log', isAuthenticated, canViewReports, async (req, res) => {
    const { month, ride_id, back_query } = req.query;
    if (!month || !ride_id) return res.status(400).send('Missing parameters.');
    try {
        const dateForHelper = month + '-01';
        const { startDate, endDate } = getReportSettings(dateForHelper, 'month');
        const [rideResult] = await pool.query(`SELECT r.ride_id, r.ride_name, l.location_name FROM rides r JOIN location l ON r.location_id = l.location_id WHERE r.public_ride_id = ?`, [ride_id]);
        if (rideResult.length === 0) return res.status(404).send('Ride not found.');
        const ride = rideResult[0];
        const logQuery = `SELECT dr.dat_date, dr.run_count, dr.ride_count, (dr.ride_count / dr.run_count) AS avg_riders_per_run FROM daily_ride dr WHERE dr.ride_id = ? AND dr.dat_date BETWEEN ? AND ? ORDER BY dr.dat_date DESC`;
        const [dailyLogs] = await pool.query(logQuery, [ride.ride_id, startDate, endDate]);
        res.render('ride-log-detail', { ride: ride, dailyLogs: dailyLogs, month: month, back_query: back_query });
    } catch (error) { res.status(500).send("Error loading ride log."); }
});

// --- CLOSURE IMPACT ROUTES ---
router.get('/closure-impact', isAuthenticated, canViewReports, async (req, res) => {
    try {
        const defaultDate = new Date().toISOString().substring(0, 10);
        const [weatherTypes] = await pool.query("SELECT DISTINCT weather_type FROM weather_events ORDER BY weather_type");
        res.render('closure-impact-report', {
            selected_date: defaultDate,
            report_data: null,
            chartTitle: '',
            weatherTypes: weatherTypes,
            filters: { type: '' },
            error: null
        });
    } catch (error) {
        res.render('closure-impact-report', {
            selected_date: new Date().toISOString().substring(0, 10),
            report_data: null,
            chartTitle: '',
            weatherTypes: [], filters: { type: '' },
            error: 'Error loading page. Please try again.'
        });
    }
});

router.post('/closure-impact', isAuthenticated, canViewReports, async (req, res) => {
    const { selected_date, filter_type } = req.body;
    let weatherTypes = [];
    try {
        const year = parseInt(selected_date, 10);
        if (isNaN(year)) throw new Error("Invalid year.");
        const chartTitle = `Year ${year}`;
        [weatherTypes] = await pool.query("SELECT DISTINCT weather_type FROM weather_events ORDER BY weather_type");

        let whereClauses = ['w.park_closure = TRUE', 'YEAR(w.event_date) = ?'];
        let params = [year];
        if (filter_type && filter_type !== 'all') { whereClauses.push('w.weather_type = ?'); params.push(filter_type); }
        const whereQuery = `WHERE ${whereClauses.join(' AND ')}`;

        const reportQuery = `
            WITH MonthlyDOWStats AS (
                SELECT YEAR(ds.date_rec) AS stat_year, MONTH(ds.date_rec) AS stat_month, DAYOFWEEK(ds.date_rec) AS stat_dow,
                    AVG(ds.visitor_count) AS avg_visitors, AVG(COALESCE(ride_totals.total_rides, 0)) AS avg_rides
                FROM daily_stats ds
                LEFT JOIN (SELECT dat_date, SUM(ride_count) AS total_rides FROM daily_ride GROUP BY dat_date) AS ride_totals ON ds.date_rec = ride_totals.dat_date
                WHERE ds.date_rec NOT IN (SELECT DATE(event_date) FROM weather_events WHERE park_closure = TRUE)
                GROUP BY stat_year, stat_month, stat_dow
            )
            SELECT w.weather_id, w.event_date, w.end_time, w.weather_type,
                COALESCE(ds.visitor_count, 0) AS actual_visitors, COALESCE(SUM(dr.ride_count), 0) AS actual_rides,
                COALESCE(ma.avg_visitors, 0) AS benchmark_visitors, COALESCE(ma.avg_rides, 0) AS benchmark_rides
            FROM weather_events w
            LEFT JOIN daily_stats ds ON DATE(w.event_date) = ds.date_rec
            LEFT JOIN daily_ride dr ON ds.date_rec = dr.dat_date
            LEFT JOIN MonthlyDOWStats ma ON YEAR(w.event_date) = ma.stat_year AND MONTH(w.event_date) = ma.stat_month AND DAYOFWEEK(w.event_date) = ma.stat_dow
            ${whereQuery}
            GROUP BY w.weather_id, w.event_date, w.end_time, w.weather_type, ds.visitor_count, ma.avg_visitors, ma.avg_rides
            ORDER BY w.event_date ASC;
        `;
        const [reportData] = await pool.query(reportQuery, params);
        res.render('closure-impact-report', {
            selected_date: selected_date,
            report_data: reportData,
            chartTitle: chartTitle,
            weatherTypes: weatherTypes,
            filters: { type: filter_type || '' },
            error: null
        });
    } catch (error) {
        res.render('closure-impact-report', {
            selected_date: selected_date,
            report_data: null,
            chartTitle: '',
            weatherTypes: [], filters: { type: filter_type || '' },
            error: `Error generating report: ${error.message}`
        });
    }
});

router.get('/weather-log/:id', isAuthenticated, canViewReports, async (req, res) => {
    const { id } = req.params;
    const { back_query } = req.query;
    try {
        const [eventResult] = await pool.query('SELECT * FROM weather_events WHERE weather_id = ?', [id]);
        if (eventResult.length === 0) return res.status(404).send('Weather event log not found.');
        res.render('weather-log-detail', { event: eventResult[0], back_query: back_query });
    } catch (error) { res.status(500).send("Error loading weather log."); }
});

// --- NEW: MAINTENANCE REPORT ROUTES (MERGED) ---

// GET /reports/maintenance
router.get('/maintenance', isAuthenticated, canViewReports, async (req, res) => {
    // Default to last 90 days for a better trend view
    const defaultStart = new Date();
    defaultStart.setDate(defaultStart.getDate() - 90);

    const { d1, d2, loc, type } = req.query;

    try {
        // 1. Fetch Dropdown Data
        const [locations] = await pool.query('SELECT location_id, location_name FROM location ORDER BY location_name');
        const locationOptions = [{ location_id: 'all', location_name: 'All Locations' }, ...locations];

        const [rideTypes] = await pool.query('SELECT DISTINCT ride_type FROM rides ORDER BY ride_type');

        // 2. Set Filters
        let selected_date1 = d1 || defaultStart.toISOString().substring(0, 10);
        let selected_date2 = d2 || new Date().toISOString().substring(0, 10);
        let locations_selected = loc || 'all';
        let type_selected = type || 'all';

        // 3. Build Query
        let reportQuery = `
            SELECT
              m.maintenance_id,
              m.public_maintenance_id,
              m.report_date,
              m.end_date,
              m.summary AS issue_summary,
              m.cost,
              r.ride_name,
              r.ride_type,
              r.public_ride_id,
              l.location_name,
              CONCAT(e.first_name, ' ', e.last_name) AS assigned_employee_name
            FROM maintenance m
            JOIN rides r ON m.ride_id = r.ride_id
            JOIN location l ON r.location_id = l.location_id
            LEFT JOIN employee_demographics e ON m.employee_id = e.employee_id
        `;

        let whereClauses = [' m.report_date BETWEEN ? AND ? '];
        let params = [selected_date1, selected_date2];

        if (locations_selected && locations_selected !== 'all') {
            whereClauses.push(' l.location_id = ? ');
            params.push(locations_selected);
        }

        if (type_selected && type_selected !== 'all') {
            whereClauses.push(' r.ride_type = ? ');
            params.push(type_selected);
        }

        reportQuery += ' WHERE ' + whereClauses.join(' AND ') + ' ORDER BY m.report_date DESC ';
        const [reportData] = await pool.query(reportQuery, params);

        // --- 4. Calculate Statistics ---

        // A. Duration in Months (for Average Calc)
        const start = new Date(selected_date1);
        const end = new Date(selected_date2);
        const diffTime = Math.abs(end - start);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
        // Use 30.44 as avg days in month. Ensure min 1 month to avoid infinity.
        const durationInMonths = Math.max(1, diffDays / 30.44);

        // B. Aggregate Metrics
        let totalReports = reportData.length;
        let totalCost = 0;
        let totalRepairDays = 0;
        let closedCount = 0;

        // C. Aggregate Chart Data
        const typeCounts = {};
        const timelineCounts = {}; // Key: "Month Year"

        reportData.forEach(row => {
            // Cost & Repair Time
            if (row.cost) totalCost += parseFloat(row.cost);
            if (row.end_date) {
                const repTime = Math.ceil((new Date(row.end_date) - new Date(row.report_date)) / (1000 * 60 * 60 * 24));
                totalRepairDays += repTime;
                closedCount++;
            }

            // Type Data
            typeCounts[row.ride_type] = (typeCounts[row.ride_type] || 0) + 1;

            // Timeline Data (Group by Month)
            const dateKey = new Date(row.report_date).toLocaleString('en-US', { month: 'short', year: 'numeric' });
            timelineCounts[dateKey] = (timelineCounts[dateKey] || 0) + 1;
        });

        const metrics = {
            total: totalReports,
            // The Requested Stat: Average number of breakdowns per month in this period
            avg_monthly: (totalReports / durationInMonths).toFixed(1),
            total_cost: totalCost.toFixed(2),
            avg_repair_days: closedCount > 0 ? (totalRepairDays / closedCount).toFixed(1) : '0'
        };

        // Sort timeline keys chronologically
        const timelineLabels = Object.keys(timelineCounts).sort((a, b) => new Date(a) - new Date(b));
        const timelineValues = timelineLabels.map(k => timelineCounts[k]);

        const chartData = {
            types: { labels: Object.keys(typeCounts), data: Object.values(typeCounts) },
            timeline: { labels: timelineLabels, data: timelineValues }
        };

        res.render('maintenance-report', {
            locations: locationOptions,
            rideTypes: rideTypes,
            selected_date1: selected_date1,
            selected_date2: selected_date2,
            locations_selected: locations_selected,
            type_selected: type_selected,
            data: reportData,
            metrics: metrics,
            chartData: chartData,
            error: null
        });

    } catch (error) {
        console.error("Error loading maintenance report:", error);
        res.status(500).send("Error loading report.");
    }
});

// POST /reports/maintenance
router.post('/maintenance', isAuthenticated, canViewReports, async (req, res) => {
    const { selected_date1, selected_date2, locations_selected, type_selected } = req.body;
    const params = new URLSearchParams({
        d1: selected_date1,
        d2: selected_date2,
        loc: locations_selected,
        type: type_selected
    });
    res.redirect(`/reports/maintenance?${params.toString()}`);
});

module.exports = router;