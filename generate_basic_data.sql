-- 1. LOCATION
-- Inserting 8 Locations first.
-- ADDED public_location_id and UUID()
INSERT INTO location (public_location_id, location_name, summary, manager_id, manager_start) VALUES
(UUID(), 'Frontierland', 'Wild West themed area with rugged terrain.', NULL, NULL),      -- ID 1
(UUID(), 'Tomorrowland', 'A view of the future and sci-fi adventures.', NULL, NULL),      -- ID 2
(UUID(), 'Fantasyland', 'Where classic fairytales come to life.', NULL, NULL),            -- ID 3
(UUID(), 'Main Entrance', 'The grand entry plaza and guest services.', NULL, NULL),       -- ID 4 (Renamed)
(UUID(), 'Adventureland', 'Exotic jungles and swashbuckling pirates.', NULL, NULL),       -- ID 5
(UUID(), 'Liberty Square', 'Colonial America history and haunts.', NULL, NULL),           -- ID 6
(UUID(), 'Mickeys Toontown', 'The wacky home of cartoon stars.', NULL, NULL),            -- ID 7
(UUID(), 'Galaxys Edge', 'Remote outpost on the edge of space.', NULL, NULL);            -- ID 8

-- 2. EMPLOYEE_DEMOGRAPHICS
-- Total: 55 Employees

-- A. Admin & Park Manager (IDs 1-2)
INSERT INTO employee_demographics (public_employee_id, first_name, last_name, gender, phone_number, email, street_address, city, state, zip_code, birth_date, hire_date, employee_type, location_id, supervisor_id, hourly_rate, is_active) VALUES
(UUID(), 'Walt', 'Disney', 'Male', '(407) 555-0100', 'walt@park.com', '1 Dream Way', 'Orlando', 'FL', '32830', '1901-12-05', '1971-10-01', 'Admin', 4, NULL, 100.00, TRUE),
(UUID(), 'Minnie', 'Mouse', 'Female', '(407) 555-0101', 'minnie@park.com', '2 Bow Lane', 'Orlando', 'FL', '32830', '1928-11-18', '2020-01-01', 'Park Manager', 4, 1, 65.00, TRUE);

-- B. Location Managers (IDs 3-10)
-- One for each location ID 1-8. Supervisor is Park Manager (ID 2).
INSERT INTO employee_demographics (public_employee_id, first_name, last_name, gender, phone_number, email, street_address, city, state, zip_code, birth_date, hire_date, employee_type, location_id, supervisor_id, hourly_rate, is_active) VALUES
(UUID(), 'Woody', 'Pride', 'Male', '(407) 555-0111', 'woody@park.com', '1 Toy Box', 'Orlando', 'FL', '32830', '1995-11-22', '2021-03-15', 'Location Manager', 1, 2, 45.00, TRUE), -- Frontierland
(UUID(), 'Buzz', 'Lightyear', 'Male', '(407) 555-0112', 'buzz@park.com', '1 Star Command', 'Orlando', 'FL', '32830', '1995-11-22', '2021-03-15', 'Location Manager', 2, 2, 45.00, TRUE), -- Tomorrowland
(UUID(), 'Cinderella', 'Charming', 'Female', '(407) 555-0113', 'cindy@park.com', '1 Castle Dr', 'Orlando', 'FL', '32830', '1950-02-15', '2019-06-01', 'Location Manager', 3, 2, 48.00, TRUE), -- Fantasyland
(UUID(), 'Mickey', 'Mouse', 'Male', '(407) 555-0114', 'mickey@park.com', '1 Main St', 'Orlando', 'FL', '32830', '1928-11-18', '2018-01-01', 'Location Manager', 4, 2, 55.00, TRUE), -- Main Entrance
(UUID(), 'Jack', 'Sparrow', 'Male', '(407) 555-0115', 'jack@park.com', '1 Black Pearl', 'Orlando', 'FL', '32830', '2003-07-09', '2022-05-20', 'Location Manager', 5, 2, 42.00, TRUE), -- Adventureland
(UUID(), 'Ichabod', 'Crane', 'Male', '(407) 555-0116', 'ichabod@park.com', '1 Hollow Rd', 'Orlando', 'FL', '32830', '1949-10-05', '2020-10-31', 'Location Manager', 6, 2, 40.00, TRUE), -- Liberty Square
(UUID(), 'Roger', 'Rabbit', 'Male', '(407) 555-0117', 'roger@park.com', '1 Toon Sq', 'Orlando', 'FL', '32830', '1988-06-22', '2023-01-15', 'Location Manager', 7, 2, 38.00, TRUE), -- Toontown
(UUID(), 'Leia', 'Organa', 'Female', '(407) 555-0118', 'leia@park.com', '1 Rebel Base', 'Orlando', 'FL', '32830', '1977-05-25', '2019-12-20', 'Location Manager', 8, 2, 50.00, TRUE); -- Galaxys Edge

