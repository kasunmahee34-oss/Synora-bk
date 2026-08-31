/*
  Warnings:

  - You are about to drop the column `after_data` on the `audit_logs` table. All the data in the column will be lost.
  - You are about to drop the column `before_data` on the `audit_logs` table. All the data in the column will be lost.
  - You are about to drop the column `changed_at` on the `audit_logs` table. All the data in the column will be lost.
  - You are about to drop the column `changed_by` on the `audit_logs` table. All the data in the column will be lost.
  - You are about to drop the column `record_id` on the `audit_logs` table. All the data in the column will be lost.
  - You are about to drop the column `table_name` on the `audit_logs` table. All the data in the column will be lost.
  - You are about to drop the column `date` on the `refunds` table. All the data in the column will be lost.
  - Added the required column `entity_id` to the `audit_logs` table without a default value. This is not possible if the table is not empty.
  - Added the required column `entity_type` to the `audit_logs` table without a default value. This is not possible if the table is not empty.
  - Added the required column `module` to the `audit_logs` table without a default value. This is not possible if the table is not empty.
  - Added the required column `user_id` to the `audit_logs` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updated_at` to the `discounts` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updated_at` to the `refunds` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updated_at` to the `room_maintenance` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE `audit_logs` DROP FOREIGN KEY `audit_logs_changed_by_fkey`;

-- AlterTable
ALTER TABLE `audit_logs` DROP COLUMN `after_data`,
    DROP COLUMN `before_data`,
    DROP COLUMN `changed_at`,
    DROP COLUMN `changed_by`,
    DROP COLUMN `record_id`,
    DROP COLUMN `table_name`,
    ADD COLUMN `created_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    ADD COLUMN `description` VARCHAR(255) NULL,
    ADD COLUMN `entity_id` INTEGER NOT NULL,
    ADD COLUMN `entity_type` VARCHAR(50) NOT NULL,
    ADD COLUMN `ip_address` VARCHAR(45) NULL,
    ADD COLUMN `module` VARCHAR(50) NOT NULL,
    ADD COLUMN `new_values` JSON NULL,
    ADD COLUMN `old_values` JSON NULL,
    ADD COLUMN `user_agent` VARCHAR(255) NULL,
    ADD COLUMN `user_id` INTEGER NOT NULL;

-- AlterTable
ALTER TABLE `discounts` ADD COLUMN `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    ADD COLUMN `discount_type` ENUM('FIXED', 'PERCENTAGE') NOT NULL DEFAULT 'FIXED',
    ADD COLUMN `guest_charge_id` INTEGER NULL,
    ADD COLUMN `updated_at` DATETIME(3) NOT NULL;

-- AlterTable
ALTER TABLE `guest_charge_tax` ADD COLUMN `created_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    ADD COLUMN `tax_config_id` INTEGER NULL,
    ADD COLUMN `tax_rate` DOUBLE NULL,
    ADD COLUMN `taxable_amount` DOUBLE NULL;

-- AlterTable
ALTER TABLE `refunds` DROP COLUMN `date`,
    ADD COLUMN `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    ADD COLUMN `payment_id` INTEGER NULL,
    ADD COLUMN `refund_date` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    ADD COLUMN `updated_at` DATETIME(3) NOT NULL;

-- AlterTable
ALTER TABLE `room_maintenance` ADD COLUMN `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    ADD COLUMN `status` VARCHAR(50) NOT NULL DEFAULT 'maintenance',
    ADD COLUMN `updated_at` DATETIME(3) NOT NULL;

-- CreateIndex
CREATE INDEX `audit_logs_user_id_idx` ON `audit_logs`(`user_id`);

-- CreateIndex
CREATE INDEX `audit_logs_module_idx` ON `audit_logs`(`module`);

-- CreateIndex
CREATE INDEX `audit_logs_entity_type_entity_id_idx` ON `audit_logs`(`entity_type`, `entity_id`);

-- CreateIndex
CREATE INDEX `audit_logs_created_at_idx` ON `audit_logs`(`created_at`);

-- CreateIndex
CREATE INDEX `discounts_guest_charge_id_idx` ON `discounts`(`guest_charge_id`);

-- CreateIndex
CREATE INDEX `payments_reference_idx` ON `payments`(`reference`);

-- CreateIndex
CREATE INDEX `refunds_payment_id_idx` ON `refunds`(`payment_id`);

-- AddForeignKey
ALTER TABLE `guest_charge_tax` ADD CONSTRAINT `guest_charge_tax_tax_config_id_fkey` FOREIGN KEY (`tax_config_id`) REFERENCES `tax_config`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `refunds` ADD CONSTRAINT `refunds_payment_id_fkey` FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `discounts` ADD CONSTRAINT `discounts_guest_charge_id_fkey` FOREIGN KEY (`guest_charge_id`) REFERENCES `guest_charges`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- RenameIndex
ALTER TABLE `discounts` RENAME INDEX `discounts_reservation_id_fkey` TO `discounts_reservation_id_idx`;

-- RenameIndex
ALTER TABLE `refunds` RENAME INDEX `refunds_reservation_id_fkey` TO `refunds_reservation_id_idx`;
