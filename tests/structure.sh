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
  expect "orchestration release version: $f" "2.6.0" "$v"
done
for f in plugins/orchestration/skills/*/SKILL.md; do
  v="$(sed -n 's/^  version: \(.*\)/\1/p' "$f" | head -1)"
  expect "orchestration skill release version: $f" "2.6.0" "$v"
done
for f in \
  plugins/code-review/.claude-plugin/plugin.json \
  plugins/code-review/.codex-plugin/plugin.json; do
  v="$(python3 -c "import json;print(json.load(open('$f'))['version'])" 2>/dev/null)"
  expect "code-review release version: $f" "1.5.0" "$v"
done
for f in plugins/code-review/skills/*/SKILL.md; do
  v="$(sed -n 's/^  version: \(.*\)/\1/p' "$f" | head -1)"
  expect "code-review skill release version: $f" "1.5.0" "$v"
done
for marker in \
  "Claude Code installation" \
  "Codex installation" \
  "gpt-5.6-sol" \
  "gpt-5.6-terra" \
  "gpt-5.6-luna" \
  "ChatGPT surfaces do not run Codex lifecycle hooks" \
  "merge stays with the user"; do
  check "README release marker: $marker" "grep -Fq '$marker' README.md"
done
for marker in \
  "codex-wave-protocol.md" \
  "codex-wave-state.mjs" \
  "orchestrator-gpt-5-6-{sol,terra,luna}.md" \
  "orchestrator-generic.md" \
  "gpt-5-6-dossier.md" \
  "reviewer-gpt-5-6-{sol,terra,luna}.md" \
  "reviewer-generic.md" \
  "gpt-5-6-reviewer-dossier.md" \
  "code-review/hooks/"; do
  check "README source/layout inventory: $marker" "grep -Fq '$marker' README.md"
done

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
