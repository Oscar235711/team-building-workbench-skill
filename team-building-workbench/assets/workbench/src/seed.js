import config from './workbench-config.js';
import {normalizeName} from './domain.js';
export const catalogNames={};
export const initialTerms=config.terms.map(t=>({...t,active:true,version:1}));
export const historical=[];
export const workbench={title:config.title};
export async function seed(db){
 const now=new Date().toISOString(),q=config.quarter;
 const stmts=[db.prepare('INSERT OR IGNORE INTO quarters(id,name,budget_cents,people,open,deadline,created_at) VALUES(?,?,?,?,1,NULL,?)').bind(q.id,q.name,q.budgetCents,q.people,now)];
 for(const t of initialTerms){stmts.push(db.prepare('INSERT OR IGNORE INTO terms(id,level,name,normalized,parent_id,attrs,version,active,identity_key) VALUES(?,?,?,?,?,?,1,1,?)').bind(t.id,t.level,t.name,normalizeName(t.name),t.parentId,JSON.stringify(t.attrs),'seed:'+t.id));stmts.push(db.prepare('INSERT OR IGNORE INTO term_versions(term_id,version,attrs,source,created_at) VALUES(?,1,?,?,?)').bind(t.id,JSON.stringify(t.attrs),'工作台初始化',now));}
 await db.batch(stmts);await db.prepare("INSERT INTO app_meta(key,value) VALUES('baseline_revision','workbench-v1') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run();
}
