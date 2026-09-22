// Code-native brand mark rasterizer. Supersampling keeps toolbar sizes crisp.
import { deflateSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const directory=fileURLToPath(new URL('../assets/',import.meta.url));
await mkdir(directory,{recursive:true});
const table=new Uint32Array(256);
for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;table[n]=c>>>0;}
function chunk(type,data){const t=Buffer.from(type);let crc=0xffffffff;for(const v of Buffer.concat([t,data]))crc=table[(crc^v)&255]^(crc>>>8);const result=Buffer.alloc(data.length+12);result.writeUInt32BE(data.length);t.copy(result,4);data.copy(result,8);result.writeUInt32BE((crc^0xffffffff)>>>0,data.length+8);return result;}
function lineDistance(x,y,ax,ay,bx,by){const t=Math.max(0,Math.min(1,((x-ax)*(bx-ax)+(y-ay)*(by-ay))/((bx-ax)**2+(by-ay)**2)));return Math.hypot(x-(ax+t*(bx-ax)),y-(ay+t*(by-ay)));}
function sample(x,y){const background=[54,88,68];const foreground=[243,247,228];const cornerX=Math.max(6-x,0,x-34),cornerY=Math.max(6-y,0,y-34);if(Math.hypot(cornerX,cornerY)>5)return [0,0,0,0];const d=Math.hypot(x-19,y-19);const angle=Math.atan2(y-19,x-19);const outer=Math.abs(d-10)<1.4&&!(angle>.35&&angle<1.04);const inner=Math.abs(d-5.5)<1.15&&!(angle>-.4&&angle<.9);const stem=lineDistance(x,y,29,18,29,31)<1.4;const mark=outer||inner||stem;return [...(mark?foreground:background),255];}
for(const size of [16,32,48,128]){const raw=Buffer.alloc(size*(1+size*4));for(let y=0;y<size;y++){const row=y*(1+size*4);for(let x=0;x<size;x++){const sum=[0,0,0,0];for(let sy=0;sy<4;sy++)for(let sx=0;sx<4;sx++){const p=sample((x+(sx+.5)/4)*40/size,(y+(sy+.5)/4)*40/size);p.forEach((v,i)=>sum[i]+=v);}sum.forEach((v,i)=>raw[row+1+x*4+i]=Math.round(v/16));}}const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(size);ihdr.writeUInt32BE(size,4);ihdr[8]=8;ihdr[9]=6;const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);await writeFile(`${directory}/icon-${size}.png`,png);}
console.log('Generated Avatara icons: 16, 32, 48, 128.');
