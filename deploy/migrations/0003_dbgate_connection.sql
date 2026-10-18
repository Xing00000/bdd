PRAGMA foreign_keys=ON;
BEGIN IMMEDIATE;
ALTER TABLE target_connections ADD COLUMN dbgate_url TEXT; ALTER TABLE target_connections ADD COLUMN dbgate_connection_name TEXT;
CREATE TEMP TABLE migration_fk_check(failures INTEGER CHECK(failures=0));
INSERT INTO migration_fk_check SELECT count(*) FROM pragma_foreign_key_check;
DROP TABLE migration_fk_check;
PRAGMA user_version=3;
COMMIT;
PRAGMA foreign_keys=ON;
