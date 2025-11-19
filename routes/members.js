const express = require('express');
const router = express.Router();
const pool = require('../db');
const bcrypt = require('bcrypt');
const crypto = require('crypto'); // ADDED
const {
    isAuthenticated,
    canManageMembersVisits,
    formatPhoneNumber
} = require('../middleware/auth');

const saltRounds = 10;

// --- EMPLOYEE-FACING MEMBER MANAGEMENT ---
// GET /members
router.get('/', isAuthenticated, canManageMembersVisits, async (req, res) => {
    try {
        const { search, sort, dir, filter_type, filter_status } = req.query;
        let whereClauses = [];
        let params = [];
        let summaryParams = []; // Params for the summary query
        let orderBy = ' ORDER BY m.membership_id ASC'; // Default sort to group families

        const [memberTypes] = await pool.query(
            'SELECT type_id, type_name, public_type_id FROM membership_type WHERE is_active = TRUE ORDER BY type_name'
        );

        // --- NEW: Subquery for visit count ---
        const visitCountSubquery = `(SELECT COUNT(*) FROM visits v WHERE v.membership_id = m.membership_id) AS visit_count`;

        let query;
        let summaryQuery;

        if (search) {
            // --- Find matching groups ---
            const searchTerm = `%${search}%`;

            const searchWhere = `(
                m_search.first_name LIKE ? OR 
                m_search.last_name LIKE ? OR 
                CONCAT(m_search.first_name, ' ', m_search.last_name) LIKE ? OR 
                m_search.email LIKE ? OR 
                m_search.phone_number LIKE ? OR 
                m_search.membership_id LIKE ? OR 
                m_search.public_membership_id LIKE ?
            )`;

            const searchParams = [
                searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm
            ];

            // 1. Main Query: Select all members belonging to a matched group
            // UPDATED: Added visit_count
            query = `
                SELECT 
                    m.membership_id, m.first_name, m.last_name, m.email, m.phone_number,
                    m.public_membership_id,
                    m.primary_member_id, 
                    mt.type_name,
                    DATE_FORMAT(m.start_date, '%m/%d/%Y') AS start_date_formatted,
                    DATE_FORMAT(m.end_date, '%m/%d/%Y') AS end_date_formatted,
                    CASE 
                        WHEN m.end_date >= CURDATE() THEN 'Active' 
                        ELSE 'Expired' 
                    END AS member_status,
                    m.start_date, m.end_date,
                    ${visitCountSubquery} -- ADDED
                FROM membership m
                JOIN (
                    SELECT DISTINCT COALESCE(m_search.primary_member_id, m_search.membership_id) AS group_id
                    FROM membership m_search
                    WHERE ${searchWhere}
                ) AS matched_groups ON COALESCE(m.primary_member_id, m.membership_id) = matched_groups.group_id
                LEFT JOIN membership_type mt ON m.type_id = mt.type_id
            `;

            // 2. Summary Query (Unchanged mostly, relies on search params)
            summaryQuery = `
                SELECT 
                    COUNT(m.membership_id) AS totalMembers,
                    SUM(CASE WHEN m.end_date >= CURDATE() THEN 1 ELSE 0 END) AS activeMembers,
                    SUM(CASE WHEN m.end_date < CURDATE() THEN 1 ELSE 0 END) AS expiredMembers
                FROM membership m
                JOIN (
                    SELECT DISTINCT COALESCE(m_search.primary_member_id, m_search.membership_id) AS group_id
                    FROM membership m_search
                    WHERE ${searchWhere}
                ) AS matched_groups ON COALESCE(m.primary_member_id, m.membership_id) = matched_groups.group_id
                LEFT JOIN membership_type mt ON m.type_id = mt.type_id
            `;

            params = [...searchParams];
            summaryParams = [...searchParams];

            // Add filters *after* grouping
            if (filter_type) whereClauses.push('m.type_id = ?');
            if (filter_status === 'active') whereClauses.push('m.end_date >= CURDATE()');
            if (filter_status === 'expired') whereClauses.push('m.end_date < CURDATE()');

        } else {
            // --- ORIGINAL LOGIC (when not searching) ---
            // UPDATED: Added visit_count
            query = `
                SELECT 
                    m.membership_id, m.first_name, m.last_name, m.email, m.phone_number,
                    m.public_membership_id,
                    m.primary_member_id,
                    mt.type_name,
                    DATE_FORMAT(m.start_date, '%m/%d/%Y') AS start_date_formatted,
                    DATE_FORMAT(m.end_date, '%m/%d/%Y') AS end_date_formatted,
                    CASE 
                        WHEN m.end_date >= CURDATE() THEN 'Active' 
                        ELSE 'Expired' 
                    END AS member_status,
                    m.start_date, m.end_date,
                    ${visitCountSubquery} -- ADDED
                FROM membership m
                LEFT JOIN membership_type mt ON m.type_id = mt.type_id
            `;

            summaryQuery = `
                SELECT 
                    COUNT(m.membership_id) AS totalMembers,
                    SUM(CASE WHEN m.end_date >= CURDATE() THEN 1 ELSE 0 END) AS activeMembers,
                    SUM(CASE WHEN m.end_date < CURDATE() THEN 1 ELSE 0 END) AS expiredMembers
                FROM membership m
                LEFT JOIN membership_type mt ON m.type_id = mt.type_id
            `;

            // Add filters
            if (filter_type) {
                whereClauses.push('m.type_id = ?');
                params.push(filter_type);
            }
            if (filter_status === 'active') {
                whereClauses.push('m.end_date >= CURDATE()');
            } else if (filter_status === 'expired') {
                whereClauses.push('m.end_date < CURDATE()');
            }
            summaryParams = [...params];
        }

        // Apply filters to queries
        if (whereClauses.length > 0) {
            const whereString = ` WHERE ${whereClauses.join(' AND ')}`;
            query += whereString;
            summaryQuery += whereString;

            if (filter_type) params.push(filter_type);
            if (filter_type) summaryParams.push(filter_type);
        }

        // Get Summary Counts
        const [summaryResult] = await pool.query(summaryQuery, summaryParams);
        const counts = summaryResult[0];

        // Handle Sorting
        if (sort && dir && (dir === 'asc' || dir === 'desc')) {
            const validSorts = {
                'id': 'm.membership_id',
                'name': 'm.last_name',
                'email': 'm.email',
                'phone': 'm.phone_number',
                'type': 'mt.type_name',
                'start_date': 'm.start_date',
                'end_date': 'm.end_date',
                'status': 'm.end_date >= CURDATE()',
                'visits': 'visit_count' // NEW SORT KEY
            };
            if (validSorts[sort]) {
                if (sort === 'name') {
                    orderBy = ` ORDER BY m.last_name ${dir.toUpperCase()}, m.first_name ${dir.toUpperCase()}`;
                } else {
                    orderBy = ` ORDER BY ${validSorts[sort]} ${dir.toUpperCase()}`;
                }
            }
        }

        query += orderBy;

        // Get Member List
        const [members] = await pool.query(query, params);

        const queryParams = new URLSearchParams();
        if (search) queryParams.set('search', search);
        if (sort) queryParams.set('sort', sort);
        if (dir) queryParams.set('dir', dir);
        if (filter_type) queryParams.set('filter_type', filter_type);
        if (filter_status) queryParams.set('filter_status', filter_status);
        const currentQueryString = queryParams.toString();

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
            success: req.session.success,
            error: req.session.error,
            currentQueryString: currentQueryString
        });
        req.session.success = null;
        req.session.error = null;
    } catch (error) {
        console.error(error);
        res.status(500).send('Error fetching members');
    }
});

