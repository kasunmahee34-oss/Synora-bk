/*
  Warnings:

  - You are about to drop the column `floor` on the `rooms` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE `rooms` DROP COLUMN `floor`,
    ADD COLUMN `floor_id` INTEGER NULL;

-- CreateTable
CREATE TABLE `floors` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `floor_name` VARCHAR(50) NOT NULL,
    `floor_number` INTEGER NOT NULL,
    `property_id` INTEGER NOT NULL DEFAULT 1,
    `is_active` BOOLEAN NOT NULL DEFAULT true,

    UNIQUE INDEX `floors_property_id_floor_number_key`(`property_id`, `floor_number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `rooms` ADD CONSTRAINT `rooms_floor_id_fkey` FOREIGN KEY (`floor_id`) REFERENCES `floors`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
