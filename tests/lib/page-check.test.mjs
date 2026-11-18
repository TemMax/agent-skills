// The visuals page validator: each rule against a small page that breaks only
// that rule, and the shipped templates as the passing cases. Fixture pages are
// written to a temporary directory at run time, so the fake secrets below are
// assembled from parts and never stored in the repository.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { closeSync, copyFileSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync, ftruncateSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkPage } from '../../plugins/visuals/skills/visual-explanation/references/page-check.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const CHECK = join(ROOT, 'plugins/visuals/skills/visual-explanation/references/page-check.mjs')
const EXPLANATION_TEMPLATE = join(ROOT, 'plugins/visuals/skills/visual-explanation/assets/explanation.html')
const DEMO_TEMPLATE = join(ROOT, 'plugins/visuals/skills/visual-demo/assets/demo.html')
const MEDIA = join(ROOT, 'plugins/visuals/skills/visual-demo/assets/media')

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4c50000000049454e44ae426082', 'hex')

function explanation({ head = '', body = '' } = {}) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>t</title>
<style>:root{--v-fg:var(--foreground,#111)} body{color:var(--v-fg)}</style>${head}</head><body><main>
<section data-section="verdict"><h1>The answer</h1><p>Two lines of verdict.</p></section>
<section data-section="picture"><figure><svg width="10" height="10"></svg><figcaption>The flow</figcaption></figure></section>
${body}
</main></body></html>`
}

function demo({ head = '', states, body = '' } = {}) {
  const gallery = states ?? '<figure><img src="media/a.png" alt="State A"><figcaption>A</figcaption></figure>'
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>t</title>${head}</head><body><main>
<section data-section="verdict"><p>It works.</p></section>
<section data-section="not-verified"><ul><li>Dark theme</li></ul></section>
<section data-section="method"><p>Emulator, devDebug, animations at 1.</p></section>
<section data-section="states">${gallery}</section>
${body}
</main></body></html>`
}

function page(t, html, { media = { 'media/a.png': PNG } } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'page-check-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  for (const [rel, content] of Object.entries(media)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true })
    writeFileSync(join(dir, rel), content)
  }
  const file = join(dir, 'index.html')
  writeFileSync(file, html)
  return { dir, file }
}

function rules(result) { return result.errors.map((e) => e.rule) }

function warnsOnly(t, html, kind, rule, options) {
  const { file } = page(t, html, options)
  const result = checkPage(file, kind)
  assert.deepEqual(result.errors, [], JSON.stringify(result.errors))
  assert.ok(result.warnings.length > 0, `expected ${rule} to warn`)
  assert.deepEqual([...new Set(result.warnings.map((w) => w.rule))], [rule], JSON.stringify(result.warnings))
  return result
}

function clean(t, html, kind, options) {
  const result = checkPage(page(t, html, options).file, kind)
  assert.deepEqual(result, { errors: [], warnings: [] })
}

function failsOnly(t, html, kind, rule, options) {
  const { file } = page(t, html, options)
  const result = checkPage(file, kind)
  assert.ok(result.errors.length > 0, `expected ${rule} to fail`)
  assert.deepEqual([...new Set(rules(result))], [rule], JSON.stringify(result.errors))
  return result
}

function cli(...args) {
  return spawnSync(process.execPath, [CHECK, ...args], { encoding: 'utf8' })
}

test('the shipped templates pass their own kind', () => {
  for (const [file, kind] of [[EXPLANATION_TEMPLATE, 'explanation'], [DEMO_TEMPLATE, 'demo']]) {
    const r = cli(file, '--kind', kind)
    assert.equal(r.status, 0, r.stdout + r.stderr)
    assert.match(r.stdout, new RegExp(`^OK ${kind}: `, 'm'))
    assert.doesNotMatch(r.stdout, /^(FAIL|WARN) /m)
  }
})

test('minimal fixture pages pass, so each failing fixture fails for its own rule', (t) => {
  assert.deepEqual(checkPage(page(t, explanation()).file, 'explanation'), { errors: [], warnings: [] })
  assert.deepEqual(checkPage(page(t, demo()).file, 'demo'), { errors: [], warnings: [] })
})

