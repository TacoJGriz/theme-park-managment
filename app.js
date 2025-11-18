require('dotenv').config();
const express = require('express');
const bcrypt = require('bcrypt');
const session = require('express-session');
const pool = require('./db');
const app = express();
const port = 3000;
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

app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// --- SESSION CONFIGURATION ---
app.use(session({
    secret: 'a_secret_key_for_your_project',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }
}));

// --- GLOBAL MIDDLEWARE ---
app.use((req, res, next) => {
    res.locals.user = req.session.user; // For Employee Portal
    res.locals.member = req.session.member; // For Member Portal
    next();
});

// --- ROUTE DEFINITIONS ---
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

const memberRoutes = require('./routes/members'); // Employee-facing /members routes
app.use('/members', memberRoutes);

const memberPortalRoutes = require('./routes/member-portal'); // Member-facing /member routes
app.use('/member', memberPortalRoutes);

const visitRoutes = require('./routes/visits'); // Employee-facing /visits routes
app.use('/visits', visitRoutes);

// --- Start Server ---
app.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}`);
});