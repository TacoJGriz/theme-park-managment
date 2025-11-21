-- Database initialization commands
DROP DATABASE IF EXISTS park_database;
CREATE DATABASE park_database;
USE park_database;

-- Table to store employee personal and professional data
CREATE TABLE employee_demographics (
    employee_id INT NOT NULL AUTO_INCREMENT,
    public_employee_id VARCHAR(36) NULL UNIQUE,
    first_name VARCHAR(50) NOT NULL,
    last_name VARCHAR(50) NOT NULL,
    gender ENUM('Male', 'Female', 'Other') NOT NULL,
    phone_number VARCHAR(15),
    email VARCHAR(50) UNIQUE,
    street_address VARCHAR(255),
    city VARCHAR(100),
    state VARCHAR(2),
    zip_code VARCHAR(10),
    birth_date DATE NOT NULL,
    hire_date DATE NOT NULL,
    termination_date DATE,
    employee_type ENUM('Staff', 'Maintenance', 'Location Manager', 'Park Manager', 'Admin') NOT NULL,
    location_id INT,
    supervisor_id INT,
    hourly_rate DECIMAL(10, 2),
    is_active BOOL DEFAULT TRUE,

    -- Key definitions
    PRIMARY KEY (employee_id),
    INDEX idx_public_employee_id (public_employee_id),
    FOREIGN KEY (supervisor_id) REFERENCES employee_demographics(employee_id),

    -- Data validation constraints
    CONSTRAINT chk_dates CHECK (termination_date IS NULL OR termination_date >= hire_date),
    CONSTRAINT chk_hire_age CHECK (hire_date >= DATE_ADD(birth_date, INTERVAL 16 YEAR)),
    CONSTRAINT chk_rate_positive CHECK (hourly_rate >= 0)
);

-- Table to store secure login credentials for employees
CREATE TABLE employee_auth (
    employee_id INT NOT NULL,
    password_hash VARCHAR(255) NOT NULL,

    -- Key definitions
    PRIMARY KEY (employee_id),
    FOREIGN KEY (employee_id)
        REFERENCES employee_demographics (employee_id)
        ON DELETE CASCADE
);

-- Table to define park locations/lands
CREATE TABLE location (
    location_id INT NOT NULL AUTO_INCREMENT,
    public_location_id VARCHAR(36) NULL UNIQUE,
    location_name VARCHAR(50) NOT NULL UNIQUE,
    summary VARCHAR(250),
    manager_id INT,
    manager_start DATE,
    -- Coordinates for map pins
    pin_x DECIMAL(5, 2) NULL,
    pin_y DECIMAL(5, 2) NULL,

    -- Key definitions
    PRIMARY KEY (location_id),
    INDEX idx_public_location_id (public_location_id),
    FOREIGN KEY (manager_id)
        REFERENCES employee_demographics (employee_id)
        ON DELETE SET NULL
);

-- Links employee demographics to their work location
ALTER TABLE employee_demographics
ADD FOREIGN KEY (location_id) REFERENCES location (location_id);

-- Table for ride information and status
CREATE TABLE rides (
    ride_id INT NOT NULL AUTO_INCREMENT,
    public_ride_id VARCHAR(36) NULL UNIQUE,
    ride_name VARCHAR(50) NOT NULL,
    ride_type ENUM('Rollercoaster', 'Water Ride', 'Flat Ride', 'Show', 'Other') NOT NULL,
    ride_status ENUM('OPEN', 'CLOSED', 'BROKEN', 'WEATHER CLOSURE'),
    max_weight INT,
    min_height INT,
    capacity INT,
    location_id INT,

    -- Key definitions
    PRIMARY KEY (ride_id),
    INDEX idx_public_ride_id (public_ride_id),
    FOREIGN KEY (location_id)
        REFERENCES location (location_id),

    -- Data validation constraints
    CONSTRAINT chk_weight CHECK (max_weight >= 0),
    CONSTRAINT chk_height CHECK (min_height >= 0),
    CONSTRAINT chk_capacity CHECK (capacity >= 0)
);