test('the demo template copied without its media fails until real captures replace the placeholders', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'page-check-copy-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  copyFileSync(DEMO_TEMPLATE, join(dir, 'index.html'))
  const result = checkPage(join(dir, 'index.html'), 'demo')
  assert.ok(result.errors.some((e) => e.rule === 'local-media'))
  assert.ok(result.errors.every((e) => e.rule === 'local-media' || e.rule === 'placeholder-media'), JSON.stringify(result.errors))
})

test('the demo template copied with its placeholder media still fails, on the placeholders alone', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'page-check-copy-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  copyFileSync(DEMO_TEMPLATE, join(dir, 'index.html'))
  mkdirSync(join(dir, 'media'))
  for (const name of ['placeholder-screen.svg', 'placeholder-design.svg', 'placeholder-frame.svg', 'placeholder-motion.mp4']) {
    copyFileSync(join(MEDIA, name), join(dir, 'media', name))
  }
  const result = checkPage(join(dir, 'index.html'), 'demo')
  assert.ok(result.errors.length > 0)
  assert.deepEqual([...new Set(rules(result))], ['placeholder-media'], JSON.stringify(result.errors))
})

test('file: a missing page or a page that is not HTML fails', (t) => {
  const missing = checkPage(join(tmpdir(), 'page-check-no-such-dir', 'index.html'), 'explanation')
  assert.deepEqual(rules(missing), ['file'])
  const { dir } = page(t, explanation())
  writeFileSync(join(dir, 'index.md'), '# not html')
  assert.deepEqual(rules(checkPage(join(dir, 'index.md'), 'explanation')), ['file'])
})

test('external-resource: network loads fail, ordinary links do not', (t) => {
  failsOnly(t, explanation({ body: '<img src="https://example.com/x.png" alt="x">' }), 'explanation', 'external-resource')
  failsOnly(t, explanation({ body: '<img src="//cdn.example.com/x.png" alt="x">' }), 'explanation', 'external-resource')
  failsOnly(t, explanation({ head: '<link rel="stylesheet" href="https://fonts.example.com/a.css">' }), 'explanation', 'external-resource')
  failsOnly(t, explanation({ head: '<link rel="stylesheet" href="local.css">' }), 'explanation', 'external-resource')
  failsOnly(t, explanation({ head: '<style>@import "other.css";</style>' }), 'explanation', 'external-resource')
  failsOnly(t, explanation({ head: '<style>main{background:url(https://example.com/bg.png)}</style>' }), 'explanation', 'external-resource')
  failsOnly(t, explanation({ body: '<script>fetch("data.json").then(r => r.json())</script>' }), 'explanation', 'external-resource')
  failsOnly(t, explanation({ body: '<script src="https://cdn.example.com/lib.js"></script>' }), 'explanation', 'external-resource')
  const links = explanation({ body: '<section data-section="sources"><a href="https://example.com/doc">doc</a><a href="//example.com/x">x</a></section><pre>fetch("x") in prose is fine</pre>' })
  assert.deepEqual(checkPage(page(t, links).file, 'explanation').errors, [])
})

test('local-media: a missing, empty, absolute or outside reference fails', (t) => {
  failsOnly(t, demo({ states: '<figure><img src="media/missing.png" alt="x"><figcaption>x</figcaption></figure>' }), 'demo', 'local-media')
  failsOnly(t, demo(), 'demo', 'local-media', { media: { 'media/a.png': '' } })
  failsOnly(t, demo({ states: '<figure><video controls src="media/a.png" poster="media/poster.png"></video><figcaption>x</figcaption></figure>' }), 'demo', 'local-media')
  failsOnly(t, demo({ states: '<figure><img src="/tmp/a.png" alt="x"><figcaption>x</figcaption></figure>' }), 'demo', 'local-media')
  failsOnly(t, demo({ states: '<figure><img src="../a.png" alt="x"><figcaption>x</figcaption></figure>' }), 'demo', 'local-media')
  const ok = demo({ states: '<figure><img src="media/a.png?v=1#frame" alt="x"><img src="data:image/png;base64,AAAA" alt="y"><figcaption>x</figcaption></figure>' })
  assert.deepEqual(checkPage(page(t, ok).file, 'demo').errors, [])
})

