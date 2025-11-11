-- 1. LOCATION
-- Must be inserted first, as employees and vendors depend on it.
INSERT INTO location (location_name, summary, manager_id, manager_start) VALUES
('Frontierland', 'Wild West themed area', NULL, NULL),
('Tomorrowland', 'Futuristic sci-fi area', NULL, NULL),
('Fantasyland', 'Classic fairytale area', NULL, NULL),
('Park Entrance', 'Main entry plaza and guest services', NULL, NULL);

-- 2. EMPLOYEE_DEMOGRAPHICS
-- Han Solo (ID 7) changed from 'Vendor Manager' to 'Staff'
INSERT INTO employee_demographics 
(first_name, last_name, gender, phone_number, email, street_address, city, state, zip_code, birth_date, hire_date, employee_type, location_id, supervisor_id, hourly_rate, is_active)
VALUES
('Walt', 'Disney', 'Male', '(123) 456-7890', 'walt@park.com', '123 Main St', 'Orlando', 'FL', '32830', '1901-12-05', '2024-01-01', 'Admin', 4, NULL, 75.00, TRUE),
('Minnie', 'Mouse', 'Female', '(123) 456-7891', 'minnie@park.com', '124 Main St', 'Orlando', 'FL', '32830', '1928-11-18', '2024-01-15', 'Park Manager', 4, 1, 35.50, TRUE),
('Donald', 'Duck', 'Male', '(123) 456-7892', 'donald@park.com', '125 Main St', 'Orlando', 'FL', '32830', '1934-06-09', '2024-02-01', 'Staff', 1, 2, 18.00, TRUE),
('Daisy', 'Duck', 'Female', '(123) 456-7893', 'daisy@park.com', '126 Main St', 'Orlando', 'FL', '32830', '1940-01-07', '2024-02-15', 'Staff', 4, 1, 19.25, TRUE),
('Goofy', 'Goof', 'Male', '(123) 456-7894', 'goofy@park.com', '127 Main St', 'Orlando', 'FL', '32830', '1932-05-25', '2024-03-01', 'Maintenance', 2, 1, 28.00, TRUE),
('Luke', 'Skywalker', 'Male', '(555) 555-5551', 'luke@park.com', '1 Desert Way', 'Orlando', 'FL', '32830', '1977-05-25', '2024-03-05', 'Location Manager', 3, 2, 29.00, TRUE),
('Han', 'Solo', 'Male', '(555) 555-5552', 'han@park.com', '2 Smuggler Run', 'Orlando', 'FL', '32830', '1977-05-25', '2024-03-05', 'Staff', 4, 2, 27.00, TRUE), -- UPDATED: Now 'Staff'
('Scrooge', 'McDuck', 'Male', '(555) 111-2222', 'hr@park.com', '1 Money Bin', 'Orlando', 'FL', '32830', '1947-12-01', '2024-01-10', 'Head of HR', 4, 1, 40.00, TRUE),
('Woody', 'Pride', 'Male', '(555) 333-4444', 'woody@park.com', '1 Toy Box', 'Orlando', 'FL', '32830', '1995-11-22', '2024-03-10', 'Location Manager', 1, 2, 29.00, TRUE),
('Morty', 'Fieldmouse', 'Male', '(555) 666-7777', 'morty@park.com', '3 Mouse House', 'Orlando', 'FL', '32830', '1999-10-10', '2024-04-01', 'HR Staff', 4, 8, 25.00, TRUE), 
('Chip', 'Dale', 'Male', '(555) 888-9999', 'chip@park.com', '1 Treehouse', 'Orlando', 'FL', '32830', '1990-05-15', '2024-04-05', 'Maintenance', 1, 5, 27.50, TRUE); 

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
(10, '$2b$10$zKGpKcl0uHKA9Tg1GY8Jv.w8T0glQh/v7wFckZTjnyD0hSZJ/gkZu'),
(11, '$2b$10$zKGpKcl0uHKA9Tg1GY8Jv.w8T0glQh/v7wFckZTjnyD0hSZJ/gkZu');

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
-- UPDATED to include base_members and additional_member_price
INSERT INTO membership_type 
(type_name, base_price, base_members, additional_member_price, description, is_active) 
VALUES
('Platinum', 799.00, 1, NULL, 'All-access individual pass with perks.', TRUE),
('Gold', 599.00, 1, NULL, 'Standard individual annual pass.', TRUE),
('Individual', 399.00, 1, NULL, 'Basic annual pass for one person.', TRUE),
('Family', 798.00, 2, 249.00, 'Flexible pass for 2 members. Add additional family members at a discount.', TRUE),
('Founders Club', 299.00, 1, NULL, 'Legacy pass, no longer available for new signups.', FALSE);

