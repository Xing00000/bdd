PRAGMA foreign_keys=ON;
BEGIN IMMEDIATE;
ALTER TABLE documents ADD COLUMN deleted_at TEXT;
CREATE TEMP TABLE migration_fk_check(failures INTEGER CHECK(failures=0));
INSERT INTO migration_fk_check SELECT count(*) FROM pragma_foreign_key_check;
DROP TABLE migration_fk_check;
PRAGMA user_version=9;
COMMIT;
PRAGMA foreign_keys=ON;
