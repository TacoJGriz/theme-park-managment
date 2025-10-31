USE park_database;

-- 1. LOCATION
-- Must be inserted first, as employees and vendors depend on it.
INSERT INTO location (location_name, summary, manager_id, manager_start) VALUES
('Frontierland', 'Wild West themed area', NULL, NULL),
('Tomorrowland', 'Futuristic sci-fi area', NULL, NULL),
('Fantasyland', 'Classic fairytale area', NULL, NULL),
('Park Entrance', 'Main entry plaza and guest services', NULL, NULL);

-- 2. EMPLOYEE_DEMOGRAPHICS
-- We insert employees, then we can update locations with manager_id
INSERT INTO employee_demographics 
(first_name, last_name, gender, phone_number, email, street_address, city, state, zip_code, birth_date, hire_date, employee_type, location_id, supervisor_id, hourly_rate, is_active)
VALUES
('Walt', 'Disney', 'Male', '(123) 456-7890', 'walt@park.com', '123 Main St', 'Orlando', 'FL', '32830', '1901-12-05', '2024-01-01', 'Admin', 4, NULL, 75.00, TRUE),
('Minnie', 'Mouse', 'Female', '(123) 456-7891', 'minnie@park.com', '124 Main St', 'Orlando', 'FL', '32830', '1928-11-18', '2024-01-15', 'Park Manager', 4, 1, 35.50, TRUE),
('Donald', 'Duck', 'Male', '(123) 456-7892', 'donald@park.com', '125 Main St', 'Orlando', 'FL', '32830', '1934-06-09', '2024-02-01', 'Staff', 1, 2, 18.00, TRUE),
('Daisy', 'Duck', 'Female', '(123) 456-7893', 'daisy@park.com', '126 Main St', 'Orlando', 'FL', '32830', '1940-01-07', '2024-02-15', 'Staff', 4, 1, 19.25, TRUE),
('Goofy', 'Goof', 'Male', '(123) 456-7894', 'goofy@park.com', '127 Main St', 'Orlando', 'FL', '32830', '1932-05-25', '2024-03-01', 'Maintenance', 2, 1, 28.00, TRUE),
('Luke', 'Skywalker', 'Male', '(555) 555-5551', 'luke@park.com', '1 Desert Way', 'Orlando', 'FL', '32830', '1977-05-25', '2024-03-05', 'Location Manager', 3, 2, 29.00, TRUE),
('Han', 'Solo', 'Male', '(555) 555-5552', 'han@park.com', '2 Smuggler Run', 'Orlando', 'FL', '32830', '1977-05-25', '2024-03-05', 'Vendor Manager', 4, 2, 27.00, TRUE),
('Scrooge', 'McDuck', 'Male', '(555) 111-2222', 'hr@park.com', '1 Money Bin', 'Orlando', 'FL', '32830', '1947-12-01', '2024-01-10', 'Head of HR', 4, 1, 40.00, TRUE), -- UPDATED ROLE
('Woody', 'Pride', 'Male', '(555) 333-4444', 'woody@park.com', '1 Toy Box', 'Orlando', 'FL', '32830', '1995-11-22', '2024-03-10', 'Location Manager', 1, 2, 29.00, TRUE),
('Morty', 'Fieldmouse', 'Male', '(555) 666-7777', 'morty@park.com', '3 Mouse House', 'Orlando', 'FL', '32830', '1999-10-10', '2024-04-01', 'HR Staff', 4, 8, 25.00, TRUE), -- NEW HR STAFF (reports to Scrooge, ID 8)
('Chip', 'Dale', 'Male', '(555) 888-9999', 'chip@park.com', '1 Treehouse', 'Orlando', 'FL', '32830', '1990-05-15', '2024-04-05', 'Maintenance', 1, 5, 27.50, TRUE); -- NEW MAINTENANCE (reports to Goofy, ID 5)

-- Update locations with their new managers
UPDATE location SET manager_id = 6, manager_start = '2024-03-05' WHERE location_id = 3; -- Luke (ID 6) manages Fantasyland
UPDATE location SET manager_id = 2, manager_start = '2024-01-15' WHERE location_id = 4; -- Minnie (ID 2) manages Park Entrance
UPDATE location SET manager_id = 9, manager_start = '2024-03-10' WHERE location_id = 1; -- Woody (ID 9) manages Frontierland

