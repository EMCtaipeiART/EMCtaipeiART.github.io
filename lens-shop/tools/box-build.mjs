import fs from 'node:fs'; import crypto from 'node:crypto';
import rules from './box-rules.mjs';
const cat=await (await fetch('https://shop.emc-art.com/api/catalog')).json();
const pimgs=cat.pimgs||{};const ts=Date.now().toString(36);let sql='',hit=0;const miss=[];
const cache={};const done=fs.existsSync('/tmp/done.json')?JSON.parse(fs.readFileSync('/tmp/done.json')):{};
for(const r of rules){
  const items=cat.catalog.items.filter(i=>i.brand===r.b&&r.re.test(i.name)&&!(r.not&&r.not.test(i.name)));
  if(!items.length){console.log('NO ITEMS',r.re);continue}
  if(!cache[r.url]){const res=await fetch(r.url,{headers:{'user-agent':'Mozilla/5.0 Chrome/120'}});
    if(!res.ok){console.log('FAIL',res.status,r.url.slice(0,90));cache[r.url]=null;continue}
    const buf=Buffer.from(await res.arrayBuffer());const mime=res.headers.get('content-type')||'image/png';
    const key='box_'+crypto.createHash('md5').update(r.url).digest('hex').slice(0,10);
    fs.writeFileSync('/tmp/'+key.split('_')[1]+'.img',buf);
    if(!done[key])sql+=`DELETE FROM files WHERE k='img/${key}';\n`;if(!done[key])for(let o=0,n=0;o<buf.length;o+=40000,n++)sql+=`INSERT INTO files(k,i,mime,data) VALUES('img/${key}',${n},'${mime}',X'${buf.subarray(o,o+40000).toString('hex')}');\n`;
    done[key]=1;cache[r.url]=key;console.log('ok',buf.length,mime,key)}
  const key=cache[r.url];if(!key)continue;
  for(const it of items){pimgs[it.no]='/api/img/'+key;hit++}
}
sql+=`INSERT INTO kv(k,v) VALUES('pimgs','${JSON.stringify(pimgs).replace(/'/g,"''")}') ON CONFLICT(k) DO UPDATE SET v=excluded.v;`;
fs.writeFileSync('/tmp/up.sql',sql);fs.writeFileSync('/tmp/done.json',JSON.stringify(done));console.log('items matched',hit,'sqlKB',Math.round(sql.length/1024));
