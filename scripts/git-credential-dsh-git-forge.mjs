#!/usr/bin/env node
/**
 * git credential helper for dsh-git-forge.
 * gitconfig: helper = !/path/to/node /path/to/git-credential-dsh-git-forge.mjs
 *
 * Protocol: https://git-scm.com/docs/gitcredentials
 * Only "get" fills credentials. store/erase are no-ops (secrets stay in secrets.json).
 *
 * Project key resolution order:
 *   1) DSH_GIT_FORGE_PROJECT (session workspace; preferred)
 *   2) exact cwd match in grants.projects
 *   3) walk parents under /workspace until a grants key matches
 *
 * Never log password/token. Optional DSH_GIT_FORGE_HELPER_DEBUG=1 enables non-secret stderr.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve as pathResolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizeProjectKey, resolveGrantsProjectKey } from '../lib/shared/path.js'
import { selectHttpsAccountForHost } from '../lib/shared/credential-select.js'
import { fillUsernameForHost } from '../lib/oauth-protocol.js'
import { runSilentOAuthGet } from '../lib/oauth-spawn.js'

function dataDir() {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(home, 'git-forge')
}

function readJson(path, fallback) {
  try {
    if (!existsSync(path)) return fallback
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return fallback
  }
}

/** @param {string} text */
export function parseCredentialInput(text) {
  const out = {}
  for (const line of String(text || '').split(/\r?\n/)) {
    if (!line || !line.includes('=')) continue
    const i = line.indexOf('=')
    out[line.slice(0, i)] = line.slice(i + 1)
  }
  return out
}

/**
 * @param {{ envProject?: string, cwd?: string, projects?: Record<string, unknown> }} input
 * @returns {{ key: string, source: 'env'|'cwd'|'walk'|'none' }}
 */
export function resolveHelperProjectKey(input) {
  const envKey = normalizeProjectKey(input.envProject || '')
  if (envKey) return { key: envKey, source: 'env' }
  const walked = resolveGrantsProjectKey(input.cwd || '', input.projects || {})
  if (walked.key) return walked
  const cwdKey = normalizeProjectKey(input.cwd || '')
  if (cwdKey) return { key: cwdKey, source: 'cwd' }
  return { key: '', source: 'none' }
}

async function readStdin() {
  const chunks = []
  for await (const c of process.stdin) chunks.push(c)
  return Buffer.concat(chunks).toString('utf8')
}

function debug(msg) {
  if (process.env.DSH_GIT_FORGE_HELPER_DEBUG === '1') {
    console.error(`[dsh-git-forge-helper] ${msg}`)
  }
}

async function runGet() {
  const raw = await readStdin()
  const req = parseCredentialInput(raw)
  const host = req.host || ''

  const dir = dataDir()
  const accountsDoc = readJson(join(dir, 'accounts.json'), { version: 1, accounts: [] })
  const grantsDoc = readJson(join(dir, 'grants.json'), { version: 1, projects: {} })
  const secretsDoc = readJson(join(dir, 'secrets.json'), { version: 1, byAccountId: {} })

  const resolved = resolveHelperProjectKey({
    envProject: process.env.DSH_GIT_FORGE_PROJECT || '',
    cwd: process.cwd(),
    projects: grantsDoc.projects || {},
  })
  const projectPathKey = resolved.key
  debug(
    `projectKey=${projectPathKey || '(empty)'} source=${resolved.source} host=${host || '(empty)'} cwd=${process.cwd()}`,
  )

  const grants = (projectPathKey && grantsDoc.projects && grantsDoc.projects[projectPathKey]) || {
    accountIds: [],
  }

  const selected = selectHttpsAccountForHost({
    projectPathKey,
    host,
    grants,
    accounts: accountsDoc.accounts || [],
  })
  if (!selected.ok) {
    debug(`${selected.code}: ${selected.message}`)
    return
  }
  const sec =
    (secretsDoc.byAccountId && secretsDoc.byAccountId[selected.account.id]) || {}
  if (selected.via === 'oauth' || selected.account.authMethod === 'oauth') {
    const refresh = sec.oauthRefreshToken || ''
    if (!refresh) {
      debug('oauth refresh missing; re-authorize in Git Forge sidebar')
      return
    }
    const silent = await runSilentOAuthGet({
      host,
      username: fillUsernameForHost(host, selected.account.username),
      refreshToken: refresh,
    })
    if (!silent.ok || !silent.parsed.password) {
      debug('oauth refresh failed; re-authorize in Git Forge sidebar')
      return
    }
    if (silent.parsed.oauthRefreshToken && silent.parsed.oauthRefreshToken !== refresh) {
      try {
        const next = { ...secretsDoc, byAccountId: { ...secretsDoc.byAccountId } }
        next.byAccountId[selected.account.id] = {
          ...sec,
          oauthRefreshToken: silent.parsed.oauthRefreshToken,
          oauthExpired: undefined,
        }
        if (silent.parsed.passwordExpiryUtc) {
          next.byAccountId[selected.account.id].oauthTokenExpiry = Number(silent.parsed.passwordExpiryUtc)
        }
        writeFileSync(join(dir, 'secrets.json'), JSON.stringify(next, null, 2) + '\n', { mode: 0o600 })
      } catch {
        /* ignore persist errors; still fill git */
      }
    }
    const username = fillUsernameForHost(host, selected.account.username || silent.parsed.username)
    process.stdout.write(`username=${username}\npassword=${silent.parsed.password}\n\n`)
    return
  }
  const token = sec.token || ''
  if (!token) {
    debug('token missing in secrets store')
    return
  }
  const username = selected.account.username || 'git'
  process.stdout.write(`username=${username}\npassword=${token}\n\n`)
}

async function main() {
  const action = process.argv[2] || 'get'
  if (action !== 'get') {
    process.exit(0)
  }
  try {
    await runGet()
    process.exit(0)
  } catch (e) {
    debug(e && e.message ? e.message : String(e))
    process.exit(1)
  }
}

const selfPath = fileURLToPath(import.meta.url)
const entryPath = process.argv[1] ? pathResolve(process.argv[1]) : ''
if (entryPath && selfPath === entryPath) {
  main()
}