-- C. Maintenance Staff (IDs 11-15)
-- Park-wide jurisdiction, Supervisor is Park Manager (ID 2).
INSERT INTO employee_demographics (public_employee_id, first_name, last_name, gender, phone_number, email, street_address, city, state, zip_code, birth_date, hire_date, employee_type, location_id, supervisor_id, hourly_rate, is_active) VALUES
(UUID(), 'Goofy', 'Goof', 'Male', '(407) 555-0201', 'goofy@park.com', '123 Fixit Ln', 'Orlando', 'FL', '32830', '1932-05-25', '2015-04-01', 'Maintenance', 4, 2, 30.00, TRUE),
(UUID(), 'Felix', 'Fixit', 'Male', '(407) 555-0202', 'felix@park.com', '8 Bit Ave', 'Orlando', 'FL', '32830', '1990-11-02', '2018-08-15', 'Maintenance', 4, 2, 28.00, TRUE),
(UUID(), 'Manny', 'Garcia', 'Male', '(407) 555-0203', 'manny@park.com', '1 Tool Box', 'Orlando', 'FL', '32830', '1995-09-16', '2021-02-10', 'Maintenance', 4, 2, 27.00, TRUE),
(UUID(), 'Bob', 'Builder', 'Male', '(407) 555-0204', 'bob@park.com', '5 Construct Rd', 'Orlando', 'FL', '32830', '1998-11-28', '2022-11-05', 'Maintenance', 4, 2, 26.50, TRUE),
(UUID(), 'Doc', 'McStuffins', 'Female', '(407) 555-0205', 'doc@park.com', '9 Clinic Dr', 'Orlando', 'FL', '32830', '1995-03-23', '2023-06-01', 'Maintenance', 4, 2, 29.00, TRUE);

-- D. Staff (IDs 16-55)
-- 5 Staff per location. Assigned to their Location Manager (IDs 3-10).
INSERT INTO employee_demographics (public_employee_id, first_name, last_name, gender, phone_number, email, street_address, city, state, zip_code, birth_date, hire_date, employee_type, location_id, supervisor_id, hourly_rate, is_active) VALUES
-- Frontierland (Manager: Woody ID 3)
(UUID(), 'Jessie', 'Yodeling', 'Female', '(555) 001-0001', 'jessie@park.com', 'Addr 1', 'Orlando', 'FL', '32830', '1999-01-01', '2024-01-01', 'Staff', 1, 3, 18.00, TRUE),
(UUID(), 'Bullseye', 'Horse', 'Male', '(555) 001-0002', 'bullseye@park.com', 'Addr 2', 'Orlando', 'FL', '32830', '1999-02-01', '2024-01-01', 'Staff', 1, 3, 18.00, TRUE),
(UUID(), 'Stinky', 'Pete', 'Male', '(555) 001-0003', 'pete@park.com', 'Addr 3', 'Orlando', 'FL', '32830', '1980-03-01', '2024-01-01', 'Staff', 1, 3, 18.00, TRUE),
(UUID(), 'Davy', 'Crockett', 'Male', '(555) 001-0004', 'davy@park.com', 'Addr 4', 'Orlando', 'FL', '32830', '1995-04-01', '2024-01-01', 'Staff', 1, 3, 18.00, TRUE),
(UUID(), 'Pocahontas', 'Powhatan', 'Female', '(555) 001-0005', 'poca@park.com', 'Addr 5', 'Orlando', 'FL', '32830', '1995-05-01', '2024-01-01', 'Staff', 1, 3, 18.00, TRUE),

-- Tomorrowland (Manager: Buzz ID 4)
(UUID(), 'Zurg', 'Emperor', 'Male', '(555) 002-0001', 'zurg@park.com', 'Addr 6', 'Orlando', 'FL', '32830', '1999-06-01', '2024-01-01', 'Staff', 2, 4, 18.00, TRUE),
(UUID(), 'Wall', 'E', 'Male', '(555) 002-0002', 'walle@park.com', 'Addr 7', 'Orlando', 'FL', '32830', '2000-07-01', '2024-01-01', 'Staff', 2, 4, 18.00, TRUE), -- Adjusted to 2000
(UUID(), 'Eve', 'Probe', 'Female', '(555) 002-0003', 'eve@park.com', 'Addr 8', 'Orlando', 'FL', '32830', '2000-08-01', '2024-01-01', 'Staff', 2, 4, 18.00, TRUE), -- Adjusted to 2000
(UUID(), 'Stitch', 'Experiment', 'Male', '(555) 002-0004', 'stitch@park.com', 'Addr 9', 'Orlando', 'FL', '32830', '2002-09-01', '2024-01-01', 'Staff', 2, 4, 18.00, TRUE),
(UUID(), 'Tron', 'Program', 'Male', '(555) 002-0005', 'tron@park.com', 'Addr 10', 'Orlando', 'FL', '32830', '1982-10-01', '2024-01-01', 'Staff', 2, 4, 18.00, TRUE),

