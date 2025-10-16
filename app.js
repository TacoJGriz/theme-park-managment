// app.js
const express = require('express');
const mysql = require('mysql2'); // Import the database connector
const app = express(); // This is the line that was missing!
const port = 3000;

// Tell Express to use EJS as the templating engine
app.set('view engine', 'ejs');

// MIDDLEWARE: This allows Express to read data from forms.
app.use(express.urlencoded({ extended: true }));

// Database connection configuration
const dbConfig = {
  host: 'your_database_host',
  user: 'your_username',
  password: 'your_password',
  database: 'park_database' // I've updated this to your database name
};

// --- EXISTING USER REPORT ROUTE ---
app.get('/users', (req, res) => {
  const connection = mysql.createConnection(dbConfig);
  // This query will now fail because there is no 'Users' table.
  // You might want to change it to query 'employee_demographics'
  connection.query('SELECT user_id, name, email FROM employee_demographics', (error, results) => {
    if (error) {
      return res.status(500).send('Error querying the database');
    }
    res.render('users', { users: results });
    connection.end();
  });
});

// --- NEW LOGIN ROUTES ---

// 1. Route to SHOW the login page
app.get('/login', (req, res) => {
  res.render('login', { error: null });
});

// 2. Route to PROCESS the login form using your employee table
app.post('/login', (req, res) => {
  const email = req.body.username; // The form's input is named "username"
  const password = req.body.password;

  const connection = mysql.createConnection(dbConfig);
  
  const query = 'SELECT * FROM employee_demographics WHERE email = ? AND password = ?';

  connection.query(query, [email, password], (error, results) => {
    if (error) {
      console.error(error);
      return res.status(500).send('Database query error');
    }

    if (results.length > 0) {
      res.redirect('/dashboard');
    } else {
      res.render('login', { error: 'Invalid email or password' });
    }
    connection.end();
  });
});

// 3. A simple dashboard page for after a successful login
app.get('/dashboard', (req, res) => {
    res.send('<h1>Welcome to the Dashboard!</h1><p>You have successfully logged in.</p>');
});


// Start the server
app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});