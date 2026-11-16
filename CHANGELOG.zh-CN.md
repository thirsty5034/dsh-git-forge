# 更新日志

[English](./CHANGELOG.md) | [简体中文](./CHANGELOG.zh-CN.md)

## 0.1.8 — 2026-11-13

### 修复
- **DSH 0.2 + 反向代理下，侧栏页签报 `{"ok":false,"error":"forbidden"}`。** 两层原因叠加：(1) 准入读的是 `ctx.webRuntime.trustedHosts`，该服务在 DSH 0.2 已删除；(2) API 路由的 `inject` 列表没有声明 `connection`，运行时读 `ctx.connection` 抛 `cannot get property "connection" without inject`，被 webserver 吞成裸 HTTP 400。现在路由把准入委托给 Connection 围栏（`ctx.connection.requestRejection`——loopback / bind-IP / `--trusted-host` / 浏览器认证），并在 `inject` 中声明 `connection`，与 `dsh-ssh-tunnel` 0.4.6 的修法一致；旧本地 Host/Origin 检查仅作为 pre-0.2 宿主的兜底保留。

## 0.1.7 — 2026-09-11

### 新增
- **`authMethod=oauth`**：使用 PATH 上的 `git-credential-oauth`（hickford）。在**保存账号时**用系统浏览器完成授权（侧栏展示 https URL，不用 iframe）。refresh 按账号写入 `secrets.json`；agent git **静默续期**，不再开浏览器。
- 同 host 若同时授权了 PAT 账号，仍走 PAT（R1）。不要运行 `git-credential-oauth configure`。二进制请装到 PATH（本 compose：`~/.local/bin`，见 OPERATIONS.md §6.7）。
- 包含 0.1.6 的 Windows `helper-selector` 挂起 / `!<cmd>` 引号修复（生成 gitconfig 里先写空的 `helper =`）。

## 0.1.6 — 2026-09-11

### 修复
- **Git for Windows 下 agent 的 HTTPS git 不再永久卡死。** Git for Windows 在系统级 gitconfig 注册了 GUI `credential.helper = helper-selector`，helper 跨作用域叠加，于是它排在本插件 helper **前面**，无头 agent shell 里弹窗无人可答、永久阻塞。生成的 gitconfig 现在先写空的 `helper =`（清空此前累积，见 `gitcredentials(7)`）。
- **含空格路径上 `!<cmd>` helper 现在真正会执行。** gitconfig 文件引号会吞掉 `C:\Program Files\nodejs\node.exe` 两侧的引号，shell 在空格处切开（`line 1: C:Program: command not found`）。内层引号改为 `\"`。仅限 `$DSH_HOME/git-forge/gitconfig`；不要注入 `GIT_CONFIG_COUNT` / `KEY_n` / `VALUE_n`。

## 0.1.5 — 2026-09-08

### 修复
- 从 `dsh.client.inject` 移除 **`@deepseek-ai/dsh-client-runtime`**。该包在 DSH 0.1.2 已删除（社区升级卡 `DSH-0.1.2-A1-25`）；保留该幻影依赖会让 client 装配行在 0.1.2 宿主上 pending / 进不了 boot graph。保留 `@deepseek-ai/dsh-client-locale`（提供 `ctx.locale`）。首个打 tag 的版本——同时覆盖 0.1.4 期的功能（R1 Host 凭据 helper、GitForge 模型工具注册、monorepo 项目 key）。

## 0.1.4 — 2026-08-18

### 修复
- agent shell 注入 **`DSH_GIT_FORGE_PROJECT`**（会话工作区），子仓 cwd 仍用工作区授权
- helper 在无 env 时 **向上匹配** `/workspace` 下 grants key
- push guard 对裸 **`git push` / `git push origin`** 同步解析 `remote get-url` 再裁决
- 文档与 `get_policy` 补充 project key 来源与 `list_accounts`

## 0.1.3 — 2026-08-18

### 新增
- **Agent HTTPS git 认证**：Host 侧 credential helper + `$DSH_HOME/git-forge/gitconfig`（`GIT_CONFIG_GLOBAL`），agent bash 中的 `git` 可透明使用侧栏已授权账号
- **R1 选号**：同一 host 仅当恰好 1 个已授权 token 账号时自动注入；token 永不进模型上下文
- health：`gitCredentialHelper` / `gitconfigPath` / `gitConfigGlobalActive`

## 0.1.2 — 2026-08-18

### 修复
- **GitForge 作为全局模型工具正确注册**（不再依赖 out-of-tree 解析 `@deepseek-ai/dsh-tools` 的 `defineTool`；改用与 modlens / dsh-ssh-tunnel 相同的裸 JSON Schema + 必填 `output`）。此前标准对话工具列表中看不到该工具。
- `health.version` 与 `package.json` 对齐；`health.gitForgeRegistered` 报告注册状态

## 0.1.1

### 社区发布形态
- 对齐 dsh-better-sidebar 的公开仓库结构  
- 增加 `scripts/install.sh` / `install.ps1`（默认 GitHub；`--from npm` 预留）  
- package.json：`repository` / `homepage` / `bugs` / `publishConfig`  

### 功能
- Gitea/GitLab：保存/探测时自动补全 API 路径（站点根 → `/api/v1` 或 `/api/v4`）  
- 探测增加 10s 超时，返回具体 URL 与失败原因  
- 账号行内显示探测成功/失败  

## 0.1.0

- 首版：better-sidebar「Git 凭据」Tab  
- 账号库（GitHub / Gitea / GitLab / Gitee / Bitbucket）  
- 按项目授权 + enforce push  
- Host `tools.guard` 拦截未授权 `git push` / `git remote add|set-url`  
- 模型工具 `GitForge`  
- UI 对齐 dsh-ssh-tunnel  
