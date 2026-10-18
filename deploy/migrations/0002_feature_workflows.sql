PRAGMA foreign_keys=ON;
BEGIN IMMEDIATE;
CREATE TABLE features (
 id TEXT PRIMARY KEY NOT NULL,
 requirement_id TEXT NOT NULL REFERENCES requirements(id),
 feature_key TEXT NOT NULL CHECK(length(feature_key)>0),
 stage TEXT NOT NULL CHECK(stage IN ('GHERKIN','SD','TESTS','IMPLEMENTATION','VERIFICATION','VERIFIED')),
 UNIQUE(requirement_id,feature_key), UNIQUE(id,requirement_id)
);
ALTER TABLE documents ADD COLUMN feature_id TEXT REFERENCES features(id);
ALTER TABLE baselines ADD COLUMN feature_id TEXT REFERENCES features(id);
ALTER TABLE runs ADD COLUMN feature_id TEXT REFERENCES features(id);
CREATE TABLE feature_confirmations (
 feature_id TEXT NOT NULL,
 requirement_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('gherkin','sd')),
 version_id TEXT NOT NULL,
 raw_sha256 TEXT NOT NULL,
 confirmed_at TEXT NOT NULL,
 PRIMARY KEY(feature_id,kind),
 FOREIGN KEY(feature_id,requirement_id) REFERENCES features(id,requirement_id),
 FOREIGN KEY(version_id,raw_sha256) REFERENCES document_versions(id,raw_sha256)
);
INSERT INTO features(id,requirement_id,feature_key,stage)
 SELECT id,id,requirement_key,stage FROM requirements;
UPDATE documents SET feature_id=requirement_id WHERE purpose IN ('requirement','target_ci');
UPDATE baselines SET feature_id=requirement_id;
UPDATE runs SET feature_id=requirement_id WHERE origin='target_ci';
INSERT INTO feature_confirmations SELECT requirement_id,requirement_id,kind,version_id,raw_sha256,confirmed_at FROM confirmations;
DROP TABLE confirmations;
ALTER TABLE feature_confirmations RENAME TO confirmations;
DROP INDEX one_requirement_document;
CREATE UNIQUE INDEX one_feature_document ON documents(feature_id,kind) WHERE purpose IN ('requirement','target_ci');
ALTER TABLE requirements DROP COLUMN stage;
CREATE TRIGGER documents_feature_insert BEFORE INSERT ON documents
WHEN NEW.purpose IN ('requirement','target_ci')
BEGIN
 SELECT CASE WHEN NEW.feature_id IS NULL OR NOT EXISTS(
  SELECT 1 FROM features WHERE id=NEW.feature_id AND requirement_id=NEW.requirement_id
 ) THEN RAISE(ABORT,'Feature must belong to requirement') END;
END;
CREATE TRIGGER documents_feature_update BEFORE UPDATE ON documents
WHEN NEW.purpose IN ('requirement','target_ci')
BEGIN
 SELECT CASE WHEN NEW.feature_id IS NULL OR NOT EXISTS(
  SELECT 1 FROM features WHERE id=NEW.feature_id AND requirement_id=NEW.requirement_id
 ) THEN RAISE(ABORT,'Feature must belong to requirement') END;
END;
CREATE TRIGGER baselines_feature_insert BEFORE INSERT ON baselines
WHEN 1
BEGIN
 SELECT CASE WHEN NEW.feature_id IS NULL OR NOT EXISTS(
  SELECT 1 FROM features WHERE id=NEW.feature_id AND requirement_id=NEW.requirement_id
 ) THEN RAISE(ABORT,'Feature must belong to requirement') END;
END;
CREATE TRIGGER baselines_feature_update BEFORE UPDATE ON baselines
WHEN 1
BEGIN
 SELECT CASE WHEN NEW.feature_id IS NULL OR NOT EXISTS(
  SELECT 1 FROM features WHERE id=NEW.feature_id AND requirement_id=NEW.requirement_id
 ) THEN RAISE(ABORT,'Feature must belong to requirement') END;
END;
CREATE TRIGGER runs_feature_insert BEFORE INSERT ON runs
WHEN NEW.origin='target_ci'
BEGIN
 SELECT CASE WHEN NEW.feature_id IS NULL OR NOT EXISTS(
  SELECT 1 FROM features WHERE id=NEW.feature_id AND requirement_id=NEW.requirement_id
 ) THEN RAISE(ABORT,'Feature must belong to requirement') END;
END;
CREATE TRIGGER runs_feature_update BEFORE UPDATE ON runs
WHEN NEW.origin='target_ci'
BEGIN
 SELECT CASE WHEN NEW.feature_id IS NULL OR NOT EXISTS(
  SELECT 1 FROM features WHERE id=NEW.feature_id AND requirement_id=NEW.requirement_id
 ) THEN RAISE(ABORT,'Feature must belong to requirement') END;
END;
CREATE TEMP TABLE migration_fk_check(failures INTEGER CHECK(failures=0));
INSERT INTO migration_fk_check SELECT count(*) FROM pragma_foreign_key_check;
DROP TABLE migration_fk_check;
PRAGMA user_version=2;
COMMIT;
PRAGMA foreign_keys=ON;
