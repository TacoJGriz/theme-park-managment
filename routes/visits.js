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

// GET /visits/new
router.get('/new', isAuthenticated, canManageMembersVisits, async (req, res) => {
    try {
        const [ticketTypes] = await pool.query("SELECT ticket_type_id, public_ticket_type_id, type_name, base_price, is_member_type FROM ticket_types WHERE is_active = TRUE ORDER BY is_member_type DESC, base_price ASC");
        const [activeMembers] = await pool.query(`SELECT membership_id, public_membership_id, primary_member_id, first_name, last_name, email, phone_number, guest_passes_remaining, type_id FROM membership WHERE end_date >= CURDATE() ORDER BY last_name, first_name`);
        const [promos] = await pool.query("SELECT discount_percent FROM event_promotions WHERE CURDATE() BETWEEN start_date AND end_date ORDER BY discount_percent DESC LIMIT 1");
        const currentDiscount = (promos.length > 0) ? promos[0].discount_percent : 0;

        let foundTickets = null;
        const ticketSearchTerm = req.query.ticket_search || '';

        // --- SMART RETURN LOGIC: Determine state and build query string ---
        const activeTab = req.query.active_tab || (ticketSearchTerm ? 'redeem' : 'standard');
        const returnParams = new URLSearchParams();
        if (ticketSearchTerm) returnParams.append('ticket_search', ticketSearchTerm);
        if (activeTab) returnParams.append('active_tab', activeTab);
        const returnQuery = returnParams.toString();
        // ---------------------------

        if (ticketSearchTerm) {
            const searchSql = `SELECT pt.*, tt.type_name FROM prepaid_tickets pt JOIN ticket_types tt ON pt.ticket_type_id = tt.ticket_type_id WHERE (pt.email LIKE ? OR pt.phone_number LIKE ?) AND pt.is_redeemed = FALSE ORDER BY pt.purchase_date DESC`;
            const searchPattern = `%${ticketSearchTerm}%`;
            const [results] = await pool.query(searchSql, [searchPattern, searchPattern]);
            foundTickets = results;
        }

        res.render('log-visit', {
            error: req.session.error,
            success: req.session.success,
            ticketTypes: ticketTypes,
            activeMembers: activeMembers,
            currentDiscount: currentDiscount,
            normalizePhone: normalizePhone,
            foundTickets: foundTickets,
            ticketSearchTerm: ticketSearchTerm,
            activeTab: activeTab, // Pass active tab state
            returnQuery: returnQuery // Pass constructed query string
        });
        req.session.error = null; req.session.success = null;
    } catch (error) {
        console.error(error);
        res.render('log-visit', { error: "Error fetching data.", success: null, ticketTypes: [], activeMembers: [], currentDiscount: 0, normalizePhone: (p) => p, foundTickets: null, ticketSearchTerm: "", activeTab: 'standard', returnQuery: '' });
    }
});

