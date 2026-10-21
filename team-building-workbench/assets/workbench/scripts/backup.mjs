import {DatabaseSync,backup} from 'node:sqlite';import {existsSync,mkdirSync} from 'node:fs';
if(existsSync('.env'))process.loadEnvFile('.env');mkdirSync('backups',{recursive:true});
const db=new DatabaseSync(process.env.DATABASE_PATH||'data/team.sqlite');const target='backups/team-'+new Date().toISOString().replaceAll(':','-')+'.sqlite';
await backup(db,target);db.close();console.log(target);
