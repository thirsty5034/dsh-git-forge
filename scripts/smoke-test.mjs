#!/usr/bin/env node
/**
 * Offline smoke tests (no network, no DSH process).
 * Run: node scripts/smoke-test.mjs
 */
import assert from 'node:assert/strict'
import { normalizeProjectKey, resolveGrantsProjectKey } from '../lib/shared/path.js'
import {
  publicAccount,
  modelAccountSummary,
  assertNoSecretFields,
  normalizeGitHost,
  normalizeApiBase,
} from '../lib/shared/account-summary.js'
import {
  hostFromGitUrl,
  extractGitTargets,
  classifyGitWriteCommand,
  evaluatePushPolicy,
} from '../lib/shared/git-policy.js'
import { selectTokenAccountForHost, selectHttpsAccountForHost } from '../lib/shared/credential-select.js'
import { oauthProviderHostError, oauthSupportedProvider } from '../lib/shared/oauth-match.js'
import {
  oauthGetStdin,
  parseOAuthHelperOutput,
  fillUsernameForHost,
  isHttpsAuthorizeUrl,
} from '../lib/oauth-protocol.js'
import { buildHelperGitconfigContent, helperLineCount } from '../lib/helper-gitconfig.js'
import { runSilentOAuthGet } from '../lib/oauth-spawn.js'
import { EventEmitter } from 'node:events'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(fileURLToPath(import.meta.url)) + '/..'
import { guessPushRemoteName } from '../lib/shared/remote-resolve.js'
import {
  parseCredentialInput,
  resolveHelperProjectKey,
} from './git-credential-dsh-git-forge.mjs'

let failed = 0
const queue = []
function test(name, fn) {
  queue.push({ name, fn })
}

async function runAll() {
  for (const { name, fn } of queue) {
    try {
      await fn()
      console.log('ok  ', name)
    } catch (e) {
      failed++
      console.error('FAIL', name, e && e.message ? e.message : e)
    }
  }
  if (failed) {
    console.error(`\n${failed} failed`)
    process.exit(1)
  }
  console.log('\nall passed')
}

test('normalizeProjectKey', () => {
  assert.equal(normalizeProjectKey('/workspace/DSH-plugin/'), '/workspace/DSH-plugin')
})

test('hostFromGitUrl scp and https', () => {
  assert.equal(hostFromGitUrl('git@github.com:org/repo.git'), 'github.com')
  assert.equal(hostFromGitUrl('https://gitea.example.com/org/repo.git'), 'gitea.example.com')
  assert.equal(hostFromGitUrl('ssh://git@github.com/org/repo.git'), 'github.com')
})

test('extractGitTargets finds hosts', () => {
  const t = extractGitTargets('git push git@github.com:a/b.git')
  assert.ok(t.some((x) => x.host === 'github.com'))
  const t2 = extractGitTargets('git remote set-url origin https://gitea.company/x/y.git')
  assert.ok(t2.some((x) => x.host === 'gitea.company'))
})

test('classifyGitWriteCommand', () => {
  assert.equal(classifyGitWriteCommand('git status').kind, 'none')
  assert.equal(classifyGitWriteCommand('git push origin main').kind, 'push')
  assert.equal(classifyGitWriteCommand('git remote set-url origin https://github.com/a/b.git').kind, 'remote_write')
  // commit message must not look like a push
  assert.equal(
    classifyGitWriteCommand('git commit -m "fix: bare git push guard"').kind,
    'none',
  )
  // path dsh-git-forge + URL must not be push without git push subcommand
  assert.equal(
    classifyGitWriteCommand('node -e "fetch(\'http://127.0.0.1:3080/dsh-git-forge/api/health\')"').kind,
    'none',
  )
})

test('evaluatePushPolicy blocks wrong host when granted', () => {
  const accounts = [
    { id: 'a1', gitHost: 'gitea.local', apiBase: 'https://gitea.local/api/v1' },
  ]
  const bad = evaluatePushPolicy({
    projectPathKey: '/workspace/secret',
    accountIds: ['a1'],
    accounts,
    enforce: 'enforce',
    classification: {
      kind: 'push',
      targets: [{ raw: 'git@github.com:x/y.git', host: 'github.com' }],
    },
    command: 'git push git@github.com:x/y.git',
  })
  assert.equal(bad.ok, false)
  assert.match(bad.reason, /github.com/)

  const good = evaluatePushPolicy({
    projectPathKey: '/workspace/secret',
    accountIds: ['a1'],
    accounts,
    enforce: 'enforce',
    classification: {
      kind: 'push',
      targets: [{ raw: 'git@gitea.local:x/y.git', host: 'gitea.local' }],
    },
    command: 'git push git@gitea.local:x/y.git',
  })
  assert.equal(good.ok, true)
})

