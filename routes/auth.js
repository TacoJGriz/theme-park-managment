const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const pool = require('../db');
const crypto = require('crypto');
const {
    isAuthenticated,
    isGuest,
    formatPhoneNumber
} = require('../middleware/auth');

const saltRounds = 10;

// signup form
router.get('/signup', isGuest, async (req, res) => {
    try {
        const {
            type: type_id
        } = req.query;
        if (!type_id) {
            return res.redirect('/');
        }

        const [typeResult] = await pool.query(
            'SELECT * FROM membership_type WHERE public_type_id = ? AND is_active = TRUE',
            [type_id]
        );

        if (typeResult.length === 0) {
            return res.redirect('/');
        }

        res.render('member-signup', {
            type: typeResult[0],
            error: null
        });

    } catch (error) {
        console.error("Error loading signup page:", error);
        res.redirect('/');
    }
});

// process registration
router.post('/signup', isGuest, async (req, res) => {
    const {
        type_id,
        first_name,
        last_name,
        date_of_birth,
        email,
        password,
        confirm_password,
        payment_method_choice,
        save_payment_card,
        save_payment_bank,
        mock_card_brand,
        mock_card_number,
        mock_card_expiry,
        mock_account_number
    } = req.body;

    const subFirstNames = [].concat(req.body.sub_first_name || []);
    const subLastNames = [].concat(req.body.sub_last_name || []);
    const subDobs = [].concat(req.body.sub_dob || []);
    const formattedPhoneNumber = formatPhoneNumber(req.body.phone_number);

    let type;
    let connection;

    try {
        connection = await pool.getConnection();

        const [typeResult] = await connection.query('SELECT * FROM membership_type WHERE type_id = ?', [type_id]);
        if (typeResult.length === 0) {
            throw new Error("Invalid membership type submitted.");
        }
        type = typeResult[0];

        if (password !== confirm_password) {
            throw new Error("Passwords do not match.");
        }

        const [empEmail] = await connection.query('SELECT employee_id FROM employee_demographics WHERE email = ?', [email]);
        const [memEmail] = await connection.query('SELECT membership_id FROM membership WHERE email = ?', [email]);

        if (empEmail.length > 0 || memEmail.length > 0) {
            throw new Error("This email address is already in use.");
        }

        const totalMembers = 1 + subFirstNames.length;
        const additionalMembers = Math.max(0, totalMembers - type.base_members);
        const finalPrice = parseFloat(type.base_price) + (additionalMembers * (parseFloat(type.additional_member_price) || 0));

        await connection.beginTransaction();

        let newPrimaryMemberId;
        const purchaseDate = new Date();
        const endDate = new Date(new Date().setFullYear(purchaseDate.getFullYear() + 1));
        const publicMemberId = crypto.randomUUID();
        const publicPurchaseId = crypto.randomUUID();
        let newPaymentMethodId = null;
        let paymentIdentifier = 'N/A';

        const memSql = `
            INSERT INTO membership (public_membership_id, first_name, last_name, email, phone_number, date_of_birth, type_id, start_date, end_date, primary_member_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
        `;
        const [memResult] = await connection.query(memSql, [
            publicMemberId,
            first_name, last_name, email, formattedPhoneNumber, date_of_birth, type_id, purchaseDate, endDate
        ]);
        newPrimaryMemberId = memResult.insertId;

        const hash = await bcrypt.hash(password, saltRounds);
        const authSql = "INSERT INTO member_auth (membership_id, password_hash) VALUES (?, ?)";
        await connection.query(authSql, [newPrimaryMemberId, hash]);

        const shouldSaveCard = (payment_method_choice === 'card' && save_payment_card === 'true');
        const shouldSaveBank = (payment_method_choice === 'bank' && save_payment_bank === 'true');

        if (payment_method_choice === 'card') {
            const cardDigits = (mock_card_number || '').replace(/\D/g, '');
            const lastFour = cardDigits.slice(-4);
            paymentIdentifier = `${mock_card_brand || 'Card'} ending in ${lastFour}`;
        } else if (payment_method_choice === 'bank') {
            const accountDigits = (mock_account_number || '').replace(/\D/g, '');
            const lastFour = accountDigits.slice(-4);
            paymentIdentifier = `Bank Account ending in ${lastFour}`;
        }

        if (shouldSaveCard) {
            const publicPaymentId = crypto.randomUUID();
            const [paymentResult] = await connection.query(
                `INSERT INTO member_payment_methods (public_payment_id, membership_id, payment_type, is_default, mock_identifier, mock_expiration)
                 VALUES (?, ?, 'Card', TRUE, ?, ?)`,
                [publicPaymentId, newPrimaryMemberId, paymentIdentifier, mock_card_expiry || null]
            );
            newPaymentMethodId = paymentResult.insertId;

        } else if (shouldSaveBank) {
            const publicPaymentId = crypto.randomUUID();
            const [paymentResult] = await connection.query(
                `INSERT INTO member_payment_methods (public_payment_id, membership_id, payment_type, is_default, mock_identifier, mock_expiration)
                 VALUES (?, ?, 'Bank', TRUE, ?, NULL)`,
                [publicPaymentId, newPrimaryMemberId, paymentIdentifier]
            );
            newPaymentMethodId = paymentResult.insertId;
        }

        const subMemberSql = `
            INSERT INTO membership (public_membership_id, first_name, last_name, email, phone_number, date_of_birth, type_id, start_date, end_date, primary_member_id)
            VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?)
        `;
        for (let i = 0; i < subFirstNames.length; i++) {
            const publicSubMemberId = crypto.randomUUID();
            await connection.query(subMemberSql, [
                publicSubMemberId,
                subFirstNames[i],
                subLastNames[i],
                subDobs[i],
                type_id,
                purchaseDate,
                endDate,
                newPrimaryMemberId
            ]);
        }

        const historySql = `
            INSERT INTO membership_purchase_history 
                (public_purchase_id, membership_id, type_id, purchase_date, price_paid, purchased_start_date, purchased_end_date, type_name_snapshot, payment_method_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        await connection.query(historySql, [
            publicPurchaseId,
            newPrimaryMemberId,
            type.type_id,
            purchaseDate,
            finalPrice,
            purchaseDate,
            endDate,
            type.type_name,
            newPaymentMethodId
        ]);

        await connection.commit();

        req.session.regenerate(function (err) {
            if (err) {
                console.error("Session regeneration error:", err);
                throw new Error("Error creating your login session.");
            }

            req.session.member = {
                id: newPrimaryMemberId,
                firstName: first_name,
                lastName: last_name,
                email: email
            };

            const receiptData = {
                purchaseId: publicPurchaseId,
                memberName: `${first_name} ${last_name}`,
                membershipId: publicMemberId,
                typeName: type.type_name,
                endDate: endDate.toLocaleDateString(),
                pricePaid: parseFloat(finalPrice),
                paymentMethod: paymentIdentifier,
                subMembers: subFirstNames.map((firstName, index) => {
                    return {
                        firstName: firstName,
                        lastName: subLastNames[index]
                    };
                })
            };

            res.render('member-signup-success', {
                receipt: receiptData
            });
        });

    } catch (error) {
        if (connection) await connection.rollback();
        console.error("Error processing signup:", error);

        let fallbackType = {
            type_id: type_id,
            ...req.body
        };
        try {
            if (type_id) {
                const [refetchType] = await pool.query('SELECT * FROM membership_type WHERE type_id = ?', [type_id]);
                if (refetchType.length > 0) {
                    fallbackType = refetchType[0];
                }
            }
        } catch (e) {
            // ignore secondary error
        }

        res.render('member-signup', {
            type: fallbackType,
            error: error.message || "An unexpected error occurred."
        });

    } finally {
        if (connection) connection.release();
    }
});

// login view
router.get('/login', isGuest, (req, res) => {
    if (req.session.user) {
        return res.redirect('/dashboard');
    }
    res.render('global-login', {
        error: null
    });
});

// process login
router.post('/login', isGuest, async (req, res) => {
    try {
        const email = req.body.username;
        const password = req.body.password;

        const employeeQuery = `
            SELECT 
                demo.employee_id, demo.first_name, demo.last_name, demo.employee_type, 
                demo.location_id, loc.location_name, auth.password_hash
            FROM employee_demographics AS demo
            JOIN employee_auth AS auth ON demo.employee_id = auth.employee_id
            LEFT JOIN location AS loc ON demo.location_id = loc.location_id
            WHERE demo.email = ? AND demo.is_active = TRUE
        `;
        const [employeeResults] = await pool.query(employeeQuery, [email]);

        if (employeeResults.length > 0) {
            const user = employeeResults[0];
            const match = await bcrypt.compare(password, user.password_hash);

            if (match) {
                return req.session.regenerate(function (err) {
                    if (err) {
                        console.error("Session regeneration error:", err);
                        return res.status(500).render('global-login', {
                            error: 'Session error during login.'
                        });
                    }
                    req.session.user = {
                        id: user.employee_id,
                        firstName: user.first_name,
                        lastName: user.last_name,
                        role: user.employee_type,
                        locationId: user.location_id,
                        locationName: user.location_name
                    };
                    res.redirect('/dashboard');
                });
            }
        }

        const memberQuery = `
            SELECT 
                m.membership_id, m.first_name, m.last_name, m.email,
                auth.password_hash
            FROM membership AS m
            JOIN member_auth AS auth ON m.membership_id = auth.membership_id
            WHERE m.email = ?
        `;
        const [memberResults] = await pool.query(memberQuery, [email]);

        if (memberResults.length > 0) {
            const member = memberResults[0];
            const match = await bcrypt.compare(password, member.password_hash);

            if (match) {
                return req.session.regenerate(function (err) {
                    if (err) {
                        console.error("Session regeneration error:", err);
                        return res.status(500).render('global-login', {
                            error: 'Session error during login.'
                        });
                    }
                    req.session.member = {
                        id: member.membership_id,
                        firstName: member.first_name,
                        lastName: member.last_name,
                        email: member.email
                    };
                    res.redirect('/member/dashboard');
                });
            }
        }

        res.render('global-login', {
            error: 'Invalid email or password'
        });

    } catch (error) {
        console.error("Global login error:", error);
        return res.status(500).render('global-login', {
            error: 'An unexpected error occurred. Please try again later.'
        });
    }
});

// logout
router.get('/employee/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            console.error("Logout error:", err);
            return res.redirect('/dashboard');
        }
        res.clearCookie('connect.sid');
        res.redirect('/');
    });
});

// change password view
router.get('/change-password', isAuthenticated, (req, res) => {
    res.render('change-password', {
        error: null,
        success: null
    });
});

// process password change
router.post('/change-password', isAuthenticated, async (req, res) => {
    const {
        old_password,
        new_password,
        confirm_password
    } = req.body;
    const employeeId = req.session.user.id;

    if (new_password !== confirm_password) {
        return res.render('change-password', {
            error: "New passwords do not match.",
            success: null
        });
    }

    let connection;
    try {
        connection = await pool.getConnection();

        const [authResult] = await connection.query('SELECT password_hash FROM employee_auth WHERE employee_id = ?', [employeeId]);
        if (authResult.length === 0) {
            return res.render('change-password', {
                error: "Could not find user authentication record.",
                success: null
            });
        }
        const currentHash = authResult[0].password_hash;

        const match = await bcrypt.compare(old_password, currentHash);
        if (!match) {
            return res.render('change-password', {
                error: "Incorrect old password.",
                success: null
            });
        }

        const newHash = await bcrypt.hash(new_password, saltRounds);
        await connection.query('UPDATE employee_auth SET password_hash = ? WHERE employee_id = ?', [newHash, employeeId]);

        res.render('change-password', {
            error: null,
            success: "Password updated successfully!"
        });

    } catch (error) {
        console.error("Error changing password:", error);
        res.render('change-password', {
            error: "A database error occurred. Please try again.",
            success: null
        });
    } finally {
        if (connection) connection.release();
    }
});

module.exports = router;