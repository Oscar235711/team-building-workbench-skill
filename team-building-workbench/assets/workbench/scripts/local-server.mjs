import {createServer} from 'node:http';import {readFileSync,existsSync} from 'node:fs';
import {openDatabase,migrate} from '../src/sqlite.js';import {seed} from '../src/seed.js';import {serve} from '../src/web.js';
if(existsSync('.env'))process.loadEnvFile('.env');
const db=openDatabase(process.env.DATABASE_PATH||'data/team.sqlite');migrate(db);await seed(db);
const assets=()=>Object.fromEntries(['index.html','app.js','style.css','cloud.js'].map(f=>['/'+f,readFileSync('public/'+f,'utf8')]));
const server=createServer(async(req,res)=>{try{const chunks=[];let size=0;for await(const c of req){size+=c.length;if(size>160000){res.writeHead(413);res.end();return}chunks.push(c)}const request=new Request(`http://${req.headers.host}${req.url}`,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(chunks)}:{})});const response=await serve(request,{DB:db,ADMIN_TOKEN:process.env.ADMIN_TOKEN},assets());res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));}catch(e){console.error(e);res.writeHead(500);res.end('服务器暂时不可用')}});
const port=Number(process.env.PORT||4173);server.listen(port,process.env.HOST||'127.0.0.1',()=>console.log(`团建工作台 http://${process.env.HOST||'127.0.0.1'}:${port}`));
process.on('SIGTERM',()=>server.close(()=>{db.close();process.exit(0)}));
