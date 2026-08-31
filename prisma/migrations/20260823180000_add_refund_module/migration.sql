ALTER TABLE `refunds`
  ADD COLUMN `refund_method` VARCHAR(191) NULL DEFAULT 'cash',
  ADD COLUMN `reference` VARCHAR(100) NULL,
  ADD COLUMN `status` VARCHAR(32) NOT NULL DEFAULT 'PENDING',
  ADD COLUMN `processed_at` TIMESTAMP NULL,
  ADD INDEX `refunds_status_idx` (`status`);

UPDATE `refunds`
SET `refund_method` = 'cash', `status` = 'COMPLETED'
WHERE `refund_method` IS NULL OR `status` IS NULL OR `status` = '';
