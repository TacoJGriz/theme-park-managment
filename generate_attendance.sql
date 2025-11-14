USE park_database;

DROP PROCEDURE IF EXISTS GenerateVisits;

DELIMITER //

CREATE PROCEDURE GenerateVisits(
    IN num_visits INT, -- Total number of visits to generate
    IN start_year INT   -- The year for which visits should be generated
)
BEGIN
    -- Loop counter and date range variables
    DECLARE i INT DEFAULT 0;
    DECLARE v_year_start_date DATE;
    DECLARE v_year_end_date DATE;
    DECLARE v_current_date DATE;

    -- Variables for traffic scoring
    DECLARE score_multiplier DECIMAL(5, 2);
    DECLARE day_of_week INT;
    DECLARE month_num INT;
    DECLARE is_holiday BOOL;
    DECLARE total_score DECIMAL(10, 2);
    DECLARE random_score_target DECIMAL(10, 2);
    
    -- Variables for visit details
    DECLARE visit_date_time DATETIME;
    DECLARE exit_time_str TIME;
    DECLARE ticket_id INT;
    DECLARE final_price DECIMAL(10, 2);
    DECLARE discount DECIMAL(10, 2);

    -- Variables for membership, time, and pricing
    DECLARE is_member BOOL;
    DECLARE member_id INT;
    DECLARE v_employee_id INT;
    DECLARE random_hour INT;
    DECLARE random_minute INT;
    DECLARE random_second INT;
    DECLARE entry_seconds INT;
    DECLARE exit_seconds INT;
    DECLARE ticket_type_roll DECIMAL(4, 2);
    DECLARE promo_percent DECIMAL(10, 2);
    DECLARE adult_price DECIMAL(10, 2) DEFAULT 109.00;
    DECLARE child_price DECIMAL(10, 2) DEFAULT 99.00;
    DECLARE senior_price DECIMAL(10, 2) DEFAULT 89.00;

    -- Optimization: Variables for random indexed selection
    DECLARE max_member_row_id INT;
    DECLARE max_staff_row_id INT;
    DECLARE random_row_id INT;
    
    -- OPTIMIZATION: Batching variables
    DECLARE batch_size INT DEFAULT 50000; -- Commit every 50,000 rows
    DECLARE batch_counter INT DEFAULT 0;

    -- Set the start and end dates for the target year
    SET v_year_start_date = CONCAT(start_year, '-01-01');
    SET v_year_end_date = CONCAT(start_year, '-12-31');

    -- --- Temporary Table Setup (OPTIMIZED) ---

    DROP TEMPORARY TABLE IF EXISTS high_traffic_dates;
    CREATE TEMPORARY TABLE high_traffic_dates ( traffic_date DATE PRIMARY KEY );
    INSERT INTO high_traffic_dates (traffic_date) VALUES
    (CONCAT(start_year, '-01-01')), (CONCAT(start_year, '-03-15')), (CONCAT(start_year, '-03-22')), (CONCAT(start_year, '-04-20')),
    (CONCAT(start_year, '-05-26')), (CONCAT(start_year, '-07-04')), (CONCAT(start_year, '-09-01')), (CONCAT(start_year, '-11-27')),
    (CONCAT(start_year, '-11-28')), (CONCAT(start_year, '-12-24')), (CONCAT(start_year, '-12-25')), (CONCAT(start_year, '-12-31'));

    DROP TEMPORARY TABLE IF EXISTS daily_traffic_score;
    CREATE TEMPORARY TABLE daily_traffic_score (
        dat_date DATE PRIMARY KEY,
        score DECIMAL(5, 2),
        cumulative_score DECIMAL(10, 2)
    );

    DROP TEMPORARY TABLE IF EXISTS temp_active_members;
    CREATE TEMPORARY TABLE temp_active_members (
        id INT AUTO_INCREMENT PRIMARY KEY,
        membership_id INT NOT NULL
    );
    INSERT INTO temp_active_members (membership_id)
    SELECT membership_id FROM membership WHERE end_date >= v_year_start_date;

    DROP TEMPORARY TABLE IF EXISTS temp_staff_employees;
    CREATE TEMPORARY TABLE temp_staff_employees (
        id INT AUTO_INCREMENT PRIMARY KEY,
        employee_id INT NOT NULL
    );
    INSERT INTO temp_staff_employees (employee_id)
    SELECT employee_id FROM employee_demographics
    WHERE employee_type = 'Staff' AND is_active = TRUE;
    
    -- OPTIMIZATION: Pre-cache active promotions
    DROP TEMPORARY TABLE IF EXISTS temp_active_promotions;
    CREATE TEMPORARY TABLE temp_active_promotions (
        start_date DATE,
        end_date DATE,
        discount_percent DECIMAL(10, 2),
        PRIMARY KEY (start_date, end_date) -- Create a key for fast lookups
    );
    INSERT INTO temp_active_promotions (start_date, end_date, discount_percent)
    SELECT start_date, end_date, discount_percent
    FROM event_promotions
    WHERE end_date >= v_year_start_date; -- Get all promos active at any point in the year

    -- Get max row counts ONCE
    SELECT COUNT(*) INTO max_member_row_id FROM temp_active_members;
    SELECT COUNT(*) INTO max_staff_row_id FROM temp_staff_employees;

    -- --- Calculate Daily Traffic Scores ---
    
    SET v_current_date = v_year_start_date;
    WHILE v_current_date <= v_year_end_date DO
        SET score_multiplier = 1.0;
        SET day_of_week = DAYOFWEEK(v_current_date);
        SET month_num = MONTH(v_current_date);
        SET is_holiday = FALSE;

        IF month_num IN (6, 7, 8) THEN SET score_multiplier = score_multiplier + 3.0; END IF;
        IF day_of_week IN (1, 7) THEN SET score_multiplier = score_multiplier + 2.0; END IF;
        SELECT EXISTS(SELECT 1 FROM high_traffic_dates WHERE traffic_date = v_current_date) INTO is_holiday;
        IF is_holiday THEN SET score_multiplier = score_multiplier + 4.0; END IF;

        INSERT INTO daily_traffic_score (dat_date, score, cumulative_score)
        VALUES (v_current_date, score_multiplier, 0.0);
        SET v_current_date = DATE_ADD(v_current_date, INTERVAL 1 DAY);
    END WHILE;

    SET @running_total := 0;
    UPDATE daily_traffic_score
    SET cumulative_score = (@running_total := @running_total + score)
    ORDER BY dat_date;
    SELECT MAX(cumulative_score) INTO total_score FROM daily_traffic_score;

    -- --- Main Generation Loop (OPTIMIZED) ---
    
    -- Start the *first* batch transaction
    START TRANSACTION;
    
    WHILE i < num_visits DO

        -- Select a random date based on weighted score
        SET random_score_target = RAND() * total_score;
        SELECT dat_date INTO v_current_date
        FROM daily_traffic_score
        WHERE cumulative_score >= random_score_target
        ORDER BY dat_date
        LIMIT 1;

        -- Generate random time
        SET random_hour = FLOOR(8 + RAND() * 8); 
        SET random_minute = FLOOR(RAND() * 60);
        SET random_second = FLOOR(RAND() * 60);
        SET visit_date_time = CONCAT(v_current_date, ' ', LPAD(random_hour, 2, '0'), ':', LPAD(random_minute, 2, '0'), ':', LPAD(random_second, 2, '0'));

        -- Calculate exit time
        SET entry_seconds = TIME_TO_SEC(TIME(visit_date_time));
        SET exit_seconds = entry_seconds + (FLOOR(4 + RAND() * 7) * 3600);
        IF exit_seconds > TIME_TO_SEC('23:00:00') THEN SET exit_seconds = TIME_TO_SEC('23:00:00'); END IF;
        SET exit_time_str = SEC_TO_TIME(exit_seconds);

        -- Determine ticket type
        SET ticket_type_roll = RAND();
        SET is_member = FALSE;
        SET member_id = NULL;

        IF ticket_type_roll < 0.20 THEN
            SET ticket_id = 1; SET is_member = TRUE; SET final_price = 0.00;
        ELSEIF ticket_type_roll < 0.70 THEN
            SET ticket_id = 2; SET final_price = adult_price;
        ELSEIF ticket_type_roll < 0.90 THEN
            SET ticket_id = 3; SET final_price = child_price;
        ELSE
            SET ticket_id = 4; SET final_price = senior_price;
        END IF;

        SET discount = 0.00;
        SET promo_percent = 0.00;

        IF is_member THEN
            -- Get random member from temp table
            IF max_member_row_id > 0 THEN
                SET random_row_id = FLOOR(1 + RAND() * max_member_row_id);
                SELECT membership_id INTO member_id FROM temp_active_members WHERE id = random_row_id;
            END IF;
        ELSE
            -- OPTIMIZATION: Get promotion from temp table
            SELECT COALESCE(MAX(discount_percent), 0.00) INTO promo_percent
            FROM temp_active_promotions
            WHERE v_current_date BETWEEN start_date AND end_date;

            IF promo_percent > 0.00 THEN
                SET discount = final_price * (promo_percent / 100.0);
            END IF;
            SET final_price = final_price - discount; 
        END IF;

        -- Get random staff from temp table
        IF max_staff_row_id > 0 THEN
            SET random_row_id = FLOOR(1 + RAND() * max_staff_row_id);
            SELECT employee_id INTO v_employee_id FROM temp_staff_employees WHERE id = random_row_id;
        ELSE
            SET v_employee_id = NULL;
        END IF;
        
        -- Insert the visit record
        INSERT INTO visits (membership_id, visit_date, exit_time, ticket_type_id, ticket_price, discount_amount, logged_by_employee_id)
        VALUES (member_id, visit_date_time, exit_time_str, ticket_id, final_price, discount, v_employee_id);

        SET i = i + 1;
        SET batch_counter = batch_counter + 1;
        
        -- OPTIMIZATION: Check if the batch is full
        IF batch_counter = batch_size THEN
            COMMIT; -- Commit the current batch
            SET batch_counter = 0; -- Reset counter
            START TRANSACTION; -- Start the next batch
        END IF;
        
    END WHILE;

    -- Commit any remaining rows (the final, partial batch)
    COMMIT;

    -- Clean up temporary tables
    DROP TEMPORARY TABLE IF EXISTS high_traffic_dates;
    DROP TEMPORARY TABLE IF EXISTS daily_traffic_score;
    DROP TEMPORARY TABLE IF EXISTS temp_active_members;
    DROP TEMPORARY TABLE IF EXISTS temp_staff_employees;
    DROP TEMPORARY TABLE IF EXISTS temp_active_promotions;

