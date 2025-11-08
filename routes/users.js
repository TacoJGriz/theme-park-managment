const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const pool = require('../db'); // Adjust path to db.js
const {
    isAuthenticated,
    canViewUsers,
    canAddEmployees,
    canApproveEmployees,
    canViewPendingEmployees
} = require('../middleware/auth'); // Adjust path to auth.js

const saltRounds = 10; // Needed for hashing passwords

// --- USER & EMPLOYEE MANAGEMENT ---

// GET /users
// Path changed to /
router.get('/', isAuthenticated, canViewUsers, async (req, res) => {
    try {
        const { role, locationId } = req.session.user;

        let query = 'SELECT employee_id, first_name, last_name, email, employee_type, location_id, is_pending_approval, is_active FROM employee_demographics';
        let params = [];

        if (role === 'Location Manager') {
            query += ' WHERE location_id = ?';
            params.push(locationId);
        }

        query += ' ORDER BY last_name, first_name';
        const [users] = await pool.query(query, params);

        res.render('users', {
            users: users,
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

// GET /employees/new
// Path changed to /new
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

// POST /employees
// Path changed to /
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

        const hash = await bcrypt.hash(password, saltRounds);
        connection = await pool.getConnection();
        await connection.beginTransaction();

        const demoSql = `
            INSERT INTO employee_demographics
            (first_name, last_name, gender, phone_number, email, street_address, city, state, zip_code,
            birth_date, hire_date, employee_type, location_id, supervisor_id, hourly_rate, is_pending_approval)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        const [demoResult] = await connection.query(demoSql, [
            first_name, last_name, gender, phone_number || null, email, street_address || null, city || null, state || null, zip_code || null,
            birth_date, hire_date, employee_type, location_id, supervisor_id, hourly_rate || null, isPending
        ]);

        const newEmployeeId = demoResult.insertId;

        const authSql = "INSERT INTO employee_auth (employee_id, password_hash) VALUES (?, ?)";
        await connection.query(authSql, [newEmployeeId, hash]);

        await connection.commit();
        res.redirect('/users');

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

// GET /employees/edit/:id
// Path changed to /edit/:id
router.get('/edit/:id', isAuthenticated, canAddEmployees, async (req, res) => {
    const employeeId = req.params.id;
    const actor = req.session.user;

    try {
        const [employeeResult] = await pool.query('SELECT * FROM employee_demographics WHERE employee_id = ?', [employeeId]);
        if (employeeResult.length === 0) {
            return res.status(404).send('Employee not found');
        }
        const employee = employeeResult[0];

        const targetRole = employee.employee_type;
        const targetId = employee.employee_id;

        if (actor.role === 'Head of HR' && targetRole === 'Admin') {
            return res.status(403).send('Forbidden: You do not have permission to edit this employee.');
        }
        if (actor.role === 'HR Staff' && targetRole === 'Admin') {
            return res.status(403).send('Forbidden: You do not have permission to edit this employee.');
        }

        const [locations] = await pool.query('SELECT location_id, location_name FROM location');
        const [supervisors] = await pool.query('SELECT employee_id, first_name, last_name, employee_type FROM employee_demographics WHERE is_active = TRUE AND employee_id != ?', [employeeId]);

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

// POST /employees/edit/:id
// Path changed to /edit/:id
router.post('/edit/:id', isAuthenticated, canAddEmployees, async (req, res) => {
    const employeeId = req.params.id;
    const actor = req.session.user;

    let targetUser;
    try {
        const [targetUserResult] = await pool.query('SELECT * FROM employee_demographics WHERE employee_id = ?', [employeeId]);
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

        await connection.query('UPDATE employee_demographics SET pending_hourly_rate = NULL, rate_change_requested_by = NULL WHERE employee_id = ?', [employeeId]);

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
                WHERE employee_id = ?
            `;
            await connection.query(sql, [
                first_name, last_name, gender, phone_number || null, email, street_address || null, city || null, state || null, zip_code || null,
                birth_date, hire_date, termination_date, employee_type, location_id,
                supervisor_id, hourly_rate || null, is_active === '1',
                employeeId
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
                WHERE employee_id = ?
            `;
            await connection.query(personalInfoSql, [
                first_name, last_name, gender, phone_number || null, email, street_address || null, city || null, state || null, zip_code || null,
                birth_date, hire_date, termination_date, employee_type, location_id,
                supervisor_id, is_active === '1',
                employeeId
            ]);

            const newRate = parseFloat(hourly_rate);
            const currentRate = parseFloat(targetUser.hourly_rate);

            if (newRate !== currentRate) {
                const rateChangeSql = `
                    UPDATE employee_demographics 
                    SET pending_hourly_rate = ?, rate_change_requested_by = ? 
                    WHERE employee_id = ?
                `;
                await connection.query(rateChangeSql, [newRate, actor.id, employeeId]);
                req.session.success = 'Wage update request sent for approval.';
            } else {
                req.session.success = 'Employee details updated successfully.';
            }
        }

        res.redirect('/users'); // Success

    } catch (error) {
        console.error("Error updating employee:", error);
        try {
            const [employeeResult] = await pool.query('SELECT * FROM employee_demographics WHERE employee_id = ?', [employeeId]);
            const employee = employeeResult.length > 0 ? employeeResult[0] : {};
            const [locations] = await pool.query('SELECT location_id, location_name FROM location');
            const [supervisors] = await pool.query('SELECT employee_id, first_name, last_name, employee_type FROM employee_demographics WHERE is_active = TRUE AND employee_id != ?', [employeeId]);

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

// GET /employees/reset-password/:id
// Path changed to /reset-password/:id
router.get('/reset-password/:id', isAuthenticated, canAddEmployees, async (req, res) => {
    const employeeId = req.params.id;
    const actor = req.session.user;

    try {
        const [employeeResult] = await pool.query('SELECT employee_id, first_name, last_name, employee_type FROM employee_demographics WHERE employee_id = ?', [employeeId]);
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

// POST /employees/reset-password/:id
// Path changed to /reset-password/:id
router.post('/reset-password/:id', isAuthenticated, canAddEmployees, async (req, res) => {
    const employeeId = req.params.id;
    const actor = req.session.user;
    const { password, confirm_password } = req.body;

    let employee;
    try {
        const [employeeResult] = await pool.query('SELECT employee_id, first_name, last_name, employee_type FROM employee_demographics WHERE employee_id = ?', [employeeId]);
        if (employeeResult.length === 0) {
            return res.status(404).send('Employee not found');
        }
        employee = employeeResult[0];

        if (password !== confirm_password) {
            return res.render('reset-password', {
                employee: employee,
                error: "Passwords do not match. Please try again."
            });
        }

        const hash = await bcrypt.hash(password, saltRounds);

        const sql = "UPDATE employee_auth SET password_hash = ? WHERE employee_id = ?";
        await pool.query(sql, [hash, employeeId]);

        res.redirect('/users');

    } catch (error) {
        console.error("Error resetting password:", error);
        res.render('reset-password', {
            employee: employee || { employee_id: employeeId, first_name: 'Unknown', last_name: '' },
            error: "A database error occurred while resetting the password."
        });
    }
});

// --- ROUTES FOR EMPLOYEE APPROVAL ---

// GET /employees/pending
// Path changed to /pending
router.get('/pending', isAuthenticated, canViewPendingEmployees, async (req, res) => {
    try {
        const [pendingUsers] = await pool.query(`
            SELECT e.employee_id, e.first_name, e.last_name, e.email, e.employee_type, e.hire_date, l.location_name
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

// POST /employees/approve/:id
// Path changed to /approve/:id
router.post('/approve/:id', isAuthenticated, canApproveEmployees, async (req, res) => {
    const employeeId = req.params.id;

    try {
        const sql = "UPDATE employee_demographics SET is_pending_approval = FALSE WHERE employee_id = ?";
        await pool.query(sql, [employeeId]);
        req.session.success = "Employee approved successfully.";

        res.redirect('/employees/pending');
    } catch (error) {
        console.error("Error approving employee:", error);
        res.status(500).send("Error approving employee.");
    }
});

module.exports = router;