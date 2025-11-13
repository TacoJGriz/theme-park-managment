const express = require('express');
const router = express.Router();
const pool = require('../db'); // Adjust path to db.js
const {
    isAuthenticated,
    canViewReports,
    getReportSettings
} = require('../middleware/auth'); // Adjust path to auth.js

// GET /reports/attendance
// Path changed to /attendance
router.get('/attendance', isAuthenticated, canViewReports, async (req, res) => {
    try {
        // 1. Fetch Membership Types
        const [membershipTypes] = await pool.query('SELECT type_id, type_name FROM membership_type WHERE is_active = TRUE ORDER BY type_name');

        // 2. Fetch Locations
        const [locations] = await pool.query('SELECT location_id, location_name FROM location ORDER BY location_name');

        // 3. ADDED: Fetch Ticket Types (Non-Member only)
        const [ticketTypes] = await pool.query('SELECT ticket_type_id, type_name FROM ticket_types WHERE is_active = TRUE AND is_member_type = FALSE ORDER BY base_price DESC');

        const defaultDate = new Date().toISOString().substring(0, 10);

        res.render('attendance-report', {
            membership_types: membershipTypes,
            locations: locations,
            ticket_types: ticketTypes, // ADDED: Pass tickets to view
            selected_date: defaultDate,
            grouping: 'day',
            membership_type_id: 'all',
            location_id: 'all',
            ticket_type_id: 'all', // ADDED: Default filter
            attendance_data: null,
            labelFormat: 'Time Period',
            error: null
        });
    } catch (error) {
        console.error("Error loading attendance report page:", error);
        res.render('attendance-report', {
            membership_types: [],
            locations: [],
            ticket_types: [], // ADDED
            selected_date: new Date().toISOString().substring(0, 10),
            grouping: 'day',
            membership_type_id: 'all',
            location_id: 'all',
            ticket_type_id: 'all', // ADDED
            attendance_data: null,
            labelFormat: 'Time Period',
            error: 'Error loading page setup data. Please try again.'
        });
    }
});

// POST /reports/attendance
// Path changed to /attendance
router.post('/attendance', isAuthenticated, canViewReports, async (req, res) => {
    // ADDED ticket_type_id to req.body
    const { selected_date, grouping, membership_type_id, location_id, ticket_type_id } = req.body;

    let membershipTypes = [];
    let locations = [];
    let ticketTypes = []; // ADDED

    try {
        // Fetch data for ALL dropdowns to re-render the page
        [membershipTypes] = await pool.query('SELECT type_id, type_name FROM membership_type WHERE is_active = TRUE ORDER BY type_name');
        [locations] = await pool.query('SELECT location_id, location_name FROM location ORDER BY location_name');
        [ticketTypes] = await pool.query('SELECT ticket_type_id, type_name FROM ticket_types WHERE is_active = TRUE AND is_member_type = FALSE ORDER BY base_price DESC'); // ADDED

        const { startDate, endDate, sqlDateFormat, labelFormat } = getReportSettings(selected_date, grouping);

        let reportQuery = `
            SELECT
                DATE_FORMAT(v.visit_date, ?) as report_interval,
                COUNT(v.visit_id) as total_count
            FROM visits v
        `;

        // Join all 6 tables
        let joinClause = `
            LEFT JOIN employee_demographics e ON v.logged_by_employee_id = e.employee_id
            LEFT JOIN location l ON e.location_id = l.location_id
            LEFT JOIN membership m ON v.membership_id = m.membership_id
            LEFT JOIN membership_type mt ON m.type_id = mt.type_id
            LEFT JOIN ticket_types tt ON v.ticket_type_id = tt.ticket_type_id 
        `;

        let whereClause = ' WHERE DATE(v.visit_date) BETWEEN ? AND ? ';
        let params = [sqlDateFormat, startDate, endDate];

        // 1. Member Filter
        if (membership_type_id === 'non-member') {
            whereClause += 'AND v.membership_id IS NULL ';
        } else if (membership_type_id !== 'all') {
            whereClause += 'AND m.type_id = ? ';
            params.push(membership_type_id);
        }

        // 2. Location Filter
        if (location_id && location_id !== 'all') {
            whereClause += 'AND l.location_id = ? ';
            params.push(location_id);
        }

        // 3. Ticket Type Filter
        if (ticket_type_id && ticket_type_id !== 'all') {
            whereClause += 'AND v.ticket_type_id = ? ';
            params.push(ticket_type_id);
        }

        reportQuery += joinClause + whereClause + ' GROUP BY report_interval ORDER BY report_interval';

        const [reportData] = await pool.query(reportQuery, params);

        // --- Statistical Spike Detection (Standard Deviation) ---

        // 1. Calculate Mean (Average)
        const totalSum = reportData.reduce((sum, row) => sum + row.total_count, 0);
        const mean = reportData.length > 0 ? totalSum / reportData.length : 0;

        // 2. Calculate Variance & Standard Deviation
        // Variance = average of squared differences from the mean
        const variance = reportData.reduce((sum, row) => {
            const diff = row.total_count - mean;
            return sum + (diff * diff);
        }, 0) / (reportData.length || 1);

        const stdDev = Math.sqrt(variance);

        // 3. Process Data & Flag Spikes
        // We define a "Spike" as anything > 1.25 Standard Deviations above the mean
        const Z_SCORE_THRESHOLD = 1.25;

        const chartData = reportData.map(row => {
            let isSpike = false;
            let zScore = 0;

            // Avoid division by zero if stdDev is 0 (e.g., all data is identical)
            if (stdDev > 0) {
                zScore = (row.total_count - mean) / stdDev;
            }

            // Flag only POSITIVE spikes (high traffic), ignoring unusually low days
            if (zScore >= Z_SCORE_THRESHOLD && reportData.length > 3) {
                isSpike = true;
            }

            return {
                label: row.report_interval,
                count: row.total_count,
                isSpike: isSpike,
                zScore: zScore.toFixed(1) // Send formatted score to UI (e.g., "2.5")
            };
        });

        res.render('attendance-report', {
            membership_types: membershipTypes,
            locations: locations,
            ticket_types: ticketTypes, // ADDED
            selected_date: selected_date,
            grouping: grouping,
            membership_type_id: membership_type_id,
            location_id: location_id,
            ticket_type_id: ticket_type_id, // ADDED
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
        } catch (fetchErr) {
            membershipTypes = []; locations = []; ticketTypes = [];
        }
        res.render('attendance-report', {
            membership_types: membershipTypes,
            locations: locations,
            ticket_types: ticketTypes, // ADDED
            selected_date: selected_date,
            grouping: grouping,
            membership_type_id: membership_type_id,
            location_id: location_id,
            ticket_type_id: ticket_type_id, // ADDED
            attendance_data: null,
            labelFormat: 'Time Period',
            error: `Error generating report: ${error.message}`
        });
    }
});

module.exports = router;