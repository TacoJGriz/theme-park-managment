const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const pool = require('../db'); // Adjust path to db.js
const {
    isAuthenticated,
    isGuest,
    formatPhoneNumber
} = require('../middleware/auth'); // Adjust path to auth.js

const saltRounds = 10;

// GET /signup
// Renders the new purchase & registration form
router.get('/signup', isGuest, async (req, res) => {
    try {
        const { type: type_id } = req.query;
        if (!type_id) {
            return res.redirect('/'); // If no type is selected, go back to homepage
        }

        // --- MODIFIED: Select all new columns ---
        const [typeResult] = await pool.query(
            'SELECT * FROM membership_type WHERE type_id = ? AND is_active = TRUE',
            [type_id]
        );

        if (typeResult.length === 0) {
            // If type is invalid or not active, go back to homepage
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

// POST /signup
// Processes the new member purchase and creates their account
router.post('/signup', isGuest, async (req, res) => {
    const {
        type_id,
        first_name,
        last_name,
        date_of_birth,
        email,
        password,
        confirm_password,
        payment_method_choice, // 'card' or 'bank'
        save_payment_card,   // 'true' or undefined
        save_payment_bank,   // 'true' or undefined
        mock_card_brand,
        mock_card_number,
        mock_card_expiry,
        mock_routing_number,
        mock_account_number
    } = req.body;

    // --- NEW: Standardize sub-member fields into arrays ---
    // [].concat ensures it's an array even if 0 or 1 are submitted
    const subFirstNames = [].concat(req.body['sub_first_name[]'] || []);
    const subLastNames = [].concat(req.body['sub_last_name[]'] || []);
    const subDobs = [].concat(req.body['sub_dob[]'] || []);

    const formattedPhoneNumber = formatPhoneNumber(req.body.phone_number);

    let type; // To re-render the page on error
    const connection = await pool.getConnection(); // Get connection early

    try {
        // Get Membership Type details
        const [typeResult] = await connection.query('SELECT * FROM membership_type WHERE type_id = ?', [type_id]);
        if (typeResult.length === 0) {
            throw new Error("Invalid membership type submitted.");
        }
        type = typeResult[0];

        // --- Validation (from form) ---
        if (password !== confirm_password) {
            throw new Error("Passwords do not match.");
        }
        // ... (other basic validations) ...

        // Check if email is already in use
        const [empEmail] = await connection.query('SELECT employee_id FROM employee_demographics WHERE email = ?', [email]);
        const [memEmail] = await connection.query('SELECT membership_id FROM membership WHERE email = ?', [email]);

        if (empEmail.length > 0 || memEmail.length > 0) {
            throw new Error("This email address is already in use.");
        }

        // --- NEW: Dynamic Price Calculation ---
        const totalMembers = 1 + subFirstNames.length;
        const additionalMembers = Math.max(0, totalMembers - type.base_members);
        const finalPrice = type.base_price + (additionalMembers * (type.additional_member_price || 0));

        // --- Database Transaction ---
        await connection.beginTransaction();

        let newPrimaryMemberId;
        const purchaseDate = new Date();
        const endDate = new Date(new Date().setFullYear(purchaseDate.getFullYear() + 1));

        let newPaymentMethodId = null;
        let paymentIdentifier = 'N/A';

        try {
            // 1. Create the PRIMARY membership record
            const memSql = `
                INSERT INTO membership (first_name, last_name, email, phone_number, date_of_birth, type_id, start_date, end_date, primary_member_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
            `;
            const [memResult] = await connection.query(memSql, [
                first_name, last_name, email, formattedPhoneNumber, date_of_birth, type_id, purchaseDate, endDate
            ]);

            newPrimaryMemberId = memResult.insertId;

            // 2. Create the member_auth record
            const hash = await bcrypt.hash(password, saltRounds);
            const authSql = "INSERT INTO member_auth (membership_id, password_hash) VALUES (?, ?)";
            await connection.query(authSql, [newPrimaryMemberId, hash]);

            // 3. Save Payment Method if checked
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
                const [paymentResult] = await connection.query(
                    `INSERT INTO member_payment_methods (membership_id, payment_type, is_default, mock_identifier, mock_expiration)
                     VALUES (?, 'Card', TRUE, ?, ?)`,
                    [newPrimaryMemberId, paymentIdentifier, mock_card_expiry || null]
                );
                newPaymentMethodId = paymentResult.insertId;

            } else if (shouldSaveBank) {
                const [paymentResult] = await connection.query(
                    `INSERT INTO member_payment_methods (membership_id, payment_type, is_default, mock_identifier, mock_expiration)
                     VALUES (?, 'Bank', TRUE, ?, NULL)`,
                    [newPrimaryMemberId, paymentIdentifier]
                );
                newPaymentMethodId = paymentResult.insertId;
            }

            // 4. --- *** ADDED THIS BLOCK *** ---
            const subMemberSql = `
                INSERT INTO membership (first_name, last_name, email, phone_number, date_of_birth, type_id, start_date, end_date, primary_member_id)
                VALUES (?, ?, NULL, NULL, ?, ?, ?, ?, ?)
            `;
            for (let i = 0; i < subFirstNames.length; i++) {
                await connection.query(subMemberSql, [
                    subFirstNames[i],
                    subLastNames[i],
                    subDobs[i],
                    type_id,
                    purchaseDate, // Use 'purchaseDate' from this route
                    endDate,      // Use 'endDate' from this route
                    newPrimaryMemberId // Link to the primary member
                ]);
            }
            // --- *** END OF ADDED BLOCK *** ---

            // 5. Log this initial purchase in the history table
            const historySql = `
                INSERT INTO membership_purchase_history 
                    (membership_id, type_id, purchase_date, price_paid, purchased_start_date, purchased_end_date, type_name_snapshot, payment_method_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `;
            await connection.query(historySql, [
                newPrimaryMemberId, // The purchase is tied to the primary member
                type.type_id,
                purchaseDate,
                finalPrice, // Use the dynamically calculated final price
                purchaseDate,
                endDate,
                type.type_name,
                newPaymentMethodId
            ]);

            // 6. Commit the transaction
            await connection.commit();

            // 7. Log the user in
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

                // 8. Render the success page with a receipt object
                // --- *** MODIFIED THIS OBJECT *** ---
                const receiptData = {
                    memberName: `${first_name} ${last_name}`,
                    membershipId: newPrimaryMemberId,
                    typeName: type.type_name,
                    endDate: endDate.toLocaleDateString(),
                    pricePaid: parseFloat(finalPrice),
                    paymentMethod: paymentIdentifier,
                    subMembers: subFirstNames.map((firstName, index) => {
                        return { firstName: firstName, lastName: subLastNames[index] };
                    })
                };
                // --- *** END OF MODIFICATION *** ---

                res.render('member-signup-success', { receipt: receiptData });
            });

        } catch (dbError) {
            await connection.rollback(); // Rollback on error
            throw dbError; // Pass error to outer catch block
        } finally {
            connection.release();
        }

    } catch (error) {
        if (connection) connection.release(); // Ensure release on general error
        console.error("Error processing signup:", error);
        // On error, re-render the signup page with the error message
        res.render('member-signup', {
            type: type || { type_id: type_id, ...req.body }, // Fallback type
            error: error.message || "An unexpected error occurred."
        });
    }
});

// --- LOGIN & LOGOUT ROUTES ---
// ... (The rest of routes/auth.js is unchanged) ...
// GET /login
router.get('/login', isGuest, (req, res) => {
    if (req.session.user) {
        return res.redirect('/dashboard');
    }
    res.render('global-login', { error: null });
});

// POST /login
router.post('/login', isGuest, async (req, res) => {
    try {
        const email = req.body.username;
        const password = req.body.password;

        // --- 1. Check for an EMPLOYEE match first ---
        const employeeQuery = `
            SELECT 
                demo.employee_id, demo.first_name, demo.last_name, demo.employee_type, 
                demo.location_id, loc.location_name, auth.password_hash
            FROM employee_demographics AS demo
            JOIN employee_auth AS auth ON demo.employee_id = auth.employee_id
            LEFT JOIN location AS loc ON demo.location_id = loc.location_id
            WHERE demo.email = ? AND demo.is_active = TRUE AND demo.is_pending_approval = FALSE
        `;
        const [employeeResults] = await pool.query(employeeQuery, [email]);

        if (employeeResults.length > 0) {
            // Employee email found, check password
            const user = employeeResults[0];
            const match = await bcrypt.compare(password, user.password_hash);

            if (match) {
                // Employee login successful
                return req.session.regenerate(function (err) {
                    if (err) {
                        console.error("Session regeneration error:", err);
                        return res.status(500).render('global-login', { error: 'Session error during login.' });
                    }
                    // Set EMPLOYEE session
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

        // --- 2. No employee match, check for a MEMBER match ---
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
            // Member email found, check password
            const member = memberResults[0];
            const match = await bcrypt.compare(password, member.password_hash);

            if (match) {
                // Member login successful
                return req.session.regenerate(function (err) {
                    if (err) {
                        console.error("Session regeneration error:", err);
                        return res.status(500).render('global-login', { error: 'Session error during login.' });
                    }
                    // Set MEMBER session
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

        // --- 3. No match for either ---
        res.render('global-login', { error: 'Invalid email or password' });

    } catch (error) {
        console.error("Global login error:", error);
        return res.status(500).render('global-login', { error: 'An unexpected error occurred. Please try again later.' });
    }
});

// GET /employee/logout
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

// GET /change-password
router.get('/change-password', isAuthenticated, (req, res) => {
    res.render('change-password', { error: null, success: null });
});

// POST /change-password
router.post('/change-password', isAuthenticated, async (req, res) => {
    const { old_password, new_password, confirm_password } = req.body;
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