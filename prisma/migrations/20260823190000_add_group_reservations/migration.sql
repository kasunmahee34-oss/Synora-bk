CREATE TABLE `group_reservations` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `group_code` VARCHAR(30) NOT NULL,
  `group_name` VARCHAR(150) NOT NULL,
  `travel_agent_id` INTEGER NULL,
  `check_in_date` DATE NOT NULL,
  `check_out_date` DATE NOT NULL,
  `expected_check_in_at` TIMESTAMP(0) NULL,
  `expected_check_out_at` TIMESTAMP(0) NULL,
  `meal_plan_id` INTEGER NULL,
  `rate_plan_id` INTEGER NULL,
  `status` ENUM('CONFIRMED', 'PARTIALLY_CHECKED_IN', 'IN_HOUSE', 'PARTIALLY_CHECKED_OUT', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'CONFIRMED',
  `notes` TEXT NULL,
  `created_by` INTEGER NULL,
  `created_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP(0) NULL,
  UNIQUE INDEX `group_reservations_group_code_key` (`group_code`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `reservations`
  ADD COLUMN `group_reservation_id` INTEGER NULL;

ALTER TABLE `reservations`
  ADD CONSTRAINT `reservations_group_reservation_id_fkey`
  FOREIGN KEY (`group_reservation_id`) REFERENCES `group_reservations` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `group_reservations`
  ADD CONSTRAINT `group_reservations_travel_agent_id_fkey`
  FOREIGN KEY (`travel_agent_id`) REFERENCES `travel_agents` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX `reservations_group_reservation_id_idx` ON `reservations` (`group_reservation_id`);
