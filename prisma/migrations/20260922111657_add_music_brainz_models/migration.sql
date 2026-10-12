-- CreateTable
CREATE TABLE `act_artist_links` (
    `cleaned_act_name` VARCHAR(255) NOT NULL,
    `artist_id` CHAR(36) NULL,
    `status` ENUM('matched', 'unmatched', 'pending') NOT NULL DEFAULT 'pending',
    `match_score` INTEGER NULL,
    `last_checked_at` DATETIME(3) NULL,

    INDEX `act_artist_links_artist_id_idx`(`artist_id`),
    PRIMARY KEY (`cleaned_act_name`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `music_artists` (
    `id` CHAR(36) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `country` VARCHAR(2) NULL,
    `disambiguation` VARCHAR(255) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `music_artists_name_idx`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `music_releases` (
    `id` CHAR(36) NOT NULL,
    `artist_id` CHAR(36) NOT NULL,
    `title` VARCHAR(255) NOT NULL,
    `primary_type` VARCHAR(50) NULL,
    `first_release_date` VARCHAR(10) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `music_releases_artist_id_idx`(`artist_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `act_artist_links` ADD CONSTRAINT `act_artist_links_artist_id_fkey` FOREIGN KEY (`artist_id`) REFERENCES `music_artists`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `music_releases` ADD CONSTRAINT `music_releases_artist_id_fkey` FOREIGN KEY (`artist_id`) REFERENCES `music_artists`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