-- Table to track maintenance and repair work on rides
CREATE TABLE maintenance (
    maintenance_id INT NOT NULL AUTO_INCREMENT,
    public_maintenance_id VARCHAR(36) NULL UNIQUE,
    ride_id INT NOT NULL,
    report_date DATE NOT NULL DEFAULT (CURDATE()),
    start_date DATE,
    end_date DATE,
    summary VARCHAR(250),
    employee_id INT,
    cost DECIMAL(10,2),
    pending_employee_id INT DEFAULT NULL,
    assignment_requested_by INT DEFAULT NULL,

    -- Key definitions
    PRIMARY KEY (maintenance_id),
    INDEX idx_public_maintenance_id (public_maintenance_id),
    FOREIGN KEY (ride_id)
        REFERENCES rides (ride_id)
        ON DELETE CASCADE,
    FOREIGN KEY (employee_id)
        REFERENCES employee_demographics (employee_id)
        ON DELETE SET NULL,
    FOREIGN KEY (pending_employee_id) REFERENCES employee_demographics(employee_id) ON DELETE SET NULL,
    FOREIGN KEY (assignment_requested_by) REFERENCES employee_demographics(employee_id) ON DELETE SET NULL,

    -- Data validation constraints
    CONSTRAINT chk_maintenance_dates CHECK (start_date IS NULL OR start_date >= report_date),
    CONSTRAINT chk_completion_date CHECK (end_date IS NULL OR end_date >= start_date),
    CONSTRAINT chk_cost_positive CHECK (cost IS NULL OR cost >= 0)
);

-- Table defining available membership tiers
CREATE TABLE membership_type (
    type_id INT NOT NULL AUTO_INCREMENT,
    public_type_id VARCHAR(36) NULL UNIQUE,
    type_name VARCHAR(50) NOT NULL UNIQUE,
    base_price DECIMAL(10, 2) NOT NULL,
    base_members INT NOT NULL DEFAULT 1,
    additional_member_price DECIMAL(10, 2) NULL DEFAULT NULL,
    guest_pass_limit INT NOT NULL DEFAULT 0,
    description VARCHAR(250),
    is_active BOOL NOT NULL DEFAULT TRUE,

    -- Key definitions and constraints
    PRIMARY KEY (type_id),
    INDEX idx_public_type_id (public_type_id),
    CONSTRAINT chk_base_price_positive CHECK (base_price >= 0),
    CONSTRAINT chk_guest_pass_limit CHECK (guest_pass_limit >= 0)
);

-- Table for dates when a membership type is invalid for entry
CREATE TABLE blackout_dates (
    blackout_id INT NOT NULL AUTO_INCREMENT,
    type_id INT NOT NULL,
    blackout_date DATE NOT NULL,
    reason VARCHAR(100),

    -- Key definitions
    PRIMARY KEY (blackout_id),
    FOREIGN KEY (type_id) REFERENCES membership_type(type_id) ON DELETE CASCADE,
    UNIQUE KEY unique_type_date (type_id, blackout_date)
);

-- Table for individual member profiles
CREATE TABLE membership (
    membership_id INT NOT NULL AUTO_INCREMENT,
    public_membership_id VARCHAR(36) NULL UNIQUE,
    primary_member_id INT NULL DEFAULT NULL,
    first_name VARCHAR(25) NOT NULL,
    last_name VARCHAR(25) NOT NULL,
    email VARCHAR(50) UNIQUE,
    phone_number VARCHAR(15),
    date_of_birth DATE NOT NULL,
    type_id INT NOT NULL,
    start_date DATE NOT NULL DEFAULT (CURDATE()),
    end_date DATE NOT NULL,
    guest_passes_remaining INT NOT NULL DEFAULT 0,

    -- Key definitions and constraints
    PRIMARY KEY (membership_id),
    INDEX idx_public_membership_id (public_membership_id),
    FOREIGN KEY (type_id)
        REFERENCES membership_type (type_id)
        ON DELETE RESTRICT,
    CONSTRAINT fk_primary_member
        FOREIGN KEY (primary_member_id)
        REFERENCES membership(membership_id)
        ON DELETE SET NULL,
    CONSTRAINT chk_membership_dates CHECK (end_date > start_date),
    CONSTRAINT chk_guest_passes CHECK (guest_passes_remaining >= 0)
);

