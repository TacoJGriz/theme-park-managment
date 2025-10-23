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

const isAdmin = (req, res, next) => {
  if (req.session.user && req.session.user.role === 'Admin') { return next(); }
  res.status(403).send('Forbidden: Admins only');
};
const isHR = (req, res, next) => {
  if (req.session.user && req.session.user.role === 'HR') { return next(); }
  res.status(403).send('Forbidden: HR only');
};
const isManager = (req, res, next) => {
  if (req.session.user && req.session.user.role === 'Manager') { return next(); }
  res.status(403).send('Forbidden: Managers only');
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

// MODIFIED: Renamed for clarity - Excludes HR
const canManageMembersAndVisits = (req, res, next) => {
  const role = req.session.user ? req.session.user.role : null;
  // Includes Admin, Manager, Staff -- **EXCLUDES HR**
  if (role === 'Admin' || role === 'Manager' || role === 'Staff') {
    return next();
  }
  res.status(403).send('Forbidden: Staff access or higher (excluding HR) required');
};

// NEW Middleware: Who can view reports? Admin or Manager
const canViewReports = (req, res, next) => {
  const role = req.session.user ? req.session.user.role : null;
  if (role === 'Admin' || role === 'Manager') {
    return next();
  }
  res.status(403).send('Forbidden: Admin or Manager access required for reports.');
};

// NEW Middleware: Who can view the rides list? Staff+ (incl Maintenance), but NOT HR
const canViewRides = (req, res, next) => {
  const role = req.session.user ? req.session.user.role : null;
  // Includes Admin, Manager, Maintenance, Staff (Staff need to report issues)
  // **EXCLUDES HR**
  if (role === 'Admin' || role === 'Manager' || role === 'Maintenance' || role === 'Staff') {
    return next();
  }
  res.status(403).send('Forbidden: Access denied for your role.'); // More specific message
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
        // Let express-session save automatically before redirecting
        res.redirect('/dashboard');
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

// --- USER & EMPLOYEE MANAGEMENT --- (No changes needed, still AdminOrHR)
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

  let locations = [];
  let supervisors = [];
  try {
    [locations] = await pool.query('SELECT location_id, location_name FROM location');
    [supervisors] = await pool.query('SELECT employee_id, first_name, last_name FROM employee_demographics WHERE is_active = TRUE');

    if (password !== confirm_password) {
      return res.render('add-employee', {
        locations: locations,
        supervisors: supervisors,
        error: "Passwords do not match."
      });
    }
  } catch (error) {
    console.error("Error fetching dropdown data for add employee:", error);
    return res.render('add-employee', {
      locations: [], supervisors: [],
      error: "Error loading form data. Please try again."
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
    res.render('add-employee', {
      locations: locations,
      supervisors: supervisors,
      error: "Database error adding employee. The email may already be in use."
    });
  } finally {
    if (connection) connection.release();
  }
});
app.get('/employees/edit/:id', isAuthenticated, isAdminOrHR, async (req, res) => {
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

    // Check if HR is trying to edit an Admin or another HR user
    // Note: actor.id is an int, employee.employee_id is an int from the DB
    if (actor.role === 'HR' && (targetRole === 'Admin' || (targetRole === 'HR' && actor.id !== targetId))) {
      return res.status(403).send('Forbidden: HR users cannot edit Admin or other HR users.');
    }

    const [locations] = await pool.query('SELECT location_id, location_name FROM location');
    const [supervisors] = await pool.query('SELECT employee_id, first_name, last_name FROM employee_demographics WHERE is_active = TRUE AND employee_id != ?', [employeeId]);

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
app.post('/employees/edit/:id', isAuthenticated, isAdminOrHR, async (req, res) => {
  const employeeId = req.params.id; // This is the Target ID
  const actor = req.session.user; // This is the Actor (logged-in user)

  let targetRole;
  try {
    // We must fetch the target user's role from the DB *before* updating
    const [targetUser] = await pool.query('SELECT employee_type FROM employee_demographics WHERE employee_id = ?', [employeeId]);
    if (targetUser.length === 0) {
      return res.status(404).send('Employee not found');
    }
    targetRole = targetUser[0].employee_type;

    // Check if HR is trying to edit an Admin or another HR user
    if (actor.role === 'HR' && (targetRole === 'Admin' || (targetRole === 'HR' && actor.id !== parseInt(employeeId)))) {
      return res.status(403).send('Forbidden: HR users cannot edit Admin or other HR users.');
    }
  } catch (error) {
    console.error("Permission check query error:", error);
    return res.status(500).send('Error checking permissions before update');
  }

  let connection;
  try {
    connection = await pool.getConnection();


    if (actor.role === 'Admin') {
      // ADMIN can edit everything (Original Logic)
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

    } else if (actor.role === 'HR') {
      // HR can only edit non-sensitive fields
      const {
        first_name, last_name, gender, phone_number, email,
        street_address, city, state, zip_code, birth_date
      } = req.body;

      // Note: The sensitive fields (hourly_rate, employee_type, etc.) are
      // deliberately *not* read from req.body, so they cannot be updated
      // even if a user tries to send them in the request.

      const sql = `
                UPDATE employee_demographics SET
                first_name = ?, last_name = ?, gender = ?, phone_number = ?, email = ?,
                street_address = ?, city = ?, state = ?, zip_code = ?, birth_date = ?
                WHERE employee_id = ?
            `;
      await connection.query(sql, [
        first_name, last_name, gender, phone_number || null, email, street_address || null, city || null, state || null, zip_code || null,
        birth_date,
        employeeId
      ]);
    }

    res.redirect('/users'); // Success

  } catch (error) {
    // Error handling logic (unchanged from original)
    console.error("Error updating employee:", error);
    try {
      const [employeeResult] = await pool.query('SELECT * FROM employee_demographics WHERE employee_id = ?', [employeeId]);
      const employee = employeeResult.length > 0 ? employeeResult[0] : {};
      const [locations] = await pool.query('SELECT location_id, location_name FROM location');
      const [supervisors] = await pool.query('SELECT employee_id, first_name, last_name FROM employee_demographics WHERE is_active = TRUE AND employee_id != ?', [employeeId]);
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

app.get('/employees/reset-password/:id', isAuthenticated, isAdminOrHR, async (req, res) => {
  const employeeId = req.params.id;
  const actor = req.session.user;

  try {
    const [employeeResult] = await pool.query('SELECT employee_id, first_name, last_name, employee_type FROM employee_demographics WHERE employee_id = ?', [employeeId]);
    if (employeeResult.length === 0) {
      return res.status(404).send('Employee not found');
    }
    const employee = employeeResult[0];

    // --- Permission Check ---
    // HR cannot reset Admin or other HR passwords
    const targetRole = employee.employee_type;
    const targetId = employee.employee_id;
    if (actor.role === 'HR' && (targetRole === 'Admin' || (targetRole === 'HR' && actor.id !== targetId))) {
      return res.status(403).send('Forbidden: You do not have permission to reset this user\'s password.');
    }

    res.render('reset-password', { employee: employee, error: null });

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
    // --- 1. Fetch employee for permission check & error re-render
    const [employeeResult] = await pool.query('SELECT employee_id, first_name, last_name, employee_type FROM employee_demographics WHERE employee_id = ?', [employeeId]);
    if (employeeResult.length === 0) {
      return res.status(404).send('Employee not found');
    }
    employee = employeeResult[0];

    // --- 2. Permission Check (CRITICAL: must be done in POST)
    const targetRole = employee.employee_type;
    const targetId = employee.employee_id;
    if (actor.role === 'HR' && (targetRole === 'Admin' || (targetRole === 'HR' && actor.id !== targetId))) {
      return res.status(403).send('Forbidden: You do not have permission to reset this user\'s password.');
    }

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

// --- LOCATION & VENDOR MANAGEMENT --- (No changes needed, still AdminOrManager)
app.get('/locations', isAuthenticated, isAdminOrManager, async (req, res) => {
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
app.get('/locations/new', isAuthenticated, isAdminOrManager, (req, res) => {
  res.render('add-location', { error: null });
});
app.post('/locations', isAuthenticated, isAdminOrManager, async (req, res) => {
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
    res.render('add-vendor', { locations: locations, managers: managers, error: null });
  } catch (error) {
    console.error(error);
    res.status(500).send('Error loading add vendor page');
  }
});
app.post('/vendors', isAuthenticated, isAdminOrManager, async (req, res) => {
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
    const [managers] = await pool.query("SELECT employee_id, first_name, last_name FROM employee_demographics WHERE employee_type IN ('Manager', 'Admin') AND is_active = TRUE");
    res.render('add-vendor', {
      locations: locations,
      managers: managers,
      error: "Database error adding vendor. Name might be duplicate."
    });
  } finally {
    if (connection) connection.release();
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

    if (!entity) {
      return res.status(404).send('Location or Vendor not found');
    }

    const [managers] = await pool.query("SELECT employee_id, first_name, last_name FROM employee_demographics WHERE employee_type IN ('Manager', 'Admin') AND is_active = TRUE");

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
app.post('/assign-manager/:type/:id', isAuthenticated, isAdminOrManager, async (req, res) => {
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
      const [managers] = await pool.query("SELECT employee_id, first_name, last_name FROM employee_demographics WHERE employee_type IN ('Manager', 'Admin') AND is_active = TRUE");
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
    const query = `
            SELECT r.*, l.location_name
            FROM rides r
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

// Add Ride remains AdminOrManager
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
app.post('/rides/status/:id', isAuthenticated, isAdminOrManager, async (req, res) => {
  const rideId = req.params.id;
  const { ride_status } = req.body;
  if (!['OPEN', 'CLOSED', 'BROKEN'].includes(ride_status)) {
    return res.status(400).send('Invalid ride status provided.');
  }
  let connection;
  try {
    connection = await pool.getConnection();
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
app.get('/maintenance/ride/:ride_id', isAuthenticated, isMaintenanceOrHigher, async (req, res) => {
  const rideId = req.params.ride_id;
  try {
    const [rideResult] = await pool.query('SELECT ride_id, ride_name FROM rides WHERE ride_id = ?', [rideId]);
    if (rideResult.length === 0) {
      return res.status(404).send('Ride not found');
    }
    const ride = rideResult[0];

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
  try {
    const [rideResult] = await pool.query('SELECT ride_id, ride_name FROM rides WHERE ride_id = ?', [rideId]);
    if (rideResult.length === 0) {
      return res.status(404).send('Ride not found');
    }
    const ride = rideResult[0];

    const [employees] = await pool.query(`
            SELECT employee_id, first_name, last_name
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

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const maintSql = "INSERT INTO maintenance (ride_id, summary, employee_id, report_date) VALUES (?, ?, ?, CURDATE())";
    await connection.query(maintSql, [ride_id, summary, employee_id]);

    const rideSql = "UPDATE rides SET ride_status = 'BROKEN' WHERE ride_id = ?";
    await connection.query(rideSql, [ride_id]);

    await connection.commit();
    if (['Admin', 'Manager', 'Maintenance'].includes(req.session.user.role)) {
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
                SELECT employee_id, first_name, last_name
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

// --- GUEST & VISITS MANAGEMENT ---
// UPDATED: Apply canManageMembersAndVisits (Staff+, excluding HR) middleware
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
  let connection;
  try {
    connection = await pool.getConnection();
    const sql = `
            INSERT INTO membership (first_name, last_name, email, phone_number, date_of_birth, member_type, start_date, end_date)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `;
    await connection.query(sql, [
      first_name, last_name, email, phone_number || null, date_of_birth, member_type, start_date, end_date
    ]);
    res.redirect('/members');
  } catch (error) {
    console.error(error);
    res.render('add-member', { error: "Database error adding member. Email might be duplicate." });
  } finally {
    if (connection) connection.release();
  }
});

// UPDATED: Apply canManageMembersAndVisits (Staff+, excluding HR) middleware
app.get('/visits/new', isAuthenticated, canManageMembersAndVisits, async (req, res) => {
  res.render('log-visit', { error: null });
});
app.post('/visits', isAuthenticated, canManageMembersAndVisits, async (req, res) => {
  const { ticket_type, ticket_price, discount_amount } = req.body;
  let connection;
  try {
    connection = await pool.getConnection();
    const visit_date = new Date();
    const sql = `
            INSERT INTO visits (visit_date, ticket_type, ticket_price, discount_amount)
            VALUES (?, ?, ?, ?)
        `;
    await connection.query(sql, [visit_date, ticket_type, ticket_price, discount_amount || 0]);
    res.redirect('/dashboard');
  } catch (error) {
    console.error(error);
    res.render('log-visit', { error: "Database error logging visit." });
  } finally {
    if (connection) connection.release();
  }
});

// --- PARK OPERATIONS (Weather, Promos, Items, Inventory) --- (No changes needed, still AdminOrManager)
app.get('/weather', isAuthenticated, isAdminOrManager, async (req, res) => {
  try {
    const [events] = await pool.query('SELECT * FROM weather_events ORDER BY event_date DESC');
    res.render('weather-events', { events: events });
  } catch (error) {
    console.error(error);
    res.status(500).send('Error fetching weather events');
  }
});
app.get('/weather/new', isAuthenticated, isAdminOrManager, async (req, res) => {
  res.render('add-weather-event', { error: null });
});
app.post('/weather', isAuthenticated, isAdminOrManager, async (req, res) => {
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
app.get('/promotions', isAuthenticated, isAdminOrManager, async (req, res) => {
  try {
    const [promotions] = await pool.query('SELECT * FROM event_promotions ORDER BY start_date DESC');
    res.render('promotions', { promotions: promotions });
  } catch (error) {
    console.error(error);
    res.status(500).send('Error fetching promotions');
  }
});
app.get('/promotions/new', isAuthenticated, isAdminOrManager, async (req, res) => {
  res.render('add-promotion', { error: null });
});
app.post('/promotions', isAuthenticated, isAdminOrManager, async (req, res) => {
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
app.get('/items', isAuthenticated, isAdminOrManager, async (req, res) => {
  try {
    const [items] = await pool.query('SELECT * FROM item ORDER BY item_name');
    res.render('items', { items: items });
  } catch (error) {
    console.error(error);
    res.status(500).send('Error fetching items');
  }
});
app.get('/items/new', isAuthenticated, isAdminOrManager, async (req, res) => {
  res.render('add-item', { error: null });
});
app.post('/items', isAuthenticated, isAdminOrManager, async (req, res) => {
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
app.get('/inventory', isAuthenticated, isAdminOrManager, async (req, res) => {
  try {
    const query = `
            SELECT i.count, v.vendor_name, it.item_name
            FROM inventory i
            JOIN vendors v ON i.vendor_id = v.vendor_id
            JOIN item it ON i.item_id = it.item_id
            ORDER BY v.vendor_name, it.item_name
        `;
    const [inventory] = await pool.query(query);
    res.render('inventory', { inventory: inventory });
  } catch (error) {
    console.error(error);
    res.status(500).send('Error fetching inventory');
  }
});
app.get('/inventory/manage', isAuthenticated, isAdminOrManager, async (req, res) => {
  try {
    const [vendors] = await pool.query('SELECT vendor_id, vendor_name FROM vendors ORDER BY vendor_name');
    const [items] = await pool.query('SELECT item_id, item_name FROM item ORDER BY item_name');
    res.render('manage-inventory', { vendors: vendors, items: items, error: null });
  } catch (error) {
    console.error(error);
    res.status(500).send('Error loading inventory management page');
  }
});
app.post('/inventory/manage', isAuthenticated, isAdminOrManager, async (req, res) => {
  const { vendor_id, item_id, count } = req.body;
  if (count < 0 || count === '' || count === null) {
    const [vendors] = await pool.query('SELECT vendor_id, vendor_name FROM vendors ORDER BY vendor_name');
    const [items] = await pool.query('SELECT item_id, item_name FROM item ORDER BY item_name');
    return res.render('manage-inventory', {
      vendors: vendors, items: items,
      error: "Inventory count must be zero or greater."
    });
  }

  let connection;
  try {
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
    const [vendors] = await pool.query('SELECT vendor_id, vendor_name FROM vendors ORDER BY vendor_name');
    const [items] = await pool.query('SELECT item_id, item_name FROM item ORDER BY item_name');
    res.render('manage-inventory', {
      vendors: vendors,
      items: items,
      error: "Database error updating inventory."
    });
  } finally {
    if (connection) connection.release();
  }
});

// --- ATTENDANCE REPORTING ---
// Helper for date formatting/grouping
const getReportSettings = (selectedDate, grouping) => {
  // Ensure the date object is created at midnight to prevent timezone issues
  const d = new Date(selectedDate + 'T00:00:00');
  let startDate, endDate, sqlDateFormat, labelFormat;

  if (grouping === 'day') {
    // Hourly view for one day
    startDate = selectedDate;
    endDate = selectedDate;
    // Group by hour (H:00)
    sqlDateFormat = '%Y-%m-%d %H:00';
    labelFormat = 'Hour of Day (YYYY-MM-DD HH:00)';
  } else if (grouping === 'week') {
    // Daily view for one week (Monday to Sunday)
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(d.setDate(diff));
    startDate = monday.toISOString().substring(0, 10);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    endDate = sunday.toISOString().substring(0, 10);
    // Group by day (YYYY-MM-DD)
    sqlDateFormat = '%Y-%m-%d';
    labelFormat = 'Day of Week (YYYY-MM-DD)';
  } else if (grouping === 'month') {
    // Daily view for one month
    const firstDay = new Date(d.getFullYear(), d.getMonth(), 1);
    startDate = firstDay.toISOString().substring(0, 10);
    const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    endDate = lastDay.toISOString().substring(0, 10);
    // Group by day (YYYY-MM-DD)
    sqlDateFormat = '%Y-%m-%d';
    labelFormat = 'Day of Month (YYYY-MM-DD)';
  } else if (grouping === 'year') {
    // Monthly view for one year
    const firstDay = new Date(d.getFullYear(), 0, 1);
    startDate = firstDay.toISOString().substring(0, 10);
    const lastDay = new Date(d.getFullYear(), 11, 31);
    endDate = lastDay.toISOString().substring(0, 10);
    // Group by month (YYYY-MM)
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
    const defaultDate = '2025-10-20'; // Use a date with dummy data for better demo

    res.render('attendance-report', {
      locations: locations,
      selected_date: defaultDate,
      grouping: 'day',
      location_id: '',
      attendance_data: null,
      labelFormat: 'Time Period', // Default label
      error: null
    });
  } catch (error) {
    console.error("Error loading attendance report page:", error);
    res.status(500).send('Error loading report data');
  }
});

app.post('/reports/attendance', isAuthenticated, canViewReports, async (req, res) => {
  const { selected_date, grouping, location_id } = req.body;

  try {
    const { startDate, endDate, sqlDateFormat, labelFormat } = getReportSettings(selected_date, grouping);

    // --- 1. Dynamic SQL Query: Counts visits grouped by the required time format from the 'visits' table ---
    const reportQuery = `
            SELECT 
                DATE_FORMAT(visit_date, ?) as report_interval, 
                COUNT(visit_id) as total_count
            FROM visits 
            WHERE DATE(visit_date) BETWEEN ? AND ? 
            GROUP BY report_interval
            ORDER BY report_interval
        `;
    const [reportData] = await pool.query(reportQuery, [sqlDateFormat, startDate, endDate]);

    // --- 2. Format data for the chart ---
    const chartData = reportData.map(row => ({
      label: row.report_interval,
      count: row.total_count
    }));

    const [locations] = await pool.query('SELECT location_id, location_name FROM location');

    res.render('attendance-report', {
      locations: locations,
      selected_date: selected_date,
      grouping: grouping,
      location_id: location_id,
      attendance_data: chartData,
      labelFormat: labelFormat, // Pass the dynamic label format to the EJS view
      error: null
    });

  } catch (error) {
    console.error("Error generating attendance report:", error);
    const [locations] = await pool.query('SELECT location_id, location_name FROM location');
    res.render('attendance-report', {
      locations: locations,
      selected_date: selected_date,
      grouping: grouping,
      location_id: location_id,
      attendance_data: null,
      labelFormat: 'Time Period',
      error: `Error generating report: ${error.message}`
    });
  }
});

// ... (omitting the rest of the file)

// --- Start Server ---
app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});
