-- CreateTable
CREATE TABLE `gigs` (
    `id` CHAR(36) NOT NULL,
    `gig_datetime` DATETIME(3) NOT NULL,
    `venue` VARCHAR(255) NOT NULL,
    `venue_url` VARCHAR(1024) NULL,
    `main_act` VARCHAR(255) NULL,
    `event_title` VARCHAR(255) NULL,
    `event_title_signal_score` INTEGER NOT NULL DEFAULT 0,
    `more_info_url` VARCHAR(1024) NULL,
    `is_free` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `gigs_gig_datetime_idx`(`gig_datetime`),
    INDEX `gigs_venue_idx`(`venue`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `gig_acts` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `gig_id` CHAR(36) NOT NULL,
    `act_name` VARCHAR(255) NOT NULL,
    `role` ENUM('main', 'support') NOT NULL,
    `position` SMALLINT NOT NULL,

    INDEX `gig_acts_act_name_idx`(`act_name`),
    UNIQUE INDEX `gig_acts_gig_id_act_name_key`(`gig_id`, `act_name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `gig_acts` ADD CONSTRAINT `gig_acts_gig_id_fkey` FOREIGN KEY (`gig_id`) REFERENCES `gigs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