-- Fantasyland (Manager: Cinderella ID 5)
(UUID(), 'Snow', 'White', 'Female', '(555) 003-0001', 'snow@park.com', 'Addr 11', 'Orlando', 'FL', '32830', '1937-11-01', '2024-01-01', 'Staff', 3, 5, 18.00, TRUE),
(UUID(), 'Aurora', 'Rose', 'Female', '(555) 003-0002', 'aurora@park.com', 'Addr 12', 'Orlando', 'FL', '32830', '1959-12-01', '2024-01-01', 'Staff', 3, 5, 18.00, TRUE),
(UUID(), 'Belle', 'French', 'Female', '(555) 003-0003', 'belle@park.com', 'Addr 13', 'Orlando', 'FL', '32830', '1991-01-01', '2024-01-01', 'Staff', 3, 5, 18.00, TRUE),
(UUID(), 'Ariel', 'Triton', 'Female', '(555) 003-0004', 'ariel@park.com', 'Addr 14', 'Orlando', 'FL', '32830', '1989-02-01', '2024-01-01', 'Staff', 3, 5, 18.00, TRUE),
(UUID(), 'Peter', 'Pan', 'Male', '(555) 003-0005', 'peter@park.com', 'Addr 15', 'Orlando', 'FL', '32830', '1953-03-01', '2024-01-01', 'Staff', 3, 5, 18.00, TRUE),

-- Main Entrance (Manager: Mickey ID 6)
(UUID(), 'Donald', 'Duck', 'Male', '(555) 004-0001', 'donald@park.com', 'Addr 16', 'Orlando', 'FL', '32830', '1934-04-01', '2024-01-01', 'Staff', 4, 6, 18.00, TRUE),
(UUID(), 'Daisy', 'Duck', 'Female', '(555) 004-0002', 'daisy@park.com', 'Addr 17', 'Orlando', 'FL', '32830', '1940-05-01', '2024-01-01', 'Staff', 4, 6, 18.00, TRUE),
(UUID(), 'Pluto', 'Pup', 'Male', '(555) 004-0003', 'pluto@park.com', 'Addr 18', 'Orlando', 'FL', '32830', '1930-06-01', '2024-01-01', 'Staff', 4, 6, 18.00, TRUE),
(UUID(), 'Clarabelle', 'Cow', 'Female', '(555) 004-0004', 'clarabelle@park.com', 'Addr 19', 'Orlando', 'FL', '32830', '1928-07-01', '2024-01-01', 'Staff', 4, 6, 18.00, TRUE),
(UUID(), 'Horace', 'Horsecollar', 'Male', '(555) 004-0005', 'horace@park.com', 'Addr 20', 'Orlando', 'FL', '32830', '1929-08-01', '2024-01-01', 'Staff', 4, 6, 18.00, TRUE),

-- Adventureland (Manager: Jack ID 7)
(UUID(), 'Will', 'Turner', 'Male', '(555) 005-0001', 'will@park.com', 'Addr 21', 'Orlando', 'FL', '32830', '2003-09-01', '2024-01-01', 'Staff', 5, 7, 18.00, TRUE),
(UUID(), 'Elizabeth', 'Swann', 'Female', '(555) 005-0002', 'liz@park.com', 'Addr 22', 'Orlando', 'FL', '32830', '2003-10-01', '2024-01-01', 'Staff', 5, 7, 18.00, TRUE),
(UUID(), 'Aladdin', 'Streetrat', 'Male', '(555) 005-0003', 'aladdin@park.com', 'Addr 23', 'Orlando', 'FL', '32830', '1992-11-01', '2024-01-01', 'Staff', 5, 7, 18.00, TRUE),
(UUID(), 'Jasmine', 'Sultan', 'Female', '(555) 005-0004', 'jasmine@park.com', 'Addr 24', 'Orlando', 'FL', '32830', '1992-12-01', '2024-01-01', 'Staff', 5, 7, 18.00, TRUE),
(UUID(), 'Moana', 'Waialiki', 'Female', '(555) 005-0005', 'moana@park.com', 'Addr 25', 'Orlando', 'FL', '32830', '2000-01-01', '2024-01-01', 'Staff', 5, 7, 18.00, TRUE), -- Adjusted to 2000

-- Liberty Square (Manager: Ichabod ID 8)
(UUID(), 'Sam', 'Eagle', 'Male', '(555) 006-0001', 'sam@park.com', 'Addr 26', 'Orlando', 'FL', '32830', '1976-02-01', '2024-01-01', 'Staff', 6, 8, 18.00, TRUE),
(UUID(), 'Betsy', 'Ross', 'Female', '(555) 006-0002', 'betsy@park.com', 'Addr 27', 'Orlando', 'FL', '32830', '1776-03-01', '2024-01-01', 'Staff', 6, 8, 18.00, TRUE),
(UUID(), 'Paul', 'Revere', 'Male', '(555) 006-0003', 'paul@park.com', 'Addr 28', 'Orlando', 'FL', '32830', '1775-04-01', '2024-01-01', 'Staff', 6, 8, 18.00, TRUE),
(UUID(), 'Constance', 'Hatchaway', 'Female', '(555) 006-0004', 'constance@park.com', 'Addr 29', 'Orlando', 'FL', '32830', '1969-05-01', '2024-01-01', 'Staff', 6, 8, 18.00, TRUE),
(UUID(), 'Ezra', 'Ghost', 'Male', '(555) 006-0005', 'ezra@park.com', 'Addr 30', 'Orlando', 'FL', '32830', '1969-06-01', '2024-01-01', 'Staff', 6, 8, 18.00, TRUE),

