-- AlterTable
ALTER TABLE `User` ADD COLUMN `avatarUrl` LONGTEXT NULL;

-- AlterTable
ALTER TABLE `UserPreference` ADD COLUMN `themeMode` VARCHAR(20) NOT NULL DEFAULT 'system';
