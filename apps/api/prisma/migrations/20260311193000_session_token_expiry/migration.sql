ALTER TABLE `SessionToken`
    ADD COLUMN `expiresAt` DATETIME(3) NULL;

UPDATE `SessionToken`
SET `expiresAt` = DATE_ADD(`createdAt`, INTERVAL 90 DAY)
WHERE `expiresAt` IS NULL;

ALTER TABLE `SessionToken`
    MODIFY `expiresAt` DATETIME(3) NOT NULL;

CREATE INDEX `SessionToken_expiresAt_idx` ON `SessionToken`(`expiresAt`);
