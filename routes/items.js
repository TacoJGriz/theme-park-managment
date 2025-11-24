const express = require('express');
const router = express.Router();
const pool = require('../db');
const crypto = require('crypto');
const {
    isAuthenticated,
    canManageRetail
} = require('../middleware/auth');

// list items
router.get('/', isAuthenticated, canManageRetail, async (req, res) => {
    try {
        const {
            search,
            sort,
            dir,
            filter_type
        } = req.query;

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

        // get counts
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

        // sorting
        let orderBy = ' ORDER BY item_name ASC';
        if (sort && dir) {
            const d = dir === 'desc' ? 'DESC' : 'ASC';
            switch (sort) {
                case 'id':
                    orderBy = ` ORDER BY item_id ${d}`;
                    break;
                case 'name':
                    orderBy = ` ORDER BY item_name ${d}`;
                    break;
                case 'type':
                    orderBy = ` ORDER BY item_type ${d}`;
                    break;
                case 'price':
                    orderBy = ` ORDER BY price ${d}`;
                    break;
            }
        }

        const mainQuery = `SELECT *, public_item_id FROM item ${whereQuery} ${orderBy}`;
        const [items] = await pool.query(mainQuery, params);

        const [types] = await pool.query('SELECT DISTINCT item_type FROM item ORDER BY item_type');

        res.render('items', {
            items,
            counts,
            types,
            search: search || "",
            filters: {
                type: filter_type || ""
            },
            currentSort: sort || "",
            currentDir: dir || ""
        });

    } catch (error) {
        console.error(error);
        res.status(500).send('Error fetching items');
    }
});

// new item form
router.get('/new', isAuthenticated, canManageRetail, async (req, res) => {
    res.render('add-item', {
        error: null
    });
});

// add item
router.post('/', isAuthenticated, canManageRetail, async (req, res) => {
    const {
        item_name,
        item_type,
        price,
        summary
    } = req.body;
    let connection;
    try {
        connection = await pool.getConnection();
        const publicItemId = crypto.randomUUID();

        const sql = "INSERT INTO item (public_item_id, item_name, item_type, price, summary) VALUES (?, ?, ?, ?, ?)";
        await connection.query(sql, [publicItemId, item_name, item_type, price, summary || null]);

        res.redirect('/items');
    } catch (error) {
        console.error(error);
        res.render('add-item', {
            error: "Database error adding item."
        });
    } finally {
        if (connection) connection.release();
    }
});

// edit form
router.get('/edit/:public_item_id', isAuthenticated, canManageRetail, async (req, res) => {
    const {
        public_item_id
    } = req.params;
    try {
        const [itemResult] = await pool.query('SELECT * FROM item WHERE public_item_id = ?', [public_item_id]);
        if (itemResult.length === 0) {
            return res.status(404).send('Item not found');
        }
        const item = itemResult[0];

        const [types] = await pool.query('SELECT DISTINCT item_type FROM item');

        res.render('edit-item', {
            item,
            types,
            error: null
        });

    } catch (error) {
        console.error(error);
        res.status(500).send('Error loading edit item page.');
    }
});

// update item
router.post('/edit/:public_item_id', isAuthenticated, canManageRetail, async (req, res) => {
    const {
        public_item_id
    } = req.params;
    const {
        item_name,
        item_type,
        price,
        summary
    } = req.body;
    try {
        const [itemResult] = await pool.query('SELECT * FROM item WHERE public_item_id = ?', [public_item_id]);
        if (itemResult.length === 0) {
            return res.status(404).send('Item not found for update.');
        }

        const sql = `
            UPDATE item 
            SET item_name = ?, item_type = ?, price = ?, summary = ? 
            WHERE public_item_id = ?
        `;
        await pool.query(sql, [item_name, item_type, price, summary || null, public_item_id]);

        res.redirect('/items');
    } catch (error) {
        console.error(error);

        const [types] = await pool.query('SELECT DISTINCT item_type FROM item');

        res.render('edit-item', {
            item: {
                ...req.body,
                public_item_id
            },
            types,
            error: 'Database error updating item. Please ensure the price is valid.'
        });
    }
});

// delete item
router.post('/delete/:public_item_id', isAuthenticated, canManageRetail, async (req, res) => {
    const {
        public_item_id
    } = req.params;
    let connection;
    try {
        connection = await pool.getConnection();

        const [itemRes] = await connection.query('SELECT item_id, item_name FROM item WHERE public_item_id = ?', [public_item_id]);
        if (itemRes.length === 0) {
            connection.release();
            req.session.error = "Error: Item not found.";
            return res.redirect('/items');
        }
        const item = itemRes[0];

        await connection.beginTransaction();

        // clear dependencies
        await connection.query('DELETE FROM inventory_requests WHERE item_id = ?', [item.item_id]);
        await connection.query('DELETE FROM inventory WHERE item_id = ?', [item.item_id]);
        await connection.query('DELETE FROM item WHERE item_id = ?', [item.item_id]);

        await connection.commit();

        req.session.success = `Item "${item.item_name}" and all associated inventory records were deleted successfully.`;
        res.redirect('/items');

    } catch (error) {
        if (connection) await connection.rollback();
        console.error("Error deleting item:", error);
        req.session.error = "Database error deleting item.";
        res.redirect(`/items/edit/${public_item_id}`);
    } finally {
        if (connection) connection.release();
    }
});

module.exports = router;