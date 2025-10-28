const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const session = require('express-session');
const app = express();
const port = 3000;
const saltRounds = 10;

app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));

// --- SESSION CONFIGURATION ---
app.use(session({
  secret: 'a_secret_key_for_your_project',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false }
}));

const dbConfig = {
  host: 'localhost',
  user: 'root',
  password: 'Jk8#mD3@nZqL0pRt',
  database: 'park_database',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
};

const pool = mysql.createPool(dbConfig);

// --- AUTHORIZATION MIDDLEWARE ---
const isAuthenticated = (req, res, next) => {
  if (req.session && req.session.user) {
    return next();
  }
  res.redirect('/login');
};

// NEW: Middleware for approval permissions (Admin or Manager)
const canApprove = (req, res, next) => {
    const role = req.session.user ? req.session.user.role : null;
    if (role === 'Admin' || role === 'Manager') {
        return next();
    }
    res.status(403).send('Forbidden: Admin or Manager access required for approvals.');
};

const isAdmin = (req, res, next) => {
  if (req.session.user && req.session.user.role === 'Admin') { return next(); }
  res.status(403).send('Forbidden: Admins only');
};

const isAdminOrHR = (req, res, next) => {
  const role = req.session.user ? req.session.user.role : null;
  if (role === 'Admin' || role === 'HR') { return next(); }
  res.status(403).send('Forbidden: Admin or HR access required');
};
const isAdminOrManager = (req, res, next) => {
  const role = req.session.user ? req.session.user.role : null;
  if (role === 'Admin' || role === 'Manager') { return next(); }
  res.status(403).send('Forbidden: Admin or Manager access required');
};
const isMaintenanceOrHigher = (req, res, next) => {
  const role = req.session.user ? req.session.user.role : null;
  if (role === 'Admin' || role === 'Manager' || role === 'Maintenance') { return next(); }
  res.status(403).send('Forbidden: Maintenance or higher access required');
};

const canManageMembersAndVisits = (req, res, next) => {
  const role = req.session.user ? req.session.user.role : null;
  if (role === 'Admin' || role === 'Manager' || role === 'Staff') {
    return next();
  }
  res.status(403).send('Forbidden: Staff access or higher (excluding HR) required');
};

const canViewReports = (req, res, next) => {
  const role = req.session.user ? req.session.user.role : null;
  if (role === 'Admin' || role === 'Manager') {
    return next();
  }
  res.status(403).send('Forbidden: Admin or Manager access required for reports.');
};

const canViewRides = (req, res, next) => {
  const role = req.session.user ? req.session.user.role : null;
  if (role === 'Admin' || role === 'Manager' || role === 'Maintenance' || role === 'Staff') {
    return next();
  }
  res.status(403).send('Forbidden: Access denied for your role.');
};

// Middleware to pass user data to all views
app.use((req, res, next) => {
  res.locals.user = req.session.user;
  next();
});

// --- LOGIN & LOGOUT ROUTES ---
app.get('/login', (req, res) => {
  if (req.session.user) {
    return res.redirect('/dashboard');
  }
  res.render('login', { error: null });
});
app.post('/login', async (req, res) => {
    try {
        const email = req.body.username;
        const password = req.body.password;
        const query = `
            SELECT demo.employee_id, demo.first_name, demo.last_name, demo.employee_type, auth.password_hash
            FROM employee_demographics AS demo
            JOIN employee_auth AS auth ON demo.employee_id = auth.employee_id
            WHERE demo.email = ? AND demo.is_active = TRUE
        `;
        const [results] = await pool.query(query, [email]);
        if (results.length === 0) {
            return res.render('login', { error: 'Invalid email or password' });
        }
        const user = results[0];
        const match = await bcrypt.compare(password, user.password_hash);
        if (match) {
            req.session.regenerate(function (err) {
                if (err) {
                    console.error("Session regeneration error:", err);
                    return res.status(500).render('login', { error: 'Session error during login.' });
                }
                req.session.user = {
                    id: user.employee_id,
                    firstName: user.first_name,
                    lastName: user.last_name,
                    role: user.employee_type
                };
                res.redirect('/dashboard');
            });
        } else {
            res.render('login', { error: 'Invalid email or password' });
        }
    } catch (error) {
        console.error("Login error:", error);
        return res.status(500).render('login', { error: 'An unexpected error occurred.' });
    }
});
app.get('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            console.error("Logout error:", err);
            return res.redirect('/dashboard');
        }
        res.clearCookie('connect.sid');
        res.redirect('/login');
    });
});

app.get('/change-password', isAuthenticated, (req, res) => {
  res.render('change-password', { error: null, success: null });
});
app.post('/change-password', isAuthenticated, async (req, res) => {
    const { old_password, new_password, confirm_password } = req.body;
    const employeeId = req.session.user.id;

    if (new_password !== confirm_password) {
        return res.render('change-password', { error: "New passwords do not match.", success: null });
    }

    let connection;
    try {
        connection = await pool.getConnection();
        const [authResult] = await connection.query('SELECT password_hash FROM employee_auth WHERE employee_id = ?', [employeeId]);
        if (authResult.length === 0) {
            return res.render('change-password', { error: "Could not find user record.", success: null });
        }
        const currentHash = authResult[0].password_hash;
        const match = await bcrypt.compare(old_password, currentHash);
        if (!match) {
            return res.render('change-password', { error: "Incorrect old password.", success: null });
        }
        const newHash = await bcrypt.hash(new_password, saltRounds);
        await connection.query('UPDATE employee_auth SET password_hash = ? WHERE employee_id = ?', [newHash, employeeId]);
        res.render('change-password', { error: null, success: "Password updated successfully!" });
    } catch (error) {
        console.error("Error changing password:", error);
        res.render('change-password', { error: "A database error occurred.", success: null });
    } finally {
        if (connection) connection.release();
    }
});