-- Table for available single-day or general ticket types
CREATE TABLE ticket_types (
    ticket_type_id INT NOT NULL AUTO_INCREMENT,
    public_ticket_type_id VARCHAR(36) NULL UNIQUE,
    type_name VARCHAR(50) NOT NULL UNIQUE,
    base_price DECIMAL(10, 2) NOT NULL,
    description VARCHAR(250) NULL,
    is_active BOOL NOT NULL DEFAULT TRUE,
    is_member_type BOOL NOT NULL DEFAULT FALSE,

    -- Key definitions and constraints
    PRIMARY KEY (ticket_type_id),
    INDEX idx_public_ticket_type_id (public_ticket_type_id),
    CONSTRAINT chk_ticket_price_positive CHECK (base_price >= 0)
);

-- Table to log each visitor's entry and exit
CREATE TABLE visits (
    visit_id INT NOT NULL AUTO_INCREMENT,
    membership_id INT,
    visit_date DATETIME,
    exit_time TIME,
    ticket_type_id INT NOT NULL,
    ticket_price DECIMAL(10,2) NULL,
    discount_amount DECIMAL(10,2) NULL,
    logged_by_employee_id INT,
    visit_group_id VARCHAR(36) NULL,

    -- Key definitions
    PRIMARY KEY (visit_id),
    FOREIGN KEY (membership_id)
        REFERENCES membership (membership_id),
    FOREIGN KEY (ticket_type_id)
        REFERENCES ticket_types(ticket_type_id),
    FOREIGN KEY (logged_by_employee_id)
        REFERENCES employee_demographics(employee_id)
        ON DELETE SET NULL,
    INDEX idx_visit_group (visit_group_id),

    -- Data validation constraints
    CONSTRAINT chk_positive_prices CHECK (ticket_price >= 0 AND discount_amount >= 0),
    CONSTRAINT chk_valid_discount CHECK (discount_amount <= ticket_price)
);


-- Table to track weather events affecting park operations
CREATE TABLE weather_events (
    weather_id INT NOT NULL AUTO_INCREMENT,
    event_date DATETIME NOT NULL,
    end_time DATETIME,
    weather_type ENUM('Rain', 'Thunderstorm', 'Tornado Warning', 'Heatwave', 'Other') NOT NULL,
    park_closure BOOL NOT NULL DEFAULT FALSE,

    -- Key definitions and constraints
    PRIMARY KEY (weather_id),
    CONSTRAINT chk_weather_times CHECK (end_time IS NULL OR end_time >= event_date)
);


-- Table for park-wide promotional events and discounts
CREATE TABLE event_promotions (
    event_id INT NOT NULL AUTO_INCREMENT,
    event_name VARCHAR(100) NOT NULL UNIQUE,
    event_type ENUM('Holiday', 'Seasonal', 'Special', 'Weekend') NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    discount_percent DECIMAL(10,2) NOT NULL,
    summary VARCHAR(250),

    -- Key definitions and constraints
    PRIMARY KEY (event_id),
    CONSTRAINT chk_event_dates CHECK (end_date >= start_date),
    CONSTRAINT chk_discount_percent CHECK (discount_percent BETWEEN 0 AND 100)
);


-- Table for high-level daily statistics
CREATE TABLE daily_stats (
    date_rec DATE NOT NULL,
    visitor_count INT,

    -- Key definitions and constraints
    PRIMARY KEY (date_rec),
    CONSTRAINT chk_stats_count_positive CHECK (visitor_count >= 0)
);

-- Table for park vendors (stores, restaurants, kiosks)
CREATE TABLE vendors (
    vendor_id INT NOT NULL AUTO_INCREMENT,
    public_vendor_id VARCHAR(36) NULL UNIQUE,
    vendor_name VARCHAR(100) NOT NULL UNIQUE,
    location_id INT,
    vendor_status ENUM('OPEN', 'CLOSED') NOT NULL DEFAULT 'OPEN',

    -- Key definitions
    PRIMARY KEY (vendor_id),
    INDEX idx_public_vendor_id (public_vendor_id),
    FOREIGN KEY (location_id)
        REFERENCES location (location_id)
        ON DELETE SET NULL
        ON UPDATE CASCADE
);

