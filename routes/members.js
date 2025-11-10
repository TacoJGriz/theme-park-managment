const express = require('express');
const router = express.Router();
const pool = require('../db');
const bcrypt = require('bcrypt'); // --- NEW: Added for password hashing
const {
    isAuthenticated,
    canManageMembersVisits,
    formatPhoneNumber
} = require('../middleware/auth');

const saltRounds = 10; // --- NEW: Added for password hashing

// --- EMPLOYEE-FACING MEMBER MANAGEMENT ---
// GET /members
router.get('/', isAuthenticated, canManageMembersVisits, async (req, res) => {
    try {
        const { search, sort, dir, filter_type, filter_status } = req.query;
        let whereClauses = [];
        let params = [];
        let orderBy = ' ORDER BY m.end_date >= CURDATE() DESC, m.last_name ASC, m.first_name ASC';

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
                'id': 'm.membership_id',
                'name': 'm.last_name',
                'email': 'm.email',
                'phone': 'm.phone_number',
                'type': 'mt.type_name',
                'start_date': 'm.start_date',
                'end_date': 'm.end_date',
                'status': 'm.end_date >= CURDATE()'
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
            counts: counts,
            success: req.session.success, // --- NEW: Pass success message
            error: req.session.error
        });
        req.session.success = null; // --- NEW: Clear success message
        req.session.error = null;
    } catch (error) {
        console.error(error);
        res.status(500).send('Error fetching members');
    }
});

// GET /members/new
router.get('/new', isAuthenticated, canManageMembersVisits, async (req, res) => {
    try {
        const [types] = await pool.query(
            'SELECT type_id, type_name, base_price FROM membership_type WHERE is_active = TRUE ORDER BY type_name'
        );
        res.render('add-member', { error: null, types: types });
    } catch (error) {
        console.error(error);
        res.render('add-member', { error: "Error fetching membership types.", types: [] });
    }
});

