import {DatabaseSync,backup} from 'node:sqlite';import {existsSync,mkdirSync,chmodSync} from 'node:fs';
if(existsSync('.env'))process.loadEnvFile('.env');mkdirSync('backups',{recursive:true,mode:0o700});chmodSync('backups',0o700);
const db=new DatabaseSync(process.env.DATABASE_PATH||'data/team.sqlite');const target='backups/team-'+new Date().toISOString().replaceAll(':','-')+'.sqlite';
await backup(db,target);chmodSync(target,0o600);db.close();console.log(target);