-- Table for sellable items (food, merchandise)
CREATE TABLE item (
    item_id INT NOT NULL AUTO_INCREMENT,
    public_item_id VARCHAR(36) NULL UNIQUE,
    item_type ENUM('Food', 'Souvenir', 'Apparel', 'Other') NOT NULL,
    item_name VARCHAR(50),
    price DECIMAL(10,2),
    summary VARCHAR(250),

    -- Key definitions and constraints
    PRIMARY KEY (item_id),
    INDEX idx_public_item_id (public_item_id),
    CONSTRAINT chk_item_price_positive CHECK (price >= 0)
);

-- Table to track current stock levels of items at each vendor
CREATE TABLE inventory (
    item_id INT NOT NULL,
    vendor_id INT NOT NULL,
    count INT,
    min_count INT DEFAULT 10,
    def_count INT DEFAULT 50,

    -- Key definitions and constraints
    PRIMARY KEY (item_id , vendor_id),
    FOREIGN KEY (item_id)
        REFERENCES item (item_id),
    FOREIGN KEY (vendor_id)
        REFERENCES vendors (vendor_id),
    CONSTRAINT chk_count_positive CHECK (count >= 0)
);

-- Table for requests to restock vendor inventory
CREATE TABLE inventory_requests (
    request_id INT NOT NULL AUTO_INCREMENT,
    public_request_id VARCHAR(36) NULL UNIQUE,
    vendor_id INT NOT NULL,
    item_id INT NOT NULL,
    requested_count INT NOT NULL,
    requested_by_id INT,
    location_id INT,
    request_date DATE NOT NULL DEFAULT (CURDATE()),
    status ENUM('Pending', 'Approved', 'Rejected') NOT NULL DEFAULT 'Pending',

    -- Key definitions and constraints
    PRIMARY KEY (request_id),
    INDEX idx_public_request_id (public_request_id),
    FOREIGN KEY (vendor_id) REFERENCES vendors(vendor_id) ON DELETE CASCADE,
    FOREIGN KEY (item_id) REFERENCES item(item_id) ON DELETE CASCADE,
    FOREIGN KEY (requested_by_id) REFERENCES employee_demographics(employee_id) ON DELETE SET NULL,
    FOREIGN KEY (location_id) REFERENCES location(location_id) ON DELETE SET NULL,
    CONSTRAINT chk_req_count_positive CHECK (requested_count >= 0)
);

-- Table for daily ride usage statistics
CREATE TABLE daily_ride (
    ride_id INT NOT NULL,
    dat_date DATE NOT NULL,
    ride_count INT UNSIGNED DEFAULT 0,
    run_count INT UNSIGNED DEFAULT 0,

    -- Key definitions
    PRIMARY KEY (ride_id , dat_date),
    FOREIGN KEY (ride_id) REFERENCES rides (ride_id),
    FOREIGN KEY (dat_date) REFERENCES daily_stats (date_rec)
);

-- Table to store secure login credentials for members
CREATE TABLE member_auth (
    membership_id INT NOT NULL,
    password_hash VARCHAR(255) NOT NULL,

    -- Key definitions
    PRIMARY KEY (membership_id),
    FOREIGN KEY (membership_id)
        REFERENCES membership (membership_id)
        ON DELETE CASCADE
);

-- Table to store member's saved payment methods
CREATE TABLE member_payment_methods (
    payment_method_id INT NOT NULL AUTO_INCREMENT,
    public_payment_id VARCHAR(36) NULL UNIQUE,
    membership_id INT NOT NULL,
    payment_type ENUM('Card', 'Bank') NOT NULL,
    is_default BOOL NOT NULL DEFAULT FALSE,
    mock_identifier VARCHAR(50),
    mock_expiration VARCHAR(5),

    -- Key definitions
    PRIMARY KEY (payment_method_id),
    INDEX idx_public_payment_id (public_payment_id),
    FOREIGN KEY (membership_id)
        REFERENCES membership (membership_id)
        ON DELETE CASCADE
);

