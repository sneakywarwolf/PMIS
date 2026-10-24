"""Fail if a docs page links to a missing file or a missing #section. Run: python scripts/check-site-links.py"""
import re
import sys
from pathlib import Path

site = Path(__file__).resolve().parent.parent / 'site'
pages = {p.name: p.read_text(encoding='utf-8') for p in site.glob('*.html')}
ids = {n: set(re.findall(r'\bid="([^"]+)"', h)) for n, h in pages.items()}
bad = []
for name, html in pages.items():
    # Skip commented-out markup (screenshot slot examples).
    html = re.sub(r'<!--.*?-->', '', html, flags=re.S)
    for target in re.findall(r'(?:href|src)="([^"]+)"', html):
        if re.match(r'(https?:|mailto:|#$)', target):
            continue
        file, _, frag = target.partition('#')
        file = file or name
        if file not in pages and not (site / file).exists():
            bad.append('%s: missing file %s' % (name, target))
        elif frag and file in ids and frag not in ids[file]:
            bad.append('%s: missing section %s' % (name, target))
for b in bad:
    print(b)
sys.exit(1 if bad else 0)
