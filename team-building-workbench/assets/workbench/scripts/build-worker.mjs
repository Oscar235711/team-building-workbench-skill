import {build} from 'esbuild';
import {mkdirSync,readFileSync,writeFileSync,existsSync,copyFileSync,readdirSync} from 'node:fs';
mkdirSync('src/generated',{recursive:true});const assets=Object.fromEntries(['index.html','app.js','style.css','cloud.js'].map(f=>['/'+f,readFileSync('public/'+f,'utf8')]));writeFileSync('src/generated/assets.js','export default '+JSON.stringify(assets)+';\n');
mkdirSync('dist/server',{recursive:true});await build({entryPoints:['worker/index.js'],outfile:'dist/server/index.js',bundle:true,format:'esm',platform:'browser',target:'es2022',legalComments:'none'});
if(existsSync('.openai/hosting.json')){mkdirSync('dist/.openai/drizzle',{recursive:true});copyFileSync('.openai/hosting.json','dist/.openai/hosting.json');for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')))copyFileSync('drizzle/'+file,'dist/.openai/drizzle/'+file);}
console.log('Built dist/server/index.js (Worker fetch module + shared D1 API)');
