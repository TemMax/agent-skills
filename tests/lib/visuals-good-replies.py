#!/usr/bin/env python3
"""Check a visuals entrypoint's good reply examples.

Usage: visuals-good-replies.py <SKILL.md>
Prints `ok` when the section between `Good:` and `Bad (` holds exactly two
quoted replies, the second in Russian, each with a conclusion, a numbered
question with lettered options and a Markdown link to the page; `bad` otherwise.
"""
import re
import sys


def check(text):
    if 'Good:' not in text or 'Bad (' not in text:
        return False
    part = text[text.index('Good:'):text.index('Bad (')]
    quotes = [q for q in re.split(r'\n\s*\n(?=> [^\n>])', part) if q.lstrip().startswith('>')]
    if len(quotes) != 2:
        return False
    for q in quotes:
        lines = [l[2:] for l in q.strip().split('\n') if l.startswith('> ')]
        if len(lines) < 3:
            return False
        if not re.match(r'\S.{20,}', lines[0]):
            return False
        if not any(re.match(r'1\. .*\bA\. .*\bB\. ', l) for l in lines):
            return False
        if not re.match(r'\[[^\]]+\]\(/abs/[^)]+\)$', lines[-1]):
            return False
    return re.search(r'[А-Яа-я]', quotes[1]) is not None


if __name__ == '__main__':
    print('ok' if check(open(sys.argv[1], encoding='utf-8').read()) else 'bad')
