-- CreateTable
CREATE TABLE `tax_config` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tax_type` ENUM('VAT', 'SC', 'TDL', 'NBT') NOT NULL,
    `rate` DOUBLE NOT NULL,
    `compound_on` ENUM('room_revenue', 'room_revenue_plus_sc') NOT NULL DEFAULT 'room_revenue',
    `effective_from` DATE NOT NULL,
    `effective_to` DATE NULL,
    `property_id` INTEGER NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `tax_config_property_id_tax_type_effective_from_effective_to_idx`(`property_id`, `tax_type`, `effective_from`, `effective_to`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
