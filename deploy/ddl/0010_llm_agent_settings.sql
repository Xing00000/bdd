CREATE TABLE application_seed_history (
 seed_key TEXT PRIMARY KEY NOT NULL,
 applied_at TEXT NOT NULL
);
CREATE TABLE llm_cli_commands (
 id TEXT PRIMARY KEY NOT NULL,
 name TEXT NOT NULL UNIQUE CHECK(length(trim(name))>0),
 executable TEXT NOT NULL CHECK(length(trim(executable))>0),
 args_json TEXT NOT NULL CHECK(json_valid(args_json) AND json_type(args_json)='array')
);
CREATE TABLE llm_skills (
 id TEXT PRIMARY KEY NOT NULL,
 name TEXT NOT NULL UNIQUE CHECK(length(trim(name))>0),
 instructions TEXT NOT NULL CHECK(length(trim(instructions))>0)
);
CREATE TABLE llm_agents (
 id TEXT PRIMARY KEY NOT NULL,
 name TEXT NOT NULL UNIQUE CHECK(length(trim(name))>0),
 cli_command_id TEXT NOT NULL REFERENCES llm_cli_commands(id) ON DELETE RESTRICT,
 skill_id TEXT REFERENCES llm_skills(id) ON DELETE RESTRICT,
 prompt TEXT NOT NULL CHECK(length(trim(prompt))>0)
);
CREATE INDEX llm_agents_by_command ON llm_agents(cli_command_id,name);
CREATE INDEX llm_agents_by_skill ON llm_agents(skill_id,name);
