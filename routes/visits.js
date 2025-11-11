const express = require('express');
const router = express.Router();
const pool = require('../db');
const crypto = require('crypto');
const {
    isAuthenticated,
    canManageMembersVisits,
    normalizePhone,
    formatReceiptDate,
    censorPhone
} = require('../middleware/auth');

// --- EMPLOYEE-FACING VISIT LOGGING ---
// All routes are prefixed with /visits by app.js

// GET /visits/new
router.get('/new', isAuthenticated, canManageMembersVisits, async (req, res) => {
    try {
        const [ticketTypes] = await pool.query(
            "SELECT ticket_type_id, type_name, base_price, is_member_type FROM ticket_types WHERE is_active = TRUE ORDER BY is_member_type, type_name"
        );

        // --- MODIFIED: Fetch all member details for JS ---
        const [activeMembers] = await pool.query(
            `SELECT 
                membership_id, 
                primary_member_id, 
                first_name, 
                last_name, 
                email, 
                phone_number 
             FROM membership 
             WHERE end_date >= CURDATE() 
             ORDER BY last_name, first_name`
        );

        const [promos] = await pool.query(
            "SELECT discount_percent FROM event_promotions WHERE CURDATE() BETWEEN start_date AND end_date ORDER BY discount_percent DESC LIMIT 1"
        );
        const currentDiscount = (promos.length > 0) ? promos[0].discount_percent : 0;

        res.render('log-visit', {
            error: req.session.error, // Pass flash error
            success: req.session.success, // Pass flash success
            ticketTypes: ticketTypes,
            activeMembers: activeMembers, // Pass full member list
            currentDiscount: currentDiscount,
            normalizePhone: normalizePhone
        });

        // Clear flash messages
        req.session.error = null;
        req.session.success = null;

    } catch (error) {
        console.error("Error loading log visit page:", error);
        res.render('log-visit', {
            error: "Error fetching park data. Please try again.",
            success: null,
            ticketTypes: [],
            activeMembers: [],
            currentDiscount: 0,
            normalizePhone: (phone) => phone || ""
        });
    }
});