// GET /members/new
router.get('/new', isAuthenticated, canManageMembersVisits, async (req, res) => {
    try {
        // --- MODIFIED: Select all new pricing columns ---
        const [types] = await pool.query(
            'SELECT * FROM membership_type WHERE is_active = TRUE ORDER BY type_name'
        );
        res.render('add-member', { error: null, types: types });
    } catch (error) {
        console.error(error);
        res.render('add-member', { error: "Error fetching membership types.", types: [] });
    }
});

// POST /members
router.post('/', isAuthenticated, canManageMembersVisits, async (req, res) => {
    // --- MODIFIED: Get primary member data ---
    const { first_name, last_name, email, date_of_birth, type_id } = req.body;
    const formattedPhoneNumber = formatPhoneNumber(req.body.phone_number);

    // --- NEW: Get sub-member data arrays ---
    const subFirstNames = [].concat(req.body.sub_first_name || []);
    const subLastNames = [].concat(req.body.sub_last_name || []);
    const subDobs = [].concat(req.body.sub_dob || []);

    // --- MODIFIED: Generate dates on server ---
    const purchaseTime = new Date();
    const serverStartDate = new Date(purchaseTime);
    const serverEndDate = new Date(purchaseTime);
    serverEndDate.setFullYear(serverStartDate.getFullYear() + 1);
    serverEndDate.setDate(serverStartDate.getDate() - 1);

    let connection;
    let type; // For catch block

    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        // 1. Get Membership Type details
        const [typeResult] = await connection.query('SELECT * FROM membership_type WHERE type_id = ?', [type_id]);
        if (typeResult.length === 0) {
            throw new Error("Invalid membership type selected.");
        }
        type = typeResult[0]; // Set type for catch block

        // 2. NEW: Calculate dynamic price
        const totalMembers = 1 + subFirstNames.length;
        const additionalMembers = Math.max(0, totalMembers - type.base_members);
        const finalPrice = parseFloat(type.base_price) + (additionalMembers * (parseFloat(type.additional_member_price) || 0)); // FIXED string math

        // 3. Create the PRIMARY membership record
        const publicMemberId = crypto.randomUUID(); // ADDED
        const primarySql = `
            INSERT INTO membership (public_membership_id, first_name, last_name, email, phone_number, date_of_birth, type_id, start_date, end_date, primary_member_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
        `; // ADDED public_membership_id
        const [memResult] = await connection.query(primarySql, [
            publicMemberId, // ADDED
            first_name, last_name, email,
            formattedPhoneNumber,
            date_of_birth, type_id, serverStartDate, serverEndDate
        ]);

        const newPrimaryMemberId = memResult.insertId;

        // 4. NEW: Create SUB-MEMBER records
        const subMemberSql = `
            INSERT INTO membership (public_membership_id, first_name, last_name, email, phone_number, date_of_birth, type_id, start_date, end_date, primary_member_id)
            VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?)
        `; // ADDED public_membership_id
        for (let i = 0; i < subFirstNames.length; i++) {
            const publicSubMemberId = crypto.randomUUID(); // ADDED
            await connection.query(subMemberSql, [
                publicSubMemberId, // ADDED
                subFirstNames[i],
                subLastNames[i],
                subDobs[i],
                type_id,
                serverStartDate,
                serverEndDate,
                newPrimaryMemberId // Link to the primary member
            ]);
        }

        // 5. Log this in-park purchase in the history table
        const publicPurchaseId = crypto.randomUUID(); // ADDED
        const historySql = `
            INSERT INTO membership_purchase_history 
                (public_purchase_id, membership_id, type_id, purchase_date, price_paid, purchased_start_date, purchased_end_date, type_name_snapshot, payment_method_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
        `; // ADDED public_purchase_id
        const [historyResult] = await connection.query(historySql, [
            publicPurchaseId, // ADDED
            newPrimaryMemberId, // Purchase is tied to primary member
            type.type_id,
            purchaseTime,
            finalPrice, // Use dynamically calculated price
            serverStartDate,
            serverEndDate,
            type.type_name,
            null // No payment method ID for in-park sales
        ]);

        const newPurchaseId = historyResult.insertId;

        // 6. Commit transaction
        await connection.commit();

        // 7. Build the receipt object to render
        const receiptData = {
            purchase_id: publicPurchaseId, // CHANGED to public ID
            membership_id: publicMemberId, // CHANGED to public ID
            first_name: first_name,
            last_name: last_name,
            purchase_date: purchaseTime,
            type_name: type.type_name,
            purchased_start_date: serverStartDate,
            purchased_end_date: serverEndDate,
            price_paid: finalPrice,
            payment_method_name: 'In-Park Transaction'
        };

        // 8. Render the receipt
        res.render('member-purchase-receipt-detail', {
            purchase: receiptData,
            fromEmployee: true
        });

    } catch (error) {
        if (connection) await connection.rollback();

        console.error(error);
        const [types] = await pool.query(
            'SELECT * FROM membership_type WHERE is_active = TRUE ORDER BY type_name'
        );
        res.render('add-member', {
            error: "Database error adding member. Email might be duplicate.",
            types: types,
            // Pass back submitted data on error
            member: req.body,
            subMembers: { subFirstNames, subLastNames, subDobs }
        });
    } finally {
        if (connection) connection.release();
    }
});

