-- CreateTable
CREATE TABLE `charge_types` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL,
    `default_account` VARCHAR(20) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `guest_charges` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `reservation_id` INTEGER NOT NULL,
    `charge_type_id` INTEGER NOT NULL,
    `description` VARCHAR(255) NULL,
    `amount` DOUBLE NOT NULL,
    `posted_by` INTEGER NOT NULL,
    `posted_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `is_void` BOOLEAN NOT NULL DEFAULT false,
    `void_reason` VARCHAR(255) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `guest_charge_tax` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `guest_charge_id` INTEGER NOT NULL,
    `tax_type` ENUM('VAT', 'SC', 'TDL', 'NBT') NOT NULL,
    `amount` DOUBLE NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `guest_charges` ADD CONSTRAINT `guest_charges_reservation_id_fkey` FOREIGN KEY (`reservation_id`) REFERENCES `reservations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `guest_charges` ADD CONSTRAINT `guest_charges_charge_type_id_fkey` FOREIGN KEY (`charge_type_id`) REFERENCES `charge_types`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `guest_charges` ADD CONSTRAINT `guest_charges_posted_by_fkey` FOREIGN KEY (`posted_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `guest_charge_tax` ADD CONSTRAINT `guest_charge_tax_guest_charge_id_fkey` FOREIGN KEY (`guest_charge_id`) REFERENCES `guest_charges`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
