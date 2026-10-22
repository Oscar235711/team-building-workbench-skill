import {readdirSync,lstatSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export function auditEntry(name,content){
 const findings=[],base=path.posix.basename(name.replaceAll('\\','/'));
 if(/^\.env(?:\.|$)|^\.dev\.vars|\.(?:sqlite(?:-wal|-shm)?|sqlite3|db|pem|key|p12|pfx|log)$/i.test(base))findings.push({path:name,kind:'private-runtime-file'});
 const checks=[['original-site-identity',/appg(?:prj|dep|ver)_[a-zA-Z0-9]+|team-inspiration-2026q4|C:\\Users\\25905/i],['credential',/gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|AKIA[A-Z0-9]{16}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],['literal-admin-secret',/ADMIN_TOKEN\s*[:=]\s*["']?[A-Za-z0-9_-]{24,}/],['personal-email',/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i]];
 for(const [kind,pattern] of checks)if(pattern.test(content))findings.push({path:name,kind});
 return findings;
}
export function auditDirectory(root){const findings=[],files=[];function walk(dir){for(const name of readdirSync(dir)){const p=path.join(dir,name),info=lstatSync(p),relative=path.relative(root,p).split(path.sep).join('/');if(info.isSymbolicLink()){findings.push({path:relative,kind:'symbolic-link'});continue;}if(info.isDirectory())walk(p);else if(info.isFile()){files.push(relative);findings.push(...auditEntry(relative,readFileSync(p,'utf8')));}}}walk(root);return {files:files.length,findings};}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const root=path.resolve(process.argv[2]||'team-building-workbench'),result=auditDirectory(root);console.log(JSON.stringify({scope:'skill-directory',...result}));if(result.findings.length)process.exitCode=1;
}
