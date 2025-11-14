USE park_database;
DROP PROCEDURE IF EXISTS GenerateRideLogs;

DELIMITER //

--
-- Creates dummy ride logs (run_count, ride_count) for all non-broken rides
-- for every day found in the daily_stats table for a given year.
--
CREATE PROCEDURE GenerateRideLogs(
    IN target_year INT,
    IN avg_runs_per_ride INT -- The average number of runs you want a ride to have per day
)
BEGIN
    -- Cursors for iterating through all dates and all rides
    DECLARE done INT DEFAULT FALSE;
    DECLARE v_date DATE;
    DECLARE v_ride_id INT;
    DECLARE v_ride_capacity INT;
    DECLARE v_ride_status ENUM('OPEN', 'CLOSED', 'BROKEN');
    
    -- Variables to hold the calculated daily stats for a ride
    DECLARE v_run_count INT;
    DECLARE v_ride_count INT;
    DECLARE v_avg_capacity_percent DECIMAL(5, 2);

    -- Cursor 1: Get all dates from daily_stats for the target year
    DECLARE date_cursor CURSOR FOR
        SELECT date_rec FROM daily_stats WHERE YEAR(date_rec) = target_year;
        
    -- Cursor 2: Get all rides, their capacity, and status
    DECLARE ride_cursor CURSOR FOR
        SELECT ride_id, capacity, ride_status FROM rides;
        
    -- Handler to exit loops
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;

    -- Delete old ride logs for this year to prevent primary key conflicts
    DELETE FROM daily_ride WHERE YEAR(dat_date) = target_year;

    OPEN date_cursor;
    date_loop: LOOP
        FETCH date_cursor INTO v_date;
        IF done THEN
            LEAVE date_loop;
        END IF;

        -- For each date, open the ride_cursor to loop through all rides
        OPEN ride_cursor;
        ride_loop: LOOP
            FETCH ride_cursor INTO v_ride_id, v_ride_capacity, v_ride_status;
            IF done THEN
                SET done = FALSE; -- Reset 'done' flag for the outer loop
                LEAVE ride_loop;
            END IF;
            
            -- Only generate logs for rides that are NOT broken
            IF v_ride_status != 'BROKEN' THEN
            
                -- 1. Calculate a random run_count (e.g., 80% to 120% of the average)
                SET v_run_count = FLOOR(avg_runs_per_ride * (0.8 + (RAND() * 0.4)));
                
                -- 2. Calculate a random average capacity for the day (e.g., 25% to 85%)
                SET v_avg_capacity_percent = (RAND() * 0.6) + 0.25;
                
                -- 3. Calculate total riders based on runs, capacity, and average percent
                SET v_ride_count = FLOOR(v_run_count * v_ride_capacity * v_avg_capacity_percent);
                
                -- 4. Insert the new record into daily_ride
                -- This links the ride_id and the dat_date
                INSERT INTO daily_ride (ride_id, dat_date, run_count, ride_count)
                VALUES (v_ride_id, v_date, v_run_count, v_ride_count);
                
            END IF;
            
        END LOOP ride_loop;
        CLOSE ride_cursor;

    END LOOP date_loop;
    CLOSE date_cursor;

END //

DELIMITER ;