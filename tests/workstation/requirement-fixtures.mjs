import { deflateRawSync } from 'node:zlib';
export function docxArchive(xml, { unsafeSize = false } = {}) {
  const name=Buffer.from('word/document.xml'),content=Buffer.from(xml),compressed=deflateRawSync(content);
  let crc=0xffffffff;for(const byte of content){crc^=byte;for(let k=0;k<8;k++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}crc=(crc^0xffffffff)>>>0;
  const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(8,8);local.writeUInt32LE(crc,14);local.writeUInt32LE(compressed.length,18);local.writeUInt32LE(content.length,22);local.writeUInt16LE(name.length,26);
  const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(8,10);central.writeUInt32LE(crc,16);central.writeUInt32LE(compressed.length,20);central.writeUInt32LE(unsafeSize?20*1024*1024:content.length,24);central.writeUInt16LE(name.length,28);
  const before=Buffer.concat([local,name,compressed]),directory=Buffer.concat([central,name]),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(before.length,16);
  return Buffer.concat([before,directory,end]);
}
