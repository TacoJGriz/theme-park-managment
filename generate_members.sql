DROP PROCEDURE IF EXISTS GenerateMembers;

DELIMITER //
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
    
    -- OPTIMIZATION: Variables for random indexed selection
    DECLARE max_first_name_id INT;
    DECLARE max_last_name_id INT;
    DECLARE max_type_id INT;
    DECLARE random_id INT;

    -- --- Temporary Tables Setup (OPTIMIZED) ---
    
    DROP TEMPORARY TABLE IF EXISTS temp_first_names;
    -- OPTIMIZATION: Added id column
    CREATE TEMPORARY TABLE temp_first_names (
        id INT AUTO_INCREMENT PRIMARY KEY, 
        name VARCHAR(25)
    );
    INSERT INTO temp_first_names (name) VALUES 
    ('James'), ('Mary'), ('Robert'), ('Patricia'), ('John'), ('Jennifer'), 
    ('Michael'), ('Linda'), ('William'), ('Elizabeth'), ('David'), ('Barbara'),
    ('Richard'), ('Susan'), ('Joseph'), ('Jessica'), ('Thomas'), ('Sarah'),
    ('Charles'), ('Karen');

    DROP TEMPORARY TABLE IF EXISTS temp_last_names;
    -- OPTIMIZATION: Added id column
    CREATE TEMPORARY TABLE temp_last_names (
        id INT AUTO_INCREMENT PRIMARY KEY, 
        name VARCHAR(25)
    );
    INSERT INTO temp_last_names (name) VALUES 
    ('Smith'), ('Johnson'), ('Williams'), ('Brown'), ('Jones'), ('Garcia'), 
    ('Miller'), ('Davis'), ('Rodriguez'), ('Martinez'), ('Hernandez'), ('Lopez'),
    ('Gonzalez'), ('Wilson'), ('Anderson'), ('Thomas'), ('Taylor'), ('Moore'),
    ('Jackson'), ('Martin');
    
    DROP TEMPORARY TABLE IF EXISTS temp_member_types;
    -- OPTIMIZATION: Added id column
    CREATE TEMPORARY TABLE temp_member_types (
        id INT AUTO_INCREMENT PRIMARY KEY, 
        type_id INT
    );
    INSERT INTO temp_member_types (type_id) VALUES (1), (2), (3), (4);

    -- OPTIMIZATION: Get the max row counts ONCE before the loop
    SELECT COUNT(*) INTO max_first_name_id FROM temp_first_names;
    SELECT COUNT(*) INTO max_last_name_id FROM temp_last_names;
    SELECT COUNT(*) INTO max_type_id FROM temp_member_types;


    -- --- Member Generation Loop (OPTIMIZED) ---

    -- OPTIMIZATION: Wrap loop in a single transaction
    START TRANSACTION;

    WHILE i < num_members DO
        
        -- OPTIMIZATION: Select random first name by ID
        SET random_id = FLOOR(1 + RAND() * max_first_name_id);
        SELECT name INTO random_first_name FROM temp_first_names WHERE id = random_id;
        
        -- OPTIMIZATION: Select random last name by ID
        SET random_id = FLOOR(1 + RAND() * max_last_name_id);
        SELECT name INTO random_last_name FROM temp_last_names WHERE id = random_id;
        
        -- Generate unique email
        SET random_email = CONCAT(LOWER(random_first_name), '.', LOWER(random_last_name), i, '@parkmember.com');

        -- Generate random Date of Birth
        SET dob_offset = FLOOR(RAND() * 18627); 
        SET random_dob = DATE_SUB('2000-12-31', INTERVAL dob_offset DAY); 
        
        -- Generate random Start Date
        SET start_offset = FLOOR(365 * RAND());
        SET random_start_date = DATE_ADD(CONCAT(start_year, '-01-01'), INTERVAL start_offset DAY); 
        
        -- Generate End Date
        SET random_end_date = DATE_SUB(DATE_ADD(random_start_date, INTERVAL 1 YEAR), INTERVAL 1 DAY); 

        -- OPTIMIZATION: Select a random active membership type by ID
        SET random_id = FLOOR(1 + RAND() * max_type_id);
        SELECT type_id INTO random_type_id FROM temp_member_types WHERE id = random_id;

        -- Insert the new member
        -- ADDED public_membership_id
        INSERT INTO membership (public_membership_id, first_name, last_name, email, phone_number, date_of_birth, type_id, start_date, end_date)
        VALUES (
            UUID(), -- ADDED
            random_first_name,
            random_last_name,
            random_email,
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

    -- OPTIMIZATION: Commit the single transaction
    COMMIT;

    -- --- Cleanup Temporary Tables ---
    
    DROP TEMPORARY TABLE IF EXISTS temp_first_names;
    DROP TEMPORARY TABLE IF EXISTS temp_last_names;
    DROP TEMPORARY TABLE IF EXISTS temp_member_types;

END //

DELIMITER ;

-- --- Execution and Cleanup ---

-- Cleanup existing initial dummy members to prevent conflicts and ensure a clean slate
DELETE FROM visits WHERE membership_id IS NOT NULL; 
ALTER TABLE membership AUTO_INCREMENT = 1;

CALL GenerateMembers(500, 2024);