-- 3. EMPLOYEE_AUTH (All passwords are 'password')
INSERT INTO employee_auth (employee_id, password_hash) VALUES
(1, '$2b$10$zKGpKcl0uHKA9Tg1GY8Jv.w8T0glQh/v7wFckZTjnyD0hSZJ/gkZu'),
(2, '$2b$10$zKGpKcl0uHKA9Tg1GY8Jv.w8T0glQh/v7wFckZTjnyD0hSZJ/gkZu'),
(3, '$2b$10$zKGpKcl0uHKA9Tg1GY8Jv.w8T0glQh/v7wFckZTjnyD0hSZJ/gkZu'),
(4, '$2b$10$zKGpKcl0uHKA9Tg1GY8Jv.w8T0glQh/v7wFckZTjnyD0hSZJ/gkZu'),
(5, '$2b$10$zKGpKcl0uHKA9Tg1GY8Jv.w8T0glQh/v7wFckZTjnyD0hSZJ/gkZu'),
(6, '$2b$10$zKGpKcl0uHKA9Tg1GY8Jv.w8T0glQh/v7wFckZTjnyD0hSZJ/gkZu'),
(7, '$2b$10$zKGpKcl0uHKA9Tg1GY8Jv.w8T0glQh/v7wFckZTjnyD0hSZJ/gkZu'),
(8, '$2b$10$zKGpKcl0uHKA9Tg1GY8Jv.w8T0glQh/v7wFckZTjnyD0hSZJ/gkZu'),
(9, '$2b$10$zKGpKcl0uHKA9Tg1GY8Jv.w8T0glQh/v7wFckZTjnyD0hSZJ/gkZu'),
(10, '$2b$10$zKGpKcl0uHKA9Tg1GY8Jv.w8T0glQh/v7wFckZTjnyD0hSZJ/gkZu'), -- NEW (Morty)
(11, '$2b$10$zKGpKcl0uHKA9Tg1GY8Jv.w8T0glQh/v7wFckZTjnyD0hSZJ/gkZu'); -- NEW (Chip)

-- 4. RIDES
-- Depends on location
INSERT INTO rides (ride_name, ride_type, ride_status, max_weight, min_height, capacity, location_id) VALUES
('Space Mountain', 'Rollercoaster', 'OPEN', 300, 44, 12, 2),
('Jungle Cruise', 'Water Ride', 'OPEN', 1000, 0, 30, 1),
('Its a Small World', 'Water Ride', 'CLOSED', 1200, 0, 30, 3),
('Thunder Mountain', 'Rollercoaster', 'BROKEN', 300, 40, 30, 1),
('Main Street Trolley', 'Other', 'OPEN', 2000, 0, 40, 4);

-- 5. MAINTENANCE
-- Depends on rides and employees
INSERT INTO maintenance (ride_id, report_date, start_date, end_date, summary, employee_id, cost) VALUES
(4, '2025-10-20', '2025-10-21', NULL, 'Lift chain snapped on hill 2.', 5, NULL),
(3, '2025-10-15', '2025-10-16', '2025-10-18', 'Routine canal cleaning and audio check.', 5, 1500.00);

-- 6. MEMBERSHIP_TYPE
-- Must be inserted before MEMBERSHIP
INSERT INTO membership_type (type_name, base_price, description, is_active) VALUES
('Platinum', 799.00, 'All access pass with perks', TRUE),
('Gold', 599.00, 'Standard annual pass', TRUE),
('Individual', 399.00, 'Single person annual pass', TRUE),
('Family', 1299.00, 'Covers 2 adults and 2 children', TRUE),
('Founders Club', 299.00, 'Legacy pass, no longer available for new signups', FALSE); -- For testing 'is_active'

-- 7. MEMBERSHIP
-- Now depends on membership_type
-- Note: 'Platinum' is type_id 1, 'Gold' is 2, 'Individual' is 3
INSERT INTO membership (first_name, last_name, email, phone_number, date_of_birth, type_id, start_date, end_date) VALUES
('Peter', 'Pan', 'peter@neverland.com', '(555) 123-4567', '1953-02-05', 1, '2024-05-01', '2025-05-01'),
('Alice', 'Wonder', 'alice@wonderland.com', '(555) 123-4568', '1951-07-26', 2, '2024-06-15', '2025-06-15'),
('John', 'Doe', 'john@gmail.com', '(555) 123-4569', '1990-01-01', 3, '2024-08-01', '2025-08-01');

-- --- BEGIN PHASE 1 CHANGES ---

-- 8. POPULATE THE NEW TICKET_TYPES TABLE
-- This is the "initial data" for the table.
INSERT INTO ticket_types (type_name, base_price, is_active, is_member_type) VALUES
('Member', 0.00, TRUE, TRUE),    -- ID 1
('Adult', 109.00, TRUE, FALSE),   -- ID 2
('Child', 99.00, TRUE, FALSE),    -- ID 3
('Senior', 89.00, TRUE, FALSE);   -- ID 4

