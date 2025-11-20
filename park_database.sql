DROP DATABASE IF EXISTS park_database;
CREATE DATABASE park_database;
USE park_database;

CREATE TABLE employee_demographics (
    employee_id INT NOT NULL AUTO_INCREMENT,
    public_employee_id VARCHAR(36) NULL UNIQUE COMMENT 'Public-facing UUID for employees',
    first_name VARCHAR(50) NOT NULL,
    last_name VARCHAR(50) NOT NULL,
    gender ENUM('Male', 'Female', 'Other') NOT NULL,
    phone_number VARCHAR(15), -- accommodate for (123) 456-7890 formatting
    email VARCHAR(50) UNIQUE,
    street_address VARCHAR(255),
    city VARCHAR(100),
    state VARCHAR(2), -- Storing 2-letter abbreviation
    zip_code VARCHAR(10), -- Accommodates 5-digit or 5+4 format
    birth_date DATE NOT NULL,
    hire_date DATE NOT NULL,
    termination_date DATE,
    -- MODIFIED: Removed 'Head of HR' and 'HR Staff'
    employee_type ENUM('Staff', 'Maintenance', 'Location Manager', 'Park Manager', 'Admin') NOT NULL,
    location_id INT,
    supervisor_id INT,
    hourly_rate DECIMAL(10, 2),
    is_active BOOL DEFAULT TRUE,
    is_pending_approval BOOL NOT NULL DEFAULT FALSE,
    
    pending_hourly_rate DECIMAL(10, 2) DEFAULT NULL,
    rate_change_requested_by INT DEFAULT NULL,
    
    -- Keys
    PRIMARY KEY (employee_id),
    INDEX idx_public_employee_id (public_employee_id),
    FOREIGN KEY (supervisor_id) REFERENCES employee_demographics(employee_id),
    
    -- FOREIGN KEY
    FOREIGN KEY (rate_change_requested_by) REFERENCES employee_demographics(employee_id) ON DELETE SET NULL,

    -- Constraints
    CONSTRAINT chk_dates CHECK (termination_date IS NULL OR termination_date >= hire_date),
    CONSTRAINT chk_hire_age CHECK (hire_date >= DATE_ADD(birth_date, INTERVAL 16 YEAR)),
    CONSTRAINT chk_rate_positive CHECK (hourly_rate >= 0)
);

CREATE TABLE employee_auth (
    employee_id INT NOT NULL,
    password_hash VARCHAR(255) NOT NULL, -- Stores the secure bcrypt hash
    
    -- Keys
    PRIMARY KEY (employee_id),
    FOREIGN KEY (employee_id)
        REFERENCES employee_demographics (employee_id)
        ON DELETE CASCADE -- If an employee is deleted, their login is automatically deleted.
);

/* --- FIX FOR MAP ERROR: Added pin_x and pin_y columns --- */
CREATE TABLE location (
    location_id INT NOT NULL AUTO_INCREMENT,
    public_location_id VARCHAR(36) NULL UNIQUE COMMENT 'Public-facing UUID for locations',
    location_name VARCHAR(50) NOT NULL UNIQUE,
    summary VARCHAR(250),
    manager_id INT,
    manager_start DATE,
    pin_x DECIMAL(5, 2) NULL COMMENT 'X-coordinate for map pin (0-100)',
    pin_y DECIMAL(5, 2) NULL COMMENT 'Y-coordinate for map pin (0-100)',
    -- keys
    PRIMARY KEY (location_id),
    INDEX idx_public_location_id (public_location_id),
    FOREIGN KEY (manager_id)
        REFERENCES employee_demographics (employee_id)
        ON DELETE SET NULL -- if a manager is deleted, the manager id for the location is Null
);

ALTER TABLE employee_demographics
ADD FOREIGN KEY (location_id) REFERENCES location (location_id);

