const pool = require('../db');

// middleware to ensure the user is logged in
const isAuthenticated = (req, res, next) => {
    if (req.session && req.session.user) {
        return next();
    }
    res.redirect('/');
};

// middleware to restrict access to admins only
const isAdmin = (req, res, next) => {
    if (req.session.user && req.session.user.role === 'Admin') {
        return next();
    }
    res.status(403).send('Forbidden: Admins only');
};

// middleware to restrict access to park managers only
const isParkManager = (req, res, next) => {
    if (req.session.user && req.session.user.role === 'Park Manager') {
        return next();
    }
    res.status(403).send('Forbidden: Park Managers only');
};

// middleware allowing only admins to add employees
const canAddEmployees = (req, res, next) => {
    const role = req.session.user ? req.session.user.role : null;
    if (role === 'Admin') {
        return next();
    }
    res.status(403).send('Forbidden: Admin access required');
};

// middleware allowing access to admins or park managers
const isAdminOrParkManager = (req, res, next) => {
    const role = req.session.user ? req.session.user.role : null;
    if (role === 'Admin' || role === 'Park Manager') {
        return next();
    }
    res.status(403).send('Forbidden: Admin or Park Manager access required');
};

// middleware allowing upper management to view user lists
const canViewUsers = (req, res, next) => {
    const role = req.session.user ? req.session.user.role : null;
    if (role === 'Admin' || role === 'Park Manager' || role === 'Location Manager') {
        return next();
    }
    res.status(403).send('Forbidden: Access denied.');
};

// middleware allowing maintenance staff and management
const isMaintenanceOrHigher = (req, res, next) => {
    const role = req.session.user ? req.session.user.role : null;
    if (role === 'Admin' || role === 'Park Manager' || role === 'Maintenance') {
        return next();
    }
    res.status(403).send('Forbidden: Maintenance or higher access required');
};

// middleware allowing staff and management to handle member visits
const canManageMembersVisits = (req, res, next) => {
    const role = req.session.user ? req.session.user.role : null;
    if (role === 'Admin' || role === 'Park Manager' || role === 'Staff') {
        return next();
    }
    res.status(403).send('Forbidden: Staff access or higher required');
};

// middleware allowing most employees to view ride status
const canViewRides = (req, res, next) => {
    const role = req.session.user ? req.session.user.role : null;
    if (role === 'Admin' || role === 'Park Manager' || role === 'Location Manager' || role === 'Maintenance' || role === 'Staff') {
        return next();
    }
    res.status(403).send('Forbidden: Access denied for your role.');
};

// middleware restricting retail management to location managers and up
const canManageRetail = (req, res, next) => {
    const role = req.session.user ? req.session.user.role : null;
    if (role === 'Admin' || role === 'Park Manager' || role === 'Location Manager') {
        return next();
    }
    res.status(403).send('Forbidden: Admin, Park Manager, or Location Manager access required.');
};

// middleware allowing staff and management to view inventory
const canViewInventory = (req, res, next) => {
    const role = req.session.user ? req.session.user.role : null;
    if (role === 'Admin' || role === 'Park Manager' || role === 'Location Manager' || role === 'Staff') {
        return next();
    }
    res.status(403).send('Forbidden: Access denied.');
};

// middleware allowing staff and management to modify inventory
const canManageInventory = (req, res, next) => {
    const role = req.session.user ? req.session.user.role : null;
    if (role === 'Admin' || role === 'Park Manager' || role === 'Location Manager' || role === 'Staff') {
        return next();
    }
    res.status(403).send('Forbidden: Access denied.');
};

// middleware restricting report viewing to senior management
const canViewReports = (req, res, next) => {
    const role = req.session.user ? req.session.user.role : null;
    if (role === 'Admin' || role === 'Park Manager') {
        return next();
    }
    res.status(403).send('Forbidden: Admin or Park Manager access required for reports.');
};