-- 7. MEMBERSHIP (REMOVED: Data generated by GenerateMembers procedure)

-- 8. POPULATE THE NEW TICKET_TYPES TABLE
INSERT INTO ticket_types (type_name, base_price, is_active, is_member_type) VALUES
('Member', 0.00, TRUE, TRUE),    
('Adult', 109.00, TRUE, FALSE),   
('Child', 99.00, TRUE, FALSE),    
('Senior', 89.00, TRUE, FALSE);   

-- 9. VISITS (REMOVED: Data generated by GenerateVisits procedure)

-- 10. WEATHER_EVENTS
INSERT INTO weather_events (event_date, end_time, weather_type, park_closure) VALUES
('2025-07-15 14:30:00', '2025-07-15 15:15:00', 'Thunderstorm', TRUE),
('2025-10-19 12:00:00', '2025-10-19 14:00:00', 'Rain', FALSE),
('2025-08-01 13:00:00', NULL, 'Heatwave', FALSE);

-- 11. EVENT_PROMOTIONS
INSERT INTO event_promotions (event_name, event_type, start_date, end_date, discount_percent, summary) VALUES
('Halloween Spooktacular', 'Seasonal', '2025-10-01', '2025-10-31', 15.00, 'Discount on tickets after 4pm.'),
('Winter Wonderland', 'Holiday', '2025-12-01', '2026-01-05', 10.00, 'Holiday-themed event.');

-- 12. DAILY_STATS (REMOVED: Handled by park_database_dummy_attendance.sql)

-- 13. VENDORS
-- REMOVED manager_id column from INSERT statement
INSERT INTO vendors (vendor_name, location_id) VALUES
('Cosmic Rays Cafe', 2),
('Pecos Bill Cantina', 1),
('The Emporium', 4),
('Sir Mickeys', 3);

-- 14. ITEM
INSERT INTO item (item_type, item_name, price, summary) VALUES
('Food', 'Cheeseburger', 12.99, '1/3 lb Angus Burger'),
('Food', 'Chicken Tenders', 11.99, '4 Tenders with Fries'),
('Apparel', 'Mickey T-Shirt', 29.99, '100% Cotton T-Shirt'),
('Souvenir', 'Mickey Ears', 24.99, 'Classic Mickey Mouse Ears'),
('Other', 'Poncho', 10.00, 'Plastic rain poncho');

-- 15. INVENTORY
INSERT INTO inventory (item_id, vendor_id, count) VALUES
(1, 1, 200),
(2, 1, 150),
(1, 2, 250),
(3, 3, 500),
(4, 3, 450),
(3, 4, 300),
(4, 4, 350),
(5, 3, 1000), 
(5, 4, 500);  

-- 16. DAILY_RIDE (REMOVED: Handled by park_database_dummy_ridelogs.sql)

-- 17. ADD PENDING REQUESTS FOR APPROVAL DEMO
UPDATE employee_demographics
SET pending_hourly_rate = 19.50, rate_change_requested_by = 10
WHERE employee_id = 3;

-- Maintenance reassignment requested for Thunder Mountain (Maint ID 1) to Chip (ID 11) by Goofy (ID 5)
UPDATE maintenance
SET pending_employee_id = 11, assignment_requested_by = 5
WHERE maintenance_id = 1;

-- 18. ADD PENDING INVENTORY REQUESTS FOR APPROVAL DEMO ***
INSERT INTO inventory_requests (vendor_id, item_id, requested_count, requested_by_id, location_id, request_date, status)
VALUES
-- Request 1: From Han Solo (Staff, ID 7) for The Emporium (Vendor 3, Location 4)
(3, 4, 200, 7, 4, '2025-10-25', 'Pending'),
-- Request 2: From Donald Duck (Staff, ID 3) for Pecos Bill (Vendor 2, Location 1)
(2, 1, 500, 3, 1, '2025-10-24', 'Pending');