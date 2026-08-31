ALTER TABLE `reservations`
  ADD COLUMN `expected_check_in_at` TIMESTAMP(0) NULL,
  ADD COLUMN `expected_check_out_at` TIMESTAMP(0) NULL;
