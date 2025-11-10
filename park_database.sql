DROP DATABASE IF EXISTS park_database;
CREATE DATABASE park_database;
USE park_database;

CREATE TABLE employee_demographics (
    employee_id INT NOT NULL AUTO_INCREMENT,
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
    employee_type ENUM('Staff', 'Maintenance', 'Location Manager', 'Park Manager', 'Head of HR', 'HR Staff', 'Admin') NOT NULL,
    location_id INT,
    supervisor_id INT,
    hourly_rate DECIMAL(10, 2),
    is_active BOOL DEFAULT TRUE,
    is_pending_approval BOOL NOT NULL DEFAULT FALSE,
    
    pending_hourly_rate DECIMAL(10, 2) DEFAULT NULL,
    rate_change_requested_by INT DEFAULT NULL,
    
    -- Keys
    PRIMARY KEY (employee_id),
    FOREIGN KEY (supervisor_id) REFERENCES employee_demographics(employee_id),
    
    -- NEW FOREIGN KEY
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

CREATE TABLE location (
    location_id INT NOT NULL AUTO_INCREMENT,
    location_name VARCHAR(50) NOT NULL UNIQUE,
    summary VARCHAR(250),
    manager_id INT,
    manager_start DATE,
    -- keys
    PRIMARY KEY (location_id),
    FOREIGN KEY (manager_id)
        REFERENCES employee_demographics (employee_id)
        ON DELETE SET NULL -- if a manager is deleted, the manager id for the location is Null
);

ALTER TABLE employee_demographics
ADD FOREIGN KEY (location_id) REFERENCES location (location_id);

CREATE TABLE rides (
    ride_id INT NOT NULL AUTO_INCREMENT,
    ride_name VARCHAR(50) NOT NULL,
    ride_type ENUM('Rollercoaster', 'Water Ride', 'Flat Ride', 'Show', 'Other') NOT NULL,
    ride_status ENUM('OPEN', 'CLOSED', 'BROKEN'),
    max_weight INT,
    min_height INT,
    capacity INT,
    location_id INT,
    PRIMARY KEY (ride_id),
    FOREIGN KEY (location_id)
        REFERENCES location (location_id),
    CONSTRAINT chk_weight CHECK (max_weight >= 0),
    CONSTRAINT chk_height CHECK (min_height >= 0),
    CONSTRAINT chk_capacity CHECK (capacity >= 0)
);
    
CREATE TABLE maintenance (
    maintenance_id INT NOT NULL AUTO_INCREMENT,
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
    type_name VARCHAR(50) NOT NULL UNIQUE,
    base_price DECIMAL(10, 2) NOT NULL,
    description VARCHAR(250),
    is_active BOOL NOT NULL DEFAULT TRUE,
    
    PRIMARY KEY (type_id),
    CONSTRAINT chk_base_price_positive CHECK (base_price >= 0)
);

CREATE TABLE membership (
    membership_id INT NOT NULL AUTO_INCREMENT,
    first_name VARCHAR(25) NOT NULL,
    last_name VARCHAR(25) NOT NULL,
    email VARCHAR(50) UNIQUE,
    phone_number VARCHAR(15),
    date_of_birth DATE NOT NULL,
    type_id INT NOT NULL,
    start_date DATE NOT NULL DEFAULT (CURDATE()),
    end_date DATE NOT NULL,
    
    PRIMARY KEY (membership_id),
    
    FOREIGN KEY (type_id) 
        REFERENCES membership_type (type_id)
        ON DELETE RESTRICT,

    CONSTRAINT chk_membership_dates CHECK (end_date > start_date)
);

CREATE TABLE ticket_types (
    ticket_type_id INT NOT NULL AUTO_INCREMENT,
    type_name VARCHAR(50) NOT NULL UNIQUE,
    base_price DECIMAL(10, 2) NOT NULL,
    is_active BOOL NOT NULL DEFAULT TRUE,
    is_member_type BOOL NOT NULL DEFAULT FALSE,
    
    PRIMARY KEY (ticket_type_id),
    CONSTRAINT chk_ticket_price_positive CHECK (base_price >= 0)
);

CREATE TABLE visits (
    visit_id INT NOT NULL AUTO_INCREMENT,
    membership_id INT,
    visit_date DATETIME,
    exit_time TIME,
    ticket_type_id INT NOT NULL,
    ticket_price DECIMAL(10,2),
    discount_amount DECIMAL(10,2),
    logged_by_employee_id INT,
    -- Keys
    PRIMARY KEY (visit_id),
    FOREIGN KEY (membership_id)
        REFERENCES membership (membership_id),
    FOREIGN KEY (ticket_type_id)
        REFERENCES ticket_types(ticket_type_id),
	FOREIGN KEY (logged_by_employee_id)
		REFERENCES employee_demographics(employee_id)
		ON DELETE SET NULL,
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
    vendor_name VARCHAR(100) NOT NULL UNIQUE,
    location_id INT,
    -- keys
    PRIMARY KEY (vendor_id),
    FOREIGN KEY (location_id)
        REFERENCES location (location_id)
        ON DELETE SET NULL
        ON UPDATE CASCADE
    -- REMOVED: Foreign key for manager_id
);

CREATE TABLE item (
    item_id INT NOT NULL AUTO_INCREMENT,
    item_type ENUM('Food', 'Souvenir', 'Apparel', 'Other') NOT NULL,
    item_name VARCHAR(50),
    price DECIMAL(10,2),
    summary VARCHAR(250),
    PRIMARY KEY (item_id),
    CONSTRAINT chk_item_price_positive CHECK (price >= 0)
);

CREATE TABLE inventory (
    item_id INT NOT NULL,
    vendor_id INT NOT NULL,
    count INT,
    PRIMARY KEY (item_id , vendor_id),
    FOREIGN KEY (item_id)
        REFERENCES item (item_id),
    FOREIGN KEY (vendor_id)
        REFERENCES vendors (vendor_id),
    CONSTRAINT chk_count_positive CHECK (count >= 0)
);

CREATE TABLE inventory_requests (
    request_id INT NOT NULL AUTO_INCREMENT,
    vendor_id INT NOT NULL,
    item_id INT NOT NULL,
    requested_count INT NOT NULL,
    requested_by_id INT,
    location_id INT, -- For filtering approvals by Location Manager
    request_date DATE NOT NULL DEFAULT (CURDATE()),
    status ENUM('Pending', 'Approved', 'Rejected') NOT NULL DEFAULT 'Pending',
    
    PRIMARY KEY (request_id),
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
    membership_id INT NOT NULL,
    payment_type ENUM('Card', 'Bank') NOT NULL,
    is_default BOOL NOT NULL DEFAULT FALSE,
    mock_identifier VARCHAR(50) COMMENT 'Stores safe, displayable info like "Visa ending in 4242"',
    mock_expiration VARCHAR(5) COMMENT 'Stores mock MM/YY for cards, NULL for bank',
    
    PRIMARY KEY (payment_method_id),
    FOREIGN KEY (membership_id)
        REFERENCES membership (membership_id)
        ON DELETE CASCADE -- If a member is deleted, their saved payment methods are also deleted
);

CREATE TABLE membership_purchase_history (
    purchase_id INT NOT NULL AUTO_INCREMENT,
    membership_id INT NOT NULL,
    purchase_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    type_id INT NOT NULL,
    type_name_snapshot VARCHAR(50) NOT NULL COMMENT 'Name of the type at time of purchase',
    price_paid DECIMAL(10, 2) NOT NULL,
    purchased_start_date DATE NOT NULL,
    purchased_end_date DATE NOT NULL,
    payment_method_id INT NULL COMMENT 'Which saved payment method was used, if any',
    
    PRIMARY KEY (purchase_id),
    
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