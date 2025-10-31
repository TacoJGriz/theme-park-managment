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

    -- Variables for traffic scoring and weighted date selection
    DECLARE score_multiplier DECIMAL(5, 2);
    DECLARE day_of_week INT;
    DECLARE month_num INT;
    DECLARE is_holiday BOOL;
    DECLARE total_score DECIMAL(10, 2);
    DECLARE random_score_target DECIMAL(10, 2);
    DECLARE accumulated_score DECIMAL(10, 2);
    
    -- Variables for visit details
    DECLARE visit_date_time DATETIME;
    DECLARE exit_time_str TIME;
    DECLARE ticket_id INT;
    DECLARE final_price DECIMAL(10, 2);
    DECLARE discount DECIMAL(10, 2);

    -- Variables for membership, time calculation, and pricing
    DECLARE is_member BOOL;
    DECLARE member_id INT;
    DECLARE random_hour INT;
    DECLARE random_minute INT;
    DECLARE random_second INT;
    DECLARE entry_seconds INT;
    DECLARE exit_seconds INT;
    DECLARE ticket_type_roll DECIMAL(4, 2);
    DECLARE promo_percent DECIMAL(10, 2);
    -- Assume these prices are retrieved from a 'ticket_prices' table in a real app
    DECLARE adult_price DECIMAL(10, 2) DEFAULT 109.00;
    DECLARE child_price DECIMAL(10, 2) DEFAULT 99.00;
    DECLARE senior_price DECIMAL(10, 2) DEFAULT 89.00;

    -- Set the start and end dates for the target year
    SET v_year_start_date = CONCAT(start_year, '-01-01');
    SET v_year_end_date = CONCAT(start_year, '-12-31');

    -- --- Temporary Table Setup ---

    -- Create temporary table to store high traffic/holiday dates
    DROP TEMPORARY TABLE IF EXISTS high_traffic_dates;
    CREATE TEMPORARY TABLE high_traffic_dates (
        traffic_date DATE PRIMARY KEY
    );
    -- FIX: Use the start_year parameter to dynamically generate holiday dates
    -- Insert specific high-traffic dates for weighted selection
    INSERT INTO high_traffic_dates (traffic_date) VALUES
    (CONCAT(start_year, '-01-01')), (CONCAT(start_year, '-03-15')), (CONCAT(start_year, '-03-22')), (CONCAT(start_year, '-04-20')),
    (CONCAT(start_year, '-05-26')), (CONCAT(start_year, '-07-04')), (CONCAT(start_year, '-09-01')), (CONCAT(start_year, '-11-27')),
    (CONCAT(start_year, '-11-28')), (CONCAT(start_year, '-12-24')), (CONCAT(start_year, '-12-25')), (CONCAT(start_year, '-12-31'));

    -- Create temporary table to calculate daily traffic scores for weighted selection
    DROP TEMPORARY TABLE IF EXISTS daily_traffic_score;
    CREATE TEMPORARY TABLE daily_traffic_score (
        dat_date DATE PRIMARY KEY,
        score DECIMAL(5, 2),
        cumulative_score DECIMAL(10, 2)
    );

    -- --- Calculate Daily Traffic Scores ---
    
    SET v_current_date = v_year_start_date;
    WHILE v_current_date <= v_year_end_date DO
        SET score_multiplier = 1.0;
        SET day_of_week = DAYOFWEEK(v_current_date);
        SET month_num = MONTH(v_current_date);
        SET is_holiday = FALSE;

        -- Boost score for summer months (June, July, August)
        IF month_num IN (6, 7, 8) THEN
            SET score_multiplier = score_multiplier + 3.0;
        END IF;

        -- Boost score for weekends
        IF day_of_week IN (1, 7) THEN -- 1=Sunday, 7=Saturday
            SET score_multiplier = score_multiplier + 2.0;
        END IF;

        -- Boost score for designated holidays
        SELECT EXISTS(SELECT 1 FROM high_traffic_dates WHERE traffic_date = v_current_date) INTO is_holiday;
        IF is_holiday THEN
            SET score_multiplier = score_multiplier + 4.0;
        END IF;

        INSERT INTO daily_traffic_score (dat_date, score, cumulative_score)
        VALUES (v_current_date, score_multiplier, 0.0);

        SET v_current_date = DATE_ADD(v_current_date, INTERVAL 1 DAY);
    END WHILE;

    -- Calculate the cumulative score for weighted random selection
    SET @running_total := 0;
    UPDATE daily_traffic_score
    SET cumulative_score = (@running_total := @running_total + score)
    ORDER BY dat_date;

    -- Get the grand total score for the random target calculation
    SELECT MAX(cumulative_score) INTO total_score FROM daily_traffic_score;

    -- --- Main Generation Loop ---
    
    WHILE i < num_visits DO

        -- Select a random target score (0 to total_score)
        SET random_score_target = RAND() * total_score;

        -- Find the date based on the weighted random selection (efficient selection)
        SELECT dat_date INTO v_current_date
        FROM daily_traffic_score
        WHERE cumulative_score >= random_score_target
        ORDER BY dat_date
        LIMIT 1;

        -- OPTIMIZATION: Generate random entry time (8 AM to 3 PM for an 8-hour entry window)
        SET random_hour = FLOOR(8 + RAND() * 8); 
        SET random_minute = FLOOR(RAND() * 60);
        SET random_second = FLOOR(RAND() * 60);
        SET visit_date_time = CONCAT(v_current_date, ' ', LPAD(random_hour, 2, '0'), ':', LPAD(random_minute, 2, '0'), ':', LPAD(random_second, 2, '0'));

        -- Calculate random exit time (stay duration 4 to 10 hours, capped at 11 PM)
        SET entry_seconds = TIME_TO_SEC(TIME(visit_date_time));
        SET exit_seconds = entry_seconds + (FLOOR(4 + RAND() * 7) * 3600); -- 4 to 10 hours
        IF exit_seconds > TIME_TO_SEC('23:00:00') THEN
            SET exit_seconds = TIME_TO_SEC('23:00:00');
        END IF;
        SET exit_time_str = SEC_TO_TIME(exit_seconds);

        -- Randomly determine ticket type distribution
        SET ticket_type_roll = RAND();
        SET is_member = FALSE;
        SET member_id = NULL;

        IF ticket_type_roll < 0.20 THEN
            SET ticket_id = 1; -- Member (20%)
            SET is_member = TRUE;
            SET final_price = 0.00;
        ELSEIF ticket_type_roll < 0.70 THEN
            SET ticket_id = 2; -- Adult (50%)
            SET final_price = adult_price;
        ELSEIF ticket_type_roll < 0.90 THEN
            SET ticket_id = 3; -- Child (20%)
            SET final_price = child_price;
        ELSE
            SET ticket_id = 4; -- Senior (10%)
            SET final_price = senior_price;
        END IF;

        SET discount = 0.00;
        SET promo_percent = 0.00;

        -- Handle member assignment or promotion calculation
        IF is_member THEN
            -- Assign a random existing member ID if the ticket is a member ticket
            SELECT membership_id INTO member_id
            FROM membership
            ORDER BY RAND()
            LIMIT 1;
        ELSE
            -- Check for applicable promotions for non-members on the current date
            SELECT COALESCE(MAX(discount_percent), 0.00) INTO promo_percent
            FROM event_promotions
            WHERE v_current_date BETWEEN start_date AND end_date;

            IF promo_percent > 0.00 THEN
                SET discount = final_price * (promo_percent / 100.0);
                SET final_price = final_price - discount; -- Calculate final ticket price
            END IF;
        END IF;

        -- Insert the visit record
        INSERT INTO visits (membership_id, visit_date, exit_time, ticket_type_id, ticket_price, discount_amount)
        VALUES (
            member_id,
            visit_date_time,
            exit_time_str,
            ticket_id,
            final_price,
            discount
        );

        SET i = i + 1;
    END WHILE;

    -- Clean up temporary tables
    DROP TEMPORARY TABLE IF EXISTS high_traffic_dates;
    DROP TEMPORARY TABLE IF EXISTS daily_traffic_score;

