DROP PROCEDURE IF EXISTS GenerateHistoricalData;

DELIMITER //

CREATE PROCEDURE GenerateHistoricalData(
    IN p_start_year INT,
    IN p_end_year INT,
    IN p_base_daily_visitors INT -- Tuning knob (e.g., 2000)
)
BEGIN
    -- 1. DECLARATIONS
    DECLARE v_date DATE;
    DECLARE v_end_date DATE;
    DECLARE i INT;
    
    -- Weather
    DECLARE v_weather_type ENUM('Rain', 'Thunderstorm', 'Tornado Warning', 'Heatwave', 'Other'); 
    DECLARE v_weather_multiplier DECIMAL(5, 2) DEFAULT 1.0;
    DECLARE v_park_closure BOOL DEFAULT FALSE;
    DECLARE v_month INT;
    DECLARE v_dow INT;
    DECLARE v_roll DECIMAL(5, 4);

    -- Attendance
    DECLARE v_day_score DECIMAL(5, 2);
    DECLARE v_month_score DECIMAL(5, 2);
    DECLARE v_holiday_score DECIMAL(5, 2);
    DECLARE v_total_visitors_today INT;

    -- Visit
    DECLARE v_is_member BOOL;
    DECLARE v_member_id INT;
    DECLARE v_staff_id INT;
    DECLARE v_ticket_type_id INT;
    DECLARE v_base_price DECIMAL(10, 2);
    DECLARE v_discount DECIMAL(10, 2);
    DECLARE v_promo_percent DECIMAL(5, 2);
    DECLARE v_visit_datetime DATETIME;
    
    -- NEW: Variable for the Group UUID
    DECLARE v_visit_group_id VARCHAR(36); 

    -- Ride
    DECLARE v_ride_id INT;
    DECLARE v_ride_type VARCHAR(50);
    DECLARE v_capacity INT;
    DECLARE v_ride_status ENUM('OPEN', 'CLOSED', 'BROKEN', 'WEATHER CLOSURE'); 
    DECLARE v_ride_weather_mult DECIMAL(5, 2);
    DECLARE v_total_riders INT;
    DECLARE v_total_runs INT;
    DECLARE done INT DEFAULT FALSE;
    
    -- Temp Table Max IDs
    DECLARE max_member_id INT;
    DECLARE max_staff_id INT;

    -- CURSORS
    DECLARE ride_cursor CURSOR FOR
        SELECT ride_id, ride_type, capacity, ride_status FROM temp_rides;
        
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;

    -- 2. CLEANUP PREVIOUS DATA 
    SET SQL_SAFE_UPDATES = 0;
    DELETE FROM daily_ride WHERE YEAR(dat_date) BETWEEN p_start_year AND p_end_year;
    DELETE FROM daily_stats WHERE YEAR(date_rec) BETWEEN p_start_year AND p_end_year;
    DELETE FROM visits WHERE YEAR(visit_date) BETWEEN p_start_year AND p_end_year;
    DELETE FROM weather_events WHERE YEAR(event_date) BETWEEN p_start_year AND p_end_year;
    SET SQL_SAFE_UPDATES = 1;

    -- 3. CREATE & POPULATE TEMP TABLES
    DROP TEMPORARY TABLE IF EXISTS temp_holidays;
    CREATE TEMPORARY TABLE temp_holidays ( h_date DATE PRIMARY KEY );
    
    SET i = p_start_year;
    WHILE i <= p_end_year DO
        INSERT IGNORE INTO temp_holidays (h_date) VALUES
        (CONCAT(i, '-01-01')), (CONCAT(i, '-05-25')), (CONCAT(i, '-07-04')),
        (CONCAT(i, '-09-01')), (CONCAT(i, '-10-31')), (CONCAT(i, '-11-28')),
        (CONCAT(i, '-12-24')), (CONCAT(i, '-12-25')), (CONCAT(i, '-12-31'));
        SET i = i + 1;
    END WHILE;

    DROP TEMPORARY TABLE IF EXISTS temp_active_members;
    CREATE TEMPORARY TABLE temp_active_members ( id INT AUTO_INCREMENT PRIMARY KEY, membership_id INT );
    INSERT INTO temp_active_members (membership_id)
    SELECT membership_id FROM membership WHERE end_date >= CONCAT(p_start_year, '-01-01');

    DROP TEMPORARY TABLE IF EXISTS temp_staff_employees;
    CREATE TEMPORARY TABLE temp_staff_employees ( id INT AUTO_INCREMENT PRIMARY KEY, employee_id INT );
    INSERT INTO temp_staff_employees (employee_id)
    SELECT employee_id FROM employee_demographics WHERE employee_type = 'Staff' AND is_active = TRUE;

    DROP TEMPORARY TABLE IF EXISTS temp_ticket_types;
    CREATE TEMPORARY TABLE temp_ticket_types ( ticket_type_id INT, base_price DECIMAL(10, 2) );
    INSERT INTO temp_ticket_types (ticket_type_id, base_price)
    SELECT ticket_type_id, base_price FROM ticket_types WHERE is_member_type = FALSE AND is_active = TRUE;
    
    DROP TEMPORARY TABLE IF EXISTS temp_active_promotions;
    CREATE TEMPORARY TABLE temp_active_promotions ( start_date DATE, end_date DATE, discount_percent DECIMAL(5, 2), PRIMARY KEY (start_date, end_date) );
    INSERT INTO temp_active_promotions (start_date, end_date, discount_percent)
    SELECT start_date, end_date, discount_percent FROM event_promotions;

    DROP TEMPORARY TABLE IF EXISTS temp_rides;
    CREATE TEMPORARY TABLE temp_rides ( ride_id INT PRIMARY KEY, ride_type VARCHAR(50), capacity INT, ride_status ENUM('OPEN', 'CLOSED', 'BROKEN', 'WEATHER CLOSURE') );
    INSERT INTO temp_rides (ride_id, ride_type, capacity, ride_status)
    SELECT ride_id, ride_type, capacity, ride_status FROM rides;

    SELECT COUNT(*) INTO max_member_id FROM temp_active_members;
    SELECT COUNT(*) INTO max_staff_id FROM temp_staff_employees;

    -- MODIFIED: Added visit_group_id to temp table
    DROP TEMPORARY TABLE IF EXISTS temp_visits_batch;
    CREATE TEMPORARY TABLE temp_visits_batch (
        batch_id INT AUTO_INCREMENT PRIMARY KEY,
        membership_id INT,
        visit_date DATETIME,
        ticket_type_id INT NOT NULL,
        ticket_price DECIMAL(10,2) NULL,
        discount_amount DECIMAL(10,2) NULL,
        logged_by_employee_id INT,
        visit_group_id VARCHAR(36) -- NEW COLUMN
    );
    
    DROP TEMPORARY TABLE IF EXISTS temp_ride_batch;
    CREATE TEMPORARY TABLE temp_ride_batch (
        ride_id INT NOT NULL,
        dat_date DATE NOT NULL,
        run_count INT UNSIGNED DEFAULT 0,
        ride_count INT UNSIGNED DEFAULT 0,
        PRIMARY KEY (ride_id, dat_date)
    );

    -- 4. MAIN LOOP
    SET v_date = CONCAT(p_start_year, '-01-01');
    SET v_end_date = CONCAT(p_end_year, '-12-31');

    day_loop: LOOP
        IF v_date > v_end_date THEN
            LEAVE day_loop;
        END IF;

        -- A. WEATHER (Unchanged)
        SET v_weather_type = NULL;
        SET v_weather_multiplier = 1.0;
        SET v_park_closure = FALSE;
        SET v_month = MONTH(v_date);
        SET v_roll = RAND();

        IF v_month IN (6, 7, 8) THEN 
            IF v_roll < 0.03 THEN SET v_weather_type = 'Thunderstorm'; SET v_weather_multiplier = 0.2; SET v_park_closure = TRUE;
            ELSEIF v_roll < 0.08 THEN SET v_weather_type = 'Heatwave'; SET v_weather_multiplier = 0.8;
            ELSEIF v_roll < 0.18 THEN SET v_weather_type = 'Rain'; SET v_weather_multiplier = 0.6;
            END IF;
        ELSEIF v_month IN (3, 4, 5, 9, 10) THEN
            IF v_roll < 0.02 THEN SET v_weather_type = 'Thunderstorm'; SET v_weather_multiplier = 0.3; SET v_park_closure = TRUE;
            ELSEIF v_roll < 0.12 THEN SET v_weather_type = 'Rain'; SET v_weather_multiplier = 0.7;
            END IF;
        END IF;

        IF v_weather_type IS NOT NULL THEN
            INSERT INTO weather_events (event_date, end_time, weather_type, park_closure)
            VALUES (CONCAT(v_date, ' 14:00:00'), CONCAT(v_date, ' 16:00:00'), v_weather_type, v_park_closure);
        END IF;

        -- B. VISITORS COUNT (Unchanged)
        SET v_dow = DAYOFWEEK(v_date);
        SET v_day_score = CASE WHEN v_dow = 7 THEN 2.5 WHEN v_dow = 1 THEN 2.0 WHEN v_dow = 6 THEN 1.5 ELSE 1.0 END;
        SET v_month_score = CASE WHEN v_month IN (6, 7, 8) THEN 1.8 WHEN v_month IN (3, 4, 10) THEN 1.2 WHEN v_month = 12 THEN 1.5 ELSE 0.9 END;

        SET v_holiday_score = 1.0;
        IF EXISTS(SELECT 1 FROM temp_holidays WHERE h_date = v_date) THEN SET v_holiday_score = 3.0; END IF;

        SET v_total_visitors_today = FLOOR(p_base_daily_visitors * v_day_score * v_month_score * v_holiday_score * v_weather_multiplier * (0.85 + (RAND() * 0.3)));
        
        -- C. GENERATE VISITS (Updated logic)
        SET i = 0;
        SELECT COALESCE(MAX(discount_percent), 0) INTO v_promo_percent FROM temp_active_promotions WHERE v_date BETWEEN start_date AND end_date;
        
        SET v_staff_id = NULL;
        IF max_staff_id > 0 THEN
            SELECT employee_id INTO v_staff_id FROM temp_staff_employees ORDER BY RAND() LIMIT 1;
        END IF;

        SET v_visit_datetime = CONCAT(v_date, ' ', LPAD(FLOOR(8 + RAND() * 8), 2, '0'), ':', LPAD(FLOOR(RAND() * 60), 2, '0'), ':00');

        visit_loop: LOOP
            IF i >= v_total_visitors_today THEN LEAVE visit_loop; END IF;
            
            -- Generate a unique Group ID for this "transaction"
            SET v_visit_group_id = UUID(); 
            
            SET v_is_member = (RAND() < 0.25 AND max_member_id > 0); 
            SET v_visit_datetime = CONCAT(v_date, ' ', LPAD(FLOOR(8 + RAND() * 8), 2, '0'), ':', LPAD(FLOOR(RAND() * 60), 2, '0'), ':00');

            IF v_is_member THEN
                SELECT membership_id INTO v_member_id FROM temp_active_members WHERE id = FLOOR(1 + RAND() * max_member_id) LIMIT 1;
                
                -- Insert with Group ID
                INSERT INTO temp_visits_batch (membership_id, visit_date, ticket_type_id, ticket_price, discount_amount, logged_by_employee_id, visit_group_id)
                VALUES (v_member_id, v_visit_datetime, 1, 0.00, 0.00, v_staff_id, v_visit_group_id);
            ELSE
                SELECT ticket_type_id, base_price INTO v_ticket_type_id, v_base_price 
                FROM temp_ticket_types 
                ORDER BY RAND() LIMIT 1; 
                
                IF v_ticket_type_id IS NULL THEN
                     SET v_ticket_type_id = 2; SET v_base_price = 109.00;
                END IF;

                SET v_discount = v_base_price * (v_promo_percent / 100.0);
                
                -- Insert with Group ID
                INSERT INTO temp_visits_batch (membership_id, visit_date, ticket_type_id, ticket_price, discount_amount, logged_by_employee_id, visit_group_id)
                VALUES (NULL, v_visit_datetime, v_ticket_type_id, v_base_price, v_discount, v_staff_id, v_visit_group_id);
            END IF;
            
            SET i = i + 1;
        END LOOP visit_loop;
        
        -- Bulk Insert into Main Table
        INSERT INTO visits (membership_id, visit_date, ticket_type_id, ticket_price, discount_amount, logged_by_employee_id, visit_group_id)
        SELECT membership_id, visit_date, ticket_type_id, ticket_price, discount_amount, logged_by_employee_id, visit_group_id FROM temp_visits_batch;
        
        TRUNCATE TABLE temp_visits_batch;

        -- D. DAILY STATS
        INSERT INTO daily_stats (date_rec, visitor_count) VALUES (v_date, v_total_visitors_today)
        ON DUPLICATE KEY UPDATE visitor_count = v_total_visitors_today;

        -- E. RIDES (Unchanged)
        OPEN ride_cursor;
        SET done = FALSE;
        ride_loop: LOOP
            FETCH ride_cursor INTO v_ride_id, v_ride_type, v_capacity, v_ride_status;
            IF done THEN LEAVE ride_loop; END IF;

            SET v_ride_weather_mult = 1.0;
            IF v_park_closure THEN SET v_ride_status = 'WEATHER CLOSURE'; 
            ELSEIF v_weather_type = 'Rain' AND (v_ride_type = 'Rollercoaster' OR v_ride_type = 'Water Ride') THEN SET v_ride_weather_mult = 0.5;
            ELSEIF v_weather_type = 'Heatwave' AND v_ride_type = 'Water Ride' THEN SET v_ride_weather_mult = 1.5;
            END IF;

            SET v_total_riders = 0;
            SET v_total_runs = 0;

            IF v_ride_status = 'OPEN' THEN
                SET v_total_riders = CEIL(v_total_visitors_today * (1.6 + (RAND() * 2.4)) * v_ride_weather_mult);
                IF v_capacity > 0 THEN
                    SET v_total_runs = CEIL(v_total_riders / (v_capacity * (0.6 + RAND() * 0.3)));
                END IF;
            END IF;

            INSERT INTO temp_ride_batch (ride_id, dat_date, run_count, ride_count) VALUES (v_ride_id, v_date, v_total_runs, v_total_riders);
        END LOOP ride_loop;
        CLOSE ride_cursor;

        INSERT INTO daily_ride (ride_id, dat_date, run_count, ride_count)
        SELECT ride_id, dat_date, run_count, ride_count FROM temp_ride_batch WHERE dat_date = v_date;
        TRUNCATE TABLE temp_ride_batch;

        SET v_date = DATE_ADD(v_date, INTERVAL 1 DAY);
    END LOOP day_loop;

    -- 5. CLEANUP
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

CALL GenerateHistoricalData(2025, 2025, 20);