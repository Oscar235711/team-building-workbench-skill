import {DatabaseSync} from 'node:sqlite';
import {readdirSync,readFileSync,mkdirSync} from 'node:fs';
import path from 'node:path';
export function openDatabase(filename=':memory:') {
 if(filename!==':memory:')mkdirSync(path.dirname(filename),{recursive:true});
 const raw=new DatabaseSync(filename);raw.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=10000;');
 const wrap=(sql,args=[])=>({bind(...values){return wrap(sql,values)},async first(){return raw.prepare(sql).get(...args)||null},async all(){return {results:raw.prepare(sql).all(...args)}},async run(){const r=raw.prepare(sql).run(...args);return {meta:{changes:Number(r.changes)}}},_run(){return raw.prepare(sql).run(...args)}});
 return {raw,prepare:sql=>wrap(sql),async batch(stmts){raw.exec('BEGIN IMMEDIATE');try{const r=stmts.map(s=>{const x=s._run();return {meta:{changes:Number(x.changes)}}});raw.exec('COMMIT');return r}catch(e){raw.exec('ROLLBACK');throw e}},close:()=>raw.close()};
}
export function migrate(db,dir=new URL('../drizzle/',import.meta.url)){
 db.raw.exec('CREATE TABLE IF NOT EXISTS local_migrations (name TEXT PRIMARY KEY)');
 for(const file of readdirSync(dir).filter(f=>f.endsWith('.sql')).sort())if(!db.raw.prepare('SELECT name FROM local_migrations WHERE name=?').get(file)){db.raw.exec('BEGIN');try{db.raw.exec(readFileSync(new URL(file,dir),'utf8'));db.raw.prepare('INSERT INTO local_migrations(name) VALUES(?)').run(file);db.raw.exec('COMMIT')}catch(e){db.raw.exec('ROLLBACK');throw e}}
}
