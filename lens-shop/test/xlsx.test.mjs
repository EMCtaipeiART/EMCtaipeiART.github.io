import fs from 'node:fs';
import { buildCatalog } from '../src/catalog.js';
import { fillForms, openBook, readSheet } from '../src/xlsx.js';
const f = process.env.XLSX || '/Users/emc-imac1/Desktop/NEW111.xlsx';
const bytes = new Uint8Array(fs.readFileSync(f));
const { catalog, images } = buildCatalog(bytes);
console.log('items', catalog.items.length, 'img', images.length, 'excl', catalog.exclusive.length, 'cards', catalog.limited.cards.length);
console.log(catalog.items.slice(0,2), catalog.items.find(i=>i.no===401), catalog.items.filter(i=>!i.power).map(i=>i.no+i.name).slice(0,12));
console.log(catalog.limited.cards.slice(0,3), catalog.limited.note.length, catalog.limited.title);
console.log('spec', catalog.specs.grid.length, catalog.specs.merges.length);
const rows = [
 {name:'王小明',no:1,sph:'300',qty:2,personTotal:600},
 {name:'王小明',no:7,sph:'300',cyl:'-0.75',axis:'180',qty:1,gift:'贈5片'},
 {name:'李 & <美>',no:401,qty:1,personTotal:13500},
];
const out = fillForms(bytes, rows);
fs.writeFileSync(process.env.OUT || '/tmp/filled.xlsx', out.bytes);
const b = openBook(out.bytes), s = readSheet(b,'填寫單1');
for (const r of [8,9,10,11]) console.log(r,[1,2,5,6,7,8,11,12].map(c=>s.get(r,c)));
const orig = readSheet(openBook(bytes),'填寫單1');
console.log('formula C8 kept', /<f>/.test(new TextDecoder().decode(b.files[s.path]).match(/<c r="C8"[\s\S]*?<\/c>/)[0]), out);
