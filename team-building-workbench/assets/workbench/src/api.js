import {evaluatePlan,combinationKey,normalizeName,integer,planFromSnapshot,validLocation} from './domain.js';
import {seed,catalogNames,workbench} from './seed.js';
const j=JSON.stringify;
const json=(data,status=200,headers={})=>new Response(j(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
const fail=(status,error,details)=>{throw Object.assign(new Error(error),{status,details})};
const all=async(db,sql,...args)=>(await db.prepare(sql).bind(...args).all()).results;
const first=(db,sql,...args)=>db.prepare(sql).bind(...args).first();
const run=(db,sql,...args)=>db.prepare(sql).bind(...args).run();
const quarter=r=>r?{id:r.id,name:r.name,budgetCents:r.budget_cents,people:r.people,open:!!r.open,deadline:r.deadline}:null;
const term=r=>{const attrs=JSON.parse(r.attrs);return {id:r.id,level:r.level,name:catalogNames[r.id]||r.name,parentId:r.parent_id,version:r.version,active:!!r.active,attrs,canComplete:r.level===3&&!!r.active&&r.identity_key?.startsWith('seed:')&&!attrs.catalogSubmitted&&(attrs.priceCents==null||!attrs.location)};};
const hash=async s=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))).map(n=>n.toString(16).padStart(2,'0')).join('');
const now=()=>new Date().toISOString();
const cookieName='inspiration_session';
const cookie=(token,request,remove=false)=>`${cookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${remove?0:60*60*24*30}${new URL(request.url).protocol==='https:'?'; Secure':''}`;
async function session(request,db){const value=(request.headers.get('cookie')||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(cookieName+'='))?.slice(cookieName.length+1);return value?first(db,"SELECT s.*,p.code,p.nickname FROM sessions s LEFT JOIN participants p ON p.id=s.participant_id WHERE hash=? AND expires_at>? AND (s.participant_id IS NULL OR p.status='active')",await hash(value),Date.now()):null;}
async function createSession(db,pid,admin,request){const token=crypto.randomUUID()+crypto.randomUUID();await run(db,'INSERT INTO sessions(hash,participant_id,admin,expires_at) VALUES(?,?,?,?)',await hash(token),pid,admin?1:0,Date.now()+30*86400000);return json({ok:true},200,{'Set-Cookie':cookie(token,request)});}
function requireParticipant(s){if(!s?.participant_id)fail(401,'请先填写本人三位工号与昵称');}
function requireContributor(s){if(!s?.participant_id&&!s?.admin)fail(401,'请先填写本人三位工号与昵称');}
function requireAdmin(s){if(!s?.admin)fail(403,'需要独立管理员权限');}
async function getQuarter(db,id){const row=id?await first(db,'SELECT * FROM quarters WHERE id=?',id):await first(db,'SELECT * FROM quarters ORDER BY created_at DESC,id DESC LIMIT 1');if(!row)fail(404,'活动期不存在');return quarter(row);}
function ensureOpen(q){if(!q.open||(q.deadline&&Date.parse(q.deadline)<=Date.now()))fail(409,'本活动期已停止接收方案');}
const getTerms=async db=>(await all(db,'SELECT * FROM terms ORDER BY level,name')).map(term);
const effectiveSql="SELECT x.id,x.quarter_id,x.participant_id,x.slot,h.combo_key,x.idempotency_key,v.snapshot,v.created_at,h.revision,p.nickname,p.code FROM submissions x JOIN submission_heads h ON h.submission_id=x.id JOIN submission_versions v ON v.submission_id=x.id AND v.revision=h.revision JOIN participants p ON p.id=x.participant_id AND p.status<>'deleted'";
async function backfillHeads(db){if(await first(db,'SELECT x.id FROM submissions x LEFT JOIN submission_heads h ON h.submission_id=x.id WHERE h.submission_id IS NULL LIMIT 1'))await db.batch([db.prepare('INSERT OR IGNORE INTO submission_versions(submission_id,revision,combo_key,snapshot,idempotency_key,created_at) SELECT id,1,combo_key,snapshot,idempotency_key,created_at FROM submissions'),db.prepare('INSERT OR IGNORE INTO submission_heads(submission_id,quarter_id,participant_id,slot,revision,combo_key) SELECT id,quarter_id,participant_id,slot,1,combo_key FROM submissions')]);}
export function computeStats(rows,terms,q){
 const levels={1:[],2:[],3:[]},support=new Map(),people=new Set(),groups=new Map();
 for(const r of rows){people.add(r.participant_id);const s=JSON.parse(r.snapshot),seen=new Set();for(const e of s.events){seen.add(e.time.id);for(const p of e.plays)seen.add(p.id);for(const i of e.items)seen.add(i.termId);}for(const id of seen){if(!support.has(id))support.set(id,new Set());support.get(id).add(r.participant_id);}
  let g=groups.get(r.combo_key);if(!g){g={key:r.combo_key,support:new Set(),nicknames:new Set(),snapshot:s,minCents:s.totalCents,maxCents:s.totalCents};groups.set(r.combo_key,g);}g.support.add(r.participant_id);g.nicknames.add(r.nickname);g.minCents=g.minCents==null||s.totalCents==null?null:Math.min(g.minCents,s.totalCents);g.maxCents=g.maxCents==null||s.totalCents==null?null:Math.max(g.maxCents,s.totalCents);
 }
 const labels=new Map();for(const r of rows){const s=JSON.parse(r.snapshot);for(const e of s.events){labels.set(e.time.id,{id:e.time.id,name:e.time.name,level:1});e.plays.forEach(p=>labels.set(p.id,{id:p.id,name:p.name,level:2}));e.items.forEach(i=>labels.set(i.termId,{id:i.termId,name:i.name,level:3,parentId:i.parentId}));}}
 for(const t of terms)if(t.active||support.has(t.id))labels.set(t.id,t);
 for(const t of labels.values())levels[t.level].push({id:t.id,name:t.name,parentId:t.parentId,count:support.get(t.id)?.size||0});
 for(const list of Object.values(levels))list.sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name,'zh-CN'));
 const sorted=[...groups.values()].sort((a,b)=>b.support.size-a.support.size||(a.minCents??Infinity)-(b.minCents??Infinity));
 const output=sorted.map(g=>({key:g.key,title:([...g.nicknames].join('、')||'未命名用户')+'的团建方案',supporters:g.support.size,rank:1+sorted.filter(v=>v.support.size>g.support.size).length,tied:sorted.filter(v=>v.support.size===g.support.size).length>1,nicknames:[...g.nicknames],snapshot:g.snapshot,minCents:g.minCents,maxCents:g.maxCents,currentEstimate:evaluatePlan(planFromSnapshot(g.snapshot),q,terms)}));
 return {participants:people.size,submissions:rows.length,levels,groups:output};
}
function validateAttrs(level,a,parent){
 if(!a||typeof a!=='object'||Array.isArray(a))fail(400,'请完善词条属性');
 if(level===1){if(!['weekday','weekend'].includes(a.dayType))fail(400,'时间必须选择工作日或周末');return {dayType:a.dayType};}
 if(level===2){if(!['travel','tea','dinner','indoor','other'].includes(a.baseType))fail(400,'请选择基础活动类型');if(a.baseType==='other'&&(!Array.isArray(a.allowedDays)||!a.allowedDays.length||a.allowedDays.some(v=>!['weekday','weekend'].includes(v))))fail(400,'其他玩法须明确适用时段');return {baseType:a.baseType,...(a.baseType==='indoor'&&['small','large'].includes(a.indoorScale)?{indoorScale:a.indoorScale}:{}),...(a.baseType==='other'?{allowedDays:[...new Set(a.allowedDays)]}:{})};}
 if(a.priceCents!=null&&!integer(a.priceCents))fail(400,'估价请填写有效金额，或留空');
 if(a.location&&!validLocation(a.location))fail(400,'地点请包含城市和区，例如深圳市福田区；也可留空');
 if(parent?.attrs.baseType==='indoor'&&parent.attrs.indoorScale==='small'){if(a.largeIndoor===true)fail(400,'小型室内玩法不能收录大型项目');a={...a,largeIndoor:false};}
 if(parent?.attrs.baseType==='indoor'&&typeof a.largeIndoor!=='boolean')fail(400,'请确认是否大型室内项目');
 if(a.pricingMode!==undefined&&!['per_person','per_event'].includes(a.pricingMode))fail(400,'请选择按人均或按次计价');
 return {priceCents:a.priceCents??null,pricingMode:a.pricingMode||'per_person',location:String(a.location||'').trim(),largeIndoor:parent?.attrs.baseType==='indoor'?a.largeIndoor:null,note:String(a.note||'').slice(0,1000),...(a.historyId?{historyId:String(a.historyId).slice(0,100),pricingBasis:a.pricingBasis==='bundle'?'bundle':'component'}:{})};
}
export async function handleRequest(request,env){
 const db=env.DB;
 try{
  if(!db)fail(503,'共享数据库尚未配置');
  const u=new URL(request.url),path=u.pathname.replace(/^\/api/,'')||'/',method=request.method;
  if(!['GET','HEAD'].includes(method)){
   const origin=request.headers.get('origin');if(origin&&origin!==u.origin)fail(403,'请从本站页面操作');if(request.headers.get('sec-fetch-site')==='cross-site')fail(403,'禁止跨站写入');
   if(!request.headers.get('content-type')?.startsWith('application/json'))fail(415,'请求须使用JSON');
  }
  // Schema is migration-owned. Idempotent seed never overwrites user records.
  if(!await first(db,'SELECT id FROM quarters LIMIT 1')||(await first(db,"SELECT value FROM app_meta WHERE key='baseline_revision'"))?.value!=='workbench-v1')await seed(db);
  await backfillHeads(db);
  const s=await session(request,db);
  let b={};if(!['GET','HEAD'].includes(method)){const raw=await request.text();if(raw.length>150000)fail(413,'方案内容过大');try{b=JSON.parse(raw)}catch{fail(400,'请求内容无法读取')}if(!b||typeof b!=='object'||Array.isArray(b))fail(400,'请求格式不正确');}
  if(path==='/register'&&method==='POST'){
   if(typeof b.code!=='string'||!/^\d{3}$/.test(b.code))fail(400,'工号须为三位数字，如007；不自动补零');const nick=String(b.nickname||'').trim();if(!nick||nick.length>40)fail(400,'昵称须为1至40个字符');
   // A duplicate code is a login attempt, never a profile update. The unique
   // code constraint selects one winner even when first registrations race.
   await run(db,'INSERT INTO participants(id,code,nickname) VALUES(?,?,?) ON CONFLICT(code) DO NOTHING',crypto.randomUUID(),b.code,nick);
   const p=await first(db,'SELECT id,nickname,status FROM participants WHERE code=?',b.code);
   if(p.status!=='active')fail(403,p.status==='banned'?'该工号已被封禁，请联系网站管理员':'该账号已删除，请联系管理员恢复');
   if(p.nickname!==nick)fail(409,'该工号已登记，无法重复注册。请使用原登记昵称登录；忘记昵称请联系管理员。');
   return createSession(db,p.id,false,request);
  }
  if((path==='/logout'||path==='/admin/logout')&&method==='POST'){if(s)await run(db,'DELETE FROM sessions WHERE hash=?',s.hash);return json({ok:true},200,{'Set-Cookie':cookie('',request,true)});}
  if(path==='/admin/login'&&method==='POST'){
   if(!env.ADMIN_TOKEN)fail(503,'管理员凭据尚未配置');if(typeof b.token!=='string'||await hash(b.token)!==await hash(env.ADMIN_TOKEN))fail(403,'管理员凭据不正确');return createSession(db,s?.participant_id||null,true,request);
  }
  if(path==='/state'&&method==='GET'){
   const q=await getQuarter(db,u.searchParams.get('quarter'));const terms=await getTerms(db);const rows=await all(db,effectiveSql+' WHERE x.quarter_id=? ORDER BY x.created_at',q.id);
   let me=null;if(s?.participant_id){const drafts=await all(db,'SELECT * FROM drafts WHERE quarter_id=? AND participant_id=?',q.id,s.participant_id);const mine=rows.filter(r=>r.participant_id===s.participant_id);me={code:s.code,nickname:s.nickname,remaining:2-mine.length,drafts:drafts.map(r=>({id:`${q.id}:${r.slot}`,slot:r.slot,plan:JSON.parse(r.plan),revision:r.revision,updatedAt:r.updated_at})),submissions:mine.map(r=>({id:r.id,slot:r.slot,revision:r.revision,snapshot:JSON.parse(r.snapshot),createdAt:r.created_at}))};}
   const history=(await all(db,'SELECT data FROM history')).map(r=>{const h=JSON.parse(r.data);if(!s?.admin){delete h.source;delete h.sourceKind;h.parts=h.parts.map(({source,...part})=>part);}return h;});
   let adminRegistrations;
   if(s?.admin){
    const registrations=await all(db,'SELECT p.code,p.nickname,p.status,p.status_revision,p.previous_status,COUNT(h.submission_id) AS submittedCount FROM participants p LEFT JOIN submission_heads h ON h.participant_id=p.id AND h.quarter_id=? GROUP BY p.id,p.code,p.nickname,p.status,p.status_revision,p.previous_status ORDER BY p.code',q.id);
    const accounts=registrations.map(r=>({code:r.code,nickname:r.nickname,submittedCount:Number(r.submittedCount),status:r.status,revision:r.status_revision,...(r.status==='deleted'?{restoreStatus:r.previous_status||'active'}:{})})),roster=accounts.filter(r=>r.status!=='deleted');
    adminRegistrations={totalRegistered:roster.length,submittedPeople:roster.filter(r=>r.submittedCount>0).length,submittedPlans:roster.reduce((n,r)=>n+r.submittedCount,0),rows:roster,deletedRows:accounts.filter(r=>r.status==='deleted')};
   }
   return json({workbench,quarter:q,quarters:(await all(db,'SELECT * FROM quarters ORDER BY created_at DESC')).map(quarter),terms,history,stats:computeStats(rows,terms,q),me,isAdmin:!!s?.admin,...(adminRegistrations?{adminRegistrations}:{})});
  }
  if(path==='/comments'&&method==='GET'){
   const q=await getQuarter(db,u.searchParams.get('quarter')),key=u.searchParams.get('key')||'';if(key.length>40000)fail(400,'方案标识过长');
   const comments=await all(db,"SELECT c.id,p.nickname,c.content,c.created_at AS createdAt FROM comments c JOIN participants p ON p.id=c.participant_id AND p.status<>'deleted' WHERE c.quarter_id=? AND c.combo_key=? ORDER BY c.created_at DESC LIMIT 100",q.id,key);return json({comments:comments.reverse()});
  }
  if(path==='/comments'&&method==='POST'){
   requireParticipant(s);const q=await getQuarter(db,b.quarterId),key=typeof b.key==='string'?b.key:'',content=String(b.content||'').trim();if(!content||content.length>1000||key.length>40000)fail(400,'留言须为1至1000个字符');
   if(!await first(db,"SELECT h.submission_id FROM submission_heads h JOIN participants p ON p.id=h.participant_id AND p.status<>'deleted' WHERE h.quarter_id=? AND h.combo_key=? LIMIT 1",q.id,key))fail(404,'收录方案不存在');
   const recent=await first(db,"SELECT COUNT(*) AS n FROM comments WHERE participant_id=? AND created_at>?",s.participant_id,new Date(Date.now()-60000).toISOString());if(recent.n>=5)fail(429,'留言较频繁，请稍后再试');
   const id=crypto.randomUUID();await run(db,'INSERT INTO comments(id,quarter_id,combo_key,participant_id,content,created_at) VALUES(?,?,?,?,?,?)',id,q.id,key,s.participant_id,content,now());return json({id});
  }
  if(path==='/preview'&&method==='POST'){const q=await getQuarter(db,b.quarterId);return json(evaluatePlan(b.plan,q,await getTerms(db)));}
  if(/^\/drafts\/[12]$/.test(path)&&method==='PUT'){
   requireParticipant(s);const slot=Number(path.at(-1)),q=await getQuarter(db,b.quarterId);ensureOpen(q);if(!b.plan||!Array.isArray(b.plan.events)||b.plan.events.length>12||!integer(b.revision))fail(400,'草稿格式不正确');
   const t=now();const r=await run(db,'INSERT INTO drafts(quarter_id,participant_id,slot,plan,revision,updated_at) SELECT ?,?,?,?,1,? WHERE ?=0 ON CONFLICT(quarter_id,participant_id,slot) DO UPDATE SET plan=excluded.plan,revision=drafts.revision+1,updated_at=excluded.updated_at WHERE drafts.revision=?',q.id,s.participant_id,slot,j(b.plan),t,b.revision,b.revision);
   // For existing revisions the INSERT SELECT is empty; use an explicit guarded UPDATE.
   let changes=r.meta?.changes||0;if(b.revision>0){const x=await run(db,'UPDATE drafts SET plan=?,revision=revision+1,updated_at=? WHERE quarter_id=? AND participant_id=? AND slot=? AND revision=?',j(b.plan),t,q.id,s.participant_id,slot,b.revision);changes=x.meta?.changes||0;}
   if(!changes)fail(409,'草稿已在其他页面更新，请重新加载后继续');return json({id:`${q.id}:${slot}`,revision:b.revision+1,updatedAt:t});
  }
  if(path==='/submit'&&method==='POST'){
   requireParticipant(s);if(![1,2].includes(b.slot)||typeof b.idempotencyKey!=='string'||b.idempotencyKey.length<4||b.idempotencyKey.length>100)fail(400,'提交槽位或重试标识不正确');const q=await getQuarter(db,b.quarterId);
   const previous=await first(db,'SELECT * FROM submissions WHERE quarter_id=? AND participant_id=? AND idempotency_key=?',q.id,s.participant_id,b.idempotencyKey);if(previous)return json({id:previous.id,snapshot:JSON.parse(previous.snapshot)});
   ensureOpen(q);const e=evaluatePlan(b.plan,q,await getTerms(db));if(e.issues.length)fail(422,'方案还不能提交',e.issues);const id=crypto.randomUUID();
   try{await run(db,'INSERT INTO submissions(id,quarter_id,participant_id,slot,combo_key,idempotency_key,snapshot,created_at) VALUES(?,?,?,?,?,?,?,?)',id,q.id,s.participant_id,b.slot,combinationKey(e.snapshot),b.idempotencyKey,j(e.snapshot),now());}
   catch(err){const retry=await first(db,'SELECT * FROM submissions WHERE quarter_id=? AND participant_id=? AND idempotency_key=?',q.id,s.participant_id,b.idempotencyKey);if(retry)return json({id:retry.id,snapshot:JSON.parse(retry.snapshot)});fail(409,'本方案已提交、组合重复、额度已满，或资料刚被更新；请刷新后检查');}
   return json({id,revision:1,snapshot:e.snapshot});
  }
  if(/^\/submissions\/[^/]+$/.test(path)&&method==='PUT'){
   requireParticipant(s);const id=decodeURIComponent(path.split('/')[2]);if(!integer(b.revision,1)||typeof b.idempotencyKey!=='string'||b.idempotencyKey.length<4||b.idempotencyKey.length>100)fail(400,'请提供当前版本与重试标识');
   const current=await first(db,effectiveSql+' WHERE x.id=? AND x.participant_id=?',id,s.participant_id);if(!current)fail(404,'本人方案不存在');
   if(b.quarterId&&b.quarterId!==current.quarter_id)fail(400,'活动期不匹配');
   const retried=await first(db,'SELECT * FROM submission_versions WHERE submission_id=? AND idempotency_key=?',id,b.idempotencyKey);if(retried)return json({id,revision:retried.revision,snapshot:JSON.parse(retried.snapshot)});
   if(current.revision!==b.revision)fail(409,'方案已在其他页面修改，请重新加载后编辑');const q=await getQuarter(db,current.quarter_id);ensureOpen(q);
   const e=evaluatePlan(b.plan,q,await getTerms(db));if(e.issues.length)fail(422,'修改后的方案还不能保存',e.issues);const key=combinationKey(e.snapshot),revision=b.revision+1;
   try{await db.batch([db.prepare('INSERT INTO submission_versions(submission_id,revision,combo_key,snapshot,idempotency_key,created_at) VALUES(?,?,?,?,?,?)').bind(id,revision,key,j(e.snapshot),b.idempotencyKey,now()),db.prepare('UPDATE submission_heads SET revision=?,combo_key=? WHERE submission_id=? AND revision=?').bind(revision,key,id,b.revision)]);}
   catch(err){const retry=await first(db,'SELECT * FROM submission_versions WHERE submission_id=? AND idempotency_key=?',id,b.idempotencyKey);if(retry)return json({id,revision:retry.revision,snapshot:JSON.parse(retry.snapshot)});fail(409,'方案版本已变化、与另一套安排重复，或活动期已关闭；请刷新检查');}
   return json({id,revision,snapshot:e.snapshot});
  }
  if(path==='/terms'&&method==='POST'){
   requireContributor(s);const level=b.level,name=String(b.name||'').trim();if(level===1&&!s.admin)fail(403,'时间词条仅管理员可维护，请选择已有时间');if(![1,2,3].includes(level)||!name||name.length>80)fail(400,'请填写有效词条名称');const normalized=normalizeName(name);let parent=null;if(level===3){const row=await first(db,'SELECT * FROM terms WHERE id=? AND level=2 AND active=1',b.parentId||'');if(!row)fail(400,'请选择所属玩法');parent=term(row);}
   const attrs=validateAttrs(level,b.attrs,parent);if(level===1)attrs.semantic=normalizeName(name);const parentId=parent?.id||null;const identity=`${level}:${parentId||''}:${normalized}:${level===3?normalizeName(attrs.location):''}`;
   const matches=await all(db,'SELECT * FROM terms WHERE level=? AND normalized=? AND (parent_id IS ?)',level,normalized,parentId);const duplicate=matches.find(r=>level!==3||!JSON.parse(r.attrs).location||normalizeName(JSON.parse(r.attrs).location)===normalizeName(attrs.location));if(duplicate)fail(409,'已有同名候选，请补齐已有词条或使用明确门店/套餐名称',[term(duplicate)]);
   const id=crypto.randomUUID();await db.batch([db.prepare('INSERT INTO terms(id,level,name,normalized,parent_id,attrs,version,active,identity_key) VALUES(?,?,?,?,?,?,1,1,?)').bind(id,level,name,normalized,parentId,j(attrs),identity),db.prepare('INSERT INTO term_versions(term_id,version,attrs,source,created_at) VALUES(?,1,?,?,?)').bind(id,j(attrs),`同事补充：${s.nickname}`,now())]);return json({id});
  }
  if(/^\/terms\/[^/]+$/.test(path)&&method==='PATCH'){
   requireContributor(s);const id=decodeURIComponent(path.split('/')[2]),r=await first(db,'SELECT * FROM terms WHERE id=?',id);if(!r)fail(404,'词条不存在');if(r.version!==b.version)fail(409,'词条已更新，请刷新');const old=term(r),parent=old.parentId?term(await first(db,'SELECT * FROM terms WHERE id=?',old.parentId)):null;
   if(old.level!==3)fail(400,'时间或玩法属性变化请建立新词条');const attrs={...old.attrs,...validateAttrs(3,b.attrs,parent)};
   if(!old.canComplete)fail(409,'词库词条提交后不可修改，请新建项目；初始待补候选只可补齐一次');
   if((old.attrs.location&&normalizeName(old.attrs.location)!==normalizeName(attrs.location))||(parent?.attrs.baseType==='indoor'&&typeof old.attrs.largeIndoor==='boolean'&&attrs.largeIndoor!==old.attrs.largeIndoor))fail(409,'已填写的地点或室内性质发生变化，请建立新项目');
   attrs.catalogSubmitted=true;
   await db.batch([db.prepare('UPDATE terms SET attrs=?,version=version+1 WHERE id=? AND version=?').bind(j(attrs),id,b.version),db.prepare('INSERT INTO term_versions(term_id,version,attrs,source,created_at) SELECT id,version,attrs,?,? FROM terms WHERE id=? AND version=?').bind(`同事估价：${s.nickname}`,now(),id,b.version+1)]);return json({id,version:b.version+1});
  }
  if(path.startsWith('/admin/')){
   requireAdmin(s);
   if(/^\/admin\/participants\/\d{3}$/.test(path)&&method==='PATCH'){
    const code=path.split('/').at(-1),account=await first(db,'SELECT * FROM participants WHERE code=?',code);if(!account)fail(404,'登记账号不存在');
    if(!['ban','unban','delete','restore'].includes(b.action)||!integer(b.revision))fail(400,'请提供有效操作与账号版本');
    if(account.status_revision!==b.revision)fail(409,'账号状态已更新，请刷新名单后重试');
    if(s.participant_id===account.id&&['ban','delete'].includes(b.action))fail(409,'不能停用当前登录的工号；请使用独立管理员登录后操作');
    if(b.action==='delete'&&b.confirmCode!==code)fail(400,'删除前请准确输入该账号的三位工号');
    const allowed={ban:['active'],unban:['banned'],delete:['active','banned'],restore:['deleted']};if(!allowed[b.action].includes(account.status))fail(409,'当前状态不允许此操作，请刷新名单');
    const next=b.action==='ban'?'banned':b.action==='delete'?'deleted':b.action==='restore'?(account.previous_status||'active'):'active';
    const result=await run(db,'UPDATE participants SET status=?,status_revision=status_revision+1,previous_status=? WHERE id=? AND status_revision=?',next,b.action==='delete'?account.status:null,account.id,b.revision);
    if(!result.meta?.changes)fail(409,'账号状态已更新，请刷新名单后重试');return json({ok:true,status:next,revision:b.revision+1});
   }
   if(path==='/admin/quarters'&&method==='POST'){
    const name=String(b.name||'').trim();if(!name||name.length>60||!integer(b.budgetCents,1)||!integer(b.people,1,1000))fail(400,'请填写活动期、预算与人数');if(b.deadline&&(!/(Z|[+-]\d{2}:\d{2})$/.test(b.deadline)||!Number.isFinite(Date.parse(b.deadline))))fail(400,'截止时间须包含时区');const id=crypto.randomUUID();await run(db,'INSERT INTO quarters(id,name,budget_cents,people,open,deadline,created_at) VALUES(?,?,?,?,1,?,?)',id,name,b.budgetCents,b.people,b.deadline||null,now());return json({id});
   }
   if(/^\/admin\/quarters\/[^/]+$/.test(path)&&method==='PATCH'){
    const id=decodeURIComponent(path.split('/')[3]),q=await getQuarter(db,id);if(b.open!==undefined&&typeof b.open!=='boolean')fail(400,'开关格式错误');if(b.budgetCents!==undefined&&!integer(b.budgetCents,1))fail(400,'预算格式错误');if(b.people!==undefined&&!integer(b.people,1,1000))fail(400,'人数格式错误');if(b.deadline&&(!/(Z|[+-]\d{2}:\d{2})$/.test(b.deadline)||!Number.isFinite(Date.parse(b.deadline))))fail(400,'截止时间须包含时区');
    try{await run(db,'UPDATE quarters SET budget_cents=?,people=?,open=?,deadline=? WHERE id=?',b.budgetCents??q.budgetCents,b.people??q.people,(b.open??q.open)?1:0,b.deadline===undefined?q.deadline:b.deadline||null,id)}catch{fail(409,'首份提交后预算、人数与截止配置锁定，请新建活动期')}return json({ok:true});
   }
   if(/^\/admin\/terms\/[^/]+$/.test(path)&&method==='PATCH'){
    const id=decodeURIComponent(path.split('/')[3]),r=await first(db,'SELECT * FROM terms WHERE id=?',id);if(!r)fail(404,'词条不存在');
    if(b.name!==undefined){
     const name=String(b.name).trim();if(![1,2].includes(r.level)||!name||name.length>80)fail(400,'仅可修改时间和玩法名称，名称须为1至80字');
     if(!integer(b.version,1)||r.version!==b.version)fail(409,'词条已更新，请刷新后修改');const normalized=normalizeName(name);
     if(await first(db,'SELECT id FROM terms WHERE level=? AND normalized=? AND id<>?',r.level,normalized,id))fail(409,'已有同名词条');
     const result=await db.batch([db.prepare('INSERT INTO term_versions(term_id,version,attrs,source,created_at) SELECT id,version+1,attrs,?,? FROM terms WHERE id=? AND version=?').bind('管理员修改显示名称',now(),id,b.version),db.prepare('UPDATE terms SET name=?,normalized=?,version=version+1 WHERE id=? AND version=?').bind(name,normalized,id,b.version)]);
     if(!result[1].meta?.changes)fail(409,'词条已更新，请刷新后修改');return json({ok:true,version:b.version+1});
    }
    if(typeof b.active!=='boolean')fail(400,'请选择词条状态');await run(db,'UPDATE terms SET active=? WHERE id=?',b.active?1:0,id);return json({ok:true});
   }
   if(path==='/admin/export'&&method==='GET'){
    const q=await getQuarter(db,u.searchParams.get('quarter'));const rows=await all(db,effectiveSql+' WHERE x.quarter_id=?',q.id);let values;const type=u.searchParams.get('type');
    if(type==='stats'){const stats=computeStats(rows,await getTerms(db),q);values=[['层级','词条','支持人数'],...Object.entries(stats.levels).flatMap(([l,list])=>list.map(t=>[l,t.name,t.count]))];}
    else if(type==='budget'){values=[['方案ID','昵称','场次','项目','人数','项目单价分','计价方式','次数','场次总额分','整套总额分','预算分'],...rows.flatMap(r=>{const s=JSON.parse(r.snapshot);return s.events.flatMap((e,n)=>e.items.map((i,k)=>[r.id,r.nickname,n+1,i.name,s.people,i.priceCents,i.pricingMode||i.attrs?.pricingMode||'per_person',i.quantity,k===0?e.totalCents:'',n===0&&k===0?s.totalCents:'',q.budgetCents]));})];}
    else values=[['方案ID','工号','昵称','槽位','提交时间','整套预计分','预算余额分','组合键','快照'],...rows.map(r=>{const s=JSON.parse(r.snapshot);return [r.id,r.code,r.nickname,r.slot,r.created_at,s.totalCents,s.balanceCents,r.combo_key,r.snapshot]})];
    const cell=v=>{let s=String(v??'');if(/^[=+\-@\t\r]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"'};return new Response('\uFEFF'+values.map(r=>r.map(cell).join(',')).join('\r\n'),{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="team-${type||'submissions'}.csv"`,'Cache-Control':'no-store'}});
   }
  }
  fail(404,'接口不存在');
 }catch(err){if(!err.status)console.error('API failure:',err.message);return json({error:err.status?err.message:'操作未完成，请稍后重试',...(err.details?{details:err.details}:{})},err.status||500);}
}
