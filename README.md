# 团建工作台 Skill

让外部 Agent 根据**团建人数、团建总预算**，创建独立的部门团建工作台。参考活动项目及费用可选，时间和玩法词库自动预置，管理员创建后可维护。

## 安装到 Agent

支持开放 `SKILL.md` 格式的 Agent 可安装本仓库的 `team-building-workbench/` 目录。Codex 示例：

```text
使用 skill-installer，从 GitHub 仓库 Oscar235711/team-building-workbench-skill 安装 team-building-workbench 目录。
```

或克隆仓库，把该目录放入 Agent 的技能目录（如 `~/.codex/skills/team-building-workbench/` 或 `~/.agents/skills/team-building-workbench/`）。安装后按Agent要求刷新技能或开始新对话。

调用示例：

```text
使用 $team-building-workbench 创建团建工作台，人数20人，总预算6000元。
参考活动可选：聚餐2500元/场、饮品25元/人、KTV600元/场。
```

只给人数和总预算也能生成。Agent不要求用户填写时间/玩法词库、管理员令牌或部署配置。可选项目的未知价格/地点保持待补充。

## 直接生成与运行

需要Node.js 24+，本地运行无需安装npm依赖：

```text
node team-building-workbench/scripts/create-workbench.mjs --people 20 --budget 6000 --out ./my-department-workbench
cd my-department-workbench
node scripts/local-server.mjs
```

默认访问 `http://127.0.0.1:4173`。随机管理员令牌位于生成目录的 `.env`，不要提交或分享给普通参与者。所有账号、会话、方案、评论保存在该实例的服务器数据库中。不同部门请生成不同目录及独立数据库/存储卷。

本地运行不代表互联网部署。模板支持Docker持久卷和Worker/D1；Sites部署需Agent已有对应工具和授权。详见Skill内的部署说明。缺少托管能力时Agent交付本地实例，并明确尚无公网网址。

## 功能

- 预置时间与6种玩法；管理员可新增、改名、启停时间和玩法。
- 时间单选、玩法每场最多3个；项目彩色分类、按玩法筛选、整卡拖放。
- 每人每期两套方案，提交后可修改，统计取当前版本；项目每套方案只选一次。
- 按次/人均估价、实时预算、费用上浮模拟、缺估价/地点标签与超预算标识。
- 真实服务器持久存储、支持人数去重、热门组合、词云、昵称留言、CSV与历史空态。
- 工号后三位＋原昵称登录；工号不可重复覆盖，公众不含他人工号。
- 管理员可看登记名册/提交数量、封号解封、可恢复删除和恢复账号。

名称改动不重写历史快照；工作日禁止出游和大型室内；首份提交后预算和人数锁定，后续季度可新建活动期。入口仍为内部信任制，不等同员工身份认证。

仓库不含原部门数据库、登记名单、密钥、历史账单或站点身份。源项目中的商家报价不作为其他部门的默认预算。

## 验证

```text
node --test tests/*.test.mjs
```

测试生成器、金额、空存储隔离、登录和管理员词库规则，并在一次性数据库里验证方案修改、留言、删除恢复。构建测试需要在生成实例安装开发依赖后执行 `npm run build`。

Licensed under MIT.
