DROP PROCEDURE IF EXISTS GenerateMembers;

DELIMITER //

-- generate dummy members
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
    DECLARE v_guest_passes INT DEFAULT 0;
    DECLARE max_first INT;
    DECLARE max_last INT;
    DECLARE rnd_id INT;

    -- name pools
    DROP TEMPORARY TABLE IF EXISTS temp_first_names;
    CREATE TEMPORARY TABLE temp_first_names (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(25));
    INSERT INTO temp_first_names (name) VALUES
    ('James'), ('Mary'), ('Robert'), ('Patricia'), ('John'), ('Jennifer'),
    ('Michael'), ('Linda'), ('William'), ('Elizabeth'), ('David'), ('Barbara'),
    ('Richard'), ('Susan'), ('Joseph'), ('Jessica'), ('Thomas'), ('Sarah'),
    ('Charles'), ('Karen');

    DROP TEMPORARY TABLE IF EXISTS temp_last_names;
    CREATE TEMPORARY TABLE temp_last_names (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(25));
    INSERT INTO temp_last_names (name) VALUES
    ('Smith'), ('Johnson'), ('Williams'), ('Brown'), ('Jones'), ('Garcia'),
    ('Miller'), ('Davis'), ('Rodriguez'), ('Martinez'), ('Hernandez'), ('Lopez'),
    ('Gonzalez'), ('Wilson'), ('Anderson'), ('Thomas'), ('Taylor'), ('Moore'),
    ('Jackson'), ('Martin');

    SELECT COUNT(*) INTO max_first FROM temp_first_names;
    SELECT COUNT(*) INTO max_last FROM temp_last_names;

    START TRANSACTION;

    WHILE i < num_members DO
        -- pick names
        SET rnd_id = FLOOR(1 + RAND() * max_first);
        SELECT name INTO random_first_name FROM temp_first_names WHERE id = rnd_id;

        SET rnd_id = FLOOR(1 + RAND() * max_last);
        SELECT name INTO random_last_name FROM temp_last_names WHERE id = rnd_id;

        SET random_email = CONCAT(LOWER(random_first_name), '.', LOWER(random_last_name), i, '.', start_year, '@parkmember.com');

        -- generate dates
        SET random_dob = DATE_SUB('2000-12-31', INTERVAL FLOOR(RAND() * 18627) DAY);
        SET random_start_date = DATE_ADD(CONCAT(start_year, '-01-01'), INTERVAL FLOOR(365 * RAND()) DAY);
        SET random_end_date = DATE_SUB(DATE_ADD(random_start_date, INTERVAL 1 YEAR), INTERVAL 1 DAY);

        -- pick random membership
        SELECT type_id, guest_pass_limit INTO random_type_id, v_guest_passes 
        FROM membership_type 
        WHERE is_active = TRUE
        ORDER BY RAND() 
        LIMIT 1;

        INSERT INTO membership (
            public_membership_id, first_name, last_name, email, phone_number,
            date_of_birth, type_id, start_date, end_date, guest_passes_remaining
        )
        VALUES (
            UUID(), random_first_name, random_last_name, random_email,
            CONCAT('(', LPAD(FLOOR(RAND() * 800) + 200, 3, '0'), ') ',
                   LPAD(FLOOR(RAND() * 900) + 100, 3, '0'), '-',
                   LPAD(FLOOR(RAND() * 10000), 4, '0')),
            random_dob, random_type_id, random_start_date, random_end_date, v_guest_passes
        );

        SET i = i + 1;
    END WHILE;

    COMMIT;

    DROP TEMPORARY TABLE IF EXISTS temp_first_names;
    DROP TEMPORARY TABLE IF EXISTS temp_last_names;
END //

DELIMITER ;

-- cleanup and run
SET SQL_SAFE_UPDATES = 0;
DELETE FROM visits WHERE membership_id IS NOT NULL;
DELETE FROM member_payment_methods;
DELETE FROM membership_purchase_history;
DELETE FROM member_auth;
DELETE FROM membership;
ALTER TABLE membership AUTO_INCREMENT = 1;
SET SQL_SAFE_UPDATES = 1;