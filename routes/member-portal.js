const express = require('express');
const router = express.Router();
const pool = require('../db');
const bcrypt = require('bcrypt');
const {
    isMemberAuthenticated,
    isGuest,
    formatReceiptDate,
    censorPhone
} = require('../middleware/auth');

// --- MEMBER-FACING PORTAL ---
// All routes are prefixed with /member by app.js

// GET /member/login
router.get('/login', isGuest, (req, res) => {
    res.redirect('/login'); // Redirect to global login
});

// GET /member/register
router.get('/register', isGuest, (req, res) => {
    res.render('member-register', { error: null });
});

// POST /member/register
router.post('/register', isGuest, async (req, res) => {
    const { membership_id, email, password, confirm_password } = req.body;
    if (password !== confirm_password) {
        return res.render('member-register', { error: 'Passwords do not match.' });
    }
    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();
        const [memberResult] = await connection.query(
            'SELECT * FROM membership WHERE membership_id = ? AND email = ?',
            [membership_id, email]
        );
        if (memberResult.length === 0) {
            throw new Error('Invalid Membership ID or Email. Please check your member card.');
        }
        const [authResult] = await connection.query(
            'SELECT * FROM member_auth WHERE membership_id = ?',
            [membership_id]
        );
        if (authResult.length > 0) {
            throw new Error('An account has already been created for this membership.');
        }
        const saltRounds = 10;
        const hash = await bcrypt.hash(password, saltRounds);
        await connection.query(
            'INSERT INTO member_auth (membership_id, password_hash) VALUES (?, ?)',
            [membership_id, hash]
        );
        await connection.commit();
        res.redirect('/login');
    } catch (error) {
        if (connection) await connection.rollback();
        console.error("Error registering member:", error);
        res.render('member-register', { error: error.message });
    } finally {
        if (connection) connection.release();
    }
});

// GET /member/logout
router.get('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            console.error("Member logout error:", err);
        }
        res.clearCookie('connect.sid');
        res.redirect('/');
    });
});

// GET /member/dashboard
router.get('/dashboard', isMemberAuthenticated, async (req, res) => {
    try {
        const memberId = req.session.member.id;
        const [result] = await pool.query(`
            SELECT 
                m.first_name, m.last_name, m.email, m.phone_number, m.date_of_birth, m.end_date,
                mt.type_name,
                CASE 
                    WHEN m.end_date >= CURDATE() THEN 'Active' 
                    ELSE 'Expired' 
                END AS member_status
            FROM membership m
            JOIN membership_type mt ON m.type_id = mt.type_id
            WHERE m.membership_id = ?
        `, [memberId]);
        if (result.length === 0) {
            return res.redirect('/member/logout');
        }
        const memberData = result[0];
        res.render('member-dashboard', {
            member: {
                id: memberId,
                firstName: memberData.first_name,
                lastName: memberData.last_name,
                email: memberData.email,
                phone: memberData.phone_number,
                dob: memberData.date_of_birth,
                endDate: memberData.end_date,
                typeName: memberData.type_name,
                status: memberData.member_status
            }
        });
    } catch (error) {
        console.error("Error fetching member dashboard:", error);
        res.status(500).send('Error loading dashboard.');
    }
});

