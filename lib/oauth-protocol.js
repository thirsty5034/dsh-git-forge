/**
 * git-credential-oauth stdin/stdout helpers. Never log password or refresh.
 */

export function oauthGetStdin({ protocol = 'https', host, username, refreshToken } = {}) {
  const lines = [`protocol=${protocol || 'https'}`, `host=${host || ''}`]
  if (username) lines.push(`username=${username}`)
  if (refreshToken) lines.push(`oauth_refresh_token=${refreshToken}`)
  return lines.join('\n') + '\n\n'
}

/**
 * @param {string} text
 * @returns {{ username: string, password: string, oauthRefreshToken: string, passwordExpiryUtc: string }}
 */
export function parseOAuthHelperOutput(text) {
  const out = { username: '', password: '', oauthRefreshToken: '', passwordExpiryUtc: '' }
  for (const line of String(text || '').split(/\r?\n/)) {
    const i = line.indexOf('=')
    if (i < 0) continue
    const k = line.slice(0, i)
    const v = line.slice(i + 1)
    if (k === 'username') out.username = v
    else if (k === 'password') out.password = v
    else if (k === 'oauth_refresh_token') out.oauthRefreshToken = v
    else if (k === 'password_expiry_utc') out.passwordExpiryUtc = v
  }
  return out
}

export function fillUsernameForHost(host, savedUsername) {
  if (savedUsername) return savedUsername
  if (host === 'bitbucket.org') return 'x-token-auth'
  return 'oauth2'
}

/** Human-facing authorize URLs only (https). Loopback http is not shown in the sidebar. */
export function isHttpsAuthorizeUrl(raw) {
  try {
    const u = new URL(String(raw || ''))
    return u.protocol === 'https:'
  } catch {
    return false
  }
}