/* --- MODIFIED: Added 'WEATHER CLOSURE' to ENUM list for Triggers --- */
CREATE TABLE rides (
    ride_id INT NOT NULL AUTO_INCREMENT,
    public_ride_id VARCHAR(36) NULL UNIQUE COMMENT 'Public-facing UUID for rides',
    ride_name VARCHAR(50) NOT NULL,
    ride_type ENUM('Rollercoaster', 'Water Ride', 'Flat Ride', 'Show', 'Other') NOT NULL,
    ride_status ENUM('OPEN', 'CLOSED', 'BROKEN', 'WEATHER CLOSURE'),
    max_weight INT,
    min_height INT,
    capacity INT,
    location_id INT,
    PRIMARY KEY (ride_id),
    INDEX idx_public_ride_id (public_ride_id),
    FOREIGN KEY (location_id)
        REFERENCES location (location_id),
    CONSTRAINT chk_weight CHECK (max_weight >= 0),
    CONSTRAINT chk_height CHECK (min_height >= 0),
    CONSTRAINT chk_capacity CHECK (capacity >= 0)
);
    
CREATE TABLE maintenance (
    maintenance_id INT NOT NULL AUTO_INCREMENT,
    public_maintenance_id VARCHAR(36) NULL UNIQUE COMMENT 'Public-facing UUID for maintenance tickets',
    ride_id INT NOT NULL,
    report_date DATE NOT NULL DEFAULT (CURDATE()),
    start_date DATE,
    end_date DATE,
    summary VARCHAR(250),
    employee_id INT,
    cost DECIMAL(10,2),

    pending_employee_id INT DEFAULT NULL,
    assignment_requested_by INT DEFAULT NULL,

    -- Keys
    PRIMARY KEY (maintenance_id),
    INDEX idx_public_maintenance_id (public_maintenance_id),
    FOREIGN KEY (ride_id)
        REFERENCES rides (ride_id)
        ON DELETE CASCADE,
    FOREIGN KEY (employee_id)
        REFERENCES employee_demographics (employee_id)
        ON DELETE SET NULL,
        
    -- NEW FOREIGN KEYS
    FOREIGN KEY (pending_employee_id) REFERENCES employee_demographics(employee_id) ON DELETE SET NULL,
    FOREIGN KEY (assignment_requested_by) REFERENCES employee_demographics(employee_id) ON DELETE SET NULL,
        
    -- Constraints
    CONSTRAINT chk_maintenance_dates CHECK (start_date IS NULL OR start_date >= report_date),
    CONSTRAINT chk_completion_date CHECK (end_date IS NULL OR end_date >= start_date),
    CONSTRAINT chk_cost_positive CHECK (cost IS NULL OR cost >= 0)
);

CREATE TABLE membership_type (
    type_id INT NOT NULL AUTO_INCREMENT,
    public_type_id VARCHAR(36) NULL UNIQUE COMMENT 'Public-facing UUID for membership types',
    type_name VARCHAR(50) NOT NULL UNIQUE,
    base_price DECIMAL(10, 2) NOT NULL,
    base_members INT NOT NULL DEFAULT 1 COMMENT 'Members included in base price',
    additional_member_price DECIMAL(10, 2) NULL DEFAULT NULL COMMENT 'Price for each member above the base',
    
    /* --- NEW: Guest Pass Limit --- */
    guest_pass_limit INT NOT NULL DEFAULT 0 COMMENT 'Number of free guest passes per year included with this tier',
    
    description VARCHAR(250),
    is_active BOOL NOT NULL DEFAULT TRUE,
    
    PRIMARY KEY (type_id),
    INDEX idx_public_type_id (public_type_id),
    CONSTRAINT chk_base_price_positive CHECK (base_price >= 0),
    CONSTRAINT chk_guest_pass_limit CHECK (guest_pass_limit >= 0)
);

/* --- NEW: Blackout Dates Table --- */
CREATE TABLE blackout_dates (
    blackout_id INT NOT NULL AUTO_INCREMENT,
    type_id INT NOT NULL,
    blackout_date DATE NOT NULL,
    reason VARCHAR(100),
    
    PRIMARY KEY (blackout_id),
    FOREIGN KEY (type_id) REFERENCES membership_type(type_id) ON DELETE CASCADE,
    UNIQUE KEY unique_type_date (type_id, blackout_date)
);

