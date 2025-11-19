const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const pool = require('../db');
const crypto = require('crypto');
const {
    isAuthenticated,
    canViewUsers,
    canAddEmployees,
    canApproveEmployees,
    canViewPendingEmployees
} = require('../middleware/auth');

const saltRounds = 10;

// --- USER & EMPLOYEE MANAGEMENT ---

// GET /
router.get('/', isAuthenticated, canViewUsers, async (req, res) => {
    try {
        const { role, locationId } = req.session.user;
        const { search, sort, dir, filter_role, filter_location, filter_status } = req.query;

        // --- 1. Construct Query String for Links ---
        const queryParams = new URLSearchParams(req.query);
        const currentQueryString = queryParams.toString();

        // ... (Data fetching for dropdowns remains the same) ...
        const [allLocations] = await pool.query('SELECT location_id, location_name FROM location ORDER BY location_name');
        const [allRoles] = await pool.query('SELECT DISTINCT employee_type FROM employee_demographics ORDER BY employee_type');

        // ... (Filtering Logic remains the same) ...
        let whereClauses = [];
        let params = [];

        if (role === 'Location Manager') {
            whereClauses.push('e.location_id = ?');
            params.push(locationId);
        }

        if (search) {
            const likeTerm = `%${search}%`;
            let searchGroup = `(
                e.public_employee_id LIKE ? OR
                e.first_name LIKE ? OR
                e.last_name LIKE ? OR
                e.email LIKE ? OR
                e.employee_type LIKE ? OR
                l.location_name LIKE ?
            )`;
            params.push(likeTerm, likeTerm, likeTerm, likeTerm, likeTerm, likeTerm);
            whereClauses.push(searchGroup);
        }

        if (filter_role) {
            whereClauses.push('e.employee_type = ?');
            params.push(filter_role);
        }
        if (filter_location) {
            whereClauses.push('e.location_id = ?');
            params.push(filter_location);
        }
        if (filter_status) {
            if (filter_status === 'active') {
                whereClauses.push('(e.is_active = TRUE AND e.is_pending_approval = FALSE)');
            } else if (filter_status === 'inactive') {
                whereClauses.push('e.is_active = FALSE');
            } else if (filter_status === 'pending') {
                whereClauses.push('e.is_pending_approval = TRUE');
            }
        }

        let whereQuery = "";
        if (whereClauses.length > 0) {
            whereQuery = ` WHERE ${whereClauses.join(' AND ')}`;
        }

        // ... (Counts Query remains the same) ...
        const countQuery = `
            SELECT
                COUNT(*) as total,
                SUM(CASE WHEN e.is_active = TRUE AND e.is_pending_approval = FALSE THEN 1 ELSE 0 END) as active,
                SUM(CASE WHEN e.is_active = FALSE THEN 1 ELSE 0 END) as inactive,
                SUM(CASE WHEN e.is_pending_approval = TRUE THEN 1 ELSE 0 END) as pending
            FROM employee_demographics e
            LEFT JOIN location l ON e.location_id = l.location_id
            ${whereQuery}
        `;
        const [countResult] = await pool.query(countQuery, params);
        const counts = countResult[0];

        // ... (Sort Logic remains the same) ...
        let orderBy = '';
        if (sort === 'status') {
            const direction = (dir === 'desc') ? 'DESC' : 'ASC';
            orderBy = ` ORDER BY e.is_active ${direction}, e.is_pending_approval ${direction}`;
        } else {
            orderBy = ' ORDER BY e.is_active DESC, e.is_pending_approval DESC';
            if (sort && dir) {
                const direction = (dir === 'desc') ? 'DESC' : 'ASC';
                switch (sort) {
                    case 'id': orderBy += `, e.employee_id ${direction}`; break;
                    case 'name': orderBy += `, e.last_name ${direction}, e.first_name ${direction}`; break;
                    case 'email': orderBy += `, e.email ${direction}`; break;
                    case 'role': orderBy += `, e.employee_type ${direction}`; break;
                    case 'location': orderBy += `, l.location_name ${direction}`; break;
                }
            } else {
                orderBy += ', e.last_name ASC, e.first_name ASC';
            }
        }

        // ... (Main Query remains the same) ...
        const mainQuery = `
            SELECT 
                e.employee_id, e.public_employee_id, e.first_name, e.last_name, 
                e.email, e.employee_type, e.location_id, 
                e.is_pending_approval, e.is_active,
                l.location_name
            FROM employee_demographics e
            LEFT JOIN location l ON e.location_id = l.location_id
            ${whereQuery}
            ${orderBy}
        `;
        const [users] = await pool.query(mainQuery, params);

        res.render('users', {
            users: users,
            counts: counts,
            locations: allLocations,
            roles: allRoles,
            search: search || "",
            currentSort: sort || "",
            currentDir: dir || "",
            filters: {
                role: filter_role || "",
                location: filter_location || "",
                status: filter_status || ""
            },
            currentQueryString: currentQueryString, // Passed to view
            success: req.session.success,
            error: req.session.error
        });

        req.session.success = null;
        req.session.error = null;

    } catch (error) {
        console.error(error);
        res.status(500).send('Error querying the database');
    }
});

