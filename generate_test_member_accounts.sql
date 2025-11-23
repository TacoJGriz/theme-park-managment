USE park_database;

-- default pass: Clubhouse123
SET @pwd = '$2b$10$zKGpKcl0uHKA9Tg1GY8Jv.w8T0glQh/v7wFckZTjnyD0hSZJ/gkZu';

-- platinum test user
INSERT INTO membership (public_membership_id, first_name, last_name, email, phone_number, date_of_birth, type_id, start_date, end_date, guest_passes_remaining)
VALUES (UUID(), 'Peter', 'Platinum', 'platinum@test.com', '(555) 111-1111', '1985-05-15', 1, CURDATE(), DATE_ADD(CURDATE(), INTERVAL 1 YEAR), 4);
SET @plat_id = LAST_INSERT_ID();
INSERT INTO member_auth (membership_id, password_hash) VALUES (@plat_id, @pwd);

-- add mock payment method
INSERT INTO member_payment_methods (public_payment_id, membership_id, payment_type, is_default, mock_identifier, mock_expiration)
VALUES (UUID(), @plat_id, 'Card', 1, 'Amex ending in 1001', '12/28');

-- gold test user
INSERT INTO membership (public_membership_id, first_name, last_name, email, phone_number, date_of_birth, type_id, start_date, end_date, guest_passes_remaining)
VALUES (UUID(), 'Gary', 'Gold', 'gold@test.com', '(555) 222-2222', '1990-08-20', 2, CURDATE(), DATE_ADD(CURDATE(), INTERVAL 1 YEAR), 2);
SET @gold_id = LAST_INSERT_ID();
INSERT INTO member_auth (membership_id, password_hash) VALUES (@gold_id, @pwd);

-- silver test user
INSERT INTO membership (public_membership_id, first_name, last_name, email, phone_number, date_of_birth, type_id, start_date, end_date, guest_passes_remaining)
VALUES (UUID(), 'Sarah', 'Silver', 'silver@test.com', '(555) 333-3333', '1995-02-10', 3, CURDATE(), DATE_ADD(CURDATE(), INTERVAL 1 YEAR), 0);
SET @silver_id = LAST_INSERT_ID();
INSERT INTO member_auth (membership_id, password_hash) VALUES (@silver_id, @pwd);

-- family account primary
INSERT INTO membership (public_membership_id, first_name, last_name, email, phone_number, date_of_birth, type_id, start_date, end_date, guest_passes_remaining)
VALUES (UUID(), 'Fiona', 'Family', 'family@test.com', '(555) 444-4444', '1980-11-30', 4, CURDATE(), DATE_ADD(CURDATE(), INTERVAL 1 YEAR), 2);
SET @fam_id = LAST_INSERT_ID();
INSERT INTO member_auth (membership_id, password_hash) VALUES (@fam_id, @pwd);
-- family sub-member
INSERT INTO membership (public_membership_id, first_name, last_name, email, phone_number, date_of_birth, type_id, start_date, end_date, primary_member_id)
VALUES (UUID(), 'Frankie', 'Family', NULL, NULL, '2015-06-15', 4, CURDATE(), DATE_ADD(CURDATE(), INTERVAL 1 YEAR), @fam_id);

-- expired account for testing
INSERT INTO membership (public_membership_id, first_name, last_name, email, phone_number, date_of_birth, type_id, start_date, end_date, guest_passes_remaining)
VALUES (UUID(), 'Eddie', 'Expired', 'expired@test.com', '(555) 000-0000', '1980-01-01', 3, DATE_SUB(CURDATE(), INTERVAL 2 YEAR), DATE_SUB(CURDATE(), INTERVAL 1 YEAR), 0);
SET @exp_id = LAST_INSERT_ID();
INSERT INTO member_auth (membership_id, password_hash) VALUES (@exp_id, @pwd);