test('section-missing: every required section of the kind must be present', (t) => {
  const noPicture = explanation().replace('data-section="picture"', 'data-section="other"')
  const result = failsOnly(t, noPicture, 'explanation', 'section-missing')
  assert.match(result.errors[0].what, /"picture"/)
  for (const name of ['not-verified', 'method', 'states']) {
    const html = demo().replace(`data-section="${name}"`, 'data-section="x"')
    const r = checkPage(page(t, html).file, 'demo')
    assert.ok(r.errors.some((e) => e.rule === 'section-missing' && e.what.includes(`"${name}"`)), name)
  }
})

test('verdict-empty: a verdict with no text fails', (t) => {
  failsOnly(t, explanation().replace('<h1>The answer</h1><p>Two lines of verdict.</p>', '<p> &nbsp; <!-- todo --> </p>'), 'explanation', 'verdict-empty')
})

test('figure-caption: a figure without figcaption fails', (t) => {
  failsOnly(t, explanation({ body: '<figure><svg></svg></figure>' }), 'explanation', 'figure-caption')
})

test('img-alt: an image without alt text fails', (t) => {
  failsOnly(t, demo({ states: '<figure><img src="media/a.png"><figcaption>x</figcaption></figure>' }), 'demo', 'img-alt')
  failsOnly(t, demo({ states: '<figure><img src="media/a.png" alt=" "><figcaption>x</figcaption></figure>' }), 'demo', 'img-alt')
})

test('video-controls: a video without controls fails', (t) => {
  failsOnly(t, demo({ states: '<figure><video src="media/a.png" autoplay></video><figcaption>x</figcaption></figure>' }), 'demo', 'video-controls')
})

test('states-media: a demo states section with no image or video fails', (t) => {
  failsOnly(t, demo({ states: '<p>It looked right.</p>' }), 'demo', 'states-media')
  assert.deepEqual(checkPage(page(t, demo({ states: '<figure><video controls src="media/a.png"></video><figcaption>v</figcaption></figure>' })).file, 'demo').errors, [])
})

test('viewport-height: vh units and height:100% on html or body fail', (t) => {
  failsOnly(t, explanation({ head: '<style>.hero{min-height:80vh}</style>' }), 'explanation', 'viewport-height')
  failsOnly(t, explanation({ head: '<style>html, body { height: 100% }</style>' }), 'explanation', 'viewport-height')
  failsOnly(t, explanation({ head: '<style>@media (min-width:1px){ body{min-height:100%} }</style>' }), 'explanation', 'viewport-height')
  failsOnly(t, explanation({ body: '<div style="height:50dvh">x</div>' }), 'explanation', 'viewport-height')
  const fine = explanation({ head: '<style>.chart{height:240px} .box{height:100%}</style>' })
  assert.deepEqual(checkPage(page(t, fine).file, 'explanation').errors, [])
})

test('secret: text that looks like a token or a private key fails, and the token is never printed', (t) => {
  const samples = [
    'gh' + 'p_' + 'A1b2C3d4'.repeat(5),
    'github' + '_pat_' + '11ABCDEFG0'.repeat(3),
    's' + 'k-proj-' + 'abcDEF123_'.repeat(3),
    'xo' + 'xb-' + '1234567890-abcdefghij',
    'AK' + 'IA' + 'ABCDEFGHIJKLMNOP',
    '-----BEGIN ' + 'OPENSSH PRIVATE KEY-----',
  ]
  for (const secret of samples) {
    const { file } = page(t, explanation({ body: `<pre>${secret}</pre>` }))
    const result = checkPage(file, 'explanation')
    assert.deepEqual(rules(result), ['secret'], secret.slice(0, 6))
    const r = cli(file, '--kind', 'explanation')
    assert.equal(r.status, 1)
    assert.ok(!r.stdout.includes(secret), 'the secret itself must not be printed')
  }
})

