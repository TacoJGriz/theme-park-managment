const express = require('express');
const router = express.Router();
const pool = require('../db');
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
router.post('/', isAuthenticated, canManageMembersVisits, async (req, res) => {
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
        res.render('visit-receipt', { receipt: receiptData, fromLogVisit: true });
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

module.exports = router;