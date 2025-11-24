const express = require('express');
const router = express.Router();
const pool = require('../db');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const {
    isMemberAuthenticated,
    isGuest,
    formatReceiptDate,
    censorPhone,
    formatPhoneNumber
} = require('../middleware/auth');

const saltRounds = 10;

// login redirect
router.get('/login', isGuest, (req, res) => {
    res.redirect('/login');
});

// register form
router.get('/register', isGuest, (req, res) => {
    res.render('member-register', {
        error: null
    });
});

// process registration
router.post('/register', isGuest, async (req, res) => {
    const {
        membership_id,
        email,
        password,
        confirm_password
    } = req.body;
    if (password !== confirm_password) {
        return res.render('member-register', {
            error: 'Passwords do not match.'
        });
    }
    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        const [memberResult] = await connection.query(
            'SELECT * FROM membership WHERE public_membership_id LIKE ? AND email = ?',
            [`${membership_id}%`, email]
        );
        if (memberResult.length === 0) {
            throw new Error('Invalid Membership ID or Email. Please check your member card.');
        }

        const internal_member_id = memberResult[0].membership_id;

        const [authResult] = await connection.query(
            'SELECT * FROM member_auth WHERE membership_id = ?',
            [internal_member_id]
        );
        if (authResult.length > 0) {
            throw new Error('An account has already been created for this membership.');
        }

        const hash = await bcrypt.hash(password, saltRounds);
        await connection.query(
            'INSERT INTO member_auth (membership_id, password_hash) VALUES (?, ?)',
            [internal_member_id, hash]
        );
        await connection.commit();
        res.redirect('/login');
    } catch (error) {
        if (connection) await connection.rollback();
        console.error("Error registering member:", error);
        res.render('member-register', {
            error: error.message
        });
    } finally {
        if (connection) connection.release();
    }
});

// logout
router.get('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            console.error("Member logout error:", err);
        }
        res.clearCookie('connect.sid');
        res.redirect('/');
    });
});

// dashboard
router.get('/dashboard', isMemberAuthenticated, async (req, res) => {
    try {
        const memberId = req.session.member.id;
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

        const [visitResult] = await pool.query(
            "SELECT COUNT(*) as count, MAX(visit_date) as last_visit FROM visits WHERE membership_id = ?",
            [memberId]
        );
        const visitCount = visitResult[0].count || 0;
        const lastVisitDate = visitResult[0].last_visit ? new Date(visitResult[0].last_visit) : null;

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
                startDate: memberData.start_date || new Date(),
                typeName: memberData.type_name,
                status: memberData.member_status
            },
            visitCount,
            lastVisitDate,
            showRenewalBanner,
            hasPaymentMethods
        });
    } catch (error) {
        console.error("Error fetching member dashboard:", error);
        res.status(500).send('Error loading dashboard.');
    }
});

// visit history
router.get('/history', isMemberAuthenticated, async (req, res) => {
    const memberId = req.session.member.id;
    let connection;
    try {
        connection = await pool.getConnection();

        const [memberInfo] = await pool.query('SELECT first_name, last_name FROM membership WHERE membership_id = ?', [memberId]);
        const member = {
            firstName: memberInfo[0].first_name,
            lastName: memberInfo[0].last_name
        };

        const [memberGroup] = await connection.query(
            'SELECT primary_member_id FROM membership WHERE membership_id = ?',
            [memberId]
        );
        const primaryId = memberGroup[0].primary_member_id || memberId;

        const [allGroupIds] = await connection.query(
            'SELECT membership_id FROM membership WHERE membership_id = ? OR primary_member_id = ?',
            [primaryId, primaryId]
        );
        const memberGroupIds = allGroupIds.map(m => m.membership_id);

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
            member,
            visits
        });
    } catch (error) {
        console.error("Error fetching member visit history:", error);
        res.status(500).send('Error loading page.');
    } finally {
        if (connection) connection.release();
    }
});

