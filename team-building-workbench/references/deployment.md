# 独立存储与部署

平台原生发布入口见 [native-publishing.md](native-publishing.md)。以下为本地、Docker及Sites的执行方式。

## 无依赖本地运行

生成目录中执行 `node scripts/local-server.mjs`，默认127.0.0.1:4173。每个工作台有独立的 `.env`、`src/workbench-config.js`、`data/team.sqlite`。换端口使用PORT环境变量。不要把同部门数据库复制到另一部门。

已有授权的局域网共享可设置HOST=0.0.0.0，并提供实际局域网IP。互联网共享需要可访问的服务器/平台及HTTPS，不是把localhost链接发给同事。

## Docker / 普通服务器

```text
docker build -t team-building-workbench .
docker run -d --name team-workbench -p 127.0.0.1:4173:4173 --env-file .env -e HOST=0.0.0.0 -e DATABASE_PATH=/data/team.sqlite -e PUBLIC_ORIGIN=https://your-workbench.example -v department-team-data:/data team-building-workbench
```

把示例域名换成实际域名，配置HTTPS反向代理。普通服务器也须设置 `PUBLIC_ORIGIN=https://实际域名`，以便来源校验和Secure Cookie使用公开HTTPS地址；服务不信任客户端传入的转发协议头。本地直连无需设置。

一个实例一个持久卷。管理员密钥必须作为服务端环境变量注入。不要通过共享SQLite文件启动多个写入实例。`node scripts/backup.mjs` 创建SQLite一致性备份；容器内使用 `docker exec team-workbench node scripts/backup.mjs` 后将备份安全复制到持久存储。恢复前停止服务并保留原库及WAL/SHM。

## Sites

这一路径需要环境已安装Sites技能和连接，不把它伪装成所有Agent都拥有的能力。

1. 选择生成目录，保持 `.openai/hosting.json` 中 `d1:"DB"`，无旧project_id；按照当前Sites技能注册新站、记录新ID、创建独立D1。绝不复制本仓库历史网站ID。
2. 本模板是Worker ESM。运行 `npm ci`（按锁文件安装esbuild开发依赖）、`npm run build` 产生 `dist/server/index.js`、`dist/.openai/hosting.json`、有序SQL迁移。运行时不依赖Node SQLite，使用D1适配器。
3. 按当前Sites技能的源代码、打包、保存版本和部署流程执行；不要跳过源代码同步与迁移。更新同一个部门工作台才复用其自身ID和数据库。
4. 通过Sites服务端机密接口把本地随机 `ADMIN_TOKEN` 设置到新站，不打印、不写前端；无法安全传递时交给所有者安全配置，不能生成固定通用令牌。
5. 读取部署成功状态与真实URL，再读取首页和 `/api/state`；验证人数/总预算与空登记/空提交。没有成功状态不能宣称上线。

## 修改词库

管理员可从后台给L1/L2新增、改名、停用/启用。改名使用版本号保护，保留既有ID、dayType/baseType与历史快照。改变活动性质应新增词条。新项目仍由创建者填所属玩法；初始种子项目可补齐一次。

账号和预算规则与模板一致：每期两套方案，预算人数首份提交后锁定，修改方案更新当前版本，管理员不能替同事改方案。CSV是统计导出，不能替代全库备份。
