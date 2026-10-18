ALTER TABLE requirements ADD COLUMN is_default_example INTEGER NOT NULL DEFAULT 0 CHECK(is_default_example IN (0,1));
ALTER TABLE requirements ADD COLUMN deleted_at TEXT;
CREATE UNIQUE INDEX one_default_example ON requirements(is_default_example) WHERE is_default_example=1;
