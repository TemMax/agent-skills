// Build outputs and tool caches shared by a wave's checkouts, so a task is
// built once instead of once per checkout, in any ecosystem.
//
// A checkout's build outputs are the directories git ignores in it whose
// name is a build tool's output directory — `target` for Cargo, `build` and
// `.gradle` for Gradle, `node_modules` and `dist` for Node, `.build` for
// SwiftPM — at any depth. Other ignored directories (logs, data, agent and
// editor state) are left alone, and so is an output that names its own
// checkout by absolute path: a Python virtual environment, a CMake or Meson
// build directory. A new checkout starts from a copy-on-write clone of the
// repository checkout's outputs, which costs no space until a build changes
// it; with `worktree.share_builds: "executor"` a task's verification and
// review checkouts link to its executor's outputs instead. Where the two
// checkouts are on different volumes or the file system has no clones,
// nothing is copied.
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, lstatSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, sep } from 'node:path'
import { excludeFromGit } from './worktree-env.mjs'

const covers = (a, b) => a === b || a.startsWith(b + '/') || b.startsWith(a + '/')

// Output directory names of build tools.
const OUTPUT_NAMES = new Set([
  'target', 'build', 'out', 'dist', 'obj', 'node_modules', '.gradle', '.kotlin', '.next', '.nuxt', '.turbo',
  '.parcel-cache', '.angular', '.svelte-kit', '.build', 'DerivedData', 'Pods', '.dart_tool', '_build',
  '.zig-cache', 'zig-cache', 'zig-out', '.stack-work', 'dist-newstyle', '.mypy_cache', '.pytest_cache',
  '.ruff_cache', '.tox', '.nox',
])
const isOutputName = (name) => OUTPUT_NAMES.has(name) || name.startsWith('cmake-build-')

// Files that record their own directory's absolute path: a clone would keep
// pointing at the repository checkout.
const PINNED = new Set(['pyvenv.cfg', 'CMakeCache.txt', 'meson-private'])

// Whether a directory, or a directory directly in it, holds such a file.
function pinsItsPath(dir) {
  let entries = []
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return false }
  if (entries.some((entry) => PINNED.has(entry.name))) return true
  return entries.filter((entry) => entry.isDirectory()).slice(0, 200).some((entry) => {
    try { return readdirSync(join(dir, entry.name)).some((name) => PINNED.has(name)) } catch { return false }
  })
}

