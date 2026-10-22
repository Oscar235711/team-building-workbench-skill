import test from 'node:test';
import assert from 'node:assert/strict';
import {auditEntry} from '../scripts/audit-package.mjs';
import {validateTemplate} from '../team-building-workbench/scripts/create-workbench.mjs';
import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';

test('package audit rejects runtime records and literal credentials without echoing values',()=>{
 for(const name of ['.env','assets/workbench/.env.production','data/team.sqlite-wal','backup.db','private.pem','debug.log'])assert.ok(auditEntry(name,'').length,name);
 const token='ghp_'+'A'.repeat(36);const findings=auditEntry('src/example.js',`const key="${token}"`);assert.ok(findings.length);assert.equal(JSON.stringify(findings).includes(token),false);
 assert.ok(auditEntry('x.txt','-----BEGIN '+'PRIVATE KEY-----').length);assert.ok(auditEntry('x.txt','appgprj_'+'a'.repeat(32)).length);
 assert.deepEqual(auditEntry('src/example.js','const token = process.env.ADMIN_TOKEN;'),[]);
});

test('template preflight rejects private or unexpected files before generating output',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'workbench-template-audit-'));mkdirSync(path.join(dir,'public'));writeFileSync(path.join(dir,'public','index.html'),'example');writeFileSync(path.join(dir,'.env.production'),'PRIVATE_VALUE=example');assert.throws(()=>validateTemplate(dir),/模板.*文件|不允许/);
});
