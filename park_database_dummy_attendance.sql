CREATE PROCEDURE GenerateVisits(
    IN num_visits INT,
    IN start_year INT
)
BEGIN
    DECLARE i INT DEFAULT 0;
    DECLARE v_year_start_date DATE;
    DECLARE v_year_end_date DATE;
    DECLARE v_current_date DATE;

    DECLARE score_multiplier DECIMAL(5, 2);
    DECLARE day_of_week INT;
    DECLARE month_num INT;
    DECLARE is_holiday BOOL;
    DECLARE total_score DECIMAL(10, 2);
    DECLARE random_score_target DECIMAL(10, 2);
    DECLARE accumulated_score DECIMAL(10, 2);
    DECLARE visit_date_time DATETIME;
    DECLARE exit_time_str TIME;
    DECLARE ticket_id INT;
    DECLARE final_price DECIMAL(10, 2);
    DECLARE discount DECIMAL(10, 2);
    DECLARE is_member BOOL;
    DECLARE member_id INT;
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

    SET v_year_start_date = CONCAT(start_year, '-01-01');
    SET v_year_end_date = CONCAT(start_year, '-12-31');

    DROP TEMPORARY TABLE IF EXISTS high_traffic_dates;
    CREATE TEMPORARY TABLE high_traffic_dates (
        traffic_date DATE PRIMARY KEY
    );
    INSERT INTO high_traffic_dates (traffic_date) VALUES
    ('2025-01-01'), ('2025-03-15'), ('2025-03-22'), ('2025-04-20'),
    ('2025-05-26'), ('2025-07-04'), ('2025-09-01'), ('2025-11-27'),
    ('2025-11-28'), ('2025-12-24'), ('2025-12-25'), ('2025-12-31');

    DROP TEMPORARY TABLE IF EXISTS daily_traffic_score;
    CREATE TEMPORARY TABLE daily_traffic_score (
        dat_date DATE PRIMARY KEY,
        score DECIMAL(5, 2),
        cumulative_score DECIMAL(10, 2)
    );

    SET v_current_date = v_year_start_date;
    WHILE v_current_date <= v_year_end_date DO
        SET score_multiplier = 1.0;
        SET day_of_week = DAYOFWEEK(v_current_date);
        SET month_num = MONTH(v_current_date);
        SET is_holiday = FALSE;

        IF month_num IN (6, 7, 8) THEN
            SET score_multiplier = score_multiplier + 3.0;
        END IF;

        IF day_of_week IN (1, 7) THEN
            SET score_multiplier = score_multiplier + 2.0;
        END IF;

        SELECT EXISTS(SELECT 1 FROM high_traffic_dates WHERE traffic_date = v_current_date) INTO is_holiday;
        IF is_holiday THEN
            SET score_multiplier = score_multiplier + 4.0;
        END IF;

        INSERT INTO daily_traffic_score (dat_date, score, cumulative_score)
        VALUES (v_current_date, score_multiplier, 0.0);

        SET v_current_date = DATE_ADD(v_current_date, INTERVAL 1 DAY);
    END WHILE;

    SET accumulated_score = 0.0;

    SET @running_total := 0;
    UPDATE daily_traffic_score
    SET cumulative_score = (@running_total := @running_total + score)
    ORDER BY dat_date;

    SELECT MAX(cumulative_score) INTO total_score FROM daily_traffic_score;

    WHILE i < num_visits DO

        SET random_score_target = RAND() * total_score;

        SELECT dat_date INTO v_current_date
        FROM daily_traffic_score
        WHERE cumulative_score >= random_score_target
        ORDER BY dat_date
        LIMIT 1;

        SET random_hour = FLOOR(8 + RAND() * 9);
        SET random_minute = FLOOR(RAND() * 60);
        SET random_second = FLOOR(RAND() * 60);
        SET visit_date_time = CONCAT(v_current_date, ' ', LPAD(random_hour, 2, '0'), ':', LPAD(random_minute, 2, '0'), ':', LPAD(random_second, 2, '0'));

        SET entry_seconds = TIME_TO_SEC(TIME(visit_date_time));
        SET exit_seconds = entry_seconds + (FLOOR(4 + RAND() * 7) * 3600);
        IF exit_seconds > TIME_TO_SEC('23:00:00') THEN
            SET exit_seconds = TIME_TO_SEC('23:00:00');
        END IF;
        SET exit_time_str = SEC_TO_TIME(exit_seconds);

        SET ticket_type_roll = RAND();
        SET is_member = FALSE;
        SET member_id = NULL;

        IF ticket_type_roll < 0.20 THEN
            SET ticket_id = 1;
            SET is_member = TRUE;
            SET final_price = 0.00;
        ELSEIF ticket_type_roll < 0.70 THEN
            SET ticket_id = 2;
            SET final_price = adult_price;
        ELSEIF ticket_type_roll < 0.90 THEN
            SET ticket_id = 3;
            SET final_price = child_price;
        ELSE
            SET ticket_id = 4;
            SET final_price = senior_price;
        END IF;

        SET discount = 0.00;
        SET promo_percent = 0.00;

        IF is_member THEN
            SELECT membership_id INTO member_id
            FROM membership
            ORDER BY RAND()
            LIMIT 1;
        ELSE
            SELECT COALESCE(MAX(discount_percent), 0.00) INTO promo_percent
            FROM event_promotions
            WHERE v_current_date BETWEEN start_date AND end_date;

            IF promo_percent > 0.00 THEN
                SET discount = final_price * (promo_percent / 100.0);
            END IF;
        END IF;

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

DELIMITER ;

SET SQL_SAFE_UPDATES = 0;

DELETE FROM visits WHERE visit_id > 5;
DELETE FROM daily_stats WHERE date_rec > '2025-10-25';

CALL GenerateVisits(1000, 2025);

INSERT INTO daily_stats (date_rec, visitor_count)
SELECT
    DATE(visit_date),
    COUNT(visit_id)
FROM visits
GROUP BY DATE(visit_date)
ON DUPLICATE KEY UPDATE
    visitor_count = VALUES(visitor_count);

SET SQL_SAFE_UPDATES = 1;