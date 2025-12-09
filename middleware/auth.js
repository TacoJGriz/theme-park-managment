const pool = require('../db');

// ensure user is logged in
const isAuthenticated = (req, res, next) => {
    if (req.session && req.session.user) {
        return next();
    }
    res.redirect('/');
};

// admin only access
const isAdmin = (req, res, next) => {
    if (req.session.user && req.session.user.role === 'Admin') {
        return next();
    }
    res.status(403).send('Forbidden: Admins only');
};

// park manager access
const isParkManager = (req, res, next) => {
    if (req.session.user && req.session.user.role === 'Park Manager') {
        return next();
    }
    res.status(403).send('Forbidden: Park Managers only');
};

// allow admins to add employees
const canAddEmployees = (req, res, next) => {
    const role = req.session.user ? req.session.user.role : null;
    if (role === 'Admin') {
        return next();
    }
    res.status(403).send('Forbidden: Admin access required');
};

// access for admins or park managers
const isAdminOrParkManager = (req, res, next) => {
    const role = req.session.user ? req.session.user.role : null;
    if (role === 'Admin' || role === 'Park Manager') {
        return next();
    }
    res.status(403).send('Forbidden: Admin or Park Manager access required');
};

// view user lists
const canViewUsers = (req, res, next) => {
    const role = req.session.user ? req.session.user.role : null;
    if (role === 'Admin' || role === 'Park Manager' || role === 'Location Manager') {
        return next();
    }
    res.status(403).send('Forbidden: Access denied.');
};

// maintenance staff and higher
const isMaintenanceOrHigher = (req, res, next) => {
    const role = req.session.user ? req.session.user.role : null;
    if (role === 'Admin' || role === 'Park Manager' || role === 'Maintenance') {
        return next();
    }
    res.status(403).send('Forbidden: Maintenance or higher access required');
};

// manage member visits
const canManageMembersVisits = (req, res, next) => {
    const role = req.session.user ? req.session.user.role : null;
    if (role === 'Admin' || role === 'Park Manager' || role === 'Staff') {
        return next();
    }
    res.status(403).send('Forbidden: Staff access or higher required');
};

// view ride status
const canViewRides = (req, res, next) => {
    const role = req.session.user ? req.session.user.role : null;
    if (role === 'Admin' || role === 'Park Manager' || role === 'Location Manager' || role === 'Maintenance' || role === 'Staff') {
        return next();
    }
    res.status(403).send('Forbidden: Access denied for your role.');
};

// retail management
const canManageRetail = (req, res, next) => {
    const role = req.session.user ? req.session.user.role : null;
    if (role === 'Admin' || role === 'Park Manager' || role === 'Location Manager') {
        return next();
    }
    res.status(403).send('Forbidden: Admin, Park Manager, or Location Manager access required.');
};

// view inventory
const canViewInventory = (req, res, next) => {
    const role = req.session.user ? req.session.user.role : null;
    if (role === 'Admin' || role === 'Park Manager' || role === 'Location Manager' || role === 'Staff') {
        return next();
    }
    res.status(403).send('Forbidden: Access denied.');
};

// modify inventory
const canManageInventory = (req, res, next) => {
    const role = req.session.user ? req.session.user.role : null;
    if (role === 'Admin' || role === 'Park Manager' || role === 'Location Manager' || role === 'Staff') {
        return next();
    }
    res.status(403).send('Forbidden: Access denied.');
};

// view reports
const canViewReports = (req, res, next) => {
    const role = req.session.user ? req.session.user.role : null;
    if (role === 'Admin' || role === 'Park Manager') {
        return next();
    }
    res.status(403).send('Forbidden: Admin or Park Manager access required for reports.');
};

// calculate report date ranges
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

// approve maintenance
const canApproveMaintenance = (req, res, next) => {
    const role = req.session.user ? req.session.user.role : null;
    if (role === 'Admin' || role === 'Park Manager') {
        return next();
    }
    res.status(403).send('Forbidden: Admin or Park Manager access required.');
};

// log ride runs
const canLogRideRun = (req, res, next) => {
    const role = req.session.user ? req.session.user.role : null;
    if (role === 'Admin' || role === 'Park Manager' || role === 'Location Manager' || role === 'Staff') {
        return next();
    }
    res.status(403).send('Forbidden: Access denied.');
};

// view ride history
const canViewRideHistory = (req, res, next) => {
    const role = req.session.user ? req.session.user.role : null;
    if (role === 'Admin' || role === 'Park Manager' || role === 'Location Manager' || role === 'Staff') {
        return next();
    }
    res.status(403).send('Forbidden: Access denied.');
};

// approve inventory
const canApproveInventory = (req, res, next) => {
    const role = req.session.user ? req.session.user.role : null;
    if (role === 'Admin' || role === 'Park Manager' || role === 'Location Manager') {
        return next();
    }
    res.status(403).send('Forbidden: Access denied.');
};

// view approvals page
const canViewApprovals = (req, res, next) => {
    const role = req.session.user ? req.session.user.role : null;
    if (role === 'Admin' || role === 'Park Manager' || role === 'Location Manager') {
        return next();
    }
    res.status(403).send('Forbidden: You do not have permission to view this page.');
};

// format phone number
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

// normalize phone number
const normalizePhone = (phoneString) => {
    if (!phoneString) {
        return "";
    }
    return phoneString.replace(/\D/g, '');
};

// format date for receipt
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

// mask phone number
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

// ensure member is logged in
const isMemberAuthenticated = (req, res, next) => {
    if (req.session && req.session.member) {
        return next();
    }
    res.redirect('/login');
};

// ensure user is guest
const isGuest = (req, res, next) => {
    if (req.session && req.session.user) {
        return res.redirect('/dashboard');
    }
    if (req.session && req.session.member) {
        return res.redirect('/member/dashboard');
    }
    return next();
};

// count pending approvals for badges
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
        if (role === 'Admin' || role === 'Park Manager') {
            const [mResult] = await pool.query(
                'SELECT COUNT(*) as count FROM maintenance WHERE pending_employee_id IS NOT NULL AND end_date IS NULL'
            );
            count += mResult[0].count;
        }

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

        if (role === 'Maintenance') {
            const [assignResult] = await pool.query(
                'SELECT COUNT(*) as count FROM maintenance WHERE employee_id = ? AND end_date IS NULL',
                [id]
            );
            res.locals.maintenanceCount = assignResult[0].count;
        }

        res.locals.approvalCount = count;

        const lastCheck = req.session.lastApprovalCheckCount || 0;
        res.locals.newApprovalCount = Math.max(0, count - lastCheck);

    } catch (error) {
        console.error("Error counting approvals/notifications:", error);
    }
    next();
};

// maintenance management access
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