// GET /new
router.get('/new', isAuthenticated, canAddEmployees, async (req, res) => {
    try {
        const [locations] = await pool.query('SELECT location_id, location_name FROM location');
        const [supervisors] = await pool.query('SELECT employee_id, first_name, last_name, employee_type FROM employee_demographics WHERE is_active = TRUE');
        let creatableRoles = ['Staff', 'Maintenance', 'Location Manager', 'Park Manager', 'Admin'];

        res.render('add-employee', {
            locations: locations,
            supervisors: supervisors,
            creatableRoles: creatableRoles,
            error: null
        });
    } catch (error) {
        console.error(error);
        res.status(500).send('Error loading page');
    }
});

// POST /
router.post('/', isAuthenticated, canAddEmployees, async (req, res) => {
    const {
        first_name, last_name, gender, phone_number, email,
        street_address, city, state, zip_code,
        birth_date, hire_date, employee_type,
        location_id, hourly_rate, password, confirm_password
    } = req.body;
    const supervisor_id = req.body.supervisor_id ? req.body.supervisor_id : null;

    let locations = [];
    let supervisors = [];
    let creatableRoles = [];

    try {
        [locations] = await pool.query('SELECT location_id, location_name FROM location');
        [supervisors] = await pool.query('SELECT employee_id, first_name, last_name, employee_type FROM employee_demographics WHERE is_active = TRUE');
        creatableRoles = ['Staff', 'Maintenance', 'Location Manager', 'Park Manager', 'Admin'];

        if (password !== confirm_password) {
            return res.render('add-employee', {
                locations: locations,
                supervisors: supervisors,
                creatableRoles: creatableRoles,
                error: "Passwords do not match."
            });
        }
    } catch (error) {
        console.error("Error fetching dropdown data for add employee:", error);
        return res.render('add-employee', {
            locations: [], supervisors: [],
            creatableRoles: [],
            error: "Error loading form data. Please try again."
        });
    }

    let connection;
    try {
        const isPending = FALSE; // Set to FALSE since Admin bypasses pending status
        const publicEmployeeId = crypto.randomUUID();
        const hash = await bcrypt.hash(password, saltRounds);
        connection = await pool.getConnection();
        await connection.beginTransaction();

        const demoSql = `
            INSERT INTO employee_demographics
            (public_employee_id, first_name, last_name, gender, phone_number, email, street_address, city, state, zip_code,
            birth_date, hire_date, employee_type, location_id, supervisor_id, hourly_rate, is_pending_approval)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        await connection.query(demoSql, [
            publicEmployeeId,
            first_name, last_name, gender, phone_number || null, email, street_address || null, city || null, state || null, zip_code || null,
            birth_date, hire_date, employee_type, location_id, supervisor_id, hourly_rate || null, isPending
        ]);

        const newEmployeeId = (await connection.query('SELECT last_insert_id() as id'))[0][0].id;
        const authSql = "INSERT INTO employee_auth (employee_id, password_hash) VALUES (?, ?)";
        await connection.query(authSql, [newEmployeeId, hash]);

        await connection.commit();
        res.redirect(req.baseUrl);

    } catch (error) {
        if (connection) await connection.rollback();
        console.error("Error adding employee:", error);
        res.render('add-employee', {
            locations: locations,
            supervisors: supervisors,
            creatableRoles: creatableRoles,
            error: "Database error adding employee. The email may already be in use."
        });
    } finally {
        if (connection) connection.release();
    }
});

// GET /edit/:public_employee_id
router.get('/edit/:public_employee_id', isAuthenticated, canAddEmployees, async (req, res) => {
    const { public_employee_id } = req.params;

    // --- 1. Capture Query String to Return To ---
    const returnQuery = new URLSearchParams(req.query).toString();

    try {
        const [employeeResult] = await pool.query('SELECT * FROM employee_demographics WHERE public_employee_id = ?', [public_employee_id]);
        if (employeeResult.length === 0) {
            return res.status(404).send('Employee not found');
        }
        const employee = employeeResult[0];
        const targetId = employee.employee_id;

        const [locations] = await pool.query('SELECT location_id, location_name FROM location');
        const [supervisors] = await pool.query('SELECT employee_id, first_name, last_name, employee_type FROM employee_demographics WHERE is_active = TRUE AND employee_id != ?', [targetId]);

        res.render('edit-employee', {
            employee: employee,
            locations: locations,
            supervisors: supervisors,
            returnQuery: returnQuery, // Pass to view
            error: null
        });
    } catch (error) {
        console.error(error);
        res.status(500).send('Error loading edit page');
    }
});

// POST /edit/:public_employee_id
router.post('/edit/:public_employee_id', isAuthenticated, canAddEmployees, async (req, res) => {
    const { public_employee_id } = req.params;
    const { returnQuery } = req.body; // Capture return query from form

    let connection;
    try {
        connection = await pool.getConnection();
        await connection.query('UPDATE employee_demographics SET pending_hourly_rate = NULL, rate_change_requested_by = NULL WHERE public_employee_id = ?', [public_employee_id]);

        const {
            first_name, last_name, gender, phone_number, email,
            street_address, city, state, zip_code, birth_date,
            hire_date, employee_type, location_id, hourly_rate, is_active
        } = req.body;
        const supervisor_id = req.body.supervisor_id ? req.body.supervisor_id : null;
        const termination_date = req.body.termination_date ? req.body.termination_date : null;

        const sql = `
            UPDATE employee_demographics SET
            first_name = ?, last_name = ?, gender = ?, phone_number = ?, email = ?,
            street_address = ?, city = ?, state = ?, zip_code = ?, birth_date = ?,
            hire_date = ?, termination_date = ?, employee_type = ?, location_id = ?,
            supervisor_id = ?, hourly_rate = ?, is_active = ?
            WHERE public_employee_id = ?
        `;
        await connection.query(sql, [
            first_name, last_name, gender, phone_number || null, email, street_address || null, city || null, state || null, zip_code || null,
            birth_date, hire_date, termination_date, employee_type, location_id,
            supervisor_id, hourly_rate || null, is_active === '1',
            public_employee_id
        ]);

        req.session.success = 'Employee details updated successfully.';

        // Redirect back to the filtered list if applicable
        const redirectUrl = returnQuery ? `${req.baseUrl}?${returnQuery}` : req.baseUrl;
        res.redirect(redirectUrl);

    } catch (error) {
        console.error("Error updating employee:", error);
        try {
            const [employeeResult] = await pool.query('SELECT * FROM employee_demographics WHERE public_employee_id = ?', [public_employee_id]);
            const employee = employeeResult.length > 0 ? employeeResult[0] : {};
            const [locations] = await pool.query('SELECT location_id, location_name FROM location');
            const [supervisors] = await pool.query('SELECT employee_id, first_name, last_name, employee_type FROM employee_demographics WHERE is_active = TRUE AND public_employee_id != ?', [public_employee_id]);

            res.render('edit-employee', {
                employee: employee,
                locations: locations,
                supervisors: supervisors,
                returnQuery: returnQuery,
                error: "Database error updating employee. Email might be a duplicate."
            });
        } catch (fetchError) {
            res.status(500).send("An error occurred while updating the employee.");
        }
    } finally {
        if (connection) connection.release();
    }
});

// GET /reset-password/:public_employee_id
router.get('/reset-password/:public_employee_id', isAuthenticated, canAddEmployees, async (req, res) => {
    const { public_employee_id } = req.params;
    const returnQuery = new URLSearchParams(req.query).toString(); // Capture query

    try {
        const [employeeResult] = await pool.query('SELECT employee_id, public_employee_id, first_name, last_name, employee_type FROM employee_demographics WHERE public_employee_id = ?', [public_employee_id]);
        if (employeeResult.length === 0) {
            return res.status(404).send('Employee not found');
        }
        const employee = employeeResult[0];
        res.render('reset-password', {
            employee: employee,
            returnQuery: returnQuery, // Pass to view
            error: null
        });

    } catch (error) {
        console.error("Error loading reset password page:", error);
        res.status(500).send("Error loading page");
    }
});

// POST /reset-password/:public_employee_id
router.post('/reset-password/:public_employee_id', isAuthenticated, canAddEmployees, async (req, res) => {
    const { public_employee_id } = req.params;
    const { password, confirm_password, returnQuery } = req.body; // Capture returnQuery

    let employee;
    try {
        const [employeeResult] = await pool.query('SELECT employee_id, public_employee_id, first_name, last_name, employee_type FROM employee_demographics WHERE public_employee_id = ?', [public_employee_id]);
        if (employeeResult.length === 0) {
            return res.status(404).send('Employee not found');
        }
        employee = employeeResult[0];
        const internal_employee_id = employee.employee_id;

        if (password !== confirm_password) {
            return res.render('reset-password', {
                employee: employee,
                returnQuery: returnQuery,
                error: "Passwords do not match. Please try again."
            });
        }

        const hash = await bcrypt.hash(password, saltRounds);
        const sql = "UPDATE employee_auth SET password_hash = ? WHERE employee_id = ?";
        await pool.query(sql, [hash, internal_employee_id]);

        // Redirect back to filtered list
        const redirectUrl = returnQuery ? `${req.baseUrl}?${returnQuery}` : req.baseUrl;
        res.redirect(redirectUrl);

    } catch (error) {
        console.error("Error resetting password:", error);
        res.render('reset-password', {
            employee: employee || { public_employee_id: public_employee_id, first_name: 'Unknown', last_name: '' },
            returnQuery: returnQuery,
            error: "A database error occurred while resetting the password."
        });
    }
});

module.exports = router;