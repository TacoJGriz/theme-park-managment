require('dotenv').config();
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
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    ssl: {                    
      rejectUnauthorized: false
    }
};

const pool = mysql.createPool(dbConfig);

// --- MIDDLEWARE ---

const isAuthenticated = (req, res, next) => {
    if (req.session && req.session.user) {
        return next(); // User is logged in, proceed to the route
    }
    // User is not logged in, redirect to login page
    res.redirect('/login');
};
const isAdmin = (req, res, next) => {
    if (req.session.user && req.session.user.role === 'Admin') { return next(); }
    res.status(403).send('Forbidden: Admins only');
};
const isHR = (req, res, next) => {
    if (req.session.user && req.session.user.role === 'HR') { return next(); }
    res.status(403).send('Forbidden: HR only');
};
const isParkManager = (req, res, next) => {
    if (req.session.user && req.session.user.role === 'Park Manager') { return next(); }
    res.status(403).send('Forbidden: Park Managers only');
};
const canAddEmployees = (req, res, next) => {
    const role = req.session.user ? req.session.user.role : null;
    if (role === 'Admin' || role === 'Head of HR' || role === 'HR Staff') { return next(); }
    res.status(403).send('Forbidden: Admin or HR access required');
};
const canApproveEmployees = (req, res, next) => {
    const role = req.session.user ? req.session.user.role : null;
    if (role === 'Admin' || role === 'Head of HR') { return next(); }
    res.status(403).send('Forbidden: Admin or Head of HR access required.');
};
const canViewPendingEmployees = (req, res, next) => {
    const role = req.session.user ? req.session.user.role : null;
    if (role === 'Admin' || role === 'Head of HR' || role === 'HR Staff') { return next(); }
    res.status(403).send('Forbidden: Admin or HR access required.');
};
const isAdminOrParkManager = (req, res, next) => {
    const role = req.session.user ? req.session.user.role : null;
    if (role === 'Admin' || role === 'Park Manager') { return next(); }
    res.status(403).send('Forbidden: Admin or Park Manager access required');
};
const canViewUsers = (req, res, next) => {
    const role = req.session.user ? req.session.user.role : null;
    if (role === 'Admin' || role === 'Head of HR' || role === 'HR Staff' || role === 'Park Manager' || role === 'Location Manager') { return next(); }
    res.status(403).send('Forbidden: Access denied.');
};
const isMaintenanceOrHigher = (req, res, next) => {
    const role = req.session.user ? req.session.user.role : null;
    if (role === 'Admin' || role === 'Park Manager' || role === 'Maintenance') { return next(); }
    res.status(403).send('Forbidden: Maintenance or higher access required');
};
const canManageMembersVisits = (req, res, next) => {
    const role = req.session.user ? req.session.user.role : null;
    // Includes Admin, Park Manager, Staff -- **EXCLUDES ALL HR, Maint, Location/Vendor Mgrs**
    if (role === 'Admin' || role === 'Park Manager' || role === 'Staff') {
        return next();
    }
    res.status(403).send('Forbidden: Staff access or higher (excluding HR) required');
};
const canViewRides = (req, res, next) => {
    const role = req.session.user ? req.session.user.role : null;
    // Includes Admin, Park/Location Managers, Maintenance, Staff
    if (role === 'Admin' || role === 'Park Manager' || role === 'Location Manager' || role === 'Maintenance' || role === 'Staff') {
        return next();
    }
    res.status(403).send('Forbidden: Access denied for your role.');
};
const canManageRetail = (req, res, next) => {
    const role = req.session.user ? req.session.user.role : null;
    if (role === 'Admin' || role === 'Park Manager' || role === 'Vendor Manager' || role === 'Location Manager') {
        return next();
    }
    res.status(403).send('Forbidden: Admin, Park Manager, or Vendor Manager access required.');
};
const canViewReports = (req, res, next) => {
    const role = req.session.user ? req.session.user.role : null;
    // ONLY Admin and Park Manager can view reports
    if (role === 'Admin' || role === 'Park Manager') {
        return next();
    }
    res.status(403).send('Forbidden: Admin or Park Manager access required for reports.');
};
const getReportSettings = (selectedDate, grouping) => {
    // Ensure the date object is created at midnight local time
    const d = new Date(selectedDate + 'T00:00:00');
    if (isNaN(d.getTime())) { // Check if the date is valid
        throw new Error("Invalid date selected.");
    }

    let startDate, endDate, sqlDateFormat, labelFormat;

    if (grouping === 'day') {
        // Hourly view for one day
        startDate = selectedDate;
        endDate = selectedDate;
        sqlDateFormat = '%Y-%m-%d %H:00'; // Group by hour
        labelFormat = 'Hour of Day (YYYY-MM-DD HH:00)';
    } else if (grouping === 'week') {
        // Daily view for the week containing the selected date (Mon-Sun)
        const dayOfWeek = d.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
        const diffToMonday = d.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1); // Adjust Sunday
        const monday = new Date(d.setDate(diffToMonday));
        startDate = monday.toISOString().substring(0, 10);

        const sunday = new Date(monday);
        sunday.setDate(monday.getDate() + 6);
        endDate = sunday.toISOString().substring(0, 10);
        sqlDateFormat = '%Y-%m-%d'; // Group by day
        labelFormat = 'Day of Week (YYYY-MM-DD)';
    } else if (grouping === 'month') {
        // Daily view for the selected month
        const year = d.getFullYear();
        const month = d.getMonth();
        const firstDay = new Date(year, month, 1);
        startDate = firstDay.toISOString().substring(0, 10);
        const lastDay = new Date(year, month + 1, 0); // Day 0 of next month is last day of current
        endDate = lastDay.toISOString().substring(0, 10);
        sqlDateFormat = '%Y-%m-%d'; // Group by day
        labelFormat = 'Day of Month (YYYY-MM-DD)';
    } else if (grouping === 'year') {
        // Monthly view for the selected year
        const year = d.getFullYear();
        const firstDay = new Date(year, 0, 1); // Jan 1st
        startDate = firstDay.toISOString().substring(0, 10);
        const lastDay = new Date(year, 11, 31); // Dec 31st
        endDate = lastDay.toISOString().substring(0, 10);
        sqlDateFormat = '%Y-%m'; // Group by month
        labelFormat = 'Month of Year (YYYY-MM)';
    } else {
        throw new Error("Invalid grouping selection.");
    }

    return { startDate, endDate, sqlDateFormat, labelFormat };
};
// For approving HR wage changes
const canApproveWages = (req, res, next) => {
    const role = req.session.user ? req.session.user.role : null;
    if (role === 'Admin' || role === 'Head of HR') {
        return next();
    }
    res.status(403).send('Forbidden: Admin or Head of HR access required.');
};
// For approving maintenance reassignments
const canApproveMaintenance = (req, res, next) => {
    const role = req.session.user ? req.session.user.role : null;
    if (role === 'Admin' || role === 'Park Manager') {
        return next();
    }
    res.status(403).send('Forbidden: Admin or Park Manager access required.');
};
const canViewApprovals = (req, res, next) => {
    const role = req.session.user ? req.session.user.role : null;
    if (role === 'Admin' || role === 'Head of HR' || role === 'Park Manager') {
        return next();
    }
    // Redirect or send forbidden if they aren't an approver
    res.status(403).send('Forbidden: You do not have permission to view this page.');
};

// Middleware to pass user data to all views
app.use((req, res, next) => {
    res.locals.user = req.session.user;
    next();
});

// --- LOGIN & LOGOUT ROUTES --- (Corrected Login)
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
            SELECT demo.employee_id, demo.first_name, demo.last_name, demo.employee_type, demo.location_id, auth.password_hash
            FROM employee_demographics AS demo
            JOIN employee_auth AS auth ON demo.employee_id = auth.employee_id
            WHERE demo.email = ? AND demo.is_active = TRUE AND demo.is_pending_approval = FALSE
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
                let assignedVendorIds = [];
                if (user.employee_type === 'Vendor Manager') {
                    // This is an async operation, so we must wrap the session logic
                    pool.query('SELECT vendor_id, vendor_name FROM vendors WHERE manager_id = ? ORDER BY vendor_name', [user.employee_id]) // <-- MODIFIED QUERY
                        .then(([vendorRows]) => {
                            const assignedVendorIds = vendorRows.map(v => v.vendor_id);
                            const assignedVendorNames = vendorRows.map(v => v.vendor_name); // <-- NEW

                            // Set session *after* async query completes
                            req.session.user = {
                                id: user.employee_id,
                                firstName: user.first_name,
                                lastName: user.last_name,
                                role: user.employee_type,
                                locationId: user.location_id,
                                vendorIds: assignedVendorIds,  // <-- Keep this for permissions
                                vendorNames: assignedVendorNames // <-- NEW: For display
                            };
                            res.redirect('/dashboard');
                        })
                        .catch(vendorErr => {
                            console.error("Error fetching vendor assignments:", vendorErr);
                            // Log them in anyway, but with no vendors
                            req.session.user = {
                                id: user.employee_id,
                                firstName: user.first_name,
                                lastName: user.last_name,
                                role: user.employee_type,
                                locationId: user.location_id,
                                vendorIds: [], vendorNames: []
                            };
                            res.redirect('/dashboard');
                        });
                } else {
                    // Not a vendor manager, set session immediately
                    req.session.user = {
                        id: user.employee_id,
                        firstName: user.first_name,
                        lastName: user.last_name,
                        role: user.employee_type,
                        locationId: user.location_id, // For Location Manager
                        vendorIds: [], vendorNames: []
                    };
                    res.redirect('/dashboard');
                }
                // Let express-session save automatically before redirecting
            });
        } else {
            res.render('login', { error: 'Invalid email or password' });
        }
    } catch (error) {
        console.error("Login error:", error);
        return res.status(500).render('login', { error: 'An unexpected error occurred during login. Please try again later.' });
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

    // 1. Check if new passwords match
    if (new_password !== confirm_password) {
        return res.render('change-password', {
            error: "New passwords do not match.",
            success: null
        });
    }

    let connection;
    try {
        connection = await pool.getConnection();

        // 2. Get the user's current (old) password hash
        const [authResult] = await connection.query('SELECT password_hash FROM employee_auth WHERE employee_id = ?', [employeeId]);
        if (authResult.length === 0) {
            return res.render('change-password', {
                error: "Could not find user authentication record.",
                success: null
            });
        }
        const currentHash = authResult[0].password_hash;

        // 3. Compare the old password with the hash
        const match = await bcrypt.compare(old_password, currentHash);
        if (!match) {
            return res.render('change-password', {
                error: "Incorrect old password.",
                success: null
            });
        }

        // 4. All checks passed. Hash and update the new password
        const newHash = await bcrypt.hash(new_password, saltRounds);
        await connection.query('UPDATE employee_auth SET password_hash = ? WHERE employee_id = ?', [newHash, employeeId]);

        // 5. Render with a success message
        res.render('change-password', {
            error: null,
            success: "Password updated successfully!"
        });

    } catch (error) {
        console.error("Error changing password:", error);
        res.render('change-password', {
            error: "A database error occurred. Please try again.",
            success: null
        });
    } finally {
        if (connection) connection.release();
    }
});

