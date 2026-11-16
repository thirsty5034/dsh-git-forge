import { realpathSync } from 'node:fs'
import { dirname, normalize, resolve as pathResolve } from 'node:path'

/**
 * Normalize a project path key (absolute, no trailing slash except root).
 * Existing paths are canonicalized through realpathSync so platform aliases
 * (e.g. Windows 8.3 short names like ADMINI~1 for long user names) collapse
 * onto the same key.
 */
export function normalizeProjectKey(raw) {
  if (!raw || typeof raw !== 'string') return ''
  let p = raw.trim()
  if (!p) return ''
  try {
    p = pathResolve(p)
  } catch {
    return ''
  }
  try {
    p = realpathSync(p)
  } catch {
    // Not on disk (or unreachable) — keep the resolved form as-is.
  }
  p = normalize(p)
  while (p.length > 1 && (p.endsWith('/') || p.endsWith('\\'))) {
    const next = p.slice(0, -1)
    if (next.length <= 1) break
    p = next
  }
  return p
}

/**
 * Resolve which grants.projects key applies for a filesystem cwd.
 * Prefer exact match, then walk parents (nearest ancestor with a grants entry).
 * When start is under /workspace, do not walk above /workspace.
 *
 * @param {string} cwd
 * @param {Record<string, unknown>} projectsMap grants.projects
 * @returns {{ key: string, source: 'cwd'|'walk'|'none' }}
 */
export function resolveGrantsProjectKey(cwd, projectsMap) {
  const start = normalizeProjectKey(cwd)
  if (!start) return { key: '', source: 'none' }
  const projects = projectsMap && typeof projectsMap === 'object' ? projectsMap : {}
  if (Object.prototype.hasOwnProperty.call(projects, start)) {
    return { key: start, source: 'cwd' }
  }
  const underWorkspace = start === '/workspace' || start.startsWith('/workspace/')
  let cur = start
  while (true) {
    const parent = normalizeProjectKey(dirname(cur))
    if (!parent || parent === cur) break
    if (underWorkspace && parent !== '/workspace' && !parent.startsWith('/workspace/')) break
    cur = parent
    if (Object.prototype.hasOwnProperty.call(projects, cur)) {
      return { key: cur, source: 'walk' }
    }
    if (cur === '/workspace' || cur === '/') break
  }
  return { key: '', source: 'none' }
}

/**
 * Whether abs is inside one of the allowed roots.
 */
export function isPathInsideRoots(absPath, roots) {
  const abs = normalizeProjectKey(absPath)
  if (!abs) return false
  const list = (roots || []).map(normalizeProjectKey).filter(Boolean)
  for (const root of list) {
    if (abs === root || abs.startsWith(root + '/')) return true
  }
  return false
}

