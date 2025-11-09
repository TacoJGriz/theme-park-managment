const express = require('express');
const router = express.Router();
const pool = require('../db');
const { isAuthenticated, canManageRetail } = require('../middleware/auth');

// GET /items
// This is the root (/) because app.js adds the /items prefix
router.get('/', isAuthenticated, canManageRetail, async (req, res) => {
    try {
        const [items] = await pool.query('SELECT * FROM item ORDER BY item_name');
        res.render('items', { items: items });
    } catch (error) {
        console.error(error);
        res.status(500).send('Error fetching items');
    }
});

// GET /items/new
// This path is /new
router.get('/new', isAuthenticated, canManageRetail, async (req, res) => {
    res.render('add-item', { error: null });
});

// POST /items
// This path is /
router.post('/', isAuthenticated, canManageRetail, async (req, res) => {
    const { item_name, item_type, price, summary } = req.body;
    let connection;
    try {
        connection = await pool.getConnection();
        const sql = "INSERT INTO item (item_name, item_type, price, summary) VALUES (?, ?, ?, ?)";
        await connection.query(sql, [item_name, item_type, price, summary || null]);
        res.redirect('/items');
    } catch (error) {
        console.error(error);
        res.render('add-item', { error: "Database error adding item." });
    } finally {
        if (connection) connection.release();
    }
});

module.exports = router;