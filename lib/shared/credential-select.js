/**
 * Pure R1 selection: exactly one authorized token account per gitHost.
 * HTTPS oauth is a later fallback (selectHttpsAccountForHost).
 * No I/O — secrets lookup stays in the credential helper / Host.
 */

import { normalizeGitHost } from './account-summary.js'
import { normalizeProjectKey } from './path.js'

/**
 * @typedef {{ id: string, gitHost?: string, authMethod?: string, username?: string }} ForgeAccount
 * @typedef {{ accountIds?: string[] }} ProjectGrants
 * @typedef {{ ok: true, account: ForgeAccount, via?: 'token'|'oauth' } | { ok: false, code: string, message: string }} SelectResult
 */

function grantedHostMatches(input) {
  const projectPathKey = normalizeProjectKey(input.projectPathKey || '')
  if (!projectPathKey) {
    return { error: { ok: false, code: 'no_project', message: 'no project path for git credential helper' } }
  }
  const host = normalizeGitHost(input.host || '')
  if (!host) {
    return { error: { ok: false, code: 'no_grant', message: 'missing git host' } }
  }
  const ids = new Set((input.grants && input.grants.accountIds) || [])
  if (!ids.size) {
    return {
      error: {
        ok: false,
        code: 'no_grant',
        message: `no forge accounts authorized for project ${projectPathKey}`,
      },
    }
  }
  const granted = (input.accounts || []).filter((a) => a && ids.has(a.id))
  const hostMatches = granted.filter((a) => normalizeGitHost(a.gitHost || '') === host)
  if (!hostMatches.length) {
    return { error: { ok: false, code: 'no_grant', message: `no authorized account for host ${host}` } }
  }
  return { projectPathKey, host, hostMatches }
}

function partitionHostAccounts(hostMatches) {
  const tokenAccounts = hostMatches.filter((a) => (a.authMethod || 'token') === 'token')
  const oauthAccounts = hostMatches.filter((a) => a.authMethod === 'oauth')
  const sshAccounts = hostMatches.filter((a) => a.authMethod === 'ssh')
  return { tokenAccounts, oauthAccounts, sshAccounts }
}

/**
 * Select exactly one token account for HTTPS git credential fill (R1).
 * @param {{ projectPathKey: string, host: string, grants: ProjectGrants, accounts: ForgeAccount[] }} input
 * @returns {SelectResult}
 */
export function selectTokenAccountForHost(input) {
  const ctx = grantedHostMatches(input)
  if (ctx.error) return ctx.error
  const { host, hostMatches } = ctx
  const { tokenAccounts, oauthAccounts, sshAccounts } = partitionHostAccounts(hostMatches)
  if (tokenAccounts.length > 1) {
    return {
      ok: false,
      code: 'ambiguous',
      message: `multiple token accounts authorized for ${host}; keep exactly one granted token account for this project (R1)`,
    }
  }
  if (tokenAccounts.length === 1) {
    return { ok: true, account: tokenAccounts[0], via: 'token' }
  }
  if (sshAccounts.length > 0 && oauthAccounts.length === 0) {
    return {
      ok: false,
      code: 'ssh_only',
      message: `only SSH accounts authorized for ${host}; use an SSH remote or system ssh-agent`,
    }
  }
  return { ok: false, code: 'no_token_account', message: `no token account for ${host}` }
}

/**
 * HTTPS fill: PAT R1 wins; else exactly one granted oauth account for the host.
 * SSH accounts never fill HTTPS. Presence of SSH does not block a unique oauth account.
 * @param {{ projectPathKey: string, host: string, grants: ProjectGrants, accounts: ForgeAccount[] }} input
 * @returns {SelectResult}
 */
export function selectHttpsAccountForHost(input) {
  const token = selectTokenAccountForHost(input)
  if (token.ok) return token
  if (token.code === 'ambiguous') return token
  if (token.code === 'no_project' || token.code === 'no_grant') return token

  const ctx = grantedHostMatches(input)
  if (ctx.error) return ctx.error
  const { host, hostMatches } = ctx
  const { oauthAccounts, sshAccounts } = partitionHostAccounts(hostMatches)
  if (oauthAccounts.length > 1) {
    return {
      ok: false,
      code: 'ambiguous_oauth',
      message: `multiple oauth accounts authorized for ${host}; keep exactly one granted oauth account for this project`,
    }
  }
  if (oauthAccounts.length === 1) {
    return { ok: true, account: oauthAccounts[0], via: 'oauth' }
  }
  if (sshAccounts.length > 0) {
    return {
      ok: false,
      code: 'ssh_only',
      message: `only SSH accounts authorized for ${host}; use an SSH remote or system ssh-agent`,
    }
  }
  return token
}
