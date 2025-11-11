const express = require('express');
const router = express.Router();
const pool = require('../db');
const bcrypt = require('bcrypt');
const {
    isMemberAuthenticated,
    isGuest,
    formatReceiptDate,
    censorPhone,
    formatPhoneNumber
} = require('../middleware/auth');

const saltRounds = 10;

// --- MEMBER-FACING PORTAL ---
// All routes are prefixed with /member by app.js

// ... (routes /login, /register, /logout, /dashboard, /history, /promotions, /history/receipt are all unchanged) ...

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
        // const saltRounds = 10; // Moved to top of file
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

        // *** Renewal eligibility check ***
        const [paymentResult] = await pool.query(
            "SELECT COUNT(*) as count FROM member_payment_methods WHERE membership_id = ?",
            [memberId]
        );
        const hasPaymentMethods = paymentResult[0].count > 0;

        const today = new Date();
        const endDate = new Date(memberData.end_date);
        const renewalWindowStartDate = new Date(endDate);
        renewalWindowStartDate.setDate(endDate.getDate() - 60);

        const isExpired = endDate < today;
        const canRenew = (today >= renewalWindowStartDate) || isExpired;

        const showRenewalBanner = canRenew; // Show banner if they are eligible

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
            },
            showRenewalBanner: showRenewalBanner, // Pass new variable
            hasPaymentMethods: hasPaymentMethods  // Pass new variable
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
                m.membership_id, m.first_name, m.last_name, m.end_date, m.primary_member_id,
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

        const member = memberResult[0];
        const isPrimaryMember = member.primary_member_id === null;

        let familyMembers = [];
        let paymentMethods = [];
        let canRenew = false;

        // --- NEW: Determine the ID to use for fetching group info ---
        // If I'm primary, use my ID. If I'm a sub-member, use my primary_member_id.
        const primaryIdForGroup = member.primary_member_id || memberId;

        if (isPrimaryMember) {
            // --- Logged in as PRIMARY ---
            // 1. Check renewal eligibility
            const today = new Date();
            const endDate = new Date(member.end_date);
            const renewalWindowStartDate = new Date(endDate);
            renewalWindowStartDate.setDate(endDate.getDate() - 60);
            const isExpired = endDate < today;
            canRenew = (today >= renewalWindowStartDate) || isExpired;

            // 2. Fetch payment methods
            [paymentMethods] = await pool.query(
                `SELECT * FROM member_payment_methods 
                 WHERE membership_id = ? 
                 ORDER BY is_default DESC, payment_method_id ASC`,
                [memberId]
            );

            // 3. Fetch sub-members
            [familyMembers] = await pool.query(
                "SELECT * FROM membership WHERE primary_member_id = ?",
                [memberId]
            );

        } else {
            // --- Logged in as SUB-MEMBER ---
            // 1. Fetch primary member
            const [primaryMember] = await pool.query(
                "SELECT * FROM membership WHERE membership_id = ?",
                [member.primary_member_id]
            );
            // 2. Fetch "sibling" members (other subs, excluding self)
            const [siblingMembers] = await pool.query(
                "SELECT * FROM membership WHERE primary_member_id = ? AND membership_id != ?",
                [member.primary_member_id, memberId]
            );
            familyMembers = primaryMember.concat(siblingMembers);
        }

        res.render('member-manage-account', {
            member: member,
            isPrimaryMember: isPrimaryMember, // Pass flag to view
            familyMembers: familyMembers, // Pass group list to view
            paymentMethods: paymentMethods, // Will be [] for sub-members
            canRenew: canRenew, // Will be false for sub-members
            success: req.session.success,
            error: req.session.error
        });
        req.session.success = null;
        req.session.error = null;
    } catch (error) {
        console.error("Error loading manage account page:", error);
        res.status(500).send("Error loading page.");
    }
});

