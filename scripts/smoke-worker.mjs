import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const directory=path.resolve(process.argv[2]||'work/ci');
const load=relative=>import(pathToFileURL(path.join(directory,relative)));
const {default:config}=await load('src/workbench-config.js');
const {default:worker}=await load('dist/server/index.js');
const {openDatabase,migrate}=await load('src/sqlite.js');
const secret=readFileSync(path.join(directory,'.env'),'utf8').match(/^ADMIN_TOKEN=(.+)$/m)[1];
assert.equal(readFileSync(path.join(directory,'dist/server/index.js'),'utf8').includes(secret),false);
const db=openDatabase();
try{
 migrate(db);
 const env={DB:db,ADMIN_TOKEN:secret};
 const home=await worker.fetch(new Request('https://workbench.example/'),env);
 assert.equal(home.status,200);assert.match(await home.text(),/<html/i);
 const response=await worker.fetch(new Request('https://workbench.example/api/state'),env);
 assert.equal(response.status,200);const state=await response.json();
 assert.equal(state.quarter.people,config.quarter.people);
 assert.equal(state.quarter.budgetCents,config.quarter.budgetCents);
 assert.equal(state.stats.submissions,0);assert.equal(state.stats.participants,0);
 for(const table of ['participants','sessions','submissions','comments'])assert.equal(db.raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n,0);
 const migrations=JSON.parse(readFileSync(path.join(directory,'dist/.openai/hosting.json'),'utf8'));
 assert.equal(migrations.d1,'DB');assert.equal(migrations.project_id,undefined);
 console.log(JSON.stringify({workerHome:200,workerState:200,people:config.quarter.people,budgetCents:config.quarter.budgetCents,emptyStorage:true,secretExcluded:true}));
}finally{db.close();}
