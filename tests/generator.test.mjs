import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,existsSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createWorkbench,normalizeOptions} from '../team-building-workbench/scripts/create-workbench.mjs';

const root=()=>mkdtempSync(path.join(tmpdir(),'workbench-skill-test-'));
test('only people and total budget are mandatory; zero and invalid values are rejected',()=>{
 const c=normalizeOptions({people:'18',budget:'2500.50'});assert.equal(c.quarter.people,18);assert.equal(c.quarter.budgetCents,250050);assert.equal(c.terms.filter(t=>t.level===1).length,2);assert.equal(c.terms.filter(t=>t.level===2).length,6);
 for(const opts of [{budget:100},{people:2},{people:0,budget:1},{people:2.5,budget:1},{people:1001,budget:1},{people:2,budget:'1.001'},{people:2,budget:'1e3'},{people:2,budget:0}])assert.throws(()=>normalizeOptions(opts));
});
test('independent instances have empty storage and distinct private admin secrets',async()=>{
 const base=root(),a=path.join(base,'a'),b=path.join(base,'b');createWorkbench({people:18,budget:2500,out:a});createWorkbench({people:7,budget:900,out:b});
 const ca=(await import(pathToFileURL(path.join(a,'src/workbench-config.js')))).default;assert.equal(ca.quarter.people,18);assert.equal(ca.quarter.budgetCents,250000);
 assert.notEqual(readFileSync(path.join(a,'.env'),'utf8'),readFileSync(path.join(b,'.env'),'utf8'));assert.equal(existsSync(path.join(a,'data/team.sqlite')),false);assert.equal(existsSync(path.join(a,'.git')),false);assert.equal(JSON.parse(readFileSync(path.join(a,'.openai/hosting.json'),'utf8')).project_id,undefined);
 assert.throws(()=>createWorkbench({people:18,budget:2500,out:a}),/exist|存在/i);
});
test('reference costs are optional, cents are exact, and quotes never become historical spend',()=>{
 const refs=[{name:'聚餐',budget:'1800.25',play:'dinner'},{name:'KTV',budget:0,pricingMode:'per_event'},{name:'公园徒步'}];
 const c=normalizeOptions({people:18,budget:3000,references:refs});const items=c.terms.filter(t=>t.level===3);assert.equal(items.length,3);assert.equal(items[0].attrs.priceCents,180025);assert.equal(items[0].attrs.pricingMode,'per_event');assert.equal(items[1].attrs.priceCents,0);assert.equal(items[1].parentId,'play-small-indoor');assert.equal(items[2].attrs.priceCents,null);assert.equal(items[2].attrs.location,'');assert.deepEqual(c.history,[]);
 assert.throws(()=>normalizeOptions({people:2,budget:100,references:[{name:'a',budget:-1}]}));
});
test('generated project retains voting, identity privacy, moderation and editable admin vocabulary',async()=>{
 const out=path.join(root(),'project');createWorkbench({people:12,budget:1200,out});
 const {openDatabase,migrate}=await import(pathToFileURL(path.join(out,'src/sqlite.js')));const {seed}=await import(pathToFileURL(path.join(out,'src/seed.js')));const {handleRequest}=await import(pathToFileURL(path.join(out,'src/api.js')));const db=openDatabase();migrate(db);await seed(db);const token=readFileSync(path.join(out,'.env'),'utf8').match(/^ADMIN_TOKEN=(.+)$/m)[1];
 async function call(url,body,cookie='',method=body?'POST':'GET'){const r=await handleRequest(new Request('http://localhost/api'+url,{method,headers:{cookie,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),{DB:db,ADMIN_TOKEN:token});const raw=await r.text();return {status:r.status,data:r.headers.get('content-type')?.includes('json')?JSON.parse(raw):raw,cookie:r.headers.get('set-cookie')?.split(';')[0]};}
 const user=(await call('/register',{code:'007',nickname:'同事甲'})).cookie;assert.equal((await call('/register',{code:'007',nickname:'同事乙'})).status,409);const admin=(await call('/admin/login',{token})).cookie;
 assert.equal((await call('/terms',{level:1,name:'周五晚',attrs:{dayType:'weekday'}},user)).status,403);const added=await call('/terms',{level:1,name:'周五晚',attrs:{dayType:'weekday'}},admin);assert.equal(added.status,200);
 let state=(await call('/state')).data;assert.equal(state.quarter.people,12);assert.equal(state.quarter.budgetCents,120000);assert.equal(state.stats.submissions,0);assert.equal(state.adminRegistrations,undefined);
 const t=state.terms.find(t=>t.id==='play-small-indoor');assert.equal((await call('/admin/terms/'+t.id,{name:'轻松室内',version:t.version},user,'PATCH')).status,403);assert.equal((await call('/admin/terms/'+t.id,{name:'轻松室内',version:t.version},admin,'PATCH')).status,200);assert.equal((await call('/admin/terms/'+t.id,{name:'过时写入',version:t.version},admin,'PATCH')).status,409);
 const project=state.terms.find(t=>t.level===3&&t.parentId==='play-small-indoor');const plan={events:[{timeId:'time-weekend',playIds:['play-small-indoor'],items:[{termId:project.id,quantity:1}]}]};
 const submitted=await call('/submit',{quarterId:state.quarter.id,slot:1,plan,idempotencyKey:'first-plan'},user);assert.equal(submitted.status,200);assert.deepEqual(submitted.data.snapshot.flags,['无估价','无地点']);
 const savedSnapshot=db.raw.prepare('SELECT snapshot FROM submissions').get().snapshot;const time=(await call('/state')).data.terms.find(t=>t.id==='time-weekend');assert.equal((await call('/admin/terms/'+time.id,{name:'休息日',version:time.version},admin,'PATCH')).status,200);assert.equal(db.raw.prepare('SELECT snapshot FROM submissions').get().snapshot,savedSnapshot);assert.equal((await call('/state')).data.stats.submissions,1);
 assert.equal((await call('/submissions/'+submitted.data.id,{quarterId:state.quarter.id,revision:1,plan:{...plan,note:'修改'},idempotencyKey:'edit-plan'},user,'PUT')).status,200);
 const key=(await call('/state')).data.stats.groups[0].key;assert.equal((await call('/comments',{quarterId:state.quarter.id,key,content:'一起出发'},user)).status,200);
 assert.equal((await call('/admin/participants/007',{action:'delete',revision:0,confirmCode:'007'},admin,'PATCH')).status,200);assert.equal((await call('/state')).data.stats.submissions,0);assert.equal((await call('/admin/participants/007',{action:'restore',revision:1},admin,'PATCH')).status,200);assert.equal((await call('/state')).data.stats.submissions,1);await seed(db);assert.equal((await call('/state')).data.terms.find(t=>t.id===time.id).name,'休息日');db.close();
});
