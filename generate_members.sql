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
    
    -- NEW: Variable for Guest Passes
    DECLARE v_guest_passes INT DEFAULT 0;

    DECLARE dob_offset INT;
    DECLARE start_offset INT;
    
    -- OPTIMIZATION: Variables for random indexed selection
    DECLARE max_first_name_id INT;
    DECLARE max_last_name_id INT;
    DECLARE max_type_id INT;
    DECLARE random_id INT;

    -- --- Temporary Tables Setup (OPTIMIZED) ---
    
    DROP TEMPORARY TABLE IF EXISTS temp_first_names;
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
    CREATE TEMPORARY TABLE temp_member_types (
        id INT AUTO_INCREMENT PRIMARY KEY, 
        type_id INT
    );
    -- Types: 1=Platinum, 2=Gold, 3=Silver, 4=Family
    INSERT INTO temp_member_types (type_id) VALUES (1), (2), (3), (4);

    -- OPTIMIZATION: Get the max row counts ONCE before the loop
    SELECT COUNT(*) INTO max_first_name_id FROM temp_first_names;
    SELECT COUNT(*) INTO max_last_name_id FROM temp_last_names;
    SELECT COUNT(*) INTO max_type_id FROM temp_member_types;


    -- --- Member Generation Loop (OPTIMIZED) ---

    START TRANSACTION;

    WHILE i < num_members DO
        
        -- Select random first name
        SET random_id = FLOOR(1 + RAND() * max_first_name_id);
        SELECT name INTO random_first_name FROM temp_first_names WHERE id = random_id;
        
        -- Select random last name
        SET random_id = FLOOR(1 + RAND() * max_last_name_id);
        SELECT name INTO random_last_name FROM temp_last_names WHERE id = random_id;
        
        -- Generate unique email
        SET random_email = CONCAT(LOWER(random_first_name), '.', LOWER(random_last_name), i, '.', start_year, '@parkmember.com');

        -- Generate random Date of Birth
        SET dob_offset = FLOOR(RAND() * 18627); 
        SET random_dob = DATE_SUB('2000-12-31', INTERVAL dob_offset DAY); 
        
        -- Generate random Start Date
        SET start_offset = FLOOR(365 * RAND());
        SET random_start_date = DATE_ADD(CONCAT(start_year, '-01-01'), INTERVAL start_offset DAY); 
        
        -- Generate End Date (1 Year Validity)
        SET random_end_date = DATE_SUB(DATE_ADD(random_start_date, INTERVAL 1 YEAR), INTERVAL 1 DAY); 

        -- Select random membership type
        SET random_id = FLOOR(1 + RAND() * max_type_id);
        SELECT type_id INTO random_type_id FROM temp_member_types WHERE id = random_id;

        -- NEW: Determine Guest Pass Allowance based on Type
        -- 1=Platinum(4), 2=Gold(2), 3=Silver(0), 4=Family(2)
        SET v_guest_passes = CASE 
            WHEN random_type_id = 1 THEN 4
            WHEN random_type_id = 2 THEN 2
            WHEN random_type_id = 4 THEN 2
            ELSE 0 
        END;

        -- Insert the new member with guest passes
        INSERT INTO membership (
            public_membership_id, 
            first_name, 
            last_name, 
            email, 
            phone_number, 
            date_of_birth, 
            type_id, 
            start_date, 
            end_date,
            guest_passes_remaining -- NEW COLUMN
        )
        VALUES (
            UUID(),
            random_first_name,
            random_last_name,
            random_email,
            CONCAT('(', LPAD(FLOOR(RAND() * 800) + 200, 3, '0'), ') ', 
                   LPAD(FLOOR(RAND() * 900) + 100, 3, '0'), '-',    
                   LPAD(FLOOR(RAND() * 10000), 4, '0')),
            random_dob,
            random_type_id,
            random_start_date,
            random_end_date,
            v_guest_passes -- NEW VALUE
        );

        SET i = i + 1;
    END WHILE;

    COMMIT;

    -- --- Cleanup Temporary Tables ---
    DROP TEMPORARY TABLE IF EXISTS temp_first_names;
    DROP TEMPORARY TABLE IF EXISTS temp_last_names;
    DROP TEMPORARY TABLE IF EXISTS temp_member_types;

END //

DELIMITER ;

-- --- Execution and Cleanup ---

-- 1. Cleanup existing data
SET SQL_SAFE_UPDATES = 0;
DELETE FROM visits WHERE membership_id IS NOT NULL; 
DELETE FROM member_payment_methods; 
DELETE FROM membership_purchase_history; 
DELETE FROM member_auth; 
DELETE FROM membership; 

ALTER TABLE membership AUTO_INCREMENT = 1;

-- 2. Generate "Past" Members (Start Year 2024)
CALL GenerateMembers(4512, 2024);

SET SQL_SAFE_UPDATES = 1;