export type SqlValue = null | string | number | bigint | Uint8Array;
export type Row = Record<string, any>;
export interface SqlCommand {
  sql: string;
  params?: SqlValue[];
  mode?: 'run' | 'all';
  expectChanges?: number;
  expectRows?: number;
}
export interface RunResult { changes: number; lastInsertRowid: number | bigint }
export interface Store {
  all<T extends Row = Row>(sql: string, params?: SqlValue[]): Promise<T[]>;
  run(sql: string, params?: SqlValue[]): Promise<RunResult>;
  batch(commands: SqlCommand[]): Promise<any[]>;
  close(): Promise<void>;
}
