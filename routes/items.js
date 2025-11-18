const express = require('express');
const router = express.Router();
const pool = require('../db');
const crypto = require('crypto');
const { isAuthenticated, canManageRetail } = require('../middleware/auth');

// GET /items
router.get('/', isAuthenticated, canManageRetail, async (req, res) => {
    try {
        // 1. Capture Query Params
        const { search, sort, dir, filter_type } = req.query;

        // 2. Prepare Filters
        let whereClauses = [];
        let params = [];

        if (search) {
            const term = `%${search}%`;
            whereClauses.push('(item_name LIKE ? OR summary LIKE ? OR public_item_id LIKE ?)');
            params.push(term, term, term);
        }

        if (filter_type) {
            whereClauses.push('item_type = ?');
            params.push(filter_type);
        }

        let whereQuery = whereClauses.length > 0 ? ` WHERE ${whereClauses.join(' AND ')}` : '';

        // 3. Stats Query
        const countQuery = `
            SELECT
                COUNT(*) as total,
                SUM(CASE WHEN item_type = 'Food' THEN 1 ELSE 0 END) as countFood,
                SUM(CASE WHEN item_type = 'Souvenir' THEN 1 ELSE 0 END) as countSouvenir,
                SUM(CASE WHEN item_type = 'Apparel' THEN 1 ELSE 0 END) as countApparel,
                SUM(CASE WHEN item_type = 'Other' THEN 1 ELSE 0 END) as countOther
            FROM item
            ${whereQuery}
        `;
        const [countResult] = await pool.query(countQuery, params);
        const counts = countResult[0];

        // 4. Sorting Logic
        let orderBy = ' ORDER BY item_name ASC'; // Default
        if (sort && dir) {
            const d = dir === 'desc' ? 'DESC' : 'ASC';
            switch (sort) {
                case 'id': orderBy = ` ORDER BY item_id ${d}`; break;
                case 'name': orderBy = ` ORDER BY item_name ${d}`; break;
                case 'type': orderBy = ` ORDER BY item_type ${d}`; break;
                case 'price': orderBy = ` ORDER BY price ${d}`; break;
            }
        }

        // 5. Fetch Main Data
        // ADDED public_item_id to selection
        const mainQuery = `SELECT *, public_item_id FROM item ${whereQuery} ${orderBy}`;
        const [items] = await pool.query(mainQuery, params);

        // 6. Fetch Filter Options
        const [types] = await pool.query('SELECT DISTINCT item_type FROM item ORDER BY item_type');

        res.render('items', {
            items: items,
            counts: counts,
            types: types,
            search: search || "",
            filters: { type: filter_type || "" },
            currentSort: sort || "",
            currentDir: dir || ""
        });

    } catch (error) {
        console.error(error);
        res.status(500).send('Error fetching items');
    }
});

// GET /items/new
router.get('/new', isAuthenticated, canManageRetail, async (req, res) => {
    res.render('add-item', { error: null });
});

// POST /items
router.post('/', isAuthenticated, canManageRetail, async (req, res) => {
    const { item_name, item_type, price, summary } = req.body;
    let connection;
    try {
        connection = await pool.getConnection();
        const publicItemId = crypto.randomUUID();

        const sql = "INSERT INTO item (public_item_id, item_name, item_type, price, summary) VALUES (?, ?, ?, ?, ?)";
        await connection.query(sql, [publicItemId, item_name, item_type, price, summary || null]);

        res.redirect('/items');
    } catch (error) {
        console.error(error);
        res.render('add-item', { error: "Database error adding item." });
    } finally {
        if (connection) connection.release();
    }
});

module.exports = router;