// helper to calculate date ranges and formats for reports based on grouping
const getReportSettings = (selectedDate, grouping) => {
    const d = new Date(selectedDate + 'T00:00:00');
    if (isNaN(d.getTime())) {
        throw new Error("Invalid date selected.");
    }

    let startDate, endDate, sqlDateFormat, labelFormat;

    if (grouping === 'day') {
        startDate = selectedDate;
        endDate = selectedDate;
        sqlDateFormat = '%Y-%m-%d %H:00';
        labelFormat = 'Hour of Day (YYYY-MM-DD HH:00)';
    } else if (grouping === 'week') {
        const dayOfWeek = d.getDay();
        const diffToMonday = d.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
        const monday = new Date(d.setDate(diffToMonday));
        startDate = monday.toISOString().substring(0, 10);

        const sunday = new Date(monday);
        sunday.setDate(monday.getDate() + 6);
        endDate = sunday.toISOString().substring(0, 10);
        sqlDateFormat = '%Y-%m-%d';
        labelFormat = 'Day of Week (YYYY-MM-DD)';
    } else if (grouping === 'month') {
        const year = d.getFullYear();
        const month = d.getMonth();
        const firstDay = new Date(year, month, 1);
        startDate = firstDay.toISOString().substring(0, 10);
        const lastDay = new Date(year, month + 1, 0);
        endDate = lastDay.toISOString().substring(0, 10);
        sqlDateFormat = '%Y-%m-%d';
        labelFormat = 'Day of Month (YYYY-MM-DD)';
    } else if (grouping === 'year') {
        const year = d.getFullYear();
        const firstDay = new Date(year, 0, 1);
        startDate = firstDay.toISOString().substring(0, 10);
        const lastDay = new Date(year, 11, 31);
        endDate = lastDay.toISOString().substring(0, 10);
        sqlDateFormat = '%Y-%m';
        labelFormat = 'Month of Year (YYYY-MM)';
    } else {
        throw new Error("Invalid grouping selection.");
    }

    return {
        startDate,
        endDate,
        sqlDateFormat,
        labelFormat
    };
};

// middleware restricting maintenance approval to senior management
const canApproveMaintenance = (req, res, next) => {
    const role = req.session.user ? req.session.user.role : null;
    if (role === 'Admin' || role === 'Park Manager') {
        return next();
    }
    res.status(403).send('Forbidden: Admin or Park Manager access required.');
};

// middleware allowing employees to log ride runs
const canLogRideRun = (req, res, next) => {
    const role = req.session.user ? req.session.user.role : null;
    if (role === 'Admin' || role === 'Park Manager' || role === 'Location Manager' || role === 'Staff') {
        return next();
    }
    res.status(403).send('Forbidden: Access denied.');
};

// middleware allowing employees to view ride history
const canViewRideHistory = (req, res, next) => {
    const role = req.session.user ? req.session.user.role : null;
    if (role === 'Admin' || role === 'Park Manager' || role === 'Location Manager' || role === 'Staff') {
        return next();
    }
    res.status(403).send('Forbidden: Access denied.');
};

// middleware restricting inventory approval to managers
const canApproveInventory = (req, res, next) => {
    const role = req.session.user ? req.session.user.role : null;
    if (role === 'Admin' || role === 'Park Manager' || role === 'Location Manager') {
        return next();
    }
    res.status(403).send('Forbidden: Access denied.');
};

// middleware restricting approval viewing to managers
const canViewApprovals = (req, res, next) => {
    const role = req.session.user ? req.session.user.role : null;
    if (role === 'Admin' || role === 'Park Manager' || role === 'Location Manager') {
        return next();
    }
    res.status(403).send('Forbidden: You do not have permission to view this page.');
};

// formats a phone string into standard US format
const formatPhoneNumber = (phoneString) => {
    if (!phoneString) {
        return null;
    }

    const digits = phoneString.replace(/\D/g, '');

    if (digits.length === 10) {
        return `(${digits.substring(0, 3)}) ${digits.substring(3, 6)}-${digits.substring(6, 10)}`;
    }

    return phoneString.substring(0, 15) || null;
};

