(function () {
  var pages = [
    ['index.html', 'Overview'], ['installation.html', 'Installation'], ['user-guide.html', 'User guide'],
    ['reports.html', 'Reports'], ['deployment.html', 'Production & operations'], ['security.html', 'Security']
  ];
  var here = location.pathname.split('/').pop() || 'index.html';
  var idx = pages.findIndex(function (p) { return p[0] === here; });
  var main = document.querySelector('main');
  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var bar = document.querySelector('.site-header .bar');
  var nav = document.querySelector('.nav');

  // Mobile menu button
  if (bar && nav) {
    var menu = document.createElement('button');
    menu.type = 'button';
    menu.className = 'menu-btn';
    menu.setAttribute('aria-expanded', 'false');
    menu.setAttribute('aria-controls', 'site-nav');
    menu.textContent = 'Menu';
    nav.id = 'site-nav';
    menu.addEventListener('click', function () {
      var open = nav.classList.toggle('open');
      menu.setAttribute('aria-expanded', String(open));
    });
    bar.insertBefore(menu, nav);
  }

  // Previous / next page links
  if (main && idx >= 0) {
    var pn = document.createElement('nav');
    pn.className = 'pager wrap';
    pn.setAttribute('aria-label', 'Pages');
    [[-1, 'Previous'], [1, 'Next']].forEach(function (d) {
      var p = pages[idx + d[0]];
      var a = document.createElement(p ? 'a' : 'span');
      if (p) { a.href = p[0]; a.textContent = d[1] + ': ' + p[1]; }
      pn.appendChild(a);
    });
    main.parentNode.insertBefore(pn, main.nextSibling);
  }

  // Last-updated date in the footer
  var foot = document.querySelector('.site-footer');
  if (foot && document.lastModified) {
    var d = new Date(document.lastModified);
    if (!isNaN(d)) {
      var s = document.createElement('div');
      s.className = 'updated';
      s.textContent = 'Page last updated ' + d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
      foot.appendChild(s);
    }
  }

  // Yes/No colouring, and a role filter on the access tables
  document.querySelectorAll('table').forEach(function (t) {
    var heads = Array.prototype.slice.call(t.querySelectorAll('thead th'));
    var roles = ['Admin', 'AVP', 'Team Lead', 'Tester'];
    var isMatrix = roles.every(function (r) { return heads.some(function (h) { return h.textContent.trim() === r; }); });
    t.querySelectorAll('td').forEach(function (c) {
      var v = c.textContent.trim();
      if (v === 'Yes') c.classList.add('yes');
      else if (v === 'No') c.classList.add('no');
    });
    if (!isMatrix) return;
    var wrap = t.closest('.table-wrap');
    var sel = document.createElement('select');
    sel.setAttribute('aria-label', 'Show one role');
    var all = document.createElement('option');
    all.value = ''; all.textContent = 'All roles';
    sel.appendChild(all);
    roles.forEach(function (r) { var o = document.createElement('option'); o.value = r; o.textContent = r; sel.appendChild(o); });
    var box = document.createElement('div');
    box.className = 'filter';
    var lab = document.createElement('label');
    lab.textContent = 'Show';
    box.appendChild(lab); box.appendChild(sel);
    wrap.parentNode.insertBefore(box, wrap);
    sel.addEventListener('change', function () {
      heads.forEach(function (h, i) {
        var name = h.textContent.trim();
        var hide = sel.value && roles.indexOf(name) >= 0 && name !== sel.value;
        t.querySelectorAll('tr').forEach(function (r) { if (r.children[i]) r.children[i].hidden = !!hide; });
      });
    });
  });

  // Images: lazy loading, light/dark variants (data-dark), click to enlarge
  document.querySelectorAll('img').forEach(function (im) { im.loading = 'lazy'; if (im.dataset.dark) im.dataset.light = im.getAttribute('src'); });
  function swapImages() {
    var t = document.documentElement.getAttribute('data-theme');
    var dark = t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    document.querySelectorAll('img[data-dark]').forEach(function (im) { im.src = dark ? im.dataset.dark : im.dataset.light; });
  }
  swapImages();
  new MutationObserver(swapImages).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  var lb = document.createElement('dialog');
  lb.className = 'lightbox';
  var big = document.createElement('img');
  big.alt = '';
  lb.appendChild(big);
  document.body.appendChild(lb);
  lb.addEventListener('click', function () { lb.close(); });
  document.querySelectorAll('.shot img').forEach(function (im) {
    im.tabIndex = 0;
    im.title = 'Click to enlarge';
    function open() { big.src = im.currentSrc || im.src; big.alt = im.alt; lb.showModal(); }
    im.addEventListener('click', open);
    im.addEventListener('keydown', function (e) { if (e.key === 'Enter') open(); });
  });

  // Installation: copy every command on the page
  if (here === 'installation.html' && main && navigator.clipboard) {
    var first = main.querySelector('section');
    var ca = document.createElement('button');
    ca.type = 'button';
    ca.className = 'copy-all';
    ca.textContent = 'Copy all commands';
    ca.addEventListener('click', function () {
      var text = Array.prototype.map.call(main.querySelectorAll('pre code'), function (c) { return c.textContent; }).join('\n\n');
      navigator.clipboard.writeText(text).then(function () {
        ca.textContent = 'Copied';
        setTimeout(function () { ca.textContent = 'Copy all commands'; }, 1500);
      });
    });
    if (first) first.insertBefore(ca, first.children[1] || null);
  }

  // Search (Ctrl+K or "/"): headings and parameters from every page
  var index = null;
  function load() {
    if (index) return Promise.resolve(index);
    index = [];
    return Promise.all(pages.map(function (p) {
      return fetch(p[0]).then(function (r) { return r.text(); }).then(function (html) {
        var doc = new DOMParser().parseFromString(html, 'text/html');
        doc.querySelectorAll('section[id] h2, section[id] h3').forEach(function (h) {
          var sec = h.closest('section[id]');
          index.push({ t: h.firstChild.textContent.trim(), page: p[1], url: p[0] + '#' + sec.id });
        });
        doc.querySelectorAll('#param-table tbody tr').forEach(function (r) {
          var td = r.children;
          index.push({ t: td[1].textContent.trim(), page: 'Reports: parameter', url: p[0] + '#param-table', extra: td[3].textContent });
        });
      }).catch(function () {});
    })).then(function () { return index; });
  }

  var dlg = document.createElement('dialog');
  dlg.className = 'search';
  var inp = document.createElement('input');
  inp.type = 'search';
  inp.placeholder = 'Search the documentation';
  inp.setAttribute('aria-label', 'Search the documentation');
  var res = document.createElement('ul');
  dlg.appendChild(inp); dlg.appendChild(res);
  document.body.appendChild(dlg);
  dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); });

  function render() {
    var q = inp.value.trim().toLowerCase();
    while (res.firstChild) res.removeChild(res.firstChild);
    if (!q) return;
    var hits = index.filter(function (e) { return (e.t + ' ' + (e.extra || '')).toLowerCase().indexOf(q) >= 0; }).slice(0, 12);
    if (!hits.length) {
      var n = document.createElement('li');
      n.className = 'none';
      n.textContent = 'No matches. Try a shorter word.';
      res.appendChild(n);
      return;
    }
    hits.forEach(function (e) {
      var li = document.createElement('li');
      var a = document.createElement('a');
      a.href = e.url;
      var b = document.createElement('strong'); b.textContent = e.t;
      var sp = document.createElement('span'); sp.textContent = e.page;
      a.appendChild(b); a.appendChild(sp);
      li.appendChild(a); res.appendChild(li);
    });
  }
  inp.addEventListener('input', render);
  inp.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { var a = res.querySelector('a'); if (a) location.href = a.href; }
  });
  function openSearch() { load().then(function () { dlg.showModal(); inp.value = ''; render(); inp.focus(); }); }
  document.addEventListener('keydown', function (e) {
    var typing = /input|textarea|select/i.test(e.target.tagName || '');
    if ((e.key === 'k' && (e.ctrlKey || e.metaKey)) || (e.key === '/' && !typing)) { e.preventDefault(); openSearch(); }
  });
  var sb = document.createElement('button');
  sb.type = 'button';
  sb.className = 'theme-toggle';
  sb.textContent = 'Search';
  sb.setAttribute('aria-keyshortcuts', 'Control+K');
  sb.addEventListener('click', openSearch);
  var tt = document.querySelector('.theme-toggle');
  if (bar && tt) bar.insertBefore(sb, tt);

  // Flash the section you jumped to
  function flash() {
    if (reduce || !location.hash) return;
    var el = document.getElementById(location.hash.slice(1));
    if (!el) return;
    el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
  }
  window.addEventListener('hashchange', flash);
  flash();
})();
