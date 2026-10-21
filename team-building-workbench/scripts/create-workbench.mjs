import {copyFileSync,existsSync,lstatSync,mkdirSync,readdirSync,readFileSync,writeFileSync} from 'node:fs';
import {randomBytes,randomUUID} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const template=fileURLToPath(new URL('../assets/workbench/',import.meta.url));
function copyTemplate(from,to){mkdirSync(to,{recursive:true});for(const entry of readdirSync(from)){const source=path.join(from,entry),dest=path.join(to,entry),info=lstatSync(source);if(info.isSymbolicLink())throw new Error('模板不能包含符号链接');if(info.isDirectory())copyTemplate(source,dest);else if(info.isFile())copyFileSync(source,dest);}}
export function money(value,{optional=false}={}){
 if(value===undefined||value===null||value===''){if(optional)return null;throw new Error('团建总预算必填（人民币元）');}
 const s=String(value);if(!/^\d{1,7}(?:\.\d{1,2})?$/.test(s))throw new Error('金额须为非负元数，最多两位小数');
 const [whole,fraction='']=s.split('.');const cents=Number(whole)*100+Number(fraction.padEnd(2,'0'));if(cents>100000000)throw new Error('金额不得超过100万元');return cents;
}
const plays=[['travel','出游',{baseType:'travel'}],['tea','下午茶',{baseType:'tea'}],['dinner','晚餐',{baseType:'dinner'}],['indoor','大型室内',{baseType:'indoor',indoorScale:'large'}],['small-indoor','小型室内',{baseType:'indoor',indoorScale:'small'}],['other','自由活动',{baseType:'other',allowedDays:['weekday','weekend']}]];
const playNames={'出游':'travel','下午茶':'tea','晚餐':'dinner','大型室内':'indoor','小型室内':'small-indoor','自由活动':'other'};
const defaults=[{name:'公园徒步',play:'travel'},{name:'茶点分享',play:'tea'},{name:'团队聚餐',play:'dinner'},{name:'室内运动场',play:'indoor'},{name:'桌游',play:'small-indoor'},{name:'饮品外卖',play:'small-indoor'},{name:'KTV',play:'small-indoor'}];
function inferPlay(name){if(/KTV|桌游|饮品|咖啡|奶茶/i.test(name))return 'small-indoor';if(/晚餐|聚餐|餐厅|烤肉|火锅/.test(name))return 'dinner';if(/徒步|公园|露营|登山|出游/.test(name))return 'travel';if(/茶点|下午茶/.test(name))return 'tea';if(/滑雪|游乐场|运动场/.test(name))return 'indoor';return 'other';}
export function normalizeOptions(options={}){
 const people=Number(options.people);if(!Number.isInteger(people)||people<1||people>1000)throw new Error('团建人数必填，须为1至1000的整数');
 const budgetCents=money(options.budget);if(budgetCents<1)throw new Error('团建总预算须大于0');
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Shanghai',year:'numeric',month:'numeric'}).formatToParts(new Date()).map(p=>[p.type,p.value]));const current=`${parts.year}-q${Math.ceil(Number(parts.month)/3)}`;
 const quarterId=options.quarter||current;if(!/^\d{4}-q[1-4]$/.test(quarterId))throw new Error('活动期格式为YYYY-q1至YYYY-q4');
 const title=String(options.name||'团建工作台').trim();if(!title||title.length>60)throw new Error('工作台名称须为1至60字');
 const refs=options.references??defaults;if(!Array.isArray(refs)||refs.length>100)throw new Error('参考活动须为最多100项的JSON数组');
 const terms=[{id:'time-weekday',level:1,name:'工作日',parentId:null,attrs:{dayType:'weekday',semantic:'weekday'}},{id:'time-weekend',level:1,name:'周末',parentId:null,attrs:{dayType:'weekend',semantic:'weekend'}},...plays.map(([id,name,attrs])=>({id:'play-'+id,level:2,name,parentId:null,attrs}))];
 const seen=new Set();for(const ref of refs){
  if(!ref||typeof ref!=='object'||Array.isArray(ref))throw new Error('每个参考活动须为对象');
  const name=String(ref.name||'').trim();if(!name||name.length>80)throw new Error('参考项目名称须为1至80字');
  const rawPlay=ref.play||inferPlay(name),play=playNames[rawPlay]||String(rawPlay).replace(/^play-/,'');if(!plays.some(([id])=>id===play))throw new Error('参考活动玩法须使用预置分类');
  const location=String(ref.location||'').trim();if(location&&(!/(市|香港|澳门|澳門)/.test(location)||!/(区|區|县|縣|镇|鎮)/.test(location)||location.length>240))throw new Error('地点须含城市和区，或留空');
  const pricingMode=ref.pricingMode||'per_event';if(!['per_event','per_person'].includes(pricingMode))throw new Error('计价方式须为per_event或per_person');
  const key=[name.normalize('NFKC').toLowerCase().replace(/\s+/g,''),play,location].join(':');if(seen.has(key))throw new Error('参考项目重复：'+name);seen.add(key);
  terms.push({id:'item-'+randomUUID(),level:3,name,parentId:'play-'+play,attrs:{priceCents:money(ref.budget,{optional:true}),pricingMode,location,largeIndoor:play==='indoor'?true:play==='small-indoor'?false:null,note:'',catalogSubmitted:false}});
 }
 return {schemaVersion:1,title,quarter:{id:quarterId,name:quarterId.replace('-q',' Q'),people,budgetCents},terms,history:[]};
}
export function createWorkbench(options){
 const config=normalizeOptions(options);if(!options.out)throw new Error('请提供输出目录--out');const out=path.resolve(options.out);
 if(existsSync(out))throw new Error('输出目录已存在，请使用新目录，避免覆盖工作台');
 if(out===template||out.startsWith(template+path.sep))throw new Error('输出目录不能位于模板内');
 copyTemplate(template,out);
 writeFileSync(path.join(out,'src/workbench-config.js'),'export default '+JSON.stringify(config,null,2)+';\n',{encoding:'utf8'});
 const secret=randomBytes(36).toString('base64url');writeFileSync(path.join(out,'.env'),`ADMIN_TOKEN=${secret}\nDATABASE_PATH=data/team.sqlite\nHOST=127.0.0.1\nPORT=4173\n`,{encoding:'utf8',mode:0o600});
 mkdirSync(path.join(out,'.openai'),{recursive:true});writeFileSync(path.join(out,'.openai/hosting.json'),JSON.stringify({d1:'DB',r2:null})+'\n');
 return {directory:out,people:config.quarter.people,budgetCents:config.quarter.budgetCents,quarter:config.quarter.id,adminSecretFile:path.join(out,'.env'),start:'node scripts/local-server.mjs'};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const args=process.argv.slice(2),opts={};for(let i=0;i<args.length;i+=2){const key=args[i]?.replace(/^--/,'');if(!['people','budget','out','references','name','quarter'].includes(key)||args[i+1]===undefined)throw new Error('用法：node create-workbench.mjs --people 人数 --budget 总预算元 --out 新目录 [--references JSON文件]');opts[key]=args[i+1];}if(opts.references)opts.references=JSON.parse(readFileSync(path.resolve(opts.references),'utf8').replace(/^\uFEFF/,''));console.log(JSON.stringify(createWorkbench(opts),null,2));}catch(e){console.error(e.message);process.exitCode=1;}
}