END //

DELIMITER ;

-- --- Execution and Cleanup Script (FIXED ORDER) ---

-- Disable safe update mode for bulk deletion operations
SET SQL_SAFE_UPDATES = 0;

-- **STEP 1: Delete child records (daily_ride) referencing daily_stats.**
-- This must run first to prevent the Error Code 1451.
DELETE FROM daily_ride WHERE YEAR(dat_date) = 2025;

-- **STEP 2: Delete parent records (daily_stats).**
DELETE FROM daily_stats WHERE YEAR(date_rec) = 2025;

-- **STEP 3: Delete related records (visits).**
DELETE FROM visits WHERE YEAR(visit_date) = 2025;

-- Execute the procedure to generate the specified number of visits
CALL GenerateVisits(1000, 2025);

-- Update daily_stats with the newly generated visitor counts
INSERT INTO daily_stats (date_rec, visitor_count)
SELECT
    DATE(visit_date),
    COUNT(visit_id)
FROM visits
WHERE YEAR(visit_date) = 2025 -- Ensure only newly generated data is aggregated
GROUP BY DATE(visit_date)
ON DUPLICATE KEY UPDATE
    visitor_count = VALUES(visitor_count);

-- Re-enable safe update mode
SET SQL_SAFE_UPDATES = 1;