CREATE TABLE membership (
    membership_id INT NOT NULL AUTO_INCREMENT,
    public_membership_id VARCHAR(36) NULL UNIQUE COMMENT 'Public-facing UUID for members',
	primary_member_id INT NULL DEFAULT NULL COMMENT 'Links sub-members to a primary account',
    first_name VARCHAR(25) NOT NULL,
    last_name VARCHAR(25) NOT NULL,
    email VARCHAR(50) UNIQUE,
    phone_number VARCHAR(15),
    date_of_birth DATE NOT NULL,
    type_id INT NOT NULL,
    start_date DATE NOT NULL DEFAULT (CURDATE()),
    end_date DATE NOT NULL,
    
    /* --- NEW: Tracking Remaining Guest Passes --- */
    guest_passes_remaining INT NOT NULL DEFAULT 0 COMMENT 'Decrements when a guest pass is used',
    
    PRIMARY KEY (membership_id),
    INDEX idx_public_membership_id (public_membership_id),
    FOREIGN KEY (type_id) 
        REFERENCES membership_type (type_id)
        ON DELETE RESTRICT,
        
    CONSTRAINT fk_primary_member
        FOREIGN KEY (primary_member_id)
        REFERENCES membership(membership_id)
        ON DELETE SET NULL, -- If primary is deleted, sub-members become their own primary
    CONSTRAINT chk_membership_dates CHECK (end_date > start_date),
    CONSTRAINT chk_guest_passes CHECK (guest_passes_remaining >= 0)
);

CREATE TABLE ticket_types (
    ticket_type_id INT NOT NULL AUTO_INCREMENT,
    public_ticket_type_id VARCHAR(36) NULL UNIQUE COMMENT 'Public-facing UUID for ticket types',
    type_name VARCHAR(50) NOT NULL UNIQUE,
    base_price DECIMAL(10, 2) NOT NULL,
    description VARCHAR(250) NULL,
    is_active BOOL NOT NULL DEFAULT TRUE,
    is_member_type BOOL NOT NULL DEFAULT FALSE,
    
    PRIMARY KEY (ticket_type_id),
    INDEX idx_public_ticket_type_id (public_ticket_type_id),
    CONSTRAINT chk_ticket_price_positive CHECK (base_price >= 0)
);

CREATE TABLE visits (
    visit_id INT NOT NULL AUTO_INCREMENT,
    membership_id INT,
    visit_date DATETIME,
    exit_time TIME,
    ticket_type_id INT NOT NULL,
    ticket_price DECIMAL(10,2) NULL,
    discount_amount DECIMAL(10,2) NULL,
    logged_by_employee_id INT,
	visit_group_id VARCHAR(36) NULL COMMENT 'Public-facing UUID for a single transaction/group check-in', 
    
    -- Keys
    PRIMARY KEY (visit_id),
    FOREIGN KEY (membership_id)
        REFERENCES membership (membership_id),
    FOREIGN KEY (ticket_type_id)
        REFERENCES ticket_types(ticket_type_id),
	FOREIGN KEY (logged_by_employee_id)
		REFERENCES employee_demographics(employee_id)
		ON DELETE SET NULL,
        
    -- for faster group lookups
    INDEX idx_visit_group (visit_group_id),
        
    -- Constraints
    CONSTRAINT chk_positive_prices CHECK (ticket_price >= 0 AND discount_amount >= 0),
    CONSTRAINT chk_valid_discount CHECK (discount_amount <= ticket_price)
);


CREATE TABLE weather_events (
    weather_id INT NOT NULL AUTO_INCREMENT,
    event_date DATETIME NOT NULL,
    end_time DATETIME,
    weather_type ENUM('Rain', 'Thunderstorm', 'Tornado Warning', 'Heatwave', 'Other') NOT NULL,
    park_closure BOOL NOT NULL DEFAULT FALSE,
    -- keys
    PRIMARY KEY (weather_id),
    -- constraints
    CONSTRAINT chk_weather_times CHECK (end_time IS NULL OR end_time >= event_date)
);