// --- DASHBOARD ---
app.get(['/', '/dashboard'], isAuthenticated, async (req, res) => {
    let approvalCount = 0;
    // UPDATED: Now both Admins and Managers can see the approval count
    if (req.session.user.role === 'Admin' || req.session.user.role === 'Manager') {
        try {
            const [rateChanges] = await pool.query('SELECT COUNT(*) as count FROM employee_demographics WHERE pending_hourly_rate IS NOT NULL');
            const [reassignments] = await pool.query('SELECT COUNT(*) as count FROM maintenance WHERE pending_employee_id IS NOT NULL');
            approvalCount = rateChanges[0].count + reassignments[0].count;
        } catch (error) {
            console.error("Error fetching approval count:", error);
        }
    }
    res.render('dashboard', { approvalCount: approvalCount });
});


// --- APPROVAL WORKFLOW ROUTES ---
// UPDATED: Use the new canApprove middleware
app.get('/approvals', isAuthenticated, canApprove, async (req, res) => {
    try {
        const rateChangeQuery = `
            SELECT 
                target.employee_id, 
                target.first_name, 
                target.last_name, 
                target.hourly_rate, 
                target.pending_hourly_rate,
                requester.first_name as requester_first_name,
                requester.last_name as requester_last_name
            FROM employee_demographics as target
            JOIN employee_demographics as requester ON target.rate_change_requested_by = requester.employee_id
            WHERE target.pending_hourly_rate IS NOT NULL
        `;
        const [rateChanges] = await pool.query(rateChangeQuery);

        const reassignmentQuery = `
            SELECT
                m.maintenance_id,
                r.ride_name,
                m.summary,
                CONCAT(current_emp.first_name, ' ', current_emp.last_name) as current_employee_name,
                CONCAT(pending_emp.first_name, ' ', pending_emp.last_name) as pending_employee_name,
                CONCAT(requester.first_name, ' ', requester.last_name) as requester_name
            FROM maintenance m
            JOIN rides r ON m.ride_id = r.ride_id
            LEFT JOIN employee_demographics current_emp ON m.employee_id = current_emp.employee_id
            JOIN employee_demographics pending_emp ON m.pending_employee_id = pending_emp.employee_id
            JOIN employee_demographics requester ON m.assignment_requested_by = requester.employee_id
            WHERE m.pending_employee_id IS NOT NULL AND m.end_date IS NULL
        `;
        const [reassignments] = await pool.query(reassignmentQuery);

        res.render('approvals', { rateChanges, reassignments });
    } catch (error) {
        console.error("Error fetching approvals:", error);
        res.status(500).send("Error loading approvals page.");
    }
});

// UPDATED: Use the new canApprove middleware for all approval actions
app.post('/approve/rate/:employee_id', isAuthenticated, canApprove, async (req, res) => {
    try {
        const sql = `
            UPDATE employee_demographics 
            SET hourly_rate = pending_hourly_rate, 
                pending_hourly_rate = NULL, 
                rate_change_requested_by = NULL 
            WHERE employee_id = ?
        `;
        await pool.query(sql, [req.params.employee_id]);
        res.redirect('/approvals');
    } catch (error) {
        console.error("Error approving rate change:", error);
        res.status(500).send("Error processing approval.");
    }
});

app.post('/reject/rate/:employee_id', isAuthenticated, canApprove, async (req, res) => {
    try {
        const sql = `
            UPDATE employee_demographics 
            SET pending_hourly_rate = NULL, 
                rate_change_requested_by = NULL 
            WHERE employee_id = ?
        `;
        await pool.query(sql, [req.params.employee_id]);
        res.redirect('/approvals');
    } catch (error) {
        console.error("Error rejecting rate change:", error);
        res.status(500).send("Error processing rejection.");
    }
});

app.post('/approve/reassignment/:maintenance_id', isAuthenticated, canApprove, async (req, res) => {
    try {
        const sql = `
            UPDATE maintenance
            SET employee_id = pending_employee_id,
                pending_employee_id = NULL,
                assignment_requested_by = NULL
            WHERE maintenance_id = ?
        `;
        await pool.query(sql, [req.params.maintenance_id]);
        res.redirect('/approvals');
    } catch (error) {
        console.error("Error approving reassignment:", error);
        res.status(500).send("Error processing approval.");
    }
});

app.post('/reject/reassignment/:maintenance_id', isAuthenticated, canApprove, async (req, res) => {
    try {
        const sql = `
            UPDATE maintenance
            SET pending_employee_id = NULL,
                assignment_requested_by = NULL
            WHERE maintenance_id = ?
        `;
        await pool.query(sql, [req.params.maintenance_id]);
        res.redirect('/approvals');
    } catch (error) {
        console.error("Error rejecting reassignment:", error);
        res.status(500).send("Error processing rejection.");
    }
});