-- Toontown (Manager: Roger ID 9)
(UUID(), 'Jessica', 'Rabbit', 'Female', '(555) 007-0001', 'jessica@park.com', 'Addr 31', 'Orlando', 'FL', '32830', '1988-07-01', '2024-01-01', 'Staff', 7, 9, 18.00, TRUE),
(UUID(), 'Benny', 'Cab', 'Male', '(555) 007-0002', 'benny@park.com', 'Addr 32', 'Orlando', 'FL', '32830', '1988-08-01', '2024-01-01', 'Staff', 7, 9, 18.00, TRUE),
(UUID(), 'Gadget', 'Hackwrench', 'Female', '(555) 007-0003', 'gadget@park.com', 'Addr 33', 'Orlando', 'FL', '32830', '1989-09-01', '2024-01-01', 'Staff', 7, 9, 18.00, TRUE),
(UUID(), 'Chip', 'Munk', 'Male', '(555) 007-0004', 'chipm@park.com', 'Addr 34', 'Orlando', 'FL', '32830', '1943-10-01', '2024-01-01', 'Staff', 7, 9, 18.00, TRUE),
(UUID(), 'Dale', 'Munk', 'Male', '(555) 007-0005', 'dalem@park.com', 'Addr 35', 'Orlando', 'FL', '32830', '1943-11-01', '2024-01-01', 'Staff', 7, 9, 18.00, TRUE),

-- Galaxys Edge (Manager: Leia ID 10)
(UUID(), 'Han', 'Solo', 'Male', '(555) 008-0001', 'hansolo@park.com', 'Addr 36', 'Orlando', 'FL', '32830', '1977-12-01', '2024-01-01', 'Staff', 8, 10, 18.00, TRUE),
(UUID(), 'Chewbacca', 'Wookie', 'Male', '(555) 008-0002', 'chewie@park.com', 'Addr 37', 'Orlando', 'FL', '32830', '1977-01-01', '2024-01-01', 'Staff', 8, 10, 18.00, TRUE),
(UUID(), 'Rey', 'Skywalker', 'Female', '(555) 008-0003', 'rey@park.com', 'Addr 38', 'Orlando', 'FL', '32830', '1995-02-01', '2024-01-01', 'Staff', 8, 10, 18.00, TRUE), -- Adjusted to 1995
(UUID(), 'Finn', 'FN2187', 'Male', '(555) 008-0004', 'finn@park.com', 'Addr 39', 'Orlando', 'FL', '32830', '1995-03-01', '2024-01-01', 'Staff', 8, 10, 18.00, TRUE), -- Adjusted to 1995
(UUID(), 'Poe', 'Dameron', 'Male', '(555) 008-0005', 'poe@park.com', 'Addr 40', 'Orlando', 'FL', '32830', '1995-04-01', '2024-01-01', 'Staff', 8, 10, 18.00, TRUE); -- Adjusted to 1995


-- Update Location Managers
UPDATE location SET manager_id = 3, manager_start = '2021-03-15' WHERE location_id = 1; -- Woody
UPDATE location SET manager_id = 4, manager_start = '2021-03-15' WHERE location_id = 2; -- Buzz
UPDATE location SET manager_id = 5, manager_start = '2019-06-01' WHERE location_id = 3; -- Cinderella
UPDATE location SET manager_id = 6, manager_start = '2018-01-01' WHERE location_id = 4; -- Mickey
UPDATE location SET manager_id = 7, manager_start = '2022-05-20' WHERE location_id = 5; -- Jack
UPDATE location SET manager_id = 8, manager_start = '2020-10-31' WHERE location_id = 6; -- Ichabod
UPDATE location SET manager_id = 9, manager_start = '2023-01-15' WHERE location_id = 7; -- Roger
UPDATE location SET manager_id = 10, manager_start = '2019-12-20' WHERE location_id = 8; -- Leia

-- 3. EMPLOYEE_AUTH
-- Password for everyone is 'password'
-- Insert for IDs 1-55
INSERT INTO employee_auth (employee_id, password_hash)
SELECT employee_id, '$2b$10$zKGpKcl0uHKA9Tg1GY8Jv.w8T0glQh/v7wFckZTjnyD0hSZJ/gkZu'
FROM employee_demographics;