-- 9. VISITS (MODIFIED)
-- Assumes IDs from above: 1='Member', 2='Adult', 3='Child'
INSERT INTO visits (membership_id, visit_date, exit_time, ticket_type_id, ticket_price, discount_amount) VALUES
(1, '2025-10-20 09:05:12', '17:30:00', 1, 0.00, 0.00),
(2, '2025-10-20 09:15:00', '16:00:00', 1, 0.00, 0.00),
(NULL, '2025-10-20 09:30:00', '18:00:00', 2, 109.00, 0.00),
(NULL, '2025-10-20 09:31:00', '18:00:00', 3, 99.00, 0.00),
(NULL, '2025-10-25 16:15:00', '21:00:00', 2, 109.00, 16.35); -- NEW (Adult ticket on 10/25, 15% discount of 16.35)

-- 10. WEATHER_EVENTS
INSERT INTO weather_events (event_date, end_time, weather_type, park_closure) VALUES
('2025-07-15 14:30:00', '2025-07-15 15:15:00', 'Thunderstorm', TRUE),
('2025-10-19 12:00:00', '2025-10-19 14:00:00', 'Rain', FALSE),
('2025-08-01 13:00:00', NULL, 'Heatwave', FALSE); -- NEW

-- 11. EVENT_PROMOTIONS
INSERT INTO event_promotions (event_name, event_type, start_date, end_date, discount_percent, summary) VALUES
('Halloween Spooktacular', 'Seasonal', '2025-10-01', '2025-10-31', 15.00, 'Discount on tickets after 4pm.'),
('Winter Wonderland', 'Holiday', '2025-12-01', '2026-01-05', 10.00, 'Holiday-themed event.');

-- 12. DAILY_STATS
-- Depends on visits, but often populated by a trigger or end-of-day job.
INSERT INTO daily_stats (date_rec, visitor_count) VALUES
('2025-07-15', 1200),
('2025-08-01', 3800),
('2025-10-19', 3200),
('2025-10-20', 4500),
('2025-10-25', 5100);

-- 13. VENDORS
-- Depends on location and employees
INSERT INTO vendors (vendor_name, location_id, manager_id) VALUES
('Cosmic Rays Cafe', 2, 7), -- Han (ID 7) manages
('Pecos Bill Cantina', 1, 7), -- Han (ID 7) manages
('The Emporium', 4, 1), -- Walt (Admin) manages
('Sir Mickeys', 3, 7); -- Han (ID 7) also manages this

-- 14. ITEM
INSERT INTO item (item_type, item_name, price, summary) VALUES
('Food', 'Cheeseburger', 12.99, '1/3 lb Angus Burger'),
('Food', 'Chicken Tenders', 11.99, '4 Tenders with Fries'),
('Apparel', 'Mickey T-Shirt', 29.99, '100% Cotton T-Shirt'),
('Souvenir', 'Mickey Ears', 24.99, 'Classic Mickey Mouse Ears'),
('Other', 'Poncho', 10.00, 'Plastic rain poncho'); -- NEW

-- 15. INVENTORY
-- Depends on item and vendors
INSERT INTO inventory (item_id, vendor_id, count) VALUES
(1, 1, 200),
(2, 1, 150),
(1, 2, 250),
(3, 3, 500),
(4, 3, 450),
(3, 4, 300),
(4, 4, 350),
(5, 3, 1000), -- NEW (Ponchos at The Emporium)
(5, 4, 500);  -- NEW (Ponchos at Sir Mickeys)

-- 16. DAILY_RIDE
-- Depends on rides and daily_stats
INSERT INTO daily_ride (ride_id, dat_date, ride_count, run_count) VALUES
(1, '2025-10-20', 1200, 100),
(2, '2025-10-20', 900, 30),
(1, '2025-10-19', 1100, 95);

-- 17. EMPLOYEE_RIDE_ASSIGNMENTS
-- Depends on employees and rides
INSERT INTO employee_ride_assignments (employee_id, ride_id, assignment_date, role) VALUES
(3, 2, '2025-10-20', 'Operator'),
(4, 3, '2025-10-20', 'Attendant');

-- 18. ADD PENDING REQUESTS FOR APPROVAL DEMO
-- Create pending records that require manager/admin approval
-- Pay raise requested for Donald (ID 3) by Morty (HR Staff, ID 10)
UPDATE employee_demographics
SET pending_hourly_rate = 19.50, rate_change_requested_by = 10
WHERE employee_id = 3;

-- Maintenance reassignment requested for Thunder Mountain (Maint ID 1) to Chip (ID 11) by Goofy (ID 5)
UPDATE maintenance
SET pending_employee_id = 11, assignment_requested_by = 5
WHERE maintenance_id = 1;