// GET /members/history/:public_membership_id
router.get('/history/:public_membership_id', isAuthenticated, canManageMembersVisits, async (req, res) => {
    const { public_membership_id } = req.params; // CHANGED
    let connection;

    // --- NEW: Rebuild the query string to pass to the template ---
    const queryParams = new URLSearchParams();
    if (req.query.search) queryParams.set('search', req.query.search);
    if (req.query.sort) queryParams.set('sort', req.query.sort);
    if (req.query.dir) queryParams.set('dir', req.query.dir);
    if (req.query.filter_type) queryParams.set('filter_type', req.query.filter_type);
    if (req.query.filter_status) queryParams.set('filter_status', req.query.filter_status);
    const currentQueryString = queryParams.toString();

    try {
        connection = await pool.getConnection();

        // 1. Get the member's info (for the page title)
        const [memberResult] = await pool.query(
            'SELECT membership_id, first_name, last_name, primary_member_id FROM membership WHERE public_membership_id = ?', // CHANGED
            [public_membership_id] // CHANGED
        );
        if (memberResult.length === 0) {
            return res.status(404).send('Member not found');
        }
        const memberData = memberResult[0];
        const internal_member_id = memberData.membership_id; // Get internal ID

        // 2. Find all membership IDs associated with this member's group
        const primaryId = memberData.primary_member_id || internal_member_id;

        const [allGroupIds] = await connection.query(
            'SELECT membership_id FROM membership WHERE membership_id = ? OR primary_member_id = ?',
            [primaryId, primaryId]
        );
        const memberGroupIds = allGroupIds.map(m => m.membership_id);

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
            member: memberData, // This contains first_name, last_name
            visits: visits,
            currentQueryString: currentQueryString // <-- Pass the query string
        });

    } catch (error) {
        console.error("Error fetching member visit history:", error);
        res.status(500).send('Error loading page.');
    } finally {
        if (connection) connection.release();
    }
});


