require('dotenv').config();
const express = require('express');
const bcrypt = require('bcrypt');
const session = require('express-session');
const pool = require('./db');
const app = express();
const port = 3000;

// import authentication and authorization middleware functions
const {
    isAuthenticated,
    isAdmin,
    isHR,
    isParkManager,
    canAddEmployees,
    canApproveEmployees,
    canViewPendingEmployees,
    isAdminOrParkManager,
    canViewUsers,
    isMaintenanceOrHigher,
    canManageMembersVisits,
    canViewRides,
    canManageRetail,
    canViewInventory,
    canManageInventory,
    canViewReports,
    getReportSettings,
    canApproveWages,
    canApproveMaintenance,
    canLogRideRun,
    canViewRideHistory,
    canApproveInventory,
    canViewApprovals,
    formatPhoneNumber,
    normalizePhone,
    formatReceiptDate,
    censorPhone,
    isMemberAuthenticated,
    isGuest
} = require('./middleware/auth');

// configure ejs as the view engine
app.set('view engine', 'ejs');

// configure standard middleware for form data, json, and static files
app.use(express.urlencoded({
    extended: true
}));
app.use(express.json());
app.use(express.static('public'));

// configure session management
app.use(session({
    secret: 'MvXA5TJt6pcuq',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false
    }
}));

// middleware to make user and member session data available to templates
app.use((req, res, next) => {
    res.locals.user = req.session.user;
    res.locals.member = req.session.member;
    next();
});

// middleware to calculate pending approval counts for dashboards
const {
    countPendingApprovals
} = require('./middleware/auth');
app.use(countPendingApprovals);

// register application routes
const indexRoutes = require('./routes/index');
app.use('/', indexRoutes);

const rideRoutes = require('./routes/rides');
app.use('/rides', rideRoutes);

const maintenanceRoutes = require('./routes/maintenance');
app.use('/maintenance', maintenanceRoutes);

const authRoutes = require('./routes/auth');
app.use('/', authRoutes);

const userRoutes = require('./routes/users');
app.use('/users', userRoutes);
app.use('/employees', userRoutes);

const approvalRoutes = require('./routes/approvals');
app.use('/', approvalRoutes);
app.use('/approvals', approvalRoutes);

const managementRoutes = require('./routes/management');
app.use('/', managementRoutes);

const itemRoutes = require('./routes/items');
app.use('/items', itemRoutes);

const inventoryRoutes = require('./routes/inventory');
app.use('/inventory', inventoryRoutes);

const reportRoutes = require('./routes/reports');
app.use('/reports', reportRoutes);

const memberRoutes = require('./routes/members');
app.use('/members', memberRoutes);

const memberPortalRoutes = require('./routes/member-portal');
app.use('/member', memberPortalRoutes);

const visitRoutes = require('./routes/visits');
app.use('/visits', visitRoutes);

// start the server on the specified port
app.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}`);
});