// The build-output directories of a checkout, repository-relative, outermost
// only; `.git`, `.worktrees` and the paths in `skip` (linked files) left out.
export function buildDirs(checkout, { skip = [] } = {}) {
  const r = spawnSync('git', ['-C', checkout, 'ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '-z'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 60000 })
  if (r.status !== 0) return []
  const dirs = r.stdout.split('\0').filter((entry) => entry.endsWith('/')).map((entry) => entry.slice(0, -1))
    .filter((rel) => rel !== '' && !rel.split('/').some((part) => part === '.git' || part === '..')
      && rel.split('/')[0] !== '.worktrees' && !skip.some((s) => covers(rel, s))
      && isOutputName(rel.split('/').at(-1)))
    .filter((rel) => { try { return !lstatSync(join(checkout, rel)).isSymbolicLink() } catch { return false } })
    .filter((rel) => !pinsItsPath(join(checkout, rel)))
  return dirs.filter((rel) => !dirs.some((other) => other !== rel && rel.startsWith(other + '/')))
}

// The build directories of `from` that `to` can take: present in `from`,
// absent in `to`, both resolving inside their own checkout (a committed
// symlink cannot carry a directory elsewhere).
function candidates(from, to, skip) {
  const inside = (path, root) => {
    try {
      const real = realpathSync.native(path), base = realpathSync.native(root)
      return real === base || real.startsWith(base + sep)
    } catch { return false }
  }
  return buildDirs(from, { skip }).filter((rel) => {
    try { lstatSync(join(to, rel)); return false } catch { /* absent: may take it */ }
    const parent = join(to, dirname(rel))
    return inside(join(from, rel), from) && inside(parent, to) && statSync(parent, { throwIfNoEntry: false })?.isDirectory() === true
  })
}

// Links each build directory of `from` into `to`, so a task's later checkouts
// reuse the build its executor made. Git is told to ignore the links, which
// the project's .gitignore may match only as directories.
export function shareBuildDirs(from, to, { repo, skip = [] }) {
  const dirs = candidates(from, to, skip)
  for (const rel of dirs) symlinkSync(join(from, rel), join(to, rel))
  if (dirs.length > 0) excludeFromGit(repo, dirs.map((rel) => '/' + rel))
  return dirs
}

// The file system type of the volume holding a path ("apfs", "btrfs"...).
function fsType(path) {
  if (process.platform === 'darwin') {
    const df = spawnSync('df', ['-P', path], { encoding: 'utf8', timeout: 10000 })
    const mountPoint = df.status === 0 ? df.stdout.trim().split('\n').at(-1).split(/\s+/).slice(5).join(' ') : ''
    const mounts = spawnSync('mount', [], { encoding: 'utf8', timeout: 10000 }).stdout || ''
    const line = mounts.split('\n').find((l) => l.includes(' on ' + mountPoint + ' ('))
    return /\(([^,)]+)/.exec(line ?? '')?.[1] ?? ''
  }
  const r = spawnSync('stat', ['-f', '-c', '%T', path], { encoding: 'utf8', timeout: 10000 })
  return r.status === 0 ? r.stdout.trim() : ''
}

// File systems whose copies can share blocks.
const CLONING = { darwin: ['apfs'], linux: ['btrfs', 'xfs', 'zfs'] }

// Whether `source` can be cloned into `targetDir`: one volume, and a file
// system with clones. `cp -c` on macOS copies in full when it cannot clone,
// so it never runs without this check.
function canClone(source, targetDir) {
  try { if (statSync(source).dev !== statSync(targetDir).dev) return false } catch { return false }
  return (CLONING[process.platform] ?? []).includes(fsType(targetDir))
}

// On APFS `cp -cR` clones file by file, and each call is a file system
// transaction: a pnpm monorepo's `node_modules` (206,000 entries) took 35 s,
// 31 s of it system time. One clonefile(2) call clones a whole directory in
// one transaction, but holds every rename on the volume until it ends (2 s
// there). So a tree is cloned in subtrees: one call for a directory of at
// most CHUNK entries, or one whose own files number CHUNK / 4 or more and
// whose tree stays under 10 × CHUNK (an icon set of 12,000 files); a larger
// directory is made anew, writable until its entries are in, and its
// entries taken one by one. Measured there: 3.0 s, 2.4 s of system time, renames
// elsewhere waiting at most 190 ms. Files and link targets come out as
// `cp -cR` makes them; a directory cloned whole keeps its directories'
// modes and its links' times, where `cp -cR` applies the umask and the
// current time.
// JavaScript for Automation ships with macOS and makes the calls; a tree
// with a socket, FIFO or device, an unreadable directory or a failed call
// goes to `cp -cR`.
const CHUNK = 2000
const CLONE_STEPS = `ObjC.import('Foundation')
ObjC.bindFunction('clonefile', ['int', ['char *', 'char *', 'unsigned int']])
ObjC.bindFunction('mkdir', ['int', ['char *', 'unsigned short']])
ObjC.bindFunction('chmod', ['int', ['char *', 'unsigned short']])
function run(argv) {
  const data = $.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile
  const steps = JSON.parse($.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding).js)
  for (const [kind, rel, mode] of steps) {
    const source = rel ? argv[0] + '/' + rel : argv[0], target = rel ? argv[1] + '/' + rel : argv[1]
    const r = kind === 'mkdir' ? $.mkdir(target, mode) : kind === 'chmod' ? $.chmod(target, mode) : $.clonefile(source, target, 1)
    if (r !== 0) return 'failed'
  }
  return 'ok'
}`

// Entry counts of a tree; throws on an entry a clone would not copy as
// `cp -cR` does, or a directory it cannot read.
function scanTree(dir) {
  const node = { size: 0, files: 0, entries: [] }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const child = scanTree(join(dir, entry.name))
      node.size += child.size + 1
      node.entries.push([entry.name, child])
    } else if (entry.isFile() || entry.isSymbolicLink()) {
      node.size += 1; node.files += 1
      node.entries.push([entry.name, null])
    } else throw new Error('special file: ' + join(dir, entry.name))
  }
  return node
}

// The steps that clone a tree: directories made anew get the mode
// `cp -cR` gives them (the source's, less the umask) once their entries are
// in, deepest first.
function cloneSteps(node, source, rel, steps, modes, umask) {
  if (node.size + 1 <= CHUNK || (node.files >= CHUNK / 4 && node.size < 10 * CHUNK)) { steps.push(['clone', rel]); return }
  const mode = statSync(join(source, rel)).mode & 0o777 & ~umask
  steps.push(['mkdir', rel, mode | 0o700])
  if ((mode | 0o700) !== mode) modes.push(['chmod', rel, mode])
  for (const [name, child] of node.entries) {
    const path = rel ? rel + '/' + name : name
    if (child) cloneSteps(child, source, path, steps, modes, umask)
    else steps.push(['clone', path])
  }
}