// *** EMPLOYEE-SIDE EDIT MEMBER ***

// GET /members/edit/:public_membership_id
router.get('/edit/:public_membership_id', isAuthenticated, canManageMembersVisits, async (req, res) => {
    const { public_membership_id } = req.params; // CHANGED

    // --- NEW: Rebuild the query string to pass to the template ---
    const queryParams = new URLSearchParams();
    if (req.query.search) queryParams.set('search', req.query.search);
    if (req.query.sort) queryParams.set('sort', req.query.sort);
    if (req.query.dir) queryParams.set('dir', req.query.dir);
    if (req.query.filter_type) queryParams.set('filter_type', req.query.filter_type);
    if (req.query.filter_status) queryParams.set('filter_status', req.query.filter_status);
    const currentQueryString = queryParams.toString();

    try {
        const [memberResult] = await pool.query(
            "SELECT * FROM membership WHERE public_membership_id = ?", // CHANGED
            [public_membership_id] // CHANGED
        );
        if (memberResult.length === 0) {
            return res.status(404).send('Member not found');
        }
        res.render('member-edit-employee', {
            member: memberResult[0], // Contains internal and public IDs
            error: null,
            currentQueryString: currentQueryString // <-- Pass the query string
        });
    } catch (error) {
        console.error("Error loading member edit page:", error);
        res.status(500).send("Error loading page.");
    }
});