// POST /members
router.post('/', isAuthenticated, canManageMembersVisits, async (req, res) => {
    const { first_name, last_name, email, date_of_birth, type_id } = req.body;
    const formattedPhoneNumber = formatPhoneNumber(req.body.phone_number);

    const purchaseTime = new Date();
    const serverStartDate = new Date(purchaseTime);
    const serverEndDate = new Date(purchaseTime);
    serverEndDate.setFullYear(serverStartDate.getFullYear() + 1);
    serverEndDate.setDate(serverStartDate.getDate() - 1);

    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        // 1. Get Membership Type details
        const [typeResult] = await connection.query('SELECT * FROM membership_type WHERE type_id = ?', [type_id]);
        if (typeResult.length === 0) {
            throw new Error("Invalid membership type selected.");
        }
        const membershipType = typeResult[0];

        // 2. Create the membership record
        const sql = `
            INSERT INTO membership (first_name, last_name, email, phone_number, date_of_birth, type_id, start_date, end_date)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `;
        const [memResult] = await connection.query(sql, [
            first_name, last_name, email,
            formattedPhoneNumber,
            date_of_birth, type_id, serverStartDate, serverEndDate
        ]);

        const newMemberId = memResult.insertId;

        // 3. Log this in-park purchase in the history table
        const historySql = `
            INSERT INTO membership_purchase_history 
                (membership_id, type_id, purchase_date, price_paid, purchased_start_date, purchased_end_date, type_name_snapshot, payment_method_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
        `;
        const [historyResult] = await connection.query(historySql, [
            newMemberId,
            membershipType.type_id,
            purchaseTime,
            membershipType.base_price,
            serverStartDate,
            serverEndDate,
            membershipType.type_name,
            null
        ]);

        const newPurchaseId = historyResult.insertId;

        // 4. Commit transaction
        await connection.commit();

        // 5. Build the receipt object to render
        const receiptData = {
            purchase_id: newPurchaseId,
            membership_id: newMemberId,
            first_name: first_name,
            last_name: last_name,
            purchase_date: purchaseTime,
            type_name: membershipType.type_name,
            purchased_start_date: serverStartDate,
            purchased_end_date: serverEndDate,
            price_paid: membershipType.base_price,
            payment_method_name: 'In-Park Transaction'
        };

        // 6. Render the receipt instead of redirecting
        res.render('member-purchase-receipt-detail', {
            purchase: receiptData,
            fromEmployee: true
        });

    } catch (error) {
        if (connection) await connection.rollback();

        console.error(error);
        const [types] = await pool.query(
            'SELECT type_id, type_name, base_price FROM membership_type WHERE is_active = TRUE ORDER BY type_name'
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


// *** NEW: EMPLOYEE-SIDE EDIT MEMBER ***

// GET /members/edit/:member_id
router.get('/edit/:member_id', isAuthenticated, canManageMembersVisits, async (req, res) => {
    const { member_id } = req.params;
    try {
        const [memberResult] = await pool.query(
            "SELECT * FROM membership WHERE membership_id = ?",
            [member_id]
        );
        if (memberResult.length === 0) {
            return res.status(404).send('Member not found');
        }
        res.render('member-edit-employee', {
            member: memberResult[0],
            error: null
        });
    } catch (error) {
        console.error("Error loading member edit page:", error);
        res.status(500).send("Error loading page.");
    }
});

// POST /members/edit/:member_id
router.post('/edit/:member_id', isAuthenticated, canManageMembersVisits, async (req, res) => {
    const { member_id } = req.params;
    const { first_name, last_name, email, date_of_birth } = req.body;
    const formattedPhoneNumber = formatPhoneNumber(req.body.phone_number);

    try {
        if (!first_name || !last_name || !date_of_birth || !email) {
            throw new Error("All fields are required.");
        }

        const sql = `
            UPDATE membership 
            SET first_name = ?, last_name = ?, email = ?, phone_number = ?, date_of_birth = ?
            WHERE membership_id = ?
        `;
        await pool.query(sql, [
            first_name,
            last_name,
            email,
            formattedPhoneNumber,
            date_of_birth,
            member_id
        ]);

        req.session.success = "Member profile updated successfully.";
        res.redirect('/members');

    } catch (error) {
        console.error("Error updating member profile:", error);
        try {
            const [memberResult] = await pool.query(
                "SELECT * FROM membership WHERE membership_id = ?",
                [member_id]
            );
            res.render('member-edit-employee', {
                member: memberResult[0] || { membership_id: member_id, ...req.body },
                error: "Database error updating profile. Email may be a duplicate."
            });
        } catch (fetchError) {
            res.redirect('/members');
        }
    }
});

// *** NEW: EMPLOYEE-SIDE RESET MEMBER PASSWORD ***

// GET /members/reset-password/:member_id
router.get('/reset-password/:member_id', isAuthenticated, canManageMembersVisits, async (req, res) => {
    const { member_id } = req.params;
    try {
        const [memberResult] = await pool.query(
            "SELECT membership_id, first_name, last_name FROM membership WHERE membership_id = ?",
            [member_id]
        );
        if (memberResult.length === 0) {
            return res.status(404).send('Member not found');
        }
        res.render('member-reset-password', {
            member: memberResult[0],
            error: null
        });
    } catch (error) {
        console.error("Error loading member reset password page:", error);
        res.status(500).send("Error loading page.");
    }
});

// POST /members/reset-password/:member_id
router.post('/reset-password/:member_id', isAuthenticated, canManageMembersVisits, async (req, res) => {
    const { member_id } = req.params;
    const { password, confirm_password } = req.body;

    // Fetch member data again in case of error
    const [memberResult] = await pool.query(
        "SELECT membership_id, first_name, last_name FROM membership WHERE membership_id = ?",
        [member_id]
    );
    if (memberResult.length === 0) {
        return res.status(404).send('Member not found');
    }
    const member = memberResult[0];

    try {
        if (password !== confirm_password) {
            throw new Error("Passwords do not match.");
        }
        if (password.length < 8) {
            throw new Error("Password must be at least 8 characters.");
        }

        // Check if member has an auth account to update
        const [authCheck] = await pool.query("SELECT * FROM member_auth WHERE membership_id = ?", [member_id]);

        const newHash = await bcrypt.hash(password, saltRounds);

        if (authCheck.length > 0) {
            // Member has an account, update it
            await pool.query('UPDATE member_auth SET password_hash = ? WHERE membership_id = ?', [newHash, member_id]);
        } else {
            // Member does not have an account, create one
            await pool.query('INSERT INTO member_auth (membership_id, password_hash) VALUES (?, ?)', [member_id, newHash]);
        }

        req.session.success = `Password for ${member.first_name} ${member.last_name} has been reset.`;
        res.redirect('/members');

    } catch (error) {
        console.error("Error resetting member password:", error);
        res.render('member-reset-password', {
            member: member,
            error: error.message
        });
    }
});


module.exports = router;