// receipt detail
router.get('/history/receipt-group/:visit_group_id', isMemberAuthenticated, async (req, res) => {
    const {
        visit_group_id
    } = req.params;
    const memberId = req.session.member.id;
    let connection;

    try {
        connection = await pool.getConnection();

        const [visitsInGroup] = await connection.query(`
            SELECT 
                v.*, 
                tt.type_name AS ticket_name,
                CONCAT(e.first_name, ' ', e.last_name) as staff_name,
                m.primary_member_id, m.first_name, m.last_name, m.phone_number,
                m.public_membership_id
            FROM visits v
            JOIN membership m ON v.membership_id = m.membership_id
            JOIN ticket_types tt ON v.ticket_type_id = tt.ticket_type_id
            LEFT JOIN employee_demographics e ON v.logged_by_employee_id = e.employee_id
            WHERE v.visit_group_id = ?
        `, [visit_group_id]);

        if (visitsInGroup.length === 0) {
            return res.status(404).send('Visit not found.');
        }

        const [myGroup] = await connection.query('SELECT primary_member_id FROM membership WHERE membership_id = ?', [memberId]);
        const myPrimaryId = myGroup[0].primary_member_id || memberId;

        const visitPrimaryId = visitsInGroup[0].primary_member_id || visitsInGroup.find(v => v.primary_member_id === null).membership_id;

        if (myPrimaryId !== visitPrimaryId) {
            return res.status(403).send('Forbidden: You can only view receipts for your own membership group.');
        }

        const [primaryMemberData] = await connection.query(`
            SELECT m.first_name, m.last_name, m.phone_number, m.public_membership_id, mt.type_name
            FROM membership m
            JOIN membership_type mt ON m.type_id = mt.type_id
            WHERE m.membership_id = ?
        `, [visitPrimaryId]);
        const primaryMember = primaryMemberData[0];

        const receiptData = {
            visit_ids: [],
            visit_group_id: visit_group_id,
            visit_date: formatReceiptDate(visitsInGroup[0].visit_date),
            ticket_name: visitsInGroup[0].ticket_name,
            base_price: 0.00,
            discount_amount: 0.00,
            total_cost: 0.00,
            promo_applied: 'N/A',
            is_member: true,
            staff_name: visitsInGroup[0].staff_name || 'N/A',
            member_id: primaryMember.public_membership_id,
            member_name: `${primaryMember.first_name} ${primaryMember.last_name}`,
            member_type: primaryMember.type_name,
            member_phone: censorPhone(primaryMember.phone_number),
            subMembers: visitsInGroup
                .filter(v => v.membership_id !== visitPrimaryId)
                .map(v => ({
                    first_name: v.first_name,
                    last_name: v.last_name,
                    membership_id: v.public_membership_id
                }))
        };

        res.render('member-visit-receipt', {
            receipt: receiptData
        });

    } catch (error) {
        console.error("Error fetching receipt group:", error);
        res.status(500).send("Error loading receipt.");
    } finally {
        if (connection) connection.release();
    }
});