CREATE TABLE event_promotions (
    event_id INT NOT NULL AUTO_INCREMENT,
    event_name VARCHAR(100) NOT NULL UNIQUE,
    event_type ENUM('Holiday', 'Seasonal', 'Special', 'Weekend') NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    discount_percent DECIMAL(10,2) NOT NULL,
    summary VARCHAR(250),
    is_recurring BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'If TRUE, this promotion automatically renews for the next year after expiring.',
    -- keys
    PRIMARY KEY (event_id),
    -- constraints
    CONSTRAINT chk_event_dates CHECK (end_date >= start_date),
    CONSTRAINT chk_discount_percent CHECK (discount_percent BETWEEN 0 AND 100)
);


CREATE TABLE daily_stats (
    date_rec DATE NOT NULL,
    visitor_count INT,
    PRIMARY KEY (date_rec),
    CONSTRAINT chk_stats_count_positive CHECK (visitor_count >= 0)
);

CREATE TABLE vendors (
    vendor_id INT NOT NULL AUTO_INCREMENT,
    public_vendor_id VARCHAR(36) NULL UNIQUE COMMENT 'Public-facing UUID for vendors',
    vendor_name VARCHAR(100) NOT NULL UNIQUE,
    location_id INT,
    vendor_status ENUM('OPEN', 'CLOSED') NOT NULL DEFAULT 'OPEN',
    -- keys
    PRIMARY KEY (vendor_id),
    INDEX idx_public_vendor_id (public_vendor_id),
    FOREIGN KEY (location_id)
        REFERENCES location (location_id)
        ON DELETE SET NULL
        ON UPDATE CASCADE
);

CREATE TABLE item (
    item_id INT NOT NULL AUTO_INCREMENT,
    public_item_id VARCHAR(36) NULL UNIQUE COMMENT 'Public-facing UUID for items',
    item_type ENUM('Food', 'Souvenir', 'Apparel', 'Other') NOT NULL,
    item_name VARCHAR(50),
    price DECIMAL(10,2),
    summary VARCHAR(250),
    PRIMARY KEY (item_id),
    INDEX idx_public_item_id (public_item_id),
    CONSTRAINT chk_item_price_positive CHECK (price >= 0)
);

/* --- UPDATED: Added min_count and def_count for Auto-Restock Trigger --- */
CREATE TABLE inventory (
    item_id INT NOT NULL,
    vendor_id INT NOT NULL,
    count INT,
    min_count INT DEFAULT 10, -- Threshold for trigger
    def_count INT DEFAULT 50, -- Default restock amount
    PRIMARY KEY (item_id , vendor_id),
    FOREIGN KEY (item_id)
        REFERENCES item (item_id),
    FOREIGN KEY (vendor_id)
        REFERENCES vendors (vendor_id),
    CONSTRAINT chk_count_positive CHECK (count >= 0)
);

CREATE TABLE inventory_requests (
    request_id INT NOT NULL AUTO_INCREMENT,
    public_request_id VARCHAR(36) NULL UNIQUE COMMENT 'Public-facing UUID for inventory requests',
    vendor_id INT NOT NULL,
    item_id INT NOT NULL,
    requested_count INT NOT NULL,
    requested_by_id INT,
    location_id INT, -- For filtering approvals by Location Manager
    request_date DATE NOT NULL DEFAULT (CURDATE()),
    status ENUM('Pending', 'Approved', 'Rejected') NOT NULL DEFAULT 'Pending',
    
    PRIMARY KEY (request_id),
    INDEX idx_public_request_id (public_request_id),
    FOREIGN KEY (vendor_id) REFERENCES vendors(vendor_id) ON DELETE CASCADE,
    FOREIGN KEY (item_id) REFERENCES item(item_id) ON DELETE CASCADE,
    FOREIGN KEY (requested_by_id) REFERENCES employee_demographics(employee_id) ON DELETE SET NULL,
    FOREIGN KEY (location_id) REFERENCES location(location_id) ON DELETE SET NULL,

    CONSTRAINT chk_req_count_positive CHECK (requested_count >= 0)
);

