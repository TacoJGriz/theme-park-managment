const express = require('express');
const router = express.Router();
const pool = require('../db'); // Adjust path to db.js
const bcrypt = require('bcrypt');
const { 
    isAuthenticated,
    canManageMembersVisits,
    isMemberAuthenticated,
    isGuest,
    formatPhoneNumber,
    normalizePhone,
    formatReceiptDate,
    censorPhone
} = require('../middleware/auth'); // Adjust path to auth.js

// --- GUEST & VISITS MANAGEMENT ---

// GET /members
// Path changed to /
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
// Path changed to /new
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
// Path changed to /
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
// Path changed to /history/:member_id
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
        const member = memberResult[0];

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
            member: member,
            visits: visits
        });

    } catch (error) {
        console.error("Error fetching member visit history:", error);
        res.status(500).send('Error loading page.');
    }
});


// --- MEMBER PORTAL ROUTES ---
// These are prefixed with /member

// GET /member/login
// Path changed to /member/login
router.get('/member/login', isGuest, (req, res) => {
    res.redirect('/login');
});

// POST /member/login
// Path changed to /member/login
router.post('/member/login', isGuest, async (req, res) => {
    try {
        const email = req.body.username;
        const password = req.body.password;

        const query = `
            SELECT 
                m.membership_id, m.first_name, m.last_name, m.email,
                auth.password_hash
            FROM membership AS m
            JOIN member_auth AS auth ON m.membership_id = auth.membership_id
            WHERE m.email = ?
        `;
        const [results] = await pool.query(query, [email]);
        if (results.length === 0) {
            return res.render('member-login', { error: 'Invalid email or password' });
        }

        const member = results[0];
        const match = await bcrypt.compare(password, member.password_hash);

        if (match) {
            req.session.regenerate(function (err) {
                if (err) {
                    console.error("Session regeneration error:", err);
                    return res.status(500).render('member-login', { error: 'Session error during login.' });
                }

                req.session.member = {
                    id: member.membership_id,
                    firstName: member.first_name,
                    lastName: member.last_name,
                    email: member.email
                };
                res.redirect('/member/dashboard');
            });
        } else {
            res.render('member-login', { error: 'Invalid email or password' });
        }
    } catch (error) {
        console.error("Member login error:", error);
        return res.status(500).render('member-login', { error: 'An unexpected error occurred.' });
    }
});

// GET /member/register
// Path changed to /member/register
router.get('/member/register', isGuest, (req, res) => {
    res.render('member-register', { error: null });
});

// POST /member/register
// Path changed to /member/register
router.post('/member/register', isGuest, async (req, res) => {
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

        const hash = await bcrypt.hash(password, saltRounds);
        await connection.query(
            'INSERT INTO member_auth (membership_id, password_hash) VALUES (?, ?)',
            [membership_id, hash]
        );

        await connection.commit();

        res.redirect('/member/login');

    } catch (error) {
        if (connection) await connection.rollback();
        console.error("Error registering member:", error);
        res.render('member-register', { error: error.message });
    } finally {
        if (connection) connection.release();
    }
});

// GET /member/logout
// Path changed to /member/logout
router.get('/member/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            console.error("Member logout error:", err);
        }
        res.clearCookie('connect.sid');
        res.redirect('/'); 
    });
});

// GET /member/dashboard
// Path changed to /member/dashboard
router.get('/member/dashboard', isMemberAuthenticated, async (req, res) => {
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
// Path changed to /member/history
router.get('/member/history', isMemberAuthenticated, async (req, res) => {
    const memberId = req.session.member.id; 
    try {
        const member = req.session.member;

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
            member: member,
            visits: visits
        });

    } catch (error) {
        console.error("Error fetching member visit history:", error);
        res.status(500).send('Error loading page.');
    }
});