// POST /visits
router.post('/', isAuthenticated, canManageMembersVisits, async (req, res) => {
    const { ticket_type_id } = req.body;
    const member_ids = [].concat(req.body.member_ids || []);
    const visit_date = new Date();
    const { id: actorId } = req.session.user;
    let connection;

    // Generate one shared ID for this entire transaction
    const visitGroupId = crypto.randomUUID();

    try {
        connection = await pool.getConnection();

        // 1. Get Ticket Info
        const [ticketResult] = await connection.query(
            "SELECT type_name, base_price, is_member_type FROM ticket_types WHERE ticket_type_id = ?",
            [ticket_type_id]
        );
        if (ticketResult.length === 0) {
            throw new Error("Invalid ticket type submitted.");
        }
        const ticket = ticketResult[0];

        // --- 2. Member vs. Non-Member ---

        if (ticket.is_member_type) {
            // --- MEMBER GROUP LOGIC ---
            if (member_ids.length === 0) {
                throw new Error("No members were selected for check-in.");
            }

            await connection.beginTransaction();
            // Add visit_group_id to the query
            const sql = `
                INSERT INTO visits (visit_date, ticket_type_id, membership_id, ticket_price, discount_amount, logged_by_employee_id, visit_group_id)
                VALUES (?, ?, ?, 0.00, 0.00, ?, ?)
            `;

            const newVisitIds = []; // To store all new visit IDs

            // Loop and insert a visit record for each member
            for (const memberId of member_ids) {
                const [insertResult] = await connection.query(sql, [
                    visit_date,
                    ticket_type_id,
                    memberId,
                    actorId,
                    visitGroupId // Insert the same group ID for all
                ]);
                newVisitIds.push(insertResult.insertId);
            }

            // --- Get Member Data for Receipt ---

            // 1. Get data for all members who were just checked in
            const [checkedInMembers] = await connection.query(`
                SELECT m.membership_id, m.primary_member_id, m.first_name, m.last_name, m.phone_number, mt.type_name
                FROM membership m
                JOIN membership_type mt ON m.type_id = mt.type_id
                WHERE m.membership_id IN (?)
            `, [member_ids]);

            if (checkedInMembers.length === 0) {
                throw new Error("Could not find member data for receipt.");
            }

            // 2. Find the Primary Member ID for this group
            const primaryMemberInList = checkedInMembers.find(m => m.primary_member_id === null);
            const primaryId = primaryMemberInList ? primaryMemberInList.membership_id : checkedInMembers[0].primary_member_id;

            // 3. Get the Primary Member's full data
            const [primaryMemberData] = await connection.query(`
                SELECT m.first_name, m.last_name, m.phone_number, mt.type_name
                FROM membership m
                JOIN membership_type mt ON m.type_id = mt.type_id
                WHERE m.membership_id = ?
            `, [primaryId]);
            const primaryMember = primaryMemberData[0];

            // 4. Create a list of all sub-members who were checked in
            const subMembersOnReceipt = checkedInMembers.filter(m => m.membership_id !== primaryId);

            // 5. Build the receipt object
            let receiptData = {
                visit_ids: newVisitIds,
                visit_group_id: visitGroupId, // Add the group ID to the receipt
                visit_date: formatReceiptDate(visit_date),
                ticket_name: ticket.type_name,
                base_price: 0.00,
                discount_amount: 0.00,
                total_cost: 0.00,
                promo_applied: 'N/A',
                is_member: true,
                staff_name: `${req.session.user.firstName} ${req.session.user.lastName}`,
                member_id: primaryId,
                member_name: `${primaryMember.first_name} ${primaryMember.last_name}`,
                member_type: primaryMember.type_name,
                member_phone: censorPhone(primaryMember.phone_number),
                subMembers: subMembersOnReceipt
            };

            await connection.commit();

            // Render the receipt
            res.render('visit-receipt', { receipt: receiptData, fromLogVisit: true });

        } else {
            // --- NON-MEMBER LOGIC ---
            await connection.beginTransaction();

            const [promos] = await pool.query(
                "SELECT event_name, discount_percent FROM event_promotions WHERE CURDATE() BETWEEN start_date AND end_date ORDER BY discount_percent DESC LIMIT 1"
            );
            const currentDiscountPercent = (promos.length > 0) ? promos[0].discount_percent : 0;
            const promoName = (promos.length > 0) ? promos[0].event_name : 'N/A';

            let finalTicketPrice = parseFloat(ticket.base_price);
            let finalDiscountAmount = finalTicketPrice * (parseFloat(currentDiscountPercent) / 100.0);

            // Add visit_group_id to the query
            const sql = `
                INSERT INTO visits (visit_date, ticket_type_id, membership_id, ticket_price, discount_amount, logged_by_employee_id, visit_group_id)
                VALUES (?, ?, NULL, ?, ?, ?, ?)
            `;
            const [insertResult] = await connection.query(sql, [
                visit_date,
                ticket_type_id,
                finalTicketPrice,
                finalDiscountAmount,
                actorId,
                visitGroupId // Insert the group ID
            ]);

            const newVisitId = insertResult.insertId;
            let receiptData = {
                visit_ids: [newVisitId],
                visit_group_id: visitGroupId, // Add the group ID to the receipt
                visit_date: formatReceiptDate(visit_date),
                ticket_name: ticket.type_name,
                base_price: finalTicketPrice,
                discount_amount: finalDiscountAmount,
                total_cost: finalTicketPrice - finalDiscountAmount,
                promo_applied: promoName,
                is_member: false,
                staff_name: `${req.session.user.firstName} ${req.session.user.lastName}`,
                member_id: null,
                member_name: null,
                member_type: null,
                member_phone: null,
                subMembers: []
            };

            await connection.commit();
            res.render('visit-receipt', { receipt: receiptData, fromLogVisit: true });
        }
    } catch (error) {
        if (connection) await connection.rollback();
        console.error("Error logging visit:", error.message);

        req.session.error = `Error logging visit: ${error.message}`;
        res.redirect('/visits/new');

    } finally {
        if (connection) connection.release();
    }
});