CREATE TABLE daily_ride (
    ride_id INT NOT NULL,
    dat_date DATE NOT NULL,
    ride_count INT UNSIGNED DEFAULT 0,
    run_count INT UNSIGNED DEFAULT 0,
    -- keys
    PRIMARY KEY (ride_id , dat_date),
    FOREIGN KEY (ride_id) REFERENCES rides (ride_id),
    FOREIGN KEY (dat_date) REFERENCES daily_stats (date_rec)
);

CREATE TABLE member_auth (
    membership_id INT NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    
    -- Keys
    PRIMARY KEY (membership_id),
    FOREIGN KEY (membership_id)
        REFERENCES membership (membership_id)
        ON DELETE CASCADE -- If a member is deleted, their login is automatically deleted.
);

CREATE TABLE member_payment_methods (
    payment_method_id INT NOT NULL AUTO_INCREMENT,
    public_payment_id VARCHAR(36) NULL UNIQUE COMMENT 'Public-facing UUID for payment methods',
    membership_id INT NOT NULL,
    payment_type ENUM('Card', 'Bank') NOT NULL,
    is_default BOOL NOT NULL DEFAULT FALSE,
    mock_identifier VARCHAR(50) COMMENT 'Stores safe, displayable info like "Visa ending in 4242"',
    mock_expiration VARCHAR(5) COMMENT 'Stores mock MM/YY for cards, NULL for bank',
    
    PRIMARY KEY (payment_method_id),
    INDEX idx_public_payment_id (public_payment_id),
    FOREIGN KEY (membership_id)
        REFERENCES membership (membership_id)
        ON DELETE CASCADE -- If a member is deleted, their saved payment methods are also deleted
);

CREATE TABLE membership_purchase_history (
    purchase_id INT NOT NULL AUTO_INCREMENT,
    public_purchase_id VARCHAR(36) NULL UNIQUE COMMENT 'Public-facing UUID for purchase history',
    membership_id INT NOT NULL,
    purchase_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    type_id INT NOT NULL,
    type_name_snapshot VARCHAR(50) NOT NULL COMMENT 'Name of the type at time of purchase',
    price_paid DECIMAL(10, 2) NOT NULL,
    purchased_start_date DATE NOT NULL,
    purchased_end_date DATE NOT NULL,
    payment_method_id INT NULL COMMENT 'Which saved payment method was used, if any',
    
    PRIMARY KEY (purchase_id),
    INDEX idx_public_purchase_id (public_purchase_id),
    
    FOREIGN KEY (membership_id) 
        REFERENCES membership(membership_id) 
        ON DELETE CASCADE,
        
    FOREIGN KEY (type_id) 
        REFERENCES membership_type(type_id) 
        ON DELETE RESTRICT,
        
    FOREIGN KEY (payment_method_id) 
        REFERENCES member_payment_methods(payment_method_id) 
        ON DELETE SET NULL
);

CREATE TABLE prepaid_tickets (
    e_ticket_id INT NOT NULL AUTO_INCREMENT,
    purchase_id VARCHAR(50) NOT NULL COMMENT 'Groups tickets from one transaction',
    ticket_code VARCHAR(36) NOT NULL UNIQUE COMMENT 'UUID for redemption',
    ticket_type_id INT NOT NULL,
    purchase_date DATETIME NOT NULL,
    
    -- Store customer info for lookup
    email VARCHAR(50),
    phone_number VARCHAR(15),
    
    -- Store price at time of purchase
    base_price DECIMAL(10,2) NOT NULL,
    discount_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    
    -- Redemption status
    is_redeemed BOOL NOT NULL DEFAULT FALSE,
    redeemed_date DATETIME,
    visit_id INT NULL,
    
    PRIMARY KEY (e_ticket_id),
    FOREIGN KEY (ticket_type_id) REFERENCES ticket_types(ticket_type_id),
    FOREIGN KEY (visit_id) REFERENCES visits(visit_id) ON DELETE SET NULL,
    INDEX idx_purchase_id (purchase_id)
);

