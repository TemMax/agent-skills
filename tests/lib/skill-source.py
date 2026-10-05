#!/usr/bin/env python3
"""Contract text: entrypoint plus its explicitly linked mandatory workflow.

References stay beside the entrypoint so their relative links retain their base.
This does not make the host load them; live checks verify that task decision.
"""
from pathlib import Path
import sys


def skill_text(path):
    path = Path(path)
    text = path.read_text(encoding='utf-8')
    if '[WORKFLOW.md](WORKFLOW.md)' in text:
        text += '\n' + (path.parent / 'WORKFLOW.md').read_text(encoding='utf-8')
    return text


if __name__ == '__main__':
    print(skill_text(sys.argv[1]), end='')
