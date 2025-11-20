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

        // --- SMART RETURN LOGIC ---
        const activeTab = req.query.active_tab || (ticketSearchTerm ? 'redeem' : 'standard');
        const returnParams = new URLSearchParams();
        if (ticketSearchTerm) returnParams.append('ticket_search', ticketSearchTerm);
        if (activeTab) returnParams.append('active_tab', activeTab);
        const returnQuery = returnParams.toString();

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
            activeTab: activeTab,
            returnQuery: returnQuery
        });
        req.session.error = null; req.session.success = null;
    } catch (error) {
        console.error(error);
        res.render('log-visit', { error: "Error fetching data.", success: null, ticketTypes: [], activeMembers: [], currentDiscount: 0, normalizePhone: (p) => p, foundTickets: null, ticketSearchTerm: "", activeTab: 'standard', returnQuery: '' });
    }
});

// POST /visits
router.post('/', isAuthenticated, canManageMembersVisits, async (req, res) => {
    const {
        visit_mode,
        quantities,
        member_ticket_type_id,
        returnQuery: originalReturnQuery
    } = req.body;

    const { id: actorId } = req.session.user;
    const visit_date = new Date();
    const visitGroupId = crypto.randomUUID();
    let connection;

    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        // --- SCENARIO A: STANDARD TICKET PURCHASE (Mix & Match) ---
        if (visit_mode === 'standard') {
            const [promos] = await connection.query("SELECT event_name, discount_percent FROM event_promotions WHERE CURDATE() BETWEEN start_date AND end_date ORDER BY discount_percent DESC LIMIT 1");
            const currentDiscountPercent = (promos.length > 0) ? promos[0].discount_percent : 0;
            const promoName = (promos.length > 0) ? promos[0].event_name : 'N/A';

            const [standardTicketTypes] = await connection.query(
                "SELECT ticket_type_id, type_name, base_price FROM ticket_types WHERE is_active = TRUE AND is_member_type = FALSE ORDER BY base_price ASC"
            );

            let totalBasePrice = 0;
            let totalDiscountAmount = 0;
            let ticketCodes = [];
            let hasItems = false;

            if (quantities && Array.isArray(quantities)) {
                for (let i = 0; i < quantities.length; i++) {
                    const qty = parseInt(quantities[i]) || 0;

                    if (qty > 0 && standardTicketTypes[i]) {
                        hasItems = true;
                        const ticket = standardTicketTypes[i];

                        const singlePrice = parseFloat(ticket.base_price);
                        const singleDiscount = singlePrice * (parseFloat(currentDiscountPercent) / 100.0);

                        for (let j = 0; j < qty; j++) {
                            const code = crypto.randomUUID();
                            await connection.query(`
                                INSERT INTO visits (visit_date, ticket_type_id, membership_id, ticket_price, discount_amount, logged_by_employee_id, visit_group_id) 
                                VALUES (?, ?, NULL, ?, ?, ?, ?)`,
                                [visit_date, ticket.ticket_type_id, singlePrice, singleDiscount, actorId, visitGroupId]);

                            ticketCodes.push({ name: ticket.type_name, code: code });
                            totalBasePrice += singlePrice;
                            totalDiscountAmount += singleDiscount;
                        }
                    }
                }
            }

            if (!hasItems) throw new Error("No tickets selected. Please enter a quantity.");

            const receiptData = {
                visit_group_id: visitGroupId,
                visit_date: formatReceiptDate(visit_date),
                ticket_name: "Standard Entry (Mixed)",
                base_price: totalBasePrice,
                discount_amount: totalDiscountAmount,
                total_cost: totalBasePrice - totalDiscountAmount,
                promo_applied: promoName,
                is_member: false,
                staff_name: `${req.session.user.firstName} ${req.session.user.lastName}`,
                tickets: ticketCodes
            };

            await connection.commit();
            res.render('visit-receipt', { receipt: receiptData, fromLogVisit: true, returnQuery: '' });

        }
        // --- SCENARIO B: MEMBER CHECK-IN ---
        else {
            const member_ids = [].concat(req.body.member_ids || []);
            if (member_ids.length === 0) throw new Error("No members selected.");

            const [ticketResult] = await connection.query("SELECT type_name, base_price, is_member_type FROM ticket_types WHERE ticket_type_id = ?", [member_ticket_type_id]);
            if (ticketResult.length === 0) throw new Error("Invalid member ticket type.");
            const ticket = ticketResult[0];

            const todayStr = visit_date.toISOString().substring(0, 10);
            const guestTickets = [];

            for (const memberId of member_ids) {
                const [memData] = await connection.query("SELECT type_id, guest_passes_remaining, first_name, last_name, public_membership_id, phone_number FROM membership WHERE membership_id = ?", [memberId]);
                const member = memData[0];

                if (ticket.type_name === 'Guest Pass') {
                    const qtyRequested = parseInt(req.body['guest_qty_' + memberId]) || 1;

                    if (member.guest_passes_remaining < qtyRequested) {
                        throw new Error(`Member ${member.first_name} only has ${member.guest_passes_remaining} passes.`);
                    }

                    await connection.query("UPDATE membership SET guest_passes_remaining = guest_passes_remaining - ? WHERE membership_id = ?", [qtyRequested, memberId]);

                    for (let i = 0; i < qtyRequested; i++) {
                        const guestPassCode = crypto.randomUUID();
                        await connection.query(
                            `INSERT INTO visits (visit_date, ticket_type_id, membership_id, ticket_price, discount_amount, logged_by_employee_id, visit_group_id)
                             VALUES (?, ?, ?, 0.00, 0.00, ?, ?)`,
                            [visit_date, member_ticket_type_id, memberId, actorId, visitGroupId]
                        );
                        guestTickets.push({
                            name: "Guest Pass",
                            code: guestPassCode,
                            memberName: `${member.first_name} ${member.last_name}`
                        });
                    }
                } else {
                    const [blackout] = await connection.query("SELECT reason FROM blackout_dates WHERE type_id = ? AND blackout_date = ?", [member.type_id, todayStr]);
                    if (blackout.length > 0) throw new Error(`Blackout Date: ${blackout[0].reason}.`);

                    await connection.query(
                        `INSERT INTO visits (visit_date, ticket_type_id, membership_id, ticket_price, discount_amount, logged_by_employee_id, visit_group_id)
                         VALUES (?, ?, ?, 0.00, 0.00, ?, ?)`,
                        [visit_date, member_ticket_type_id, memberId, actorId, visitGroupId]
                    );
                }
            }

            // --- RECEIPT GENERATION ---
            let receiptData = {
                visit_group_id: visitGroupId,
                visit_date: formatReceiptDate(visit_date),
                ticket_name: ticket.type_name,
                base_price: 0.00, discount_amount: 0.00, total_cost: 0.00, promo_applied: 'N/A',
                is_member: true,
                staff_name: `${req.session.user.firstName} ${req.session.user.lastName}`,
                member_id: '', member_name: '', member_type: '', member_phone: '', guest_passes_remaining: 0, subMembers: []
            };

            if (ticket.type_name === 'Guest Pass') {
                // --- SCENARIO B1: GUEST PASS (Carousel View) ---
                receiptData.tickets = guestTickets;
                await connection.commit();

                // CHANGED: Render 'visit-receipt' for Guest Passes to get the carousel style
                res.render('visit-receipt', { receipt: receiptData, fromLogVisit: true, returnQuery: '' });

            } else {
                // --- SCENARIO B2: STANDARD MEMBER CHECK-IN (List View) ---
                const [checkedInMembers] = await connection.query(`SELECT m.membership_id, m.primary_member_id, m.first_name, m.last_name, m.phone_number, m.public_membership_id, mt.type_name FROM membership m JOIN membership_type mt ON m.type_id = mt.type_id WHERE m.membership_id IN (?)`, [member_ids]);
                const primaryMemberInList = checkedInMembers.find(m => m.primary_member_id === null);
                const primaryId = primaryMemberInList ? primaryMemberInList.membership_id : checkedInMembers[0].primary_member_id;
                const [primaryData] = await connection.query(`SELECT first_name, last_name, phone_number, public_membership_id, type_name FROM membership m JOIN membership_type mt ON m.type_id = mt.type_id WHERE membership_id = ?`, [primaryId]);

                receiptData.member_id = primaryData[0].public_membership_id;
                receiptData.member_name = `${primaryData[0].first_name} ${primaryData[0].last_name}`;
                receiptData.member_type = primaryData[0].type_name;
                receiptData.member_phone = censorPhone(primaryData[0].phone_number);
                receiptData.subMembers = checkedInMembers.filter(m => m.membership_id !== primaryId).map(sub => ({ ...sub, membership_id: sub.public_membership_id }));

                await connection.commit();
                res.render('member-visit-receipt', { receipt: receiptData, fromLogVisit: true, returnQuery: '' });
            }
        }

    } catch (error) {
        if (connection) await connection.rollback();
        console.error("Error:", error);
        req.session.error = `Error: ${error.message}`;
        const redirectUrl = '/visits/new' + (originalReturnQuery ? `?${originalReturnQuery}` : '');
        res.redirect(redirectUrl);
    } finally {
        if (connection) connection.release();
    }
});

router.post('/redeem', isAuthenticated, canManageMembersVisits, async (req, res) => {
    const { ticket_code, returnQuery } = req.body;
    const { id: actorId } = req.session.user;
    let connection;
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

        res.render('visit-receipt', { receipt: receiptData, fromLogVisit: true, returnQuery });

    } catch (error) {
        if (connection) await connection.rollback();
        req.session.error = "Error during redemption.";
        res.redirect(redirectOnError);
    } finally { if (connection) connection.release(); }
});

router.get('/receipt-group/:visit_group_id', isAuthenticated, canManageMembersVisits, async (req, res) => {
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