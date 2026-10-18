# Metadata deployment

Generated from the canonical schema/migrations; do not edit SQL by hand.

Node.js 24 is required. Review manifest.json and the target database path.

New database: node deploy/migrate.mjs /absolute/path/metadata.sqlite
Existing database: node deploy/migrate.mjs /absolute/path/metadata.sqlite --backup /absolute/path/before-migration.sqlite

The runner verifies all SQL hashes and schema versions before applying migrations. An existing database with pending migrations requires a new backup path; existing backup files are never overwritten. Applied migrations are not rerun. The application applies seed.sql and any pending seed-upgrade.sql once per recorded seed key at startup after schema migrations. Do not apply seed files by hand; the application wraps each in a transaction and records its key.

DDL and DML files are inspection views; execute only complete transactional migrations in migrations/ to preserve step order. Deployment DML is listed per migration; no DML file is generated when no schema migration DML is required. Business transaction examples and test fixtures are not deployment DML.

A failed transaction rolls back. To restore committed or destructive changes, stop the application and restore the explicitly created SQLite backup; generated SQL does not invent a reversible down migration.