// POST /members/edit/:public_membership_id
router.post('/edit/:public_membership_id', isAuthenticated, canManageMembersVisits, async (req, res) => {
    const { public_membership_id } = req.params; // CHANGED
    const { first_name, last_name, email, date_of_birth } = req.body;
    const formattedPhoneNumber = formatPhoneNumber(req.body.phone_number);

    try {
        if (!first_name || !last_name || !date_of_birth) {
            throw new Error("First Name, Last Name, and Date of Birth are required.");
        }

        // --- NEW: Fetch member first to check if they are a sub-member ---
        const [memberResult] = await pool.query(
            "SELECT primary_member_id FROM membership WHERE public_membership_id = ?", // CHANGED
            [public_membership_id] // CHANGED
        );
        if (memberResult.length === 0) {
            throw new Error("Member not found.");
        }
        const isSubMember = memberResult[0].primary_member_id;

        let sql;
        let sqlParams;

        if (isSubMember) {
            // Sub-member: DO NOT update email or phone
            sql = `
                UPDATE membership 
                SET first_name = ?, last_name = ?, date_of_birth = ?
                WHERE public_membership_id = ? 
            `; // CHANGED
            sqlParams = [first_name, last_name, date_of_birth, public_membership_id]; // CHANGED
        } else {
            // Primary member: Update all fields
            sql = `
                UPDATE membership 
                SET first_name = ?, last_name = ?, email = ?, phone_number = ?, date_of_birth = ?
                WHERE public_membership_id = ?
            `; // CHANGED
            sqlParams = [
                first_name,
                last_name,
                email,
                formattedPhoneNumber,
                date_of_birth,
                public_membership_id // CHANGED
            ];
        }

        await pool.query(sql, sqlParams);
        // --- END NEW LOGIC ---

        req.session.success = "Member profile updated successfully.";
        res.redirect('/members');

    } catch (error) {
        console.error("Error updating member profile:", error);
        try {
            const [memberResult] = await pool.query(
                "SELECT * FROM membership WHERE public_membership_id = ?", // CHANGED
                [public_membership_id] // CHANGED
            );
            res.render('member-edit-employee', {
                member: memberResult[0] || { public_membership_id: public_membership_id, ...req.body }, // CHANGED
                error: "Database error updating profile. Email may be a duplicate."
            });
        } catch (fetchError) {
            res.redirect('/members');
        }
    }
});

// *** EMPLOYEE-SIDE RESET MEMBER PASSWORD ***

// GET /members/reset-password/:public_membership_id
router.get('/reset-password/:public_membership_id', isAuthenticated, canManageMembersVisits, async (req, res) => {
    const { public_membership_id } = req.params; // CHANGED

    // --- NEW: Rebuild the query string to pass to the template ---
    const queryParams = new URLSearchParams();
    if (req.query.search) queryParams.set('search', req.query.search);
    if (req.query.sort) queryParams.set('sort', req.query.sort);
    if (req.query.dir) queryParams.set('dir', req.query.dir);
    if (req.query.filter_type) queryParams.set('filter_type', req.query.filter_type);
    if (req.query.filter_status) queryParams.set('filter_status', req.query.filter_status);
    const currentQueryString = queryParams.toString();

    try {
        const [memberResult] = await pool.query(
            "SELECT membership_id, public_membership_id, first_name, last_name FROM membership WHERE public_membership_id = ?", // CHANGED
            [public_membership_id] // CHANGED
        );
        if (memberResult.length === 0) {
            return res.status(404).send('Member not found');
        }
        res.render('member-reset-password', {
            member: memberResult[0],
            error: null,
            currentQueryString: currentQueryString // <-- Pass the query string
        });
    } catch (error) {
        console.error("Error loading member reset password page:", error);
        res.status(500).send("Error loading page.");
    }
});
// POST /members/reset-password/:public_membership_id
router.post('/reset-password/:public_membership_id', isAuthenticated, canManageMembersVisits, async (req, res) => {
    const { public_membership_id } = req.params; // CHANGED
    const { password, confirm_password } = req.body;

    // Fetch member data again in case of error
    const [memberResult] = await pool.query(
        "SELECT membership_id, public_membership_id, first_name, last_name FROM membership WHERE public_membership_id = ?", // CHANGED
        [public_membership_id] // CHANGED
    );
    if (memberResult.length === 0) {
        return res.status(404).send('Member not found');
    }
    const member = memberResult[0];
    const internal_member_id = member.membership_id; // Get internal ID

    try {
        if (password !== confirm_password) {
            throw new Error("Passwords do not match.");
        }
        if (password.length < 8) {
            throw new Error("Password must be at least 8 characters.");
        }

        // Check if member has an auth account to update (using internal ID)
        const [authCheck] = await pool.query("SELECT * FROM member_auth WHERE membership_id = ?", [internal_member_id]);

        const newHash = await bcrypt.hash(password, saltRounds);

        if (authCheck.length > 0) {
            // Member has an account, update it (using internal ID)
            await pool.query('UPDATE member_auth SET password_hash = ? WHERE membership_id = ?', [newHash, internal_member_id]);
        } else {
            // Member does not have an account, create one (using internal ID)
            await pool.query('INSERT INTO member_auth (membership_id, password_hash) VALUES (?, ?)', [internal_member_id, newHash]);
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