-- Table for tracking member membership purchases/renewals
CREATE TABLE membership_purchase_history (
    purchase_id INT NOT NULL AUTO_INCREMENT,
    public_purchase_id VARCHAR(36) NULL UNIQUE,
    membership_id INT NOT NULL,
    purchase_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    type_id INT NOT NULL,
    type_name_snapshot VARCHAR(50) NOT NULL,
    price_paid DECIMAL(10, 2) NOT NULL,
    purchased_start_date DATE NOT NULL,
    purchased_end_date DATE NOT NULL,
    payment_method_id INT NULL,

    -- Key definitions
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

-- Table for prepaid e-tickets purchased online
CREATE TABLE prepaid_tickets (
    e_ticket_id INT NOT NULL AUTO_INCREMENT,
    purchase_id VARCHAR(50) NOT NULL,
    ticket_code VARCHAR(36) NOT NULL UNIQUE,
    ticket_type_id INT NOT NULL,
    purchase_date DATETIME NOT NULL,
    email VARCHAR(50),
    phone_number VARCHAR(15),
    base_price DECIMAL(10,2) NOT NULL,
    discount_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    is_redeemed BOOL NOT NULL DEFAULT FALSE,
    redeemed_date DATETIME,
    visit_id INT NULL,

    -- Key definitions
    PRIMARY KEY (e_ticket_id),
    FOREIGN KEY (ticket_type_id) REFERENCES ticket_types(ticket_type_id),
    FOREIGN KEY (visit_id) REFERENCES visits(visit_id) ON DELETE SET NULL,
    INDEX idx_purchase_id (purchase_id)
);

-- Trigger logic section begins
DELIMITER $$

-- Trigger to automatically create an inventory request when stock falls below the minimum threshold
DROP TRIGGER IF EXISTS auto_restock $$
CREATE TRIGGER auto_restock
AFTER UPDATE ON inventory
FOR EACH ROW
BEGIN
    DECLARE existing_request_id INT;

    -- Check if stock is below minimum and thresholds are defined
    IF NEW.min_count IS NOT NULL AND NEW.def_count IS NOT NULL AND (NEW.count < NEW.min_count) THEN

        -- Look for an existing pending request for this item at this vendor
        SELECT request_id INTO existing_request_id
        FROM inventory_requests
        WHERE status = 'Pending'
          AND item_id = NEW.item_id
          AND vendor_id = NEW.vendor_id
        LIMIT 1;

        -- Create a new restock request if none is pending
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
                UUID(),
                NEW.vendor_id,
                NEW.item_id,
                (NEW.def_count - NEW.count),
                NULL,
                V.location_id,
                CURDATE(),
                'Pending'
            FROM vendors V
            WHERE V.vendor_id = NEW.vendor_id;

        -- If a pending request exists and stock dropped further, increase the request quantity
        ELSEIF existing_request_id IS NOT NULL AND NEW.count < OLD.count THEN
            UPDATE inventory_requests
            SET requested_count = requested_count + (OLD.count - NEW.count)
            WHERE request_id = existing_request_id;
        END IF;

    END IF;
END$$

-- Trigger to close all rides when a park-closing weather event begins
DROP TRIGGER IF EXISTS weather_closure $$
CREATE TRIGGER weather_closure
AFTER INSERT ON weather_events
FOR EACH ROW
BEGIN
    IF NEW.end_time IS NULL AND NEW.park_closure IS TRUE THEN
        UPDATE rides
        SET ride_status = 'WEATHER CLOSURE'
        WHERE ride_status = 'OPEN';
    END IF;
END$$

-- Trigger to reopen all weather-closed rides when a park-closing event ends
DROP TRIGGER IF EXISTS weather_ended $$
CREATE TRIGGER weather_ended
AFTER UPDATE ON weather_events
FOR EACH ROW
BEGIN
    IF OLD.end_time IS NULL AND NEW.end_time IS NOT NULL AND OLD.park_closure IS TRUE THEN
        UPDATE rides
        SET ride_status = 'OPEN'
        WHERE ride_status = 'WEATHER CLOSURE';
    END IF;
END$$

DELIMITER ;