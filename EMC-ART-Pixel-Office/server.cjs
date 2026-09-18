'use strict';
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const {spawn}=require('node:child_process');
const root=path.join(__dirname,'dist');
const port=8787;
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.svg':'image/svg+xml','.json':'application/json'};
const server=http.createServer((req,res)=>{
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);return res.end();}
  let pathname;
  try{pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);}catch{res.writeHead(400);return res.end('Invalid URL');}
  const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
  if(!file.startsWith(root+path.sep)){res.writeHead(403);return res.end('Forbidden');}
  fs.stat(file,(err,stat)=>{
    if(err||!stat.isFile()){res.writeHead(404);return res.end('Not found');}
    res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Content-Length':stat.size,'Cache-Control':'no-store'});
    if(req.method==='HEAD')return res.end();
    const stream=fs.createReadStream(file);stream.on('error',()=>res.destroy());stream.pipe(res);
  });
});
server.on('error',err=>{console.error(err.code==='EADDRINUSE'?'Port 8787 is already in use. Close the previous game server and try again.':err.message);process.exitCode=1;});
server.listen(port,'127.0.0.1',()=>{
  const url='http://localhost:'+port;
  console.log('Kaiyao Pixel Office: '+url+'\nPress Ctrl+C to stop.');
  if(process.argv.includes('--open')){
    const args=process.platform==='win32'?['cmd',['/c','start','',url]]:process.platform==='darwin'?['open',[url]]:['xdg-open',[url]];
    const child=spawn(args[0],args[1],{stdio:'ignore'});child.on('error',()=>console.log('Open the URL above in your browser.'));
  }
});
