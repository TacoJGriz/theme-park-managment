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
('Minnie', 'Mouse', 'Female', '(123) 456-7891', 'minnie@park.com', '124 Main St', 'Orlando', 'FL', '32830', '1928-11-18', '2024-01-15', 'Manager', 3, 1, 35.50, TRUE),
('Donald', 'Duck', 'Male', '(123) 456-7892', 'donald@park.com', '125 Main St', 'Orlando', 'FL', '32830', '1934-06-09', '2024-02-01', 'Staff', 1, 2, 18.00, TRUE),
('Daisy', 'Duck', 'Female', '(123) 456-7893', 'daisy@park.com', '126 Main St', 'Orlando', 'FL', '32830', '1940-01-07', '2024-02-15', 'Staff', 4, 1, 19.25, TRUE),
('Goofy', 'Goof', 'Male', '(123) 456-7894', 'goofy@park.com', '127 Main St', 'Orlando', 'FL', '32830', '1932-05-25', '2024-03-01', 'Maintenance', 2, 1, 28.00, TRUE);

-- Update locations with their new managers
UPDATE location SET manager_id = 2, manager_start = '2024-01-15' WHERE location_id = 3;
UPDATE location SET manager_id = 1, manager_start = '2024-01-01' WHERE location_id = 4;

-- 3. EMPLOYEE_AUTH
INSERT INTO employee_auth (employee_id, password_hash) VALUES
(1, '$2b$10$zKGpKcl0uHKA9Tg1GY8Jv.w8T0glQh/v7wFckZTjnyD0hSZJ/gkZu'),
(2, '$2b$10$zKGpKcl0uHKA9Tg1GY8Jv.w8T0glQh/v7wFckZTjnyD0hSZJ/gkZu'),
(3, '$2b$10$zKGpKcl0uHKA9Tg1GY8Jv.w8T0glQh/v7wFckZTjnyD0hSZJ/gkZu'),
(4, '$2b$10$zKGpKcl0uHKA9Tg1GY8Jv.w8T0glQh/v7wFckZTjnyD0hSZJ/gkZu'),
(5, '$2b$10$zKGpKcl0uHKA9Tg1GY8Jv.w8T0glQh/v7wFckZTjnyD0hSZJ/gkZu');

-- 4. RIDES
-- Depends on location
INSERT INTO rides (ride_name, ride_type, ride_status, max_weight, min_height, capacity, location_id) VALUES
('Space Mountain', 'Rollercoaster', 'OPEN', 300, 44, 12, 2),
('Jungle Cruise', 'Water Ride', 'OPEN', 1000, 0, 30, 1),
('Its a Small World', 'Water Ride', 'CLOSED', 1200, 0, 30, 3),
('Thunder Mountain', 'Rollercoaster', 'BROKEN', 300, 40, 30, 1);

-- 5. MAINTENANCE
-- Depends on rides and employees
INSERT INTO maintenance (ride_id, report_date, start_date, end_date, summary, employee_id, cost) VALUES
(4, '2025-10-20', '2025-10-21', NULL, 'Lift chain snapped on hill 2.', 5, NULL),
(3, '2025-10-15', '2025-10-16', '2025-10-18', 'Routine canal cleaning and audio check.', 5, 1500.00);

-- 6. MEMBERSHIP
INSERT INTO membership (first_name, last_name, email, phone_number, date_of_birth, member_type, start_date, end_date) VALUES
('Peter', 'Pan', 'peter@neverland.com', '(555) 123-4567', '1953-02-05', 'Platinum', '2024-05-01', '2025-05-01'),
('Alice', 'Wonder', 'alice@wonderland.com', '(555) 123-4568', '1951-07-26', 'Gold', '2024-06-15', '2025-06-15'),
('John', 'Doe', 'john@gmail.com', '(555) 123-4569', '1990-01-01', 'Individual', '2024-08-01', '2025-08-01');

-- 7. VISITS
-- Some visits are from members, some are single-day tickets (membership_id = NULL)
INSERT INTO visits (membership_id, visit_date, exit_time, ticket_type, ticket_price, discount_amount) VALUES
(1, '2025-10-20 09:05:12', '17:30:00', 'Member', 0.00, 0.00),
(2, '2025-10-20 09:15:00', '16:00:00', 'Member', 0.00, 0.00),
(NULL, '2025-10-20 09:30:00', '18:00:00', 'Adult', 109.00, 0.00),
(NULL, '2025-10-20 09:31:00', '18:00:00', 'Child', 99.00, 0.00);

-- 8. WEATHER_EVENTS
INSERT INTO weather_events (event_date, end_time, weather_type, park_closure) VALUES
('2025-07-15 14:30:00', '2025-07-15 15:15:00', 'Thunderstorm', TRUE),
('2025-10-19 12:00:00', '2025-10-19 14:00:00', 'Rain', FALSE);

-- 9. EVENT_PROMOTIONS
INSERT INTO event_promotions (event_name, event_type, start_date, end_date, discount_percent, summary) VALUES
('Halloween Spooktacular', 'Seasonal', '2025-10-01', '2025-10-31', 15.00, 'Discount on tickets after 4pm.'),
('Winter Wonderland', 'Holiday', '2025-12-01', '2026-01-05', 10.00, 'Holiday-themed event.');

-- 10. DAILY_STATS
-- Depends on visits, but often populated by a trigger or end-of-day job.
INSERT INTO daily_stats (date_rec, visitor_count) VALUES
('2025-10-19', 3200),
('2025-10-20', 4500);

-- 11. VENDORS
-- Depends on location and employees
INSERT INTO vendors (vendor_name, location_id, manager_id) VALUES
('Cosmic Rays Cafe', 2, 2),
('Pecos Bill Cantina', 1, 2),
('The Emporium', 4, 1);

-- 12. ITEM
INSERT INTO item (item_type, item_name, price, summary) VALUES
('Food', 'Cheeseburger', 12.99, '1/3 lb Angus Burger'),
('Food', 'Chicken Tenders', 11.99, '4 Tenders with Fries'),
('Apparel', 'Mickey T-Shirt', 29.99, '100% Cotton T-Shirt'),
('Souvenir', 'Mickey Ears', 24.99, 'Classic Mickey Mouse Ears');

-- 13. INVENTORY
-- Depends on item and vendors
INSERT INTO inventory (item_id, vendor_id, count) VALUES
(1, 1, 200),
(2, 1, 150),
(1, 2, 250),
(3, 3, 500),
(4, 3, 450);

-- 14. DAILY_RIDE
-- Depends on rides and daily_stats
INSERT INTO daily_ride (ride_id, dat_date, ride_count, run_count) VALUES
(1, '2025-10-20', 1200, 100),
(2, '2025-10-20', 900, 30),
(1, '2025-10-19', 1100, 95);

-- 15. EMPLOYEE_RIDE_ASSIGNMENTS
-- Depends on employees and rides
INSERT INTO employee_ride_assignments (employee_id, ride_id, assignment_date, role) VALUES
(3, 2, '2025-10-20', 'Operator'),
(4, 3, '2025-10-20', 'Attendant');