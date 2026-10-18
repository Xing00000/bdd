import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {sdSections, validateSdFormat} from '../../src/domain/sd-format.ts';

const file='spec/REQ-WB-001/workbench/workbench.sd.md';
const source=readFileSync(file,'utf8');

test('current SD has ordered canonical chapters, a development tree and database SQL',()=>{
  assert.deepEqual(validateSdFormat(source,file),[]);
});

test('SD format rejects missing, duplicated, unordered and empty chapters',()=>{
  for(const changed of [
    source.replace('## '+sdSections[0],'## 缺少來源章節'),
    source+'\n## '+sdSections[0]+'\n重複章節。\n',
    source.replace('## '+sdSections[0],'## temporary-heading').replace('## '+sdSections[1],'## '+sdSections[0]).replace('## temporary-heading','## '+sdSections[1]),
    source.replace(/(## 2\.[^\n]+\n)[\s\S]*?(?=## 3\.)/,'$1\n'),
  ]) assert.ok(validateSdFormat(changed,file).length>0);
});

test('SD format requires concrete file layout and SQL or a database exclusion with a reason',()=>{
  const minimal=sdSections.map(section=>'## '+section+'\n\n本章不適用：此測試只驗證格式。\n').join('\n');
  const errors=validateSdFormat(minimal,'invalid.sd.md');
  assert.ok(errors.some(error=>error.reason.includes('檔案目錄')));
  assert.ok(errors.some(error=>error.reason.includes('SQL')));
});