-- 4. RIDES
-- 5 Rides per location (40 total). At least 3 of each type.
-- Types: Rollercoaster, Water Ride, Flat Ride, Show, Other
-- ADDED public_ride_id and UUID()

INSERT INTO rides (public_ride_id, ride_name, ride_type, ride_status, max_weight, min_height, capacity, location_id) VALUES
-- Frontierland (Loc 1)
(UUID(), 'Big Thunder Mountain', 'Rollercoaster', 'OPEN', 300, 40, 30, 1),
(UUID(), 'Splash Mountain', 'Water Ride', 'OPEN', 300, 40, 20, 1),
(UUID(), 'Tom Sawyer Island', 'Other', 'OPEN', 1000, 0, 100, 1),
(UUID(), 'Country Bear Jamboree', 'Show', 'OPEN', 1000, 0, 200, 1),
(UUID(), 'Shooting Arcade', 'Other', 'OPEN', 1000, 0, 20, 1),

-- Tomorrowland (Loc 2)
(UUID(), 'Space Mountain', 'Rollercoaster', 'OPEN', 300, 44, 12, 2),
(UUID(), 'Buzz Lightyear Spin', 'Flat Ride', 'OPEN', 400, 0, 20, 2),
(UUID(), 'PeopleMover', 'Other', 'OPEN', 500, 0, 40, 2),
(UUID(), 'Carousel of Progress', 'Show', 'OPEN', 1000, 0, 200, 2),
(UUID(), 'Astro Orbiter', 'Flat Ride', 'CLOSED', 300, 0, 16, 2),

-- Fantasyland (Loc 3)
(UUID(), 'Its a Small World', 'Water Ride', 'OPEN', 600, 0, 20, 3),
(UUID(), 'Peter Pans Flight', 'Flat Ride', 'OPEN', 400, 0, 10, 3),
(UUID(), 'Dumbo the Flying Elephant', 'Flat Ride', 'OPEN', 400, 0, 16, 3),
(UUID(), 'Mad Tea Party', 'Flat Ride', 'OPEN', 400, 0, 18, 3),
(UUID(), 'Matterhorn Bobsleds', 'Rollercoaster', 'BROKEN', 300, 42, 12, 3),

-- Main Entrance (Loc 4)
(UUID(), 'Railroad Station', 'Other', 'OPEN', 2000, 0, 100, 4),
(UUID(), 'Main Street Vehicles', 'Other', 'OPEN', 1000, 0, 20, 4),
(UUID(), 'Great Moments with Mr. Lincoln', 'Show', 'OPEN', 1000, 0, 300, 4),
(UUID(), 'Main Street Cinema', 'Show', 'CLOSED', 500, 0, 50, 4),
(UUID(), 'Horse-Drawn Trolley', 'Other', 'OPEN', 1000, 0, 20, 4),

-- Adventureland (Loc 5)
(UUID(), 'Jungle Cruise', 'Water Ride', 'OPEN', 1000, 0, 30, 5),
(UUID(), 'Pirates of the Caribbean', 'Water Ride', 'OPEN', 1000, 0, 30, 5),
(UUID(), 'Enchanted Tiki Room', 'Show', 'OPEN', 1000, 0, 150, 5),
(UUID(), 'Swiss Family Treehouse', 'Other', 'OPEN', 1000, 0, 100, 5),
(UUID(), 'Magic Carpets of Aladdin', 'Flat Ride', 'OPEN', 400, 0, 16, 5),

-- Liberty Square (Loc 6)
(UUID(), 'Haunted Mansion', 'Other', 'OPEN', 400, 0, 20, 6),
(UUID(), 'Liberty Square Riverboat', 'Water Ride', 'OPEN', 2000, 0, 300, 6),
(UUID(), 'Hall of Presidents', 'Show', 'OPEN', 1000, 0, 300, 6),
(UUID(), 'Great Moments in History', 'Show', 'OPEN', 1000, 0, 100, 6),
(UUID(), 'Mike Fink Keel Boats', 'Water Ride', 'CLOSED', 500, 0, 20, 6),

-- Toontown (Loc 7)
(UUID(), 'Rogers Car Toon Spin', 'Flat Ride', 'OPEN', 400, 0, 10, 7),
(UUID(), 'Gadgets Go Coaster', 'Rollercoaster', 'OPEN', 300, 36, 16, 7),
(UUID(), 'Mickeys House', 'Other', 'OPEN', 500, 0, 50, 7),
(UUID(), 'Minnies House', 'Other', 'OPEN', 500, 0, 50, 7),
(UUID(), 'Donalds Boat', 'Other', 'BROKEN', 500, 0, 50, 7),

