// Directories a Codex sandbox may be opened to after a contract command was
// denied writing there. The denied path is read from the real output of a
// `must_run` command that the runner itself ran in the sandbox, never from a
// model's words. Only a tool's own directory under the home directory can be
// granted, and never one that holds keys, tokens or agent configuration.
import { existsSync, mkdirSync, realpathSync, statSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'

const DENIAL = /Operation not permitted|Permission denied|AccessDeniedException|Read-only file system/

// Relative to the home directory. A grant equal to, inside or containing one
// of these is refused.
export const PROTECTED = [
  '.ssh', '.gnupg', '.aws', '.azure', '.kube', '.docker', '.codex', '.claude', '.claude.json',
  '.config/gh', '.config/gcloud', '.config/op', '.config/git', '.config/hub', '.config/1Password',
  '.local/share/keyrings', '.password-store', '.netrc', '.npmrc', '.pypirc', '.gitconfig',
  'Library/Keychains', 'Library/Cookies', 'Library/Application Support/1Password',
  'Library/Application Support/Claude', 'Library/Application Support/Codex',
  'Library/Application Support/com.apple.TCC',
]

// The home-relative directories under which a tool's own directory is the
// next path component.
const CONTAINERS = [
  ['Library', 'Caches'], ['Library', 'Application Support'], ['Library', 'Logs'],
  ['.cache'], ['.config'], ['.local', 'share'], ['.local', 'state'],
]

const within = (child, parent) => child === parent || child.startsWith(parent + sep)

// Paths under the home directory named on the denial lines of a command's
// output, `~/` expanded. A path runs from the home prefix to the next
// separator a tool puts after it (": ", a quote, a closing bracket, " (" or
// the end of the line), so a directory name with a space survives.
export function deniedPaths(output, home) {
  const prefixes = [...new Set([home, existsSync(home) ? realpathSync(home) : home])].map((h) => h + '/')
  const paths = []
  for (const line of String(output ?? '').split(/\r?\n/)) {
    if (!DENIAL.test(line)) continue
    for (const prefix of [...prefixes, '~/']) {
      let from = line.indexOf(prefix)
      while (from !== -1) {
        const rest = line.slice(from + prefix.length)
        const end = rest.search(/: |['"`)\],;]| \(|\s+$/)
        let path = (prefix === '~/' ? home + '/' : prefix) + (end === -1 ? rest : rest.slice(0, end))
        path = path.replace(/[.:]+$/, '')
        if (!paths.includes(path)) paths.push(path)
        from = line.indexOf(prefix, from + prefix.length)
      }
    }
  }
  return paths
}

// The directory to open for a denied path, or the reason it is refused.
export function grantFor(path, { home, repoPath }) {
  const homeReal = realpathSync(home)
  let target = path
  // Resolve the longest existing prefix so a symlink cannot smuggle a path out.
  let probe = target
  while (!existsSync(probe) && dirname(probe) !== probe) probe = dirname(probe)
  if (existsSync(probe)) target = join(realpathSync(probe), relative(probe, target))
  if (!within(target, homeReal) || target === homeReal) return { refused: 'outside the home directory' }
  const segments = relative(homeReal, target).split(sep).filter(Boolean)
  let depth = 0
  for (const container of CONTAINERS) {
    if (container.every((part, index) => segments[index] === part)) { depth = container.length; break }
  }
  if (depth === 0 && !segments[0].startsWith('.')) return { refused: 'not a tool directory' }
  if (segments.length <= depth) return { refused: 'a shared container, not a tool directory' }
  const rel = segments.slice(0, depth + 1).join('/')
  const dir = join(homeReal, ...segments.slice(0, depth + 1))
  if (PROTECTED.some((p) => rel === p || rel.startsWith(p + '/') || p.startsWith(rel + '/'))) {
    return { refused: 'holds keys, tokens or agent configuration' }
  }
  const repoReal = existsSync(repoPath) ? realpathSync(repoPath) : repoPath
  if (within(repoReal, dir) || within(dir, repoReal)) return { refused: 'contains or is inside the repository' }
  if (existsSync(join(dir, '.git'))) return { refused: 'a git repository' }
  if (existsSync(dir) && !statSync(dir).isDirectory()) return { refused: 'not a directory' }
  return { dir, rel: '~/' + rel }
}

// Grants for one command's sandboxed output: the directories to open now
// (created when missing, under an existing parent) and what was refused.
export function grantsFromOutput(output, { home, repoPath, writable }) {
  const granted = [], refused = []
  for (const path of deniedPaths(output, home)) {
    const grant = grantFor(path, { home, repoPath })
    if (grant.refused) { refused.push({ path, reason: grant.refused }); continue }
    if (writable.includes(grant.dir) || granted.some((g) => g.dir === grant.dir)) continue
    if (!existsSync(grant.dir)) {
      // Created only under an existing parent, and only for a plain name.
      if (!existsSync(dirname(grant.dir)) || /\s/.test(grant.rel)) {
        refused.push({ path, reason: 'does not exist' }); continue
      }
      mkdirSync(grant.dir)
    }
    granted.push(grant)
  }
  return { granted, refused }
}