// --- USER & EMPLOYEE MANAGEMENT ---
app.get('/users', isAuthenticated, isAdminOrHR, async (req, res) => {
  try {
    const query = 'SELECT employee_id, first_name, last_name, email, employee_type FROM employee_demographics';
    const [users] = await pool.query(query);
    res.render('users', { users: users });
  } catch (error) {
    console.error(error);
    res.status(500).send('Error querying the database');
  }
});
app.get('/employees/new', isAuthenticated, isAdminOrHR, async (req, res) => {
  try {
    const [locations] = await pool.query('SELECT location_id, location_name FROM location');
    const [supervisors] = await pool.query('SELECT employee_id, first_name, last_name FROM employee_demographics WHERE is_active = TRUE');
    res.render('add-employee', {
      locations: locations,
      supervisors: supervisors,
      error: null
    });
  } catch (error) {
    console.error(error);
    res.status(500).send('Error loading page');
  }
});
app.post('/employees', isAuthenticated, isAdminOrHR, async (req, res) => {
    const {
        first_name, last_name, gender, phone_number, email,
        street_address, city, state, zip_code,
        birth_date, hire_date, employee_type,
        location_id, hourly_rate, password, confirm_password
    } = req.body;
    const supervisor_id = req.body.supervisor_id ? req.body.supervisor_id : null;

    if (password !== confirm_password) {
        const [locations] = await pool.query('SELECT location_id, location_name FROM location');
        const [supervisors] = await pool.query('SELECT employee_id, first_name, last_name FROM employee_demographics WHERE is_active = TRUE');
        return res.render('add-employee', {
            locations, supervisors, error: "Passwords do not match."
        });
    }

    let connection;
    try {
        const hash = await bcrypt.hash(password, saltRounds);
        connection = await pool.getConnection();
        await connection.beginTransaction();
        const demoSql = `
            INSERT INTO employee_demographics
            (first_name, last_name, gender, phone_number, email, street_address, city, state, zip_code,
            birth_date, hire_date, employee_type, location_id, supervisor_id, hourly_rate)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        const [demoResult] = await connection.query(demoSql, [
            first_name, last_name, gender, phone_number || null, email, street_address || null, city || null, state || null, zip_code || null,
            birth_date, hire_date, employee_type, location_id, supervisor_id, hourly_rate || null
        ]);
        const newEmployeeId = demoResult.insertId;
        const authSql = "INSERT INTO employee_auth (employee_id, password_hash) VALUES (?, ?)";
        await connection.query(authSql, [newEmployeeId, hash]);
        await connection.commit();
        res.redirect('/users');
    } catch (error) {
        if (connection) await connection.rollback();
        console.error("Error adding employee:", error);
        const [locations] = await pool.query('SELECT location_id, location_name FROM location');
        const [supervisors] = await pool.query('SELECT employee_id, first_name, last_name FROM employee_demographics WHERE is_active = TRUE');
        res.render('add-employee', {
            locations, supervisors, error: "Database error. Email may already be in use."
        });
    } finally {
        if (connection) connection.release();
    }
});
app.get('/employees/edit/:id', isAuthenticated, isAdminOrHR, async (req, res) => {
    const employeeId = req.params.id;
    const actor = req.session.user;
    try {
        const [employeeResult] = await pool.query('SELECT * FROM employee_demographics WHERE employee_id = ?', [employeeId]);
        if (employeeResult.length === 0) return res.status(404).send('Employee not found');
        const employee = employeeResult[0];
        if (actor.role === 'HR' && (employee.employee_type === 'Admin' || (employee.employee_type === 'HR' && actor.id !== employee.employee_id))) {
            return res.status(403).send('Forbidden: HR users cannot edit Admin or other HR users.');
        }
        const [locations] = await pool.query('SELECT location_id, location_name FROM location');
        const [supervisors] = await pool.query('SELECT employee_id, first_name, last_name FROM employee_demographics WHERE is_active = TRUE AND employee_id != ?', [employeeId]);
        res.render('edit-employee', { employee, locations, supervisors, error: null });
    } catch (error) {
        console.error(error);
        res.status(500).send('Error loading edit page');
    }
});
app.post('/employees/edit/:id', isAuthenticated, isAdminOrHR, async (req, res) => {
    const employeeId = req.params.id;
    const actor = req.session.user;

    let connection;
    try {
        connection = await pool.getConnection();
        const [targetUsers] = await connection.query('SELECT * FROM employee_demographics WHERE employee_id = ?', [employeeId]);
        if (targetUsers.length === 0) return res.status(404).send('Employee not found');
        const targetUser = targetUsers[0];

        if (actor.role === 'HR' && (targetUser.employee_type === 'Admin' || (targetUser.employee_type === 'HR' && actor.id !== parseInt(employeeId)))) {
            return res.status(403).send('Forbidden: HR users cannot edit Admin or other HR users.');
        }

        if (actor.role === 'Admin') {
            const { first_name, last_name, gender, phone_number, email, street_address, city, state, zip_code, birth_date, hire_date, employee_type, location_id, hourly_rate, is_active } = req.body;
            const supervisor_id = req.body.supervisor_id ? req.body.supervisor_id : null;
            const termination_date = req.body.termination_date ? req.body.termination_date : null;
            const sql = `UPDATE employee_demographics SET first_name = ?, last_name = ?, gender = ?, phone_number = ?, email = ?, street_address = ?, city = ?, state = ?, zip_code = ?, birth_date = ?, hire_date = ?, termination_date = ?, employee_type = ?, location_id = ?, supervisor_id = ?, hourly_rate = ?, is_active = ? WHERE employee_id = ?`;
            await connection.query(sql, [first_name, last_name, gender, phone_number, email, street_address, city, state, zip_code, birth_date, hire_date, termination_date, employee_type, location_id, supervisor_id, hourly_rate, is_active === '1', employeeId]);
        } else if (actor.role === 'HR') {
            const { first_name, last_name, gender, phone_number, email, street_address, city, state, zip_code, birth_date, hourly_rate } = req.body;
            
            const personalInfoSql = `UPDATE employee_demographics SET first_name = ?, last_name = ?, gender = ?, phone_number = ?, email = ?, street_address = ?, city = ?, state = ?, zip_code = ?, birth_date = ? WHERE employee_id = ?`;
            await connection.query(personalInfoSql, [first_name, last_name, gender, phone_number, email, street_address, city, state, zip_code, birth_date, employeeId]);

            if (hourly_rate && parseFloat(hourly_rate) !== parseFloat(targetUser.hourly_rate)) {
                const rateChangeSql = `UPDATE employee_demographics SET pending_hourly_rate = ?, rate_change_requested_by = ? WHERE employee_id = ?`;
                await connection.query(rateChangeSql, [hourly_rate, actor.id, employeeId]);
            }
        }
        res.redirect('/users');
    } catch (error) {
        console.error("Error updating employee:", error);
        const [locations] = await pool.query('SELECT location_id, location_name FROM location');
        const [supervisors] = await pool.query('SELECT employee_id, first_name, last_name FROM employee_demographics WHERE is_active = TRUE AND employee_id != ?', [employeeId]);
        const [employeeResult] = await pool.query('SELECT * FROM employee_demographics WHERE employee_id = ?', [employeeId]);
        res.render('edit-employee', {
            employee: employeeResult[0] || {}, locations, supervisors,
            error: "Database error updating employee. Email might be a duplicate."
        });
    } finally {
        if (connection) connection.release();
    }
});
app.get('/employees/reset-password/:id', isAuthenticated, isAdminOrHR, async (req, res) => {
    const employeeId = req.params.id;
    const actor = req.session.user;
    try {
        const [employeeResult] = await pool.query('SELECT employee_id, first_name, last_name, employee_type FROM employee_demographics WHERE employee_id = ?', [employeeId]);
        if (employeeResult.length === 0) return res.status(404).send('Employee not found');
        const employee = employeeResult[0];
        if (actor.role === 'HR' && (employee.employee_type === 'Admin' || (employee.employee_type === 'HR' && actor.id !== employee.employee_id))) {
            return res.status(403).send('Forbidden: You do not have permission to reset this password.');
        }
        res.render('reset-password', { employee, error: null });
    } catch (error) {
        console.error("Error loading reset password page:", error);
        res.status(500).send("Error loading page");
    }
});
app.post('/employees/reset-password/:id', isAuthenticated, isAdminOrHR, async (req, res) => {
    const employeeId = req.params.id;
    const actor = req.session.user;
    const { password, confirm_password } = req.body;

    let employee;
    try {
        const [employeeResult] = await pool.query('SELECT employee_id, first_name, last_name, employee_type FROM employee_demographics WHERE employee_id = ?', [employeeId]);
        if (employeeResult.length === 0) return res.status(404).send('Employee not found');
        employee = employeeResult[0];

        if (actor.role === 'HR' && (employee.employee_type === 'Admin' || (employee.employee_type === 'HR' && actor.id !== employee.employee_id))) {
            return res.status(403).send('Forbidden: You do not have permission to reset this password.');
        }

        if (password !== confirm_password) {
            return res.render('reset-password', { employee, error: "Passwords do not match." });
        }

        const hash = await bcrypt.hash(password, saltRounds);
        await pool.query("UPDATE employee_auth SET password_hash = ? WHERE employee_id = ?", [hash, employeeId]);
        res.redirect('/users');
    } catch (error) {
        console.error("Error resetting password:", error);
        res.render('reset-password', {
            employee: employee || { employee_id: employeeId, first_name: 'Unknown', last_name: '' },
            error: "A database error occurred while resetting the password."
        });
    }
});


// --- LOCATION & VENDOR MANAGEMENT ---
app.get('/locations', isAuthenticated, isAdminOrManager, async (req, res) => {
    try {
        const query = `
            SELECT l.*, CONCAT(e.first_name, ' ', e.last_name) AS manager_name
            FROM location l LEFT JOIN employee_demographics e ON l.manager_id = e.employee_id
            ORDER BY l.location_name
        `;
        const [locations] = await pool.query(query);
        res.render('locations', { locations: locations });
    } catch (error) {
        console.error(error);
        res.status(500).send('Error fetching locations');
    }
});
app.get('/locations/new', isAuthenticated, isAdminOrManager, (req, res) => {
    res.render('add-location', { error: null });
});
app.post('/locations', isAuthenticated, isAdminOrManager, async (req, res) => {
    const { location_name, summary } = req.body;
    try {
        await pool.query("INSERT INTO location (location_name, summary) VALUES (?, ?)", [location_name, summary || null]);
        res.redirect('/locations');
    } catch (error) {
        console.error(error);
        res.render('add-location', { error: "Database error. Name might be duplicate." });
    }
});
app.get('/vendors', isAuthenticated, isAdminOrManager, async (req, res) => {
    try {
        const query = `
            SELECT v.*, l.location_name, CONCAT(e.first_name, ' ', e.last_name) AS manager_name
            FROM vendors v
            LEFT JOIN location l ON v.location_id = l.location_id
            LEFT JOIN employee_demographics e ON v.manager_id = e.employee_id
            ORDER BY v.vendor_name
        `;
        const [vendors] = await pool.query(query);
        res.render('vendors', { vendors: vendors });
    } catch (error) {
        console.error(error);
        res.status(500).send('Error fetching vendors');
    }
});
app.get('/vendors/new', isAuthenticated, isAdminOrManager, async (req, res) => {
    try {
        const [locations] = await pool.query('SELECT location_id, location_name FROM location');
        const [managers] = await pool.query("SELECT employee_id, first_name, last_name FROM employee_demographics WHERE employee_type IN ('Manager', 'Admin') AND is_active = TRUE");
        res.render('add-vendor', { locations, managers, error: null });
    } catch (error) {
        console.error(error);
        res.status(500).send('Error loading add vendor page');
    }
});
app.post('/vendors', isAuthenticated, isAdminOrManager, async (req, res) => {
    const { vendor_name, location_id, manager_id } = req.body;
    try {
        await pool.query("INSERT INTO vendors (vendor_name, location_id, manager_id) VALUES (?, ?, ?)", [vendor_name, location_id, manager_id || null]);
        res.redirect('/vendors');
    } catch (error) {
        console.error(error);
        const [locations] = await pool.query('SELECT location_id, location_name FROM location');
        const [managers] = await pool.query("SELECT employee_id, first_name, last_name FROM employee_demographics WHERE employee_type IN ('Manager', 'Admin') AND is_active = TRUE");
        res.render('add-vendor', { locations, managers, error: "Database error adding vendor." });
    }
});
app.get('/assign-manager/:type/:id', isAuthenticated, isAdminOrManager, async (req, res) => {
    const { type, id } = req.params;
    try {
        let entity = null;
        if (type === 'location') {
            const [loc] = await pool.query('SELECT location_id as id, location_name as name FROM location WHERE location_id = ?', [id]);
            if (loc.length > 0) entity = loc[0];
        } else if (type === 'vendor') {
            const [vend] = await pool.query('SELECT vendor_id as id, vendor_name as name FROM vendors WHERE vendor_id = ?', [id]);
            if (vend.length > 0) entity = vend[0];
        }
        if (!entity) return res.status(404).send('Not found');

        const [managers] = await pool.query("SELECT employee_id, first_name, last_name FROM employee_demographics WHERE employee_type IN ('Manager', 'Admin') AND is_active = TRUE");
        res.render('assign-manager', { entity, managers, type, error: null });
    } catch (error) {
        console.error(error);
        res.status(500).send('Error loading page');
    }
});
app.post('/assign-manager/:type/:id', isAuthenticated, isAdminOrManager, async (req, res) => {
    const { type, id } = req.params;
    const { manager_id } = req.body;
    const manager_start = (type === 'location' && req.body.manager_start) ? req.body.manager_start : null;

    try {
        let sql = '', params = [], redirectUrl = '/dashboard';
        if (type === 'location') {
            if (!manager_start) throw new Error("Start Date is required for locations.");
            sql = "UPDATE location SET manager_id = ?, manager_start = ? WHERE location_id = ?";
            params = [manager_id, manager_start, id];
            redirectUrl = '/locations';
        } else if (type === 'vendor') {
            sql = "UPDATE vendors SET manager_id = ? WHERE vendor_id = ?";
            params = [manager_id, id];
            redirectUrl = '/vendors';
        } else {
            return res.status(400).send('Invalid entity type');
        }
        await pool.query(sql, params);
        res.redirect(redirectUrl);
    } catch (error) {
        console.error("Error assigning manager:", error);
        res.status(500).send(`Error assigning manager: ${error.message}`);
    }
});

// --- RIDE & MAINTENANCE MANAGEMENT ---
app.get('/rides', isAuthenticated, canViewRides, async (req, res) => {
    try {
        const query = `
            SELECT r.*, l.location_name FROM rides r
            LEFT JOIN location l ON r.location_id = l.location_id
            ORDER BY r.ride_name
        `;
        const [rides] = await pool.query(query);
        res.render('rides', { rides: rides });
    } catch (error) {
        console.error(error);
        res.status(500).send('Error fetching rides');
    }
});
app.get('/rides/new', isAuthenticated, isAdminOrManager, async (req, res) => {
    try {
        const [locations] = await pool.query('SELECT location_id, location_name FROM location');
        res.render('add-ride', { locations: locations, error: null });
    } catch (error) {
        console.error(error);
        res.status(500).send('Error loading add ride page');
    }
});
app.post('/rides', isAuthenticated, isAdminOrManager, async (req, res) => {
    const { ride_name, ride_type, ride_status, location_id, capacity, min_height, max_weight } = req.body;
    try {
        const sql = `INSERT INTO rides (ride_name, ride_type, ride_status, location_id, capacity, min_height, max_weight) VALUES (?, ?, ?, ?, ?, ?, ?)`;
        await pool.query(sql, [ride_name, ride_type, ride_status, location_id, capacity || null, min_height || null, max_weight || null]);
        res.redirect('/rides');
    } catch (error) {
        console.error(error);
        const [locations] = await pool.query('SELECT location_id, location_name FROM location');
        res.render('add-ride', { locations, error: "Database error adding ride." });
    }
});
app.post('/rides/status/:id', isAuthenticated, isAdminOrManager, async (req, res) => {
    const { ride_status } = req.body;
    if (!['OPEN', 'CLOSED', 'BROKEN'].includes(ride_status)) {
        return res.status(400).send('Invalid ride status.');
    }
    try {
        await pool.query("UPDATE rides SET ride_status = ? WHERE ride_id = ?", [ride_status, req.params.id]);
        res.redirect('/rides');
    } catch (error) {
        console.error(error);
        res.status(500).send('Error updating ride status');
    }
});
app.get('/maintenance/ride/:ride_id', isAuthenticated, isMaintenanceOrHigher, async (req, res) => {
    const rideId = req.params.ride_id;
    try {
        const [rideResult] = await pool.query('SELECT ride_id, ride_name FROM rides WHERE ride_id = ?', [rideId]);
        if (rideResult.length === 0) return res.status(404).send('Ride not found');
        
        const query = `
            SELECT 
                m.*, 
                CONCAT(e.first_name, ' ', e.last_name) as employee_name,
                CONCAT(p.first_name, ' ', p.last_name) as pending_employee_name
            FROM maintenance m
            LEFT JOIN employee_demographics e ON m.employee_id = e.employee_id
            LEFT JOIN employee_demographics p ON m.pending_employee_id = p.employee_id
            WHERE m.ride_id = ?
            ORDER BY m.report_date DESC, m.maintenance_id DESC
        `;
        const [maintenance_logs] = await pool.query(query, [rideId]);
        res.render('maintenance-history', { ride: rideResult[0], maintenance_logs });
    } catch (error) {
        console.error(error);
        res.status(500).send('Error fetching maintenance history');
    }
});
app.get('/maintenance/new/:ride_id', isAuthenticated, async (req, res) => {
    try {
        const [rideResult] = await pool.query('SELECT ride_id, ride_name FROM rides WHERE ride_id = ?', [req.params.ride_id]);
        if (rideResult.length === 0) return res.status(404).send('Ride not found');
        const [employees] = await pool.query(`SELECT employee_id, first_name, last_name FROM employee_demographics WHERE employee_type IN ('Maintenance', 'Manager', 'Admin') AND is_active = TRUE`);
        res.render('add-maintenance', { ride: rideResult[0], employees, error: null });
    } catch (error) {
        console.error(error);
        res.status(500).send('Error loading maintenance report page');
    }
});
app.post('/maintenance', isAuthenticated, async (req, res) => {
    const { ride_id, summary, employee_id } = req.body;
    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();
        await connection.query("INSERT INTO maintenance (ride_id, summary, employee_id, report_date) VALUES (?, ?, ?, CURDATE())", [ride_id, summary, employee_id || null]);
        await connection.query("UPDATE rides SET ride_status = 'BROKEN' WHERE ride_id = ?", [ride_id]);
        await connection.commit();
        res.redirect(['Admin', 'Manager', 'Maintenance'].includes(req.session.user.role) ? `/maintenance/ride/${ride_id}` : '/rides');
    } catch (error) {
        if (connection) await connection.rollback();
        console.error("Error submitting maintenance report:", error);
        res.status(500).send("Error submitting report.");
    } finally {
        if (connection) connection.release();
    }
});
app.get('/maintenance/complete/:maintenance_id', isAuthenticated, isMaintenanceOrHigher, async (req, res) => {
    try {
        const query = `SELECT m.*, r.ride_name FROM maintenance m JOIN rides r ON m.ride_id = r.ride_id WHERE m.maintenance_id = ?`;
        const [logResult] = await pool.query(query, [req.params.maintenance_id]);
        if (logResult.length === 0) return res.status(404).send('Maintenance log not found');
        if (logResult[0].end_date) return res.redirect(`/maintenance/ride/${logResult[0].ride_id}`);
        res.render('complete-maintenance', { log: logResult[0], error: null });
    } catch (error) {
        console.error(error);
        res.status(500).send('Error loading page');
    }
});
app.post('/maintenance/complete/:maintenance_id', isAuthenticated, isMaintenanceOrHigher, async (req, res) => {
    const { ride_id, start_date, end_date, cost, ride_status, summary } = req.body;
    if (!['OPEN', 'CLOSED'].includes(ride_status)) {
        return res.status(400).send('Invalid final ride status.');
    }
    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();
        const maintSql = `UPDATE maintenance SET start_date = ?, end_date = ?, cost = ?, summary = ? WHERE maintenance_id = ?`;
        await connection.query(maintSql, [start_date, end_date, cost || null, summary, req.params.maintenance_id]);
        const rideSql = "UPDATE rides SET ride_status = ? WHERE ride_id = ?";
        await connection.query(rideSql, [ride_status, ride_id]);
        await connection.commit();
        res.redirect(`/maintenance/ride/${ride_id}`);
    } catch (error) {
        if (connection) await connection.rollback();
        console.error("Error completing maintenance:", error);
        res.status(500).send("Error completing work order.");
    } finally {
        if (connection) connection.release();
    }
});
app.get('/maintenance/reassign/:maintenance_id', isAuthenticated, isMaintenanceOrHigher, async (req, res) => {
    try {
        const [logResult] = await pool.query(`SELECT m.*, r.ride_name FROM maintenance m JOIN rides r ON m.ride_id = r.ride_id WHERE m.maintenance_id = ?`, [req.params.maintenance_id]);
        if (logResult.length === 0) return res.status(404).send('Log not found.');
        
        const [employees] = await pool.query(`SELECT employee_id, first_name, last_name FROM employee_demographics WHERE employee_type = 'Maintenance' AND is_active = TRUE`);
        res.render('reassign-maintenance', { log: logResult[0], employees });
    } catch (error) {
        console.error("Error loading reassignment page:", error);
        res.status(500).send('Error loading page.');
    }
});
app.post('/maintenance/reassign/:maintenance_id', isAuthenticated, isMaintenanceOrHigher, async (req, res) => {
    const { maintenance_id } = req.params;
    const { new_employee_id, ride_id } = req.body;
    try {
        if (req.session.user.role === 'Maintenance') {
            await pool.query('UPDATE maintenance SET pending_employee_id = ?, assignment_requested_by = ? WHERE maintenance_id = ?', [new_employee_id, req.session.user.id, maintenance_id]);
        } else {
            await pool.query('UPDATE maintenance SET employee_id = ? WHERE maintenance_id = ?', [new_employee_id, maintenance_id]);
        }
        res.redirect(`/maintenance/ride/${ride_id}`);
    } catch (error) {
        console.error("Error reassigning maintenance:", error);
        res.status(500).send("Error submitting reassignment.");
    }
});

// --- GUEST & VISITS MANAGEMENT ---
app.get('/members', isAuthenticated, canManageMembersAndVisits, async (req, res) => {
    try {
        const [members] = await pool.query('SELECT * FROM membership ORDER BY last_name, first_name');
        res.render('members', { members: members });
    } catch (error) {
        console.error(error);
        res.status(500).send('Error fetching members');
    }
});
app.get('/members/new', isAuthenticated, canManageMembersAndVisits, async (req, res) => {
    res.render('add-member', { error: null });
});
app.post('/members', isAuthenticated, canManageMembersAndVisits, async (req, res) => {
    const { first_name, last_name, email, phone_number, date_of_birth, member_type, start_date, end_date } = req.body;
    try {
        const sql = `INSERT INTO membership (first_name, last_name, email, phone_number, date_of_birth, member_type, start_date, end_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
        await pool.query(sql, [first_name, last_name, email, phone_number || null, date_of_birth, member_type, start_date, end_date]);
        res.redirect('/members');
    } catch (error) {
        console.error(error);
        res.render('add-member', { error: "Database error adding member." });
    }
});
app.get('/visits/new', isAuthenticated, canManageMembersAndVisits, async (req, res) => {
    res.render('log-visit', { error: null });
});
app.post('/visits', isAuthenticated, canManageMembersAndVisits, async (req, res) => {
    const { ticket_type, ticket_price, discount_amount } = req.body;
    try {
        const sql = `INSERT INTO visits (visit_date, ticket_type, ticket_price, discount_amount) VALUES (?, ?, ?, ?)`;
        await pool.query(sql, [new Date(), ticket_type, ticket_price, discount_amount || 0]);
        res.redirect('/dashboard');
    } catch (error) {
        console.error(error);
        res.render('log-visit', { error: "Database error logging visit." });
    }
});

// --- PARK OPERATIONS ---
app.get('/weather', isAuthenticated, isAdminOrManager, async (req, res) => {
    try {
        const [events] = await pool.query('SELECT * FROM weather_events ORDER BY event_date DESC');
        res.render('weather-events', { events: events });
    } catch (error) {
        res.status(500).send('Error fetching weather events');
    }
});
app.get('/weather/new', isAuthenticated, isAdminOrManager, async (req, res) => {
    res.render('add-weather-event', { error: null });
});
app.post('/weather', isAuthenticated, isAdminOrManager, async (req, res) => {
    const { event_date, weather_type, end_time } = req.body;
    const park_closure = req.body.park_closure === '1';
    try {
        const sql = `INSERT INTO weather_events (event_date, end_time, weather_type, park_closure) VALUES (?, ?, ?, ?)`;
        await pool.query(sql, [event_date, end_time || null, weather_type, park_closure]);
        res.redirect('/weather');
    } catch (error) {
        res.render('add-weather-event', { error: "Database error logging weather event." });
    }
});
app.get('/promotions', isAuthenticated, isAdminOrManager, async (req, res) => {
    try {
        const [promotions] = await pool.query('SELECT * FROM event_promotions ORDER BY start_date DESC');
        res.render('promotions', { promotions: promotions });
    } catch (error) {
        res.status(500).send('Error fetching promotions');
    }
});
app.get('/promotions/new', isAuthenticated, isAdminOrManager, async (req, res) => {
    res.render('add-promotion', { error: null });
});
app.post('/promotions', isAuthenticated, isAdminOrManager, async (req, res) => {
    const { event_name, event_type, start_date, end_date, discount_percent, summary } = req.body;
    try {
        const sql = `INSERT INTO event_promotions (event_name, event_type, start_date, end_date, discount_percent, summary) VALUES (?, ?, ?, ?, ?, ?)`;
        await pool.query(sql, [event_name, event_type, start_date, end_date, discount_percent, summary || null]);
        res.redirect('/promotions');
    } catch (error) {
        res.render('add-promotion', { error: "Database error adding promotion." });
    }
});
app.get('/items', isAuthenticated, isAdminOrManager, async (req, res) => {
    try {
        const [items] = await pool.query('SELECT * FROM item ORDER BY item_name');
        res.render('items', { items: items });
    } catch (error) {
        res.status(500).send('Error fetching items');
    }
});
app.get('/items/new', isAuthenticated, isAdminOrManager, async (req, res) => {
    res.render('add-item', { error: null });
});
app.post('/items', isAuthenticated, isAdminOrManager, async (req, res) => {
    const { item_name, item_type, price, summary } = req.body;
    try {
        await pool.query("INSERT INTO item (item_name, item_type, price, summary) VALUES (?, ?, ?, ?)", [item_name, item_type, price, summary || null]);
        res.redirect('/items');
    } catch (error) {
        res.render('add-item', { error: "Database error adding item." });
    }
});
app.get('/inventory', isAuthenticated, isAdminOrManager, async (req, res) => {
    try {
        const query = `
            SELECT i.count, v.vendor_name, it.item_name FROM inventory i
            JOIN vendors v ON i.vendor_id = v.vendor_id
            JOIN item it ON i.item_id = it.item_id
            ORDER BY v.vendor_name, it.item_name
        `;
        const [inventory] = await pool.query(query);
        res.render('inventory', { inventory: inventory });
    } catch (error) {
        res.status(500).send('Error fetching inventory');
    }
});
app.get('/inventory/manage', isAuthenticated, isAdminOrManager, async (req, res) => {
    try {
        const [vendors] = await pool.query('SELECT vendor_id, vendor_name FROM vendors ORDER BY vendor_name');
        const [items] = await pool.query('SELECT item_id, item_name FROM item ORDER BY item_name');
        res.render('manage-inventory', { vendors, items, error: null });
    } catch (error) {
        res.status(500).send('Error loading inventory page');
    }
});
app.post('/inventory/manage', isAuthenticated, isAdminOrManager, async (req, res) => {
    const { vendor_id, item_id, count } = req.body;
    if (count < 0 || count === '' || count === null) {
        const [vendors] = await pool.query('SELECT vendor_id, vendor_name FROM vendors ORDER BY vendor_name');
        const [items] = await pool.query('SELECT item_id, item_name FROM item ORDER BY item_name');
        return res.render('manage-inventory', { vendors, items, error: "Count must be zero or greater." });
    }
    try {
        const sql = `INSERT INTO inventory (vendor_id, item_id, count) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE count = ?`;
        await pool.query(sql, [vendor_id, item_id, count, count]);
        res.redirect('/inventory');
    } catch (error) {
        console.error("Error updating inventory:", error);
        res.status(500).send("Error updating inventory.");
    }
});

// --- ATTENDANCE REPORTING ---
const getReportSettings = (selectedDate, grouping) => {
    const d = new Date(selectedDate + 'T00:00:00');
    let startDate, endDate, sqlDateFormat, labelFormat;
    if (grouping === 'day') {
        startDate = endDate = selectedDate;
        sqlDateFormat = '%Y-%m-%d %H:00';
        labelFormat = 'Hour of Day (YYYY-MM-DD HH:00)';
    } else if (grouping === 'week') {
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1);
        const monday = new Date(d.setDate(diff));
        startDate = monday.toISOString().substring(0, 10);
        const sunday = new Date(monday);
        sunday.setDate(monday.getDate() + 6);
        endDate = sunday.toISOString().substring(0, 10);
        sqlDateFormat = '%Y-%m-%d';
        labelFormat = 'Day of Week (YYYY-MM-DD)';
    } else if (grouping === 'month') {
        startDate = new Date(d.getFullYear(), d.getMonth(), 1).toISOString().substring(0, 10);
        endDate = new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().substring(0, 10);
        sqlDateFormat = '%Y-%m-%d';
        labelFormat = 'Day of Month (YYYY-MM-DD)';
    } else if (grouping === 'year') {
        startDate = new Date(d.getFullYear(), 0, 1).toISOString().substring(0, 10);
        endDate = new Date(d.getFullYear(), 11, 31).toISOString().substring(0, 10);
        sqlDateFormat = '%Y-%m';
        labelFormat = 'Month of Year (YYYY-MM)';
    } else {
        throw new Error("Invalid grouping selection.");
    }
    return { startDate, endDate, sqlDateFormat, labelFormat };
};

