"""Instruction files named or linked in the messages a session showed the user.

Shared by the live drivers. A message names an instruction file when it
names, in any letter case, any .md file under the plugins' skills (SKILL.md,
WORKFLOW.md, FIXES.md, a profile, a reference document…), names an
orchestrator- or reviewer- profile without .md, a references/*.md path or a
path under .agents/skills/, or links a skill directory. The command after the
merge names the cleanup script's own path, so code lines that name
wave-cleanup.mjs, with their backslash continuations, are not read.
"""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
INSTRUCTION_NAMES = sorted({p.name for p in ROOT.glob('plugins/*/skills*/**/*.md')}, key=len, reverse=True)
SKILL_NAMES = sorted({p.parent.name for p in ROOT.glob('plugins/*/skills*/*/SKILL.md')})
INSTRUCTION_FILE = re.compile(
    r'(?<![\w.-])(?:' + '|'.join(re.escape(n) for n in INSTRUCTION_NAMES) + r')(?![\w-])'
    r'|\b(?:orchestrator|reviewer)-(?:generic|dossier|drift-\w+|(?:fable|opus|gpt)-[\w.-]*\d)\b'
    r'|references/[\w.-]+\.md|\.agents/skills/'
    r'|\]\([^)]*/skills(?:-codex)?/(?:' + '|'.join(map(re.escape, SKILL_NAMES)) + r')/?(?:#[^)]*)?\)', re.I)
EXPECTED_NAMED = ('no message the main session showed the user, in any turn (Codex agent messages; Claude text '
                  'and results), names or links an instruction file, in any letter case: the name of any .md '
                  "file under the plugins' skills (SKILL.md, WORKFLOW.md, FIXES.md, a profile, a reference "
                  'document…), an orchestrator- or reviewer- profile name without .md, a references/*.md path, '
                  'a path under .agents/skills/ or a link to a skill directory, an anchor included; code lines '
                  'that name wave-cleanup.mjs (the command after the merge), with their backslash '
                  'continuations, are not read')
FENCE = re.compile(r'(`{3,}|~{3,})[^\n]*\n.*?\n[ \t]*\1', re.S)
CLEANUP_SPAN = re.compile(r'`[^`\n]*wave-cleanup\.mjs[^`\n]*`')


def messages(rows):
    """Every message the main session showed the user, in order: Codex agent
    messages; Claude assistant text and results."""
    found = []
    for r in rows:
        item = r.get('item') or {}
        if r.get('type') == 'item.completed' and item.get('type') == 'agent_message':
            found.append(item.get('text') or '')
        if r.get('type') == 'assistant' and not r.get('parent_tool_use_id'):
            found += [b.get('text') or '' for b in (r.get('message') or {}).get('content') or []
                      if isinstance(b, dict) and b.get('type') == 'text']
        if r.get('type') == 'result' and r.get('result'):
            found.append(r['result'])
    return found


def skill_bodies(rows):
    """The skill text Claude Code injects as a user text block after a Skill call."""
    found = []
    for r in rows:
        if r.get('type') != 'user' or r.get('parent_tool_use_id'):
            continue
        content = (r.get('message') or {}).get('content') or []
        for b in [{'type': 'text', 'text': content}] if isinstance(content, str) else content:
            if isinstance(b, dict) and b.get('type') == 'text' and (b.get('text') or '').startswith('Base directory for this skill: '):
                found.append(b['text'])
    return found


def without_cleanup_lines(block):
    """A fenced block without the lines that name wave-cleanup.mjs and their continuations."""
    kept, continued = [], False
    for line in block.split('\n'):
        if continued or 'wave-cleanup.mjs' in line:
            continued = line.rstrip().endswith('\\')
            continue
        kept.append(line)
    return '\n'.join(kept)


def instruction_files_named(rows):
    """Each instruction file a message names or links, outside the cleanup command."""
    named = []
    for text in messages(rows):
        text = FENCE.sub(lambda m: without_cleanup_lines(m.group(0)), text)
        text = CLEANUP_SPAN.sub('', text)
        named += [m.group(0) for m in INSTRUCTION_FILE.finditer(text)]
    return named
