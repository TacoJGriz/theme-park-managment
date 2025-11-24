const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const pool = require('../db');
const crypto = require('crypto');
const {
    isAuthenticated,
    canViewUsers,
    canAddEmployees
} = require('../middleware/auth');

const saltRounds = 10;

// employee list
router.get('/', isAuthenticated, canViewUsers, async (req, res) => {
    try {
        const {
            role,
            locationId
        } = req.session.user;
        const {
            search,
            sort,
            dir,
            filter_role,
            filter_location,
            filter_status
        } = req.query;

        const queryParams = new URLSearchParams(req.query);
        const currentQueryString = queryParams.toString();

        const [allLocations] = await pool.query('SELECT location_id, location_name FROM location ORDER BY location_name');
        const [allRoles] = await pool.query('SELECT DISTINCT employee_type FROM employee_demographics ORDER BY employee_type');

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
                whereClauses.push('e.is_active = TRUE');
            } else if (filter_status === 'inactive') {
                whereClauses.push('e.is_active = FALSE');
            }
        }

        let whereQuery = "";
        if (whereClauses.length > 0) {
            whereQuery = ` WHERE ${whereClauses.join(' AND ')}`;
        }

        // stats
        const countQuery = `
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN e.is_active = TRUE THEN 1 ELSE 0 END) as active,
                SUM(CASE WHEN e.is_active = FALSE THEN 1 ELSE 0 END) as inactive
            FROM employee_demographics e
            LEFT JOIN location l ON e.location_id = l.location_id
            ${whereQuery}
        `;
        const [countResult] = await pool.query(countQuery, params);
        const counts = countResult[0];

        // sorting
        let orderBy = '';
        if (sort === 'status') {
            const direction = (dir === 'desc') ? 'DESC' : 'ASC';
            orderBy = ` ORDER BY e.is_active ${direction}`;
        } else {
            orderBy = ' ORDER BY e.is_active DESC';
            if (sort && dir) {
                const direction = (dir === 'desc') ? 'DESC' : 'ASC';
                switch (sort) {
                    case 'id':
                        orderBy += `, e.employee_id ${direction}`;
                        break;
                    case 'name':
                        orderBy += `, e.last_name ${direction}, e.first_name ${direction}`;
                        break;
                    case 'email':
                        orderBy += `, e.email ${direction}`;
                        break;
                    case 'role':
                        orderBy += `, e.employee_type ${direction}`;
                        break;
                    case 'location':
                        orderBy += `, l.location_name ${direction}`;
                        break;
                }
            } else {
                orderBy += ', e.last_name ASC, e.first_name ASC';
            }
        }

        const mainQuery = `
            SELECT 
                e.employee_id, e.public_employee_id, e.first_name, e.last_name, 
                e.email, e.employee_type, e.location_id, 
                e.is_active,
                l.location_name
            FROM employee_demographics e
            LEFT JOIN location l ON e.location_id = l.location_id
            ${whereQuery}
            ${orderBy}
        `;
        const [users] = await pool.query(mainQuery, params);

        res.render('users', {
            users,
            counts,
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
            currentQueryString,
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

// add employee form
router.get('/new', isAuthenticated, canAddEmployees, async (req, res) => {
    try {
        const [locations] = await pool.query('SELECT location_id, location_name FROM location');
        // included location_id in selection for frontend logic
        const [supervisors] = await pool.query('SELECT employee_id, first_name, last_name, employee_type, location_id FROM employee_demographics WHERE is_active = TRUE');
        let creatableRoles = ['Staff', 'Maintenance', 'Location Manager', 'Park Manager', 'Admin'];

        res.render('add-employee', {
            locations,
            supervisors,
            creatableRoles,
            error: null
        });
    } catch (error) {
        console.error(error);
        res.status(500).send('Error loading page');
    }
});

// create employee
router.post('/', isAuthenticated, canAddEmployees, async (req, res) => {
    const {
        first_name,
        last_name,
        gender,
        phone_number,
        email,
        street_address,
        city,
        state,
        zip_code,
        birth_date,
        hire_date,
        employee_type,
        location_id,
        hourly_rate,
        password,
        confirm_password
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
                locations,
                supervisors,
                creatableRoles,
                error: "Passwords do not match."
            });
        }
    } catch (error) {
        console.error("Error fetching dropdown data for add employee:", error);
        return res.render('add-employee', {
            locations: [],
            supervisors: [],
            creatableRoles: [],
            error: "Error loading form data. Please try again."
        });
    }

    let connection;
    try {
        const publicEmployeeId = crypto.randomUUID();
        const hash = await bcrypt.hash(password, saltRounds);
        connection = await pool.getConnection();
        await connection.beginTransaction();

        const demoSql = `
            INSERT INTO employee_demographics
            (public_employee_id, first_name, last_name, gender, phone_number, email, street_address, city, state, zip_code,
            birth_date, hire_date, employee_type, location_id, supervisor_id, hourly_rate, is_active)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE)
        `;

        // treat empty string location_id as null
        const finalLocationId = location_id === "" ? null : location_id;

        await connection.query(demoSql, [
            publicEmployeeId,
            first_name, last_name, gender, phone_number || null, email, street_address || null, city || null, state || null, zip_code || null,
            birth_date, hire_date, employee_type, finalLocationId, supervisor_id, hourly_rate || null
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
            locations,
            supervisors,
            creatableRoles,
            error: "Database error adding employee. The email may already be in use."
        });
    } finally {
        if (connection) connection.release();
    }
});