test('ascii-diagram: a box drawing in <pre> fails, ordinary code does not', (t) => {
  const box = ['+--------+     +------+', '| client | --> | api  |', '+--------+     +------+'].join('\n')
  failsOnly(t, explanation({ body: `<pre>${box}</pre>` }), 'explanation', 'ascii-diagram')
  const tree = ['app', '├── src', '│   └── main.kt', '└── build.gradle'].join('\n')
  failsOnly(t, explanation({ body: `<pre><code>${tree}</code></pre>` }), 'explanation', 'ascii-diagram')
  const code = ['const total = a - b + c', 'if (x || y) {', '  return total', '}', '$ ./gradlew test', 'BUILD SUCCESSFUL in 3s'].join('\n')
  assert.deepEqual(checkPage(page(t, explanation({ body: `<pre>${code}</pre>` })).file, 'explanation').errors, [])
})

test('size: a page with its media over 25 MB warns without failing', (t) => {
  const { dir, file } = page(t, demo({ states: '<figure><video controls src="media/big.mp4"></video><figcaption>v</figcaption></figure>' }), { media: {} })
  mkdirSync(join(dir, 'media'))
  const fd = openSync(join(dir, 'media/big.mp4'), 'w')
  ftruncateSync(fd, 26 * 1024 * 1024)
  closeSync(fd)
  const result = checkPage(file, 'demo')
  assert.deepEqual(result.errors, [])
  assert.deepEqual(result.warnings.map((w) => w.rule), ['size'])
  const r = cli(file, '--kind', 'demo')
  assert.equal(r.status, 0)
  assert.match(r.stdout, /^WARN size /m)
})

test('warnings: section order, unknown sections and a background on html or body do not fail', (t) => {
  const swapped = explanation({ body: '<section data-section="sources"><p>s</p></section><section data-section="options"><p>o</p></section><section data-section="extra"><p>e</p></section>' })
  const r1 = checkPage(page(t, swapped).file, 'explanation')
  assert.deepEqual(r1.errors, [])
  assert.deepEqual(r1.warnings.map((w) => w.rule).sort(), ['section-order', 'section-unknown'])
  const bg = checkPage(page(t, explanation({ head: '<style>body{background:#fff}</style>' })).file, 'explanation')
  assert.deepEqual(bg.errors, [])
  assert.deepEqual(bg.warnings.map((w) => w.rule), ['frame-background'])
})

test('command line: usage errors exit 2, failures exit 1 with one line per problem', (t) => {
  assert.equal(cli().status, 2)
  assert.equal(cli(EXPLANATION_TEMPLATE).status, 2)
  assert.equal(cli(EXPLANATION_TEMPLATE, '--kind', 'poster').status, 1)
  const { file } = page(t, explanation({ body: '<figure><img src="media/none.png"></figure>' }), { media: {} })
  const r = cli(file, '--kind=explanation')
  assert.equal(r.status, 1)
  const lines = r.stdout.trim().split('\n')
  assert.deepEqual(lines.map((l) => l.split(' ')[1]).sort(), ['figure-caption', 'img-alt', 'local-media'])
  assert.ok(lines.every((l) => l.startsWith('FAIL ')))
})

test('placeholder-media: a template placeholder, by name or by its bytes, fails in states and motion', (t) => {
  const named = demo({ states: '<figure><img src="media/placeholder-screen.png" alt="x"><figcaption>x</figcaption></figure>' })
  failsOnly(t, named, 'demo', 'placeholder-media', { media: { 'media/a.png': PNG, 'media/placeholder-screen.png': PNG } })
  const motion = readFileSync(join(MEDIA, 'placeholder-motion.mp4'))
  const copied = demo({ states: '<figure><video controls src="media/a.mp4"></video><figcaption>x</figcaption></figure>' })
  failsOnly(t, copied, 'demo', 'placeholder-media', { media: { 'media/a.mp4': motion } })
  const poster = demo({ body: '<section data-section="motion"><figure><video controls src="media/a.png" poster="media/placeholder-poster.png"></video><figcaption>m</figcaption></figure></section>' })
  failsOnly(t, poster, 'demo', 'placeholder-media', { media: { 'media/a.png': PNG, 'media/placeholder-poster.png': PNG } })
  clean(t, demo(), 'demo')
})