// POST /visits
// POST /visits
router.post('/', isAuthenticated, canManageMembersVisits, async (req, res) => {
    // Capture original returnQuery for error handling
    const {
        ticket_type_id,
        returnQuery: originalReturnQuery,
        ticket_quantity // ADDED: Retrieve the quantity input
    } = req.body;
    const member_ids = [].concat(req.body.member_ids || []);
    const visit_date = new Date();
    const { id: actorId } = req.session.user;
    let connection;

    const visitGroupId = crypto.randomUUID();

    try {
        connection = await pool.getConnection();
        const [ticketResult] = await connection.query("SELECT type_name, base_price, is_member_type FROM ticket_types WHERE ticket_type_id = ?", [ticket_type_id]);
        if (ticketResult.length === 0) throw new Error("Invalid ticket type.");
        const ticket = ticketResult[0];
        const todayStr = visit_date.toISOString().substring(0, 10);

        if (ticket.is_member_type) {
            if (member_ids.length === 0) throw new Error("No members selected.");
            await connection.beginTransaction();

            const guestTickets = []; // For Carousel (Guest Pass)

            for (const memberId of member_ids) {
                const [memData] = await connection.query("SELECT type_id, guest_passes_remaining, first_name, last_name, public_membership_id FROM membership WHERE membership_id = ?", [memberId]);
                const member = memData[0];

                // --- GUEST PASS LOGIC (Multiple) ---
                if (ticket.type_name === 'Guest Pass') {
                    // Get quantity from the dynamic input name
                    const qtyRequested = parseInt(req.body['guest_qty_' + memberId]) || 1;

                    if (member.guest_passes_remaining < qtyRequested) {
                        throw new Error(`Member ${member.first_name} only has ${member.guest_passes_remaining} passes, but ${qtyRequested} were requested.`);
                    }

                    // Deduct Passes
                    await connection.query(
                        "UPDATE membership SET guest_passes_remaining = guest_passes_remaining - ? WHERE membership_id = ?",
                        [qtyRequested, memberId]
                    );

                    // Insert Vist Rows (One per guest)
                    for (let i = 0; i < qtyRequested; i++) {

                        // Generate a full UUID for the receipt visual/barcode
                        const guestPassCode = crypto.randomUUID();

                        await connection.query(
                            `INSERT INTO visits (visit_date, ticket_type_id, membership_id, ticket_price, discount_amount, logged_by_employee_id, visit_group_id)
                             VALUES (?, ?, ?, 0.00, 0.00, ?, ?)`,
                            [visit_date, ticket_type_id, memberId, actorId, visitGroupId]
                        );

                        // Add to carousel list (using the full UUID)
                        guestTickets.push({
                            name: "Guest Pass",
                            code: guestPassCode, // Using full UUID
                            memberName: `${member.first_name} ${member.last_name}`
                        });
                    }

                }
                // --- STANDARD MEMBER CHECK-IN ---
                else {
                    const [blackout] = await connection.query("SELECT reason FROM blackout_dates WHERE type_id = ? AND blackout_date = ?", [member.type_id, todayStr]);
                    if (blackout.length > 0) throw new Error(`Blackout Date Enforced: ${blackout[0].reason}.`);

                    await connection.query(
                        `INSERT INTO visits (visit_date, ticket_type_id, membership_id, ticket_price, discount_amount, logged_by_employee_id, visit_group_id)
                         VALUES (?, ?, ?, 0.00, 0.00, ?, ?)`,
                        [visit_date, ticket_type_id, memberId, actorId, visitGroupId]
                    );
                }
            }

            // --- RECEIPT DATA GENERATION ---
            let receiptData = {
                visit_group_id: visitGroupId,
                visit_date: formatReceiptDate(visit_date),
                ticket_name: ticket.type_name,
                base_price: 0.00, discount_amount: 0.00, total_cost: 0.00, promo_applied: 'N/A',
                is_member: true,
                staff_name: `${req.session.user.firstName} ${req.session.user.lastName}`,
                // ... member details ...
                member_id: '', member_name: '', member_type: '', member_phone: '', guest_passes_remaining: 0, subMembers: []
            };

            // If it was a Guest Pass batch, populate the 'tickets' array for Carousel
            if (ticket.type_name === 'Guest Pass') {
                receiptData.tickets = guestTickets; // Trigger Carousel Mode
            } else {
                // Standard Member Check-in (KEEPING LIST VIEW)
                const [checkedInMembers] = await connection.query(`SELECT m.membership_id, m.primary_member_id, m.first_name, m.last_name, m.phone_number, m.public_membership_id, mt.type_name FROM membership m JOIN membership_type mt ON m.type_id = mt.type_id WHERE m.membership_id IN (?)`, [member_ids]);
                const primaryMemberInList = checkedInMembers.find(m => m.primary_member_id === null);
                const primaryId = primaryMemberInList ? primaryMemberInList.membership_id : checkedInMembers[0].primary_member_id;
                const [primaryData] = await connection.query(`SELECT first_name, last_name, phone_number, public_membership_id, type_name FROM membership m JOIN membership_type mt ON m.type_id = mt.type_id WHERE membership_id = ?`, [primaryId]);

                receiptData.member_id = primaryData[0].public_membership_id;
                receiptData.member_name = `${primaryData[0].first_name} ${primaryData[0].last_name}`;
                receiptData.member_type = primaryData[0].type_name;
                receiptData.member_phone = censorPhone(primaryData[0].phone_number);
                receiptData.subMembers = checkedInMembers.filter(m => m.membership_id !== primaryId).map(sub => ({ ...sub, membership_id: sub.public_membership_id }));
            }

            await connection.commit();

            // Clear returnQuery on SUCCESS for Standard/Member check-in (resets smart return)
            const resetReturnQuery = '';
            res.render('member-visit-receipt', {
                receipt: receiptData,
                fromLogVisit: true,
                returnQuery: resetReturnQuery
            });

        } else {
            // --- NON-MEMBER LOGIC (Standard Ticket) ---
            await connection.beginTransaction();

            // 1. Get Quantity and validate
            const quantity = parseInt(ticket_quantity) || 1;
            if (quantity <= 0) throw new Error("Ticket quantity must be at least 1.");

            const [promos] = await pool.query("SELECT event_name, discount_percent FROM event_promotions WHERE CURDATE() BETWEEN start_date AND end_date ORDER BY discount_percent DESC LIMIT 1");
            const currentDiscountPercent = (promos.length > 0) ? promos[0].discount_percent : 0;
            const promoName = (promos.length > 0) ? promos[0].event_name : 'N/A';

            // 2. Calculate price/discount for A SINGLE ticket
            const singleTicketPrice = parseFloat(ticket.base_price);
            const singleDiscountAmount = singleTicketPrice * (parseFloat(currentDiscountPercent) / 100.0);

            // 3. Calculate total for X tickets
            const totalBasePrice = singleTicketPrice * quantity;
            const totalDiscountAmount = singleDiscountAmount * quantity;
            const totalCost = totalBasePrice - totalDiscountAmount;

            let ticketCodes = []; // To store codes for the receipt carousel

            // 4. Loop to insert visits and generate codes
            for (let i = 0; i < quantity; i++) {
                const singleTicketCode = crypto.randomUUID();

                // Log each ticket purchase/visit individually
                await connection.query(`
                    INSERT INTO visits (visit_date, ticket_type_id, membership_id, ticket_price, discount_amount, logged_by_employee_id, visit_group_id) 
                    VALUES (?, ?, NULL, ?, ?, ?, ?)`,
                    [visit_date, ticket_type_id, singleTicketPrice, singleDiscountAmount, actorId, visitGroupId]);

                ticketCodes.push({
                    name: ticket.type_name,
                    code: singleTicketCode
                });
            }

            // 5. Build receipt data with collective totals
            let receiptData = {
                visit_group_id: visitGroupId,
                visit_date: formatReceiptDate(visit_date),
                ticket_name: ticket.type_name,
                base_price: totalBasePrice,          // Total base price
                discount_amount: totalDiscountAmount, // Total discount
                total_cost: totalCost,               // Total cost
                promo_applied: promoName,
                is_member: false,
                staff_name: `${req.session.user.firstName} ${req.session.user.lastName}`,
                member_id: null, member_name: null, member_type: null, member_phone: null, subMembers: []
            };

            // Set the generated tickets for the carousel view
            receiptData.tickets = ticketCodes;

            await connection.commit();

            // Clear returnQuery on SUCCESS for Standard/Member check-in (resets smart return)
            const resetReturnQuery = '';
            res.render('visit-receipt', { receipt: receiptData, fromLogVisit: true, returnQuery: resetReturnQuery });
        }
    } catch (error) {
        if (connection) await connection.rollback();
        console.error("Error:", error);
        req.session.error = `Error: ${error.message}`;

        // Use originalReturnQuery for redirect to maintain state on error
        const redirectUrl = '/visits/new' + (originalReturnQuery ? `?${originalReturnQuery}` : '');
        res.redirect(redirectUrl);
    } finally {
        if (connection) connection.release();
    }
});

