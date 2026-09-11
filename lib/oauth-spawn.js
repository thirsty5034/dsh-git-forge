/**
 * Spawn git-credential-oauth. Cordis-free so the credential helper can import it.
 * Silent path: no PATH stub (failed refresh must not open a browser / pending URL).
 * Interactive path: prepend oauth-bin/xdg-open stub (upstream does not honor $BROWSER).
 */
import { spawn } from 'node:child_process'
import { chmodSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { oauthGetStdin, parseOAuthHelperOutput } from './oauth-protocol.js'

export const SILENT_MS = 8000
export const INTERACTIVE_MS = 300000

const PLUGIN_DIR = dirname(dirname(fileURLToPath(import.meta.url)))
const STUB_JS = join(PLUGIN_DIR, 'scripts', 'dsh-git-forge-xdg-open.mjs')

export function dataDir() {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(home, 'git-forge')
}

export function pendingPathFor(accountId) {
  return join(dataDir(), `oauth-pending-${String(accountId || 'unknown')}.json`)
}

export function oauthBinDir() {
  return join(dataDir(), 'oauth-bin')
}

/**
 * @returns {string}
 */
export function resolveOAuthBinary() {
  if (process.env.DSH_GIT_FORGE_OAUTH_BIN) return process.env.DSH_GIT_FORGE_OAUTH_BIN
  const pathEnv = process.env.PATH || ''
  for (const dir of pathEnv.split(':')) {
    if (!dir) continue
    const cand = join(dir, 'git-credential-oauth')
    if (existsSync(cand)) return cand
  }
  throw new Error('git-credential-oauth not on PATH')
}

export function oauthBinaryOnPath() {
  try {
    resolveOAuthBinary()
    return true
  } catch {
    return false
  }
}

/** Ensure dataDir/oauth-bin/xdg-open execs the Node stub. */
export function ensureXdgOpenStub() {
  const dir = oauthBinDir()
  mkdirSync(dir, { recursive: true })
  try { chmodSync(dir, 0o700) } catch { /* ignore */ }
  const wrapper = join(dir, 'xdg-open')
  const body = `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(STUB_JS)} "$@"\n`
  writeFileSync(wrapper, body, { mode: 0o755 })
  try { chmodSync(wrapper, 0o755) } catch { /* ignore */ }
  return dir
}

/**
 * @param {import('node:child_process').ChildProcess} child
 * @param {string} stdin
 * @param {number} timeoutMs
 */
function collectChild(child, stdin, timeoutMs) {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      try { child.kill('SIGKILL') } catch { /* ignore */ }
      resolve({ ok: false, timedOut: true, stdout, stderr, code: null })
    }, timeoutMs)
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (c) => { stdout += c })
    child.stderr?.on('data', (c) => { stderr += c })
    child.on('error', () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ ok: false, timedOut: false, stdout, stderr, code: null })
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ ok: code === 0, timedOut: false, stdout, stderr, code })
    })
    if (stdin) {
      child.stdin?.write(stdin)
      child.stdin?.end()
    } else {
      child.stdin?.end()
    }
  })
}

function spawnOAuth({ bin, args, env, spawnFn }) {
  const fn = spawnFn || spawn
  return fn(bin, args, { env, stdio: ['pipe', 'pipe', 'pipe'] })
}

function silentEnv() {
  const env = { ...process.env }
  delete env.BROWSER
  return env
}

function interactiveEnv(pendingPath) {
  const stubDir = ensureXdgOpenStub()
  const env = { ...process.env }
  env.PATH = `${stubDir}:${env.PATH || ''}`
  env.DSH_GIT_FORGE_OAUTH_PENDING = pendingPath
  delete env.BROWSER
  return env
}

/**
 * @param {{ host: string, username?: string, refreshToken: string, spawnFn?: Function, timeoutMs?: number, bin?: string }} opts
 */
export async function runSilentOAuthGet(opts) {
  const bin = opts.bin || resolveOAuthBinary()
  const stdin = oauthGetStdin({
    host: opts.host,
    username: opts.username,
    refreshToken: opts.refreshToken,
  })
  const child = spawnOAuth({
    bin,
    args: ['get'],
    env: silentEnv(),
    spawnFn: opts.spawnFn,
  })
  const raw = await collectChild(child, stdin, opts.timeoutMs ?? SILENT_MS)
  if (raw.timedOut) return { ok: false, timedOut: true, parsed: parseOAuthHelperOutput(''), killed: true }
  const parsed = parseOAuthHelperOutput(raw.stdout)
  const ok = !!(parsed.password || parsed.oauthRefreshToken)
  return { ok, timedOut: false, parsed, killed: false }
}

/**
 * @param {{ host: string, username?: string, pendingPath: string, spawnFn?: Function, timeoutMs?: number, bin?: string }} opts
 */
export async function runInteractiveOAuthGet(opts) {
  const bin = opts.bin || resolveOAuthBinary()
  const stdin = oauthGetStdin({ host: opts.host, username: opts.username })
  const child = spawnOAuth({
    bin,
    args: ['get'],
    env: interactiveEnv(opts.pendingPath),
    spawnFn: opts.spawnFn,
  })
  const raw = await collectChild(child, stdin, opts.timeoutMs ?? INTERACTIVE_MS)
  if (raw.timedOut) return { ok: false, timedOut: true, parsed: parseOAuthHelperOutput(''), child }
  const parsed = parseOAuthHelperOutput(raw.stdout)
  const ok = !!(parsed.oauthRefreshToken || parsed.password)
  return { ok, timedOut: false, parsed, child }
}

/**
 * Start interactive oauth without awaiting completion (Host job).
 * Caller must attach close handlers.
 */
export function startInteractiveOAuthChild(opts) {
  const bin = opts.bin || resolveOAuthBinary()
  const stdin = oauthGetStdin({ host: opts.host, username: opts.username })
  const child = spawnOAuth({
    bin,
    args: ['get'],
    env: interactiveEnv(opts.pendingPath),
    spawnFn: opts.spawnFn,
  })
  if (stdin) {
    child.stdin?.write(stdin)
    child.stdin?.end()
  }
  return child
}