// GET /member/purchases
// ... (This route is unchanged) ...
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
                h.type_name_snapshot 
            FROM membership_purchase_history h
            WHERE h.membership_id = ?
            ORDER BY h.purchase_date DESC
        `, [memberId]);

        // Use type_name_snapshot from history table
        const mappedPurchases = purchases.map(p => ({
            ...p,
            type_name: p.type_name_snapshot
        }));

        res.render('member-purchase-history', {
            purchases: mappedPurchases
        });

    } catch (error) {
        console.error("Error fetching purchase history:", error);
        res.status(500).send("Error loading history.");
    }
});

// GET /member/purchases/receipt/:purchase_id
// ... (This route is unchanged) ...
router.get('/purchases/receipt/:purchase_id', isMemberAuthenticated, async (req, res) => {
    const memberId = req.session.member.id;
    const { purchase_id } = req.params;

    try {
        const [purchaseResult] = await pool.query(`
            SELECT 
                h.purchase_id, h.purchase_date, h.price_paid, 
                h.purchased_start_date, h.purchased_end_date,
                h.type_name_snapshot,
                m.membership_id, m.first_name, m.last_name,
                pm.mock_identifier AS payment_method_name
            FROM membership_purchase_history h
            JOIN membership m ON h.membership_id = m.membership_id
            LEFT JOIN member_payment_methods pm ON h.payment_method_id = pm.payment_method_id
            WHERE h.purchase_id = ? AND h.membership_id = ?
        `, [purchase_id, memberId]);

        if (purchaseResult.length === 0) {
            // Not found or doesn't belong to this member
            return res.status(404).send("Purchase receipt not found or access denied.");
        }

        // Map snapshot name to the view
        const purchaseData = {
            ...purchaseResult[0],
            type_name: purchaseResult[0].type_name_snapshot
        };

        const [subMembers] = await pool.query(
            `SELECT membership_id, first_name, last_name
             FROM membership 
             WHERE primary_member_id = ?`,
            [purchaseData.membership_id] // This is the primary member's ID from the query above
        );

        purchaseData.subMembers = subMembers;

        // Render a new receipt detail view
        res.render('member-purchase-receipt-detail', {
            purchase: purchaseData
        });

    } catch (error) {
        console.error("Error fetching purchase receipt:", error);
        res.status(500).send("Error loading receipt.");
    }
});


// GET /member/renew
// ... (This route is unchanged) ...
router.get('/renew', isMemberAuthenticated, async (req, res) => {
    const memberId = req.session.member.id;
    try {
        // 1. Get all payment methods
        const [paymentMethods] = await pool.query(
            "SELECT * FROM member_payment_methods WHERE membership_id = ? ORDER BY is_default DESC",
            [memberId]
        );

        // 2. If no payment methods, redirect back with an error
        if (paymentMethods.length === 0) {
            req.session.error = "You must add a payment method before you can renew.";
            return res.redirect('/member/manage');
        }

        // 3. Get member's current info to show renewal details
        const [memberResult] = await pool.query(
            `SELECT m.type_id, m.end_date, mt.base_price, mt.type_name
             FROM membership m
             JOIN membership_type mt ON m.type_id = mt.type_id
             WHERE m.membership_id = ?`,
            [memberId]
        );

        if (memberResult.length === 0) { throw new Error("Member not found."); }
        const member = memberResult[0];

        // 4. Determine new start/end dates for display
        const currentEndDate = new Date(member.end_date);
        const today = new Date();
        const isExpired = currentEndDate < today;
        const newStartDate = isExpired ? today : currentEndDate;
        const newEndDate = new Date(newStartDate);
        newEndDate.setFullYear(newEndDate.getFullYear() + 1);

        // 5. Render the new renewal page
        res.render('member-renew', {
            renewal: {
                type_name: member.type_name,
                base_price: member.base_price,
                new_end_date: newEndDate.toLocaleDateString()
            },
            paymentMethods: paymentMethods,
            error: null
        });

    } catch (error) {
        console.error("Error loading renewal page:", error);
        req.session.error = "An error occurred while loading the renewal page.";
        res.redirect('/member/manage');
    }
});


// POST /member/renew
// ... (This route is unchanged) ...
router.post('/renew', isMemberAuthenticated, async (req, res) => {
    const memberId = req.session.member.id;
    // --- NEW: Get payment method from form ---
    const { payment_method_id } = req.body;
    let connection;

    try {
        // --- NEW: Check if a payment method was selected ---
        if (!payment_method_id) {
            throw new Error("You must select a payment method.");
        }

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

        if (memberResult.length === 0) { throw new Error("Member not found."); }
        const member = memberResult[0];

        // --- NEW: Verify the selected payment method belongs to this member ---
        const [paymentResult] = await connection.query(
            "SELECT * FROM member_payment_methods WHERE payment_method_id = ? AND membership_id = ?",
            [payment_method_id, memberId]
        );
        if (paymentResult.length === 0) {
            throw new Error("Invalid payment method selected.");
        }
        // --- End verification ---

        const currentEndDate = new Date(member.end_date);
        const today = new Date();

        // *** BUSINESS RULE CHECK ***
        const renewalWindowStartDate = new Date(currentEndDate);
        renewalWindowStartDate.setDate(currentEndDate.getDate() - 60);
        const isExpired = currentEndDate < today;
        if (today < renewalWindowStartDate && !isExpired) {
            req.session.error = "You can only renew when your membership is within 60 days of expiring.";
            return res.redirect('/member/manage');
        }

        // 2. Determine new start/end dates
        const newStartDate = isExpired ? today : currentEndDate;
        const newEndDate = new Date(newStartDate);
        newEndDate.setFullYear(newEndDate.getFullYear() + 1);

        // 3. Update the main membership table
        await connection.query(
            "UPDATE membership SET end_date = ?, type_id = ? WHERE membership_id = ?",
            [newEndDate, member.type_id, memberId]
        );

        // 4. Log this renewal in the history table
        const historySql = `
            INSERT INTO membership_purchase_history 
                (membership_id, type_id, purchase_date, price_paid, purchased_start_date, purchased_end_date, type_name_snapshot, payment_method_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `;
        await connection.query(historySql, [
            memberId,
            member.type_id,
            today, // Purchase date is today
            member.base_price, // Use the price from the *current* type
            newStartDate, // The start of this new term
            newEndDate,    // The end of this new term
            member.type_name, // <-- NEW: Save snapshot of type name
            payment_method_id // <-- NEW: Save the selected payment ID
        ]);

        await connection.commit();

        req.session.success = `Membership renewed successfully for ${member.type_name}! Your new expiration date is ${newEndDate.toLocaleDateString()}.`;
        res.redirect('/member/manage');

    } catch (error) {
        if (connection) await connection.rollback();
        console.error("Error renewing membership:", error);

        // --- NEW: Error handling for this page ---
        // If it fails, we need to re-render the renewal page with the error
        try {
            const [paymentMethods] = await pool.query("SELECT * FROM member_payment_methods WHERE membership_id = ? ORDER BY is_default DESC", [memberId]);
            const [memberResult] = await pool.query("SELECT mt.type_name, mt.base_price, m.end_date FROM membership m JOIN membership_type mt ON m.type_id = mt.type_id WHERE m.membership_id = ?", [memberId]);
            const member = memberResult[0];
            const currentEndDate = new Date(member.end_date);
            const today = new Date();
            const isExpired = currentEndDate < today;
            const newStartDate = isExpired ? today : currentEndDate;
            const newEndDate = new Date(newStartDate);
            newEndDate.setFullYear(newEndDate.getFullYear() + 1);

            res.render('member-renew', {
                renewal: {
                    type_name: member.type_name,
                    base_price: member.base_price,
                    new_end_date: newEndDate.toLocaleDateString()
                },
                paymentMethods: paymentMethods,
                error: error.message // Pass the error message
            });
        } catch (renderError) {
            // Fallback if re-rendering fails
            req.session.error = "An error occurred while processing your renewal.";
            res.redirect('/member/manage');
        }
    } finally {
        if (connection) connection.release();
    }
});


// GET /member/edit
// ... (This route is unchanged) ...
router.get('/edit', isMemberAuthenticated, async (req, res) => {
    const memberId = req.session.member.id;
    try {
        const [memberResult] = await pool.query(
            "SELECT first_name, last_name, email, phone_number, date_of_birth FROM membership WHERE membership_id = ?",
            [memberId]
        );
        if (memberResult.length === 0) {
            return res.redirect('/member/logout');
        }
        res.render('member-edit-profile', {
            member: memberResult[0],
            error: null
        });
    } catch (error) {
        console.error("Error loading member edit page:", error);
        res.status(500).send("Error loading page.");
    }
});

// POST /member/edit
// ... (This route is unchanged) ...
router.post('/edit', isMemberAuthenticated, async (req, res) => {
    const memberId = req.session.member.id;
    const { first_name, last_name, date_of_birth } = req.body;
    const formattedPhoneNumber = formatPhoneNumber(req.body.phone_number);

    try {
        if (!first_name || !last_name || !date_of_birth) {
            throw new Error("First Name, Last Name, and Date of Birth are required.");
        }

        const sql = `
            UPDATE membership 
            SET first_name = ?, last_name = ?, phone_number = ?, date_of_birth = ?
            WHERE membership_id = ?
        `;
        await pool.query(sql, [
            first_name,
            last_name,
            formattedPhoneNumber,
            date_of_birth,
            memberId
        ]);

        // Update session data
        req.session.member.firstName = first_name;
        req.session.member.lastName = last_name;

        req.session.success = "Your profile has been updated successfully.";
        res.redirect('/member/manage');

    } catch (error) {
        console.error("Error updating member profile:", error);
        try {
            // Re-fetch data to render form with error
            const [memberResult] = await pool.query(
                "SELECT first_name, last_name, email, phone_number, date_of_birth FROM membership WHERE membership_id = ?",
                [memberId]
            );
            res.render('member-edit-profile', {
                member: memberResult[0] || { email: req.session.member.email },
                error: error.message
            });
        } catch (fetchError) {
            res.redirect('/member/manage');
        }
    }
});

// GET /member/change-password
// ... (This route is unchanged) ...
router.get('/change-password', isMemberAuthenticated, (req, res) => {
    res.render('member-change-password', { error: null, success: null });
});

// POST /member/change-password
// ... (This route is unchanged) ...
router.post('/change-password', isMemberAuthenticated, async (req, res) => {
    const { old_password, new_password, confirm_password } = req.body;
    const memberId = req.session.member.id;

    if (new_password !== confirm_password) {
        return res.render('member-change-password', {
            error: "New passwords do not match.",
            success: null
        });
    }
    if (new_password.length < 8) {
        return res.render('member-change-password', {
            error: "Password must be at least 8 characters.",
            success: null
        });
    }

    let connection;
    try {
        connection = await pool.getConnection();

        const [authResult] = await connection.query('SELECT password_hash FROM member_auth WHERE membership_id = ?', [memberId]);
        if (authResult.length === 0) {
            return res.render('member-change-password', {
                error: "Could not find user authentication record.",
                success: null
            });
        }
        const currentHash = authResult[0].password_hash;

        const match = await bcrypt.compare(old_password, currentHash);
        if (!match) {
            return res.render('member-change-password', {
                error: "Incorrect old password.",
                success: null
            });
        }

        const newHash = await bcrypt.hash(new_password, saltRounds);
        await connection.query('UPDATE member_auth SET password_hash = ? WHERE membership_id = ?', [newHash, memberId]);

        res.render('member-change-password', {
            error: null,
            success: "Password updated successfully!"
        });

    } catch (error) {
        console.error("Error changing member password:", error);
        res.render('member-change-password', {
            error: "A database error occurred. Please try again.",
            success: null
        });
    } finally {
        if (connection) connection.release();
    }
});


// --- Payment Method Routes ---
// ... (These routes are unchanged) ...
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
        req.session.success = "Payment method added successfully.";
        res.redirect('/member/manage');

    } catch (error) {
        if (connection) await connection.rollback();
        console.error("Error adding payment method:", error);
        req.session.error = "Error adding payment method.";
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
        req.session.success = "Payment method deleted.";
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
        req.session.success = "Default payment method updated.";
        res.redirect('/member/manage');
    } catch (error) {
        if (connection) await connection.rollback();
        console.error("Error setting default payment method:", error);
        res.status(500).send("Error processing request.");
    } finally {
        if (connection) connection.release();
    }
});

// GET /member/edit-sub/:id
// Renders the edit form for a sub-member
router.get('/edit-sub/:id', isMemberAuthenticated, async (req, res) => {
    const primaryMemberId = req.session.member.id;
    const subMemberId = req.params.id;

    try {
        // Security Check: Fetch the sub-member AND verify they belong to the logged-in primary member
        const [subResult] = await pool.query(
            "SELECT * FROM membership WHERE membership_id = ? AND primary_member_id = ?",
            [subMemberId, primaryMemberId]
        );

        if (subResult.length === 0) {
            req.session.error = "You do not have permission to edit this member.";
            return res.redirect('/member/manage');
        }

        // Render a new view, passing in the sub-member's data
        res.render('member-edit-sub-profile', {
            subMember: subResult[0],
            error: null
        });

    } catch (error) {
        console.error("Error loading sub-member edit page:", error);
        req.session.error = "Error loading page.";
        res.redirect('/member/manage');
    }
});

// POST /member/edit-sub/:id
// Handles the update for a sub-member
router.post('/edit-sub/:id', isMemberAuthenticated, async (req, res) => {
    const primaryMemberId = req.session.member.id;
    const subMemberId = req.params.id;
    const { first_name, last_name, date_of_birth } = req.body;

    let subMember; // To pass back to form on error
    try {
        // Security Check: Fetch the sub-member again to be 100% sure
        const [subResult] = await pool.query(
            "SELECT * FROM membership WHERE membership_id = ? AND primary_member_id = ?",
            [subMemberId, primaryMemberId]
        );

        if (subResult.length === 0) {
            req.session.error = "You do not have permission to edit this member.";
            return res.redirect('/member/manage');
        }
        subMember = subResult[0]; // For the catch block

        // Update the sub-member's details
        await pool.query(
            "UPDATE membership SET first_name = ?, last_name = ?, date_of_birth = ? WHERE membership_id = ?",
            [first_name, last_name, date_of_birth, subMemberId]
        );

        req.session.success = `Profile for ${first_name} ${last_name} updated.`;
        res.redirect('/member/manage');

    } catch (error) {
        console.error("Error updating sub-member:", error);
        // On error, re-render the edit form with the error message
        res.render('member-edit-sub-profile', {
            subMember: subMember || { ...req.body, membership_id: subMemberId },
            error: "An error occurred while updating the profile."
        });
    }
});

module.exports = router;