// POST /visits/redeem
router.post('/redeem', isAuthenticated, canManageMembersVisits, async (req, res) => {
    const { ticket_code } = req.body;
    const { id: actorId } = req.session.user;
    let connection;

    try {
        connection = await pool.getConnection();

        // 1. Find the ticket
        const [ticketResult] = await connection.query(
            "SELECT * FROM prepaid_tickets WHERE ticket_code = ?",
            [ticket_code]
        );

        if (ticketResult.length === 0) {
            req.session.error = `Ticket code "${ticket_code}" not found.`;
            return res.redirect('/visits/new');
        }

        const ticket = ticketResult[0];

        // 2. Check if already redeemed
        if (ticket.is_redeemed) {
            req.session.error = `This ticket was already redeemed on ${new Date(ticket.redeemed_date).toLocaleString()}.`;
            return res.redirect('/visits/new');
        }

        // 3. Redeem the ticket
        await connection.beginTransaction();

        // 3a. Create the visit log
        const visitSql = `
            INSERT INTO visits (visit_date, ticket_type_id, membership_id, ticket_price, discount_amount, logged_by_employee_id)
            VALUES (?, ?, NULL, ?, ?, ?)
        `;
        const visit_date = new Date();
        const [visitInsert] = await connection.query(visitSql, [
            visit_date,
            ticket.ticket_type_id,
            ticket.base_price,    // Log the price from the ticket
            ticket.discount_amount, // Log the discount from the ticket
            actorId
        ]);

        const newVisitId = visitInsert.insertId;

        // 3b. Mark the e-ticket as redeemed and link the visit
        await connection.query(
            "UPDATE prepaid_tickets SET is_redeemed = TRUE, redeemed_date = ?, visit_id = ? WHERE e_ticket_id = ?",
            [visit_date, newVisitId, ticket.e_ticket_id]
        );

        await connection.commit();

        // 4. Success!
        req.session.success = `Ticket ${ticket.ticket_code} redeemed successfully.`;
        res.redirect('/visits/new'); // Redirect back to the log visit page

    } catch (error) {
        if (connection) await connection.rollback();
        console.error("Error redeeming e-ticket:", error);
        req.session.error = "A database error occurred during redemption.";
        res.redirect('/visits/new');
    } finally {
        if (connection) connection.release();
    }
});

// GET /visits/receipt/:visit_id
router.get('/receipt/:visit_id', isAuthenticated, canManageMembersVisits, async (req, res) => {
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

// GET /visits/receipt-group/:visit_group_id
// (Employee-facing route to see a full group receipt)
router.get('/receipt-group/:visit_group_id', isAuthenticated, canManageMembersVisits, async (req, res) => {
    const { visit_group_id } = req.params;
    let connection;

    try {
        connection = await pool.getConnection();

        // 1. Get all visits in this group
        const [visitsInGroup] = await connection.query(`
            SELECT 
                v.*, 
                tt.type_name AS ticket_name,
                CONCAT(e.first_name, ' ', e.last_name) as staff_name,
                m.primary_member_id, m.first_name, m.last_name, m.phone_number
            FROM visits v
            JOIN membership m ON v.membership_id = m.membership_id
            JOIN ticket_types tt ON v.ticket_type_id = tt.ticket_type_id
            LEFT JOIN employee_demographics e ON v.logged_by_employee_id = e.employee_id
            WHERE v.visit_group_id = ?
        `, [visit_group_id]);

        if (visitsInGroup.length === 0) {
            return res.status(404).send('Visit not found.');
        }

        // (No security check needed, as canManageMembersVisits already ran)

        // 2. Find the Primary Member ID for this group
        const primaryMemberInList = visitsInGroup.find(m => m.primary_member_id === null);
        const visitPrimaryId = primaryMemberInList ? primaryMemberInList.membership_id : visitsInGroup[0].primary_member_id;

        // 3. Get Primary Member's full data (for the receipt header)
        const [primaryMemberData] = await connection.query(`
            SELECT m.first_name, m.last_name, m.phone_number, mt.type_name
            FROM membership m
            JOIN membership_type mt ON m.type_id = mt.type_id
            WHERE m.membership_id = ?
        `, [visitPrimaryId]);
        const primaryMember = primaryMemberData[0];

        // 4. Build the receipt object
        const receiptData = {
            visit_ids: visitsInGroup.map(v => v.visit_id), // Array of all visit IDs
            visit_group_id: visit_group_id,
            visit_date: formatReceiptDate(visitsInGroup[0].visit_date),
            ticket_name: visitsInGroup[0].ticket_name,
            base_price: 0.00,
            discount_amount: 0.00,
            total_cost: 0.00,
            promo_applied: 'N/A',
            is_member: true,
            staff_name: visitsInGroup[0].staff_name || 'N/A',
            member_id: visitPrimaryId,
            member_name: `${primaryMember.first_name} ${primaryMember.last_name}`,
            member_type: primaryMember.type_name,
            member_phone: censorPhone(primaryMember.phone_number),
            subMembers: visitsInGroup
                .filter(v => v.membership_id !== visitPrimaryId)
                .map(v => ({
                    first_name: v.first_name,
                    last_name: v.last_name,
                    membership_id: v.membership_id
                }))
        };

        // This is an employee viewing this, so "fromLogVisit" is false.
        res.render('visit-receipt', { receipt: receiptData, fromLogVisit: false });

    } catch (error) {
        console.error("Error fetching receipt group:", error);
        res.status(500).send("Error loading receipt.");
    } finally {
        if (connection) connection.release();
    }
});

module.exports = router;