// POST /visits/redeem
router.post('/redeem', isAuthenticated, canManageMembersVisits, async (req, res) => {
    const { ticket_code, returnQuery } = req.body; // Capture returnQuery
    const { id: actorId } = req.session.user;
    let connection;

    // Construct Error Redirect URL
    const redirectOnError = '/visits/new' + (returnQuery ? `?${returnQuery}` : '');

    try {
        connection = await pool.getConnection();
        const [ticketResult] = await connection.query("SELECT * FROM prepaid_tickets WHERE ticket_code = ?", [ticket_code]);

        if (ticketResult.length === 0) {
            req.session.error = `Ticket code "${ticket_code}" not found.`;
            return res.redirect(redirectOnError);
        }

        const ticket = ticketResult[0];
        if (ticket.is_redeemed) {
            req.session.error = `Already redeemed.`;
            return res.redirect(redirectOnError);
        }

        await connection.beginTransaction();
        const visitGroupId = crypto.randomUUID();
        const visit_date = new Date();
        const visitSql = `INSERT INTO visits (visit_date, ticket_type_id, membership_id, ticket_price, discount_amount, logged_by_employee_id, visit_group_id) VALUES (?, ?, NULL, ?, ?, ?, ?)`;
        const [visitInsert] = await connection.query(visitSql, [visit_date, ticket.ticket_type_id, ticket.base_price, ticket.discount_amount, actorId, visitGroupId]);
        await connection.query("UPDATE prepaid_tickets SET is_redeemed = TRUE, redeemed_date = ?, visit_id = ? WHERE e_ticket_id = ?", [visit_date, visitInsert.insertId, ticket.e_ticket_id]);
        await connection.commit();

        const [ticketType] = await pool.query("SELECT type_name FROM ticket_types WHERE ticket_type_id = ?", [ticket.ticket_type_id]);

        let receiptData = {
            visit_group_id: visitGroupId, visit_date: formatReceiptDate(visit_date), ticket_name: ticketType[0].type_name,
            base_price: parseFloat(ticket.base_price), discount_amount: parseFloat(ticket.base_price), total_cost: 0.00, promo_applied: 'Prepaid E-Ticket',
            is_member: false, staff_name: `${req.session.user.firstName} ${req.session.user.lastName}`,
            member_id: null, member_name: "E-Ticket Guest", member_type: null, member_phone: null, subMembers: [],
            tickets: [{ name: ticketType[0].type_name, code: ticket_code }]
        };

        // Pass returnQuery to the receipt view (Maintains smart return for prepaid tickets)
        res.render('visit-receipt', { receipt: receiptData, fromLogVisit: true, returnQuery });

    } catch (error) {
        if (connection) await connection.rollback();
        req.session.error = "Error during redemption.";
        res.redirect(redirectOnError);
    } finally { if (connection) connection.release(); }
});

