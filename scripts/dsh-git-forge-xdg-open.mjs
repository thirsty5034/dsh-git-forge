#!/usr/bin/env node
/**
 * PATH stub for git-credential-oauth (Linux uses xdg-open, not $BROWSER).
 * Writes the https authorize URL to DSH_GIT_FORGE_OAUTH_PENDING and exits 0.
 * Never prints secrets. Loopback / file / javascript URLs are rejected.
 */
import { writeFileSync } from 'node:fs'
import { isHttpsAuthorizeUrl } from '../lib/oauth-protocol.js'

function main() {
  const url = process.argv[process.argv.length - 1] || ''
  if (!isHttpsAuthorizeUrl(url)) {
    console.error('[dsh-git-forge] oauth stub: refusing non-https authorize URL')
    process.exit(1)
  }
  const pending = process.env.DSH_GIT_FORGE_OAUTH_PENDING || ''
  if (!pending) {
    console.error('[dsh-git-forge] oauth stub: DSH_GIT_FORGE_OAUTH_PENDING is required')
    process.exit(1)
  }
  writeFileSync(pending, JSON.stringify({ url, at: Date.now() }) + '\n', { mode: 0o600 })
  process.exit(0)
}

main()
