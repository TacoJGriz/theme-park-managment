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
    employee_type ENUM('Staff', 'Maintenance', 'Location Manager', 'Vendor Manager', 'Park Manager', 'Head of HR', 'HR Staff', 'Admin') NOT NULL,
    location_id INT,
    supervisor_id INT,
    hourly_rate DECIMAL(10, 2),
    is_active BOOL DEFAULT TRUE,
    is_pending_approval BOOL NOT NULL DEFAULT FALSE,
    -- Keys
    PRIMARY KEY (employee_id),
    FOREIGN KEY (supervisor_id) REFERENCES employee_demographics(employee_id),
    -- Constraints
    CONSTRAINT chk_dates CHECK (termination_date IS NULL OR termination_date >= hire_date), -- force termination date to be not null for active employees, OR if terminated, the termination date must be after hire date
    CONSTRAINT chk_hire_age CHECK (hire_date >= DATE_ADD(birth_date, INTERVAL 16 YEAR)), -- force employeees to be at least 16 years old (no child labor allowed)
    CONSTRAINT chk_rate_positive CHECK (hourly_rate >= 0) -- force pay to not be negative 
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
    -- Keys
    PRIMARY KEY (maintenance_id),
    FOREIGN KEY (ride_id)
        REFERENCES rides (ride_id)
        ON DELETE CASCADE,
	FOREIGN KEY (employee_id)
        REFERENCES employee_demographics (employee_id)
        ON DELETE SET NULL,
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
    ticket_type_id INT NOT NULL,  -- MODIFIED: Replaced ENUM
    ticket_price DECIMAL(10,2),
    discount_amount DECIMAL(10,2),
    -- Keys
    PRIMARY KEY (visit_id),
    FOREIGN KEY (membership_id)
        REFERENCES membership (membership_id),
    FOREIGN KEY (ticket_type_id)      -- NEW: Foreign key
        REFERENCES ticket_types(ticket_type_id),
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
    manager_id INT,
    -- keys
    PRIMARY KEY (vendor_id),
    FOREIGN KEY (location_id)
        REFERENCES location (location_id)
        ON DELETE SET NULL
        ON UPDATE CASCADE,
    FOREIGN KEY (manager_id)
        REFERENCES employee_demographics (employee_id)
        ON DELETE SET NULL
        ON UPDATE CASCADE
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

CREATE TABLE daily_ride (
    ride_id INT NOT NULL,
    dat_date DATE NOT NULL,
    ride_count INT UNSIGNED DEFAULT 0,
    run_count INT UNSIGNED DEFAULT 0,
    -- keys
    PRIMARY KEY (ride_id , dat_date),
    FOREIGN KEY (ride_id) REFERENCES rides (ride_id),
    FOREIGN KEY (dat_date) REFERENCES daily_stats (date_rec),
    -- constraints
    CONSTRAINT chk_ride_count_positive CHECK (ride_count >= 0),
    CONSTRAINT chk_run_count_positive CHECK (run_count >= 0)
);

CREATE TABLE employee_ride_assignments (
    assignment_id INT NOT NULL AUTO_INCREMENT, -- Simple key for editing/deleting
    employee_id INT NOT NULL,
    ride_id INT NOT NULL,
    assignment_date DATE NOT NULL,
    role VARCHAR(50), -- Optional: e.g., 'Operator', 'Attendant'
    -- Keys
    PRIMARY KEY (assignment_id),
    UNIQUE KEY uk_employee_per_day (employee_id, assignment_date),
    FOREIGN KEY (employee_id) 
        REFERENCES employee_demographics(employee_id) 
        ON DELETE CASCADE,
    FOREIGN KEY (ride_id) 
        REFERENCES rides(ride_id) 
        ON DELETE CASCADE
);

CREATE TABLE zone_entry (
    visit_id INT NOT NULL,
    location_id INT NOT NULL,
    entry_time DATETIME NOT NULL,
    -- Keys
    PRIMARY KEY (visit_id, location_id),
    FOREIGN KEY (visit_id) 
        REFERENCES visits (visit_id)
        ON DELETE CASCADE,
	-- Constraints
    FOREIGN KEY (location_id) 
        REFERENCES location (location_id)
        ON DELETE RESTRICT
);