// GET /visits/receipt-group/:visit_group_id (Admin view of receipt)
router.get('/receipt-group/:visit_group_id', isAuthenticated, canManageMembersVisits, async (req, res) => {
    // (Logic is identical to before, just standardizing receipt data structure)
    const { visit_group_id } = req.params;
    let connection;
    try {
        connection = await pool.getConnection();
        const [visitsInGroup] = await connection.query(`SELECT v.*, tt.type_name AS ticket_name, CONCAT(e.first_name, ' ', e.last_name) as staff_name, m.primary_member_id, m.first_name, m.last_name, m.phone_number, m.public_membership_id, m.guest_passes_remaining FROM visits v JOIN membership m ON v.membership_id = m.membership_id JOIN ticket_types tt ON v.ticket_type_id = tt.ticket_type_id LEFT JOIN employee_demographics e ON v.logged_by_employee_id = e.employee_id WHERE v.visit_group_id = ?`, [visit_group_id]);
        if (visitsInGroup.length === 0) { return res.status(404).send('Visit not found.'); }
        const primaryMemberInList = visitsInGroup.find(m => m.primary_member_id === null);
        const visitPrimaryId = primaryMemberInList ? primaryMemberInList.membership_id : visitsInGroup[0].primary_member_id;
        const [primaryMemberData] = await connection.query(`SELECT m.first_name, m.last_name, m.phone_number, m.public_membership_id, m.guest_passes_remaining, mt.type_name FROM membership m JOIN membership_type mt ON m.type_id = mt.type_id WHERE m.membership_id = ?`, [visitPrimaryId]);
        const primaryMember = primaryMemberData[0];
        const receiptData = {
            visit_group_id: visit_group_id, visit_date: formatReceiptDate(visitsInGroup[0].visit_date), ticket_name: visitsInGroup[0].ticket_name,
            base_price: 0.00, discount_amount: 0.00, total_cost: 0.00, promo_applied: 'N/A', is_member: true,
            staff_name: visitsInGroup[0].staff_name || 'N/A', member_id: primaryMember.public_membership_id,
            member_name: `${primaryMember.first_name} ${primaryMember.last_name}`, member_type: primaryMember.type_name,
            member_phone: censorPhone(primaryMember.phone_number), guest_passes_remaining: primaryMember.guest_passes_remaining,
            subMembers: visitsInGroup.filter(v => v.membership_id !== visitPrimaryId).map(v => ({ first_name: v.first_name, last_name: v.last_name, membership_id: v.public_membership_id }))
        };
        res.render('visit-receipt', { receipt: receiptData, fromLogVisit: false });
    } catch (error) { console.error(error); res.status(500).send("Error."); } finally { if (connection) connection.release(); }
});

module.exports = router;