test('unbound allow vs deny', () => {
  const allow = evaluatePushPolicy({
    projectPathKey: '/workspace/x',
    accountIds: [],
    accounts: [],
    enforce: 'allow',
    classification: { kind: 'push', targets: [{ raw: 'https://github.com/a/b', host: 'github.com' }] },
    command: 'git push https://github.com/a/b',
  })
  assert.equal(allow.ok, true)

  const deny = evaluatePushPolicy({
    projectPathKey: '/workspace/x',
    accountIds: [],
    accounts: [],
    enforce: 'deny_unbound',
    classification: { kind: 'push', targets: [{ raw: 'https://github.com/a/b', host: 'github.com' }] },
    command: 'git push https://github.com/a/b',
  })
  assert.equal(deny.ok, false)
})

test('publicAccount never leaks token', () => {
  const account = {
    id: 'a1',
    name: 'gh',
    provider: 'github',
    gitHost: 'github.com',
    apiBase: 'https://api.github.com',
    authMethod: 'token',
  }
  const secrets = { byAccountId: { a1: { token: 'ghp_secret' } } }
  const pub = publicAccount(account, secrets)
  assert.equal(pub.credentialStatus, 'saved')
  assert.equal('token' in pub, false)
  assertNoSecretFields(pub)
  assertNoSecretFields(modelAccountSummary(account, secrets))
})

test('normalizeGitHost', () => {
  assert.equal(normalizeGitHost('https://GitHub.com/foo'), 'github.com')
})

test('normalizeApiBase gitea appends /api/v1', () => {
  assert.equal(
    normalizeApiBase('gitea', 'https://gitea.mi.pp00.top'),
    'https://gitea.mi.pp00.top/api/v1',
  )
  assert.equal(
    normalizeApiBase('gitea', 'https://gitea.mi.pp00.top/api/v1'),
    'https://gitea.mi.pp00.top/api/v1',
  )
})

test('R1 selects single token account', () => {
  const r = selectTokenAccountForHost({
    projectPathKey: '/workspace/app',
    host: 'github.com',
    grants: { accountIds: ['a1'] },
    accounts: [{ id: 'a1', gitHost: 'github.com', authMethod: 'token', username: 'u' }],
  })
  assert.equal(r.ok, true)
  assert.equal(r.account.id, 'a1')
})

test('R1 rejects ambiguous token accounts', () => {
  const r = selectTokenAccountForHost({
    projectPathKey: '/workspace/app',
    host: 'GitHub.COM',
    grants: { accountIds: ['a1', 'a2'] },
    accounts: [
      { id: 'a1', gitHost: 'github.com', authMethod: 'token', username: 'u1' },
      { id: 'a2', gitHost: 'github.com', authMethod: 'token', username: 'u2' },
    ],
  })
  assert.equal(r.ok, false)
  assert.equal(r.code, 'ambiguous')
})

test('R1 ssh_only when no token account', () => {
  const r = selectTokenAccountForHost({
    projectPathKey: '/workspace/app',
    host: 'github.com',
    grants: { accountIds: ['s1'] },
    accounts: [{ id: 's1', gitHost: 'github.com', authMethod: 'ssh', username: 'git' }],
  })
  assert.equal(r.ok, false)
  assert.equal(r.code, 'ssh_only')
})

test('parseCredentialInput', () => {
  const o = parseCredentialInput('protocol=https\nhost=github.com\npath=org/repo.git\n\n')
  assert.equal(o.protocol, 'https')
  assert.equal(o.host, 'github.com')
  assert.equal(o.path, 'org/repo.git')
})

test('resolveGrantsProjectKey walks monorepo child to workspace grant', () => {
  const projects = {
    '/workspace/DSH-plugin': { accountIds: ['a1'] },
  }
  const r = resolveGrantsProjectKey('/workspace/DSH-plugin/dsh-git-forge', projects)
  assert.equal(r.key, '/workspace/DSH-plugin')
  assert.equal(r.source, 'walk')
  const exact = resolveGrantsProjectKey('/workspace/DSH-plugin', projects)
  assert.equal(exact.source, 'cwd')
})