-- --- AUTOMATION: Annual Promotion Renewal ---
-- SET GLOBAL event_scheduler = ON;

DELIMITER //

CREATE EVENT IF NOT EXISTS AutoRenewAnnualPromotions
ON SCHEDULE EVERY 1 DAY
STARTS (TIMESTAMP(CURRENT_DATE) + INTERVAL 1 DAY) -- Runs daily at midnight
DO
BEGIN
    -- Update recurring promotions that have ended
    UPDATE event_promotions
    SET 
        start_date = DATE_ADD(start_date, INTERVAL 1 YEAR),
        end_date = DATE_ADD(end_date, INTERVAL 1 YEAR)
    WHERE 
        end_date < CURDATE()      -- Promotion has expired
        AND is_recurring = TRUE;  -- Flagged to renew
END //

DELIMITER ;


-- --- TRIGGER 1: Auto-Restock Inventory (from previous step) ---
DELIMITER $$

DROP TRIGGER IF EXISTS auto_restock $$

CREATE TRIGGER auto_restock
AFTER UPDATE ON inventory
FOR EACH ROW
BEGIN
    DECLARE request_check INT DEFAULT 0;
    DECLARE existing_request_id INT;

    -- Only proceed if thresholds are set and current stock is below minimum
    IF NEW.min_count IS NOT NULL AND NEW.def_count IS NOT NULL AND (NEW.count < NEW.min_count) THEN
        
        -- Check if there is already a PENDING request for this exact Item + Vendor
        SELECT request_id INTO existing_request_id
        FROM inventory_requests
        WHERE status = 'Pending'
          AND item_id = NEW.item_id 
          AND vendor_id = NEW.vendor_id
        LIMIT 1;

        -- SCENARIO 1: No pending request exists -> Create a NEW one
        IF existing_request_id IS NULL THEN
            INSERT INTO inventory_requests (
                public_request_id, 
                vendor_id, 
                item_id, 
                requested_count, 
                requested_by_id, 
                location_id, 
                request_date, 
                status
            )
            SELECT 
                UUID(), -- *** CRITICAL: Generate UUID for Web App Buttons ***
                NEW.vendor_id,
                NEW.item_id,
                (NEW.def_count - NEW.count),
                NULL, -- System generated, so no employee ID
                V.location_id,
                CURDATE(),
                'Pending'
            FROM vendors V 
            WHERE V.vendor_id = NEW.vendor_id;

        -- SCENARIO 2: Pending request exists -> Update it if count dropped further
        ELSEIF existing_request_id IS NOT NULL AND NEW.count < OLD.count THEN
            UPDATE inventory_requests
            SET requested_count = requested_count + (OLD.count - NEW.count)
            WHERE request_id = existing_request_id;
        END IF;

    END IF; 
END$$

DELIMITER ;


-- --- TRIGGER 2: Weather Closure & Reopening ---
DELIMITER $$

DROP TRIGGER IF EXISTS weather_closure $$
CREATE TRIGGER weather_closure
AFTER INSERT ON weather_events
FOR EACH ROW
BEGIN
    -- Sets all OPEN rides to 'WEATHER CLOSURE' if a park-closing event starts now
	IF NEW.end_time IS NULL AND NEW.park_closure IS TRUE THEN
		UPDATE rides
        SET ride_status = 'WEATHER CLOSURE'
		WHERE ride_status = 'OPEN';
	END IF;
END$$

DROP TRIGGER IF EXISTS weather_ended $$
CREATE TRIGGER weather_ended
AFTER UPDATE ON weather_events
FOR EACH ROW
BEGIN
    -- Sets all 'WEATHER CLOSURE' rides back to 'OPEN' once the event is marked complete
	IF OLD.end_time IS NULL AND NEW.end_time IS NOT NULL AND OLD.park_closure IS TRUE THEN
	UPDATE rides
    SET ride_status = 'OPEN'
    WHERE ride_status = 'WEATHER CLOSURE';
    END IF;
END$$

DELIMITER ;