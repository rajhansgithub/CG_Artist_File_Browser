// User guide behaviour: search, theme, copy buttons, shortcut filter, page outline, phone menu.
// Plain JavaScript with no libraries and no network calls, so it works opened straight from disk.
(function () {
  'use strict';

  var root = window.SITE_ROOT || './';
  var index = window.SITE_SEARCH_INDEX || [];

  function store(key, value) {
    try {
      if (value === undefined) return localStorage.getItem(key);
      localStorage.setItem(key, value);
    } catch (e) {
      /* storage can be blocked (private windows): the choice just is not remembered */
    }
    return null;
  }

  // ---- theme -------------------------------------------------------------------------------

  var themeBtn = document.querySelector('.theme-btn');
  function currentTheme() {
    return document.documentElement.getAttribute('data-theme') || 'dark';
  }
  if (themeBtn) {
    themeBtn.addEventListener('click', function () {
      var next = currentTheme() === 'light' ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', next);
      store('cg_guide_theme', next);
    });
  }
  if (!store('cg_guide_theme') && window.matchMedia && !window.matchMedia('(prefers-color-scheme: dark)').matches) {
    document.documentElement.setAttribute('data-theme', 'light');
  }

  // ---- search ------------------------------------------------------------------------------

  var input = document.getElementById('search');
  var results = document.getElementById('results');
  var active = -1;
  var shown = [];

  function esc(s) {
    return s.replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function highlight(text, words) {
    var out = esc(text);
    words.forEach(function (w) {
      if (!w) return;
      var re = new RegExp('(' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig');
      out = out.replace(re, '<em>$1</em>');
    });
    return out;
  }

  function snippet(text, words) {
    var lower = text.toLowerCase();
    var at = -1;
    for (var i = 0; i < words.length; i++) {
      var p = lower.indexOf(words[i]);
      if (p !== -1 && (at === -1 || p < at)) at = p;
    }
    var start = Math.max(0, (at === -1 ? 0 : at) - 60);
    var s = text.slice(start, start + 170);
    return (start > 0 ? '… ' : '') + s + (start + 170 < text.length ? ' …' : '');
  }

  function search(q) {
    var words = q.toLowerCase().trim().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    var hits = [];
    index.forEach(function (e) {
      var head = (e.t + ' ' + e.s).toLowerCase();
      var body = e.x.toLowerCase();
      for (var i = 0; i < words.length; i++) {
        if (head.indexOf(words[i]) === -1 && body.indexOf(words[i]) === -1) return;
      }
      var score = 0;
      words.forEach(function (w) {
        if (e.s.toLowerCase().indexOf(w) !== -1) score += 6;
        if (e.t.toLowerCase().indexOf(w) !== -1) score += 4;
        if (body.indexOf(w) !== -1) score += 1;
      });
      hits.push({ e: e, score: score, words: words });
    });
    hits.sort(function (a, b) {
      return b.score - a.score || a.e.t.localeCompare(b.e.t);
    });
    return hits.slice(0, 12);
  }

  function renderResults(q) {
    if (!results) return;
    shown = search(q);
    active = shown.length ? 0 : -1;
    if (!q.trim()) {
      results.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      return;
    }
    results.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    if (!shown.length) {
      results.innerHTML = '<p class="none">Nothing matches “' + esc(q) + '”. Try a shorter word.</p>';
      return;
    }
    var words = q.toLowerCase().trim().split(/\s+/).filter(Boolean);
    results.innerHTML = shown
      .map(function (h, n) {
        var e = h.e;
        var layer = e.l === 'quick' ? 'Quick start' : e.l === 'deep' ? 'Deep dive' : e.l === 'home' ? 'Start here' : 'Both';
        return (
          '<a class="result" role="option" aria-selected="' + (n === 0) + '" href="' + root + esc(e.u) + '" data-n="' + n + '">' +
          '<span class="tag">' + layer + '</span>' +
          '<b>' + highlight(e.s || e.t, words) + '</b>' +
          '<small>' + (e.s ? esc(e.t) + ' · ' : '') + highlight(snippet(e.x, words), words) + '</small></a>'
        );
      })
      .join('');
  }

  function setActive(n) {
    var items = results.querySelectorAll('.result');
    if (!items.length) return;
    active = (n + items.length) % items.length;
    items.forEach(function (el, i) {
      el.setAttribute('aria-selected', String(i === active));
    });
    items[active].scrollIntoView({ block: 'nearest' });
  }

  if (input && results) {
    input.addEventListener('input', function () {
      renderResults(input.value);
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive(active + 1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive(active - 1);
      } else if (e.key === 'Enter') {
        var items = results.querySelectorAll('.result');
        if (items[active]) {
          e.preventDefault();
          window.location.href = items[active].getAttribute('href');
        }
      } else if (e.key === 'Escape') {
        input.value = '';
        renderResults('');
        input.blur();
      }
    });
    input.addEventListener('focus', function () {
      if (input.value) renderResults(input.value);
    });
    document.addEventListener('click', function (e) {
      if (!e.target.closest || !e.target.closest('.search')) {
        results.hidden = true;
        input.setAttribute('aria-expanded', 'false');
      }
    });
  }

  // "/" focuses the search from anywhere on the page, unless the user is already typing somewhere
  document.addEventListener('keydown', function (e) {
    var t = e.target;
    var typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey && input) {
      e.preventDefault();
      input.focus();
      input.select();
    }
  });

  // ---- shortcut card filter ----------------------------------------------------------------

  var kbdFilter = document.getElementById('kbd-filter');
  if (kbdFilter) {
    var rows = Array.prototype.slice.call(document.querySelectorAll('.kbd-row'));
    var groups = Array.prototype.slice.call(document.querySelectorAll('.kbd-group'));
    var count = document.getElementById('kbd-count');
    var empty = document.getElementById('kbd-empty');
    var total = rows.length;
    var applyKbd = function () {
      var words = kbdFilter.value.toLowerCase().trim().split(/\s+/).filter(Boolean);
      var visible = 0;
      rows.forEach(function (r) {
        var text = r.getAttribute('data-text');
        var ok = words.every(function (w) {
          return text.indexOf(w) !== -1;
        });
        r.hidden = !ok;
        if (ok) visible++;
      });
      groups.forEach(function (g) {
        g.hidden = !g.querySelector('.kbd-row:not([hidden])');
      });
      if (count) count.textContent = words.length ? visible + ' of ' + total + ' shortcuts' : total + ' shortcuts';
      if (empty) empty.hidden = visible !== 0;
    };
    kbdFilter.addEventListener('input', applyKbd);
    kbdFilter.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        kbdFilter.value = '';
        applyKbd();
      }
    });
    // Typing in the filter must not trigger the "/" shortcut or the guide's own keys
    kbdFilter.addEventListener('keydown', function (e) {
      e.stopPropagation();
    });
  }

  // ---- copy buttons -------------------------------------------------------------------------

  function copyText(text, btn) {
    var done = function () {
      var old = btn.textContent;
      btn.textContent = 'Copied';
      setTimeout(function () {
        btn.textContent = old;
      }, 1200);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () {
        fallbackCopy(text, done);
      });
    } else {
      fallbackCopy(text, done);
    }
  }

  function fallbackCopy(text, done) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      done();
    } catch (e) {
      /* no clipboard here: the text stays selectable on the page */
    }
    document.body.removeChild(ta);
  }

  document.querySelectorAll('.page pre').forEach(function (pre) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'copy-btn';
    btn.textContent = 'Copy';
    btn.setAttribute('aria-label', 'Copy this code');
    btn.addEventListener('click', function () {
      var code = pre.querySelector('code');
      copyText(code ? code.textContent : pre.textContent, btn);
    });
    pre.appendChild(btn);
  });

  // Inline paths and commands (code with a slash or a backslash) get a small copy button after them
  document.querySelectorAll('.page p code, .page li code, .page td code').forEach(function (code) {
    var text = code.textContent;
    if (text.length < 4 || (text.indexOf('\\') === -1 && text.indexOf('/') === -1) || text.indexOf(' ') !== -1 && text.indexOf('\\') === -1) return;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'inline-copy';
    btn.textContent = 'copy';
    btn.setAttribute('aria-label', 'Copy ' + text);
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      copyText(text, btn);
    });
    code.insertAdjacentElement('afterend', btn);
  });

  // ---- page outline highlight -------------------------------------------------------------

  var tocLinks = Array.prototype.slice.call(document.querySelectorAll('.toc a'));
  if (tocLinks.length && 'IntersectionObserver' in window) {
    var byId = {};
    tocLinks.forEach(function (a) {
      byId[a.getAttribute('href').slice(1)] = a;
    });
    var heads = Object.keys(byId)
      .map(function (id) {
        return document.getElementById(id);
      })
      .filter(Boolean);
    var obs = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) {
            tocLinks.forEach(function (a) {
              a.classList.remove('current');
            });
            var link = byId[en.target.id];
            if (link) link.classList.add('current');
          }
        });
      },
      { rootMargin: '-70px 0px -70% 0px' }
    );
    heads.forEach(function (h) {
      obs.observe(h);
    });
  }

  // ---- phone menu -------------------------------------------------------------------------

  var menuBtn = document.querySelector('.menu-btn');
  var sidebar = document.getElementById('sidebar');
  var scrim = document.querySelector('.scrim');
  function setMenu(open) {
    if (!sidebar) return;
    sidebar.classList.toggle('open', open);
    if (scrim) scrim.hidden = !open;
    if (menuBtn) menuBtn.setAttribute('aria-expanded', String(open));
  }
  if (menuBtn) {
    menuBtn.addEventListener('click', function () {
      setMenu(!sidebar.classList.contains('open'));
    });
  }
  if (scrim) {
    scrim.addEventListener('click', function () {
      setMenu(false);
    });
  }
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && sidebar && sidebar.classList.contains('open')) setMenu(false);
  });
})();