-- Galaxys Edge (Loc 8)
(UUID(), 'Rise of the Resistance', 'Other', 'OPEN', 400, 40, 16, 8),
(UUID(), 'Millennium Falcon: Smugglers Run', 'Other', 'OPEN', 400, 38, 6, 8),
(UUID(), 'Star Tours', 'Other', 'OPEN', 400, 40, 40, 8),
(UUID(), 'Slinky Dog Dash', 'Rollercoaster', 'OPEN', 300, 38, 20, 8), -- Moved here for balance
(UUID(), 'Alien Swirling Saucers', 'Flat Ride', 'OPEN', 400, 32, 16, 8);

-- 5. MAINTENANCE LOGS
-- Inserting 20 Total Logs: 18 Completed, 2 Open (Active)
-- Reported by Staff (IDs 16-55), Assigned to Maintenance (IDs 11-15)
INSERT INTO maintenance (public_maintenance_id, ride_id, report_date, start_date, end_date, summary, employee_id, assignment_requested_by, cost) VALUES
-- OPEN / ACTIVE ISSUES (2 Entries)
(UUID(), 15, '2025-10-20', '2025-10-21', NULL, 'Matterhorn: Track repairs needed on turn 3.', 11, 26, NULL), -- Reported by Snow White (26), Assigned to Goofy (11)
(UUID(), 35, '2025-10-22', '2025-10-23', NULL, 'Donalds Boat: Leak in hull detected.', 12, 49, NULL),      -- Reported by Donald (31/49?), Assigned to Felix (12)

-- COMPLETED ISSUES (18 Entries)
(UUID(), 10, '2025-10-01', '2025-10-01', '2025-10-05', 'Astro Orbiter: Hydraulic pump replacement.', 13, 21, 500.00),
(UUID(), 1,  '2025-01-10', '2025-01-11', '2025-01-12', 'Big Thunder: Loose safety bar row 4.', 14, 16, 150.00),
(UUID(), 6,  '2025-02-14', '2025-02-15', '2025-02-16', 'Space Mountain: Audio sync issue.', 15, 22, 75.00),
(UUID(), 11, '2025-03-05', '2025-03-06', '2025-03-07', 'Small World: Boat stuck in tunnel.', 11, 27, 200.00),
(UUID(), 21, '2025-03-20', '2025-03-21', '2025-03-25', 'Jungle Cruise: Engine stall on boat 5.', 12, 36, 450.00),
(UUID(), 26, '2025-04-01', '2025-04-02', '2025-04-02', 'Haunted Mansion: Doom buggy door jam.', 13, 41, 100.00),
(UUID(), 36, '2025-05-12', '2025-05-12', '2025-05-14', 'Rise of Resistance: Droid animatronic reset.', 14, 51, 800.00),
(UUID(), 2,  '2025-06-01', '2025-06-02', '2025-06-03', 'Splash Mountain: Sensor cleaning.', 15, 17, 50.00),
(UUID(), 7,  '2025-06-15', '2025-06-15', '2025-06-16', 'Buzz Lightyear: Laser gun malfunction.', 11, 23, 120.00),
(UUID(), 22, '2025-07-04', '2025-07-05', '2025-07-05', 'Pirates: Water filtration check.', 12, 37, 300.00),
(UUID(), 27, '2025-07-20', '2025-07-21', '2025-07-22', 'Liberty Boat: Paddle wheel routine maint.', 13, 42, 600.00),
(UUID(), 31, '2025-08-10', '2025-08-11', '2025-08-11', 'Car Toon Spin: Steering wheel loose.', 14, 46, 90.00),
(UUID(), 37, '2025-08-25', '2025-08-25', '2025-08-27', 'Smugglers Run: Screen projector alignment.', 15, 52, 1200.00),
(UUID(), 3,  '2025-09-05', '2025-09-05', '2025-09-06', 'Tom Sawyer Island: Bridge slat replacement.', 11, 18, 250.00),
(UUID(), 8,  '2025-09-15', '2025-09-15', '2025-09-15', 'PeopleMover: Track obstruction cleared.', 12, 24, 0.00),
(UUID(), 13, '2025-10-01', '2025-10-01', '2025-10-02', 'Dumbo: Hydraulic fluid top-up.', 13, 28, 180.00),
(UUID(), 38, '2025-10-10', '2025-10-10', '2025-10-12', 'Star Tours: Seat belt sensor faulty.', 14, 53, 150.00),
(UUID(), 39, '2025-10-15', '2025-10-16', '2025-10-17', 'Slinky Dog: Brake fin inspection.', 15, 54, 350.00);

-- 6. MEMBERSHIP_TYPE & 8. TICKET_TYPES (Standard)
INSERT INTO membership_type (public_type_id, type_name, base_price, base_members, additional_member_price, description, is_active) VALUES
(UUID(), 'Platinum', 799.00, 1, NULL, 'All-access individual pass with perks.', TRUE),
(UUID(), 'Gold', 599.00, 1, NULL, 'Standard individual annual pass.', TRUE),
(UUID(), 'Individual', 399.00, 1, NULL, 'Basic annual pass for one person.', TRUE),
(UUID(), 'Family', 798.00, 2, 249.00, 'Flexible pass for 2 members. Add additional family members at a discount.', TRUE),
(UUID(), 'Founders Club', 299.00, 1, NULL, 'Legacy pass, no longer available for new signups.', FALSE);