END //

DELIMITER ;

-- --- Execution and Cleanup Script ---

SET SQL_SAFE_UPDATES = 0;
DELETE FROM daily_ride WHERE YEAR(dat_date) = 2025;
DELETE FROM daily_stats WHERE YEAR(date_rec) = 2025;
DELETE FROM visits WHERE YEAR(visit_date) = 2025;

-- Call the procedure (e.g., for 10 million visits)
CALL GenerateVisits(10000, 2025);

-- Update daily_stats with the newly generated visitor counts
INSERT INTO daily_stats (date_rec, visitor_count)
SELECT
    DATE(visit_date),
    COUNT(visit_id)
FROM visits
WHERE YEAR(visit_date) = 2025
GROUP BY DATE(visit_date)
ON DUPLICATE KEY UPDATE
    visitor_count = VALUES(visitor_count);

INSERT INTO daily_stats (date_rec, visitor_count)
SELECT
    DATE(visit_date),
    COUNT(visit_id)
FROM visits
WHERE YEAR(visit_date) = 2025 -- Ensure only newly generated data is aggregated
GROUP BY DATE(visit_date)
ON DUPLICATE KEY UPDATE
    visitor_count = VALUES(visitor_count);
    
CALL GenerateRideLogs(2025, 100);

SET SQL_SAFE_UPDATES = 1;