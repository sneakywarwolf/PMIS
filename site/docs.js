(function () {
  var root = document.documentElement;
  var main = document.querySelector('main');
  if (!main) return;

  // Theme: stored choice overrides the OS setting.
  var saved = localStorage.getItem('pmis-theme');
  if (saved) root.setAttribute('data-theme', saved);
  var bar = document.querySelector('.site-header .bar');
  var toggle = document.createElement('button');
  toggle.className = 'theme-toggle';
  toggle.type = 'button';
  function isDark() {
    var t = root.getAttribute('data-theme');
    return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  }
  function label() { toggle.textContent = isDark() ? 'Light mode' : 'Dark mode'; }
  toggle.addEventListener('click', function () {
    var next = isDark() ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    localStorage.setItem('pmis-theme', next);
    label();
  });
  label();
  if (bar) bar.appendChild(toggle);

  // Skip link
  main.id = main.id || 'content';
  var skip = document.createElement('a');
  skip.className = 'skip';
  skip.href = '#' + main.id;
  skip.textContent = 'Skip to content';
  document.body.insertBefore(skip, document.body.firstChild);

  // Heading anchors and "On this page" contents
  var heads = Array.prototype.slice.call(main.querySelectorAll('section[id] > h2'));
  heads.forEach(function (h) {
    var a = document.createElement('a');
    a.className = 'anchor';
    a.href = '#' + h.parentNode.id;
    a.setAttribute('aria-label', 'Link to this section');
    a.textContent = '#';
    h.appendChild(a);
  });

  if (heads.length > 2) {
    var toc = document.createElement('nav');
    toc.className = 'toc';
    toc.setAttribute('aria-label', 'On this page');
    var title = document.createElement('p');
    title.className = 'toc-title';
    title.textContent = 'On this page';
    var ul = document.createElement('ul');
    heads.forEach(function (h) {
      var li = document.createElement('li');
      var a = document.createElement('a');
      a.href = '#' + h.parentNode.id;
      a.textContent = h.firstChild.textContent;
      li.appendChild(a);
      ul.appendChild(li);
    });
    toc.appendChild(title);
    toc.appendChild(ul);
    main.classList.add('has-toc');
    main.insertBefore(toc, main.firstChild);

    var links = toc.querySelectorAll('a');
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (!e.isIntersecting) return;
          links.forEach(function (l) {
            l.classList.toggle('active', l.getAttribute('href') === '#' + e.target.id);
          });
        });
      }, { rootMargin: '-80px 0px -70% 0px' });
      heads.forEach(function (h) { io.observe(h.parentNode); });
    }
  }

  // Copy buttons on code blocks
  main.querySelectorAll('pre').forEach(function (pre) {
    if (!navigator.clipboard) return;
    var b = document.createElement('button');
    b.className = 'copy';
    b.type = 'button';
    b.textContent = 'Copy';
    b.addEventListener('click', function () {
      var code = pre.querySelector('code') || pre;
      navigator.clipboard.writeText(code.textContent).then(function () {
        b.textContent = 'Copied';
        setTimeout(function () { b.textContent = 'Copy'; }, 1500);
      });
    });
    pre.appendChild(b);
  });

  // Parameter table: filter box and click-to-copy placeholders
  var filter = document.getElementById('param-filter');
  var rows = document.querySelectorAll('#param-table tbody tr');
  if (filter) {
    filter.addEventListener('input', function () {
      var q = filter.value.trim().toLowerCase();
      rows.forEach(function (r) { r.hidden = q !== '' && r.textContent.toLowerCase().indexOf(q) < 0; });
    });
  }
  document.querySelectorAll('code.ph').forEach(function (c) {
    if (!navigator.clipboard) return;
    c.tabIndex = 0;
    c.setAttribute('role', 'button');
    c.title = 'Click to copy';
    function copy() {
      navigator.clipboard.writeText(c.textContent).then(function () {
        c.classList.add('copied');
        setTimeout(function () { c.classList.remove('copied'); }, 1200);
      });
    }
    c.addEventListener('click', copy);
    c.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); copy(); } });
  });
})();