// GET /member/promotions
// Path changed to /member/promotions
router.get('/member/promotions', isMemberAuthenticated, async (req, res) => {
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

// GET /member/receipt/:visit_id
// Path changed to /member/receipt/:visit_id
router.get('/member/receipt/:visit_id', isMemberAuthenticated, async (req, res) => {
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


// --- VISIT ROUTES ---
// These are prefixed with /visits

// GET /visits/new
// Path changed to /visits/new
router.get('/visits/new', isAuthenticated, canManageMembersVisits, async (req, res) => {
    try {
        const [ticketTypes] = await pool.query(
            "SELECT ticket_type_id, type_name, base_price, is_member_type FROM ticket_types WHERE is_active = TRUE ORDER BY is_member_type, type_name"
        );

        const [activeMembers] = await pool.query(
            "SELECT membership_id, first_name, last_name, email, phone_number FROM membership WHERE end_date >= CURDATE() ORDER BY last_name, first_name"
        );

        const [promos] = await pool.query(
            "SELECT discount_percent FROM event_promotions WHERE CURDATE() BETWEEN start_date AND end_date ORDER BY discount_percent DESC LIMIT 1"
        );

        const currentDiscount = (promos.length > 0) ? promos[0].discount_percent : 0;

        res.render('log-visit', {
            error: null,
            ticketTypes: ticketTypes,
            activeMembers: activeMembers,
            currentDiscount: currentDiscount,
            normalizePhone: normalizePhone 
        });

    } catch (error) {
        console.error("Error loading log visit page:", error);
        res.render('log-visit', {
            error: "Error fetching park data. Please try again.",
            ticketTypes: [],
            activeMembers: [],
            currentDiscount: 0,
            normalizePhone: (phone) => phone || "" 
        });
    }
});

// POST /visits
// Path changed to /visits
router.post('/visits', isAuthenticated, canManageMembersVisits, async (req, res) => {
    const { ticket_type_id, membership_id } = req.body;
    const visit_date = new Date(); 
    const { id: actorId } = req.session.user;

    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction(); 

        const [ticketResult] = await pool.query(
            "SELECT type_name, base_price, is_member_type FROM ticket_types WHERE ticket_type_id = ?",
            [ticket_type_id]
        );

        if (ticketResult.length === 0) {
            throw new Error("Invalid ticket type submitted.");
        }
        const ticket = ticketResult[0];

        const [promos] = await pool.query(
            "SELECT event_name, discount_percent FROM event_promotions WHERE CURDATE() BETWEEN start_date AND end_date ORDER BY discount_percent DESC LIMIT 1"
        );
        const currentDiscountPercent = (promos.length > 0) ? promos[0].discount_percent : 0;
        const promoName = (promos.length > 0) ? promos[0].event_name : 'N/A';

        let finalTicketPrice = 0.00;
        let finalDiscountAmount = 0.00;
        let finalMembershipId = null;

        if (ticket.is_member_type) {
            if (!membership_id || membership_id === "") {
                throw new Error("A membership ID is required for a 'Member' ticket type.");
            }
            finalMembershipId = membership_id;
        } else {
            finalTicketPrice = parseFloat(ticket.base_price);
            finalDiscountAmount = finalTicketPrice * (parseFloat(currentDiscountPercent) / 100.0);
        }

        const sql = `
            INSERT INTO visits (visit_date, ticket_type_id, membership_id, ticket_price, discount_amount, logged_by_employee_id)
            VALUES (?, ?, ?, ?, ?, ?)
        `;
        const [insertResult] = await connection.query(sql, [
            visit_date,
            ticket_type_id,
            finalMembershipId,
            finalTicketPrice,
            finalDiscountAmount,
            actorId
        ]);

        const newVisitId = insertResult.insertId;

        let receiptData = {
            visit_id: newVisitId,
            visit_date: formatReceiptDate(visit_date),
            ticket_name: ticket.type_name,
            base_price: finalTicketPrice,
            discount_amount: finalDiscountAmount,
            total_cost: finalTicketPrice - finalDiscountAmount,
            promo_applied: promoName,
            is_member: ticket.is_member_type,
            staff_name: `${req.session.user.firstName} ${req.session.user.lastName}`,
            member_id: null,
            member_name: null,
            member_type: null,
            member_phone: null
        };

        if (ticket.is_member_type && finalMembershipId) {
            const [memberInfo] = await pool.query(`
                SELECT 
                    m.first_name, m.last_name, m.phone_number,
                    mt.type_name AS membership_type_name
                FROM membership m
                LEFT JOIN membership_type mt ON m.type_id = mt.type_id
                WHERE m.membership_id = ?
            `, [finalMembershipId]);

            if (memberInfo.length > 0) {
                receiptData.member_id = finalMembershipId;
                receiptData.member_name = `${memberInfo[0].first_name} ${memberInfo[0].last_name}`;
                receiptData.member_type = memberInfo[0].membership_type_name;
                receiptData.member_phone = censorPhone(memberInfo[0].phone_number);
            }
        }

        await connection.commit();
        res.render('visit-receipt', { receipt: receiptData });

    } catch (error) {
        if (connection) await connection.rollback();
        console.error("Error logging visit:", error.message);

        try {
            const [ticketTypes] = await pool.query("SELECT ticket_type_id, type_name, base_price, is_member_type FROM ticket_types WHERE is_active = TRUE ORDER BY is_member_type, type_name");
            const [activeMembers] = await pool.query("SELECT membership_id, first_name, last_name, email, phone_number FROM membership WHERE end_date >= CURDATE() ORDER BY last_name, first_name");
            const [promos] = await pool.query("SELECT discount_percent FROM event_promotions WHERE CURDATE() BETWEEN start_date AND end_date ORDER BY discount_percent DESC LIMIT 1");
            const currentDiscount = (promos.length > 0) ? promos[0].discount_percent : 0;

            res.render('log-visit', {
                error: `Database error logging visit: ${error.message}`,
                ticketTypes: ticketTypes,
                activeMembers: activeMembers,
                currentDiscount: currentDiscount,
                normalizePhone: (phone) => (phone || "").replace(/\D/g, '') 
            });
        } catch (fetchError) {
            console.error("Error fetching data for log-visit error page:", fetchError);
            res.render('log-visit', {
                error: "A critical error occurred. Please try again.",
                ticketTypes: [], activeMembers: [], currentDiscount: 0,
                normalizePhone: (phone) => (phone || "").replace(/\D/g, '')
            });
        }
    } finally {
        if (connection) connection.release();
    }
});

// GET /visits/receipt/:visit_id
// Path changed to /visits/receipt/:visit_id
router.get('/visits/receipt/:visit_id', isAuthenticated, canManageMembersVisits, async (req, res) => {
    const { visit_id } = req.params;
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

        if (visit.is_member_type && visit.membership_id) {
            const [memberInfo] = await connection.query(`
                SELECT 
                    m.first_name, m.last_name, m.phone_number,
                    mt.type_name AS membership_type_name
                FROM membership m
                LEFT JOIN membership_type mt ON m.type_id = mt.type_id
                WHERE m.membership_id = ?
            `, [visit.membership_id]);

            if (memberInfo.length > 0) {
                receiptData.member_id = visit.membership_id;
                receiptData.member_name = `${memberInfo[0].first_name} ${memberInfo[0].last_name}`;
                receiptData.member_type = memberInfo[0].membership_type_name;
                receiptData.member_phone = censorPhone(memberInfo[0].phone_number);
            }
        }

        res.render('visit-receipt', { receipt: receiptData });

    } catch (error) {
        console.error("Error fetching receipt:", error);
        res.status(500).send("Error loading receipt.");
    } finally {
        if (connection) connection.release();
    }
});


module.exports = router;