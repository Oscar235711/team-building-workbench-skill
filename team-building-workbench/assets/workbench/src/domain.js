export const normalizeName = value => String(value ?? '').normalize('NFKC').trim().toLowerCase().replace(/\s+/g,'');
export const integer = (v,min=0,max=100000000) => Number.isSafeInteger(v)&&v>=min&&v<=max;
export const validLocation=value=>typeof value==='string'&&value.length<=240&&/(市|香港|澳门|澳門)/.test(value)&&/(区|區|县|縣|镇|鎮)/.test(value);
export function combinationKey(snapshot) {
  return JSON.stringify(snapshot.events.map(e=>({time:[e.time.attrs.dayType,e.time.attrs.semantic||normalizeName(e.time.name)],plays:e.plays.map(p=>p.id).sort(),items:e.items.map(i=>[i.termId,i.quantity]).sort((a,b)=>a[0].localeCompare(b[0]))})).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));
}
export function evaluatePlan(plan,quarter,terms) {
  const issues=[], flags=new Set(), seenItems=new Set(), byId=new Map(terms.map(t=>[t.id,t]));
  const snapshot={title:String(plan?.title||'我的团建方案').trim().slice(0,80),note:String(plan?.note||'').slice(0,1000),quarterId:quarter.id,people:quarter.people,budgetCents:quarter.budgetCents,events:[]};
  if(!Array.isArray(plan?.events)||plan.events.length<1||plan.events.length>12) issues.push('请安排1至12场活动');
  for(const [n,rawEvent] of (Array.isArray(plan?.events)?plan.events:[]).slice(0,12).entries()) {
    const e=rawEvent&&typeof rawEvent==='object'?rawEvent:{};
    const prefix=`第${n+1}场：`, time=byId.get(e.timeId),plays=(Array.isArray(e.playIds)?[...new Set(e.playIds)]:[]).map(id=>byId.get(id));
    if(!time||time.level!==1||!time.active||!['weekday','weekend'].includes(time.attrs.dayType))issues.push(prefix+'请选择完整的时间词');
    if(!plays.length||plays.some(p=>!p||p.level!==2||!p.active))issues.push(prefix+'请选择有效玩法');
    if(plays.length>3)issues.push(prefix+'玩法最多选择3个');
    if(!Array.isArray(e.items)||!e.items.length||e.items.length>30)issues.push(prefix+'请选择1至30个项目');
    const grouped=new Map();
    for(const item of (Array.isArray(e.items)?e.items:[]).slice(0,30)) {
      if(!item||!integer(item.quantity,1,20)){issues.push(prefix+'项目数量无效');continue;}
      if(item.quantity!==1||seenItems.has(item.termId))issues.push(prefix+'每个具体项目在一套方案中只能选择一次，请移除重复项目');
      seenItems.add(item.termId);
      grouped.set(item.termId,(grouped.get(item.termId)||0)+item.quantity);
    }
    const items=[];
    for(const [id,quantity] of grouped) {
      const t=byId.get(id); if(!t||t.level!==3||!t.active){issues.push(prefix+'项目已停用或不存在');continue;}
      const p=byId.get(t.parentId),a=t.attrs||{};
      if(!p||p.level!==2||!p.active||!plays.some(v=>v?.id===p.id))issues.push(prefix+t.name+'所属玩法未选择或已停用');
      if(!integer(quantity,1,20))issues.push(prefix+t.name+'合计次数最多20次');
      if(a.priceCents!=null&&!integer(a.priceCents))issues.push(prefix+t.name+'估价格式无效');
      if(a.priceCents==null)flags.add('无估价');
      if(!a.location)flags.add('无地点');
      else if(!validLocation(a.location))issues.push(prefix+t.name+'地点格式无效（请填写城市和区）');
      const base=p?.attrs?.baseType;
      if(!['travel','tea','dinner','indoor','other'].includes(base))issues.push(prefix+t.name+'活动类型待补充');
      if(base==='indoor'&&typeof a.largeIndoor!=='boolean')issues.push(prefix+t.name+'待确认是否大型室内项目');
      if(base==='indoor'&&p?.attrs?.indoorScale==='small'&&a.largeIndoor!==false)issues.push(prefix+t.name+'小型室内分类与项目属性冲突');
      if(base==='other'&&(!Array.isArray(p.attrs.allowedDays)||!p.attrs.allowedDays.length||!p.attrs.allowedDays.includes(time?.attrs?.dayType)))issues.push(prefix+t.name+'不适用于所选时段');
      if(time?.attrs?.dayType==='weekday'&&(base==='travel'||(base==='indoor'&&a.largeIndoor===true)))issues.push(prefix+'工作日禁止出游和大型室内项目');
      if(a.pricingMode!==undefined&&!['per_person','per_event'].includes(a.pricingMode))issues.push(prefix+t.name+'计价方式待确认');
      items.push({termId:t.id,name:t.name,parentId:t.parentId,version:t.version,location:a.location||'',priceCents:a.priceCents??null,pricingMode:a.pricingMode||'per_person',quantity,attrs:structuredClone(a)});
    }
    for(const p of plays.filter(Boolean))if(!items.some(i=>i.parentId===p.id))issues.push(prefix+p.name+'请至少选择一个对应项目');
    for(const i of items)if(i.attrs.pricingBasis==='bundle'&&i.attrs.historyId&&items.some(other=>other.termId!==i.termId&&other.attrs.historyId===i.attrs.historyId))issues.push(prefix+'历史整套价格与内部项目请只选一种计价方式');
    const timeSnap=time?{id:time.id,name:time.name,attrs:structuredClone(time.attrs)}:{id:'',name:'待选时间',attrs:{}};
    const totalCents=items.every(i=>integer(i.priceCents))?items.reduce((s,i)=>s+i.priceCents*i.quantity*(i.pricingMode==='per_event'?1:quarter.people),0):null;
    if(totalCents!==null&&!integer(totalCents,0,10000000000))issues.push(prefix+'费用超出可用范围');
    snapshot.events.push({id:String(e.id||n),time:timeSnap,plays:plays.filter(Boolean).map(p=>({id:p.id,name:p.name,attrs:structuredClone(p.attrs)})),items,sharedCents:0,totalCents});
  }
  const totalCents=snapshot.events.length&&snapshot.events.every(e=>e.totalCents!==null)?snapshot.events.reduce((s,e)=>s+e.totalCents,0):null;
  const balanceCents=totalCents===null?null:quarter.budgetCents-totalCents;
  const status=issues.length?'incomplete':totalCents===null?'unestimated':balanceCents<0?'over':'within';
  const labels=['无估价','无地点'].filter(label=>flags.has(label));
  Object.assign(snapshot,{totalCents,balanceCents,status,flags:labels});
  return {snapshot,issues,totalCents,balanceCents,status,flags:labels};
}
export function planFromSnapshot(s) { return {title:s.title,note:s.note,events:s.events.map(e=>({id:crypto.randomUUID(),timeId:e.time.id,playIds:e.plays.map(p=>p.id),items:e.items.map(i=>({termId:i.termId,quantity:i.quantity})),sharedCents:e.sharedCents}))}; }
