DROP PROCEDURE IF EXISTS GenerateMembers;

DELIMITER //

-- Stored Procedure to Generate a specified number of random park members
CREATE PROCEDURE GenerateMembers(
    IN num_members INT,
    IN start_year INT
)
BEGIN
    -- Initialize variables for loop and member attributes
    DECLARE i INT DEFAULT 0;
    DECLARE random_first_name VARCHAR(25);
    DECLARE random_last_name VARCHAR(25);
    DECLARE random_email VARCHAR(50);
    DECLARE random_dob DATE;
    DECLARE random_start_date DATE;
    DECLARE random_end_date DATE;
    DECLARE random_type_id INT;
    DECLARE v_guest_passes INT DEFAULT 0;

    -- Variables for generating random dates
    DECLARE dob_offset INT;
    DECLARE start_offset INT;

    -- Variables for optimized random lookup
    DECLARE max_first_name_id INT;
    DECLARE max_last_name_id INT;
    DECLARE max_type_id INT;
    DECLARE random_id INT;

    -- --- Temporary Tables Setup ---

    -- Create temporary table for a pool of first names
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

    -- Create temporary table for a pool of last names
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

    -- Create temporary table for membership types (IDs 1, 2, 3, 4)
    DROP TEMPORARY TABLE IF EXISTS temp_member_types;
    CREATE TEMPORARY TABLE temp_member_types (
        id INT AUTO_INCREMENT PRIMARY KEY,
        type_id INT
    );
    INSERT INTO temp_member_types (type_id) VALUES (1), (2), (3), (4);

    -- Get the maximum ID/count for each temporary table for random selection
    SELECT COUNT(*) INTO max_first_name_id FROM temp_first_names;
    SELECT COUNT(*) INTO max_last_name_id FROM temp_last_names;
    SELECT COUNT(*) INTO max_type_id FROM temp_member_types;


    -- --- Member Generation Loop ---

    START TRANSACTION;

    -- Loop to insert the requested number of members
    WHILE i < num_members DO

        -- Select a random first name using ID lookup
        SET random_id = FLOOR(1 + RAND() * max_first_name_id);
        SELECT name INTO random_first_name FROM temp_first_names WHERE id = random_id;

        -- Select a random last name using ID lookup
        SET random_id = FLOOR(1 + RAND() * max_last_name_id);
        SELECT name INTO random_last_name FROM temp_last_names WHERE id = random_id;

        -- Generate a unique email address
        SET random_email = CONCAT(LOWER(random_first_name), '.', LOWER(random_last_name), i, '.', start_year, '@parkmember.com');

        -- Generate a random Date of Birth (within a reasonable age range)
        SET dob_offset = FLOOR(RAND() * 18627);
        SET random_dob = DATE_SUB('2000-12-31', INTERVAL dob_offset DAY);

        -- Generate a random membership Start Date within the specified year
        SET start_offset = FLOOR(365 * RAND());
        SET random_start_date = DATE_ADD(CONCAT(start_year, '-01-01'), INTERVAL start_offset DAY);

        -- Calculate the End Date (1 year minus 1 day from start date)
        SET random_end_date = DATE_SUB(DATE_ADD(random_start_date, INTERVAL 1 YEAR), INTERVAL 1 DAY);

        -- Select a random membership type ID
        SET random_id = FLOOR(1 + RAND() * max_type_id);
        SELECT type_id INTO random_type_id FROM temp_member_types WHERE id = random_id;

        -- Determine the number of guest passes based on the membership type ID
        SET v_guest_passes = CASE
            WHEN random_type_id = 1 THEN 4 -- Platinum
            WHEN random_type_id = 2 THEN 2 -- Gold
            WHEN random_type_id = 4 THEN 2 -- Family
            ELSE 0                         -- Silver/Other
        END;

        -- Insert the new member record
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
            guest_passes_remaining
        )
        VALUES (
            UUID(),
            random_first_name,
            random_last_name,
            random_email,
            -- Generate a random phone number in (###) ###-#### format
            CONCAT('(', LPAD(FLOOR(RAND() * 800) + 200, 3, '0'), ') ',
                   LPAD(FLOOR(RAND() * 900) + 100, 3, '0'), '-',
                   LPAD(FLOOR(RAND() * 10000), 4, '0')),
            random_dob,
            random_type_id,
            random_start_date,
            random_end_date,
            v_guest_passes
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

-- Disable safe updates and remove existing member-related data
SET SQL_SAFE_UPDATES = 0;
DELETE FROM visits WHERE membership_id IS NOT NULL;
DELETE FROM member_payment_methods;
DELETE FROM membership_purchase_history;
DELETE FROM member_auth;
DELETE FROM membership;

-- Reset the auto-increment counter for the membership table
ALTER TABLE membership AUTO_INCREMENT = 1;

-- Execute the stored procedure to generate X members with memberships starting in the year Y
CALL GenerateMembers(4512, 2024);

-- Re-enable safe updates
SET SQL_SAFE_UPDATES = 1;