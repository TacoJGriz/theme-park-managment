const isAuthenticated = (req, res, next) => {
    if (req.session && req.session.user) {
        return next();
    }
    res.redirect('/');
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
    if (role === 'Admin' || role === 'Park Manager' || role === 'Staff') {
        return next();
    }
    res.status(403).send('Forbidden: Staff access or higher (excluding HR) required');
};
const canViewRides = (req, res, next) => {
    const role = req.session.user ? req.session.user.role : null;
    if (role === 'Admin' || role === 'Park Manager' || role === 'Location Manager' || role === 'Maintenance' || role === 'Staff') {
        return next();
    }
    res.status(403).send('Forbidden: Access denied for your role.');
};
const canManageRetail = (req, res, next) => {
    const role = req.session.user ? req.session.user.role : null;
    if (role === 'Admin' || role === 'Park Manager' || role === 'Location Manager') {
        return next();
    }
    res.status(403).send('Forbidden: Admin, Park Manager, or Location Manager access required.');
};
const canViewInventory = (req, res, next) => {
    const role = req.session.user ? req.session.user.role : null;
    if (role === 'Admin' || role === 'Park Manager' || role === 'Location Manager' || role === 'Staff') {
        return next();
    }
    res.status(403).send('Forbidden: Access denied.');
};
const canManageInventory = (req, res, next) => {
    const role = req.session.user ? req.session.user.role : null;
    if (role === 'Admin' || role === 'Park Manager' || role === 'Location Manager' || role === 'Staff') {
        return next();
    }
    res.status(403).send('Forbidden: Access denied.');
};
const canViewReports = (req, res, next) => {
    const role = req.session.user ? req.session.user.role : null;
    if (role === 'Admin' || role === 'Park Manager') {
        return next();
    }
    res.status(403).send('Forbidden: Admin or Park Manager access required for reports.');
};
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

    return { startDate, endDate, sqlDateFormat, labelFormat };
};
const canApproveWages = (req, res, next) => {
    const role = req.session.user ? req.session.user.role : null;
    if (role === 'Admin' || role === 'Head of HR') {
        return next();
    }
    res.status(403).send('Forbidden: Admin or Head of HR access required.');
};
const canApproveMaintenance = (req, res, next) => {
    const role = req.session.user ? req.session.user.role : null;
    if (role === 'Admin' || role === 'Park Manager') {
        return next();
    }
    res.status(403).send('Forbidden: Admin or Park Manager access required.');
};
const canLogRideRun = (req, res, next) => {
    const role = req.session.user ? req.session.user.role : null;
    if (role === 'Admin' || role === 'Park Manager' || role === 'Location Manager' || role === 'Staff') {
        return next();
    }
    res.status(403).send('Forbidden: Access denied.');
};
const canViewRideHistory = (req, res, next) => {
    const role = req.session.user ? req.session.user.role : null;
    if (role === 'Admin' || role === 'Park Manager' || role === 'Location Manager' || role === 'Staff') {
        return next();
    }
    res.status(403).send('Forbidden: Access denied.');
};
const canApproveInventory = (req, res, next) => {
    const role = req.session.user ? req.session.user.role : null;
    if (role === 'Admin' || role === 'Park Manager' || role === 'Location Manager') {
        return next();
    }
    res.status(403).send('Forbidden: Access denied.');
};
const canViewApprovals = (req, res, next) => {
    const role = req.session.user ? req.session.user.role : null;
    if (role === 'Admin' || role === 'Head of HR' || role === 'Park Manager' || role === 'Location Manager') {
        return next();
    }
    res.status(403).send('Forbidden: You do not have permission to view this page.');
};
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
const normalizePhone = (phoneString) => {
    if (!phoneString) {
        return "";
    }
    return phoneString.replace(/\D/g, '');
};
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
const isMemberAuthenticated = (req, res, next) => {
    if (req.session && req.session.member) {
        return next();
    }
    res.redirect('/login'); // <-- FIXED (was /member/login)
};

const isGuest = (req, res, next) => {
    if (req.session && req.session.user) {
        return res.redirect('/dashboard');
    }
    if (req.session && req.session.member) {
        return res.redirect('/member/dashboard');
    }
    return next();
};

module.exports = {
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
};