import {readdirSync,lstatSync,readFileSync} from 'node:fs';
import path from 'node:path';
const ignored=new Set(['.git','outputs','work','node_modules']);const files=[];
function walk(dir){for(const name of readdirSync(dir)){if(ignored.has(name))continue;const p=path.join(dir,name),info=lstatSync(p);if(info.isSymbolicLink())throw new Error('Unexpected symbolic link: '+p);if(info.isDirectory())walk(p);else files.push(p);}}
walk('.');const banned=[/appgprj_[a-zA-Z0-9]+/,/appgdep_[a-zA-Z0-9]+/,/team-inspiration-2026q4/,/chatgpt\.site/,/C:\\Users\\25905/i,/gh[pousr]_[A-Za-z0-9]{20,}/,/github_pat_[A-Za-z0-9_]{20,}/,/sk-[A-Za-z0-9_-]{20,}/];
for(const file of files){const base=path.basename(file);if(base==='.env'||/\.sqlite(?:-|$)/.test(base)||base.endsWith('.pem'))throw new Error('Private runtime file: '+file);const content=readFileSync(file,'utf8');if(file!==path.join('scripts','audit-package.mjs')&&banned.some(re=>re.test(content)))throw new Error('Private identity or credential pattern found: '+file);}
console.log(JSON.stringify({files:files.length,privateRuntimeFiles:false,originalSiteIdentity:false,credentialPatterns:false}));
