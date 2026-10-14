// Directories a Codex sandbox may be opened to after a command was denied
// writing there. The denied path is read from the output of a command the
// runner itself ran in the sandbox. At executor time that output can come
// from code the executor wrote, so the rules below decide on the path alone:
// only a tool's own directory under the home directory, never one that holds
// keys, tokens, agent or shell configuration, programs on PATH, a git
// repository, the repository or the run's own records. Comparisons ignore
// letter case, because macOS file systems do.
import { existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'

const DENIAL = /operation not permitted|permission denied|accessdeniedexception|read-only file system|\beperm\b|\beacces\b/i

// Whether a command's output reports a denied write, in any tool's wording.
export const hasDenial = (output) => String(output ?? '').split(/\r?\n/).some((line) => DENIAL.test(line))

// Relative to the home directory, compared without letter case. A grant
// equal to, inside or containing one of these is refused.
export const PROTECTED = [
  // keys, tokens and credentials
  '.ssh', '.gnupg', '.aws', '.azure', '.kube', '.docker', '.password-store', '.netrc', '.npmrc', '.pypirc',
  '.gitconfig', '.git-credentials', '.config/gh', '.config/gcloud', '.config/op', '.config/git', '.config/hub',
  '.config/1password', '.local/share/keyrings', 'library/keychains', 'library/cookies',
  'library/application support/1password', 'library/application support/com.apple.tcc',
  // agent configuration
  '.codex', '.claude', '.claude.json', '.cursor', '.gemini', '.continue', '.codeium', '.aider',
  '.config/opencode', 'library/application support/claude', 'library/application support/codex',
  'library/application support/cursor',
  // shell start-up and programs started at login
  '.profile', '.bashrc', '.bash_profile', '.bash_login', '.zshrc', '.zshenv', '.zprofile', '.zlogin',
  '.oh-my-zsh', '.config/fish', '.config/autostart', '.config/systemd', '.config/environment.d', '.local/bin',
  '.config/zsh', '.zsh', '.zinit', '.local/share/zinit', '.config/direnv', '.config/starship.toml',
  // editors and their plugins, and the browser profiles
  '.vim', '.config/nvim', '.local/share/nvim', '.emacs.d', '.vscode', '.vscode-insiders', '.idea',
  'library/application support/code', 'library/application support/jetbrains',
  'library/application support/google', 'library/application support/firefox', 'library/application support/arc',
  'library/launchagents',
]

// Containers whose children are caches by convention: a tool's cache there
// may hold git clones (Swift Package Manager, CocoaPods specs, pre-commit).
const CACHE_CONTAINERS = ['library/caches', '.cache']

// The home-relative directories under which a tool's own directory is the
// next path component.
const CONTAINERS = [
  ['library', 'caches'], ['library', 'application support'], ['library', 'logs'],
  ['.cache'], ['.config'], ['.local', 'share'], ['.local', 'state'],
]

const lower = (path) => path.toLowerCase()
const within = (child, parent) => lower(child) === lower(parent) || lower(child).startsWith(lower(parent) + sep)

// The path with its longest existing prefix resolved to the on-disk spelling,
// so neither a symlink nor a different letter case can pass for another path.
function canonical(path) {
  let prefix = path
  while (!existsSync(prefix) && dirname(prefix) !== prefix) prefix = dirname(prefix)
  if (!existsSync(prefix)) return path
  return join(realpathSync.native(prefix), relative(prefix, path))
}

// Paths under the home directory named on the denial lines of a command's
// output, `~/` expanded. A path runs from the home prefix to the next
// separator a tool puts after it (": ", a quote, a closing bracket, " (" or
// the end of the line), so a directory name with a space survives.
export function deniedPaths(output, home) {
  const prefixes = [...new Set([home, existsSync(home) ? realpathSync.native(home) : home])].map((h) => h + '/')
  const paths = []
  for (const line of String(output ?? '').split(/\r?\n/)) {
    if (!DENIAL.test(line)) continue
    for (const prefix of [...prefixes, '~/']) {
      const haystack = prefix === '~/' ? line : lower(line)
      const needle = prefix === '~/' ? prefix : lower(prefix)
      let from = haystack.indexOf(needle)
      while (from !== -1) {
        const rest = line.slice(from + prefix.length)
        const end = rest.search(/: |['"`)\],;]| \(|\s+$/)
        let path = (prefix === '~/' ? home + '/' : prefix) + (end === -1 ? rest : rest.slice(0, end))
        path = path.replace(/[.:]+$/, '')
        if (!paths.includes(path)) paths.push(path)
        from = haystack.indexOf(needle, from + prefix.length)
      }
    }
  }
  return paths
}

// Whether a directory is a git repository or holds one within two levels.
// Best effort: a large cache stops the scan after 5,000 entries.
function holdsRepository(dir) {
  if (!existsSync(dir)) return false
  const isRepo = (d) => existsSync(join(d, '.git'))
    || (existsSync(join(d, 'HEAD')) && existsSync(join(d, 'objects')) && existsSync(join(d, 'refs')))
  let level = [dir], seen = 0
  for (let depth = 0; depth <= 2 && level.length > 0; depth++) {
    const next = []
    for (const d of level) {
      if (isRepo(d)) return true
      let entries = []
      try { entries = readdirSync(d, { withFileTypes: true }) } catch { continue }
      for (const entry of entries) {
        if (++seen > 5000) return false
        if (entry.isDirectory() && !entry.isSymbolicLink()) next.push(join(d, entry.name))
      }
    }
    level = next
  }
  return false
}

// The directories a grant may not contain because programs run from them
// outside the sandbox: every PATH directory (with a leading `~` expanded, as
// a shell does) and the directories its programs link to.
export function programDirs(pathDirs, home = homedir()) {
  const dirs = new Set()
  for (const raw of pathDirs) {
    if (!raw) continue
    const dir = raw === '~' ? home : raw.startsWith('~/') ? join(home, raw.slice(2)) : raw
    dirs.add(dir)
    let entries = []
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { continue }
    for (const entry of entries.slice(0, 2000)) {
      if (!entry.isSymbolicLink()) continue
      try { dirs.add(dirname(realpathSync.native(join(dir, entry.name)))) } catch { /* dangling link */ }
    }
  }
  return [...dirs]
}

// The directory to open for a denied path, or the reason it is refused.
// `excluded` are paths a grant may neither contain nor lie in (the
// repository, the run directory); `pathDirs` are the directories of PATH and
// of the runner's own programs, which a grant may not contain.
export function grantFor(path, { home, excluded = [], pathDirs = [] }) {
  const homeReal = realpathSync.native(home)
  const target = canonical(path)
  if (!within(target, homeReal) || lower(target) === lower(homeReal)) return { refused: 'outside the home directory' }
  const segments = relative(homeReal, target).split(sep).filter(Boolean)
  if (segments.some((segment) => segment === '..')) return { refused: 'outside the home directory' }
  if (segments.some((segment) => lower(segment) === '.git')) return { refused: 'a git directory' }
  let depth = 0
  for (const container of CONTAINERS) {
    if (container.every((part, index) => lower(segments[index] ?? '') === part)) { depth = container.length; break }
  }
  if (depth === 0 && !segments[0].startsWith('.')) return { refused: 'not a tool directory' }
  if (segments.length <= depth) return { refused: 'a shared container, not a tool directory' }
  const relParts = segments.slice(0, depth + 1)
  const rel = relParts.join('/')
  const dir = join(homeReal, ...relParts)
  if (PROTECTED.some((p) => lower(rel) === p || lower(rel).startsWith(p + '/') || p.startsWith(lower(rel) + '/'))) {
    return { refused: 'holds keys, tokens, agent or shell configuration' }
  }
  for (const other of excluded.map(canonical)) {
    if (within(other, dir) || within(dir, other)) return { refused: 'contains or is inside the repository or the run' }
  }
  if (pathDirs.map(canonical).some((p) => within(p, dir))) return { refused: 'holds programs on PATH' }
  if (existsSync(dir) && (lstatSync(dir).isSymbolicLink() || !statSync(dir).isDirectory())) {
    return { refused: 'not a directory' }
  }
  const inCache = CACHE_CONTAINERS.some((container) => lower(relParts.slice(0, -1).join('/')) === container)
  if (!inCache && holdsRepository(dir)) return { refused: 'a git repository or holds one' }
  return { dir, rel: '~/' + rel }
}

// The command an executor names on the line after its `environment-blocked:`
// marker, or null. Only the first five lines of the report are read.
export function reportBlockedCommand(report) {
  const lines = String(report ?? '').split(/\r?\n/).filter((line) => line.trim() !== '').slice(0, 5)
  for (const raw of lines) {
    // The whole line may be wrapped in backticks, or only the command.
    let line = raw.trim()
    const wrapped = line.startsWith('`blocked-command:') && line.endsWith('`')
    if (wrapped) line = line.slice(1, -1)
    const m = /^blocked-command:[ \t]*(.*)$/.exec(line)
    if (!m) continue
    let cmd = m[1].trim()
    if (cmd.length > 2 && cmd.startsWith('`') && cmd.endsWith('`')) cmd = cmd.slice(1, -1).trim()
    if (cmd === '' || cmd.startsWith('<') || cmd.includes('`') || /[\x00-\x1f\x7f]/.test(cmd) || cmd.length > 2000) return null
    return cmd
  }
  return null
}

// Grants for one command's sandboxed output: the directories to open now and
// what was refused. A missing directory is created under an existing parent
// only when `create` is set: in the preflight, whose output comes from the
// base commit, never at executor time.
export function grantsFromOutput(output, { home, excluded = [], pathDirs = [], writable, create = false }) {
  const granted = [], refused = []
  const open = writable.map((dir) => lower(canonical(dir)))
  for (const path of deniedPaths(output, home)) {
    const grant = grantFor(path, { home, excluded, pathDirs })
    if (grant.refused) { refused.push({ path, reason: grant.refused }); continue }
    if (open.includes(lower(grant.dir)) || granted.some((g) => lower(g.dir) === lower(grant.dir))) continue
    if (!existsSync(grant.dir)) {
      // Created only under an existing parent, and only for a plain name.
      if (!create || !existsSync(dirname(grant.dir)) || /\s/.test(grant.rel)) {
        refused.push({ path, reason: 'does not exist' }); continue
      }
      mkdirSync(grant.dir)
    }
    granted.push(grant)
  }
  return { granted, refused }
}

// The environment for a reproduction: the runner's, without the variables a
// Codex shell leaves out by default (names holding KEY, SECRET or TOKEN).
export function reproductionEnv(env = process.env) {
  return Object.fromEntries(Object.entries(env).filter(([name]) => !/KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL/i.test(name)))
}
