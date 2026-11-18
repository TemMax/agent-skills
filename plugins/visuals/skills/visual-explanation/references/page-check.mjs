#!/usr/bin/env node
// page-check.mjs — validate a visuals page against page-standard.md.
//
//   node page-check.mjs <index.html> --kind explanation|demo
//
// Prints one line per problem: `FAIL <rule> <where>: <what>` or
// `WARN <rule> <where>: <what>`, then `OK ...` when nothing failed.
// Exit 0 when nothing failed (warnings allowed), 1 when anything failed,
// 2 on a usage error. Deterministic: no network, no model, no dependencies.
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const SECTIONS = {
  explanation: {
    order: ['verdict', 'picture', 'options', 'questions', 'details', 'sources'],
    required: ['verdict', 'picture'],
  },
  demo: {
    order: ['verdict', 'not-verified', 'method', 'states', 'motion', 'before-after', 'findings', 'questions'],
    required: ['verdict', 'not-verified', 'method', 'states'],
  },
}

export const SIZE_WARN_BYTES = 25 * 1024 * 1024

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr'])
const MEDIA_ATTRS = ['src', 'poster', 'srcset', 'data']
// SVG elements that load an image or a document through href.
const SVG_HREF_TAGS = new Set(['image', 'use', 'feimage'])

const HERE = dirname(fileURLToPath(import.meta.url))
const DEMO_ASSETS = resolve(HERE, '../../visual-demo/assets')
// The shipped templates pass in place, beside their placeholder media; a copy
// of one is a page and gets every rule.
const SHIPPED_TEMPLATES = new Set([resolve(DEMO_ASSETS, 'demo.html'), resolve(HERE, '../assets/explanation.html')])

const PHONE = /\+\d[\d\s().-]{7,18}\d/g
const CREDENTIAL_LABELS = [
  /(?<![\p{L}\p{N}])(?:password|passcode|пароль)\s*(?:[:=—–-]|is|это)\s*\S+/giu,
  /(?<![\p{L}\p{N}])(?:password|passcode|пароль)\s+[^\s<]*\d[^\s<]*/giu,
  // A PIN is 4 to 8 digits on their own; "pin = 3.11" pins a version.
  /(?<![\p{L}\p{N}])(?:pin(?:[\s-]*code)?|пин(?:-код)?)\s*(?:[:=—–-]|is|это)?\s*\d{4,8}(?![.,]?\d)(?![\p{L}_-])/giu,
]

