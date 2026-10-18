import type {MetadataMigration} from './migrations.ts';

export const featureMigration:MetadataMigration={
  id:'0002_feature_workflows',fromVersion:1,toVersion:2,
  dmlReason:'Preserve each legacy requirement workflow as its first feature, including confirmations, documents, baselines and runs.',
  steps:[{kind:'ddl',sql:`
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
);`},{kind:'dml',sql:`
INSERT INTO features(id,requirement_id,feature_key,stage)
 SELECT id,id,requirement_key,stage FROM requirements;
UPDATE documents SET feature_id=requirement_id WHERE purpose IN ('requirement','target_ci');
UPDATE baselines SET feature_id=requirement_id;
UPDATE runs SET feature_id=requirement_id WHERE origin='target_ci';
INSERT INTO feature_confirmations SELECT requirement_id,requirement_id,kind,version_id,raw_sha256,confirmed_at FROM confirmations;
`},{kind:'ddl',sql:`
DROP TABLE confirmations;
ALTER TABLE feature_confirmations RENAME TO confirmations;
DROP INDEX one_requirement_document;
CREATE UNIQUE INDEX one_feature_document ON documents(feature_id,kind) WHERE purpose IN ('requirement','target_ci');
ALTER TABLE requirements DROP COLUMN stage;
`},...(['documents','baselines','runs'] as const).flatMap(table=>
    (['INSERT','UPDATE'] as const).map(operation=>({kind:'ddl' as const,sql:`
CREATE TRIGGER ${table}_feature_${operation.toLowerCase()} BEFORE ${operation} ON ${table}
WHEN ${table==='documents'?"NEW.purpose IN ('requirement','target_ci')":table==='runs'?"NEW.origin='target_ci'":'1'}
BEGIN
 SELECT CASE WHEN NEW.feature_id IS NULL OR NOT EXISTS(
  SELECT 1 FROM features WHERE id=NEW.feature_id AND requirement_id=NEW.requirement_id
 ) THEN RAISE(ABORT,'Feature must belong to requirement') END;
END;`}))
  )],
};