INSERT INTO ticket_types (public_ticket_type_id, type_name, base_price, description, is_active, is_member_type) VALUES
(UUID(), 'Member', 0.00, 'System ticket for active members.', TRUE, TRUE),    
(UUID(), 'Adult', 109.00, 'Standard park admission for ages 10-64.', TRUE, FALSE),   
(UUID(), 'Child', 99.00, 'Park admission for ages 3-9.', TRUE, FALSE),    
(UUID(), 'Senior', 89.00, 'Park admission for ages 65+.', TRUE, FALSE);

-- 7. PROMOTIONS
INSERT INTO event_promotions (event_name, event_type, start_date, end_date, discount_percent, summary, is_recurring) VALUES
('New Year Kickoff', 'Holiday', '2025-01-01', '2025-01-05', 20.00, 'Start the year with a bang!', TRUE),
('MLK Weekend', 'Weekend', '2025-01-17', '2025-01-20', 15.00, 'Honor the dream with family fun.', TRUE),
('Lunar New Year Festival', 'Holiday', '2025-01-28', '2025-02-02', 18.00, 'Celebrate the Year of the Snake with special parades.', TRUE),
('Valentines Sweetheart Deal', 'Special', '2025-02-14', '2025-02-16', 25.00, 'Perfect date night discount.', TRUE),
('Presidents Day Sale', 'Weekend', '2025-02-15', '2025-02-17', 10.00, 'School is out, fun is in!', TRUE),
('St. Patricks Lucky Days', 'Special', '2025-03-14', '2025-03-17', 17.00, 'Wear green and save green!', TRUE),
('Spring Break Splash', 'Seasonal', '2025-03-20', '2025-04-10', 10.00, 'Enjoy the warmer weather.', TRUE),
('Easter Eggstravaganza', 'Holiday', '2025-04-18', '2025-04-20', 15.00, 'Egg hunts and bunny hops.', TRUE),
('Memorial Day Salute', 'Holiday', '2025-05-23', '2025-05-26', 25.00, 'Kick off the summer season.', TRUE),
('Summer School Out', 'Seasonal', '2025-06-01', '2025-06-15', 10.00, 'Celebrate the start of summer vacation.', TRUE),
('Juneteenth Jubilee', 'Holiday', '2025-06-19', '2025-06-19', 19.00, 'Freedom celebration event.', TRUE),
('Independence Week', 'Holiday', '2025-07-01', '2025-07-07', 15.00, 'Fireworks every night!', TRUE),
('Labor Day Relaxer', 'Holiday', '2025-08-29', '2025-09-01', 20.00, 'The last big blast of summer.', TRUE),
('Halloween Spooktacular', 'Seasonal', '2025-10-01', '2025-10-31', 15.00, 'Discount on tickets after 4pm.', TRUE),
('Veterans Day Honor', 'Special', '2025-11-11', '2025-11-11', 50.00, 'Special appreciation discount.', TRUE),
('Thanksgiving Harvest', 'Holiday', '2025-11-24', '2025-11-30', 10.00, 'Feast and fun for the whole family.', TRUE),
('Winter Wonderland', 'Holiday', '2025-12-01', '2025-12-31', 10.00, 'Holiday-themed event with artificial snow.', TRUE);

-- 8. VENDORS (2 per location = 16 total)
-- ADDED vendor_status column
INSERT INTO vendors (public_vendor_id, vendor_name, location_id, vendor_status) VALUES
-- Frontierland
(UUID(), 'Pecos Bill Tall Tale Inn', 1, 'OPEN'),
(UUID(), 'Golden Horseshoe', 1, 'CLOSED'),
-- Tomorrowland
(UUID(), 'Cosmic Rays Starlight Cafe', 2, 'OPEN'),
(UUID(), 'The Lunching Pad', 2, 'OPEN'),
-- Fantasyland
(UUID(), 'Pinocchio Village Haus', 3, 'OPEN'),
(UUID(), 'Friars Nook', 3, 'CLOSED'),
-- Main Entrance
(UUID(), 'The Emporium', 4, 'OPEN'),
(UUID(), 'Main Street Bakery', 4, 'OPEN'),
-- Adventureland
(UUID(), 'Sunshine Tree Terrace', 5, 'OPEN'),
(UUID(), 'Aloha Isle', 5, 'OPEN'),
-- Liberty Square
(UUID(), 'Columbia Harbour House', 6, 'CLOSED'),
(UUID(), 'Liberty Tree Tavern', 6, 'OPEN'),
-- Toontown
(UUID(), 'Gag Factory', 7, 'OPEN'),
(UUID(), 'Toontown Farmers Market', 7, 'OPEN'),
-- Galaxys Edge
(UUID(), 'Docking Bay 7', 8, 'OPEN'),
(UUID(), 'Milk Stand', 8, 'OPEN');

