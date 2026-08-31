CREATE TABLE IF NOT EXISTS `night_audit` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `audit_date` DATE NOT NULL,
    `completed` BOOLEAN NOT NULL DEFAULT false,
    `completed_by` INTEGER NULL,
    `completed_at` TIMESTAMP(0) NULL,
    `room_revenue_posted` BOOLEAN NOT NULL DEFAULT false,
    `logged_out_users` BOOLEAN NOT NULL DEFAULT false,
    `auto_cancelled` INTEGER NOT NULL DEFAULT 0,
    `auto_no_show` INTEGER NOT NULL DEFAULT 0,
    `details` JSON NULL,
    `errors_count` INTEGER NOT NULL DEFAULT 0,
    `guaranteed_reviewed` INTEGER NOT NULL DEFAULT 0,
    `tentative_reviewed` INTEGER NOT NULL DEFAULT 0,
    UNIQUE INDEX `night_audit_audit_date_key`(`audit_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AlterTable
ALTER TABLE `reservations` MODIFY `status` ENUM('confirmed', 'checked_in', 'checked_out', 'cancelled', 'no_show', 'tentative', 'guaranteed', 'room_assigned', 'closed', 'in_house') NOT NULL DEFAULT 'confirmed';