// GET /member/history
router.get('/history', isMemberAuthenticated, async (req, res) => {
    const memberId = req.session.member.id;
    try {
        const member = req.session.member; // This is the logged-in member
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
        `, [memberId]);
        res.render('visit-history', {
            member: member, // Pass the logged-in member's data
            visits: visits
        });
    } catch (error) {
        console.error("Error fetching member visit history:", error);
        res.status(500).send('Error loading page.');
    }
});

// GET /member/promotions
router.get('/promotions', isMemberAuthenticated, async (req, res) => {
    try {
        const [promotions] = await pool.query(
            "SELECT event_name, event_type, start_date, end_date, discount_percent, summary FROM event_promotions WHERE end_date >= CURDATE() ORDER BY start_date"
        );
        res.render('member-promotions', { promotions: promotions });
    } catch (error) {
        console.error("Error fetching promotions:", error);
        res.status(500).send('Error loading promotions.');
    }
});

// GET /member/history/receipt/:visit_id
router.get('/history/receipt/:visit_id', isMemberAuthenticated, async (req, res) => {
    const { visit_id } = req.params;
    const memberId = req.session.member.id;
    let connection;
    try {
        connection = await pool.getConnection();
        const [visitResult] = await connection.query(`
            SELECT 
                v.*, 
                tt.type_name AS ticket_name, 
                tt.is_member_type,
                CONCAT(e.first_name, ' ', e.last_name) as staff_name
            FROM visits v
            JOIN ticket_types tt ON v.ticket_type_id = tt.ticket_type_id
            LEFT JOIN employee_demographics e ON v.logged_by_employee_id = e.employee_id
            WHERE v.visit_id = ?
        `, [visit_id]);
        if (visitResult.length === 0) {
            return res.status(404).send('Visit not found');
        }
        const visit = visitResult[0];
        if (visit.membership_id !== memberId) {
            return res.status(403).send('Forbidden: You can only view your own receipts.');
        }
        let receiptData = {
            visit_id: visit.visit_id,
            visit_date: formatReceiptDate(visit.visit_date),
            ticket_name: visit.ticket_name,
            base_price: parseFloat(visit.ticket_price),
            discount_amount: parseFloat(visit.discount_amount),
            total_cost: parseFloat(visit.ticket_price) - parseFloat(visit.discount_amount),
            promo_applied: visit.discount_amount > 0 ? 'Promotion' : 'N/A',
            is_member: visit.is_member_type,
            staff_name: visit.staff_name || 'N/A',
            member_id: null,
            member_name: null,
            member_type: null,
            member_phone: null
        };
        const [memberInfo] = await connection.query(`
            SELECT 
                m.first_name, m.last_name, m.phone_number,
                mt.type_name AS membership_type_name
            FROM membership m
            LEFT JOIN membership_type mt ON m.type_id = mt.type_id
            WHERE m.membership_id = ?
        `, [memberId]);
        if (memberInfo.length > 0) {
            receiptData.member_id = memberId;
            receiptData.member_name = `${memberInfo[0].first_name} ${memberInfo[0].last_name}`;
            receiptData.member_type = memberInfo[0].membership_type_name;
            receiptData.member_phone = censorPhone(memberInfo[0].phone_number);
        }
        res.render('visit-receipt', { receipt: receiptData });
    } catch (error) {
        console.error("Error fetching receipt:", error);
        res.status(500).send("Error loading receipt.");
    } finally {
        if (connection) connection.release();
    }
});

// --- YOUR NEW ROUTES ARE ADDED HERE ---

// GET /member/manage
router.get('/manage', isMemberAuthenticated, async (req, res) => {
    const memberId = req.session.member.id;
    try {
        const [memberResult] = await pool.query(`
            SELECT 
                m.first_name, m.last_name, m.end_date,
                mt.type_name,
                CASE 
                    WHEN m.end_date >= CURDATE() THEN 'Active' 
                    ELSE 'Expired' 
                END AS member_status
            FROM membership m
            JOIN membership_type mt ON m.type_id = mt.type_id
            WHERE m.membership_id = ?
        `, [memberId]);
        if (memberResult.length === 0) {
            return res.redirect('/member/logout');
        }
        const [paymentMethods] = await pool.query(
            `SELECT * FROM member_payment_methods 
             WHERE membership_id = ? 
             ORDER BY is_default DESC, payment_method_id ASC`,
            [memberId]
        );
        res.render('member-manage-account', {
            member: memberResult[0],
            paymentMethods: paymentMethods
        });
    } catch (error) {
        console.error("Error loading manage account page:", error);
        res.status(500).send("Error loading page.");
    }
});

// GET /member/purchase-receipt
router.get('/purchase-receipt', isMemberAuthenticated, async (req, res) => {
    const memberId = req.session.member.id;
    try {
        const [purchaseResult] = await pool.query(`
            SELECT 
                m.membership_id, m.first_name, m.last_name, m.start_date,
                mt.type_name, mt.base_price
            FROM membership m
            JOIN membership_type mt ON m.type_id = mt.type_id
            WHERE m.membership_id = ?
        `, [memberId]);
        if (purchaseResult.length === 0) {
            return res.status(404).send("Could not find membership purchase data.");
        }
        res.render('member-purchase-receipt', {
            purchase: purchaseResult[0]
        });
    } catch (error) {
        console.error("Error fetching purchase receipt:", error);
        res.status(500).send("Error loading receipt.");
    }
});

// POST /member/payment/delete/:method_id
router.post('/payment/delete/:method_id', isMemberAuthenticated, async (req, res) => {
    const memberId = req.session.member.id;
    const { method_id } = req.params;
    try {
        await pool.query(
            "DELETE FROM member_payment_methods WHERE payment_method_id = ? AND membership_id = ?",
            [method_id, memberId]
        );
        res.redirect('/member/manage');
    } catch (error) {
        console.error("Error deleting payment method:", error);
        res.status(500).send("Error processing request.");
    }
});

// POST /member/payment/default/:method_id
router.post('/payment/default/:method_id', isMemberAuthenticated, async (req, res) => {
    const memberId = req.session.member.id;
    const { method_id } = req.params;
    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();
        await connection.query(
            "UPDATE member_payment_methods SET is_default = FALSE WHERE membership_id = ?",
            [memberId]
        );
        await connection.query(
            "UPDATE member_payment_methods SET is_default = TRUE WHERE payment_method_id = ? AND membership_id = ?",
            [method_id, memberId]
        );
        await connection.commit();
        res.redirect('/member/manage');
    } catch (error) {
        if (connection) await connection.rollback();
        console.error("Error setting default payment method:", error);
        res.status(500).send("Error processing request.");
    } finally {
        if (connection) connection.release();
    }
});

module.exports = router;