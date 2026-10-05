#!/usr/bin/env python3
"""Offline policy graph: entrypoint and explicitly linked phase files.

This validates all policies; it does not make a runtime load every phase.
Phase files stay beside SKILL.md to preserve the base of relative links.
"""
from pathlib import Path
import re
import sys

PHASE_FILES = frozenset({'WORKFLOW.md', 'PROFILE.md', 'REVIEW.md', 'PR.md', 'FIXES.md'})


def skill_text(path):
    seen = set()

    def visit(source):
        source = Path(source).resolve()
        if source in seen:
            return ''
        seen.add(source)
        text = source.read_text(encoding='utf-8')
        for target in re.findall(r'\]\(([^)#]+)(?:#[^)]*)?\)', text):
            if target in PHASE_FILES:
                text += '\n' + visit(source.parent / target)
        return text

    return visit(path)


if __name__ == '__main__':
    print(skill_text(sys.argv[1]), end='')
