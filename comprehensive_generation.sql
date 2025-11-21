DROP PROCEDURE IF EXISTS GenerateHistoricalData;

DELIMITER //

-- Stored procedure to generate daily historical data for attendance and ride usage
CREATE PROCEDURE GenerateHistoricalData(
    IN p_start_year INT,
    IN p_end_year INT,
    IN p_base_daily_visitors INT
)
BEGIN
    -- Declare variables for date tracking and loop control
    DECLARE v_date DATE;
    DECLARE v_end_date DATE;
    DECLARE i INT;

    -- Declare variables for weather simulation and its impact
    DECLARE v_weather_type ENUM('Rain', 'Thunderstorm', 'Tornado Warning', 'Heatwave', 'Other');
    DECLARE v_weather_multiplier DECIMAL(5, 2) DEFAULT 1.0;
    DECLARE v_park_closure BOOL DEFAULT FALSE;
    DECLARE v_month INT;
    DECLARE v_dow INT;
    DECLARE v_roll DECIMAL(5, 4);

    -- Declare variables for calculating attendance
    DECLARE v_day_score DECIMAL(5, 2);
    DECLARE v_month_score DECIMAL(5, 2);
    DECLARE v_holiday_score DECIMAL(5, 2);
    DECLARE v_total_visitors_today INT;

    -- Declare variables for generating individual visits
    DECLARE v_is_member BOOL;
    DECLARE v_member_id INT;
    DECLARE v_staff_id INT;
    DECLARE v_ticket_type_id INT;
    DECLARE v_base_price DECIMAL(10, 2);
    DECLARE v_discount DECIMAL(10, 2);
    DECLARE v_promo_percent DECIMAL(5, 2);
    DECLARE v_visit_datetime DATETIME;
    DECLARE v_visit_group_id VARCHAR(36);

    -- Declare variables for ride usage calculation
    DECLARE v_ride_id INT;
    DECLARE v_ride_type VARCHAR(50);
    DECLARE v_capacity INT;
    DECLARE v_ride_status ENUM('OPEN', 'CLOSED', 'BROKEN', 'WEATHER CLOSURE');
    DECLARE v_ride_weather_mult DECIMAL(5, 2);
    DECLARE v_total_riders INT;
    DECLARE v_total_runs INT;
    DECLARE done INT DEFAULT FALSE;

    -- Declare variables for maximum IDs in temporary tables
    DECLARE max_member_id INT;
    DECLARE max_staff_id INT;

    -- Declare cursor for iterating through rides
    DECLARE ride_cursor CURSOR FOR
        SELECT ride_id, ride_type, capacity, ride_status FROM temp_rides;

    -- Define handler for cursor completion
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;

    -- Clean up existing historical data in main tables
    SET SQL_SAFE_UPDATES = 0;
    DELETE FROM daily_ride WHERE YEAR(dat_date) BETWEEN p_start_year AND p_end_year;
    DELETE FROM daily_stats WHERE YEAR(date_rec) BETWEEN p_start_year AND p_end_year;
    DELETE FROM visits WHERE YEAR(visit_date) BETWEEN p_start_year AND p_end_year;
    DELETE FROM weather_events WHERE YEAR(event_date) BETWEEN p_start_year AND p_end_year;
    SET SQL_SAFE_UPDATES = 1;

    -- Create and populate temporary tables for efficient data lookup

    -- Temporary table for holiday dates
    DROP TEMPORARY TABLE IF EXISTS temp_holidays;
    CREATE TEMPORARY TABLE temp_holidays ( h_date DATE PRIMARY KEY );

    -- Loop to insert fixed holiday dates for the range of years
    SET i = p_start_year;
    WHILE i <= p_end_year DO
        INSERT IGNORE INTO temp_holidays (h_date) VALUES
        (CONCAT(i, '-01-01')), (CONCAT(i, '-05-25')), (CONCAT(i, '-07-04')),
        (CONCAT(i, '-09-01')), (CONCAT(i, '-10-31')), (CONCAT(i, '-11-28')),
        (CONCAT(i, '-12-24')), (CONCAT(i, '-12-25')), (CONCAT(i, '-12-31'));
        SET i = i + 1;
    END WHILE;

    -- Temporary table for active member IDs
    DROP TEMPORARY TABLE IF EXISTS temp_active_members;
    CREATE TEMPORARY TABLE temp_active_members ( id INT AUTO_INCREMENT PRIMARY KEY, membership_id INT );
    INSERT INTO temp_active_members (membership_id)
    SELECT membership_id FROM membership WHERE end_date >= CONCAT(p_start_year, '-01-01');

    -- Temporary table for active staff employee IDs
    DROP TEMPORARY TABLE IF EXISTS temp_staff_employees;
    CREATE TEMPORARY TABLE temp_staff_employees ( id INT AUTO_INCREMENT PRIMARY KEY, employee_id INT );
    INSERT INTO temp_staff_employees (employee_id)
    SELECT employee_id FROM employee_demographics WHERE employee_type = 'Staff' AND is_active = TRUE;

    -- Temporary table for non-member ticket types and prices
    DROP TEMPORARY TABLE IF EXISTS temp_ticket_types;
    CREATE TEMPORARY TABLE temp_ticket_types ( ticket_type_id INT, base_price DECIMAL(10, 2) );
    INSERT INTO temp_ticket_types (ticket_type_id, base_price)
    SELECT ticket_type_id, base_price FROM ticket_types WHERE is_member_type = FALSE AND is_active = TRUE;

    -- Temporary table for active promotions
    DROP TEMPORARY TABLE IF EXISTS temp_active_promotions;
    CREATE TEMPORARY TABLE temp_active_promotions ( start_date DATE, end_date DATE, discount_percent DECIMAL(5, 2), PRIMARY KEY (start_date, end_date) );
    INSERT INTO temp_active_promotions (start_date, end_date, discount_percent)
    SELECT start_date, end_date, discount_percent FROM event_promotions;

    -- Temporary table for ride data
    DROP TEMPORARY TABLE IF EXISTS temp_rides;
    CREATE TEMPORARY TABLE temp_rides ( ride_id INT PRIMARY KEY, ride_type VARCHAR(50), capacity INT, ride_status ENUM('OPEN', 'CLOSED', 'BROKEN', 'WEATHER CLOSURE') );
    INSERT INTO temp_rides (ride_id, ride_type, capacity, ride_status)
    SELECT ride_id, ride_type, capacity, ride_status FROM rides;

    -- Get max IDs for random selection efficiency
    SELECT COUNT(*) INTO max_member_id FROM temp_active_members;
    SELECT COUNT(*) INTO max_staff_id FROM temp_staff_employees;

    -- Batch insert table for daily visits
    DROP TEMPORARY TABLE IF EXISTS temp_visits_batch;
    CREATE TEMPORARY TABLE temp_visits_batch (
        batch_id INT AUTO_INCREMENT PRIMARY KEY,
        membership_id INT,
        visit_date DATETIME,
        ticket_type_id INT NOT NULL,
        ticket_price DECIMAL(10,2) NULL,
        discount_amount DECIMAL(10,2) NULL,
        logged_by_employee_id INT,
        visit_group_id VARCHAR(36)
    );

    -- Batch insert table for daily ride metrics
    DROP TEMPORARY TABLE IF EXISTS temp_ride_batch;
    CREATE TEMPORARY TABLE temp_ride_batch (
        ride_id INT NOT NULL,
        dat_date DATE NOT NULL,
        run_count INT UNSIGNED DEFAULT 0,
        ride_count INT UNSIGNED DEFAULT 0,
        PRIMARY KEY (ride_id, dat_date)
    );

    -- Main daily data generation loop
    SET v_date = CONCAT(p_start_year, '-01-01');
    SET v_end_date = CONCAT(p_end_year, '-12-31');

    day_loop: LOOP
        -- Exit loop when end date is reached
        IF v_date > v_end_date THEN
            LEAVE day_loop;
        END IF;

        -- A. Determine weather conditions and park closure
        SET v_weather_type = NULL;
        SET v_weather_multiplier = 1.0;
        SET v_park_closure = FALSE;
        SET v_month = MONTH(v_date);
        SET v_roll = RAND();

        -- Logic for summer months (June, July, August)
        IF v_month IN (6, 7, 8) THEN
            IF v_roll < 0.03 THEN SET v_weather_type = 'Thunderstorm'; SET v_weather_multiplier = 0.2; SET v_park_closure = TRUE;
            ELSEIF v_roll < 0.08 THEN SET v_weather_type = 'Heatwave'; SET v_weather_multiplier = 0.8;
            ELSEIF v_roll < 0.18 THEN SET v_weather_type = 'Rain'; SET v_weather_multiplier = 0.6;
            END IF;
        -- Logic for shoulder season (March-May, September-October)
        ELSEIF v_month IN (3, 4, 5, 9, 10) THEN
            IF v_roll < 0.02 THEN SET v_weather_type = 'Thunderstorm'; SET v_weather_multiplier = 0.3; SET v_park_closure = TRUE;
            ELSEIF v_roll < 0.12 THEN SET v_weather_type = 'Rain'; SET v_weather_multiplier = 0.7;
            END IF;
        END IF;

        -- Insert a new weather event record if one occurred
        IF v_weather_type IS NOT NULL THEN
            INSERT INTO weather_events (event_date, end_time, weather_type, park_closure)
            VALUES (CONCAT(v_date, ' 14:00:00'), CONCAT(v_date, ' 16:00:00'), v_weather_type, v_park_closure);
        END IF;

        -- B. Calculate projected total visitor count for the day
        SET v_dow = DAYOFWEEK(v_date);
        -- Apply multiplier based on Day of Week (Saturday > Sunday > Friday > Weekdays)
        SET v_day_score = CASE WHEN v_dow = 7 THEN 2.5 WHEN v_dow = 1 THEN 2.0 WHEN v_dow = 6 THEN 1.5 ELSE 1.0 END;
        -- Apply multiplier based on Month (Summer > Spring/Fall/Winter Holiday > Winter)
        SET v_month_score = CASE WHEN v_month IN (6, 7, 8) THEN 1.8 WHEN v_month IN (3, 4, 10) THEN 1.2 WHEN v_month = 12 THEN 1.5 ELSE 0.9 END;

        -- Apply high multiplier if the day is a fixed holiday
        SET v_holiday_score = 1.0;
        IF EXISTS(SELECT 1 FROM temp_holidays WHERE h_date = v_date) THEN SET v_holiday_score = 3.0; END IF;

        -- Calculate final visitor count with all multipliers and a random variance
        SET v_total_visitors_today = FLOOR(p_base_daily_visitors * v_day_score * v_month_score * v_holiday_score * v_weather_multiplier * (0.85 + (RAND() * 0.3)));

        -- C. Generate individual visit records (Member and Single-Day Tickets)
        SET i = 0;
        -- Check for active promotions and get the maximum discount percentage
        SELECT COALESCE(MAX(discount_percent), 0) INTO v_promo_percent FROM temp_active_promotions WHERE v_date BETWEEN start_date AND end_date;

        -- Select a random staff member to log the entry
        SET v_staff_id = NULL;
        IF max_staff_id > 0 THEN
            SELECT employee_id INTO v_staff_id FROM temp_staff_employees ORDER BY RAND() LIMIT 1;
        END IF;

        visit_loop: LOOP
            -- Exit loop when required visitor count is reached
            IF i >= v_total_visitors_today THEN LEAVE visit_loop; END IF;

            -- Assign a unique group ID for the transaction
            SET v_visit_group_id = UUID();

            -- Randomly determine if the visitor is an active member (25% chance)
            SET v_is_member = (RAND() < 0.25 AND max_member_id > 0);
            -- Generate a random visit time between 8:00 and 16:00
            SET v_visit_datetime = CONCAT(v_date, ' ', LPAD(FLOOR(8 + RAND() * 8), 2, '0'), ':', LPAD(FLOOR(RAND() * 60), 2, '0'), ':00');

            IF v_is_member THEN
                -- Logic for a member visit (Ticket Type 1 = Member, Price 0.00)
                SELECT membership_id INTO v_member_id FROM temp_active_members WHERE id = FLOOR(1 + RAND() * max_member_id) LIMIT 1;

                -- Insert member visit into the batch table
                INSERT INTO temp_visits_batch (membership_id, visit_date, ticket_type_id, ticket_price, discount_amount, logged_by_employee_id, visit_group_id)
                VALUES (v_member_id, v_visit_datetime, 1, 0.00, 0.00, v_staff_id, v_visit_group_id);
            ELSE
                -- Logic for a general admission ticket purchase
                SELECT ticket_type_id, base_price INTO v_ticket_type_id, v_base_price
                FROM temp_ticket_types
                ORDER BY RAND() LIMIT 1;

                -- Fallback to 'Adult' ticket type if lookup fails
                IF v_ticket_type_id IS NULL THEN
                    SET v_ticket_type_id = 2; SET v_base_price = 109.00;
                END IF;

                -- Calculate discount based on active promotions
                SET v_discount = v_base_price * (v_promo_percent / 100.0);

                -- Insert ticket visit into the batch table
                INSERT INTO temp_visits_batch (membership_id, visit_date, ticket_type_id, ticket_price, discount_amount, logged_by_employee_id, visit_group_id)
                VALUES (NULL, v_visit_datetime, v_ticket_type_id, v_base_price, v_discount, v_staff_id, v_visit_group_id);
            END IF;

            SET i = i + 1;
        END LOOP visit_loop;

        -- Bulk insert all generated visits for the day into the main 'visits' table
        INSERT INTO visits (membership_id, visit_date, ticket_type_id, ticket_price, discount_amount, logged_by_employee_id, visit_group_id)
        SELECT membership_id, visit_date, ticket_type_id, ticket_price, discount_amount, logged_by_employee_id, visit_group_id FROM temp_visits_batch;

        -- Clear the batch table for the next day
        TRUNCATE TABLE temp_visits_batch;

        -- D. Insert the total visitor count into the daily_stats table
        INSERT INTO daily_stats (date_rec, visitor_count) VALUES (v_date, v_total_visitors_today)
        ON DUPLICATE KEY UPDATE visitor_count = v_total_visitors_today;

        -- E. Calculate and record daily ride usage statistics
        OPEN ride_cursor;
        SET done = FALSE;
        ride_loop: LOOP
            -- Fetch ride details from the temporary table
            FETCH ride_cursor INTO v_ride_id, v_ride_type, v_capacity, v_ride_status;
            IF done THEN LEAVE ride_loop; END IF;

            -- Apply weather effects to ride-specific capacity multiplier
            SET v_ride_weather_mult = 1.0;
            IF v_park_closure THEN SET v_ride_status = 'WEATHER CLOSURE';
            ELSEIF v_weather_type = 'Rain' AND (v_ride_type = 'Rollercoaster' OR v_ride_type = 'Water Ride') THEN SET v_ride_weather_mult = 0.5;
            ELSEIF v_weather_type = 'Heatwave' AND v_ride_type = 'Water Ride' THEN SET v_ride_weather_mult = 1.5;
            END IF;

            SET v_total_riders = 0;
            SET v_total_runs = 0;

            -- Calculate runs and riders if the ride is open
            IF v_ride_status = 'OPEN' THEN
                -- Calculate approximate riders based on total park attendance and multiplier
                SET v_total_riders = CEIL(v_total_visitors_today * (1.6 + (RAND() * 2.4)) * v_ride_weather_mult);
                IF v_capacity > 0 THEN
                    -- Calculate approximate runs based on total riders and ride capacity/efficiency
                    SET v_total_runs = CEIL(v_total_riders / (v_capacity * (0.6 + RAND() * 0.3)));
                END IF;
            END IF;

            -- Insert calculated ride data into the batch table
            INSERT INTO temp_ride_batch (ride_id, dat_date, run_count, ride_count) VALUES (v_ride_id, v_date, v_total_runs, v_total_riders);
        END LOOP ride_loop;
        CLOSE ride_cursor;

        -- Bulk insert daily ride data into the main 'daily_ride' table
        INSERT INTO daily_ride (ride_id, dat_date, run_count, ride_count)
        SELECT ride_id, dat_date, run_count, ride_count FROM temp_ride_batch WHERE dat_date = v_date;
        -- Clear the batch table for the next day
        TRUNCATE TABLE temp_ride_batch;

        -- Increment to the next day
        SET v_date = DATE_ADD(v_date, INTERVAL 1 DAY);
    END LOOP day_loop;

    -- 5. Drop all temporary tables after loop completion
    DROP TEMPORARY TABLE IF EXISTS temp_holidays;
    DROP TEMPORARY TABLE IF EXISTS temp_active_members;
    DROP TEMPORARY TABLE IF EXISTS temp_staff_employees;
    DROP TEMPORARY TABLE IF EXISTS temp_ticket_types;
    DROP TEMPORARY TABLE IF EXISTS temp_active_promotions;
    DROP TEMPORARY TABLE IF EXISTS temp_rides;
    DROP TEMPORARY TABLE IF EXISTS temp_visits_batch;
    DROP TEMPORARY TABLE IF EXISTS temp_ride_batch;

END //

DELIMITER ;

-- Execute the data generation procedure from year X to year Y with a base of Z visitors
CALL GenerateHistoricalData(2023, 2025, 100);