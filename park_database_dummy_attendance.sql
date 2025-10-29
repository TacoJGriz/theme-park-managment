-- =================================================================================================
-- VISITS GENERATOR SCRIPT (FIXED)
-- Generates 1000 random visit records spread over a year (365 days)
-- with probability adjustments for: Summer Months, Weekends, and Holidays.
-- =================================================================================================

USE park_database;

-- Drop the procedure if it already exists
DROP PROCEDURE IF EXISTS GenerateVisits;

-- Delimiter change allows the creation of a stored procedure
DELIMITER //

CREATE PROCEDURE GenerateVisits(
    IN num_visits INT,
    IN start_year INT
)
BEGIN
    -- --- 1. ALL GENERAL VARIABLES MUST BE DECLARED FIRST ---
    
    -- Counters/Core Variables
    DECLARE i INT DEFAULT 0;
    DECLARE start_date DATE;
    DECLARE end_date DATE;
    DECLARE current_date DATE;
    
    -- Traffic calculation variables
    DECLARE score_multiplier DECIMAL(5, 2) DEFAULT 1.0;
    DECLARE day_of_week INT;
    DECLARE month_num INT;
    DECLARE is_holiday BOOL DEFAULT FALSE;
    DECLARE total_score DECIMAL(10, 2);
    DECLARE random_score_target DECIMAL(10, 2);
    DECLARE accumulated_score DECIMAL(10, 2) DEFAULT 0.0;
    
    -- Visit data variables
    DECLARE visit_date_time DATETIME;
    DECLARE exit_time_str TIME;
    DECLARE ticket_id INT;
    DECLARE final_price DECIMAL(10, 2);
    DECLARE discount DECIMAL(10, 2);
    DECLARE is_member BOOL;
    DECLARE member_id INT;
    
    -- Time generation variables (MOVED HERE)
    DECLARE random_hour INT;
    DECLARE random_minute INT;
    DECLARE random_second INT;
    DECLARE entry_seconds INT;
    DECLARE exit_seconds INT;
    
    -- Price/Discount calculation variables (MOVED HERE)
    DECLARE ticket_type_roll DECIMAL(4, 2);
    DECLARE promo_percent DECIMAL(10, 2) DEFAULT 0.00;
    
    -- Ticket price constants (IDs 2, 3, 4 from dummy data)
    DECLARE adult_price DECIMAL(10, 2) DEFAULT 109.00;
    DECLARE child_price DECIMAL(10, 2) DEFAULT 99.00;
    DECLARE senior_price DECIMAL(10, 2) DEFAULT 89.00;

    -- --- 2. SETUP DATES ---
    SET start_date = CONCAT(start_year, '-01-01');
    SET end_date = CONCAT(start_year, '-12-31');

    -- --- 3. DEFINE HIGH-TRAFFIC DATES (Holidays/Events for 2025) ---
    DROP TEMPORARY TABLE IF EXISTS high_traffic_dates;
    CREATE TEMPORARY TABLE high_traffic_dates (
        traffic_date DATE PRIMARY KEY
    );
    INSERT INTO high_traffic_dates (traffic_date) VALUES
    ('2025-01-01'), ('2025-03-15'), ('2025-03-22'), ('2025-04-20'), 
    ('2025-05-26'), ('2025-07-04'), ('2025-09-01'), ('2025-11-27'), 
    ('2025-11-28'), ('2025-12-24'), ('2025-12-25'), ('2025-12-31');

    -- --- 4. CALCULATE DAILY TRAFFIC SCORE ---
    DROP TEMPORARY TABLE IF EXISTS daily_traffic_score;
    CREATE TEMPORARY TABLE daily_traffic_score (
        dat_date DATE PRIMARY KEY,
        score DECIMAL(5, 2),
        cumulative_score DECIMAL(10, 2)
    );

    SET current_date = start_date;
    WHILE current_date <= end_date DO
        SET score_multiplier = 1.0;
        SET day_of_week = DAYOFWEEK(current_date); -- 1=Sunday, 7=Saturday
        SET month_num = MONTH(current_date);
        
        -- Summer (June=6, July=7, August=8)
        IF month_num IN (6, 7, 8) THEN
            SET score_multiplier = score_multiplier + 3.0;
        END IF;
        
        -- Weekend (Saturday=7, Sunday=1)
        IF day_of_week IN (1, 7) THEN
            SET score_multiplier = score_multiplier + 2.0;
        END IF;
        
        -- Specific Holidays/Events
        SELECT EXISTS(SELECT 1 FROM high_traffic_dates WHERE traffic_date = current_date) INTO is_holiday;
        IF is_holiday THEN
            SET score_multiplier = score_multiplier + 4.0;
        END IF;
        
        -- Insert the calculated score
        INSERT INTO daily_traffic_score (dat_date, score, cumulative_score) 
        VALUES (current_date, score_multiplier, 0.0);
        
        SET current_date = DATE_ADD(current_date, INTERVAL 1 DAY);
    END WHILE;

    -- Calculate cumulative scores and total score for weighted random selection
    -- Update cumulative score using a single UPDATE statement (most efficient way to get cumulative sum)
    SET accumulated_score = 0.0;
    
    UPDATE daily_traffic_score dst
    SET cumulative_score = (
        SELECT SUM(score)
        FROM daily_traffic_score sub
        WHERE sub.dat_date <= dst.dat_date
    );
    
    -- Get the grand total score (max cumulative score)
    SELECT MAX(cumulative_score) INTO total_score FROM daily_traffic_score;
    
    -- --- 5. LOOP TO INSERT VISITS ---
    WHILE i < num_visits DO
        
        -- 1. Pick a random date weighted by its cumulative score
        SET random_score_target = RAND() * total_score;
        
        SELECT dat_date INTO current_date
        FROM daily_traffic_score
        WHERE cumulative_score >= random_score_target
        ORDER BY cumulative_score
        LIMIT 1;

        -- 2. Generate random time for visit_date (Entry Time: 8 AM to 4 PM)
        SET random_hour = FLOOR(8 + RAND() * 9); -- 8 to 16 (4 PM)
        SET random_minute = FLOOR(RAND() * 60);
        SET random_second = FLOOR(RAND() * 60);
        
        SET visit_date_time = CONCAT(current_date, ' ', LPAD(random_hour, 2, '0'), ':', LPAD(random_minute, 2, '0'), ':', LPAD(random_second, 2, '0'));

        -- 3. Generate random exit time (4 to 10 hours later, max 11 PM)
        SET entry_seconds = TIME_TO_SEC(TIME(visit_date_time));
        SET exit_seconds = entry_seconds + (FLOOR(4 + RAND() * 7) * 3600);
        
        IF exit_seconds > TIME_TO_SEC('23:00:00') THEN
            SET exit_seconds = TIME_TO_SEC('23:00:00');
        END IF;
        
        SET exit_time_str = SEC_TO_TIME(exit_seconds);

        -- 4. Determine Ticket Type (20% Member, 50% Adult, 20% Child, 10% Senior)
        SET ticket_type_roll = RAND();
        
        SET is_member = FALSE;
        SET member_id = NULL;
        
        IF ticket_type_roll < 0.20 THEN
            -- Member (ID 1)
            SET ticket_id = 1;
            SET is_member = TRUE;
            SET final_price = 0.00;
        ELSEIF ticket_type_roll < 0.70 THEN
            -- Adult (ID 2)
            SET ticket_id = 2;
            SET final_price = adult_price;
        ELSEIF ticket_type_roll < 0.90 THEN
            -- Child (ID 3)
            SET ticket_id = 3;
            SET final_price = child_price;
        ELSE
            -- Senior (ID 4)
            SET ticket_id = 4;
            SET final_price = senior_price;
        END IF;
        
        -- 5. Calculate Discount and Member Assignment
        SET discount = 0.00;

        IF is_member THEN
            -- Assign a random existing membership ID
            SELECT membership_id INTO member_id
            FROM membership
            ORDER BY RAND()
            LIMIT 1;
        ELSE
            -- Apply promotion to non-member tickets
            SET promo_percent = 0.00;
            SELECT discount_percent INTO promo_percent
            FROM event_promotions
            WHERE current_date BETWEEN start_date AND end_date
            ORDER BY discount_percent DESC
            LIMIT 1;

            IF promo_percent > 0.00 THEN
                SET discount = final_price * (promo_percent / 100.0);
            END IF;
        END IF;

        -- 6. Insert the visit record
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
    
    DROP TEMPORARY TABLE IF EXISTS high_traffic_dates;
    DROP TEMPORARY TABLE IF EXISTS daily_traffic_score;

END //

-- Change delimiter back to standard
DELIMITER ;

-- =================================================================================================
-- EXECUTION
-- =================================================================================================

-- Delete old, auto-generated visits (keeping the first 5 hand-entered records from the dummy data file)
DELETE FROM visits WHERE visit_id > 5;
-- Deleting daily stats entries generated after the last entry in park_database_dummy_data.sql
DELETE FROM daily_stats WHERE date_rec > '2025-10-25';

-- Call the procedure to generate 1000 visits starting from the beginning of 2025
CALL GenerateVisits(1000, 2025);

-- After generating visits, refresh the Daily Stats table (required if no trigger exists)
INSERT INTO daily_stats (date_rec, visitor_count)
SELECT 
    DATE(visit_date), 
    COUNT(visit_id)
FROM visits
GROUP BY DATE(visit_date)
ON DUPLICATE KEY UPDATE 
    visitor_count = VALUES(visitor_count);

-- End of script marker
SELECT 'Successfully generated 1000 visits data with seasonal spikes for 2025.' AS Status;
