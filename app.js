require('dotenv').config();
const express = require('express');
const session = require('express-session');
const app = express();
const port = 3000;

const {
    countPendingApprovals
} = require('./middleware/auth');

// view engine setup
app.set('view engine', 'ejs');

// standard middleware
app.use(express.urlencoded({
    extended: true
}));
app.use(express.json());
app.use(express.static('public'));

// session config
app.use(session({
    secret: 'MvXA5TJt6pcuq',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false
    }
}));

// expose session data to views
app.use((req, res, next) => {
    res.locals.user = req.session.user;
    res.locals.member = req.session.member;
    next();
});

// notification badges
app.use(countPendingApprovals);

// routes
app.use('/', require('./routes/index'));
app.use('/', require('./routes/auth'));
app.use('/', require('./routes/management'));
app.use('/', require('./routes/approvals'));
app.use('/rides', require('./routes/rides'));
app.use('/maintenance', require('./routes/maintenance'));

// user management (mapped to both /users and /employees for compatibility)
app.use('/users', require('./routes/users'));
app.use('/employees', require('./routes/users'));

app.use('/items', require('./routes/items'));
app.use('/inventory', require('./routes/inventory'));
app.use('/reports', require('./routes/reports'));
app.use('/members', require('./routes/members'));
app.use('/member', require('./routes/member-portal'));
app.use('/visits', require('./routes/visits'));

// start server
app.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}`);
});