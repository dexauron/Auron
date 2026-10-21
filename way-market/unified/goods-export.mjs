// Runtime fills an authored XLSX template. Only Node built-ins are required.
import {readFileSync} from 'node:fs';
import {inflateRawSync} from 'node:zlib';
import {DOCUMENT_TYPES,DOCUMENT_STATUSES} from './goods-documents.mjs';
// Characters outside XML 1.0 make Excel reject the whole file; show them as U+FFFD.
const escape=v=>String(v??'').replace(/[^\t\n\r\u0020-\ud7ff\ue000-\ufffd\u{10000}-\u{10ffff}]/gu,'\ufffd').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'})[c]);
export function unpackZip(buffer){
 let e=buffer.length-22;while(e>=Math.max(0,buffer.length-65557)&&buffer.readUInt32LE(e)!==0x06054b50)e--;if(e<0)throw Error('Invalid XLSX template');
 let pos=buffer.readUInt32LE(e+16);const entries=new Map();
 for(let i=0;i<buffer.readUInt16LE(e+10);i++){
  if(buffer.readUInt32LE(pos)!==0x02014b50)throw Error('Invalid ZIP directory');const method=buffer.readUInt16LE(pos+10),size=buffer.readUInt32LE(pos+20),len=buffer.readUInt16LE(pos+28),extra=buffer.readUInt16LE(pos+30),comment=buffer.readUInt16LE(pos+32),start=buffer.readUInt32LE(pos+42),name=buffer.subarray(pos+46,pos+46+len).toString();
  const offset=start+30+buffer.readUInt16LE(start+26)+buffer.readUInt16LE(start+28),raw=buffer.subarray(offset,offset+size);if(![0,8].includes(method))throw Error('Unsupported ZIP compression');entries.set(name,method===8?inflateRawSync(raw):Buffer.from(raw));pos+=46+len+extra+comment;
 }return entries;
}
const crcTable=Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function crc32(b){let c=0xffffffff;for(const x of b)c=crcTable[(c^x)&255]^(c>>>8);return (c^0xffffffff)>>>0;}
export function packZip(entries){const chunks=[],directory=[];let offset=0;for(const [name,body]of entries){const n=Buffer.from(name),b=Buffer.from(body),crc=crc32(b),h=Buffer.alloc(30),c=Buffer.alloc(46);h.writeUInt32LE(0x04034b50);h.writeUInt16LE(20,4);h.writeUInt16LE(0x800,6);h.writeUInt16LE(33,12);h.writeUInt32LE(crc,14);h.writeUInt32LE(b.length,18);h.writeUInt32LE(b.length,22);h.writeUInt16LE(n.length,26);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(0x800,8);c.writeUInt16LE(33,14);c.writeUInt32LE(crc,16);c.writeUInt32LE(b.length,20);c.writeUInt32LE(b.length,24);c.writeUInt16LE(n.length,28);c.writeUInt32LE(offset,42);chunks.push(h,n,b);directory.push(c,n);offset+=h.length+n.length+b.length;}const tail=Buffer.alloc(22),central=Buffer.concat(directory);tail.writeUInt32LE(0x06054b50);tail.writeUInt16LE(entries.size,8);tail.writeUInt16LE(entries.size,10);tail.writeUInt32LE(central.length,12);tail.writeUInt32LE(offset,16);return Buffer.concat([...chunks,central,tail]);}
function fillSheet(xml,rows){
 xml=xml.replace(/(<\/?)x:/g,'$1').replace('xmlns:x=','xmlns=');
 const sample=/<row\b[^>]*\br="2"[^>]*>([\s\S]*?)<\/row>/.exec(xml)?.[1]??'',styles=new Map();for(const c of sample.matchAll(/<c\b([^>]*)>/g)){const col=/\br="([A-Z]+)2"/.exec(c[1])?.[1],style=/\bs="(\d+)"/.exec(c[1])?.[1];if(col&&style)styles.set(col,style);}
 const header=/<row\b[^>]*\br="1"[^>]*>[\s\S]*?<\/row>/.exec(xml)?.[0];if(!header)throw Error('Template header missing');
 const widths=rows[0].length===12?[6,42,15,12,17,18,23,20,25,28,36,42]:[32,85];
 const body=rows.map((row,i)=>'<row r="'+(i+2)+'" ht="'+Math.max(30,...row.map((v,j)=>Math.ceil(String(v??'').length/(widths[j]*0.85))*16+10))+'" customHeight="1">'+row.map((value,j)=>{const col=String.fromCharCode(65+j),ref=col+(i+2),s=styles.has(col)?' s="'+styles.get(col)+'"':'';return typeof value==='number'?'<c r="'+ref+'"'+s+' t="n"><v>'+value+'</v></c>':'<c r="'+ref+'"'+s+' t="inlineStr"><is><t xml:space="preserve">'+escape(value)+'</t></is></c>';}).join('')+'</row>').join('');
 return xml.replace(/<sheetData[^>]*>[\s\S]*?<\/sheetData>/,'<sheetData>'+header+body+'</sheetData>').replace(/<dimension[^>]*\/>/,'<dimension ref="A1:'+String.fromCharCode(64+rows[0].length)+(rows.length+1)+'"/>');
}
export function goodsWorkbook(envelope){
 const d=envelope.document,entries=unpackZip(readFileSync(new URL('./assets/goods-template.xlsx',import.meta.url))),rows=d.lines.map((l,i)=>[i+1,l.name,Number(l.quantity),l.unit,l.cashCode,l.articleCode,l.barcode,l.externalId,l.article,l.reason,l.note,l.productId]);
 const metadata=[['Номер',d.number],['Вид',DOCUMENT_TYPES[d.type]],['Дата',d.date],['Склад',d.warehouse],['Поставщик',d.supplier],['Автор',d.authorName],['Статус',DOCUMENT_STATUSES[d.status]],['Подтвердил',d.review?.name??''],['Источник 1С',d.sourceId],['Комментарий',d.note],['Версия',String(d.version)],['Ключ повтора',envelope.idempotencyKey],['Загрузка в 1С','Сопоставьте столбцы с обработкой загрузки вашей конфигурации. Повторная загрузка Excel сама по себе не защищена от дублей.'],['Передача в 1С','Автоматическое подключение ещё не настроено.']];
 for(const [name,data]of [['xl/worksheets/sheet1.xml',rows],['xl/worksheets/sheet2.xml',metadata]])entries.set(name,Buffer.from(fillSheet(entries.get(name).toString(),data)));
 return packZip(entries);
}
