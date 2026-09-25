#!/usr/bin/env bash
# Tier 1 — structure. Cheap, offline, and the only tier that must never fail:
# everything here breaks the plugin outright rather than degrading it.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
. tests/lib.sh

section "Manifests parse"
for f in .claude-plugin/marketplace.json plugins/*/.claude-plugin/plugin.json; do
  check "valid JSON: $f" "python3 -c 'import json;json.load(open(\"$f\"))'"
done
for f in plugins/*/hooks/hooks.json; do
  [ -e "$f" ] || continue
  check "valid JSON: $f" "python3 -c 'import json;json.load(open(\"$f\"))'"
done

section "Codex plugin manifests"
check "Codex marketplace exists: .agents/plugins/marketplace.json" \
  "[ -f '.agents/plugins/marketplace.json' ]"
check "Codex marketplace parses: .agents/plugins/marketplace.json" \
  "python3 -c 'import json;json.load(open(\".agents/plugins/marketplace.json\"))'"
for p in plugins/*/; do
  c="$p.codex-plugin/plugin.json"
  check "Codex manifest exists: $c" "[ -f '$c' ]"
  check "Codex manifest parses: $c" "python3 -c 'import json;json.load(open(\"$c\"))'"
  skills="$(python3 -c "import json;print(json.load(open('$c'))['skills'])" 2>/dev/null)"
  expect "Codex skills path: $(basename "$p")" "./skills/" "$skills"
  cv="$(python3 -c "import json;print(json.load(open('$c'))['version'])" 2>/dev/null)"
  av="$(python3 -c "import json;print(json.load(open('$p.claude-plugin/plugin.json'))['version'])" 2>/dev/null)"
  expect "Claude/Codex version: $(basename "$p")" "$av" "$cv"
  cdsc="$(python3 -c "import json;print(json.load(open('$c'))['description'])" 2>/dev/null)"
  adsc="$(python3 -c "import json;print(json.load(open('$p.claude-plugin/plugin.json'))['description'])" 2>/dev/null)"
  expect "Claude/Codex description parity: $(basename "$p")" "$adsc" "$cdsc"
  contains "dual-host manifest description: $(basename "$p")" "Claude Code and Codex" "$cdsc"
  case "$(basename "$p")" in
    orchestration) contains "orchestration capability description" "machine-checkable contracts" "$cdsc" ;;
    code-review) contains "code-review capability description" "evidence-based code review" "$cdsc" ;;
  esac
  if printf '%s' "$cdsc" | grep -Eq 'for Claude Code:|Grounded in Anthropic system cards'; then
    fail "provider-neutral manifest description: $(basename "$p")" "$cdsc"
  else
    pass "provider-neutral manifest description: $(basename "$p")"
  fi
done

section "Skill frontmatter parses and is complete"
for f in plugins/*/skills/*/SKILL.md; do
  out="$(ruby -ryaml -e '
    s = File.read(ARGV[0])
    fm = s[/\A---\n(.*?)\n---\n/m, 1] or (puts "NO-FRONTMATTER"; exit)
    d = YAML.safe_load(fm)
    miss = %w[name description].reject { |k| d[k].to_s.strip != "" }
    miss << "metadata.version" unless d.dig("metadata", "version").to_s =~ /\A\d+\.\d+\.\d+\z/
    puts(miss.empty? ? "OK #{d["name"]} #{d.dig("metadata","version")}" : "MISSING #{miss.join(",")}")
  ' "$f" 2>/dev/null | grep -v '^Ignoring')"
  case "$out" in
    OK*) pass "frontmatter: $(basename "$(dirname "$f")") $(echo "$out" | cut -d' ' -f3)" ;;
    *)   fail "frontmatter: $f" "$out" ;;
  esac
done

section "Skill version matches its plugin version"
for p in plugins/*/; do
  pv="$(python3 -c "import json;print(json.load(open('$p.claude-plugin/plugin.json'))['version'])" 2>/dev/null)"
  for f in "$p"skills/*/SKILL.md; do
    [ -e "$f" ] || continue
    sv="$(sed -n 's/^  version: \(.*\)/\1/p' "$f" | head -1)"
    expect "version agrees: $(basename "$p") $pv" "$pv" "$sv"
  done
done

section "Release versions and dual-host documentation"
for f in \
  plugins/orchestration/.claude-plugin/plugin.json \
  plugins/orchestration/.codex-plugin/plugin.json; do
  v="$(python3 -c "import json;print(json.load(open('$f'))['version'])" 2>/dev/null)"
  expect "orchestration release version: $f" "4.2.0" "$v"
done
for f in plugins/orchestration/skills/*/SKILL.md; do
  v="$(sed -n 's/^  version: \(.*\)/\1/p' "$f" | head -1)"
  expect "orchestration skill release version: $f" "4.2.0" "$v"
