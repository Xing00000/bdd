CREATE TABLE documents_new (
 id TEXT PRIMARY KEY NOT NULL,
 project_id TEXT REFERENCES projects(id),
 requirement_id TEXT REFERENCES requirements(id),
 kind TEXT NOT NULL CHECK(kind IN ('gherkin','sd','spec')),
 purpose TEXT NOT NULL CHECK(purpose IN ('requirement','target_ci','integration','recording')),
 file_name TEXT NOT NULL,
 feature_id TEXT REFERENCES features(id),
 CHECK((purpose='requirement' AND kind IN ('gherkin','sd') AND requirement_id IS NOT NULL AND project_id IS NULL)
 OR (purpose='target_ci' AND kind='spec' AND requirement_id IS NOT NULL AND project_id IS NULL)
 OR (purpose='integration' AND kind='spec' AND project_id IS NOT NULL)
 OR (purpose='recording' AND kind='spec'))
);

DROP TABLE documents;
ALTER TABLE documents_new RENAME TO documents;
CREATE UNIQUE INDEX one_feature_document ON documents(feature_id,kind) WHERE purpose IN ('requirement','target_ci');
CREATE TRIGGER documents_feature_insert BEFORE INSERT ON documents
WHEN NEW.purpose IN ('requirement','target_ci')
BEGIN
 SELECT CASE WHEN NEW.feature_id IS NULL OR NOT EXISTS(SELECT 1 FROM features WHERE id=NEW.feature_id AND requirement_id=NEW.requirement_id)
 THEN RAISE(ABORT,'Feature must belong to requirement') END;
END;
CREATE TRIGGER documents_feature_update BEFORE UPDATE ON documents
WHEN NEW.purpose IN ('requirement','target_ci')
BEGIN
 SELECT CASE WHEN NEW.feature_id IS NULL OR NOT EXISTS(SELECT 1 FROM features WHERE id=NEW.feature_id AND requirement_id=NEW.requirement_id)
 THEN RAISE(ABORT,'Feature must belong to requirement') END;
END;