test('resolveHelperProjectKey prefers env over cwd walk', () => {
  const projects = { '/workspace/DSH-plugin': { accountIds: ['a1'] } }
  const r = resolveHelperProjectKey({
    envProject: '/workspace/DSH-plugin',
    cwd: '/workspace/other/pkg',
    projects,
  })
  assert.equal(r.source, 'env')
  assert.equal(r.key, '/workspace/DSH-plugin')
})

test('guessPushRemoteName', () => {
  assert.equal(guessPushRemoteName('git push'), 'origin')
  assert.equal(guessPushRemoteName('git push origin main'), 'origin')
  assert.equal(guessPushRemoteName('git push --force-with-lease upstream HEAD'), 'upstream')
})

test('oauthProviderHostError rejects gitee and mismatched github host', () => {
  assert.match(oauthProviderHostError('gitee', 'gitee.com'), /gitee does not support/)
  assert.match(oauthProviderHostError('github', 'gitea.example.com'), /does not look like GitHub/)
  assert.equal(oauthProviderHostError('github', 'github.com'), '')
  assert.equal(oauthProviderHostError('gitea', 'gitea.example.com'), '')
  assert.equal(oauthSupportedProvider('github'), true)
  assert.equal(oauthSupportedProvider('gitee'), false)
})

test('HTTPS PAT wins over oauth on same host', () => {
  const r = selectHttpsAccountForHost({
    projectPathKey: '/workspace/app',
    host: 'github.com',
    grants: { accountIds: ['t1', 'o1'] },
    accounts: [
      { id: 't1', gitHost: 'github.com', authMethod: 'token' },
      { id: 'o1', gitHost: 'github.com', authMethod: 'oauth' },
    ],
  })
  assert.equal(r.ok, true)
  assert.equal(r.via, 'token')
  assert.equal(r.account.id, 't1')
})

test('HTTPS selects unique oauth when no PAT', () => {
  const r = selectHttpsAccountForHost({
    projectPathKey: '/workspace/app',
    host: 'github.com',
    grants: { accountIds: ['o1'] },
    accounts: [{ id: 'o1', gitHost: 'github.com', authMethod: 'oauth' }],
  })
  assert.equal(r.ok, true)
  assert.equal(r.via, 'oauth')
  assert.equal(r.account.id, 'o1')
})

test('HTTPS rejects two oauth accounts', () => {
  const r = selectHttpsAccountForHost({
    projectPathKey: '/workspace/app',
    host: 'github.com',
    grants: { accountIds: ['o1', 'o2'] },
    accounts: [
      { id: 'o1', gitHost: 'github.com', authMethod: 'oauth' },
      { id: 'o2', gitHost: 'github.com', authMethod: 'oauth' },
    ],
  })
  assert.equal(r.ok, false)
  assert.equal(r.code, 'ambiguous_oauth')
})

test('R1 ssh_only still when only SSH; oauth-only is not ssh_only', () => {
  const ssh = selectTokenAccountForHost({
    projectPathKey: '/workspace/app',
    host: 'github.com',
    grants: { accountIds: ['s1'] },
    accounts: [{ id: 's1', gitHost: 'github.com', authMethod: 'ssh' }],
  })
  assert.equal(ssh.ok, false)
  assert.equal(ssh.code, 'ssh_only')
  const tokenOnlyOauth = selectTokenAccountForHost({
    projectPathKey: '/workspace/app',
    host: 'github.com',
    grants: { accountIds: ['o1'] },
    accounts: [{ id: 'o1', gitHost: 'github.com', authMethod: 'oauth' }],
  })
  assert.equal(tokenOnlyOauth.ok, false)
  assert.equal(tokenOnlyOauth.code, 'no_token_account')
})

test('publicAccount oauth status from refresh; no secret fields', () => {
  const account = {
    id: 'o1',
    name: 'gh-oauth',
    provider: 'github',
    gitHost: 'github.com',
    authMethod: 'oauth',
  }
  const secrets = { byAccountId: { o1: { oauthRefreshToken: 'rt_secret' } } }
  const pub = publicAccount(account, secrets)
  assert.equal(pub.credentialStatus, 'saved')
  assert.equal(pub.tokenConfigured, false)
  assert.equal('oauthRefreshToken' in pub, false)
  assertNoSecretFields(pub)
  const expired = publicAccount(account, { byAccountId: { o1: { oauthExpired: true } } })
  assert.equal(expired.credentialStatus, 'expired')
})

