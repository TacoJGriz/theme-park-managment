const express = require('express');
const router = express.Router();
const pool = require('../db'); // Correctly imports the database connection from db.js
const { isAuthenticated, canViewReports, getReportSettings } = require('../middleware/auth');

// GET route for the Attendance Report page
router.get('/attendance', isAuthenticated, canViewReports, async (req, res) => {
    try {
        // Fetch membership types dynamically for the filter dropdown
        const [membershipTypes] = await pool.query('SELECT type_id, type_name FROM membership_type WHERE is_active = TRUE ORDER BY type_name');

        // Set a reasonable default date (e.g., today or a specific date with data)
        const defaultDate = new Date().toISOString().substring(0, 10); // Today's date

        res.render('attendance-report', {
            membership_types: membershipTypes, // Pass dynamic types
            selected_date: defaultDate,
            grouping: 'day', // Default grouping
            membership_type_id: 'all', // Default filter selection
            attendance_data: null,     // No data on initial load
            labelFormat: 'Time Period',// Default axis label
            error: null
        });
    } catch (error) {
        console.error("Error loading attendance report page:", error);
        // Render with empty data and an error message
        res.render('attendance-report', {
            membership_types: [],
            selected_date: new Date().toISOString().substring(0, 10),
            grouping: 'day',
            membership_type_id: 'all',
            attendance_data: null,
            labelFormat: 'Time Period',
            error: 'Error loading page setup data. Please try again.'
        });
    }
});

// POST route to generate the Attendance Report
router.post('/attendance', isAuthenticated, canViewReports, async (req, res) => {
    const { selected_date, grouping, membership_type_id } = req.body;
    let membershipTypes = []; // To repopulate dropdown on error/success

    try {
        // Fetch membership types again for rendering the page
        [membershipTypes] = await pool.query('SELECT type_id, type_name FROM membership_type WHERE is_active = TRUE ORDER BY type_name');

        // Get date range and SQL format settings
        const { startDate, endDate, sqlDateFormat, labelFormat } = getReportSettings(selected_date, grouping);

        // --- Build Dynamic SQL Query ---
        let reportQuery = `
            SELECT
                DATE_FORMAT(v.visit_date, ?) as report_interval,
                COUNT(v.visit_id) as total_count
            FROM visits v
        `;
        let joinClause = '';
        let whereClause = ' WHERE DATE(v.visit_date) BETWEEN ? AND ? ';
        // Start params with format, start date, end date
        let params = [sqlDateFormat, startDate, endDate];

        // Add filtering based on membership type selection
        if (membership_type_id === 'non-member') {
            whereClause += 'AND v.membership_id IS NULL ';
        } else if (membership_type_id !== 'all') {
            // Join needed only if filtering by a specific member type
            joinClause = ' JOIN membership m ON v.membership_id = m.membership_id ';
            whereClause += 'AND m.type_id = ? ';
            params.push(membership_type_id); // Add type_id to params
        }

        // Combine query parts
        reportQuery += joinClause + whereClause + ' GROUP BY report_interval ORDER BY report_interval';

        // Execute the query
        const [reportData] = await pool.query(reportQuery, params);

        // Calculate average and identify spikes (e.g., > 25% above average)
        const totalSum = reportData.reduce((sum, row) => sum + row.total_count, 0);
        const avgCount = reportData.length > 0 ? totalSum / reportData.length : 0;
        const spikeThreshold = avgCount * 1.25;

        // Format data for Chart.js and add spike flag
        const chartData = reportData.map(row => ({
            label: row.report_interval,
            count: row.total_count,
            // Flag as spike if count exceeds threshold (and there's enough data to compare)
            isSpike: row.total_count >= spikeThreshold && reportData.length > 2
        }));

        // Render the report page with the generated data
        res.render('attendance-report', {
            membership_types: membershipTypes,
            selected_date: selected_date,
            grouping: grouping,
            membership_type_id: membership_type_id, // Pass back the selected ID
            attendance_data: chartData,
            labelFormat: labelFormat,
            error: null
        });

    } catch (error) {
        console.error("Error generating attendance report:", error);
        // Attempt to fetch types even on error for dropdown consistency
        try {
            [membershipTypes] = await pool.query('SELECT type_id, type_name FROM membership_type WHERE is_active = TRUE ORDER BY type_name');
        } catch (fetchErr) {
            membershipTypes = []; // Use empty array if fetch fails
        }
        // Render the report page with an error message
        res.render('attendance-report', {
            membership_types: membershipTypes,
            selected_date: selected_date,
            grouping: grouping,
            membership_type_id: membership_type_id,
            attendance_data: null, // No data to display on error
            labelFormat: 'Time Period',
            error: `Error generating report: ${error.message}` // Display specific error
        });
    }
});

