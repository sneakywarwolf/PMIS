(function () {
  var main = document.querySelector('main');
  if (!main) return;
  var here = location.pathname.split('/').pop() || 'index.html';
  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  };

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text) n.textContent = text;
    return n;
  }

  // Reading time and a progress bar
  var h1 = document.querySelector('.hero h1');
  var words = main.textContent.trim().split(/\s+/).length;
  var mins = Math.max(1, Math.round(words / 220));
  var tag = document.querySelector('.hero .tagline');
  if (tag && here !== 'index.html') tag.appendChild(el('span', 'readtime', ' About ' + mins + ' min read.'));
  var prog = el('div', 'progress');
  prog.setAttribute('role', 'presentation');
  document.body.appendChild(prog);
  function onScroll() {
    var h = document.documentElement;
    var max = h.scrollHeight - h.clientHeight;
    prog.style.transform = 'scaleX(' + (max > 0 ? h.scrollTop / max : 0) + ')';
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // Glossary: the first use of each term on a page gets a definition
  var terms = {
    'VAPT': 'Vulnerability assessment and penetration testing',
    'VA': 'Vulnerability assessment: finding weaknesses, usually with a scanner',
    'PT': 'Penetration testing: exploiting weaknesses to prove impact',
    'SPOC': 'Single point of contact at the client',
    'CERT-In': 'Indian Computer Emergency Response Team, whose audit format PMIS supports',
    'ASV': 'Approved Scanning Vendor, a PCI DSS scanning category',
    'AVP': 'Assistant Vice President: the manager that Team Leads report to',
    'PoC': 'Proof of concept: the steps and screenshots that show a finding is real',
    'CVSS': 'Common Vulnerability Scoring System, the 0 to 10 severity score'
  };
  var seen = {};
  var walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT, {
    acceptNode: function (n) {
      return n.parentNode.closest('code, pre, a, h1, h2, h3, th, button, abbr, label, dialog') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    }
  });
  var nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (var ni = 0; ni < nodes.length; ni++) {
    var n = nodes[ni];
    Object.keys(terms).forEach(function (t) {
      if (seen[t] || !n.parentNode) return;
      var m = new RegExp('(^|[^\\w-])(' + t.replace('-', '\\-') + ')(?![\\w-])').exec(n.nodeValue);
      if (!m) return;
      seen[t] = true;
      var i = m.index + m[1].length;
      var after = n.splitText(i);
      after.nodeValue = after.nodeValue.slice(t.length);
      var ab = el('abbr', 'gloss', t);
      ab.title = terms[t];
      n.parentNode.insertBefore(ab, after);
      // continue scanning the remainder of this text for other terms
      nodes.push(after);
    });
  }

  // Collapsible sub-sections: each h3 and its content up to the next heading
  var foldable = main.querySelectorAll('section#config, section#backup, section#step-3, section#step-4');
  var allDetails = [];
  foldable.forEach(function (sec) {
    Array.prototype.slice.call(sec.querySelectorAll(':scope > h3')).forEach(function (h) {
      var d = el('details', 'fold');
      d.open = true;
      var s = el('summary');
      s.textContent = h.textContent;
      d.appendChild(s);
      var next;
      var sib = h.nextSibling;
      h.parentNode.insertBefore(d, h);
      while (sib && !(sib.nodeType === 1 && /^H[23]$/.test(sib.tagName))) {
        next = sib.nextSibling;
        d.appendChild(sib);
        sib = next;
      }
      h.parentNode.removeChild(h);
      allDetails.push(d);
    });
  });
  if (allDetails.length) {
    var tools = el('div', 'foldtools');
    var b1 = el('button', 'theme-toggle', 'Collapse all');
    var b2 = el('button', 'theme-toggle', 'Expand all');
    b1.type = b2.type = 'button';
    b1.addEventListener('click', function () { allDetails.forEach(function (d) { d.open = false; }); });
    b2.addEventListener('click', function () { allDetails.forEach(function (d) { d.open = true; }); });
    tools.appendChild(b1); tools.appendChild(b2);
    main.insertBefore(tools, main.firstChild);
  }
  // Opening a link to a folded section reveals it
  function reveal() {
    var t = location.hash && document.getElementById(location.hash.slice(1));
    var d = t && t.closest('details');
    if (d) d.open = true;
  }
  window.addEventListener('hashchange', reveal);
  reveal();
  window.addEventListener('beforeprint', function () { allDetails.forEach(function (d) { d.open = true; }); });

  // OS tabs: a code block made of "# Windows ..." / "# Linux ..." paragraphs becomes tabs
  var osWord = /^#\s*(Windows|Linux|macOS|PowerShell|OpenSSL)\b/;
  main.querySelectorAll('pre').forEach(function (pre) {
    var code = pre.querySelector('code');
    if (!code) return;
    var parts = code.textContent.replace(/\n+$/, '').split(/\n\s*\n/);
    if (parts.length < 2 || !parts.every(function (p) { return osWord.test(p); })) return;
    var wrap = el('div', 'tabs');
    var list = el('div', 'tablist');
    list.setAttribute('role', 'tablist');
    var panels = [];
    var tabs = [];
    parts.forEach(function (p, i) {
      var label = osWord.exec(p)[1];
      var tab = el('button', 'tab', label);
      tab.type = 'button';
      tab.setAttribute('role', 'tab');
      var panel = document.createElement('pre');
      var c = document.createElement('code');
      c.textContent = p;
      panel.appendChild(c);
      panel.setAttribute('role', 'tabpanel');
      tab.addEventListener('click', function () { select(label); });
      list.appendChild(tab); wrap.appendChild(panel);
      tabs.push([label, tab]); panels.push([label, panel]);
    });
    wrap.insertBefore(list, wrap.firstChild);
    function select(label) {
      var ok = tabs.some(function (t) { return t[0] === label; });
      if (!ok) label = tabs[0][0];
      tabs.forEach(function (t) { t[1].setAttribute('aria-selected', String(t[0] === label)); });
      panels.forEach(function (p) { p[1].hidden = p[0] !== label; });
      store.set('pmis-os', label);
    }
    select(store.get('pmis-os'));
    pre.parentNode.replaceChild(wrap, pre);
  });

  // Troubleshooting finder
  var ts = document.getElementById('troubleshooting');
  if (ts) {
    var tw = ts.querySelector('.table-wrap');
    var f = el('div', 'filter');
    var l = el('label', null, 'Find your error');
    l.setAttribute('for', 'ts-filter');
    var i = document.createElement('input');
    i.id = 'ts-filter'; i.type = 'search'; i.placeholder = 'Paste an error message or a word from it';
    f.appendChild(l); f.appendChild(i);
    tw.parentNode.insertBefore(f, tw);
    var empty = el('p', 'none-found', 'No match. Check the logs with docker compose logs, then see the checklist.');
    empty.hidden = true;
    tw.parentNode.insertBefore(empty, tw.nextSibling);
    i.addEventListener('input', function () {
      var words = i.value.toLowerCase().split(/\W+/).filter(function (w) { return w.length > 2; });
      var shown = 0;
      ts.querySelectorAll('tbody tr').forEach(function (r) {
        var txt = r.textContent.toLowerCase();
        var hit = !words.length || words.some(function (w) { return txt.indexOf(w) >= 0; });
        r.hidden = !hit;
        if (hit) shown++;
      });
      empty.hidden = shown > 0;
    });
  }

  // Remember the chosen role on the access matrix
  var sel = document.querySelector('.filter select');
  if (sel) {
    var saved = store.get('pmis-role');
    if (saved) { sel.value = saved; sel.dispatchEvent(new Event('change')); }
    sel.addEventListener('change', function () { store.set('pmis-role', sel.value); });
  }

  // Retention: bars drawn from the table's day counts
  var ret = document.getElementById('retention') || Array.prototype.filter.call(main.querySelectorAll('h2'), function (h) { return h.textContent.indexOf('Retention') === 0; })[0];
  if (ret) {
    var rt = (ret.closest('section') || ret.parentNode).querySelector('table');
    if (rt) {
      var data = [];
      rt.querySelectorAll('tbody tr').forEach(function (r) {
        var m = /(\d+)\s*days/.exec(r.children[1].textContent);
        if (m) data.push([r.children[0].textContent, +m[1]]);
      });
      if (data.length) {
        var maxD = Math.max.apply(null, data.map(function (d) { return d[1]; }));
        var chart = el('div', 'bars');
        chart.setAttribute('role', 'img');
        chart.setAttribute('aria-label', 'Default retention in days: ' + data.map(function (d) { return d[0] + ' ' + d[1]; }).join(', '));
        data.forEach(function (d) {
          var row = el('div', 'bar-row');
          row.appendChild(el('span', 'bar-label', d[0]));
          var track = el('span', 'bar-track');
          var fill = el('span', 'bar-fill', d[1] + ' days');
          fill.style.width = Math.max(12, Math.round(d[1] / maxD * 100)) + '%';
          track.appendChild(fill);
          row.appendChild(track);
          chart.appendChild(row);
        });
        rt.closest('.table-wrap').parentNode.insertBefore(chart, rt.closest('.table-wrap'));
      }
    }
  }

  // Feedback strip
  var fb = el('aside', 'feedback wrap');
  fb.appendChild(document.createTextNode('Something missing or wrong on this page? '));
  var a = document.createElement('a');
  a.textContent = 'Open an issue';
  a.href = 'https://github.com/sneakywarwolf/PMIS/issues/new?title=' + encodeURIComponent('Docs: ' + document.title) + '&body=' + encodeURIComponent('Page: ' + location.href + '\n\nWhat is missing or wrong:\n');
  fb.appendChild(a);
  fb.appendChild(document.createTextNode('.'));
  var pager = document.querySelector('.pager');
  var anchorEl = pager || main;
  anchorEl.parentNode.insertBefore(fb, pager ? pager : main.nextSibling);
})();
