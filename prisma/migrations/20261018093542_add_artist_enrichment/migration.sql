-- AlterTable
ALTER TABLE `music_artists` ADD COLUMN `last_enriched_at` DATETIME(3) NULL,
    ADD COLUMN `last_fm_url` VARCHAR(1024) NULL,
    ADD COLUMN `official_website` VARCHAR(1024) NULL,
    ADD COLUMN `wikidata_id` VARCHAR(20) NULL;

-- CreateTable
CREATE TABLE `artist_documents` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `artist_id` CHAR(36) NOT NULL,
    `source` ENUM('wikipedia', 'lastfm', 'wikidata') NOT NULL,
    `title` VARCHAR(255) NOT NULL,
    `text` LONGTEXT NOT NULL,
    `source_url` VARCHAR(1024) NOT NULL,
    `permalink_url` VARCHAR(1024) NULL,
    `license` VARCHAR(100) NOT NULL,
    `attribution` VARCHAR(500) NOT NULL,
    `content_hash` CHAR(64) NOT NULL,
    `fetched_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `artist_documents_artist_id_source_key`(`artist_id`, `source`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `artist_tags` (
    `artist_id` CHAR(36) NOT NULL,
    `source` ENUM('wikipedia', 'lastfm', 'wikidata') NOT NULL,
    `name` VARCHAR(100) NOT NULL,

    PRIMARY KEY (`artist_id`, `source`, `name`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `similar_artists` (
    `artist_id` CHAR(36) NOT NULL,
    `source` ENUM('wikipedia', 'lastfm', 'wikidata') NOT NULL,
    `similar_name` VARCHAR(255) NOT NULL,
    `similar_mbid` CHAR(36) NULL,
    `match_score` DOUBLE NOT NULL,

    PRIMARY KEY (`artist_id`, `source`, `similar_name`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `artist_documents` ADD CONSTRAINT `artist_documents_artist_id_fkey` FOREIGN KEY (`artist_id`) REFERENCES `music_artists`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `artist_tags` ADD CONSTRAINT `artist_tags_artist_id_fkey` FOREIGN KEY (`artist_id`) REFERENCES `music_artists`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `similar_artists` ADD CONSTRAINT `similar_artists_artist_id_fkey` FOREIGN KEY (`artist_id`) REFERENCES `music_artists`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
