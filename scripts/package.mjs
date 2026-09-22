import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';
const root=fileURLToPath(new URL('..',import.meta.url));
const table=new Uint32Array(256);
for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;table[n]=c>>>0;}
function crc32(data){let c=0xffffffff;for(const v of data)c=table[(c^v)&255]^(c>>>8);return(c^0xffffffff)>>>0;}
async function walk(dir){const result=[];for(const entry of await readdir(dir,{withFileTypes:true})){if(entry.isSymbolicLink())throw new Error('Symlinks are not packaged.');const file=join(dir,entry.name);if(entry.isDirectory())result.push(...await walk(file));else result.push(file);}return result;}
const files=[join(root,'manifest.json'),join(root,'index.html'),...await walk(join(root,'assets'))];
for(const sub of ['core','background','popup','ui'])files.push(...await walk(join(root,'src',sub)));
const local=[],central=[];let offset=0;
for(const file of files.sort()){
  const name=Buffer.from(relative(root,file).replaceAll('\\','/'));
  if(!/\.(?:json|html|css|js|png|svg)$/.test(file))throw new Error('Unexpected release file.');
  const data=await readFile(file),compressed=deflateRawSync(data),crc=crc32(data);
  const header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);header.writeUInt16LE(0x800,6);header.writeUInt16LE(8,8);header.writeUInt32LE(crc,14);header.writeUInt32LE(compressed.length,18);header.writeUInt32LE(data.length,22);header.writeUInt16LE(name.length,26);
  local.push(header,name,compressed);
  const record=Buffer.alloc(46);record.writeUInt32LE(0x02014b50);record.writeUInt16LE(20,4);record.writeUInt16LE(20,6);record.writeUInt16LE(0x800,8);record.writeUInt16LE(8,10);record.writeUInt32LE(crc,16);record.writeUInt32LE(compressed.length,20);record.writeUInt32LE(data.length,24);record.writeUInt16LE(name.length,28);record.writeUInt32LE(offset,42);central.push(record,name);
  offset+=header.length+name.length+compressed.length;
}
const centralData=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(centralData.length,12);end.writeUInt32LE(offset,16);
const manifest=JSON.parse(await readFile(join(root,'manifest.json'),'utf8'));
if(!/^\d+\.\d+\.\d+$/.test(manifest.version))throw new Error('Invalid release version.');
const output=join(root,'dist',`avatara-${manifest.version}.zip`);await mkdir(dirname(output),{recursive:true});const archive=Buffer.concat([...local,centralData,end]);await writeFile(output,archive);
console.log(`Packaged ${files.length} production files (${archive.length} bytes): ${output}`);
