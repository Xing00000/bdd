import { RuntimeAdapterError } from './errors.js';

export function quoteIdentifier(identifier: string): string { return `"${identifier.replaceAll('"', '""')}"`; }

// Split ordinary editor scripts without splitting quoted literals/comments.
// Trigger bodies require a migration parser; an incomplete CREATE TRIGGER will
// fail rather than silently running a prefix as a successful migration.
export function splitStatements(sql: string): string[] {
  if (typeof sql !== 'string' || !sql.trim()) throw new RuntimeAdapterError('INVALID_SQL', 'SQL must not be empty');
  let quote = '', lineComment = false, blockComment = false, significant = false, start = 0;
  const statements: string[] = [];
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i], next = sql[i + 1];
    if (lineComment) { if (c === '\n') lineComment = false; continue; }
    if (blockComment) { if (c === '*' && next === '/') { blockComment = false; i++; } continue; }
    if (quote) {
      if (c === quote) { if (next === quote && quote !== ']') i++; else quote = ''; }
      continue;
    }
    if (c === '-' && next === '-') { lineComment = true; i++; continue; }
    if (c === '/' && next === '*') { blockComment = true; i++; continue; }
    if (/\s/.test(c)) continue;
    if (c === ';') { if (significant) statements.push(sql.slice(start, i + 1)); start = i + 1; significant = false; continue; }
    significant = true;
    if (c === "'" || c === '"' || c === '`') quote = c;
    else if (c === '[') quote = ']';
  }
  if (quote || blockComment) throw new RuntimeAdapterError('INVALID_SQL', 'SQL contains an unterminated literal/comment');
  if (significant) statements.push(sql.slice(start));
  if (!statements.length) throw new RuntimeAdapterError('INVALID_SQL', 'SQL contains no statement');
  return statements;
}

export function singleStatement(sql: string): string {
  if (splitStatements(sql).length !== 1) throw new RuntimeAdapterError('MULTIPLE_SQL_STATEMENTS', 'Exactly one SQL statement is required here');
  return sql;
}
