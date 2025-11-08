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

const memberRoutes = require('./routes/members');
app.use('/members', memberRoutes);
app.use('/visits', memberRoutes);
app.use('/member', memberRoutes);

const authRoutes = require('./routes/auth');
app.use('/', authRoutes);

const userRoutes = require('./routes/users');
app.use('/users', userRoutes);
app.use('/employees', userRoutes);

const approvalRoutes = require('./routes/approvals');
app.use('/', approvalRoutes);
app.use('/approvals', approvalRoutes);

const managementRoutes = require('./routes/management');
app.use('/locations', managementRoutes);
app.use('/vendors', managementRoutes);
app.use('/assign-manager', managementRoutes);
app.use('/memberships/types', managementRoutes);
app.use('/ticket-types', managementRoutes);
app.use('/weather', managementRoutes);
app.use('/promotions', managementRoutes);

const retailRoutes = require('./routes/retail');
app.use('/items', retailRoutes);
app.use('/inventory', retailRoutes);

const reportRoutes = require('./routes/reports');
app.use('/reports', reportRoutes);

// --- Start Server ---
app.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}`);
});