-- 9. ITEMS (Standard + Extras)
INSERT INTO item (public_item_id, item_type, item_name, price, summary) VALUES
(UUID(), 'Food', 'Cheeseburger', 12.99, '1/3 lb Angus Burger'),
(UUID(), 'Food', 'Chicken Tenders', 11.99, '4 Tenders with Fries'),
(UUID(), 'Food', 'Dole Whip', 6.99, 'Pineapple soft serve'),
(UUID(), 'Food', 'Blue Milk', 8.99, 'Exotic rice milk blend'),
(UUID(), 'Food', 'Churro', 5.50, 'Cinnamon sugar pastry'),
(UUID(), 'Apparel', 'Mickey T-Shirt', 29.99, '100% Cotton T-Shirt'),
(UUID(), 'Apparel', 'Spirit Jersey', 69.99, 'Oversized long sleeve'),
(UUID(), 'Souvenir', 'Mickey Ears', 24.99, 'Classic Mickey Mouse Ears'),
(UUID(), 'Souvenir', 'Light Saber', 200.00, 'Custom built sword'),
(UUID(), 'Other', 'Poncho', 10.00, 'Plastic rain poncho');

-- 10. INVENTORY
-- Populate inventory (Ensuring at least 2 items per vendor)
-- NEW: Added min_count (Low Stock Threshold) and def_count (Target Restock)
INSERT INTO inventory (item_id, vendor_id, count, min_count, def_count) VALUES
-- Frontierland
(1, 1, 200, 50, 300), (2, 1, 200, 50, 300),   -- Pecos Bill: Burgers, Tenders (High Food Volume)
(5, 2, 300, 75, 400), (2, 2, 150, 40, 200),   -- Golden Horseshoe: Churros, Tenders
-- Tomorrowland
(1, 3, 250, 60, 350), (2, 3, 250, 60, 350),   -- Cosmic Rays: Burgers, Tenders
(5, 4, 200, 50, 300), (4, 4, 100, 20, 150),   -- Lunching Pad: Churros, Blue Milk
-- Fantasyland
(1, 5, 150, 40, 250), (2, 5, 150, 40, 250),   -- Pinocchio: Burgers, Tenders
(2, 6, 100, 30, 150), (3, 6, 300, 75, 400),   -- Friars Nook: Tenders, Dole Whip
-- Main Entrance
(8, 7, 500, 100, 600), (10, 7, 1000, 150, 800), (6, 7, 300, 50, 400), -- Emporium: Ears, Ponchos (High min/def), T-Shirts
(5, 8, 150, 40, 200), (3, 8, 200, 50, 250),   -- Main St Bakery: Churro, Dole Whip
-- Adventureland
(3, 9, 400, 100, 500), (5, 9, 200, 50, 300),   -- Sunshine Tree: Dole Whip, Churro
(3, 10, 500, 100, 600), (10, 10, 100, 20, 150),-- Aloha Isle: Dole Whip, Ponchos
-- Liberty Square
(2, 11, 150, 40, 250), (1, 11, 150, 40, 250), -- Columbia Harbour: Tenders, Burgers
(1, 12, 200, 50, 300), (2, 12, 200, 50, 300), -- Liberty Tree: Burgers, Tenders
-- Toontown
(8, 13, 300, 75, 400), (10, 13, 300, 75, 400),-- Gag Factory: Ears, Ponchos
(3, 14, 100, 25, 150), (5, 14, 100, 25, 150), -- Farmers Market: Dole Whip, Churros
-- Galaxys Edge
(9, 15, 50, 5, 50), (4, 15, 200, 30, 250),    -- Docking Bay 7: Light Sabers (Low min/def), Blue Milk
(4, 16, 300, 50, 350), (5, 16, 150, 30, 200); -- Milk Stand: Blue Milk, Churros

-- 11. PENDING REQUESTS (Updated for new IDs)
-- Wage change request for Donald Duck (ID 16, Staff at Main Entrance) requested by Mickey (ID 6)
UPDATE employee_demographics
SET pending_hourly_rate = 19.50, rate_change_requested_by = 6
WHERE employee_id = 16;

-- 12. Maintenance reassignment: Matterhorn (Ride 15, Log 1) from Goofy (11) to Felix (12). Requested by Minnie (2).
UPDATE maintenance
SET pending_employee_id = 12, assignment_requested_by = 2
WHERE maintenance_id = 1;

-- 13. INVENTORY REQUESTS
INSERT INTO inventory_requests (public_request_id, vendor_id, item_id, requested_count, requested_by_id, location_id, request_date, status) VALUES
(UUID(), 7, 10, 200, 17, 4, '2025-10-25', 'Pending'), -- Daisy (ID 17) requests Ponchos for Emporium (Loc 4)
(UUID(), 16, 4, 100, 53, 8, '2025-10-25', 'Pending'); -- Finn (ID 54/53?) requests Blue Milk for Milk Stand (Loc 8)