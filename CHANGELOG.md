# Changelog

[English](./CHANGELOG.md) | [简体中文](./CHANGELOG.zh-CN.md)

## 0.1.9 — 2026-11-16

### Fixed
- **Push guard hardening** (backported from the OMSociety fork deep review): push detection anchors on the git subcommand token (quoted commit-message prose no longer false-positives), `bash -lc`/`sh -c` payloads classify recursively, remote resolution retries once, and an unresolvable bare push fails closed in enforce mode.
- **API fence rejects cross-site browser requests** (`Sec-Fetch-Site: cross-site` or Origin/Host mismatch).
- The generated agent gitconfig now `include`s the user's own global gitconfig first (identity/proxies keep working), with the empty helper reset still clearing inherited credential helpers.
- `normalizeProjectKey` canonicalizes existing paths via realpath (Windows 8.3 aliases collapse); corrupt JSON files are quarantined instead of silently reset.
- The API admission fallback now also honors the listener bind address and webStartup trusted hosts, matching dsh-ssh-tunnel v0.5.2.

## 0.1.8 — 2026-11-13

### Fixed
- **Sidebar tab returned `{"ok":false,"error":"forbidden"}` behind a reverse proxy on DSH 0.2.** Two stacked causes: (1) admission read `ctx.webRuntime.trustedHosts`, a service deleted in DSH 0.2; (2) the API route never declared `connection` in its `inject` list, so handler-time `ctx.connection` threw `cannot get property "connection" without inject`, which the webserver turned into a bare HTTP 400. The route now delegates admission to the Connection fence (`ctx.connection.requestRejection` — loopback, bind-IP, `--trusted-host`, browser-auth) and declares `connection` in `inject`, matching `dsh-ssh-tunnel` 0.4.6. The legacy local Host/Origin check remains only as a fallback for pre-0.2 hosts.

## 0.1.7 — 2026-09-11

### Added
- **`authMethod=oauth`** via PATH `git-credential-oauth` (hickford). Authorize at account save time in a **system browser** (sidebar shows the https URL; not an iframe). Per-account refresh is stored in `secrets.json`; agent git **silently refreshes** and never opens a browser.
- PAT still wins when a token account is also granted for the same host (R1). Do **not** run `git-credential-oauth configure`. Install the binary on PATH (this compose: `~/.local/bin`, see OPERATIONS.md §6.7).
- Includes the 0.1.6 Windows helper-selector hang / `!<cmd>` quoting fix (empty `helper =` reset in generated gitconfig).

## 0.1.6 — 2026-09-11

### Fixed
- **Agent HTTPS git no longer hangs on Git for Windows.** Git for Windows registers a GUI `credential.helper = helper-selector` at system scope. Helpers accumulate across scopes, so the selector ran **before** this plugin’s helper and blocked forever on a dialog a headless agent shell can never answer. Generated gitconfig now writes an empty `helper =` first (clears the list; `gitcredentials(7)`).
- **The `!<cmd>` helper now actually runs on paths with spaces.** gitconfig file quoting was swallowing the quotes around `C:\Program Files\nodejs\node.exe`, so the shell split the path (`line 1: C:Program: command not found`). Inner quotes are now escaped as `\"`. Confined to `$DSH_HOME/git-forge/gitconfig`; do not inject `GIT_CONFIG_COUNT` / `KEY_n` / `VALUE_n`.

## 0.1.5 — 2026-09-08

### Fixed
- Remove **`@deepseek-ai/dsh-client-runtime`** from `dsh.client.inject`. The package was deleted in DSH 0.1.2 (community upgrade card `DSH-0.1.2-A1-25`); keeping the phantom in `inject` left the client assembly row pending / out of the boot graph on 0.1.2 hosts. `@deepseek-ai/dsh-client-locale` is retained (provides `ctx.locale`). First tagged release — also covers the 0.1.4-era features (R1 Host credential helper, GitForge model-tool registration, monorepo project key).

## 0.1.4 — 2026-08-18

### Fixed
- Inject **`DSH_GIT_FORGE_PROJECT`** (session workspace) into agent shells so monorepo subfolder `git` cwd still uses workspace grants
- Credential helper **walks parent dirs** under `/workspace` when env is unset
- Push guard resolves **bare `git push` / `git push origin`** via `git remote get-url` before policy check
- Docs + `get_policy` describe project key sources and `list_accounts`

## 0.1.3 — 2026-08-18

### Added
- **Agent HTTPS git auth** via Host-only git credential helper (`scripts/git-credential-dsh-git-forge.mjs`) and `$DSH_HOME/git-forge/gitconfig` (`GIT_CONFIG_GLOBAL` for agent shells)
- **R1 account selection:** exactly one authorized token account per remote host; tokens never enter model context
- Health: `gitCredentialHelper`, `gitconfigPath`, `gitConfigGlobalActive`

## 0.1.2 — 2026-08-18

### Fixed
- **GitForge registers as a global model tool** without importing `@deepseek-ai/dsh-tools` (raw JSON-Schema definition + required `output`, same pattern as modlens / dsh-ssh-tunnel). Out-of-tree `defineTool` resolution left the tool missing from standard chat catalogs.
- `health.version` tracks `package.json`; `health.gitForgeRegistered` reports registration status

## 0.1.1

### Community packaging
- Public GitHub repo layout aligned with dsh-better-sidebar  
- `scripts/install.sh` / `install.ps1` (GitHub default; `--from npm` ready)  
- package.json: `repository` / `homepage` / `bugs` / `publishConfig`  

### Features
- Auto-normalize Gitea/GitLab API bases (site root → `/api/v1` or `/api/v4`)  
- Probe timeout (10s) with explicit URL/error text  
- Inline per-account probe result in the sidebar  

## 0.1.0

- Initial release: better-sidebar **Git Forge** tab  
- Account library (GitHub / Gitea / GitLab / Gitee / Bitbucket)  
- Per-project grants + enforce push  
- Host `tools.guard` for unauthorized `git push` / `git remote add|set-url`  
- Model tool `GitForge`  
- UI aligned with dsh-ssh-tunnel  

