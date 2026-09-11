import { normalizeGitHost, normalizeProvider } from './account-summary.js'

/**
 * Reject oauth setup when provider/host cannot be the git-credential-oauth target.
 * Empty string means OK.
 * @param {string} provider
 * @param {string} gitHost
 * @returns {string}
 */
export function oauthProviderHostError(provider, gitHost) {
  const p = normalizeProvider(provider)
  const host = normalizeGitHost(gitHost)
  if (!p) return 'unknown provider'
  if (p === 'gitee') return 'gitee does not support git-credential-oauth in this plugin'
  if (!host) return 'gitHost is required'
  if (p === 'github' && host !== 'github.com' && !host.startsWith('github.')) {
    return `gitHost ${host} does not look like GitHub`
  }
  if (
    p === 'gitlab' &&
    host !== 'gitlab.com' &&
    !host.startsWith('gitlab.') &&
    !host.includes('gitlab')
  ) {
    return `gitHost ${host} does not look like GitLab`
  }
  if (p === 'gitea' && (host === 'github.com' || host.startsWith('github.'))) {
    return `gitHost ${host} does not match gitea`
  }
  if (p === 'bitbucket' && host !== 'bitbucket.org' && !host.endsWith('.bitbucket.org')) {
    return `gitHost ${host} does not look like Bitbucket`
  }
  return ''
}

/** @param {string} provider */
export function oauthSupportedProvider(provider) {
  const p = normalizeProvider(provider)
  return p === 'github' || p === 'gitlab' || p === 'gitea' || p === 'bitbucket'
}