function cloneTree(source, target) {
  let steps
  try {
    const modes = [], umask = process.umask()
    steps = []
    cloneSteps(scanTree(source), source, '', steps, modes, umask)
    steps.push(...modes.reverse())
  } catch { return false }
  const r = spawnSync('osascript', ['-l', 'JavaScript', '-e', CLONE_STEPS, source, target],
    { input: JSON.stringify(steps), encoding: 'utf8', timeout: 10 * 60 * 1000, maxBuffer: 1024 * 1024 })
  return r.status === 0 && r.stdout.trim() === 'ok'
}

// Removes a partial clone, opening its read-only directories first; never
// follows a link out of it.
function removeTree(path) {
  try { rmSync(path, { recursive: true, force: true }); return true } catch { /* a read-only directory in it */ }
  const open = (dir) => {
    try { const s = lstatSync(dir); if (!s.isDirectory()) return; chmodSync(dir, (s.mode & 0o7777) | 0o700) } catch { return }
    let entries = []
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) if (entry.isDirectory()) open(join(dir, entry.name))
  }
  open(path)
  try { rmSync(path, { recursive: true, force: true }); return true } catch { return false }
}

// Clones each build directory of `from` into `to`, copy-on-write, only where
// the volume can clone; the first directory that fails ends the seeding.
export function seedBuildDirs(from, to, { skip = [] } = {}) {
  const cloned = []
  for (const rel of candidates(from, to, skip)) {
    const source = join(from, rel), target = join(to, rel)
    if (!canClone(source, dirname(target))) break
    if (process.platform === 'darwin') {
      if (cloneTree(source, target)) { cloned.push(rel); continue }
      if (!removeTree(target)) break
    }
    const args = process.platform === 'darwin' ? ['-cR', source, target] : ['-R', '--reflink=always', source, target]
    const r = spawnSync('cp', args, { encoding: 'utf8', timeout: 10 * 60 * 1000 })
    if (r.status !== 0) { removeTree(target); break }
    cloned.push(rel)
  }
  return cloned
}

// Where the tools a repository uses keep their caches, asked of the tools
// themselves; only existing directories under the home directory. Each one
// still passes the sandbox-grant rules before it is opened.
const QUERIES = [
  // Toolchains (`~/.rustup`, `~/.konan`) are left out: their programs run
  // outside the sandbox too.
  { marker: 'Cargo.toml', dirs: () => [process.env.CARGO_HOME || join(homedir(), '.cargo')] },
  { marker: 'gradlew', dirs: () => [join(homedir(), '.m2'), join(homedir(), 'Library', 'Application Support', 'kotlin')] },
  { marker: 'pom.xml', dirs: () => [join(homedir(), '.m2')] },
  { marker: 'package.json', cmd: ['npm', 'config', 'get', 'cache'] },
  { marker: 'pnpm-lock.yaml', cmd: ['pnpm', 'store', 'path'] },
  { marker: 'yarn.lock', cmd: ['yarn', 'cache', 'dir'] },
  { marker: 'go.mod', cmd: ['go', 'env', 'GOCACHE', 'GOMODCACHE'] },
  { marker: 'pyproject.toml', cmd: ['python3', '-m', 'pip', 'cache', 'dir'] },
  { marker: 'requirements.txt', cmd: ['python3', '-m', 'pip', 'cache', 'dir'] },
  { marker: 'uv.lock', cmd: ['uv', 'cache', 'dir'] },
  { marker: 'Package.swift', dirs: () => [join(homedir(), 'Library', 'Caches', 'org.swift.swiftpm')] },
  { marker: 'Podfile', dirs: () => [join(homedir(), 'Library', 'Caches', 'CocoaPods'), join(homedir(), '.cocoapods')] },
]

export function toolCacheDirs(repo, env = process.env) {
  const found = new Set()
  for (const query of QUERIES) {
    if (!existsSync(join(repo, query.marker))) continue
    let dirs = query.dirs ? query.dirs() : []
    if (query.cmd) {
      const r = spawnSync(query.cmd[0], query.cmd.slice(1), { cwd: repo, encoding: 'utf8', timeout: 15000, env })
      if (r.status === 0) dirs = r.stdout.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.startsWith('/'))
    }
    for (const dir of dirs) if (existsSync(dir)) found.add(dir)
  }
  return [...found]
}
