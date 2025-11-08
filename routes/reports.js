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
        const [membershipTypes] = await pool.query('SELECT type_id, type_name FROM membership_type WHERE is_active = TRUE ORDER BY type_name');
        const defaultDate = new Date().toISOString().substring(0, 10);

        res.render('attendance-report', {
            membership_types: membershipTypes,
            selected_date: defaultDate,
            grouping: 'day',
            membership_type_id: 'all',
            attendance_data: null,
            labelFormat: 'Time Period',
            error: null
        });
    } catch (error) {
        console.error("Error loading attendance report page:", error);
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

// POST /reports/attendance
// Path changed to /attendance
router.post('/attendance', isAuthenticated, canViewReports, async (req, res) => {
    const { selected_date, grouping, membership_type_id } = req.body;
    let membershipTypes = [];

    try {
        [membershipTypes] = await pool.query('SELECT type_id, type_name FROM membership_type WHERE is_active = TRUE ORDER BY type_name');

        const { startDate, endDate, sqlDateFormat, labelFormat } = getReportSettings(selected_date, grouping);

        let reportQuery = `
            SELECT
                DATE_FORMAT(v.visit_date, ?) as report_interval,
                COUNT(v.visit_id) as total_count
            FROM visits v
        `;
        let joinClause = '';
        let whereClause = ' WHERE DATE(v.visit_date) BETWEEN ? AND ? ';
        let params = [sqlDateFormat, startDate, endDate];

        if (membership_type_id === 'non-member') {
            whereClause += 'AND v.membership_id IS NULL ';
        } else if (membership_type_id !== 'all') {
            joinClause = ' JOIN membership m ON v.membership_id = m.membership_id ';
            whereClause += 'AND m.type_id = ? ';
            params.push(membership_type_id);
        }

        reportQuery += joinClause + whereClause + ' GROUP BY report_interval ORDER BY report_interval';

        const [reportData] = await pool.query(reportQuery, params);

        const totalSum = reportData.reduce((sum, row) => sum + row.total_count, 0);
        const avgCount = reportData.length > 0 ? totalSum / reportData.length : 0;
        const spikeThreshold = avgCount * 1.25;

        const chartData = reportData.map(row => ({
            label: row.report_interval,
            count: row.total_count,
            isSpike: row.total_count >= spikeThreshold && reportData.length > 2
        }));

        res.render('attendance-report', {
            membership_types: membershipTypes,
            selected_date: selected_date,
            grouping: grouping,
            membership_type_id: membership_type_id,
            attendance_data: chartData,
            labelFormat: labelFormat,
            error: null
        });

    } catch (error) {
        console.error("Error generating attendance report:", error);
        try {
            [membershipTypes] = await pool.query('SELECT type_id, type_name FROM membership_type WHERE is_active = TRUE ORDER BY type_name');
        } catch (fetchErr) {
            membershipTypes = [];
        }
        res.render('attendance-report', {
            membership_types: membershipTypes,
            selected_date: selected_date,
            grouping: grouping,
            membership_type_id: membership_type_id,
            attendance_data: null,
            labelFormat: 'Time Period',
            error: `Error generating report: ${error.message}`
        });
    }
});

module.exports = router;