// A network address in a script fails only where the script would load it:
// right after a loading property or call, or inside markup or CSS the script
// writes. A link target (an href, a location, window.open) or plain text
// loads nothing.
const SCRIPT_LOAD_CONTEXT = /(?:\b(?:src|srcset|poster|data)\s*=\s*\\?['"`]?|\bsetAttribute\(\s*['"`](?:src|srcset|poster|data)['"`]\s*,\s*['"`]|\burl\(\s*\\?['"`]?|\b(?:new\s+(?:Shared)?Worker|importScripts)\(\s*['"`])$/i
const SCRIPT_LINK_CONTEXT = /(?:\bhref\s*[=:]\s*\\?['"`]?|\blocation(?:\.href)?\s*=\s*['"`]|\.open\(\s*['"`])$/i
// Loading sinks fed from a variable: an address held elsewhere in the script
// may reach one, which the checker cannot follow.
const SCRIPT_DYNAMIC_LOAD = /\.(?:src|srcset|poster|data)\s*=\s*[^\s'"`=]|\bsetAttribute\(\s*['"`](?:src|srcset|poster|data)['"`]\s*,\s*[^\s'"`]|\bnew\s+(?:Image|(?:Shared)?Worker)\b|\burl\(\s*['"`]?\s*(?:\$\{|['"`]\s*\+)/

// A vh value takes effect only when the script sets it as a style: through
// .style, cssText or setProperty, or in CSS or a style attribute it writes.
const SCRIPT_STYLE_CONTEXT = /(?:\.style(?:\.[\w-]+|\[['"`][\w-]+['"`]\])?|\.cssText)\s*\+?=\s*(?:[^;\n]*\+\s*)?$|\bsetProperty\(\s*['"`][^'"`]*['"`]\s*,\s*(?:[^;\n]*\+\s*)?$/
const CSS_VH_DECLARATION = /(?:^|[;{\s'"])[\w-]+\s*:\s*[^;{}'"]*?(?<![\w-])\d*\.?\d+\s*[dsl]?vh\b|\bstyle\s*=\s*\\?['"][^'"]*?\d\s*[dsl]?vh\b/i
const STRING_LITERAL = /(['"])((?:\\.|(?!\1)[^\\\n])*)\1|`((?:\\.|[^\\`])*)`/g

const SECRETS = [
  ['GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{20,})/],
  ['OpenAI-style key', /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}/],
  ['Slack token', /\bxox[abposr]-[A-Za-z0-9-]{10,}/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}/],
  ['private key', /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/],
]

const NETWORK_APIS = [
  ['fetch()', /\bfetch\s*\(/],
  ['XMLHttpRequest', /\bXMLHttpRequest\b/],
  ['WebSocket', /\bnew\s+WebSocket\b/],
  ['EventSource', /\bnew\s+EventSource\b/],
  ['sendBeacon', /\bsendBeacon\s*\(/],
  ['remote import', /\bimport\s*(?:\(\s*|[^;'"]*?\bfrom\s*)['"](?:[a-z][a-z0-9+.-]*:)?\/\//i],
]

const BOX_CHARS = /[─-▟]/g
const ASCII_CHARS = /[+|\-]/g

function lineAt(text, index) {
  let n = 1
  for (let i = 0; i < index && i < text.length; i++) if (text.charCodeAt(i) === 10) n++
  return n
}

function decode(s) {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/gi, '&')
}

// Blank out comments and the bodies of raw-text elements so that tag scanning
// never reads markup inside them; offsets and line numbers stay unchanged.
function blank(s) { return s.replace(/[^\n]/g, ' ') }

function parse(html) {
  const noComments = html.replace(/<!--[\s\S]*?-->/g, blank)
  const scripts = []
  const styles = []
  const masked = noComments.replace(/(<(script|style)\b[^>]*>)([\s\S]*?)(<\/\2\s*>)/gi, (m, open, name, body, close, offset) => {
    const start = offset + open.length
    ;(name.toLowerCase() === 'script' ? scripts : styles).push({ body, start, open })
    return open + blank(body) + close
  })
  const tags = []
  const tagRe = /<(\/?)([a-zA-Z][\w-]*)((?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*(\/?)>/g
  let m
  while ((m = tagRe.exec(masked))) {
    const attrs = {}
    const attrRe = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g
    let a
    while ((a = attrRe.exec(m[3]))) {
      const name = a[1].toLowerCase()
      if (!(name in attrs)) attrs[name] = decode(a[2] ?? a[3] ?? a[4] ?? '')
    }
    tags.push({ close: m[1] === '/', name: m[2].toLowerCase(), attrs, start: m.index, end: m.index + m[0].length, selfClosing: m[4] === '/' })
  }
  return { html, masked, tags, scripts, styles }
}

// The element opened by tags[i] ends at its matching close tag, or at the
// end of the document when the close tag is missing.
function extent(doc, i) {
  const open = doc.tags[i]
  if (VOID.has(open.name) || open.selfClosing) return { start: open.start, inner: open.end, innerEnd: open.end, end: open.end, last: i }
  let depth = 0
  for (let j = i + 1; j < doc.tags.length; j++) {
    const t = doc.tags[j]
    if (t.name !== open.name || t.selfClosing) continue
    if (!t.close) depth++
    else if (depth === 0) return { start: open.start, inner: open.end, innerEnd: t.start, end: t.end, last: j }
    else depth--
  }
  return { start: open.start, inner: open.end, innerEnd: doc.masked.length, end: doc.masked.length, last: doc.tags.length - 1 }
}

function tagsWithin(doc, ext) {
  return doc.tags.filter((t) => t.start >= ext.inner && t.end <= ext.innerEnd)
}

function textOf(doc, ext) {
  return decode(doc.masked.slice(ext.inner, ext.innerEnd).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
}

function isExternal(url) {
  return /^\s*(?:(?:https?|ftp|wss?):|\/\/)/i.test(url)
}

function urlsOf(name, value) {
  if (name !== 'srcset') return [value]
  return value.split(',').map((part) => part.trim().split(/\s+/)[0]).filter(Boolean)
}

function mediaRefs(t) {
  const refs = []
  for (const name of MEDIA_ATTRS) {
    if (t.attrs[name] === undefined || (name === 'data' && t.name !== 'object')) continue
    for (const url of urlsOf(name, t.attrs[name])) refs.push([name, url])
  }
  if (SVG_HREF_TAGS.has(t.name)) {
    for (const name of ['href', 'xlink:href']) {
      if (t.attrs[name] === undefined || /^\s*#/.test(t.attrs[name])) continue
      refs.push([name, t.attrs[name]])
    }
  }
  return refs
}

let placeholderHashes
function shippedPlaceholders() {
  if (placeholderHashes) return placeholderHashes
  placeholderHashes = new Set()
  const dir = join(DEMO_ASSETS, 'media')
  try {
    for (const name of readdirSync(dir)) {
      if (name.startsWith('placeholder-')) placeholderHashes.add(sha256(readFileSync(join(dir, name))))
    }
  } catch { /* checker copied without the plugin: the name rule still applies */ }
  return placeholderHashes
}

function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex') }

function cssBlocks(doc) {
  const blocks = doc.styles.map((s) => ({ css: s.body, start: s.start }))
  for (const t of doc.tags) if (!t.close && t.attrs.style !== undefined) blocks.push({ css: t.attrs.style, start: t.start, inline: t })
  return blocks
}

function rootSelector(selector) {
  return selector.split(',').some((part) => /^(?:html|body|:root)$/i.test(part.trim()))
}

function cssRules(css) {
  const out = []
  const re = /([^{}]+)\{([^{}]*)\}/g
  let m
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, blank)
  while ((m = re.exec(clean))) out.push({ selector: m[1].trim(), body: m[2], index: m.index })
  return out
}

function diagramLine(line) {
  const visible = line.replace(/\s+/g, '')
  if (visible.length < 3) return false
  const box = (visible.match(BOX_CHARS) || []).length
  if (box >= 2) return true
  const ascii = (visible.match(ASCII_CHARS) || []).length
  if (ascii / visible.length >= 0.5) return true
  return /[+|][-=]{2,}|[-=]{2,}[+|]|-{2,}>|<-{2,}/.test(line) || /^\s*\|.*\|\s*$/.test(line)
}

function localPath(pageDir, url) {
  const clean = url.trim().split('#')[0].split('?')[0]
  if (!clean) return null
  let decoded = clean
  try { decoded = decodeURIComponent(clean) } catch { /* keep the raw path */ }
  return resolve(pageDir, decoded)
}

export function checkPage(file, kind) {
  const errors = []
  const warnings = []
  const fail = (rule, where, what) => errors.push({ rule, where, what })
  const warn = (rule, where, what) => warnings.push({ rule, where, what })

  if (!SECTIONS[kind]) {
    fail('usage', '-', `unknown --kind ${JSON.stringify(kind)}; expected explanation or demo`)
    return { errors, warnings }
  }
  if (!/\.html?$/i.test(extname(file))) {
    fail('file', file, 'the page must be an .html file')
    return { errors, warnings }
  }
  if (!existsSync(file) || !statSync(file).isFile()) {
    fail('file', file, 'no such file')
    return { errors, warnings }
  }
  const html = readFileSync(file, 'utf8')
  const doc = parse(html)
  const pageDir = dirname(resolve(file))
  const at = (index) => `line ${lineAt(html, index)}`
  const opens = doc.tags.filter((t) => !t.close)

  // No network: every resource is inline or a local file next to the page.
  for (const t of opens) {
    for (const [name, url] of mediaRefs(t)) {
      if (isExternal(url)) fail('external-resource', at(t.start), `<${t.name} ${name}> loads ${url.split('?')[0]} from the network`)
    }
    if (t.name === 'link' && t.attrs.href !== undefined) {
      const rel = (t.attrs.rel || '').toLowerCase()
      if (isExternal(t.attrs.href)) fail('external-resource', at(t.start), `<link rel="${rel}"> loads ${t.attrs.href.split('?')[0]} from the network`)
      else if (/\bstylesheet\b/.test(rel)) fail('external-resource', at(t.start), 'a stylesheet must be inline in <style>, not a separate file')
    }
    if (t.name === 'script' && t.attrs.src !== undefined && !isExternal(t.attrs.src)) {
      fail('external-resource', at(t.start), 'a script must be inline, not a separate file')
    }
  }
  for (const block of cssBlocks(doc)) {
    const css = block.css.replace(/\/\*[\s\S]*?\*\//g, blank)
    for (const m of css.matchAll(/@import\b/gi)) fail('external-resource', at(block.start + (block.inline ? 0 : m.index)), '@import pulls in another stylesheet; inline it')
    for (const m of css.matchAll(/url\(\s*(['"]?)([^'")]*)\1\s*\)/gi)) {
      if (isExternal(m[2])) fail('external-resource', at(block.start + (block.inline ? 0 : m.index)), `url() loads ${m[2].split('?')[0]} from the network`)
    }
  }
  for (const s of doc.scripts) {
    for (const [label, re] of NETWORK_APIS) {
      const m = re.exec(s.body)
      if (m) fail('external-resource', at(s.start + m.index), `the script uses ${label}; a page makes no network request`)
    }
    const dynamic = SCRIPT_DYNAMIC_LOAD.test(s.body)
    for (const m of s.body.matchAll(/https?:\/\/[^\s'"`<>)\\]+/gi)) {
      if (/^http:\/\/www\.w3\.org\//i.test(m[0])) continue
      const before = s.body.slice(Math.max(0, m.index - 60), m.index)
      if (SCRIPT_LOAD_CONTEXT.test(before)) {
        fail('external-resource', at(s.start + m.index), `the script loads the network address ${m[0].split('?')[0]}; a page loads nothing from the network`)
      } else if (!SCRIPT_LINK_CONTEXT.test(before) && dynamic) {
        warn('script-address', at(s.start + m.index), `the script holds the network address ${m[0].split('?')[0]} and loads from a variable elsewhere; make sure it only ever becomes a link`)
      }
    }
  }

  // Local media exists, is not empty, and lives in the page's folder.
  const media = new Set()
  for (const t of opens) {
    for (const [name, url] of mediaRefs(t)) {
      if (isExternal(url) || /^\s*(?:data|blob):/i.test(url) || /^\s*#/.test(url)) continue
      if (!url.trim()) { fail('local-media', at(t.start), `<${t.name} ${name}> is empty`); continue }
      if (/^\s*file:/i.test(url) || isAbsolute(url.trim())) {
        fail('local-media', at(t.start), `<${t.name} ${name}="${url}"> must be a path relative to the page`)
        continue
      }
      const path = localPath(pageDir, url)
      if (!path) continue
      if (relative(pageDir, path).startsWith('..')) {
        fail('local-media', at(t.start), `${url} lies outside the page's folder; copy it next to the page`)
        continue
      }
      if (!existsSync(path) || !statSync(path).isFile()) fail('local-media', at(t.start), `${url} does not exist`)
      else if (statSync(path).size === 0) fail('local-media', at(t.start), `${url} is empty`)
      else media.add(path)
    }
  }

  // Sections.
  const spec = SECTIONS[kind]
  const sections = []
  doc.tags.forEach((t, i) => {
    if (!t.close && t.attrs['data-section'] !== undefined) sections.push({ name: t.attrs['data-section'].trim(), index: i, tag: t })
  })
  for (const name of spec.required) {
    if (!sections.some((s) => s.name === name)) fail('section-missing', '-', `no element with data-section="${name}" (required on ${kind} pages)`)
  }
  for (const s of sections) {
    if (!spec.order.includes(s.name)) warn('section-unknown', at(s.tag.start), `data-section="${s.name}" is not a section of ${kind} pages (${spec.order.join(', ')})`)
  }
  const known = sections.filter((s) => spec.order.includes(s.name)).map((s) => s.name)
  const seen = [...new Set(known)]
  const expected = [...seen].sort((a, b) => spec.order.indexOf(a) - spec.order.indexOf(b))
  if (seen.join() !== expected.join()) warn('section-order', '-', `sections appear as ${seen.join(', ')}; the standard order is ${expected.join(', ')}`)

  for (const s of sections.filter((x) => x.name === 'verdict')) {
    if (!textOf(doc, extent(doc, s.index))) fail('verdict-empty', at(s.tag.start), 'the verdict has no text')
  }
  if (kind === 'demo') {
    for (const s of sections.filter((x) => x.name === 'states')) {
      const inner = tagsWithin(doc, extent(doc, s.index))
      if (!inner.some((t) => !t.close && (t.name === 'img' || t.name === 'video'))) fail('states-media', at(s.tag.start), 'the states section shows no <img> or <video>')
    }
    if (!SHIPPED_TEMPLATES.has(resolve(file))) {
      const shipped = shippedPlaceholders()
      for (const s of sections.filter((x) => x.name === 'states' || x.name === 'motion')) {
        for (const t of tagsWithin(doc, extent(doc, s.index))) {
          if (t.close) continue
          for (const [name, url] of mediaRefs(t)) {
            if (isExternal(url) || /^\s*(?:data|blob):/i.test(url)) continue
            const path = localPath(pageDir, url)
            if (!path) continue
            const named = basename(path).startsWith('placeholder-')
            const copied = !named && existsSync(path) && statSync(path).isFile() && shipped.has(sha256(readFileSync(path)))
            if (named || copied) fail('placeholder-media', at(t.start), `<${t.name} ${name}="${url}"> is ${named ? 'a template placeholder' : 'a copy of a template placeholder'}; replace it with a real capture`)
          }
        }
      }
      for (const s of sections.filter((x) => x.name === 'states')) {
        for (const t of tagsWithin(doc, extent(doc, s.index))) {
          if (t.close) continue
          if (t.name === 'svg') { warn('state-capture', at(t.start), 'a state drawn as inline <svg>; a state must be a real capture (a screenshot, a recording or a preview render)'); continue }
          if (!['img', 'source', 'video'].includes(t.name)) continue
          for (const [name, url] of mediaRefs(t)) {
            const drawn = /^\s*data:/i.test(url) ? 'a data: URI' : /\.svg(?:[?#].*)?$/i.test(url.trim()) ? 'an SVG file' : null
            if (drawn) warn('state-capture', at(t.start), `<${t.name} ${name}> shows ${drawn}; a state must be a real capture (a screenshot, a recording or a preview render), with a design export labelled as the reference`)
          }
        }
      }
    }
  }

  // Accessible, self-describing media.
  doc.tags.forEach((t, i) => {
    if (t.close) return
    if (t.name === 'figure') {
      if (!tagsWithin(doc, extent(doc, i)).some((x) => !x.close && x.name === 'figcaption')) fail('figure-caption', at(t.start), '<figure> has no <figcaption>')
    }
    if (t.name === 'img' && !(t.attrs.alt || '').trim()) fail('img-alt', at(t.start), `<img src="${t.attrs.src || ''}"> has no alt text`)
    if (t.name === 'video' && t.attrs.controls === undefined) fail('video-controls', at(t.start), '<video> has no controls attribute')
  })

  // The conversation frame sizes itself from the content.
  for (const block of cssBlocks(doc)) {
    const css = block.css.replace(/\/\*[\s\S]*?\*\//g, blank)
    for (const m of css.matchAll(/(?<![\w-])\d*\.?\d+\s*[dsl]?vh\b/gi)) {
      fail('viewport-height', at(block.start + (block.inline ? 0 : m.index)), `"${m[0]}": vh units loop or are rejected in a conversation frame`)
    }
    if (block.inline) {
      if (['html', 'body'].includes(block.inline.name)) {
        if (/(?:^|;)\s*(?:min-)?height\s*:\s*100%/i.test(css)) fail('viewport-height', at(block.start), `height:100% on <${block.inline.name}> loops in a conversation frame`)
        if (/(?:^|;)\s*background(?:-color|-image)?\s*:/i.test(css)) warn('frame-background', at(block.start), `<${block.inline.name}> sets a background; leave html and body without one`)
      }
      continue
    }
    for (const rule of cssRules(css)) {
      if (!rootSelector(rule.selector)) continue
      if (/(?:^|;)\s*(?:min-)?height\s*:\s*100%/i.test(rule.body)) fail('viewport-height', at(block.start + rule.index), `height:100% on ${rule.selector} loops in a conversation frame`)
      if (/(?:^|;)\s*background(?:-color|-image)?\s*:/i.test(rule.body)) warn('frame-background', at(block.start + rule.index), `${rule.selector} sets a background; leave html and body without one`)
    }
  }

  for (const s of doc.scripts) {
    for (const m of s.body.matchAll(STRING_LITERAL)) {
      const value = m[2] ?? m[3] ?? ''
      if (!/(?<![\w-])(?:\d*\.?\d+\s*)?[dsl]?vh\b/i.test(value)) continue
      const asStyle = SCRIPT_STYLE_CONTEXT.test(s.body.slice(Math.max(0, m.index - 80), m.index))
      if (asStyle || CSS_VH_DECLARATION.test(value)) {
        fail('viewport-height', at(s.start + m.index), 'the script sets a vh unit as a style; vh units loop or are rejected in a conversation frame')
      }
    }
  }

  // Nothing secret on the page.
  for (const [label, re] of SECRETS) {
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')
    for (const m of html.matchAll(g)) fail('secret', at(m.index), `text that looks like a ${label}; remove it`)
  }
  const visible = doc.masked.replace(/<[^>]*>/g, (tag) => blank(tag))
  for (const m of visible.matchAll(PHONE)) {
    const digits = m[0].replace(/\D/g, '').length
    if (digits >= 9 && digits <= 15) warn('personal-data', at(m.index), 'text that looks like a phone number; remove it unless it is clearly fake')
  }
  for (const re of CREDENTIAL_LABELS) {
    for (const m of visible.matchAll(re)) warn('personal-data', at(m.index), 'a password or PIN label followed by a value; remove the value')
  }

  // Pictures are drawn in HTML, CSS or SVG, never as ASCII art.
  const preClasses = new Set()
  const preTags = new Set(['pre'])
  for (const block of cssBlocks(doc)) {
    if (block.inline) continue
    for (const rule of cssRules(block.css)) {
      if (!/(?:^|;)\s*white-space\s*:\s*pre(?:-wrap)?\s*(?:;|$|!)/i.test(rule.body)) continue
      for (const part of rule.selector.split(',')) {
        const m = /^\s*([a-z][\w-]*)?(?:\.([\w-]+))?\s*$/i.exec(part)
        if (!m) continue
        if (m[2]) preClasses.add(m[2])
        else if (m[1]) preTags.add(m[1].toLowerCase())
      }
    }
  }
  doc.tags.forEach((t, i) => {
    if (t.close) return
    const styled = /(?:^|;)\s*white-space\s*:\s*pre(?:-wrap)?\s*(?:;|$|!)/i.test(t.attrs.style || '')
    const classed = (t.attrs.class || '').split(/\s+/).some((c) => preClasses.has(c))
    if (!preTags.has(t.name) && !styled && !classed) return
    const ext = extent(doc, i)
    const text = decode(doc.masked.slice(ext.inner, ext.innerEnd).replace(/<[^>]*>/g, ''))
    const lines = text.split('\n').filter(diagramLine)
    if (lines.length >= 3) fail('ascii-diagram', at(t.start), `<${t.name}> holds an ASCII diagram (${lines.length} drawing lines); draw it in HTML, CSS or SVG`)
  })

  let total = Buffer.byteLength(html)
  for (const path of media) total += statSync(path).size
  if (total > SIZE_WARN_BYTES) warn('size', '-', `the page and its media weigh ${(total / 1048576).toFixed(1)} MB (over 25 MB); compress the video or trim frames`)

  return { errors, warnings }
}

export function format({ errors, warnings }) {
  return [
    ...errors.map((e) => `FAIL ${e.rule} ${e.where}: ${e.what}`),
    ...warnings.map((w) => `WARN ${w.rule} ${w.where}: ${w.what}`),
  ]
}

function main(argv) {
  const args = [...argv]
  let kind
  const k = args.indexOf('--kind')
  if (k !== -1) { kind = args[k + 1]; args.splice(k, 2) }
  const eq = args.findIndex((a) => a.startsWith('--kind='))
  if (eq !== -1) { kind = args[eq].slice(7); args.splice(eq, 1) }
  if (args.length !== 1 || !kind) {
    process.stderr.write('usage: page-check.mjs <index.html> --kind explanation|demo\n')
    return 2
  }
  const result = checkPage(args[0], kind)
  for (const line of format(result)) process.stdout.write(line + '\n')
  if (result.errors.length) return 1
  process.stdout.write(`OK ${kind}: ${args[0]}\n`)
  return 0
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2))
}
