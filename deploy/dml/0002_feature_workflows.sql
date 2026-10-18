INSERT INTO features(id,requirement_id,feature_key,stage)
 SELECT id,id,requirement_key,stage FROM requirements;
UPDATE documents SET feature_id=requirement_id WHERE purpose IN ('requirement','target_ci');
UPDATE baselines SET feature_id=requirement_id;
UPDATE runs SET feature_id=requirement_id WHERE origin='target_ci';
INSERT INTO feature_confirmations SELECT requirement_id,requirement_id,kind,version_id,raw_sha256,confirmed_at FROM confirmations;
