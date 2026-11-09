import fs from 'node:fs';import crypto from 'node:crypto';
const cat=await (await fetch('https://shop.emc-art.com/api/catalog')).json();
const pimgs=cat.pimgs||{};let sql='';
const jobs=JSON.parse(fs.readFileSync('jobs.json'));let n0=0;
for(const no of Object.keys(jobs)){
  const it=cat.catalog.items.find(i=>i.no==no);if(!it){console.log('no item',no);continue}
  const buf=fs.readFileSync('out/'+no+'.jpg');
  const key='box_'+crypto.createHash('md5').update(jobs[no]).digest('hex').slice(0,10);
  sql+=`DELETE FROM files WHERE k='img/${key}';\n`;
  for(let o=0,c=0;o<buf.length;o+=40000,c++)sql+=`INSERT INTO files(k,i,mime,data) VALUES('img/${key}',${c},'image/jpeg',X'${buf.subarray(o,o+40000).toString('hex')}');\n`;
  pimgs[no]='/api/img/'+key;n0++;
}
sql+=`INSERT INTO kv(k,v) VALUES('pimgs','${JSON.stringify(pimgs).replace(/'/g,"''")}') ON CONFLICT(k) DO UPDATE SET v=excluded.v;`;
fs.writeFileSync('up.sql',sql);console.log('items',n0,'pimgs total',Object.keys(pimgs).length,'sqlKB',Math.round(sql.length/1024));
