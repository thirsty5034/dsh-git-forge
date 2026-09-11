/** Supported forge providers. */
export const FORGE_PROVIDERS = ['github', 'gitea', 'gitlab', 'gitee', 'bitbucket']

/** Default API / git host hints per provider (user can override). */
export const PROVIDER_DEFAULTS = {
  github: {
    apiBase: 'https://api.github.com',
    gitHost: 'github.com',
  },
  gitea: {
    apiBase: '',
    gitHost: '',
  },
  gitlab: {
    apiBase: '',
    gitHost: '',
  },
  gitee: {
    apiBase: 'https://gitee.com/api/v5',
    gitHost: 'gitee.com',
  },
  bitbucket: {
    apiBase: 'https://api.bitbucket.org/2.0',
    gitHost: 'bitbucket.org',
  },
}

export function normalizeProvider(raw) {
  const p = String(raw || '').trim().toLowerCase()
  if (FORGE_PROVIDERS.includes(p)) return p
  return ''
}

export function normalizeGitHost(raw) {
  let h = String(raw || '').trim().toLowerCase()
  if (!h) return ''
  h = h.replace(/^https?:\/\//, '')
  h = h.replace(/\/.*$/, '')
  h = h.replace(/:\d+$/, '')
  h = h.replace(/^git@/, '')
  return h
}

/**
 * Normalize forge API base URLs.
 * Users often paste the site root (https://gitea.example.com) without /api/v1.
 */
export function normalizeApiBase(provider, raw) {
  let base = String(raw || '').trim()
  if (!base) return ''
  base = base.replace(/\/+$/, '')
  const p = normalizeProvider(provider) || provider
  if (!/^https?:\/\//i.test(base) && !base.includes('://')) {
    base = 'https://' + base.replace(/^\/+/, '')
    base = base.replace(/\/+$/, '')
  }

  if (p === 'gitea') {
    if (!/\/api\/v1$/i.test(base)) {
      base = base.replace(/\/api$/i, '')
      base = base.replace(/\/user$/i, '')
      base = base + '/api/v1'
    }
  } else if (p === 'gitlab') {
    if (!/\/api\/v4$/i.test(base) && !/\/api\/v\d+$/i.test(base)) {
      base = base.replace(/\/api$/i, '')
      base = base + '/api/v4'
    }
  } else if (p === 'github') {
    if (/^https?:\/\/github\.com$/i.test(base)) base = 'https://api.github.com'
  } else if (p === 'gitee') {
    if (/^https?:\/\/gitee\.com$/i.test(base)) base = 'https://gitee.com/api/v5'
    else if (!/\/api\/v5$/i.test(base) && /gitee\.com$/i.test(base.replace(/\/+$/, ''))) {
      base = base.replace(/\/+$/, '') + '/api/v5'
    }
  }
  return base
}

export function accountTokenConfigured(account, secrets) {
  if (!account) return false
  if (account.authMethod === 'ssh') return true
  const sec = (secrets && secrets.byAccountId && secrets.byAccountId[account.id]) || {}
  if (account.authMethod === 'oauth') {
    if (sec.oauthRefreshToken && String(sec.oauthRefreshToken).trim()) return true
    // GitHub often omits refresh_token; a still-valid access token counts as authorized.
    const access = sec.token && String(sec.token).trim()
    if (!access) return false
    const exp = Number(sec.oauthTokenExpiry)
    if (!Number.isFinite(exp) || exp <= 0) return true
    return exp > Math.floor(Date.now() / 1000) + 30
  }
  return !!(sec.token && String(sec.token).trim())
}

function credentialStatusOf(account, secrets) {
  if (account.authMethod === 'ssh') return 'ssh'
  if (account.authMethod === 'oauth') {
    const sec = (secrets && secrets.byAccountId && secrets.byAccountId[account.id]) || {}
    if (sec.oauthExpired === true) return 'expired'
    return accountTokenConfigured(account, secrets) ? 'saved' : 'missing'
  }
  return accountTokenConfigured(account, secrets) ? 'saved' : 'missing'
}

/** UI-safe account (never includes token / refresh). */
export function publicAccount(account, secrets) {
  const configured = accountTokenConfigured(account, secrets)
  const status = credentialStatusOf(account, secrets)
  return {
    id: account.id,
    name: account.name,
    provider: account.provider,
    gitHost: account.gitHost,
    apiBase: account.apiBase || '',
    authMethod: account.authMethod || 'token',
    username: account.username || '',
    defaultOwner: account.defaultOwner || '',
    source: account.source || 'manual',
    updatedAt: account.updatedAt || 0,
    credentialConfigured: configured,
    credentialStatus: status,
    tokenConfigured: configured && account.authMethod === 'token',
  }
}

/** Model-facing summary — no secrets. */
export function modelAccountSummary(account, secrets) {
  const p = publicAccount(account, secrets)
  return {
    account_id: p.id,
    name: p.name,
    provider: p.provider,
    gitHost: p.gitHost,
    apiBase: p.apiBase,
    authMethod: p.authMethod,
    username: p.username,
    defaultOwner: p.defaultOwner,
    credentialConfigured: p.credentialConfigured,
    credentialStatus: p.credentialStatus,
  }
}

export function assertNoSecretFields(obj, label = 'object') {
  const banned = [
    'token',
    'password',
    'secret',
    'pat',
    'access_token',
    'accesstoken',
    'oauthrefreshtoken',
    'refresh_token',
    'oauth_refresh_token',
  ]
  const stack = [{ value: obj, path: label }]
  while (stack.length) {
    const { value, path } = stack.pop()
    if (!value || typeof value !== 'object') continue
    if (Array.isArray(value)) {
      value.forEach((v, i) => stack.push({ value: v, path: `${path}[${i}]` }))
      continue
    }
    for (const [k, v] of Object.entries(value)) {
      const key = k.toLowerCase()
      if (banned.includes(key) && v) {
        throw new Error(`${path}.${k} must not carry secret material`)
      }
      if (typeof v === 'object' && v) stack.push({ value: v, path: `${path}.${k}` })
    }
  }
  return true
}
