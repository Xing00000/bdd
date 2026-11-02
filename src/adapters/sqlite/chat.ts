import type {MetadataMigration} from './migrations.ts';

export const chatMigration:MetadataMigration={
 id:'0012_chat_rooms',fromVersion:11,toVersion:12,
 dmlReason:'Chat rooms and messages are created by users. Runtime settings are initialized by the chat service.',
 steps:[{kind:'ddl',sql:`
 CREATE TABLE chat_rooms (
  id TEXT PRIMARY KEY NOT NULL, title TEXT NOT NULL,
  thread_id TEXT UNIQUE, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
 );
 CREATE TABLE chat_messages (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT UNIQUE NOT NULL, room_id TEXT NOT NULL REFERENCES chat_rooms(id),
  role TEXT NOT NULL CHECK(role IN ('user','assistant')),
  content TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('pending','completed','failed','interrupted')),
  error TEXT, created_at TEXT NOT NULL
 );
 CREATE INDEX chat_messages_by_room ON chat_messages(room_id,sequence);
 CREATE UNIQUE INDEX chat_one_pending_message ON chat_messages(room_id) WHERE status='pending';
 CREATE TABLE chat_settings (id INTEGER PRIMARY KEY CHECK(id=1), value_json TEXT NOT NULL);
 `}],
};