test('external-resource: an SVG image or use that points to the network fails', (t) => {
  failsOnly(t, explanation({ body: '<figure><svg width="10" height="10"><image href="https://example.com/x.png" width="10" height="10"/></svg><figcaption>x</figcaption></figure>' }), 'explanation', 'external-resource')
  failsOnly(t, explanation({ body: '<figure><svg width="10" height="10"><image xlink:href="//cdn.example.com/x.png"/></svg><figcaption>x</figcaption></figure>' }), 'explanation', 'external-resource')
  clean(t, explanation({ body: '<figure><svg width="10" height="10"><use href="#dot"/></svg><figcaption>x</figcaption></figure>' }), 'explanation')
})

test('external-resource: a network address assigned from a script fails, a link target does not', (t) => {
  failsOnly(t, explanation({ body: '<script>new Image().src = "https://example.com/t.gif"</script>' }), 'explanation', 'external-resource')
  failsOnly(t, explanation({ body: `<script>document.body.insertAdjacentHTML('beforeend', '<img src=https://example.com/a.png alt=a>')</script>` }), 'explanation', 'external-resource')
  const links = `<script>
    document.querySelector('a').href = 'https://example.com/doc'
    document.querySelector('button').onclick = () => window.open('https://example.com/page')
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    const html = '<a href="https://example.com/x">x</a>'
  </script>`
  clean(t, explanation({ body: links }), 'explanation')
})

test('viewport-height: a vh unit set from a script or an inline style fails', (t) => {
  failsOnly(t, explanation({ body: '<script>document.body.style.minHeight = "100vh"</script>' }), 'explanation', 'viewport-height')
  failsOnly(t, explanation({ body: '<script>el.style.setProperty(`height`, `calc(50svh - 10px)`)</script>' }), 'explanation', 'viewport-height')
  failsOnly(t, explanation({ body: '<div style="min-height:100vh">x</div>' }), 'explanation', 'viewport-height')
  clean(t, explanation({ body: '<script>const via = "vhs"; el.style.height = "240px"</script>' }), 'explanation')
})

test('ascii-diagram: a box drawing in an element styled white-space:pre fails', (t) => {
  const box = ['+-------+     +-------+', '| fetch | --&gt; | store |', '+-------+     +-------+'].join('\n')
  failsOnly(t, explanation({ body: `<div style="white-space:pre;font-family:monospace">${box}</div>` }), 'explanation', 'ascii-diagram')
  failsOnly(t, explanation({ head: '<style>.art { white-space: pre-wrap }</style>', body: `<p class="note art">${box}</p>` }), 'explanation', 'ascii-diagram')
  clean(t, explanation({ body: '<div style="white-space:pre-wrap">Line one\nLine two - with a dash\nLine three</div>' }), 'explanation')
})

test('state-capture: a drawn state (SVG file, data: URI or inline svg) warns without failing', (t) => {
  warnsOnly(t, demo({ states: '<figure><img src="media/screen.svg" alt="x"><figcaption>x</figcaption></figure>' }), 'demo', 'state-capture', { media: { 'media/screen.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>' } })
  warnsOnly(t, demo({ states: '<figure><img src="data:image/png;base64,AAAA" alt="x"><figcaption>x</figcaption></figure>' }), 'demo', 'state-capture')
  warnsOnly(t, demo({ states: '<figure><img src="media/a.png" alt="x"><svg width="10" height="10"></svg><figcaption>x</figcaption></figure>' }), 'demo', 'state-capture')
  clean(t, explanation({ body: '<figure><img src="data:image/png;base64,AAAA" alt="x"><figcaption>x</figcaption></figure>' }), 'explanation')
})

test('personal-data: a phone number or a password or PIN with its value warns without failing', (t) => {
  const r = warnsOnly(t, explanation({ body: '<p>Call +44 7700 900123.</p>' }), 'explanation', 'personal-data')
  assert.ok(!r.warnings.some((w) => w.what.includes('7700')), 'the number itself must not be printed')
  warnsOnly(t, explanation({ body: '<p>Signed in with password hunter2.</p>' }), 'explanation', 'personal-data')
  warnsOnly(t, explanation({ body: '<p>Unlock with PIN 1337.</p>' }), 'explanation', 'personal-data')
  warnsOnly(t, explanation({ body: '<p>Пароль: qwerty</p>' }), 'explanation', 'personal-data')
  clean(t, explanation({ body: '<p>The password field is masked; version 1.2.3 shipped 2026-11-18 14:05; +3 more; PIN entry screen.</p>' }), 'explanation')
})
