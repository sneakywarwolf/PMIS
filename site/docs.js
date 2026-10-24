(function () {
  var root = document.documentElement;
  var main = document.querySelector('main');
  if (!main) return;

  // Theme: stored choice overrides the OS setting.
  var saved = localStorage.getItem('pmis-theme');
  if (saved) root.setAttribute('data-theme', saved);
  var bar = document.querySelector('.site-header .bar');
  var toggle = document.createElement('button');
  toggle.className = 'theme-toggle icon-btn';
  toggle.type = 'button';
  function isDark() {
    var t = root.getAttribute('data-theme');
    return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  }
  function label() {
    toggle.innerHTML = isDark() ? '<svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor" aria-hidden="true" focusable="false"><path d="M8 11a3 3 0 1 1 0-6 3 3 0 0 1 0 6m0 1a4 4 0 1 0 0-8 4 4 0 0 0 0 8M8 0a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-1 0v-2A.5.5 0 0 1 8 0m0 13a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-1 0v-2A.5.5 0 0 1 8 13m8-5a.5.5 0 0 1-.5.5h-2a.5.5 0 0 1 0-1h2a.5.5 0 0 1 .5.5M3 8a.5.5 0 0 1-.5.5h-2a.5.5 0 0 1 0-1h2A.5.5 0 0 1 3 8m10.657-5.657a.5.5 0 0 1 0 .707l-1.414 1.415a.5.5 0 1 1-.707-.708l1.414-1.414a.5.5 0 0 1 .707 0m-9.193 9.193a.5.5 0 0 1 0 .707L3.05 13.657a.5.5 0 0 1-.707-.707l1.414-1.414a.5.5 0 0 1 .707 0m9.193 2.121a.5.5 0 0 1-.707 0l-1.414-1.414a.5.5 0 0 1 .707-.707l1.414 1.414a.5.5 0 0 1 0 .707M4.464 4.465a.5.5 0 0 1-.707 0L2.343 3.05a.5.5 0 1 1 .707-.707l1.414 1.414a.5.5 0 0 1 0 .708"/></svg>' : '<svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor" aria-hidden="true" focusable="false"><path d="M6 .278a.77.77 0 0 1 .08.858 7.2 7.2 0 0 0-.878 3.46c0 4.021 3.278 7.277 7.318 7.277q.792-.001 1.533-.16a.79.79 0 0 1 .81.316.73.73 0 0 1-.031.893A8.35 8.35 0 0 1 8.344 16C3.734 16 0 12.286 0 7.71 0 4.266 2.114 1.312 5.124.06A.75.75 0 0 1 6 .278M4.858 1.311A7.27 7.27 0 0 0 1.025 7.71c0 4.02 3.279 7.276 7.319 7.276a7.32 7.32 0 0 0 5.205-2.162q-.506.063-1.029.063c-4.61 0-8.343-3.714-8.343-8.29 0-1.167.242-2.278.681-3.286"/></svg>';
    var name = isDark() ? 'Switch to light mode' : 'Switch to dark mode';
    toggle.setAttribute('aria-label', name);
    toggle.title = name;
  }
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
