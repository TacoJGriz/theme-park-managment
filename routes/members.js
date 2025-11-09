const express = require('express');
const router = express.Router();
const pool = require('../db');
const bcrypt = require('bcrypt');
const {
    isAuthenticated,
    canManageMembersVisits,
    formatPhoneNumber
} = require('../middleware/auth');

// --- EMPLOYEE-FACING MEMBER MANAGEMENT ---
// GET /members
router.get('/', isAuthenticated, canManageMembersVisits, async (req, res) => {
    try {
        const { search, sort, dir, filter_type, filter_status } = req.query;
        let whereClauses = [];
        let params = [];
        let orderBy = ' ORDER BY m.last_name ASC, m.first_name ASC';
        const [memberTypes] = await pool.query(
            'SELECT type_id, type_name FROM membership_type WHERE is_active = TRUE ORDER BY type_name'
        );
        if (search) {
            whereClauses.push(
                '(m.first_name LIKE ? OR m.last_name LIKE ? OR m.email LIKE ? OR m.phone_number LIKE ?)'
            );
            const searchTerm = `%${search}%`;
            params.push(searchTerm, searchTerm, searchTerm, searchTerm);
        }
        if (filter_type) {
            whereClauses.push('m.type_id = ?');
            params.push(filter_type);
        }
        if (filter_status === 'active') {
            whereClauses.push('m.end_date >= CURDATE()');
        } else if (filter_status === 'expired') {
            whereClauses.push('m.end_date < CURDATE()');
        }
        let summaryQuery = `
            SELECT 
                COUNT(m.membership_id) AS totalMembers,
                SUM(CASE WHEN m.end_date >= CURDATE() THEN 1 ELSE 0 END) AS activeMembers,
                SUM(CASE WHEN m.end_date < CURDATE() THEN 1 ELSE 0 END) AS expiredMembers
            FROM membership m
            LEFT JOIN membership_type mt ON m.type_id = mt.type_id
        `;
        if (whereClauses.length > 0) {
            summaryQuery += ` WHERE ${whereClauses.join(' AND ')}`;
        }
        const [summaryResult] = await pool.query(summaryQuery, params);
        const counts = summaryResult[0];
        if (sort && dir && (dir === 'asc' || dir === 'desc')) {
            const validSorts = {
                'name': 'm.last_name',
                'email': 'm.email',
                'phone': 'm.phone_number',
                'type': 'mt.type_name',
                'start_date': 'm.start_date',
                'end_date': 'm.end_date',
                'status': 'member_status'
            };
            if (validSorts[sort]) {
                if (sort === 'name') {
                    orderBy = ` ORDER BY m.last_name ${dir.toUpperCase()}, m.first_name ${dir.toUpperCase()}`;
                } else {
                    orderBy = ` ORDER BY ${validSorts[sort]} ${dir.toUpperCase()}`;
                }
            }
        }
        let query = `
            SELECT 
                m.membership_id, 
                m.first_name, m.last_name, m.email, m.phone_number,
                mt.type_name,
                DATE_FORMAT(m.start_date, '%m/%d/%Y') AS start_date_formatted,
                DATE_FORMAT(m.end_date, '%m/%d/%Y') AS end_date_formatted,
                CASE 
                    WHEN m.end_date >= CURDATE() THEN 'Active' 
                    ELSE 'Expired' 
                END AS member_status,
                m.start_date, m.end_date
            FROM membership m
            LEFT JOIN membership_type mt ON m.type_id = mt.type_id
        `;
        if (whereClauses.length > 0) {
            query += ` WHERE ${whereClauses.join(' AND ')}`;
        }
        query += orderBy;
        const [members] = await pool.query(query, params);
        res.render('members', {
            members: members,
            types: memberTypes,
            search: search || "",
            currentSort: sort,
            currentDir: dir,
            filters: {
                type: filter_type || "",
                status: filter_status || ""
            },
            counts: counts
        });
    } catch (error) {
        console.error(error);
        res.status(500).send('Error fetching members');
    }
});

// GET /members/new
router.get('/new', isAuthenticated, canManageMembersVisits, async (req, res) => {
    try {
        const [types] = await pool.query(
            'SELECT type_id, type_name FROM membership_type WHERE is_active = TRUE ORDER BY type_name'
        );
        res.render('add-member', { error: null, types: types });
    } catch (error) {
        console.error(error);
        res.render('add-member', { error: "Error fetching membership types.", types: [] });
    }
});

// POST /members
router.post('/', isAuthenticated, canManageMembersVisits, async (req, res) => {
    const { first_name, last_name, email, date_of_birth, type_id, start_date, end_date } = req.body;
    const formattedPhoneNumber = formatPhoneNumber(req.body.phone_number);
    let connection;
    try {
        connection = await pool.getConnection();
        const sql = `
            INSERT INTO membership (first_name, last_name, email, phone_number, date_of_birth, type_id, start_date, end_date)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `;
        await connection.query(sql, [
            first_name, last_name, email,
            formattedPhoneNumber,
            date_of_birth, type_id, start_date, end_date
        ]);
        res.redirect('/members');
    } catch (error) {
        console.error(error);
        const [types] = await pool.query(
            'SELECT type_id, type_name FROM membership_type WHERE is_active = TRUE ORDER BY type_name'
        );
        res.render('add-member', {
            error: "Database error adding member. Email might be duplicate.",
            types: types
        });
    } finally {
        if (connection) connection.release();
    }
});

// GET /members/history/:member_id
router.get('/history/:member_id', isAuthenticated, canManageMembersVisits, async (req, res) => {
    const { member_id } = req.params;
    try {
        const [memberResult] = await pool.query(
            'SELECT first_name, last_name FROM membership WHERE membership_id = ?',
            [member_id]
        );
        if (memberResult.length === 0) {
            return res.status(404).send('Member not found');
        }
        // This is data for the person being VIEWED
        const memberData = memberResult[0];

        const [visits] = await pool.query(`
            SELECT 
                v.visit_id, 
                v.visit_date, 
                v.ticket_price, 
                v.discount_amount, 
                tt.type_name,
                CONCAT(e.first_name, ' ', e.last_name) as staff_name
            FROM visits v
            JOIN ticket_types tt ON v.ticket_type_id = tt.ticket_type_id
            LEFT JOIN employee_demographics e ON v.logged_by_employee_id = e.employee_id
            WHERE v.membership_id = ?
            ORDER BY v.visit_date DESC
        `, [member_id]);

        res.render('visit-history', {
            member: memberData,
            visits: visits
        });

    } catch (error) {
        console.error("Error fetching member visit history:", error);
        res.status(500).send('Error loading page.');
    }
});

module.exports = router;