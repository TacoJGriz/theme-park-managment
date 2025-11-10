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

// --- ACCOUNT MANAGEMENT & PURCHASE HISTORY ---

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

        // *** NEW LOGIC: Check if member is eligible for renewal ***
        const today = new Date();
        const endDate = new Date(memberResult[0].end_date);

        // Calculate the date 60 days *before* the end date
        const renewalWindowStartDate = new Date(endDate);
        renewalWindowStartDate.setDate(endDate.getDate() - 60);

        // Member can renew if today is *after* the window start date OR if the pass is already expired
        const isExpired = endDate < today;
        const canRenew = (today >= renewalWindowStartDate) || isExpired;
        // *** END NEW LOGIC ***

        const [paymentMethods] = await pool.query(
            `SELECT * FROM member_payment_methods 
             WHERE membership_id = ? 
             ORDER BY is_default DESC, payment_method_id ASC`,
            [memberId]
        );

        res.render('member-manage-account', {
            member: memberResult[0],
            paymentMethods: paymentMethods,
            canRenew: canRenew, // Pass the new variable
            success: req.session.success,
            error: req.session.error // Pass error flash message
        });
        req.session.success = null; // Clear flash messages
        req.session.error = null;
    } catch (error) {
        console.error("Error loading manage account page:", error);
        res.status(500).send("Error loading page.");
    }
});

// GET /member/purchases - Shows the list of all membership purchases
router.get('/purchases', isMemberAuthenticated, async (req, res) => {
    const memberId = req.session.member.id;
    try {
        const [purchases] = await pool.query(`
            SELECT 
                h.purchase_id,
                h.purchase_date,
                h.price_paid,
                h.purchased_start_date,
                h.purchased_end_date,
                mt.type_name
            FROM membership_purchase_history h
            JOIN membership_type mt ON h.type_id = mt.type_id
            WHERE h.membership_id = ?
            ORDER BY h.purchase_date DESC
        `, [memberId]);

        res.render('member-purchase-history', {
            purchases: purchases
        });

    } catch (error) {
        console.error("Error fetching purchase history:", error);
        res.status(500).send("Error loading history.");
    }
});

// GET /member/purchases/receipt/:purchase_id - Shows a single receipt from history
router.get('/purchases/receipt/:purchase_id', isMemberAuthenticated, async (req, res) => {
    const memberId = req.session.member.id;
    const { purchase_id } = req.params;

    try {
        // Query for the specific purchase, joining with member and type tables
        const [purchaseResult] = await pool.query(`
            SELECT 
                h.purchase_id, h.purchase_date, h.price_paid, 
                h.purchased_start_date, h.purchased_end_date,
                m.membership_id, m.first_name, m.last_name,
                mt.type_name
            FROM membership_purchase_history h
            JOIN membership m ON h.membership_id = m.membership_id
            JOIN membership_type mt ON h.type_id = mt.type_id
            WHERE h.purchase_id = ? AND h.membership_id = ?
        `, [purchase_id, memberId]);

        if (purchaseResult.length === 0) {
            // Not found or doesn't belong to this member
            return res.status(404).send("Purchase receipt not found or access denied.");
        }

        // Render a new receipt detail view
        res.render('member-purchase-receipt-detail', {
            purchase: purchaseResult[0]
        });

    } catch (error) {
        console.error("Error fetching purchase receipt:", error);
        res.status(500).send("Error loading receipt.");
    }
});

