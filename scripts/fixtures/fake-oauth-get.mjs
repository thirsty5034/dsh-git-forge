#!/usr/bin/env node
/**
 * Test double for git-credential-oauth get.
 * good refresh → fill immediately; bad/missing → sleep (watchdog).
 */
import { parseCredentialInput } from '../git-credential-dsh-git-forge.mjs'

const chunks = []
for await (const c of process.stdin) chunks.push(c)
const req = parseCredentialInput(Buffer.concat(chunks).toString('utf8'))
const refresh = req.oauth_refresh_token || ''
if (refresh === 'good') {
  process.stdout.write(
    'username=oauth2\npassword=access_ok\noauth_refresh_token=good2\npassword_expiry_utc=2000000000\n\n',
  )
  process.exit(0)
}
await new Promise((r) => setTimeout(r, 60000))
process.exit(0)
