ALTER TABLE `Request`
ADD COLUMN `disabledAutoHeaders` JSON NULL;

UPDATE `Request`
SET `disabledAutoHeaders` = JSON_ARRAY()
WHERE `disabledAutoHeaders` IS NULL;

ALTER TABLE `Request`
MODIFY `disabledAutoHeaders` JSON NOT NULL;