// --- GET ROUTE FOR RIDE POPULARITY ---
router.get('/ride-popularity', isAuthenticated, canViewReports, async (req, res) => {
    try {
        // Default date to today
        const defaultDate = new Date().toISOString().substring(0, 10);

        res.render('ride-popularity-report', {
            selected_date: defaultDate,
            report_data: null, // No data on initial load
            chartTitle: 'Ride Popularity Report', // Default title
            error: null
        });
    } catch (error) {
        console.error("Error loading ride popularity report page:", error);
        res.render('ride-popularity-report', {
            selected_date: new Date().toISOString().substring(0, 10),
            report_data: null,
            chartTitle: 'Ride Popularity Report',
            error: 'Error loading page. Please try again.'
        });
    }
});

// --- POST ROUTE FOR RIDE POPULARITY ---
router.post('/ride-popularity', isAuthenticated, canViewReports, async (req, res) => {
    const { selected_date } = req.body; // Only need the date

    try {
        // 1. Get Date Range for the *Month*
        // We reuse your getReportSettings function by forcing 'month' grouping
        const { startDate, endDate } = getReportSettings(selected_date, 'month');
        
        // 2. Create a custom title for the chart
        // Note: T00:00:00 avoids time zone issues
        const monthYearFormat = new Date(selected_date + 'T00:00:00').toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
        const chartTitle = `Total Riders for ${monthYearFormat}`;

        // 3. Build SQL Query (Joining 3 Tables)
        // This query joins daily_ride -> rides -> location
        const reportQuery = `
            SELECT 
                r.ride_name,
                l.location_name,
                SUM(dr.ride_count) AS total_riders
            FROM daily_ride dr
            JOIN rides r ON dr.ride_id = r.ride_id
            JOIN location l ON r.location_id = l.location_id
            WHERE dr.dat_date BETWEEN ? AND ?
            GROUP BY r.ride_id, r.ride_name, l.location_name
            HAVING total_riders > 0
            ORDER BY total_riders DESC
        `;
        
        let params = [startDate, endDate];

        // 4. Execute Query
        const [reportData] = await pool.query(reportQuery, params);

        // 5. Render View with Data
        res.render('ride-popularity-report', {
            selected_date: selected_date,
            report_data: reportData, // Pass the new data
            chartTitle: chartTitle,  // Pass the custom title
            error: null
        });

    } catch (error) {
        console.error("Error generating ride popularity report:", error);
        res.render('ride-popularity-report', {
            selected_date: selected_date,
            report_data: null,
            chartTitle: 'Ride Popularity Report',
            error: `Error generating report: ${error.message}`
        });
    }
});

// --- NEW GET ROUTE FOR RAINOUTS ---
router.get('/rainouts', isAuthenticated, canViewReports, async (req, res) => {
    try {
        const defaultDate = new Date().toISOString().substring(0, 10);
        res.render('rainout-report', {
            selected_date: defaultDate,
            report_data: null,
            chartTitle: 'Park Closure Report',
            error: null
        });
    } catch (error) {
        console.error("Error loading rainout report page:", error);
        res.render('rainout-report', {
            selected_date: new Date().toISOString().substring(0, 10),
            report_data: null,
            chartTitle: 'Park Closure Report',
            error: 'Error loading page. Please try again.'
        });
    }
});

// --- NEW POST ROUTE FOR RAINOUTS ---
router.post('/rainouts', isAuthenticated, canViewReports, async (req, res) => {
    const { selected_date } = req.body;

    try {
        // 1. Get the year from the selected date
        const year = new Date(selected_date + 'T00:00:00').getFullYear();
        const chartTitle = `Park Closures for ${year}`;

        // 2. Build SQL Query
        // This query counts all weather events where park_closure = TRUE
        // and groups them by month ('YYYY-MM' format) for the selected year.
        const reportQuery = `
            SELECT
                DATE_FORMAT(event_date, '%Y-%m') AS report_month,
                COUNT(weather_id) AS closure_count
            FROM weather_events
            WHERE
                park_closure = TRUE
                AND YEAR(event_date) = ?
            GROUP BY report_month
            ORDER BY report_month ASC;
        `;
        
        const [dbData] = await pool.query(reportQuery, [year]);

        // 3. Format data for Chart.js (ensuring all 12 months are present)
        
        // Create a map of the data we got from the DB
        // e.g., {'2025-07': 1, '2025-10': 1}
        const dataMap = new Map(dbData.map(item => [item.report_month, item.closure_count]));

        // Create 12 labels for the X-axis
        const labels = Array.from({ length: 12 }, (_, i) => {
            const month = String(i + 1).padStart(2, '0');
            return `${year}-${month}`;
        });

        // Create the counts array, using the map or 0
        const counts = labels.map(label => dataMap.get(label) || 0);

        // 4. Render View with Data
        res.render('rainout-report', {
            selected_date: selected_date,
            report_data: {
                labels: labels,
                counts: counts
            },
            chartTitle: chartTitle,
            error: null
        });

    } catch (error) {
        console.error("Error generating rainout report:", error);
        res.render('rainout-report', {
            selected_date: selected_date,
            report_data: null,
            chartTitle: 'Park Closure Report',
            error: `Error generating report: ${error.message}`
        });
    }
});

module.exports = router;