/** Bounded, non-executable imports. Files are never written using the supplied name. */
import { inflateRawSync } from 'node:zlib';
import { invariant, digest } from '../contracts/index.mjs';
import { requirementText } from './requirements.mjs';

function xmlText(xml) {
  invariant(!/<!DOCTYPE|<!ENTITY/i.test(xml), 'DOCUMENT_XML_UNSAFE', '文件含有不允許的 XML 宣告。');
  return xml.replace(/<w:tab\b[^>]*\/>/g, '\t').replace(/<w:(?:br|cr)\b[^>]*\/>/g, '\n')
    .replace(/<\/w:p\s*>/g, '\n').replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, entity) => {
      if (entity[0] !== '#') return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[entity];
      const code = entity[1] === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      invariant(code >= 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff), 'DOCUMENT_ENCODING', '文件含有無效字元。');
      return String.fromCodePoint(code);
    }).trim();
}
function docxText(bytes) {
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--)
    if (bytes.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  invariant(end >= 0 && bytes.readUInt16LE(end + 4) === 0 && bytes.readUInt16LE(end + 6) === 0, 'DOCUMENT_FORMAT', '不是有效的 DOCX 文件。');
  const count = bytes.readUInt16LE(end + 10), size = bytes.readUInt32LE(end + 12);
  let offset = bytes.readUInt32LE(end + 16), total = 0, document = null;
  invariant(count <= 2000 && offset + size <= end, 'DOCUMENT_SIZE', 'DOCX 結構超出限制。');
  for (let i = 0; i < count; i++) {
    invariant(offset + 46 <= end && bytes.readUInt32LE(offset) === 0x02014b50, 'DOCUMENT_FORMAT', 'DOCX 目錄已損毀。');
    const flags = bytes.readUInt16LE(offset + 8), method = bytes.readUInt16LE(offset + 10), compressed = bytes.readUInt32LE(offset + 20), uncompressed = bytes.readUInt32LE(offset + 24);
    const nameLength = bytes.readUInt16LE(offset + 28), extra = bytes.readUInt16LE(offset + 30), comment = bytes.readUInt16LE(offset + 32), local = bytes.readUInt32LE(offset + 42);
    invariant(offset + 46 + nameLength + extra + comment <= end && !(flags & 1), 'DOCUMENT_FORMAT', '不支援加密或損毀的 DOCX。');
    const name = bytes.subarray(offset + 46, offset + 46 + nameLength).toString('utf8'); total += uncompressed;
    invariant(total <= 16 * 1024 * 1024 && uncompressed <= 4 * 1024 * 1024, 'DOCUMENT_SIZE', 'DOCX 解壓縮內容超出限制。');
    if (name === 'word/document.xml') {
      invariant(document === null && local + 30 <= bytes.length && bytes.readUInt32LE(local) === 0x04034b50, 'DOCUMENT_FORMAT', 'DOCX 本文無效。');
      const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
      invariant(start + compressed <= bytes.length && [0, 8].includes(method), 'DOCUMENT_FORMAT', '不支援此 DOCX 壓縮格式。');
      const data = bytes.subarray(start, start + compressed);
      const unpacked = method === 0 ? data : inflateRawSync(data, { maxOutputLength: 4 * 1024 * 1024 });
      invariant(unpacked.length === uncompressed, 'DOCUMENT_FORMAT', 'DOCX 本文大小不符。');
      document = xmlText(new TextDecoder('utf-8', { fatal: true }).decode(unpacked));
    }
    offset += 46 + nameLength + extra + comment;
  }
  invariant(document !== null, 'DOCUMENT_FORMAT', 'DOCX 找不到文字本文。');
  return document;
}
export function importRequirementDocument(input) {
  invariant(typeof input.name === 'string' && input.name.length <= 200 && !/[\x00-\x1f/\\]/.test(input.name), 'DOCUMENT_NAME', '文件名稱無效。');
  invariant(typeof input.base64 === 'string' && input.base64.length <= 1400000 && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.base64), 'DOCUMENT_SIZE', '文件最多 1 MiB。');
  const bytes = Buffer.from(input.base64, 'base64');
  invariant(bytes.length > 0 && bytes.length <= 1024 * 1024, 'DOCUMENT_SIZE', '請選擇 1 MiB 以內、非空白的文件。');
  const ext = input.name.split('.').at(-1).toLowerCase();
  invariant(['txt', 'md', 'markdown', 'feature', 'docx'].includes(ext), 'DOCUMENT_TYPE', '目前支援 TXT、Markdown、Gherkin 與 DOCX；其他格式請先匯出為文字。');
  let text;
  try { text = ext === 'docx' ? docxText(bytes) : new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, ''); }
  catch (error) { if (error.code?.startsWith('DOCUMENT')) throw error; invariant(false, 'DOCUMENT_FORMAT', '文件無法讀取；請使用有效的 UTF-8 文字或 DOCX，原有內容未變更。'); }
  requirementText(text, '文件文字', { empty: false });
  return { name: input.name, text, size: bytes.length, sha256: digest(bytes), format: ext };
}