// account management
router.get('/manage', isMemberAuthenticated, async (req, res) => {
    const memberId = req.session.member.id;
    try {
        const [memberResult] = await pool.query(`
            SELECT 
                m.membership_id, m.first_name, m.last_name, m.end_date, m.primary_member_id,
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

        if (memberResult.length === 0) {
            return res.redirect('/member/logout');
        }

        const member = memberResult[0];
        const isPrimaryMember = member.primary_member_id === null;

        let familyMembers = [];
        let paymentMethods = [];
        let canRenew = false;

        if (isPrimaryMember) {
            const today = new Date();
            const endDate = new Date(member.end_date);
            const renewalWindowStartDate = new Date(endDate);
            renewalWindowStartDate.setDate(endDate.getDate() - 60);
            const isExpired = endDate < today;
            canRenew = (today >= renewalWindowStartDate) || isExpired;

            [paymentMethods] = await pool.query(
                `SELECT * FROM member_payment_methods 
                 WHERE membership_id = ? 
                 ORDER BY is_default DESC, payment_method_id ASC`,
                [memberId]
            );

            [familyMembers] = await pool.query(
                "SELECT *, public_membership_id FROM membership WHERE primary_member_id = ?",
                [memberId]
            );

        } else {
            const [primaryMember] = await pool.query(
                "SELECT *, public_membership_id FROM membership WHERE membership_id = ?",
                [member.primary_member_id]
            );
            const [siblingMembers] = await pool.query(
                "SELECT *, public_membership_id FROM membership WHERE primary_member_id = ? AND membership_id != ?",
                [member.primary_member_id, memberId]
            );
            familyMembers = primaryMember.concat(siblingMembers);
        }

        member.public_id = member.public_membership_id;

        res.render('member-manage-account', {
            member,
            isPrimaryMember,
            familyMembers,
            paymentMethods,
            canRenew,
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

// purchase history list
router.get('/purchases', isMemberAuthenticated, async (req, res) => {
    const memberId = req.session.member.id;
    try {
        const [purchases] = await pool.query(`
            SELECT 
                h.purchase_id,
                h.public_purchase_id,
                h.purchase_date,
                h.price_paid,
                h.purchased_start_date,
                h.purchased_end_date,
                h.type_name_snapshot 
            FROM membership_purchase_history h
            WHERE h.membership_id = ?
            ORDER BY h.purchase_date DESC
        `, [memberId]);

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

// purchase receipt detail
router.get('/purchases/receipt/:public_purchase_id', isMemberAuthenticated, async (req, res) => {
    const memberId = req.session.member.id;
    const {
        public_purchase_id
    } = req.params;

    try {
        const [purchaseResult] = await pool.query(`
            SELECT 
                h.purchase_id, h.public_purchase_id, h.purchase_date, h.price_paid, 
                h.purchased_start_date, h.purchased_end_date,
                h.type_name_snapshot,
                m.membership_id, m.public_membership_id, m.first_name, m.last_name,
                pm.mock_identifier AS payment_method_name
            FROM membership_purchase_history h
            JOIN membership m ON h.membership_id = m.membership_id
            LEFT JOIN member_payment_methods pm ON h.payment_method_id = pm.payment_method_id
            WHERE h.public_purchase_id = ? AND h.membership_id = ?
        `, [public_purchase_id, memberId]);

        if (purchaseResult.length === 0) {
            return res.status(404).send("Purchase receipt not found or access denied.");
        }

        const purchaseData = {
            ...purchaseResult[0],
            type_name: purchaseResult[0].type_name_snapshot
        };

        const [subMembers] = await pool.query(
            `SELECT membership_id, public_membership_id, first_name, last_name
             FROM membership 
             WHERE primary_member_id = ?`,
            [purchaseData.membership_id]
        );

        purchaseData.subMembers = subMembers;
        purchaseData.membership_id_display = purchaseData.public_membership_id;

        res.render('member-purchase-receipt-detail', {
            purchase: purchaseData
        });

    } catch (error) {
        console.error("Error fetching purchase receipt:", error);
        res.status(500).send("Error loading receipt.");
    }
});

// renewal form
router.get('/renew', isMemberAuthenticated, async (req, res) => {
    const memberId = req.session.member.id;
    try {
        const [paymentMethods] = await pool.query(
            "SELECT * FROM member_payment_methods WHERE membership_id = ? ORDER BY is_default DESC",
            [memberId]
        );

        if (paymentMethods.length === 0) {
            req.session.error = "You must add a payment method before you can renew.";
            return res.redirect('/member/manage');
        }

        const [memberResult] = await pool.query(
            `SELECT m.type_id, m.end_date, mt.base_price, mt.type_name,
             (SELECT COUNT(*) FROM membership WHERE primary_member_id = m.membership_id) as sub_member_count
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
        const isExpired = currentEndDate < today;
        const newStartDate = isExpired ? today : currentEndDate;
        const newEndDate = new Date(newStartDate);
        newEndDate.setFullYear(newEndDate.getFullYear() + 1);

        const [typeResult] = await pool.query('SELECT * FROM membership_type WHERE type_id = ?', [member.type_id]);
        const type = typeResult[0];
        const totalMembers = 1 + member.sub_member_count;
        const additionalMembers = Math.max(0, totalMembers - type.base_members);
        const finalPrice = parseFloat(type.base_price) + (additionalMembers * (parseFloat(type.additional_member_price) || 0));

        res.render('member-renew', {
            renewal: {
                type_name: member.type_name,
                base_price: finalPrice,
                new_end_date: newEndDate.toLocaleDateString()
            },
            paymentMethods,
            error: null
        });

    } catch (error) {
        console.error("Error loading renewal page:", error);
        req.session.error = "An error occurred while loading the renewal page.";
        res.redirect('/member/manage');
    }
});

// process renewal
router.post('/renew', isMemberAuthenticated, async (req, res) => {
    const memberId = req.session.member.id;
    const {
        payment_method_id
    } = req.body;
    let connection;

    try {
        if (!payment_method_id) {
            throw new Error("You must select a payment method.");
        }

        connection = await pool.getConnection();
        await connection.beginTransaction();

        const [memberResult] = await connection.query(
            `SELECT m.type_id, m.end_date, mt.*,
             (SELECT COUNT(*) FROM membership WHERE primary_member_id = m.membership_id) as sub_member_count
             FROM membership m
             JOIN membership_type mt ON m.type_id = mt.type_id
             WHERE m.membership_id = ?`,
            [memberId]
        );

        if (memberResult.length === 0) {
            throw new Error("Member not found.");
        }
        const member = memberResult[0];
        const type = member;

        const [paymentResult] = await connection.query(
            "SELECT * FROM member_payment_methods WHERE payment_method_id = ? AND membership_id = ?",
            [payment_method_id, memberId]
        );
        if (paymentResult.length === 0) {
            throw new Error("Invalid payment method selected.");
        }

        const currentEndDate = new Date(member.end_date);
        const today = new Date();

        const renewalWindowStartDate = new Date(currentEndDate);
        renewalWindowStartDate.setDate(currentEndDate.getDate() - 60);
        const isExpired = currentEndDate < today;
        if (today < renewalWindowStartDate && !isExpired) {
            req.session.error = "You can only renew when your membership is within 60 days of expiring.";
            return res.redirect('/member/manage');
        }

        const newStartDate = isExpired ? today : currentEndDate;
        const newEndDate = new Date(newStartDate);
        newEndDate.setFullYear(newEndDate.getFullYear() + 1);

        const totalMembers = 1 + member.sub_member_count;
        const additionalMembers = Math.max(0, totalMembers - type.base_members);
        const finalPrice = parseFloat(type.base_price) + (additionalMembers * (parseFloat(type.additional_member_price) || 0));

        await connection.query(
            "UPDATE membership SET end_date = ? WHERE membership_id = ? OR primary_member_id = ?",
            [newEndDate, memberId, memberId]
        );

        const publicPurchaseId = crypto.randomUUID();
        const historySql = `
            INSERT INTO membership_purchase_history 
                (public_purchase_id, membership_id, type_id, purchase_date, price_paid, purchased_start_date, purchased_end_date, type_name_snapshot, payment_method_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        await connection.query(historySql, [
            publicPurchaseId,
            memberId,
            member.type_id,
            today,
            finalPrice,
            newStartDate,
            newEndDate,
            member.type_name,
            payment_method_id
        ]);

        await connection.commit();

        req.session.success = `Membership renewed successfully for ${member.type_name}! Your new expiration date is ${newEndDate.toLocaleDateString()}.`;
        res.redirect('/member/manage');

    } catch (error) {
        if (connection) await connection.rollback();
        console.error("Error renewing membership:", error);

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
                paymentMethods,
                error: error.message
            });
        } catch (renderError) {
            req.session.error = "An error occurred while processing your renewal.";
            res.redirect('/member/manage');
        }
    } finally {
        if (connection) connection.release();
    }
});

// edit profile form
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

// update profile
router.post('/edit', isMemberAuthenticated, async (req, res) => {
    const memberId = req.session.member.id;
    const {
        first_name,
        last_name,
        date_of_birth
    } = req.body;
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

        req.session.member.firstName = first_name;
        req.session.member.lastName = last_name;

        req.session.success = "Your profile has been updated successfully.";
        res.redirect('/member/manage');

    } catch (error) {
        console.error("Error updating member profile:", error);
        try {
            const [memberResult] = await pool.query(
                "SELECT first_name, last_name, email, phone_number, date_of_birth FROM membership WHERE membership_id = ?",
                [memberId]
            );
            res.render('member-edit-profile', {
                member: memberResult[0] || {
                    email: req.session.member.email
                },
                error: error.message
            });
        } catch (fetchError) {
            res.redirect('/member/manage');
        }
    }
});

// change password form
router.get('/change-password', isMemberAuthenticated, (req, res) => {
    res.render('member-change-password', {
        error: null,
        success: null
    });
});

// process password change
router.post('/change-password', isMemberAuthenticated, async (req, res) => {
    const {
        old_password,
        new_password,
        confirm_password
    } = req.body;
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

// add payment method
router.post('/payment/add', isMemberAuthenticated, async (req, res) => {
    const {
        id: memberId
    } = req.session.member;
    const {
        payment_method_choice,
        set_as_default_card,
        set_as_default_bank,
        mock_card_brand,
        mock_card_number,
        mock_card_expiry,
        mock_account_number
    } = req.body;

    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        const isDefault = set_as_default_card === 'true' || set_as_default_bank === 'true';
        let finalIsDefault = isDefault;
        const publicPaymentId = crypto.randomUUID();

        if (isDefault) {
            await connection.query(
                "UPDATE member_payment_methods SET is_default = FALSE WHERE membership_id = ?",
                [memberId]
            );
        } else {
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
        `;

        if (payment_method_choice === 'card') {
            const cardDigits = (mock_card_number || '').replace(/\D/g, '');
            const lastFour = cardDigits.slice(-4);
            const identifier = `${mock_card_brand || 'Card'} ending in ${lastFour}`;

            await connection.query(insertSql, [
                publicPaymentId, memberId, 'Card', finalIsDefault, identifier, mock_card_expiry || null
            ]);

        } else if (payment_method_choice === 'bank') {
            const accountDigits = (mock_account_number || '').replace(/\D/g, '');
            const lastFour = accountDigits.slice(-4);
            const identifier = `Bank Account ending in ${lastFour}`;

            await connection.query(insertSql, [
                publicPaymentId, memberId, 'Bank', finalIsDefault, identifier, null
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

// delete payment method
router.post('/payment/delete/:public_payment_id', isMemberAuthenticated, async (req, res) => {
    const memberId = req.session.member.id;
    const {
        public_payment_id
    } = req.params;
    try {
        await pool.query(
            "DELETE FROM member_payment_methods WHERE public_payment_id = ? AND membership_id = ?",
            [public_payment_id, memberId]
        );
        req.session.success = "Payment method deleted.";
        res.redirect('/member/manage');
    } catch (error) {
        console.error("Error deleting payment method:", error);
        res.status(500).send("Error processing request.");
    }
});

// set default payment
router.post('/payment/default/:public_payment_id', isMemberAuthenticated, async (req, res) => {
    const memberId = req.session.member.id;
    const {
        public_payment_id
    } = req.params;
    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();
        await connection.query(
            "UPDATE member_payment_methods SET is_default = FALSE WHERE membership_id = ?",
            [memberId]
        );
        await connection.query(
            "UPDATE member_payment_methods SET is_default = TRUE WHERE public_payment_id = ? AND membership_id = ?",
            [public_payment_id, memberId]
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

// sub-member edit form
router.get('/edit-sub/:public_membership_id', isMemberAuthenticated, async (req, res) => {
    const primaryMemberId = req.session.member.id;
    const {
        public_membership_id
    } = req.params;

    try {
        const [subResult] = await pool.query(
            "SELECT * FROM membership WHERE public_membership_id = ? AND primary_member_id = ?",
            [public_membership_id, primaryMemberId]
        );

        if (subResult.length === 0) {
            req.session.error = "You do not have permission to edit this member.";
            return res.redirect('/member/manage');
        }

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

// process sub-member update
router.post('/edit-sub/:public_membership_id', isMemberAuthenticated, async (req, res) => {
    const primaryMemberId = req.session.member.id;
    const {
        public_membership_id
    } = req.params;
    const {
        first_name,
        last_name,
        date_of_birth
    } = req.body;

    let subMember;
    try {
        const [subResult] = await pool.query(
            "SELECT * FROM membership WHERE public_membership_id = ? AND primary_member_id = ?",
            [public_membership_id, primaryMemberId]
        );

        if (subResult.length === 0) {
            req.session.error = "You do not have permission to edit this member.";
            return res.redirect('/member/manage');
        }
        subMember = subResult[0];

        await pool.query(
            "UPDATE membership SET first_name = ?, last_name = ?, date_of_birth = ? WHERE public_membership_id = ?",
            [first_name, last_name, date_of_birth, public_membership_id]
        );

        req.session.success = `Profile for ${first_name} ${last_name} updated.`;
        res.redirect('/member/manage');

    } catch (error) {
        console.error("Error updating sub-member:", error);
        res.render('member-edit-sub-profile', {
            subMember: subMember || {
                ...req.body,
                public_membership_id: public_membership_id
            },
            error: "An error occurred while updating the profile."
        });
    }
});

module.exports = router;