app.get('/reports/attendance', isAuthenticated, canViewReports, async (req, res) => {
    try {
        const [locations] = await pool.query('SELECT location_id, location_name FROM location');
        res.render('attendance-report', {
            locations,
            selected_date: '2025-10-20',
            grouping: 'day',
            location_id: '',
            attendance_data: null,
            labelFormat: 'Time Period',
            error: null
        });
    } catch (error) {
        res.status(500).send('Error loading report page');
    }
});

app.post('/reports/attendance', isAuthenticated, canViewReports, async (req, res) => {
    const { selected_date, grouping, location_id } = req.body;
    let locations = [];
    try {
        [locations] = await pool.query('SELECT location_id, location_name FROM location');
        const { startDate, endDate, sqlDateFormat, labelFormat } = getReportSettings(selected_date, grouping);
        const reportQuery = `
            SELECT DATE_FORMAT(visit_date, ?) as report_interval, COUNT(visit_id) as total_count
            FROM visits WHERE DATE(visit_date) BETWEEN ? AND ? 
            GROUP BY report_interval ORDER BY report_interval
        `;
        const [reportData] = await pool.query(reportQuery, [sqlDateFormat, startDate, endDate]);
        res.render('attendance-report', {
            locations, selected_date, grouping, location_id,
            attendance_data: reportData.map(row => ({ label: row.report_interval, count: row.total_count })),
            labelFormat,
            error: null
        });
    } catch (error) {
        console.error("Error generating attendance report:", error);
        res.render('attendance-report', {
            locations, selected_date, grouping, location_id,
            attendance_data: null, labelFormat: 'Time Period',
            error: `Error generating report: ${error.message}`
        });
    }
});


// --- Start Server ---
app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});



