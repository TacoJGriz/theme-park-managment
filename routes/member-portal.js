const express = require('express');
const router = express.Router();
const pool = require('../db');
const bcrypt = require('bcrypt');
const crypto = require('crypto'); // ADDED
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

        // MODIFIED: Find member by public_membership_id
        const [memberResult] = await connection.query(
            'SELECT * FROM membership WHERE public_membership_id = ? AND email = ?',
            [membership_id, email] // The form field is now sending the public_id
        );
        if (memberResult.length === 0) {
            throw new Error('Invalid Membership ID or Email. Please check your member card.');
        }

        const internal_member_id = memberResult[0].membership_id; // Get internal ID

        const [authResult] = await connection.query(
            'SELECT * FROM member_auth WHERE membership_id = ?',
            [internal_member_id] // Check auth using internal ID
        );
        if (authResult.length > 0) {
            throw new Error('An account has already been created for this membership.');
        }

        const hash = await bcrypt.hash(password, saltRounds);
        await connection.query(
            'INSERT INTO member_auth (membership_id, password_hash) VALUES (?, ?)',
            [internal_member_id, hash] // Create auth using internal ID
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
        const memberId = req.session.member.id; // Internal ID is secure in session
        const [result] = await pool.query(`
            SELECT 
                m.first_name, m.last_name, m.email, m.phone_number, m.date_of_birth, m.end_date, m.start_date,
                m.public_membership_id,
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

        // --- Get Visit Stats (Count & Last Visit) ---
        const [visitResult] = await pool.query(
            "SELECT COUNT(*) as count, MAX(visit_date) as last_visit FROM visits WHERE membership_id = ?",
            [memberId]
        );
        const visitCount = visitResult[0].count || 0;
        const lastVisitDate = visitResult[0].last_visit ? new Date(visitResult[0].last_visit) : null;

        // Renewal eligibility check
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
        const showRenewalBanner = canRenew;

        res.render('member-dashboard', {
            member: {
                id: memberData.public_membership_id,
                firstName: memberData.first_name,
                lastName: memberData.last_name,
                email: memberData.email,
                phone: memberData.phone_number,
                dob: memberData.date_of_birth,
                endDate: memberData.end_date,
                startDate: memberData.start_date || new Date(), // Fallback if null
                typeName: memberData.type_name,
                status: memberData.member_status
            },
            visitCount: visitCount,
            lastVisitDate: lastVisitDate,
            showRenewalBanner: showRenewalBanner,
            hasPaymentMethods: hasPaymentMethods
        });
    } catch (error) {
        console.error("Error fetching member dashboard:", error);
        res.status(500).send('Error loading dashboard.');
    }
});

// GET /member/history
router.get('/history', isMemberAuthenticated, async (req, res) => {
    const memberId = req.session.member.id; // Internal ID
    let connection;
    try {
        connection = await pool.getConnection();

        // 1. Get the logged-in member's info
        const [memberInfo] = await pool.query('SELECT first_name, last_name FROM membership WHERE membership_id = ?', [memberId]);
        const member = {
            firstName: memberInfo[0].first_name,
            lastName: memberInfo[0].last_name
        };

        // 2. Find all membership IDs associated with this member's group
        const [memberGroup] = await connection.query(
            'SELECT primary_member_id FROM membership WHERE membership_id = ?',
            [memberId]
        );
        const primaryId = memberGroup[0].primary_member_id || memberId;

        const [allGroupIds] = await connection.query(
            'SELECT membership_id FROM membership WHERE membership_id = ? OR primary_member_id = ?',
            [primaryId, primaryId]
        );
        const memberGroupIds = allGroupIds.map(m => m.membership_id); // e.g., [501, 502, 503, 504]

        // 3. Fetch visits, grouping them by the visit_group_id
        const [visits] = await pool.query(`
            SELECT 
                v.visit_group_id,
                MIN(v.visit_id) as representative_visit_id,
                MIN(v.visit_date) as visit_date,
                tt.type_name,
                COUNT(v.visit_id) as group_size,
                CONCAT(e.first_name, ' ', e.last_name) as staff_name,
                SUM(v.ticket_price - v.discount_amount) as total_paid
            FROM visits v
            JOIN ticket_types tt ON v.ticket_type_id = tt.ticket_type_id
            LEFT JOIN employee_demographics e ON v.logged_by_employee_id = e.employee_id
            WHERE v.membership_id IN (?) AND v.visit_group_id IS NOT NULL
            GROUP BY v.visit_group_id, tt.type_name, e.first_name, e.last_name
            ORDER BY visit_date DESC
        `, [memberGroupIds]);

        res.render('visit-history', {
            member: member,
            visits: visits // Pass the new grouped visits
        });
    } catch (error) {
        console.error("Error fetching member visit history:", error);
        res.status(500).send('Error loading page.');
    } finally {
        if (connection) connection.release();
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

// GET /member/history/receipt-group/:visit_group_id
router.get('/history/receipt-group/:visit_group_id', isMemberAuthenticated, async (req, res) => {
    const { visit_group_id } = req.params;
    const memberId = req.session.member.id; // Logged-in user (internal ID)
    let connection;

    try {
        connection = await pool.getConnection();

        // 1. Get all visits in this group
        const [visitsInGroup] = await connection.query(`
            SELECT 
                v.*, 
                tt.type_name AS ticket_name,
                CONCAT(e.first_name, ' ', e.last_name) as staff_name,
                m.primary_member_id, m.first_name, m.last_name, m.phone_number,
                m.public_membership_id -- ADDED
            FROM visits v
            JOIN membership m ON v.membership_id = m.membership_id
            JOIN ticket_types tt ON v.ticket_type_id = tt.ticket_type_id
            LEFT JOIN employee_demographics e ON v.logged_by_employee_id = e.employee_id
            WHERE v.visit_group_id = ?
        `, [visit_group_id]);

        if (visitsInGroup.length === 0) {
            return res.status(404).send('Visit not found.');
        }

        // 2. Security Check: Find out the primary ID of the logged-in user
        const [myGroup] = await connection.query('SELECT primary_member_id FROM membership WHERE membership_id = ?', [memberId]);
        const myPrimaryId = myGroup[0].primary_member_id || memberId;

        // Find out the primary ID of the visit group
        const visitPrimaryId = visitsInGroup[0].primary_member_id || visitsInGroup.find(v => v.primary_member_id === null).membership_id;

        // If my primary ID doesn't match the visit's primary ID, deny access
        if (myPrimaryId !== visitPrimaryId) {
            return res.status(403).send('Forbidden: You can only view receipts for your own membership group.');
        }

        // 3. Get Primary Member's full data (for the receipt header)
        const [primaryMemberData] = await connection.query(`
            SELECT m.first_name, m.last_name, m.phone_number, m.public_membership_id, mt.type_name
            FROM membership m
            JOIN membership_type mt ON m.type_id = mt.type_id
            WHERE m.membership_id = ?
        `, [visitPrimaryId]);
        const primaryMember = primaryMemberData[0];

        // 4. Build the receipt object
        const receiptData = {
            visit_ids: [], // We don't show internal visit IDs anymore
            visit_group_id: visit_group_id, // This is the main receipt ID
            visit_date: formatReceiptDate(visitsInGroup[0].visit_date),
            ticket_name: visitsInGroup[0].ticket_name,
            base_price: 0.00,
            discount_amount: 0.00,
            total_cost: 0.00,
            promo_applied: 'N/A',
            is_member: true,
            staff_name: visitsInGroup[0].staff_name || 'N/A',
            member_id: primaryMember.public_membership_id, // CHANGED to public ID
            member_name: `${primaryMember.first_name} ${primaryMember.last_name}`,
            member_type: primaryMember.type_name,
            member_phone: censorPhone(primaryMember.phone_number),
            // Create sub-member list from all visits that aren't the primary member
            subMembers: visitsInGroup
                .filter(v => v.membership_id !== visitPrimaryId)
                .map(v => ({
                    first_name: v.first_name,
                    last_name: v.last_name,
                    membership_id: v.public_membership_id // CHANGED to public ID
                }))
        };

        res.render('visit-receipt', { receipt: receiptData });

    } catch (error) {
        console.error("Error fetching receipt group:", error);
        res.status(500).send("Error loading receipt.");
    } finally {
        if (connection) connection.release();
    }
});

// --- ACCOUNT MANAGEMENT & PURCHASE HISTORY ---

// GET /member/manage
router.get('/manage', isMemberAuthenticated, async (req, res) => {
    const memberId = req.session.member.id; // Internal ID
    try {
        const [memberResult] = await pool.query(`
            SELECT 
                m.membership_id, m.first_name, m.last_name, m.end_date, m.primary_member_id,
                m.public_membership_id, -- ADDED
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
                "SELECT *, public_membership_id FROM membership WHERE primary_member_id = ?", // ADDED public_membership_id
                [memberId]
            );

        } else {
            // --- Logged in as SUB-MEMBER ---
            // 1. Fetch primary member
            const [primaryMember] = await pool.query(
                "SELECT *, public_membership_id FROM membership WHERE membership_id = ?", // ADDED
                [member.primary_member_id]
            );
            // 2. Fetch "sibling" members (other subs, excluding self)
            const [siblingMembers] = await pool.query(
                "SELECT *, public_membership_id FROM membership WHERE primary_member_id = ? AND membership_id != ?", // ADDED
                [member.primary_member_id, memberId]
            );
            familyMembers = primaryMember.concat(siblingMembers);
        }

        // Pass public_membership_id to the view
        member.public_id = member.public_membership_id; // Standardize

        res.render('member-manage-account', {
            member: member, // Contains public_id
            isPrimaryMember: isPrimaryMember, // Pass flag to view
            familyMembers: familyMembers, // Pass group list to view (contains public_id)
            paymentMethods: paymentMethods, // Will be [] for sub-members (contains public_payment_id)
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
router.get('/purchases', isMemberAuthenticated, async (req, res) => {
    const memberId = req.session.member.id; // Internal ID
    try {
        const [purchases] = await pool.query(`
            SELECT 
                h.purchase_id,
                h.public_purchase_id, -- ADDED
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
            purchases: mappedPurchases // Now contains public_purchase_id
        });

    } catch (error) {
        console.error("Error fetching purchase history:", error);
        res.status(500).send("Error loading history.");
    }
});

// GET /member/purchases/receipt/:public_purchase_id
router.get('/purchases/receipt/:public_purchase_id', isMemberAuthenticated, async (req, res) => {
    const memberId = req.session.member.id; // Internal ID
    const { public_purchase_id } = req.params; // CHANGED

    try {
        const [purchaseResult] = await pool.query(`
            SELECT 
                h.purchase_id, h.public_purchase_id, h.purchase_date, h.price_paid, 
                h.purchased_start_date, h.purchased_end_date,
                h.type_name_snapshot,
                m.membership_id, m.public_membership_id, m.first_name, m.last_name, -- ADDED public_membership_id
                pm.mock_identifier AS payment_method_name
            FROM membership_purchase_history h
            JOIN membership m ON h.membership_id = m.membership_id
            LEFT JOIN member_payment_methods pm ON h.payment_method_id = pm.payment_method_id
            WHERE h.public_purchase_id = ? AND h.membership_id = ? -- CHANGED
        `, [public_purchase_id, memberId]);

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
            `SELECT membership_id, public_membership_id, first_name, last_name
             FROM membership 
             WHERE primary_member_id = ?`, // ADDED public_membership_id
            [purchaseData.membership_id] // This is the internal primary member's ID
        );

        purchaseData.subMembers = subMembers;

        // Use public_membership_id for display
        purchaseData.membership_id_display = purchaseData.public_membership_id;

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
router.get('/renew', isMemberAuthenticated, async (req, res) => {
    const memberId = req.session.member.id; // Internal ID
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
            `SELECT m.type_id, m.end_date, mt.base_price, mt.type_name,
             (SELECT COUNT(*) FROM membership WHERE primary_member_id = m.membership_id) as sub_member_count
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

        // 5. *** ADDED: Calculate correct renewal price ***
        const [typeResult] = await pool.query('SELECT * FROM membership_type WHERE type_id = ?', [member.type_id]);
        const type = typeResult[0];
        const totalMembers = 1 + member.sub_member_count;
        const additionalMembers = Math.max(0, totalMembers - type.base_members);
        const finalPrice = parseFloat(type.base_price) + (additionalMembers * (parseFloat(type.additional_member_price) || 0));

        // 6. Render the new renewal page
        res.render('member-renew', {
            renewal: {
                type_name: member.type_name,
                base_price: finalPrice, // CHANGED to finalPrice
                new_end_date: newEndDate.toLocaleDateString()
            },
            paymentMethods: paymentMethods, // Contains public_payment_id
            error: null
        });

    } catch (error) {
        console.error("Error loading renewal page:", error);
        req.session.error = "An error occurred while loading the renewal page.";
        res.redirect('/member/manage');
    }
});


// POST /member/renew
router.post('/renew', isMemberAuthenticated, async (req, res) => {
    const memberId = req.session.member.id; // Internal ID
    const { payment_method_id } = req.body; // This is the *internal* payment_method_id
    let connection;

    try {
        if (!payment_method_id) {
            throw new Error("You must select a payment method.");
        }

        connection = await pool.getConnection();
        await connection.beginTransaction();

        // 1. Get member's current info and sub-member count
        const [memberResult] = await connection.query(
            `SELECT m.type_id, m.end_date, mt.*,
             (SELECT COUNT(*) FROM membership WHERE primary_member_id = m.membership_id) as sub_member_count
             FROM membership m
             JOIN membership_type mt ON m.type_id = mt.type_id
             WHERE m.membership_id = ?`,
            [memberId]
        );

        if (memberResult.length === 0) { throw new Error("Member not found."); }
        const member = memberResult[0];
        const type = member; // The query result is the full membership_type object

        // 2. Verify the selected payment method belongs to this member
        const [paymentResult] = await connection.query(
            "SELECT * FROM member_payment_methods WHERE payment_method_id = ? AND membership_id = ?",
            [payment_method_id, memberId]
        );
        if (paymentResult.length === 0) {
            throw new Error("Invalid payment method selected.");
        }

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

        // 3. Determine new start/end dates
        const newStartDate = isExpired ? today : currentEndDate;
        const newEndDate = new Date(newStartDate);
        newEndDate.setFullYear(newEndDate.getFullYear() + 1);

        // 4. *** ADDED: Calculate correct final price ***
        const totalMembers = 1 + member.sub_member_count;
        const additionalMembers = Math.max(0, totalMembers - type.base_members);
        const finalPrice = parseFloat(type.base_price) + (additionalMembers * (parseFloat(type.additional_member_price) || 0));

        // 5. Update the main membership table AND ALL SUB-MEMBERS
        await connection.query(
            "UPDATE membership SET end_date = ? WHERE membership_id = ? OR primary_member_id = ?",
            [newEndDate, memberId, memberId]
        );

        // 6. Log this renewal in the history table
        const publicPurchaseId = crypto.randomUUID(); // ADDED
        const historySql = `
            INSERT INTO membership_purchase_history 
                (public_purchase_id, membership_id, type_id, purchase_date, price_paid, purchased_start_date, purchased_end_date, type_name_snapshot, payment_method_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        await connection.query(historySql, [
            publicPurchaseId, // ADDED
            memberId,
            member.type_id,
            today, // Purchase date is today
            finalPrice, // *** CHANGED to use calculated finalPrice ***
            newStartDate, // The start of this new term
            newEndDate,    // The end of this new term
            member.type_name,
            payment_method_id
        ]);

        await connection.commit();

        req.session.success = `Membership renewed successfully for ${member.type_name}! Your new expiration date is ${newEndDate.toLocaleDateString()}.`;
        res.redirect('/member/manage');

    } catch (error) {
        if (connection) await connection.rollback();
        console.error("Error renewing membership:", error);

        // --- NEW: Error handling for this page ---
        try {
            const [paymentMethods] = await pool.query("SELECT * FROM member_payment_methods WHERE membership_id = ? ORDER BY is_default DESC", [memberId]);
            const [memberResult] = await pool.query(
                `SELECT m.type_id, m.end_date, mt.base_price, mt.type_name,
                 (SELECT COUNT(*) FROM membership WHERE primary_member_id = m.membership_id) as sub_member_count
                 FROM membership m
                 JOIN membership_type mt ON m.type_id = mt.type_id
                 WHERE m.membership_id = ?`,
                [memberId]
            );
            const member = memberResult[0];
            const type = memberResult[0];

            const currentEndDate = new Date(member.end_date);
            const today = new Date();
            const isExpired = currentEndDate < today;
            const newStartDate = isExpired ? today : currentEndDate;
            const newEndDate = new Date(newStartDate);
            newEndDate.setFullYear(newEndDate.getFullYear() + 1);

            const totalMembers = 1 + member.sub_member_count;
            const additionalMembers = Math.max(0, totalMembers - type.base_members);
            const finalPrice = parseFloat(type.base_price) + (additionalMembers * (parseFloat(type.additional_member_price) || 0));

            res.render('member-renew', {
                renewal: {
                    type_name: member.type_name,
                    base_price: finalPrice,
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
router.get('/edit', isMemberAuthenticated, async (req, res) => {
    const memberId = req.session.member.id; // Internal ID
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
router.post('/edit', isMemberAuthenticated, async (req, res) => {
    const memberId = req.session.member.id; // Internal ID
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
router.get('/change-password', isMemberAuthenticated, (req, res) => {
    res.render('member-change-password', { error: null, success: null });
});

// POST /member/change-password
router.post('/change-password', isMemberAuthenticated, async (req, res) => {
    const { old_password, new_password, confirm_password } = req.body;
    const memberId = req.session.member.id; // Internal ID

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
router.post('/payment/add', isMemberAuthenticated, async (req, res) => {
    const { id: memberId } = req.session.member; // Internal ID
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
        const publicPaymentId = crypto.randomUUID(); // ADDED

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
            (public_payment_id, membership_id, payment_type, is_default, mock_identifier, mock_expiration)
            VALUES (?, ?, ?, ?, ?, ?)
        `; // ADDED public_payment_id

        if (payment_method_choice === 'card') {
            const cardDigits = (mock_card_number || '').replace(/\D/g, '');
            const lastFour = cardDigits.slice(-4);
            const identifier = `${mock_card_brand || 'Card'} ending in ${lastFour}`;

            await connection.query(insertSql, [
                publicPaymentId, memberId, 'Card', finalIsDefault, identifier, mock_card_expiry || null
            ]); // ADDED

        } else if (payment_method_choice === 'bank') {
            const accountDigits = (mock_account_number || '').replace(/\D/g, '');
            const lastFour = accountDigits.slice(-4);
            const identifier = `Bank Account ending in ${lastFour}`;

            await connection.query(insertSql, [
                publicPaymentId, memberId, 'Bank', finalIsDefault, identifier, null
            ]); // ADDED
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

// POST /member/payment/delete/:public_payment_id
router.post('/payment/delete/:public_payment_id', isMemberAuthenticated, async (req, res) => {
    const memberId = req.session.member.id; // Internal ID
    const { public_payment_id } = req.params; // CHANGED
    try {
        await pool.query(
            "DELETE FROM member_payment_methods WHERE public_payment_id = ? AND membership_id = ?", // CHANGED
            [public_payment_id, memberId] // CHANGED
        );
        req.session.success = "Payment method deleted.";
        res.redirect('/member/manage');
    } catch (error) {
        console.error("Error deleting payment method:", error);
        res.status(500).send("Error processing request.");
    }
});

// POST /member/payment/default/:public_payment_id
router.post('/payment/default/:public_payment_id', isMemberAuthenticated, async (req, res) => {
    const memberId = req.session.member.id; // Internal ID
    const { public_payment_id } = req.params; // CHANGED
    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();
        await connection.query(
            "UPDATE member_payment_methods SET is_default = FALSE WHERE membership_id = ?",
            [memberId]
        );
        await connection.query(
            "UPDATE member_payment_methods SET is_default = TRUE WHERE public_payment_id = ? AND membership_id = ?", // CHANGED
            [public_payment_id, memberId] // CHANGED
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

// GET /member/edit-sub/:public_membership_id
// Renders the edit form for a sub-member
router.get('/edit-sub/:public_membership_id', isMemberAuthenticated, async (req, res) => {
    const primaryMemberId = req.session.member.id; // Internal ID
    const { public_membership_id } = req.params; // CHANGED

    try {
        // Security Check: Fetch the sub-member AND verify they belong to the logged-in primary member
        const [subResult] = await pool.query(
            "SELECT * FROM membership WHERE public_membership_id = ? AND primary_member_id = ?", // CHANGED
            [public_membership_id, primaryMemberId] // CHANGED
        );

        if (subResult.length === 0) {
            req.session.error = "You do not have permission to edit this member.";
            return res.redirect('/member/manage');
        }

        // Render a new view, passing in the sub-member's data
        res.render('member-edit-sub-profile', {
            subMember: subResult[0], // Contains public_membership_id
            error: null
        });

    } catch (error) {
        console.error("Error loading sub-member edit page:", error);
        req.session.error = "Error loading page.";
        res.redirect('/member/manage');
    }
});

// POST /member/edit-sub/:public_membership_id
// Handles the update for a sub-member
router.post('/edit-sub/:public_membership_id', isMemberAuthenticated, async (req, res) => {
    const primaryMemberId = req.session.member.id; // Internal ID
    const { public_membership_id } = req.params; // CHANGED
    const { first_name, last_name, date_of_birth } = req.body;

    let subMember; // To pass back to form on error
    try {
        // Security Check: Fetch the sub-member again to be 100% sure
        const [subResult] = await pool.query(
            "SELECT * FROM membership WHERE public_membership_id = ? AND primary_member_id = ?", // CHANGED
            [public_membership_id, primaryMemberId] // CHANGED
        );

        if (subResult.length === 0) {
            req.session.error = "You do not have permission to edit this member.";
            return res.redirect('/member/manage');
        }
        subMember = subResult[0]; // For the catch block

        // Update the sub-member's details
        await pool.query(
            "UPDATE membership SET first_name = ?, last_name = ?, date_of_birth = ? WHERE public_membership_id = ?", // CHANGED
            [first_name, last_name, date_of_birth, public_membership_id] // CHANGED
        );

        req.session.success = `Profile for ${first_name} ${last_name} updated.`;
        res.redirect('/member/manage');

    } catch (error) {
        console.error("Error updating sub-member:", error);
        // On error, re-render the edit form with the error message
        res.render('member-edit-sub-profile', {
            subMember: subMember || { ...req.body, public_membership_id: public_membership_id },
            error: "An error occurred while updating the profile."
        });
    }
});

module.exports = router;