test('oauth protocol stdin/stdout and username defaults', () => {
  const stdin = oauthGetStdin({ host: 'github.com', refreshToken: 'rt1', username: 'alice' })
  assert.match(stdin, /host=github.com/)
  assert.match(stdin, /oauth_refresh_token=rt1/)
  const parsed = parseOAuthHelperOutput(
    'username=oauth2\npassword=access_secret\noauth_refresh_token=rt2\npassword_expiry_utc=1700000000\n',
  )
  assert.equal(parsed.username, 'oauth2')
  assert.equal(parsed.password, 'access_secret')
  assert.equal(parsed.oauthRefreshToken, 'rt2')
  assert.equal(fillUsernameForHost('bitbucket.org', ''), 'x-token-auth')
  assert.equal(fillUsernameForHost('github.com', ''), 'oauth2')
  assert.equal(fillUsernameForHost('github.com', 'me'), 'me')
  assert.equal(isHttpsAuthorizeUrl('https://github.com/login/oauth/authorize?x=1'), true)
  assert.equal(isHttpsAuthorizeUrl('http://127.0.0.1:1234/'), false)
  assert.equal(isHttpsAuthorizeUrl('file:///etc/passwd'), false)
})

test('helper gitconfig is a single forge helper', () => {
  const content = buildHelperGitconfigContent('/usr/bin/node', '/opt/helper.mjs')
  assert.equal(helperLineCount(content), 1)
  assert.match(content, /helper = !"\/usr\/bin\/node" "\/opt\/helper.mjs"/)
  assert.doesNotMatch(content, /helper = oauth/)
})

function fakeStd() {
  const s = new EventEmitter()
  s.setEncoding = () => s
  return s
}

test('silent oauth watchdog kills hung child', async () => {
  const hung = new EventEmitter()
  hung.stdout = fakeStd()
  hung.stderr = fakeStd()
  hung.stdin = { write() {}, end() {} }
  let killed = false
  hung.kill = () => {
    killed = true
    hung.emit('close', null)
  }
  const r = await runSilentOAuthGet({
    host: 'github.com',
    refreshToken: 'bad',
    timeoutMs: 50,
    bin: '/bin/true',
    spawnFn: () => hung,
  })
  assert.equal(r.timedOut, true)
  assert.equal(r.ok, false)
  assert.equal(killed, true)
})

test('silent oauth parses fill from fake child', async () => {
  const child = new EventEmitter()
  child.stdout = fakeStd()
  child.stderr = fakeStd()
  child.stdin = {
    write() {},
    end() {
      queueMicrotask(() => {
        child.stdout.emit('data', 'username=oauth2\npassword=tok\noauth_refresh_token=rt\n')
        child.emit('close', 0)
      })
    },
  }
  const r = await runSilentOAuthGet({
    host: 'github.com',
    refreshToken: 'good',
    timeoutMs: 1000,
    bin: '/bin/true',
    spawnFn: () => child,
  })
  assert.equal(r.ok, true)
  assert.equal(r.parsed.password, 'tok')
  assert.equal(r.parsed.oauthRefreshToken, 'rt')
})

test('xdg-open stub writes pending https URL and rejects loopback', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gf-oauth-'))
  const pending = join(dir, 'pending.json')
  const stub = join(ROOT, 'scripts/dsh-git-forge-xdg-open.mjs')
  const good = spawnSync(process.execPath, [stub, 'https://github.com/login/oauth/authorize?x=1'], {
    env: { ...process.env, DSH_GIT_FORGE_OAUTH_PENDING: pending },
    encoding: 'utf8',
  })
  assert.equal(good.status, 0, good.stderr)
  const body = JSON.parse(readFileSync(pending, 'utf8'))
  assert.equal(body.url, 'https://github.com/login/oauth/authorize?x=1')
  assert.equal(typeof body.at, 'number')
  const bad = spawnSync(process.execPath, [stub, 'http://127.0.0.1:9/'], {
    env: { ...process.env, DSH_GIT_FORGE_OAUTH_PENDING: pending },
    encoding: 'utf8',
  })
  assert.equal(bad.status, 1)
  rmSync(dir, { recursive: true, force: true })
})

await runAll()
