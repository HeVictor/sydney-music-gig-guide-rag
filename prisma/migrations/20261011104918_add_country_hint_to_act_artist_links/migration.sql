-- AlterTable
ALTER TABLE `act_artist_links` ADD COLUMN `country_hint` VARCHAR(100) NULL,
    ADD COLUMN `country_hint_code` VARCHAR(2) NULL;
