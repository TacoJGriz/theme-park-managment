const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const pool = require('../db'); // Adjust path to db.js
const crypto = require('crypto'); // ADDED
const {
    isAuthenticated,
    canViewUsers,
    canAddEmployees,
    canApproveEmployees,
    canViewPendingEmployees
} = require('../middleware/auth'); // Adjust path to auth.js

const saltRounds = 10; // Needed for hashing passwords

// --- USER & EMPLOYEE MANAGEMENT ---

// GET / (Handled by /users or /employees prefix)
// Path is correct
router.get('/', isAuthenticated, canViewUsers, async (req, res) => {
    try {
        const { role, locationId } = req.session.user;

        // ADDED public_employee_id
        let query = 'SELECT employee_id, public_employee_id, first_name, last_name, email, employee_type, location_id, is_pending_approval, is_active FROM employee_demographics';
        let params = [];

        if (role === 'Location Manager') {
            query += ' WHERE location_id = ?';
            params.push(locationId);
        }

        query += ' ORDER BY last_name, first_name';
        const [users] = await pool.query(query, params);

        res.render('users', {
            users: users, // Now contains public_employee_id
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

// GET /new (Handled by /users/new or /employees/new)
// Path is correct
router.get('/new', isAuthenticated, canAddEmployees, async (req, res) => {
    try {
        const actorRole = req.session.user.role;
        const [locations] = await pool.query('SELECT location_id, location_name FROM location');
        const [supervisors] = await pool.query('SELECT employee_id, first_name, last_name, employee_type FROM employee_demographics WHERE is_active = TRUE');

        let creatableRoles = ['Staff', 'Maintenance', 'Location Manager', 'Park Manager', 'HR Staff', 'Head of HR', 'Admin'];

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

// POST / (Handled by /users or /employees)
// Path is correct
router.post('/', isAuthenticated, canAddEmployees, async (req, res) => {
    const {
        first_name, last_name, gender, phone_number, email,
        street_address, city, state, zip_code,
        birth_date, hire_date, employee_type,
        location_id, hourly_rate, password, confirm_password
    } = req.body;
    const supervisor_id = req.body.supervisor_id ? req.body.supervisor_id : null;
    const actorRole = req.session.user.role;

    let locations = [];
    let supervisors = [];
    let creatableRoles = [];
    try {
        [locations] = await pool.query('SELECT location_id, location_name FROM location');
        [supervisors] = await pool.query('SELECT employee_id, first_name, last_name, employee_type FROM employee_demographics WHERE is_active = TRUE');

        creatableRoles = ['Staff', 'Maintenance', 'Location Manager', 'Park Manager', 'HR Staff', 'Head of HR', 'Admin'];
        if (actorRole === 'HR Staff') {
            creatableRoles = ['Staff', 'Maintenance'];
            if (!creatableRoles.includes(employee_type)) {
                throw new Error("HR Staff do not have permission to create this employee type.");
            }
        }

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
        const isPending = (actorRole === 'HR Staff');
        const publicEmployeeId = crypto.randomUUID(); // ADDED

        const hash = await bcrypt.hash(password, saltRounds);
        connection = await pool.getConnection();
        await connection.beginTransaction();

        // ADDED public_employee_id
        const demoSql = `
            INSERT INTO employee_demographics
            (public_employee_id, first_name, last_name, gender, phone_number, email, street_address, city, state, zip_code,
            birth_date, hire_date, employee_type, location_id, supervisor_id, hourly_rate, is_pending_approval)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        const [demoResult] = await connection.query(demoSql, [
            publicEmployeeId, // ADDED
            first_name, last_name, gender, phone_number || null, email, street_address || null, city || null, state || null, zip_code || null,
            birth_date, hire_date, employee_type, location_id, supervisor_id, hourly_rate || null, isPending
        ]);

        const newEmployeeId = demoResult.insertId;

        const authSql = "INSERT INTO employee_auth (employee_id, password_hash) VALUES (?, ?)";
        await connection.query(authSql, [newEmployeeId, hash]);

        await connection.commit();

        // On success, redirect to the base path this router is mounted on.
        // req.baseUrl will be either '/users' or '/employees'
        res.redirect(req.baseUrl); // <-- FIXED

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

// GET /edit/:public_employee_id (Handled by /users/edit/:id or /employees/edit/:id)
// Path is correct
router.get('/edit/:public_employee_id', isAuthenticated, canAddEmployees, async (req, res) => {
    const { public_employee_id } = req.params; // CHANGED
    const actor = req.session.user;

    try {
        // Query by public_employee_id
        const [employeeResult] = await pool.query('SELECT * FROM employee_demographics WHERE public_employee_id = ?', [public_employee_id]); // CHANGED
        if (employeeResult.length === 0) {
            return res.status(404).send('Employee not found');
        }
        const employee = employeeResult[0];

        const targetRole = employee.employee_type;
        const targetId = employee.employee_id; // Internal ID

        if (actor.role === 'Head of HR' && targetRole === 'Admin') {
            return res.status(403).send('Forbidden: You do not have permission to edit this employee.');
        }
        if (actor.role === 'HR Staff' && targetRole === 'Admin') {
            return res.status(403).send('Forbidden: You do not have permission to edit this employee.');
        }

        const [locations] = await pool.query('SELECT location_id, location_name FROM location');
        // Exclude self from supervisor list using internal ID
        const [supervisors] = await pool.query('SELECT employee_id, first_name, last_name, employee_type FROM employee_demographics WHERE is_active = TRUE AND employee_id != ?', [targetId]);

        res.render('edit-employee', {
            employee: employee,
            locations: locations,
            supervisors: supervisors,
            error: null
        });
    } catch (error) {
        console.error(error);
        res.status(500).send('Error loading edit page');
    }
});

// POST /edit/:public_employee_id (Handled by /users/edit/:id or /employees/edit/:id)
// Path is correct
router.post('/edit/:public_employee_id', isAuthenticated, canAddEmployees, async (req, res) => {
    const { public_employee_id } = req.params; // CHANGED
    const actor = req.session.user;

    let targetUser;
    try {
        // Query by public_employee_id
        const [targetUserResult] = await pool.query('SELECT * FROM employee_demographics WHERE public_employee_id = ?', [public_employee_id]); // CHANGED
        if (targetUserResult.length === 0) {
            return res.status(404).send('Employee not found');
        }
        targetUser = targetUserResult[0];
        const targetRole = targetUser.employee_type;

        if (actor.role === 'Head of HR' && targetRole === 'Admin') {
            return res.status(403).send('Forbidden: You do not have permission to edit this employee.');
        }
        if (actor.role === 'HR Staff' && targetRole === 'Admin') {
            return res.status(403).send('Forbidden: You do not have permission to edit this employee.');
        }
    } catch (error) {
        console.error("Permission check query error:", error);
        return res.status(500).send('Error checking permissions before update');
    }

    let connection;
    try {
        connection = await pool.getConnection();

        // Update by public_employee_id
        await connection.query('UPDATE employee_demographics SET pending_hourly_rate = NULL, rate_change_requested_by = NULL WHERE public_employee_id = ?', [public_employee_id]); // CHANGED

        if (actor.role === 'Admin' || actor.role === 'Head of HR') {
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
                WHERE public_employee_id = ? -- CHANGED
            `;
            await connection.query(sql, [
                first_name, last_name, gender, phone_number || null, email, street_address || null, city || null, state || null, zip_code || null,
                birth_date, hire_date, termination_date, employee_type, location_id,
                supervisor_id, hourly_rate || null, is_active === '1',
                public_employee_id // CHANGED
            ]);

            req.session.success = 'Employee details updated successfully.';

        } else if (actor.role === 'HR Staff') {
            const {
                first_name, last_name, gender, phone_number, email,
                street_address, city, state, zip_code, birth_date,
                hire_date, employee_type, location_id, is_active,
                hourly_rate
            } = req.body;
            const supervisor_id = req.body.supervisor_id ? req.body.supervisor_id : null;
            const termination_date = req.body.termination_date ? req.body.termination_date : null;

            const personalInfoSql = `
                UPDATE employee_demographics SET
                first_name = ?, last_name = ?, gender = ?, phone_number = ?, email = ?,
                street_address = ?, city = ?, state = ?, zip_code = ?, birth_date = ?,
                hire_date = ?, termination_date = ?, employee_type = ?, location_id = ?,
                supervisor_id = ?, is_active = ?
                WHERE public_employee_id = ? -- CHANGED
            `;
            await connection.query(personalInfoSql, [
                first_name, last_name, gender, phone_number || null, email, street_address || null, city || null, state || null, zip_code || null,
                birth_date, hire_date, termination_date, employee_type, location_id,
                supervisor_id, is_active === '1',
                public_employee_id // CHANGED
            ]);

            const newRate = parseFloat(hourly_rate);
            const currentRate = parseFloat(targetUser.hourly_rate);

            if (newRate !== currentRate) {
                const rateChangeSql = `
                    UPDATE employee_demographics 
                    SET pending_hourly_rate = ?, rate_change_requested_by = ? 
                    WHERE public_employee_id = ? -- CHANGED
                `;
                await connection.query(rateChangeSql, [newRate, actor.id, public_employee_id]); // CHANGED
                req.session.success = 'Wage update request sent for approval.';
            } else {
                req.session.success = 'Employee details updated successfully.';
            }
        }

        res.redirect(req.baseUrl); // <-- FIXED

    } catch (error) {
        console.error("Error updating employee:", error);
        try {
            const [employeeResult] = await pool.query('SELECT * FROM employee_demographics WHERE public_employee_id = ?', [public_employee_id]); // CHANGED
            const employee = employeeResult.length > 0 ? employeeResult[0] : {};
            const [locations] = await pool.query('SELECT location_id, location_name FROM location');
            const [supervisors] = await pool.query('SELECT employee_id, first_name, last_name, employee_type FROM employee_demographics WHERE is_active = TRUE AND public_employee_id != ?', [public_employee_id]); // CHANGED

            res.render('edit-employee', {
                employee: employee,
                locations: locations,
                supervisors: supervisors,
                error: "Database error updating employee. Email might be a duplicate."
            });
        } catch (fetchError) {
            console.error("Error fetching data for edit employee error page:", fetchError);
            res.status(500).send("An error occurred while updating the employee and reloading the page.");
        }
    } finally {
        if (connection) connection.release();
    }
});

// GET /reset-password/:public_employee_id (Handled by /users/reset-password/:id or /employees/reset-password/:id)
// Path is correct
router.get('/reset-password/:public_employee_id', isAuthenticated, canAddEmployees, async (req, res) => {
    const { public_employee_id } = req.params; // CHANGED
    const actor = req.session.user;

    try {
        // Query by public_employee_id
        const [employeeResult] = await pool.query('SELECT employee_id, public_employee_id, first_name, last_name, employee_type FROM employee_demographics WHERE public_employee_id = ?', [public_employee_id]); // CHANGED
        if (employeeResult.length === 0) {
            return res.status(404).send('Employee not found');
        }
        const employee = employeeResult[0];

        res.render('reset-password', { employee: employee, error: null });

    } catch (error) {
        console.error("Error loading reset password page:", error);
        res.status(500).send("Error loading page");
    }
});

// POST /reset-password/:public_employee_id (Handled by /users/reset-password/:id or /employees/reset-password/:id)
// Path is correct
router.post('/reset-password/:public_employee_id', isAuthenticated, canAddEmployees, async (req, res) => {
    const { public_employee_id } = req.params; // CHANGED
    const actor = req.session.user;
    const { password, confirm_password } = req.body;

    let employee;
    try {
        // Query by public_employee_id
        const [employeeResult] = await pool.query('SELECT employee_id, public_employee_id, first_name, last_name, employee_type FROM employee_demographics WHERE public_employee_id = ?', [public_employee_id]); // CHANGED
        if (employeeResult.length === 0) {
            return res.status(404).send('Employee not found');
        }
        employee = employeeResult[0];
        const internal_employee_id = employee.employee_id; // Get internal ID

        if (password !== confirm_password) {
            return res.render('reset-password', {
                employee: employee,
                error: "Passwords do not match. Please try again."
            });
        }

        const hash = await bcrypt.hash(password, saltRounds);

        // Update employee_auth using the internal employee_id
        const sql = "UPDATE employee_auth SET password_hash = ? WHERE employee_id = ?";
        await pool.query(sql, [hash, internal_employee_id]);

        res.redirect(req.baseUrl); // <-- FIXED

    } catch (error) {
        console.error("Error resetting password:", error);
        res.render('reset-password', {
            employee: employee || { public_employee_id: public_employee_id, first_name: 'Unknown', last_name: '' }, // CHANGED
            error: "A database error occurred while resetting the password."
        });
    }
});

// --- ROUTES FOR EMPLOYEE APPROVAL ---

// GET /pending (Handled by /users/pending or /employees/pending)
// Path is correct
router.get('/pending', isAuthenticated, canViewPendingEmployees, async (req, res) => {
    try {
        // ADDED public_employee_id
        const [pendingUsers] = await pool.query(`
            SELECT e.employee_id, e.public_employee_id, e.first_name, e.last_name, e.email, e.employee_type, e.hire_date, l.location_name
            FROM employee_demographics e
            LEFT JOIN location l ON e.location_id = l.location_id
            WHERE e.is_pending_approval = TRUE
            ORDER BY e.hire_date
        `);

        res.render('pending-employees', { users: pendingUsers, success: null, error: null });
        req.session.success = null;
        req.session.error = null;

    } catch (error) {
        console.error("Error fetching pending employees:", error);
        res.status(500).send("Error fetching pending employees.");
    }
});

// POST /approve/:public_employee_id (Handled by /users/approve/:id or /employees/approve/:id)
// Path is correct
router.post('/approve/:public_employee_id', isAuthenticated, canApproveEmployees, async (req, res) => {
    const { public_employee_id } = req.params; // CHANGED

    try {
        // Update by public_employee_id
        const sql = "UPDATE employee_demographics SET is_pending_approval = FALSE WHERE public_employee_id = ?"; // CHANGED
        await pool.query(sql, [public_employee_id]); // CHANGED
        req.session.success = "Employee approved successfully.";

        // This redirect needs to be to the '/pending' route, but relative
        // to the base URL.
        res.redirect(req.baseUrl + '/pending'); // <-- FIXED

    } catch (error) {
        console.error("Error approving employee:", error);
        res.status(500).send("Error approving employee.");
    }
});

module.exports = router;