// --- DASHBOARD ---
app.get(['/', '/dashboard'], isAuthenticated, (req, res) => {
    res.render('dashboard');
});

// --- APPROVAL WORKFLOW ROUTES ---
app.get('/approvals', isAuthenticated, canViewApprovals, async (req, res) => {
    try {
        const { role } = req.session.user;
        let rateChanges = [];
        let reassignments = [];

        // Only fetch wage approvals if user is Admin or Head of HR
        if (role === 'Admin' || role === 'Head of HR') {
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
            const [rateResults] = await pool.query(rateChangeQuery);
            rateChanges = rateResults;
        }

        // Only fetch maintenance approvals if user is Admin or Park Manager
        if (role === 'Admin' || role === 'Park Manager') {
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
            const [reassignmentResults] = await pool.query(reassignmentQuery);
            reassignments = reassignmentResults;
        }

        res.render('approvals', { rateChanges, reassignments });
    } catch (error) {
        console.error("Error fetching approvals:", error);
        res.status(500).send("Error loading approvals page.");
    }
});

// Approve HR Wage Change
app.post('/approve/rate/:employee_id', isAuthenticated, canApproveWages, async (req, res) => {
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

// Reject HR Wage Change
app.post('/reject/rate/:employee_id', isAuthenticated, canApproveWages, async (req, res) => {
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

// Approve Maintenance Reassignment
app.post('/approve/reassignment/:maintenance_id', isAuthenticated, canApproveMaintenance, async (req, res) => {
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

// Reject Maintenance Reassignment
app.post('/reject/reassignment/:maintenance_id', isAuthenticated, canApproveMaintenance, async (req, res) => {
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

// --- USER & EMPLOYEE MANAGEMENT --- (No changes needed, still AdminOrHR)
app.get('/users', isAuthenticated, canViewUsers, async (req, res) => {
    try {
        const { role, locationId } = req.session.user; // Get user's role and location

        let query = 'SELECT employee_id, first_name, last_name, email, employee_type, location_id, is_pending_approval, is_active FROM employee_demographics';
        let params = [];

        if (role === 'Location Manager') {
            query += ' WHERE location_id = ?';
            params.push(locationId);
        }

        query += ' ORDER BY last_name, first_name';
        const [users] = await pool.query(query, params);

        // MODIFIED: Pass success/error flash messages from session to the view
        res.render('users', {
            users: users,
            success: req.session.success, // Pass the success message
            error: req.session.error       // Pass an error message 
        });

        // Clear the messages from the session after displaying them once
        req.session.success = null;
        req.session.error = null;

    } catch (error) {
        console.error(error);
        res.status(500).send('Error querying the database');
    }
});
app.get('/employees/new', isAuthenticated, canAddEmployees, async (req, res) => {
    try {
        const actorRole = req.session.user.role;
        const [locations] = await pool.query('SELECT location_id, location_name FROM location');
        const [supervisors] = await pool.query('SELECT employee_id, first_name, last_name, employee_type FROM employee_demographics WHERE is_active = TRUE');

        // Define roles that can be created
        let creatableRoles = ['Staff', 'Maintenance', 'Location Manager', 'Vendor Manager', 'Park Manager', 'HR Staff', 'Head of HR', 'Admin'];

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
app.post('/employees', isAuthenticated, canAddEmployees, async (req, res) => {
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
        
        creatableRoles =['Staff', 'Maintenance', 'Location Manager', 'Vendor Manager', 'Park Manager', 'HR Staff', 'Head of HR', 'Admin'];
        if (actorRole === 'HR Staff') {
            creatableRoles =['Staff', 'Maintenance'];
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
app.get('/employees/edit/:id', isAuthenticated, canAddEmployees, async (req, res) => {
    const employeeId = req.params.id;
    const actor = req.session.user; // Get the logged-in user

    try {
        const [employeeResult] = await pool.query('SELECT * FROM employee_demographics WHERE employee_id = ?', [employeeId]);
        if (employeeResult.length === 0) {
            return res.status(404).send('Employee not found');
        }
        const employee = employeeResult[0]; // This is the target user

        const targetRole = employee.employee_type;
        const targetId = employee.employee_id;

        // --- PERMISSION CHECK ---
        // Note: actor.id is an int, employee.employee_id is an int from the DB
        // 'Head of HR' and 'HR Staff' can edit anyone except 'Admin'
        if (actor.role === 'Head of HR' && targetRole === 'Admin') {
            return res.status(403).send('Forbidden: You do not have permission to edit this employee.');
        }
        // 'HR Staff' cannot edit 'Admin'
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
app.post('/employees/edit/:id', isAuthenticated, canAddEmployees, async (req, res) => {
    const employeeId = req.params.id;
    const actor = req.session.user;

    let targetUser; // Will store the employee's state *before* edits
    try {
        // Fetch the full target user record to check permissions and old hourly rate
        const [targetUserResult] = await pool.query('SELECT * FROM employee_demographics WHERE employee_id = ?', [employeeId]);
        if (targetUserResult.length === 0) {
            return res.status(404).send('Employee not found');
        }
        targetUser = targetUserResult[0];
        const targetRole = targetUser.employee_type;

        // --- PERMISSION CHECK ---
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

        // Clear any *old* pending rate changes for this user, as this is a new edit
        // This prevents a stale request from being approved later
        await connection.query('UPDATE employee_demographics SET pending_hourly_rate = NULL, rate_change_requested_by = NULL WHERE employee_id = ?', [employeeId]);

        if (actor.role === 'Admin' || actor.role === 'Head of HR') {
            // ADMIN and Head of HR can edit everything directly
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

            // Set generic success message
            req.session.success = 'Employee details updated successfully.';

        } else if (actor.role === 'HR Staff') {
            // HR Staff can edit personal info directly, but wage changes require approval
            const {
                first_name, last_name, gender, phone_number, email,
                street_address, city, state, zip_code, birth_date,
                hire_date, employee_type, location_id, is_active,
                hourly_rate // Read the hourly rate from the form
            } = req.body;
            const supervisor_id = req.body.supervisor_id ? req.body.supervisor_id : null;
            const termination_date = req.body.termination_date ? req.body.termination_date : null;

            // 1. Update all non-sensitive information
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

            // 2. Handle the hourly rate change
            const newRate = parseFloat(hourly_rate);
            const currentRate = parseFloat(targetUser.hourly_rate);

            if (newRate !== currentRate) {
                // If rate is different, send it for approval
                const rateChangeSql = `
                    UPDATE employee_demographics 
                    SET pending_hourly_rate = ?, rate_change_requested_by = ? 
                    WHERE employee_id = ?
                `;
                await connection.query(rateChangeSql, [newRate, actor.id, employeeId]);

                // SET THE FLASH MESSAGE
                req.session.success = 'Wage update request sent for approval.';
            } else {
                // No wage change, just set a generic success message
                req.session.success = 'Employee details updated successfully.';
            }
        }

        res.redirect('/users'); // Success

    } catch (error) {
        // Error handling
        console.error("Error updating employee:", error);
        try {
            // Re-fetch data to render the edit page again
            const [employeeResult] = await pool.query('SELECT * FROM employee_demographics WHERE employee_id = ?', [employeeId]);
            const employee = employeeResult.length > 0 ? employeeResult[0] : {};
            const [locations] = await pool.query('SELECT location_id, location_name FROM location');
            const [supervisors] = await pool.query('SELECT employee_id, first_name, last_name, employee_type FROM employee_demographics WHERE is_active = TRUE AND employee_id != ?', [employeeId]);

            // Render the edit page again, this time with an error
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

app.get('/employees/reset-password/:id', isAuthenticated, canAddEmployees, async (req, res) => { // Use canAddEmployees
    const employeeId = req.params.id;
    const actor = req.session.user;

    try {
        const [employeeResult] = await pool.query('SELECT employee_id, first_name, last_name, employee_type FROM employee_demographics WHERE employee_id = ?', [employeeId]);
        if (employeeResult.length === 0) {
            return res.status(404).send('Employee not found');
        }
        const employee = employeeResult[0];

        // HR Staff and Head can reset anyone. Admin can also reset anyone via the canAddEmployees middleware.
        res.render('reset-password', { employee: employee, error: null });

    } catch (error) {
        console.error("Error loading reset password page:", error);
        res.status(500).send("Error loading page");
    }
});

app.post('/employees/reset-password/:id', isAuthenticated, canAddEmployees, async (req, res) => {
    const employeeId = req.params.id;
    const actor = req.session.user;
    const { password, confirm_password } = req.body;

    let employee;
    try {
        // --- 1. Fetch employee for permission check & error re-render
        const [employeeResult] = await pool.query('SELECT employee_id, first_name, last_name, employee_type FROM employee_demographics WHERE employee_id = ?', [employeeId]);
        if (employeeResult.length === 0) {
            return res.status(404).send('Employee not found');
        }
        employee = employeeResult[0];

        // --- 3. Password Match Check
        if (password !== confirm_password) {
            return res.render('reset-password', {
                employee: employee,
                error: "Passwords do not match. Please try again."
            });
        }

        // --- 4. All checks pass, update the password
        const hash = await bcrypt.hash(password, saltRounds);

        const sql = "UPDATE employee_auth SET password_hash = ? WHERE employee_id = ?";
        await pool.query(sql, [hash, employeeId]);

        // Success!
        res.redirect('/users');

    } catch (error) {
        console.error("Error resetting password:", error);
        // If an error occurs, re-render the page with the employee data and an error
        res.render('reset-password', {
            employee: employee || { employee_id: employeeId, first_name: 'Unknown', last_name: '' },
            error: "A database error occurred while resetting the password."
        });
    }
});

// --- ROUTES FOR EMPLOYEE APPROVAL ---
app.get('/employees/pending', isAuthenticated, canViewPendingEmployees, async (req, res) => {
    try {
        const [pendingUsers] = await pool.query(`
            SELECT e.employee_id, e.first_name, e.last_name, e.email, e.employee_type, e.hire_date, l.location_name
            FROM employee_demographics e
            LEFT JOIN location l ON e.location_id = l.location_id
            WHERE e.is_pending_approval = TRUE
            ORDER BY e.hire_date
        `);

        res.render('pending-employees', { users: pendingUsers, success: null, error: null });
        // Clear flash messages
        req.session.success = null;
        req.session.error = null;

    } catch (error) {
        console.error("Error fetching pending employees:", error);
        res.status(500).send("Error fetching pending employees.");
    }
});
app.post('/employees/approve/:id', isAuthenticated, canApproveEmployees, async (req, res) => {
    const employeeId = req.params.id;

    try {
        const sql = "UPDATE employee_demographics SET is_pending_approval = FALSE WHERE employee_id = ?";
        await pool.query(sql, [employeeId]);
        // Add success message for confirmation
        req.session.success = "Employee approved successfully.";

        res.redirect('/employees/pending');
    } catch (error) {
        console.error("Error approving employee:", error);
        res.status(500).send("Error approving employee.");
    }
});

// --- LOCATION & VENDOR MANAGEMENT --- (No changes needed, still AdminOrManager)
app.get('/locations', isAuthenticated, isAdminOrParkManager, async (req, res) => {
    try {
        const query = `
            SELECT l.*, CONCAT(e.first_name, ' ', e.last_name) AS manager_name
            FROM location l
            LEFT JOIN employee_demographics e ON l.manager_id = e.employee_id
            ORDER BY l.location_name
        `;
        const [locations] = await pool.query(query);
        res.render('locations', { locations: locations });
    } catch (error) {
        console.error(error);
        res.status(500).send('Error fetching locations');
    }
});
app.get('/locations/new', isAuthenticated, isAdminOrParkManager, (req, res) => {
    res.render('add-location', { error: null });
});
app.post('/locations', isAuthenticated, isAdminOrParkManager, async (req, res) => {
    const { location_name, summary } = req.body;
    let connection;
    try {
        connection = await pool.getConnection();
        const sql = "INSERT INTO location (location_name, summary) VALUES (?, ?)";
        await connection.query(sql, [location_name, summary || null]);
        res.redirect('/locations');
    } catch (error) {
        console.error(error);
        res.render('add-location', { error: "Database error adding location. Name might be duplicate." });
    } finally {
        if (connection) connection.release();
    }
});
app.get('/vendors', isAuthenticated, canManageRetail, async (req, res) => {
    try {
        const { role, locationId } = req.session.user;

        let query = `
            SELECT v.*, l.location_name, CONCAT(e.first_name, ' ', e.last_name) AS manager_name
            FROM vendors v
            LEFT JOIN location l ON v.location_id = l.location_id
            LEFT JOIN employee_demographics e ON v.manager_id = e.employee_id
        `;
        let params = [];

        if (role === 'Location Manager') {
            query += ' WHERE v.location_id = ?';
            params.push(locationId);
        }

        query += ' ORDER BY v.vendor_name';
        const [vendors] = await pool.query(query, params);
        res.render('vendors', { vendors: vendors });
    } catch (error) {
        console.error(error);
        res.status(500).send('Error fetching vendors');
    }
});
app.get('/vendors/new', isAuthenticated, isAdminOrParkManager, async (req, res) => {
    try {
        const [locations] = await pool.query('SELECT location_id, location_name FROM location');
        const [managers] = await pool.query("SELECT employee_id, first_name, last_name, employee_type FROM employee_demographics WHERE employee_type IN ('Park Manager', 'Admin') AND is_active = TRUE");
        res.render('add-vendor', { locations: locations, managers: managers, error: null });
    } catch (error) {
        console.error(error);
        res.status(500).send('Error loading add vendor page');
    }
});
app.post('/vendors', isAuthenticated, isAdminOrParkManager, async (req, res) => {
    const { vendor_name, location_id } = req.body;
    const manager_id = req.body.manager_id ? req.body.manager_id : null;
    let connection;
    try {
        connection = await pool.getConnection();
        const sql = "INSERT INTO vendors (vendor_name, location_id, manager_id) VALUES (?, ?, ?)";
        await connection.query(sql, [vendor_name, location_id, manager_id]);
        res.redirect('/vendors');
    } catch (error) {
        console.error(error);
        const [locations] = await pool.query('SELECT location_id, location_name FROM location');
        const [managers] = await pool.query("SELECT employee_id, first_name, last_name, employee_type FROM employee_demographics WHERE employee_type IN ('Park Manager', 'Admin') AND is_active = TRUE");
        res.render('add-vendor', {
            locations: locations,
            managers: managers,
            error: "Database error adding vendor. Name might be duplicate."
        });
    } finally {
        if (connection) connection.release();
    }
});
app.get('/assign-manager/:type/:id', isAuthenticated, isAdminOrParkManager, async (req, res) => {
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

        if (!entity) {
            return res.status(404).send('Location or Vendor not found');
        }

        let managerRolesToQuery = []; // Changed to plural
        let redirectUrl = '/dashboard';

        if (type === 'location') {
            managerRolesToQuery = ['Location Manager', 'Park Manager', 'Admin'];
            redirectUrl = '/locations';
        } else if (type === 'vendor') {
            managerRolesToQuery = ['Vendor Manager', 'Park Manager', 'Admin']; // Also good to add flexibility here
            redirectUrl = '/vendors';
        } else {
            return res.status(400).send('Invalid entity type');
        }
        
        const [managers] = await pool.query("SELECT employee_id, first_name, last_name, employee_type FROM employee_demographics WHERE employee_type IN (?) AND is_active = TRUE", [managerRolesToQuery]);

        res.render('assign-manager', {
            entity: entity,
            managers: managers,
            type: type,
            error: null
        });
    } catch (error) {
        console.error(error);
        res.status(500).send('Error loading assign manager page');
    }
});
app.post('/assign-manager/:type/:id', isAuthenticated, isAdminOrParkManager, async (req, res) => {
    const { type, id } = req.params;
    const { manager_id } = req.body;
    const manager_start = (type === 'location' && req.body.manager_start) ? req.body.manager_start : null;

    let connection;
    try {
        connection = await pool.getConnection();
        let sql = '';
        let params = [];
        let redirectUrl = '/dashboard';

        if (type === 'location') {
            if (!manager_start) {
                throw new Error("Manager Start Date is required for locations.");
            }
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

        await connection.query(sql, params);
        res.redirect(redirectUrl);

    } catch (error) {
        console.error("Error assigning manager:", error);
        try {
            let entity = null;
            if (type === 'location') {
                const [loc] = await pool.query('SELECT location_id as id, location_name as name FROM location WHERE location_id = ?', [id]);
                if (loc.length > 0) entity = loc[0];
            } else if (type === 'vendor') {
                const [vend] = await pool.query('SELECT vendor_id as id, vendor_name as name FROM vendors WHERE vendor_id = ?', [id]);
                if (vend.length > 0) entity = vend[0];
            }

            let managerRoleToQuery = '';
            if (type === 'location') {
                managerRoleToQuery = 'Location Manager';
            } else if (type === 'vendor') {
                managerRoleToQuery = 'Vendor Manager';
            }
            const [managers] = await pool.query("SELECT employee_id, first_name, last_name FROM employee_demographics WHERE employee_type = ? AND is_active = TRUE", [managerRoleToQuery]);
            
            res.render('assign-manager', {
                entity: entity || { name: 'Unknown' },
                managers: managers,
                type: type,
                error: `Database error assigning manager: ${error.message}`
            });
        } catch (fetchError) {
            console.error("Error fetching data for assign manager error page:", fetchError);
            res.status(500).send("An error occurred while assigning the manager and reloading the page.");
        }
    } finally {
        if (connection) connection.release();
    }
});


// --- RIDE & MAINTENANCE MANAGEMENT ---
// UPDATED: Apply canViewRides (Staff+, excluding HR) middleware
app.get('/rides', isAuthenticated, canViewRides, async (req, res) => {
    try {
        const { role, locationId } = req.session.user;

        // --- NEW: Read all query params ---
        const {
            search,
            sort,
            dir,
            filter_type,
            filter_status,
            filter_location
        } = req.query;

        let orderBy = ' ORDER BY r.ride_name ASC'; // Default sort
        let whereClauses = [];
        let params = [];

        // --- 1. Fetch data for filters ---
        // We fetch these *before* applying location manager scope
        const [allLocations] = await pool.query('SELECT location_id, location_name FROM location ORDER BY location_name');
        const [allTypes] = await pool.query('SELECT DISTINCT ride_type FROM rides ORDER BY ride_type');
        const [allStatuses] = await pool.query('SELECT DISTINCT ride_status FROM rides ORDER BY ride_status');

        // --- 2. Handle Location Manager Scope ---
        if (role === 'Location Manager') {
            whereClauses.push('r.location_id = ?');
            params.push(locationId);
        }

        // --- 3. Handle Search Query (Now searches ride_type) ---
        if (search) {
            whereClauses.push(
                '(r.ride_name LIKE ? OR l.location_name LIKE ? OR r.ride_status LIKE ? OR r.ride_type LIKE ?)'
            );
            const searchTerm = `%${search}%`;
            params.push(searchTerm, searchTerm, searchTerm, searchTerm);
        }

        // --- 4. NEW: Handle Specific Filters ---
        if (filter_type) {
            whereClauses.push('r.ride_type = ?');
            params.push(filter_type);
        }
        if (filter_status) {
            whereClauses.push('r.ride_status = ?');
            params.push(filter_status);
        }
        if (filter_location) {
            whereClauses.push('r.location_id = ?');
            params.push(filter_location);
        }

        // --- 5. Handle Sort Query (No change from last step) ---
        if (sort && dir && (dir === 'asc' || dir === 'desc')) {
            const validSorts = {
                name: 'r.ride_name',
                type: 'r.ride_type',
                location: 'l.location_name',
                status: 'r.ride_status'
            };
            if (validSorts[sort]) {
                orderBy = ` ORDER BY ${validSorts[sort]} ${dir.toUpperCase()}`;
            }
        }

        // --- Build Final Query ---
        let query = `
            SELECT r.*, l.location_name
            FROM rides r
            LEFT JOIN location l ON r.location_id = l.location_id
        `;

        if (whereClauses.length > 0) {
            query += ` WHERE ${whereClauses.join(' AND ')}`;
        }

        query += orderBy;

        const [rides] = await pool.query(query, params);

        // --- 6. Render with all data ---
        res.render('rides', {
            rides: rides,
            search: search || "",
            currentSort: sort,
            currentDir: dir,
            // Pass filter data to the view
            locations: allLocations,
            types: allTypes,
            statuses: allStatuses,
            // Pass current filter selections back to the view
            filters: {
                type: filter_type || "",
                status: filter_status || "",
                location: filter_location || ""
            }
        });

    } catch (error) {
        console.error(error);
        res.status(500).send('Error fetching rides');
    }
});

// Add Ride remains AdminOrManager
app.get('/rides/new', isAuthenticated, isAdminOrParkManager, async (req, res) => {
    try {
        const [locations] = await pool.query('SELECT location_id, location_name FROM location');
        res.render('add-ride', { locations: locations, error: null });
    } catch (error) {
        console.error(error);
        res.status(500).send('Error loading add ride page');
    }
});
app.post('/rides', isAuthenticated, isAdminOrParkManager, async (req, res) => {
    const { ride_name, ride_type, ride_status, location_id, capacity, min_height, max_weight } = req.body;
    let connection;
    try {
        connection = await pool.getConnection();
        const sql = `
            INSERT INTO rides (ride_name, ride_type, ride_status, location_id, capacity, min_height, max_weight)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `;
        await connection.query(sql, [
            ride_name, ride_type, ride_status, location_id,
            capacity || null, min_height || null, max_weight || null
        ]);
        res.redirect('/rides');
    } catch (error) {
        console.error(error);
        const [locations] = await pool.query('SELECT location_id, location_name FROM location');
        res.render('add-ride', {
            locations: locations,
            error: "Database error adding ride. Name might be duplicate."
        });
    } finally {
        if (connection) connection.release();
    }
});

// Update Status remains AdminOrManager
app.post('/rides/status/:id', isAuthenticated, async (req, res) => {
    const rideId = req.params.id;
    const { ride_status } = req.body;
    const { role, locationId } = req.session.user;

    if (!['OPEN', 'CLOSED', 'BROKEN'].includes(ride_status)) {
        return res.status(400).send('Invalid ride status provided.');
    }
    let connection;
    try {
        connection = await pool.getConnection();

        // --- NEW: Permission Check for Location Manager ---
        let hasPermission = false;
        if (role === 'Admin' || role === 'Park Manager') {
            hasPermission = true;
        } else if (role === 'Location Manager') {
            // Check if this ride is in their location
            const [rideLoc] = await pool.query('SELECT location_id FROM rides WHERE ride_id = ?', [rideId]);
            if (rideLoc.length > 0 && rideLoc[0].location_id === locationId) {
                hasPermission = true;
            }
        }

        if (!hasPermission) {
            return res.status(403).send('Forbidden: You do not have permission to update this ride.');
        }
        const sql = "UPDATE rides SET ride_status = ? WHERE ride_id = ?";
        await connection.query(sql, [ride_status, rideId]);
        res.redirect('/rides');
    } catch (error) {
        console.error(error);
        res.status(500).send('Error updating ride status');
    } finally {
        if (connection) connection.release();
    }
});

// View History remains MaintenanceOrHigher
app.get('/maintenance/ride/:ride_id', isAuthenticated, (req, res, next) => {
    const role = req.session.user ? req.session.user.role : null;
    if (role === 'Admin' || role === 'Park Manager' || role === 'Maintenance' || role === 'Location Manager') {
        return next();
    }
    res.status(403).send('Forbidden: Access denied.');
}, async (req, res) => {
    const rideId = req.params.ride_id;
    const { role, locationId } = req.session.user;
    let ride;

    try {
        const [rideResult] = await pool.query('SELECT ride_id, ride_name, location_id FROM rides WHERE ride_id = ?', [rideId]);
        if (rideResult.length === 0) {
            return res.status(404).send('Ride not found');
        }
        ride = rideResult[0];
        
        if (role === 'Location Manager') {
            if (ride.location_id !== locationId) {
                return res.status(403).send('Forbidden: You can only view maintenance for rides in your location.');
            }
        }

        const query = `
            SELECT m.*, CONCAT(e.first_name, ' ', e.last_name) as employee_name
            FROM maintenance m
            LEFT JOIN employee_demographics e ON m.employee_id = e.employee_id
            WHERE m.ride_id = ?
            ORDER BY m.report_date DESC, m.maintenance_id DESC
        `;
        const [maintenance_logs] = await pool.query(query, [rideId]);

        res.render('maintenance-history', { ride: ride, maintenance_logs: maintenance_logs });
    } catch (error) {
        console.error(error);
        res.status(500).send('Error fetching maintenance history');
    }
});

// Report Issue GET remains isAuthenticated (anyone logged in can see the form)
app.get('/maintenance/new/:ride_id', isAuthenticated, async (req, res) => {
    const rideId = req.params.ride_id;
    const { role, locationId } = req.session.user;

    try {
        const [rideResult] = await pool.query('SELECT ride_id, ride_name, location_id FROM rides WHERE ride_id = ?', [rideId]);
        if (rideResult.length === 0) {
            return res.status(404).send('Ride not found');
        }
        if (role === 'Location Manager') {
            if (rideResult[0].location_id !== locationId) {
                return res.status(403).send('Forbidden: You can only report issues for rides in your location.');
            }
        }
        const ride = rideResult[0];

        const [employees] = await pool.query(`
            SELECT employee_id, first_name, last_name, employee_type
            FROM employee_demographics
            WHERE employee_type IN ('Maintenance', 'Manager', 'Admin') AND is_active = TRUE
        `);

        res.render('add-maintenance', { ride: ride, employees: employees, error: null });
    } catch (error) {
        console.error(error);
        res.status(500).send('Error loading maintenance report page');
    }
});
// Report Issue POST remains isAuthenticated (anyone logged in can submit)
app.post('/maintenance', isAuthenticated, async (req, res) => {
    const { ride_id, summary } = req.body;
    const employee_id = req.body.employee_id ? req.body.employee_id : null;

    const { role, locationId } = req.session.user;

    let connection;
    try {
        if (role === 'Location Manager') {
            const [rideLoc] = await pool.query('SELECT location_id FROM rides WHERE ride_id = ?', [ride_id]);
            if (rideLoc.length === 0) {
                return res.status(404).send('Ride not found.');
            }
            if (rideLoc[0].location_id !== locationId) {
                return res.status(403).send('Forbidden: You can only report issues for rides in your location.');
            }
        }
        
        connection = await pool.getConnection();
        await connection.beginTransaction();

        const maintSql = "INSERT INTO maintenance (ride_id, summary, employee_id, report_date) VALUES (?, ?, ?, CURDATE())";
        await connection.query(maintSql, [ride_id, summary, employee_id]);

        const rideSql = "UPDATE rides SET ride_status = 'BROKEN' WHERE ride_id = ?";
        await connection.query(rideSql, [ride_id]);

        await connection.commit();
        if (['Admin', 'Park Manager', 'Location Manager', 'Maintenance'].includes(req.session.user.role)) {
            res.redirect(`/maintenance/ride/${ride_id}`);
        } else {
            res.redirect('/rides');
        }

    } catch (error) {
        if (connection) await connection.rollback();
        console.error("Error submitting maintenance report:", error);
        try {
            const [rideResult] = await pool.query('SELECT ride_id, ride_name FROM rides WHERE ride_id = ?', [ride_id]);
            const ride = rideResult.length > 0 ? rideResult[0] : { ride_name: 'Unknown' };
            const [employees] = await pool.query(`
                SELECT employee_id, first_name, last_name, employee_type
                FROM employee_demographics
                WHERE employee_type IN ('Maintenance', 'Manager', 'Admin') AND is_active = TRUE
            `);
            res.render('add-maintenance', {
                ride: ride,
                employees: employees,
                error: "Database error submitting report."
            });
        } catch (fetchError) {
            console.error("Error fetching data for add maintenance error page:", fetchError);
            res.status(500).send("An error occurred while submitting the report and reloading the page.");
        }
    } finally {
        if (connection) connection.release();
    }
});

// Complete Work Order remains MaintenanceOrHigher
app.get('/maintenance/complete/:maintenance_id', isAuthenticated, isMaintenanceOrHigher, async (req, res) => {
    const maintenanceId = req.params.maintenance_id;
    try {
        const query = `
            SELECT m.*, r.ride_name
            FROM maintenance m
            JOIN rides r ON m.ride_id = r.ride_id
            WHERE m.maintenance_id = ?
        `;
        const [logResult] = await pool.query(query, [maintenanceId]);
        if (logResult.length === 0) {
            return res.status(404).send('Maintenance log not found');
        }
        const log = logResult[0];

        if (log.end_date) {
            return res.redirect(`/maintenance/ride/${log.ride_id}`);
        }

        res.render('complete-maintenance', { log: log, error: null });
    } catch (error) {
        console.error(error);
        res.status(500).send('Error loading complete work order page');
    }
});
app.post('/maintenance/complete/:maintenance_id', isAuthenticated, isMaintenanceOrHigher, async (req, res) => {
    const maintenanceId = req.params.maintenance_id;
    const { ride_id, start_date, end_date, cost, ride_status, summary } = req.body;

    if (!['OPEN', 'CLOSED'].includes(ride_status)) {
        return res.status(400).send('Invalid final ride status provided. Must be OPEN or CLOSED.');
    }

    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        const maintSql = `
            UPDATE maintenance
            SET start_date = ?, end_date = ?, cost = ?, summary = ?
            WHERE maintenance_id = ?
        `;
        const costValue = cost === '' ? null : cost;
        await connection.query(maintSql, [start_date, end_date, costValue, summary, maintenanceId]);

        const rideSql = "UPDATE rides SET ride_status = ? WHERE ride_id = ?";
        await connection.query(rideSql, [ride_status, ride_id]);

        await connection.commit();
        res.redirect(`/maintenance/ride/${ride_id}`);

    } catch (error) {
        if (connection) await connection.rollback();
        console.error("Error completing maintenance:", error);
        try {
            const query = `
                SELECT m.*, r.ride_name
                FROM maintenance m
                JOIN rides r ON m.ride_id = r.ride_id
                WHERE m.maintenance_id = ?
            `;
            const [logResult] = await pool.query(query, [maintenanceId]);
            const log = logResult.length > 0 ? logResult[0] : {};
            res.render('complete-maintenance', {
                log: log,
                error: "Database error completing work order."
            });
        } catch (fetchError) {
            console.error("Error fetching data for complete maintenance error page:", fetchError);
            res.status(500).send("An error occurred while completing the work order and reloading the page.");
        }
    } finally {
        if (connection) connection.release();
    }
});
app.get('/maintenance/reassign/:maintenance_id', isAuthenticated, (req, res, next) => {
    // Role check: Allow Maintenance, Location Manager, Park Manager, Admin
    const role = req.session.user ? req.session.user.role : null;
    if (role === 'Admin' || role === 'Park Manager' || role === 'Location Manager' || role === 'Maintenance') {
        return next();
    }
    res.status(403).send('Forbidden: You do not have permission to reassign work orders.');
}, async (req, res) => {
    try {
        const { maintenance_id } = req.params;
        const { role, locationId } = req.session.user;

        // Fetch the maintenance log
        const [logResult] = await pool.query(
            `SELECT m.*, r.ride_name, r.location_id 
             FROM maintenance m 
             JOIN rides r ON m.ride_id = r.ride_id 
             WHERE m.maintenance_id = ?`,
            [maintenance_id]
        );

        if (logResult.length === 0) {
            return res.status(404).send('Maintenance log not found.');
        }
        const log = logResult[0];

        // Permission check for Location Manager
        if (role === 'Location Manager' && log.location_id !== locationId) {
            return res.status(403).send('Forbidden: You can only reassign work for rides in your location.');
        }

        // Fetch available Maintenance employees
        const [employees] = await pool.query(
            `SELECT employee_id, first_name, last_name 
             FROM employee_demographics 
             WHERE employee_type = 'Maintenance' AND is_active = TRUE`
        );

        // You will need to create this new view file
        res.render('reassign-maintenance', {
            log: log,
            employees: employees,
            error: null
        });

    } catch (error) {
        console.error("Error loading reassignment page:", error);
        res.status(500).send('Error loading page.');
    }
});

// POST to submit a reassignment request or direct assignment
app.post('/maintenance/reassign/:maintenance_id', isAuthenticated, (req, res, next) => {
    // Role check: Allow Maintenance, Location Manager, Park Manager, Admin
    const role = req.session.user ? req.session.user.role : null;
    if (role === 'Admin' || role === 'Park Manager' || role === 'Location Manager' || role === 'Maintenance') {
        return next();
    }
    res.status(403).send('Forbidden: You do not have permission to reassign work orders.');
}, async (req, res) => {
    const { maintenance_id } = req.params;
    const { new_employee_id, ride_id } = req.body;
    const { role, id: actorId, locationId } = req.session.user;

    try {
        // Permission check for Location Manager before submission
        if (role === 'Location Manager') {
            const [rideLoc] = await pool.query('SELECT location_id FROM rides WHERE ride_id = ?', [ride_id]);
            if (rideLoc.length === 0 || rideLoc[0].location_id !== locationId) {
                return res.status(403).send('Forbidden: You can only reassign work for rides in your location.');
            }
        }

        // Logic based on role
        if (role === 'Maintenance') {
            // Maintenance staff must submit a request for approval
            await pool.query(
                'UPDATE maintenance SET pending_employee_id = ?, assignment_requested_by = ? WHERE maintenance_id = ?',
                [new_employee_id, actorId, maintenance_id]
            );
        } else {
            // Admin, Park Manager, and Location Manager can reassign directly
            await pool.query(
                'UPDATE maintenance SET employee_id = ?, pending_employee_id = NULL, assignment_requested_by = NULL WHERE maintenance_id = ?',
                [new_employee_id, maintenance_id]
            );
        }

        res.redirect(`/maintenance/ride/${ride_id}`);

    } catch (error) {
        console.error("Error reassigning maintenance:", error);
        // On error, re-render the page
        try {
            const [logResult] = await pool.query(
                `SELECT m.*, r.ride_name 
                 FROM maintenance m 
                 JOIN rides r ON m.ride_id = r.ride_id 
                 WHERE m.maintenance_id = ?`,
                [maintenance_id]
            );
            const [employees] = await pool.query(
                `SELECT employee_id, first_name, last_name 
                 FROM employee_demographics 
                 WHERE employee_type = 'Maintenance' AND is_active = TRUE`
            );
            res.render('reassign-maintenance', {
                log: logResult[0] || { ride_id: ride_id, ride_name: 'Unknown', summary: 'Error' },
                employees: employees,
                error: "Error submitting reassignment."
            });
        } catch (fetchError) {
            res.status(500).send("An error occurred while reassigning the work order.");
        }
    }
});

// --- GUEST & VISITS MANAGEMENT ---
// UPDATED: Apply canManageMembersAndVisits (Staff+, excluding HR) middleware
app.get('/members', isAuthenticated, canManageMembersVisits, async (req, res) => {
    try {
        // UPDATED QUERY: Join with membership_type to get the type_name
        const query = `
            SELECT m.*, mt.type_name 
            FROM membership m
            LEFT JOIN membership_type mt ON m.type_id = mt.type_id
            ORDER BY m.last_name, m.first_name
        `;
        const [members] = await pool.query(query);
        // This now passes 'type_name' to your 'members.ejs' file
        res.render('members', { members: members });
    } catch (error) {
        console.error(error);
        res.status(500).send('Error fetching members');
    }
});
app.get('/members/new', isAuthenticated, canManageMembersVisits, async (req, res) => {
    // UPDATED: Fetch active membership types to pass to the view
    try {
        const [types] = await pool.query(
            'SELECT type_id, type_name FROM membership_type WHERE is_active = TRUE ORDER BY type_name'
        );
        // This now passes 'types' to your 'add-member.ejs' file
        res.render('add-member', { error: null, types: types });
    } catch (error) {
        console.error(error);
        res.render('add-member', { error: "Error fetching membership types.", types: [] });
    }
});
app.post('/members', isAuthenticated, canManageMembersVisits, async (req, res) => {
    const { first_name, last_name, email, phone_number, date_of_birth, type_id, start_date, end_date } = req.body;
    let connection;
    try {
        connection = await pool.getConnection();
        const sql = `
            INSERT INTO membership (first_name, last_name, email, phone_number, date_of_birth, type_id, start_date, end_date)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `;
        await connection.query(sql, [
            first_name, last_name, email, phone_number || null, date_of_birth, type_id, start_date, end_date
        ]);
        res.redirect('/members');
    } catch (error) {
        console.error(error);
        const [types] = await pool.query(
            'SELECT type_id, type_name FROM membership_type WHERE is_active = TRUE ORDER BY type_name'
        );
        res.render('add-member', {
            error: "Database error adding member. Email might be duplicate.",
            types: types
        });
    } finally {
        if (connection) connection.release();
    }
});

// Apply canManageMembersAndVisits (Staff+, excluding HR) middleware
app.get('/visits/new', isAuthenticated, canManageMembersVisits, async (req, res) => {
    try {
        const [ticketTypes] = await pool.query(
            "SELECT ticket_type_id, type_name, base_price, is_member_type FROM ticket_types WHERE is_active = TRUE ORDER BY is_member_type, type_name"
        );
        
        const [activeMembers] = await pool.query(
            "SELECT membership_id, first_name, last_name, email FROM membership WHERE end_date >= CURDATE() ORDER BY last_name, first_name"
        );
        
        const [promos] = await pool.query(
            "SELECT discount_percent FROM event_promotions WHERE CURDATE() BETWEEN start_date AND end_date ORDER BY discount_percent DESC LIMIT 1"
        );

        const currentDiscount = (promos.length > 0) ? promos[0].discount_percent : 0;

        res.render('log-visit', { 
            error: null,
            ticketTypes: ticketTypes,
            activeMembers: activeMembers,
            currentDiscount: currentDiscount
        });

    } catch (error) {
        console.error("Error loading log visit page:", error);
        res.render('log-visit', {
             error: "Error fetching park data. Please try again.",
             ticketTypes: [],
             activeMembers: [],
             currentDiscount: 0
        });
    }
});
app.post('/visits', isAuthenticated, canManageMembersVisits, async (req, res) => {
    // Phase 3: Rebuilt to calculate price on server
    const { ticket_type_id, membership_id } = req.body;
    const visit_date = new Date();
    
    let connection;
    try {
        connection = await pool.getConnection();
        
        // --- 1. Get Ticket Type Info (Server-side) ---
        const [ticketResult] = await pool.query(
            "SELECT base_price, is_member_type FROM ticket_types WHERE ticket_type_id = ?", 
            [ticket_type_id]
        );
        
        if (ticketResult.length === 0) {
            throw new Error("Invalid ticket type submitted.");
        }
        const ticket = ticketResult[0];

        // --- 2. Get Promotion Info (Server-side) ---
        const [promos] = await pool.query(
            "SELECT discount_percent FROM event_promotions WHERE CURDATE() BETWEEN start_date AND end_date ORDER BY discount_percent DESC LIMIT 1"
        );
        const currentDiscountPercent = (promos.length > 0) ? promos[0].discount_percent : 0;

        // --- 3. Calculate Price & Set Member ID ---
        let finalTicketPrice = 0.00;
        let finalDiscountAmount = 0.00;
        let finalMembershipId = null;

        if (ticket.is_member_type) {
            // It's a member. Price is $0.
            if (!membership_id || membership_id === "") {
                throw new Error("A membership ID is required for a 'Member' ticket type.");
            }
            finalMembershipId = membership_id;
            finalTicketPrice = 0.00;
            finalDiscountAmount = 0.00;
        } else {
            // It's a standard (non-member) ticket. Calculate price.
            finalMembershipId = null; // Ensure member ID is null
            finalTicketPrice = parseFloat(ticket.base_price);
            finalDiscountAmount = finalTicketPrice * (parseFloat(currentDiscountPercent) / 100.0);
        }

        // --- 4. Insert the Visit ---
        const sql = `
            INSERT INTO visits (visit_date, ticket_type_id, membership_id, ticket_price, discount_amount)
            VALUES (?, ?, ?, ?, ?)
        `;
        await connection.query(sql, [
            visit_date, 
            ticket_type_id, 
            finalMembershipId, 
            finalTicketPrice, 
            finalDiscountAmount
        ]);
        
        // Success
        res.redirect('/dashboard');

    } catch (error) {
        // Error: Re-render the form with an error message
        console.error("Error logging visit:", error.message);
        try {
            const [ticketTypes] = await pool.query("SELECT ticket_type_id, type_name, base_price, is_member_type FROM ticket_types WHERE is_active = TRUE ORDER BY is_member_type, type_name");
            const [activeMembers] = await pool.query("SELECT membership_id, first_name, last_name, email FROM membership WHERE end_date >= CURDATE() ORDER BY last_name, first_name");
            const [promos] = await pool.query("SELECT discount_percent FROM event_promotions WHERE CURDATE() BETWEEN start_date AND end_date ORDER BY discount_percent DESC LIMIT 1");
            const currentDiscount = (promos.length > 0) ? promos[0].discount_percent : 0;

            res.render('log-visit', { 
                error: `Database error logging visit: ${error.message}`,
                ticketTypes: ticketTypes,
                activeMembers: activeMembers,
                currentDiscount: currentDiscount
            });
        } catch (fetchError) {
            console.error("Error fetching data for log-visit error page:", fetchError);
            res.render('log-visit', {
                 error: "A critical error occurred. Please try again.",
                 ticketTypes: [],
                 activeMembers: [],
                 currentDiscount: 0
            });
        }
    } finally {
        if (connection) connection.release();
    }
});

// --- MEMBERSHIP TYPE MANAGEMENT ---
// (Requires AdminOrManager access)

// GET list of membership types
app.get('/memberships/types', isAuthenticated, isAdminOrParkManager, async (req, res) => {
    try {
        const [types] = await pool.query('SELECT * FROM membership_type ORDER BY is_active DESC, type_name');
        // Note: You will need to create a 'membership-types.ejs' view
        // 'req.session.success' and 'req.session.error' are used for flash messages
        res.render('membership-types', { 
            types: types, 
            error: req.session.error, 
            success: req.session.success 
        });
        req.session.success = null; // Clear message after displaying
        req.session.error = null;
    } catch (error) {
        console.error(error);
        res.status(500).send('Error fetching membership types');
    }
});

// GET form to add a new membership type
app.get('/memberships/types/new', isAuthenticated, isAdminOrParkManager, (req, res) => {
    // Note: You will need to create an 'add-membership-type.ejs' view
    res.render('add-membership-type', { error: null });
});

// POST to create a new membership type
app.post('/memberships/types', isAuthenticated, isAdminOrParkManager, async (req, res) => {
    const { type_name, base_price, description } = req.body;
    let connection;
    try {
        connection = await pool.getConnection();
        const sql = "INSERT INTO membership_type (type_name, base_price, description, is_active) VALUES (?, ?, ?, TRUE)";
        await connection.query(sql, [type_name, base_price, description || null]);
        req.session.success = "Membership type added successfully!";
        res.redirect('/memberships/types');
    } catch (error) {
        console.error(error);
        res.render('add-membership-type', { error: "Database error adding type. Name might be duplicate." });
    } finally {
        if (connection) connection.release();
    }
});

// GET form to edit a membership type
app.get('/memberships/types/edit/:type_id', isAuthenticated, isAdminOrParkManager, async (req, res) => {
    const { type_id } = req.params;
    try {
        const [typeResult] = await pool.query('SELECT * FROM membership_type WHERE type_id = ?', [type_id]);
        if (typeResult.length === 0) {
            return res.status(404).send('Membership type not found');
        }
        // Note: You will need to create an 'edit-membership-type.ejs' view
        res.render('edit-membership-type', { type: typeResult[0], error: null });
    } catch (error) {
        console.error(error);
        res.status(500).send('Error loading edit page');
    }
});

// POST to update a membership type
app.post('/memberships/types/edit/:type_id', isAuthenticated, isAdminOrParkManager, async (req, res) => {
    const { type_id } = req.params;
    const { type_name, base_price, description } = req.body;
    let connection;
    try {
        connection = await pool.getConnection();
        const sql = `
            UPDATE membership_type 
            SET type_name = ?, base_price = ?, description = ?
            WHERE type_id = ?
        `;
        await connection.query(sql, [type_name, base_price, description || null, type_id]);
        req.session.success = "Membership type updated successfully!";
        res.redirect('/memberships/types');
    } catch (error) {
        console.error(error);
        const [typeResult] = await pool.query('SELECT * FROM membership_type WHERE type_id = ?', [type_id]);
        res.render('edit-membership-type', {
            type: typeResult.length > 0 ? typeResult[0] : {},
            error: "Database error updating type. Name might be duplicate."
        });
    } finally {
        if (connection) connection.release();
    }
});

// POST to toggle 'is_active' status (soft delete/reactivate)
app.post('/memberships/types/toggle/:type_id', isAuthenticated, isAdminOrParkManager, async (req, res) => {
    const { type_id } = req.params;
    let connection;
    try {
        connection = await pool.getConnection();
        
        // Find the current status
        const [current] = await pool.query('SELECT is_active FROM membership_type WHERE type_id = ?', [type_id]);
        if (current.length === 0) {
            return res.status(404).send('Membership type not found');
        }
        
        const newStatus = !current[0].is_active;

        // This logic handles your requirement:
        // If deactivating (newStatus = false), existing members are unaffected.
        // The 'GET /members/new' route will no longer show this as an option,
        // preventing new signups/renewals for this type.
        
        await connection.query('UPDATE membership_type SET is_active = ? WHERE type_id = ?', [newStatus, type_id]);
        req.session.success = `Membership type ${newStatus ? 'activated' : 'deactivated'} successfully.`;
        res.redirect('/memberships/types');
        
    } catch (error) {
        console.error("Error toggling membership status:", error);
        req.session.error = "Database error toggling status.";
        res.redirect('/memberships/types');
    } finally {
        if (connection) connection.release();
    }
});

// --- TICKET TYPE MANAGEMENT ---
// (Requires AdminOrManager access)

// GET list of ticket types
app.get('/ticket-types', isAuthenticated, isAdminOrParkManager, async (req, res) => {
    try {
        // Fetch all types, order by system-flag (member) first, then by name
        const [types] = await pool.query('SELECT * FROM ticket_types ORDER BY is_member_type DESC, is_active DESC, type_name');
        
        res.render('manage-ticket-types', { 
            types: types, 
            error: req.session.error, 
            success: req.session.success 
        });
        req.session.success = null; // Clear message after displaying
        req.session.error = null;
    } catch (error) {
        console.error("Error fetching ticket types:", error);
        res.status(500).send('Error fetching ticket types');
    }
});

// GET form to add a new ticket type
app.get('/ticket-types/new', isAuthenticated, isAdminOrParkManager, (req, res) => {
    res.render('add-ticket-type', { error: null });
});

// POST to create a new ticket type
app.post('/ticket-types', isAuthenticated, isAdminOrParkManager, async (req, res) => {
    // Note: is_member_type defaults to FALSE in the DB, so we only insert standard tickets.
    const { type_name, base_price, description } = req.body;
    let connection;
    try {
        connection = await pool.getConnection();
        const sql = "INSERT INTO ticket_types (type_name, base_price, description, is_active, is_member_type) VALUES (?, ?, ?, TRUE, FALSE)";
        await connection.query(sql, [type_name, base_price, description || null]);
        req.session.success = "Ticket type added successfully!";
        res.redirect('/ticket-types');
    } catch (error) {
        console.error("Error adding ticket type:", error);
        res.render('add-ticket-type', { error: "Database error adding type. Name might be duplicate." });
    } finally {
        if (connection) connection.release();
    }
});

// GET form to edit a ticket type
app.get('/ticket-types/edit/:type_id', isAuthenticated, isAdminOrParkManager, async (req, res) => {
    const { type_id } = req.params;
    try {
        const [typeResult] = await pool.query('SELECT * FROM ticket_types WHERE ticket_type_id = ?', [type_id]);
        if (typeResult.length === 0) {
            return res.status(404).send('Ticket type not found');
        }
        res.render('edit-ticket-type', { type: typeResult[0], error: null });
    } catch (error) {
        console.error("Error loading ticket edit page:", error);
        res.status(500).send('Error loading edit page');
    }
});

// POST to update a ticket type
app.post('/ticket-types/edit/:type_id', isAuthenticated, isAdminOrParkManager, async (req, res) => {
    const { type_id } = req.params;
    const { type_name, base_price, description } = req.body;
    let connection;
    let typeResult = [];

    try {
        connection = await pool.getConnection();

        // First, check if this is the 'Member' type which shouldn't be edited
        [typeResult] = await pool.query('SELECT * FROM ticket_types WHERE ticket_type_id = ?', [type_id]);
        if (typeResult.length === 0) {
            return res.status(404).send('Ticket type not found');
        }
        const ticketType = typeResult[0];

        // This check matches the logic in your EJS file.
        // If it's a member type, we only accept hidden fields (which are the same values)
        // or we just skip the update.
        if (ticketType.is_member_type) {
             // If they submit the form for the member type, just redirect without error
            req.session.error = "The 'Member' type is a system record and cannot be edited.";
            return res.redirect('/ticket-types');
        }

        // It's a standard ticket, so update it.
        const sql = `
            UPDATE ticket_types 
            SET type_name = ?, base_price = ?, description = ?
            WHERE ticket_type_id = ? AND is_member_type = FALSE
        `;
        await connection.query(sql, [type_name, base_price, description || null, type_id]);
        
        req.session.success = "Ticket type updated successfully!";
        res.redirect('/ticket-types');

    } catch (error) {
        console.error("Error updating ticket type:", error);
        // On error, re-render edit page with fetched data
        res.render('edit-ticket-type', {
            type: typeResult.length > 0 ? typeResult[0] : { ticket_type_id: type_id },
            error: "Database error updating type. Name might be duplicate."
        });
    } finally {
        if (connection) connection.release();
    }
});

// POST to toggle 'is_active' status
app.post('/ticket-types/toggle/:type_id', isAuthenticated, isAdminOrParkManager, async (req, res) => {
    const { type_id } = req.params;
    let connection;
    try {
        connection = await pool.getConnection();
        
        // Find the current status and type
        const [current] = await pool.query('SELECT is_active, is_member_type FROM ticket_types WHERE ticket_type_id = ?', [type_id]);
        if (current.length === 0) {
            return res.status(404).send('Ticket type not found');
        }
        
        // PREVENT DEACTIVATING THE MEMBER TYPE
        if (current[0].is_member_type) {
            req.session.error = "The 'Member' type is a system record and cannot be deactivated.";
            return res.redirect('/ticket-types');
        }

        const newStatus = !current[0].is_active;
        
        await connection.query('UPDATE ticket_types SET is_active = ? WHERE ticket_type_id = ?', [newStatus, type_id]);
        req.session.success = `Ticket type ${newStatus ? 'activated' : 'deactivated'} successfully.`;
        res.redirect('/ticket-types');
        
    } catch (error) {
        console.error("Error toggling ticket status:", error);
        req.session.error = "Database error toggling status.";
        res.redirect('/ticket-types');
    } finally {
        if (connection) connection.release();
    }
});

// --- PARK OPERATIONS (Weather, Promos, Items, Inventory) --- (No changes needed, still AdminOrManager)
app.get('/weather', isAuthenticated, isAdminOrParkManager, async (req, res) => {
    try {
        const [events] = await pool.query('SELECT * FROM weather_events ORDER BY event_date DESC');
        res.render('weather-events', { events: events });
    } catch (error) {
        console.error(error);
        res.status(500).send('Error fetching weather events');
    }
});
app.get('/weather/new', isAuthenticated, isAdminOrParkManager, async (req, res) => {
    res.render('add-weather-event', { error: null });
});
app.post('/weather', isAuthenticated, isAdminOrParkManager, async (req, res) => {
    const { event_date, weather_type } = req.body;
    const end_time = req.body.end_time ? req.body.end_time : null;
    const park_closure = req.body.park_closure === '1';

    let connection;
    try {
        connection = await pool.getConnection();
        const sql = `
            INSERT INTO weather_events (event_date, end_time, weather_type, park_closure)
            VALUES (?, ?, ?, ?)
        `;
        await connection.query(sql, [event_date, end_time, weather_type, park_closure]);
        res.redirect('/weather');
    } catch (error) {
        console.error(error);
        res.render('add-weather-event', { error: "Database error logging weather event." });
    } finally {
        if (connection) connection.release();
    }
});
app.get('/promotions', isAuthenticated, isAdminOrParkManager, async (req, res) => {
    try {
        const [promotions] = await pool.query('SELECT * FROM event_promotions ORDER BY start_date DESC');
        res.render('promotions', { promotions: promotions });
    } catch (error) {
        console.error(error);
        res.status(500).send('Error fetching promotions');
    }
});
app.get('/promotions/new', isAuthenticated, isAdminOrParkManager, async (req, res) => {
    res.render('add-promotion', { error: null });
});
app.post('/promotions', isAuthenticated, isAdminOrParkManager, async (req, res) => {
    const { event_name, event_type, start_date, end_date, discount_percent, summary } = req.body;
    let connection;
    try {
        connection = await pool.getConnection();
        const sql = `
            INSERT INTO event_promotions (event_name, event_type, start_date, end_date, discount_percent, summary)
            VALUES (?, ?, ?, ?, ?, ?)
        `;
        await connection.query(sql, [event_name, event_type, start_date, end_date, discount_percent, summary || null]);
        res.redirect('/promotions');
    } catch (error) {
        console.error(error);
        res.render('add-promotion', { error: "Database error adding promotion. Name might be duplicate." });
    } finally {
        if (connection) connection.release();
    }
});
app.get('/items', isAuthenticated, canManageRetail, async (req, res) => {
    try {
        const [items] = await pool.query('SELECT * FROM item ORDER BY item_name');
        res.render('items', { items: items });
    } catch (error) {
        console.error(error);
        res.status(500).send('Error fetching items');
    }
});
app.get('/items/new', isAuthenticated, canManageRetail, async (req, res) => {
    res.render('add-item', { error: null });
});
app.post('/items', isAuthenticated, canManageRetail, async (req, res) => {
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
app.get('/inventory', isAuthenticated, canManageRetail, async (req, res) => {
    try {
        const { role, locationId } = req.session.user;

        let query = `
            SELECT i.count, v.vendor_name, it.item_name
            FROM inventory i
            JOIN vendors v ON i.vendor_id = v.vendor_id
            JOIN item it ON i.item_id = it.item_id
        `;
        let params = [];

        if (role === 'Location Manager') {
            query += ' WHERE v.location_id = ?';
            params.push(locationId);
        }

        query += ' ORDER BY v.vendor_name, it.item_name';
        const [inventory] = await pool.query(query, params);
        res.render('inventory', { inventory: inventory });
    } catch (error) {
        console.error(error);
        res.status(500).send('Error fetching inventory');
    }
});
app.get('/inventory/manage', isAuthenticated, canManageRetail, async (req, res) => {
    try {
        const { role, vendorIds, locationId } = req.session.user; // <-- Add locationId

        let vendorQuery = 'SELECT vendor_id, vendor_name FROM vendors ORDER BY vendor_name';
        let vendorParams = [];

        if (role === 'Vendor Manager') {
            if (!vendorIds || vendorIds.length === 0) {
                // A vendor manager with no vendors assigned.
                const [items] = await pool.query('SELECT item_id, item_name FROM item ORDER BY item_name');
                return res.render('manage-inventory', { vendors: [], items: items, error: "You are not assigned to any vendors." });
            }
            vendorQuery = 'SELECT vendor_id, vendor_name FROM vendors WHERE vendor_id IN (?) ORDER BY vendor_name';
            vendorParams.push(vendorIds);
        } else if (role === 'Location Manager') {
            vendorQuery = 'SELECT vendor_id, vendor_name FROM vendors WHERE location_id = ? ORDER BY vendor_name';
            vendorParams.push(locationId);
        }

        const [vendors] = await pool.query(vendorQuery, vendorParams);
        const [items] = await pool.query('SELECT item_id, item_name FROM item ORDER BY item_name');
        res.render('manage-inventory', { vendors: vendors, items: items, error: null });
    } catch (error) {
        console.error(error);
        res.status(500).send('Error loading inventory management page');
    }
});
app.post('/inventory/manage', isAuthenticated, canManageRetail, async (req, res) => {
    const { vendor_id, item_id, count } = req.body;
    const { role, vendorIds, locationId } = req.session.user;

    let connection;

    try {
        if (role === 'Vendor Manager') {
            if (!vendorIds || !vendorIds.includes(parseInt(vendor_id, 10))) {
                return res.status(403).send('Forbidden: You can only manage inventory for your assigned vendors.');
            }
        } else if (role === 'Location Manager') {
            // Check if the vendor being submitted belongs to this manager's location
            const [vLoc] = await pool.query('SELECT location_id FROM vendors WHERE vendor_id = ?', [vendor_id]);
            if (vLoc.length === 0 || vLoc[0].location_id !== locationId) {
                return res.status(403).send('Forbidden: You can only manage inventory for vendors in your assigned location.');
            }
        }

        if (count < 0 || count === '' || count === null) {
            throw new Error("Inventory count must be zero or greater.");
        }

        connection = await pool.getConnection();
        const sql = `
            INSERT INTO inventory (vendor_id, item_id, count)
            VALUES (?, ?, ?)
            ON DUPLICATE KEY UPDATE count = ?
        `;
        await connection.query(sql, [vendor_id, item_id, count, count]);
        res.redirect('/inventory');

    } catch (error) {
        console.error("Error updating inventory:", error);

        let vendorQuery = 'SELECT vendor_id, vendor_name FROM vendors ORDER BY vendor_name';
        let vendorParams = [];

        if (role === 'Vendor Manager') {
            if (!vendorIds || vendorIds.length === 0) {
                vendorQuery = 'SELECT vendor_id, vendor_name FROM vendors WHERE 1 = 0'; // No vendors
            } else {
                vendorQuery = 'SELECT vendor_id, vendor_name FROM vendors WHERE vendor_id IN (?) ORDER BY vendor_name';
                vendorParams.push(vendorIds);
            }
        } else if (role === 'Location Manager') {
            vendorQuery = 'SELECT vendor_id, vendor_name FROM vendors WHERE location_id = ? ORDER BY vendor_name';
            vendorParams.push(locationId);
        }

        // Re-fetch the correct lists for the dropdowns
        const [vendors] = await pool.query(vendorQuery, vendorParams);
        const [items] = await pool.query('SELECT item_id, item_name FROM item ORDER BY item_name');

        res.render('manage-inventory', {
            vendors: vendors,
            items: items,
            error: (error.message.startsWith("Inventory count")) ? error.message : "Database error updating inventory."
        });
    } finally {
        if (connection) connection.release();
    }
});

app.get('/reports/attendance', isAuthenticated, canViewReports, async (req, res) => {
    try {
        // Fetch membership types dynamically for the filter dropdown
        const [membershipTypes] = await pool.query('SELECT type_id, type_name FROM membership_type WHERE is_active = TRUE ORDER BY type_name');

        // Set a reasonable default date (e.g., today or a specific date with data)
        const defaultDate = new Date().toISOString().substring(0, 10); // Today's date

        res.render('attendance-report', {
            membership_types: membershipTypes, // Pass dynamic types
            selected_date: defaultDate,
            grouping: 'day', // Default grouping
            membership_type_id: 'all', // Default filter selection
            attendance_data: null,     // No data on initial load
            labelFormat: 'Time Period',// Default axis label
            error: null
        });
    } catch (error) {
        console.error("Error loading attendance report page:", error);
        // Render with empty data and an error message
        res.render('attendance-report', {
            membership_types: [],
            selected_date: new Date().toISOString().substring(0, 10),
            grouping: 'day',
            membership_type_id: 'all',
            attendance_data: null,
            labelFormat: 'Time Period',
            error: 'Error loading page setup data. Please try again.'
        });
    }
});
app.post('/reports/attendance', isAuthenticated, canViewReports, async (req, res) => {
    const { selected_date, grouping, membership_type_id } = req.body;
    let membershipTypes = []; // To repopulate dropdown on error/success

    try {
        // Fetch membership types again for rendering the page
        [membershipTypes] = await pool.query('SELECT type_id, type_name FROM membership_type WHERE is_active = TRUE ORDER BY type_name');

        // Get date range and SQL format settings
        const { startDate, endDate, sqlDateFormat, labelFormat } = getReportSettings(selected_date, grouping);

        // --- Build Dynamic SQL Query ---
        let reportQuery = `
            SELECT
                DATE_FORMAT(v.visit_date, ?) as report_interval,
                COUNT(v.visit_id) as total_count
            FROM visits v
        `;
        let joinClause = '';
        let whereClause = ' WHERE DATE(v.visit_date) BETWEEN ? AND ? ';
        // Start params with format, start date, end date
        let params = [sqlDateFormat, startDate, endDate];

        // Add filtering based on membership type selection
        if (membership_type_id === 'non-member') {
            whereClause += 'AND v.membership_id IS NULL ';
        } else if (membership_type_id !== 'all') {
            // Join needed only if filtering by a specific member type
            joinClause = ' JOIN membership m ON v.membership_id = m.membership_id ';
            whereClause += 'AND m.type_id = ? ';
            params.push(membership_type_id); // Add type_id to params
        }

        // Combine query parts
        reportQuery += joinClause + whereClause + ' GROUP BY report_interval ORDER BY report_interval';

        // Execute the query
        const [reportData] = await pool.query(reportQuery, params);

        // Calculate average and identify spikes (e.g., > 25% above average)
        const totalSum = reportData.reduce((sum, row) => sum + row.total_count, 0);
        const avgCount = reportData.length > 0 ? totalSum / reportData.length : 0;
        const spikeThreshold = avgCount * 1.25;

        // Format data for Chart.js and add spike flag
        const chartData = reportData.map(row => ({
            label: row.report_interval,
            count: row.total_count,
            // Flag as spike if count exceeds threshold (and there's enough data to compare)
            isSpike: row.total_count >= spikeThreshold && reportData.length > 2
        }));

        // Render the report page with the generated data
        res.render('attendance-report', {
            membership_types: membershipTypes,
            selected_date: selected_date,
            grouping: grouping,
            membership_type_id: membership_type_id, // Pass back the selected ID
            attendance_data: chartData,
            labelFormat: labelFormat,
            error: null
        });

    } catch (error) {
        console.error("Error generating attendance report:", error);
        // Attempt to fetch types even on error for dropdown consistency
        try {
            [membershipTypes] = await pool.query('SELECT type_id, type_name FROM membership_type WHERE is_active = TRUE ORDER BY type_name');
        } catch (fetchErr) {
            membershipTypes = []; // Use empty array if fetch fails
        }
        // Render the report page with an error message
        res.render('attendance-report', {
            membership_types: membershipTypes,
            selected_date: selected_date,
            grouping: grouping,
            membership_type_id: membership_type_id,
            attendance_data: null, // No data to display on error
            labelFormat: 'Time Period',
            error: `Error generating report: ${error.message}` // Display specific error
        });
    }
});

// --- Start Server ---
app.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}`);
});