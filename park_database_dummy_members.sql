DELIMITER //

-- Drop the procedure if it already exists to prevent Error Code 1304
DROP PROCEDURE IF EXISTS GenerateMembers;

-- Stored Procedure to Generate a specified number of random park members
CREATE PROCEDURE GenerateMembers(
    IN num_members INT,
    IN start_year INT
)
BEGIN
    DECLARE i INT DEFAULT 0;
    DECLARE random_first_name VARCHAR(25);
    DECLARE random_last_name VARCHAR(25);
    DECLARE random_email VARCHAR(50);
    DECLARE random_dob DATE;
    DECLARE random_start_date DATE;
    DECLARE random_end_date DATE;
    DECLARE random_type_id INT;
    DECLARE dob_offset INT;
    DECLARE start_offset INT;

    -- --- Temporary Tables Setup ---
    
    -- Drop and create temporary tables for random selection
    DROP TEMPORARY TABLE IF EXISTS temp_first_names;
    CREATE TEMPORARY TABLE temp_first_names (name VARCHAR(25) PRIMARY KEY);
    INSERT INTO temp_first_names (name) VALUES 
    ('James'), ('Mary'), ('Robert'), ('Patricia'), ('John'), ('Jennifer'), 
    ('Michael'), ('Linda'), ('William'), ('Elizabeth'), ('David'), ('Barbara'),
    ('Richard'), ('Susan'), ('Joseph'), ('Jessica'), ('Thomas'), ('Sarah'),
    ('Charles'), ('Karen');

    DROP TEMPORARY TABLE IF EXISTS temp_last_names;
    CREATE TEMPORARY TABLE temp_last_names (name VARCHAR(25) PRIMARY KEY);
    INSERT INTO temp_last_names (name) VALUES 
    ('Smith'), ('Johnson'), ('Williams'), ('Brown'), ('Jones'), ('Garcia'), 
    ('Miller'), ('Davis'), ('Rodriguez'), ('Martinez'), ('Hernandez'), ('Lopez'),
    ('Gonzalez'), ('Wilson'), ('Anderson'), ('Thomas'), ('Taylor'), ('Moore'),
    ('Jackson'), ('Martin');
    
    -- Active Membership Type IDs (1:Platinum, 2:Gold, 3:Individual, 4:Family)
    DROP TEMPORARY TABLE IF EXISTS temp_member_types;
    CREATE TEMPORARY TABLE temp_member_types (type_id INT PRIMARY KEY);
    INSERT INTO temp_member_types (type_id) VALUES (1), (2), (3), (4);

    -- --- Member Generation Loop ---

    WHILE i < num_members DO
        
        -- Select random names
        SELECT name INTO random_first_name FROM temp_first_names ORDER BY RAND() LIMIT 1;
        SELECT name INTO random_last_name FROM temp_last_names ORDER BY RAND() LIMIT 1;
        
        -- Generate unique email
        SET random_email = CONCAT(LOWER(random_first_name), '.', LOWER(random_last_name), i, '@parkmember.com');

        -- FIX: Generate random Date of Birth (Between 1950-01-01 and 2000-12-31)
        -- The difference in days is approximately 18627 days.
        SET dob_offset = FLOOR(RAND() * 18627); 
        SET random_dob = DATE_SUB('2000-12-31', INTERVAL dob_offset DAY); 
        
        -- Generate random Start Date (within the specified year)
        SET start_offset = FLOOR(365 * RAND());
        SET random_start_date = DATE_ADD(CONCAT(start_year, '-01-01'), INTERVAL start_offset DAY); 
        
        -- FIX: Generate End Date (Exactly 1 year minus 1 day from start date, for a 365-day membership)
        SET random_end_date = DATE_SUB(DATE_ADD(random_start_date, INTERVAL 1 YEAR), INTERVAL 1 DAY); 

        -- Select a random active membership type
        SELECT type_id INTO random_type_id FROM temp_member_types ORDER BY RAND() LIMIT 1;

        -- Insert the new member
        INSERT INTO membership (first_name, last_name, email, phone_number, date_of_birth, type_id, start_date, end_date)
        VALUES (
            random_first_name,
            random_last_name,
            random_email,
            -- OPTIMIZATION: Generate a random phone number in (XXX) XXX-XXXX format
            CONCAT('(', LPAD(FLOOR(RAND() * 800) + 200, 3, '0'), ') ', 
                   LPAD(FLOOR(RAND() * 900) + 100, 3, '0'), '-',    
                   LPAD(FLOOR(RAND() * 10000), 4, '0')),
            random_dob,
            random_type_id,
            random_start_date,
            random_end_date
        );

        SET i = i + 1;
    END WHILE;

    -- --- Cleanup Temporary Tables ---
    
    DROP TEMPORARY TABLE IF EXISTS temp_first_names;
    DROP TEMPORARY TABLE IF EXISTS temp_last_names;
    DROP TEMPORARY TABLE IF EXISTS temp_member_types;

END //

DELIMITER ;

-- --- Execution and Cleanup ---

-- Cleanup existing initial dummy members (IDs 1, 2, 3) to prevent conflicts and ensure a clean slate
DELETE FROM visits WHERE membership_id IS NOT NULL; 
DELETE FROM membership WHERE membership_id <= 3;
ALTER TABLE membership AUTO_INCREMENT = 1;

-- Call the procedure to generate 500 new members starting in the year 2024
CALL GenerateMembers(500, 2024);