// strips non-numeric characters from a phone string
const normalizePhone = (phoneString) => {
    if (!phoneString) {
        return "";
    }
    return phoneString.replace(/\D/g, '');
};

// formats a date object for receipt display
const formatReceiptDate = (date) => {
    if (!date) return '';
    return date.toLocaleString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
};

// masks phone number digits for privacy
const censorPhone = (phone) => {
    if (!phone) return 'N/A';
    const digits = phone.replace(/\D/g, '');
    if (digits.length > 4) {
        const lastFour = digits.slice(-4);
        const censoredPart = '*'.repeat(digits.length - 4);

        if (digits.length === 10) {
            return `(${censoredPart.slice(0, 3)}) ${censoredPart.slice(3, 6)}-${lastFour}`;
        }
        return `${censoredPart}-${lastFour}`;
    }
    return phone;
};

// middleware ensuring a member is logged in
const isMemberAuthenticated = (req, res, next) => {
    if (req.session && req.session.member) {
        return next();
    }
    res.redirect('/login');
};

// middleware ensuring the user is a guest (not logged in)
const isGuest = (req, res, next) => {
    if (req.session && req.session.user) {
        return res.redirect('/dashboard');
    }
    if (req.session && req.session.member) {
        return res.redirect('/member/dashboard');
    }
    return next();
};

// calculates pending approval counts for the dashboard notification badge
const countPendingApprovals = async (req, res, next) => {
    res.locals.approvalCount = 0;
    res.locals.newApprovalCount = 0;
    res.locals.maintenanceCount = 0;

    if (!req.session || !req.session.user) {
        return next();
    }

    const {
        id,
        role,
        locationId
    } = req.session.user;
    let count = 0;

    try {
        // count maintenance reassignments for senior management
        if (role === 'Admin' || role === 'Park Manager') {
            const [mResult] = await pool.query(
                'SELECT COUNT(*) as count FROM maintenance WHERE pending_employee_id IS NOT NULL AND end_date IS NULL'
            );
            count += mResult[0].count;
        }

        // count pending inventory requests for managers
        if (role === 'Admin' || role === 'Park Manager' || role === 'Location Manager') {
            let sql = `
                SELECT COUNT(*) as count 
                FROM inventory_requests ir 
                JOIN vendors v ON ir.vendor_id = v.vendor_id 
                WHERE ir.status = 'Pending'
            `;
            let params = [];

            if (role === 'Location Manager') {
                sql += " AND v.location_id = ?";
                params.push(locationId);
            }

            const [iResult] = await pool.query(sql, params);
            count += iResult[0].count;
        }

        // count active assignments for maintenance staff
        if (role === 'Maintenance') {
            const [assignResult] = await pool.query(
                'SELECT COUNT(*) as count FROM maintenance WHERE employee_id = ? AND end_date IS NULL',
                [id]
            );
            res.locals.maintenanceCount = assignResult[0].count;
        }

        res.locals.approvalCount = count;

        // calculate new items since last check
        const lastCheck = req.session.lastApprovalCheckCount || 0;
        res.locals.newApprovalCount = Math.max(0, count - lastCheck);

    } catch (error) {
        console.error("Error counting approvals/notifications:", error);
    }
    next();
};

// middleware restricting maintenance management to relevant roles
const canManageMaintenance = (req, res, next) => {
    const role = req.session.user ? req.session.user.role : null;
    if (role === 'Admin' || role === 'Park Manager' || role === 'Location Manager' || role === 'Maintenance') {
        return next();
    }
    res.status(403).send('Forbidden: Maintenance management access required.');
};

module.exports = {
    isAuthenticated,
    isAdmin,
    isParkManager,
    canAddEmployees,
    isAdminOrParkManager,
    canViewUsers,
    isMaintenanceOrHigher,
    canManageMaintenance,
    canManageMembersVisits,
    canViewRides,
    canManageRetail,
    canViewInventory,
    canManageInventory,
    canViewReports,
    getReportSettings,
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
    isGuest,
    countPendingApprovals
};