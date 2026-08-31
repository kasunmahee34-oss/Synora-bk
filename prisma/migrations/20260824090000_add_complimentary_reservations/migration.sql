ALTER TABLE `reservations`
  ADD COLUMN `is_complimentary` BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN `complimentary_reason` VARCHAR(255) NULL,
  ADD COLUMN `complimentary_approved_by` INTEGER NULL;

ALTER TABLE `reservations`
  ADD CONSTRAINT `reservations_complimentary_approved_by_fkey`
  FOREIGN KEY (`complimentary_approved_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;
