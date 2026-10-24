"""Write site/search-index.json from the docs pages. CI runs this before deploying; locally the site falls back to fetching pages."""
import json
import re
from html.parser import HTMLParser
from pathlib import Path

site = Path(__file__).resolve().parent.parent / 'site'
titles = {'index.html': 'Overview', 'installation.html': 'Installation', 'user-guide.html': 'User guide',
          'reports.html': 'Reports', 'deployment.html': 'Production & operations', 'security.html': 'Security'}


class Scan(HTMLParser):
    def __init__(self, page):
        super().__init__()
        self.page, self.out, self.sec, self.buf, self.row, self.cells = page, [], None, None, False, []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == 'section' and a.get('id'):
            self.sec = a['id']
        if tag in ('h2', 'h3') and self.sec:
            self.buf = ''
        if tag == 'tr' and a.get('data-key'):
            self.row, self.cells = True, []
        if tag == 'td' and self.row:
            self.buf = ''

    def handle_data(self, data):
        if self.buf is not None:
            self.buf += data

    def handle_endtag(self, tag):
        if tag in ('h2', 'h3') and self.buf is not None and self.sec:
            self.out.append({'t': re.sub(r'\s*#$', '', self.buf.strip()), 'page': titles[self.page], 'url': '%s#%s' % (self.page, self.sec)})
            self.buf = None
        if tag == 'td' and self.row and self.buf is not None:
            self.cells.append(self.buf.strip())
            self.buf = None
        if tag == 'tr' and self.row:
            self.row = False
            if len(self.cells) >= 4:
                self.out.append({'t': self.cells[1], 'page': 'Reports: parameter', 'url': self.page + '#param-table', 'extra': self.cells[3]})


index = []
for page in titles:
    s = Scan(page)
    s.feed((site / page).read_text(encoding='utf-8'))
    index += s.out
(site / 'search-index.json').write_text(json.dumps(index, ensure_ascii=False), encoding='utf-8')
print(len(index), 'entries')