// edit employee form
router.get('/edit/:public_employee_id', isAuthenticated, canAddEmployees, async (req, res) => {
    const {
        public_employee_id
    } = req.params;

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
            employee,
            locations,
            supervisors,
            returnQuery,
            error: null
        });
    } catch (error) {
        console.error(error);
        res.status(500).send('Error loading edit page');
    }
});

// update employee
router.post('/edit/:public_employee_id', isAuthenticated, canAddEmployees, async (req, res) => {
    const {
        public_employee_id
    } = req.params;
    const {
        returnQuery
    } = req.body;

    let connection;
    try {
        connection = await pool.getConnection();

        const {
            first_name,
            last_name,
            gender,
            phone_number,
            email,
            street_address,
            city,
            state,
            zip_code,
            birth_date,
            hire_date,
            employee_type,
            location_id,
            hourly_rate,
            is_active
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
                employee,
                locations,
                supervisors,
                returnQuery,
                error: "Database error updating employee. Email might be a duplicate."
            });
        } catch (fetchError) {
            res.status(500).send("An error occurred while updating the employee.");
        }
    } finally {
        if (connection) connection.release();
    }
});

// reset password form
router.get('/reset-password/:public_employee_id', isAuthenticated, canAddEmployees, async (req, res) => {
    const {
        public_employee_id
    } = req.params;
    const returnQuery = new URLSearchParams(req.query).toString();

    try {
        const [employeeResult] = await pool.query('SELECT employee_id, public_employee_id, first_name, last_name, employee_type FROM employee_demographics WHERE public_employee_id = ?', [public_employee_id]);
        if (employeeResult.length === 0) {
            return res.status(404).send('Employee not found');
        }
        const employee = employeeResult[0];
        res.render('reset-password', {
            employee,
            returnQuery,
            error: null
        });

    } catch (error) {
        console.error("Error loading reset password page:", error);
        res.status(500).send("Error loading page");
    }
});

// process password reset
router.post('/reset-password/:public_employee_id', isAuthenticated, canAddEmployees, async (req, res) => {
    const {
        public_employee_id
    } = req.params;
    const {
        password,
        confirm_password,
        returnQuery
    } = req.body;

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
                employee,
                returnQuery,
                error: "Passwords do not match. Please try again."
            });
        }

        const hash = await bcrypt.hash(password, saltRounds);
        const sql = "UPDATE employee_auth SET password_hash = ? WHERE employee_id = ?";
        await pool.query(sql, [hash, internal_employee_id]);

        const redirectUrl = returnQuery ? `${req.baseUrl}?${returnQuery}` : req.baseUrl;
        res.redirect(redirectUrl);

    } catch (error) {
        console.error("Error resetting password:", error);
        res.render('reset-password', {
            employee: employee || {
                public_employee_id,
                first_name: 'Unknown',
                last_name: ''
            },
            returnQuery,
            error: "A database error occurred while resetting the password."
        });
    }
});

// delete employee
router.post('/delete/:public_employee_id', isAuthenticated, canAddEmployees, async (req, res) => {
    const {
        public_employee_id
    } = req.params;

    let connection;
    try {
        connection = await pool.getConnection();

        const [emp] = await connection.query('SELECT employee_id, first_name, last_name FROM employee_demographics WHERE public_employee_id = ?', [public_employee_id]);
        if (emp.length === 0) {
            connection.release();
            return res.status(404).send('Employee not found');
        }
        const employeeId = emp[0].employee_id;

        await connection.beginTransaction();

        // unassign as supervisor
        await connection.query('UPDATE employee_demographics SET supervisor_id = NULL WHERE supervisor_id = ?', [employeeId]);

        // delete credentials
        await connection.query('DELETE FROM employee_auth WHERE employee_id = ?', [employeeId]);

        // delete record
        await connection.query('DELETE FROM employee_demographics WHERE employee_id = ?', [employeeId]);

        await connection.commit();

        req.session.success = `Employee "${emp[0].first_name} ${emp[0].last_name}" deleted successfully.`;
        res.redirect('/users');

    } catch (error) {
        if (connection) await connection.rollback();
        console.error("Error deleting employee:", error);

        if (error.code === 'ER_ROW_IS_REFERENCED_2') {
            req.session.error = "Cannot delete this employee because they have associated records (e.g., Maintenance Logs, Transactions). Please deactivate their account instead.";
        } else {
            req.session.error = "Database error deleting employee.";
        }
        res.redirect(`/users/edit/${public_employee_id}`);
    } finally {
        if (connection) connection.release();
    }
});

module.exports = router;