done
for f in \
  plugins/code-review/.claude-plugin/plugin.json \
  plugins/code-review/.codex-plugin/plugin.json; do
  v="$(python3 -c "import json;print(json.load(open('$f'))['version'])" 2>/dev/null)"
  expect "code-review release version: $f" "1.11.0" "$v"
done
for f in plugins/code-review/skills/*/SKILL.md; do
  v="$(sed -n 's/^  version: \(.*\)/\1/p' "$f" | head -1)"
  expect "code-review skill release version: $f" "1.11.0" "$v"
done
for marker in \
  "Claude Code installation" \
  "Codex installation" \
  "gpt-5.6-sol" \
  "gpt-5.6-terra" \
  "gpt-5.6-luna" \
  "gpt-6-astra" \
  "gpt-6-sol" \
  "gpt-6-luna" \
  "ChatGPT surfaces do not run Codex lifecycle hooks" \
  "merge stays with the user"; do
  check "README release marker: $marker" "grep -Fq '$marker' README.md"
done
check "CHANGELOG.md exists" "[ -f 'CHANGELOG.md' ]"
orch_v="$(python3 -c "import json;print(json.load(open('plugins/orchestration/.claude-plugin/plugin.json'))['version'])" 2>/dev/null)"
changelog_head="$(grep -m1 '^## ' CHANGELOG.md 2>/dev/null)"
expect "CHANGELOG.md first heading matches orchestration version" "## $orch_v" "$changelog_head"
for marker in \
  "worktree-env.mjs" \
  "codex-wave-protocol.md" \
  "codex-wave-state.mjs" \
  "orchestrator-gpt-5-6-{sol,terra,luna}.md" \
  "orchestrator-generic.md" \
  "gpt-5-6-dossier.md" \
  "orchestrator-gpt-6-astra.md" \
  "gpt-6-astra-dossier.md" \
  "orchestrator-gpt-6-sol.md" \
  "orchestrator-gpt-6-luna.md" \
  "gpt-6-sol-dossier.md" \
  "gpt-6-luna-dossier.md" \
  "reviewer-gpt-5-6-{sol,terra,luna}.md" \
  "reviewer-generic.md" \
  "gpt-5-6-reviewer-dossier.md" \
  "reviewer-gpt-6-astra.md" \
  "gpt-6-astra-reviewer-dossier.md" \
  "reviewer-gpt-6-sol.md" \
  "reviewer-gpt-6-luna.md" \
  "gpt-6-sol-reviewer-dossier.md" \
  "gpt-6-luna-reviewer-dossier.md" \
  "code-review/hooks/" \
  "CHANGELOG.md" \
  "announce.yml"; do
  check "README source/layout inventory: $marker" "grep -Fq '$marker' README.md"
done

section "CHANGELOG.md Highlights block"
highlights_out="$(python3 - <<'PY'
import re, os, glob

path = "CHANGELOG.md"
lines = open(path, encoding="utf-8").read().split("\n")

results = []
def ok(name): results.append(("PASS", name, ""))
def bad(name, detail=""): results.append(("FAIL", name, detail))

group_re = re.compile(r'^\*\*[a-z0-9-]+\*\*$')
bullet_re = re.compile(r'^- ')
heading_re = re.compile(r'^(### |## )')

heading_idx = None
for i, l in enumerate(lines):
    if l.startswith("## "):
        heading_idx = i
        break

if heading_idx is None:
    bad("topmost release heading found", "no '## ' heading in CHANGELOG.md")
else:
    section_end = len(lines)
    for i in range(heading_idx + 1, len(lines)):
        if lines[i].startswith("## "):
            section_end = i
            break
    section_body = lines[heading_idx + 1:section_end]

    first_nonblank = None
    first_nonblank_idx = None
    for j, l in enumerate(section_body):
        if l.strip() != "":
            first_nonblank = l
            first_nonblank_idx = j
            break

    if first_nonblank != "### Highlights":
        bad("first line after release heading is '### Highlights'", f"got: {first_nonblank!r}")
    else:
        ok("first line after release heading is '### Highlights'")

        # The block ends at whichever comes first: the next '### '/'## '
        # heading, the first non-blank line that is neither a group line
        # nor a bullet, or EOF. Blank lines never end the block by
        # themselves.
        block_scan_limit = len(section_body)
        i = first_nonblank_idx + 1
        groups = []
        current = None
        bad_lines = []

        while i < block_scan_limit:
            line = section_body[i]
            if line.strip() == "":
                i += 1
                continue
            if heading_re.match(line):
                break
            if group_re.match(line):
                current = {"name": line.strip("*"), "bullets": []}
                groups.append(current)
                i += 1
                continue
            if bullet_re.match(line):
                if current is not None:
                    current["bullets"].append(line)
                else:
                    bad_lines.append(line)
                i += 1
                continue
            # This line ends the block. If it still looks like a failed
            # attempt at a group or a bullet, flag it rather than letting
            # it silently pass as the closing line of the block.
            if line.lstrip().startswith("**") or line.lstrip().startswith("-"):
                bad_lines.append(line)
            break

        if not bad_lines:
            ok("Highlights block contains only blank, group, and bullet lines")
        else:
            bad("Highlights block contains only blank, group, and bullet lines",
                f"unexpected line(s): {bad_lines}")

        skill_dirs = {os.path.basename(d) for d in glob.glob("plugins/*/skills/*") if os.path.isdir(d)}

        for g in groups:
            name = g["name"]
            if name in skill_dirs:
                ok(f"Highlights group is an existing skill: {name}")
            else:
                bad(f"Highlights group is an existing skill: {name}", f"no plugins/*/skills/{name}")

            n = len(g["bullets"])
            if 1 <= n <= 3:
                ok(f"Highlights group has 1-3 bullets: {name}")
            else:
                bad(f"Highlights group has 1-3 bullets: {name}", f"got {n} bullets")

            for b in g["bullets"]:
                if len(b) <= 70:
                    ok(f"Highlights bullet <=70 chars: {b[:40]}")
                else:
                    bad(f"Highlights bullet <=70 chars: {b[:40]}", f"len={len(b)}")

for r in results:
    print("\t".join(r))
PY
)"
while IFS=$'\t' read -r result name detail; do
  [ -n "$result" ] || continue
  if [ "$result" = PASS ]; then
    pass "$name"
  else
    fail "$name" "$detail"
  fi
done <<< "$highlights_out"

section "Executables are executable"
for f in plugins/*/hooks/*; do
  case "$f" in *.json) continue;; esac
  [ -f "$f" ] || continue
  check "executable: $(basename "$f")" "[ -x '$f' ]"
  check "shell syntax: $(basename "$f")" "bash -n '$f'"
done

section "Repository-wide prohibitions"
# Bracketed on purpose: this file must not contain the names it forbids.
check "no third-party reference implementation is named" \
  "! grep -riq '[k]ent\|[r]espawn' --exclude-dir=.git --exclude-dir=tests ."
check "no absolute home path leaked into a shipped file" \
  "! grep -rq '/Users/[a-z]' plugins/"

summary