// POST /member/renew - Simulates a renewal
router.post('/renew', isMemberAuthenticated, async (req, res) => {
    const memberId = req.session.member.id;
    let connection;

    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        // 1. Get member's current info
        const [memberResult] = await connection.query(
            `SELECT m.type_id, m.end_date, mt.base_price, mt.type_name
             FROM membership m
             JOIN membership_type mt ON m.type_id = mt.type_id
             WHERE m.membership_id = ?`,
            [memberId]
        );

        if (memberResult.length === 0) {
            throw new Error("Member not found.");
        }

        const member = memberResult[0];
        const currentEndDate = new Date(member.end_date);
        const today = new Date();

        // *** NEW BUSINESS RULE CHECK ***
        // Calculate the date 60 days *before* the end date
        const renewalWindowStartDate = new Date(currentEndDate);
        renewalWindowStartDate.setDate(currentEndDate.getDate() - 60);
        const isExpired = currentEndDate < today;

        // If today is *before* that 60-day window AND the pass is not expired, block the renewal.
        if (today < renewalWindowStartDate && !isExpired) {
            req.session.error = "You can only renew when your membership is within 60 days of expiring.";
            return res.redirect('/member/manage');
        }
        // *** END NEW CHECK ***


        // 2. Determine new start/end dates
        // If expired (end date < today), new term starts today. 
        // If active, it extends from the *current end date*.
        const newStartDate = isExpired ? today : currentEndDate;

        const newEndDate = new Date(newStartDate);
        newEndDate.setFullYear(newEndDate.getFullYear() + 1);

        // 3. Update the main membership table with the new end date AND the current type_id/price
        // This ensures if they renew, they renew their *current* plan
        await connection.query(
            "UPDATE membership SET end_date = ?, type_id = ? WHERE membership_id = ?",
            [newEndDate, member.type_id, memberId]
        );

        // 4. Log this renewal in the new history table
        const historySql = `
            INSERT INTO membership_purchase_history 
                (membership_id, type_id, purchase_date, price_paid, purchased_start_date, purchased_end_date)
            VALUES (?, ?, ?, ?, ?, ?)
        `;
        await connection.query(historySql, [
            memberId,
            member.type_id,
            today, // Purchase date is today
            member.base_price, // Use the price from the *current* type
            newStartDate, // The start of this new term
            newEndDate    // The end of this new term
        ]);

        await connection.commit();

        // Set a success message
        req.session.success = `Membership renewed successfully for ${member.type_name}! Your new expiration date is ${newEndDate.toLocaleDateString()}.`;
        res.redirect('/member/manage');

    } catch (error) {
        if (connection) await connection.rollback();
        console.error("Error renewing membership:", error);
        req.session.error = "An error occurred while processing your renewal."; // Use flash message
        res.redirect('/member/manage'); // Redirect back
    } finally {
        if (connection) connection.release();
    }
});


router.post('/payment/add', isMemberAuthenticated, async (req, res) => {
    const { id: memberId } = req.session.member;
    const {
        payment_method_choice, // 'card' or 'bank'
        set_as_default_card,   // 'true' or undefined
        set_as_default_bank,   // 'true' or undefined
        mock_card_brand,
        mock_card_number,
        mock_card_expiry,
        mock_routing_number,
        mock_account_number
    } = req.body;

    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        const isDefault = set_as_default_card === 'true' || set_as_default_bank === 'true';
        let finalIsDefault = isDefault;

        if (isDefault) {
            // If this new one is default, unset all others first.
            await connection.query(
                "UPDATE member_payment_methods SET is_default = FALSE WHERE membership_id = ?",
                [memberId]
            );
        } else {
            // If it's NOT set as default, check if it's the *first* card.
            // If so, force it to be default.
            const [countResult] = await connection.query(
                "SELECT COUNT(*) as count FROM member_payment_methods WHERE membership_id = ?",
                [memberId]
            );
            if (countResult[0].count === 0) {
                finalIsDefault = true;
            }
        }

        const insertSql = `
            INSERT INTO member_payment_methods 
            (membership_id, payment_type, is_default, mock_identifier, mock_expiration)
            VALUES (?, ?, ?, ?, ?)
        `;

        if (payment_method_choice === 'card') {
            const cardDigits = (mock_card_number || '').replace(/\D/g, '');
            const lastFour = cardDigits.slice(-4);
            const identifier = `${mock_card_brand || 'Card'} ending in ${lastFour}`;

            await connection.query(insertSql, [
                memberId, 'Card', finalIsDefault, identifier, mock_card_expiry || null
            ]);

        } else if (payment_method_choice === 'bank') {
            const accountDigits = (mock_account_number || '').replace(/\D/g, '');
            const lastFour = accountDigits.slice(-4);
            const identifier = `Bank Account ending in ${lastFour}`;

            await connection.query(insertSql, [
                memberId, 'Bank', finalIsDefault, identifier, null
            ]);
        }

        await connection.commit();
        res.redirect('/member/manage');

    } catch (error) {
        if (connection) await connection.rollback();
        console.error("Error adding payment method:", error);
        // In a real app, you'd use a flash message to show the error
        res.redirect('/member/manage');
    } finally {
        if (connection) connection.release();
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