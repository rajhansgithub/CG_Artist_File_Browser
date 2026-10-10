// Builds the user guide in docs/site/ from the Markdown pages in docs/site-src/content/.
//
//   node docs/site-src/build.mjs
//
// The output is plain static HTML, CSS and JavaScript that opens straight from disk and needs no server, so the
// committed files in docs/site/ are what users get. Run this script after editing a page or the shortcut list, then
// commit the regenerated files. It needs only Node (no packages). It fails when a page links to a missing page or
// anchor, or to a picture that is not in docs/site/assets/media/.

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CONTENT = join(HERE, 'content');
const OUT = join(HERE, '..', 'site');
const REPO = join(HERE, '..', '..');
const MEDIA = join(OUT, 'assets', 'media');
const REPO_URL = 'https://github.com/rajhansgithub/CG_Artist_File_Browser';

const { SHORTCUT_GROUPS } = await import(pathToFileURL(join(REPO, 'src', 'utils', 'shortcutList.js')).href);
const APP_VERSION = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')).version;

// Pictures of a dialog or small panel: shown at a smaller width so they stay sharp and in scale with the text
const COMPACT_PICTURES = new Set(['shortcut-cheatsheet', 'batch-converter', 'settings-themes']);

const LAYER_LABEL = { home: 'Start here', quick: 'Quick start', deep: 'Deep dive', shared: 'Both layers' };
const LAYER_ORDER = ['quick', 'deep', 'shared'];
const problems = [];

// ---------- pages -------------------------------------------------------------------------------------------

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : full.endsWith('.md') ? [full] : [];
  });
}

function parsePage(file) {
  const raw = readFileSync(file, 'utf8');
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) throw new Error(`${file}: missing front matter`);
  const meta = {};
  for (const line of match[1].split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  const key = relative(CONTENT, file).split(sep).join('/').replace(/\.md$/, '');
  return { key, meta, body: match[2], file, order: Number(meta.order || 99) };
}

const pages = walk(CONTENT).map(parsePage);
const byKey = new Map(pages.map((p) => [p.key, p]));
for (const p of pages) {
  p.out = join(OUT, `${p.key}.html`);
  p.url = `${p.key}.html`;
  p.depth = p.key.split('/').length - 1;
  p.prefix = '../'.repeat(p.depth) || './';
}

// ---------- markdown ----------------------------------------------------------------------------------------

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const slug = (s) =>
  s
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^a-z0-9 -]/g, '')
    .trim()
    .replace(/\s+/g, '-');

function uniqueId(base, used) {
  let id = base || 'section';
  let n = 2;
  while (used.has(id)) id = `${base}-${n++}`;
  used.add(id);
  return id;
}

// Turns one page's Markdown into HTML. Supported: headings, paragraphs, - and 1. lists, pipe tables, fenced code,
// > callouts (> **Tip:** ...), pictures ![alt](media:name.webp "caption"), links ([text](@key#anchor) for guide
// pages), **bold**, *italic*, `code`, and raw HTML blocks (a line starting with "<" up to the next blank line).
function renderMarkdown(page, src, ctx) {
  const out = [];
  const headings = [];
  const used = ctx.anchorIds;
  const lines = src.split('\n');
  let i = 0;

  const inline = (text) => {
    const codes = [];
    let t = text.replace(/`([^`]+)`/g, (_, c) => {
      codes.push(c);
      return `\u0000${codes.length - 1}\u0000`;
    });
    t = esc(t);
    t = t.replace(/!\[([^\]]*)\]\(media:([^)\s]+)\)/g, (_, alt, f) => `<img alt="${alt}" src="${page.prefix}assets/media/${f}">`);
    t = t.replace(/\[([^\]]+)\]\((@[^)\s]+|https?:\/\/[^)\s]+|#[^)\s]+)\)/g, (_, label, href) => {
      if (href.startsWith('@')) {
        const [target, anchor] = href.slice(1).split('#');
        const targetPage = byKey.get(target);
        if (!targetPage) {
          problems.push(`${page.key}: link to missing page @${target}`);
          return label;
        }
        if (anchor) {
          const known = ctx.anchorsOf(target);
          if (!known.has(anchor)) problems.push(`${page.key}: link to missing anchor @${target}#${anchor}`);
        }
        return `<a href="${page.prefix}${targetPage.url}${anchor ? '#' + anchor : ''}">${label}</a>`;
      }
      if (href.startsWith('#')) return `<a href="${href}">${label}</a>`;
      return `<a href="${href}" rel="noopener">${label}</a>`;
    });
    t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
    t = t.replace(/\u0000(\d+)\u0000/g, (_, n) => `<code>${esc(codes[Number(n)])}</code>`);
    return t;
  };

  const figure = (line) => {
    const m = line.match(/^!\[([^\]]*)\]\(media:([^)\s]+)(?:\s+"([^"]*)")?\)\s*$/);
    if (!m) return null;
    const [, alt, file, caption] = m;
    if (!existsSync(join(MEDIA, file))) problems.push(`${page.key}: missing picture ${file}`);
    const cap = caption ? `<figcaption>${inline(caption)}</figcaption>` : '';
    const kind = file.endsWith('.gif') ? 'animation' : 'screenshot';
    const compact = COMPACT_PICTURES.has(file.replace(/\.(webp|gif)$/, '')) ? ' compact' : '';
    return `<figure class="shot ${kind}${compact}"><img loading="lazy" alt="${esc(alt)}" src="${page.prefix}assets/media/${file}">${cap}</figure>`;
  };

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === '') {
      i++;
      continue;
    }

    if (line.startsWith('```')) {
      const lang = line.slice(3).trim();
      const code = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) code.push(lines[i++]);
      i++;
      out.push(`<pre><code class="language-${esc(lang || 'text')}">${esc(code.join('\n'))}</code></pre>`);
      continue;
    }

    if (line.trim() === '{{shortcuts}}') {
      const built = shortcutCard(used, headings);
      out.push(built);
      i++;
      continue;
    }

    const heading = line.match(/^(#{2,4})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      const text = heading[2].trim();
      const id = uniqueId(slug(text), used);
      if (level <= 3) headings.push({ level, text, id });
      out.push(`<h${level} id="${id}">${inline(text)}</h${level}>`);
      i++;
      continue;
    }

    if (line.startsWith('<')) {
      const block = [];
      while (i < lines.length && lines[i].trim() !== '') block.push(lines[i++]);
      out.push(block.join('\n'));
      continue;
    }

    const pic = figure(line);
    if (pic) {
      out.push(pic);
      i++;
      continue;
    }

    if (line.startsWith('> ')) {
      const quote = [];
      while (i < lines.length && lines[i].startsWith('>')) quote.push(lines[i++].replace(/^>\s?/, ''));
      const text = quote.join(' ').trim();
      const kind = (text.match(/^\*\*(Tip|Note|Warning|Good to know):\*\*/) || [])[1];
      const cls = kind ? `callout callout-${kind.toLowerCase().replace(/\s+/g, '-')}` : 'callout';
      const label = kind ? `<strong>${kind}:</strong> ` : '';
      out.push(`<aside class="${cls}">${label}${inline(text.replace(/^\*\*(Tip|Note|Warning|Good to know):\*\*\s*/, ''))}</aside>`);
      continue;
    }

    if (/^\s*[-*] /.test(line) || /^\d+\. /.test(line)) {
      const ordered = /^\d+\. /.test(line);
      const items = [];
      while (i < lines.length && (/^\s*[-*] /.test(lines[i]) || /^\d+\. /.test(lines[i]) || /^\s{2,}\S/.test(lines[i]))) {
        const l = lines[i];
        if (/^\s{2,}\S/.test(l) && items.length) items[items.length - 1] += ' ' + l.trim();
        else items.push(l.replace(/^\s*(?:[-*]|\d+\.)\s+/, ''));
        i++;
      }
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>${items.map((it) => `<li>${inline(it)}</li>`).join('')}</${tag}>`);
      continue;
    }

    if (line.trim().startsWith('|') && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(lines[i++]);
      const cells = (r) => r.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const head = cells(rows[0]);
      const body = rows.slice(2).map(cells);
      out.push(
        `<div class="table-wrap"><table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${body
          .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`)
          .join('')}</tbody></table></div>`
      );
      continue;
    }

    const para = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^(#{2,4}\s|```|> |\s*[-*] |\d+\. |<|!\[|\|)/.test(lines[i])
    ) {
      para.push(lines[i++].trim());
    }
    if (para.length === 0) {
      para.push(lines[i++].trim());
    }
    out.push(`<p>${inline(para.join(' '))}</p>`);
  }

  return { html: out.join('\n'), headings };
}

// The keyboard card is generated from src/utils/shortcutList.js, so it always matches the handlers in the app.
function shortcutCard(used, headings) {
  const keyHtml = (combo) => combo.map((k) => `<kbd>${esc(k)}</kbd>`).join('<span class="plus">+</span>');
  const groups = SHORTCUT_GROUPS.map((g) => {
    const id = uniqueId(slug(g.title), used);
    headings.push({ level: 2, text: g.title, id });
    const rows = g.items
      .map((item) => {
        const keys = item.keys.map(keyHtml).join('<span class="or">or</span>');
        const text = [g.title, ...item.keys.map((a) => a.join(' ')), item.action].join(' ');
        return `<tr class="kbd-row" data-text="${esc(text.toLowerCase())}"><td class="keys">${keys}</td><td>${esc(item.action)}</td></tr>`;
      })
      .join('');
    return `<section class="kbd-group" aria-labelledby="${id}"><h2 id="${id}">${esc(g.title)}</h2><div class="table-wrap"><table class="kbd-table"><tbody>${rows}</tbody></table></div></section>`;
  }).join('\n');
  const count = SHORTCUT_GROUPS.reduce((n, g) => n + g.items.length, 0);
  return `<div class="kbd-tools"><label class="kbd-filter"><span>Find a shortcut</span><input id="kbd-filter" type="search" placeholder="Try: copy, delete, zoom, E" autocomplete="off"></label><p class="kbd-count" id="kbd-count" aria-live="polite">${count} shortcuts</p></div>
${groups}
<p class="kbd-empty" id="kbd-empty" hidden>No shortcut matches. Try a shorter word, or search the whole guide with <kbd>/</kbd>.</p>`;
}

// ---------- pages out -----------------------------------------------------------------------------------------

const anchorCache = new Map();
const renderedPages = new Map();
// First pass renders every page so link checks can see every anchor.
for (const p of pages) {
  const ctx = { anchorIds: new Set(), anchorsOf: (key) => anchorCache.get(key) || new Set() };
  const { html, headings } = renderMarkdown(p, p.body, ctx);
  const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
  anchorCache.set(p.key, ids);
  renderedPages.set(p.key, { html, headings });
}
// Second pass: anchor checks now know every page's ids, so the first pass's problems are dropped and re-checked.
problems.length = 0;
for (const p of pages) {
  const ctx = { anchorIds: new Set(), anchorsOf: (key) => anchorCache.get(key) || new Set() };
  const { html, headings } = renderMarkdown(p, p.body, ctx);
  renderedPages.set(p.key, { html, headings });
}

const searchEntries = [];

function sectionsOf(html, title, layer, url) {
  const parts = html.split(/(?=<h2 id="[^"]+">)/);
  for (const part of parts) {
    const m = part.match(/^<h2 id="([^"]+)">(.*?)<\/h2>/);
    const text = part
      .replace(/<h2 id="[^"]+">.*?<\/h2>/, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\s+/g, ' ')
      .trim();
    searchEntries.push({
      t: title,
      s: m ? m[2].replace(/<[^>]+>/g, '') : '',
      u: m ? `${url}#${m[1]}` : url,
      l: layer,
      x: text.slice(0, 1400),
    });
  }
}

function navHtml(current) {
  const groups = LAYER_ORDER.map((layer) => {
    const items = pages
      .filter((p) => p.meta.layer === layer)
      .sort((a, b) => a.order - b.order || a.key.localeCompare(b.key));
    const links = items
      .map((p) => {
        const href = `${current.prefix}${p.url}`;
        const cur = p.key === current.key ? ' aria-current="page"' : '';
        return `<li><a href="${href}"${cur}>${esc(p.meta.nav || p.meta.title)}</a></li>`;
      })
      .join('');
    const sub = layer === 'quick' ? 'Surface level' : layer === 'deep' ? 'Details, one page per feature' : 'Useful for both';
    return `<div class="nav-group"><p class="nav-title">${LAYER_LABEL[layer]}<span>${sub}</span></p><ul>${links}</ul></div>`;
  }).join('');
  const home = current.key === 'index' ? ' aria-current="page"' : '';
  return `<div class="nav-group"><ul><li><a href="${current.prefix}index.html"${home}>Start here</a></li></ul></div>${groups}`;
}

function layerTargets(page) {
  const quickDefault = 'quick/tour';
  const deepDefault = 'deep/folders-and-network';
  const counter = page.meta.counterpart;
  const quickHref = page.meta.layer === 'deep' && counter ? counter : quickDefault;
  const deepHref = page.meta.layer === 'quick' && counter ? counter : deepDefault;
  return { quickHref, deepHref };
}

function pageHtml(p) {
  const { html, headings } = renderedPages.get(p.key);
  const layer = p.meta.layer;
  const counter = p.meta.counterpart ? byKey.get(p.meta.counterpart) : null;
  const toc = headings.filter((h) => h.level === 2 || h.level === 3);
  const tocHtml = toc.length
    ? `<aside class="toc" aria-label="On this page"><p class="toc-title">On this page</p><ul>${toc
        .map((h) => `<li class="l${h.level}"><a href="#${h.id}">${esc(h.text)}</a></li>`)
        .join('')}</ul></aside>`
    : '<aside class="toc" aria-label="On this page"></aside>';
  const { quickHref, deepHref } = layerTargets(p);
  const idx = pages
    .filter((x) => x.meta.layer === layer && layer !== 'home')
    .sort((a, b) => a.order - b.order || a.key.localeCompare(b.key));
  const at = idx.findIndex((x) => x.key === p.key);
  const prev = at > 0 ? idx[at - 1] : null;
  const next = at >= 0 && at < idx.length - 1 ? idx[at + 1] : null;
  const pager =
    prev || next
      ? `<nav class="pager" aria-label="Previous and next page">${
          prev ? `<a class="prev" href="${p.prefix}${prev.url}"><span>Previous</span>${esc(prev.meta.nav || prev.meta.title)}</a>` : '<span></span>'
        }${next ? `<a class="next" href="${p.prefix}${next.url}"><span>Next</span>${esc(next.meta.nav || next.meta.title)}</a>` : ''}</nav>`
      : '';
  const cross = counter
    ? `<aside class="cross"><span>${layer === 'quick' ? 'Want the details?' : 'Just the basics?'}</span><a href="${p.prefix}${counter.url}">${esc(counter.meta.title)} &rarr;</a></aside>`
    : '';
  const edit = `${REPO_URL}/blob/main/docs/site-src/content/${p.key}.md`;
  const isHome = p.key === 'index';
  const body = `${cross}\n${html}`;
  return `<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark light">
<title>${esc(p.meta.title)} · CG Artist File Browser guide</title>
<meta name="description" content="${esc(p.meta.summary || '')}">
<link rel="stylesheet" href="${p.prefix}assets/site.css">
<script>window.SITE_ROOT=${JSON.stringify(p.prefix)};try{var t=localStorage.getItem('cg_guide_theme');if(t)document.documentElement.setAttribute('data-theme',t)}catch(e){}</script>
</head>
<body class="layer-${layer}${isHome ? ' is-home' : ''}">
<a class="skip-link" href="#content">Skip to the text</a>
<header class="topbar">
  <button class="icon-btn menu-btn" type="button" aria-controls="sidebar" aria-expanded="false" aria-label="Show the page list">
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg>
  </button>
  <a class="brand" href="${p.prefix}index.html">CG Artist File Browser <span>guide</span></a>
  <nav class="levels" aria-label="Reading level">
    <a href="${p.prefix}${quickHref}.html" class="${layer === 'quick' ? 'on' : ''}">Quick start</a>
    <a href="${p.prefix}${deepHref}.html" class="${layer === 'deep' ? 'on' : ''}">Deep dive</a>
  </nav>
  <div class="search" role="search">
    <input id="search" type="search" placeholder="Search the guide" aria-label="Search the guide" autocomplete="off" aria-controls="results" aria-expanded="false">
    <kbd class="hint">/</kbd>
    <div id="results" class="results" role="listbox" hidden></div>
  </div>
  <button class="icon-btn theme-btn" type="button" aria-label="Switch between light and dark" title="Switch between light and dark">
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="2" fill="none"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/></svg>
  </button>
</header>
<div class="shell">
  <nav id="sidebar" class="sidebar" aria-label="Guide pages">${navHtml(p)}
    <p class="sidebar-foot">Version ${esc(APP_VERSION)}. Pictures are previews, see <a href="${p.prefix}shared/faq.html">FAQ</a>.</p>
  </nav>
  <main id="content" class="content" tabindex="-1">
    <article class="page">
      <p class="crumb">${esc(LAYER_LABEL[layer])}</p>
      <h1>${esc(p.meta.title)}</h1>
      ${p.meta.summary ? `<p class="summary">${esc(p.meta.summary)}</p>` : ''}
      ${body}
      <p class="page-foot">Found a mistake or something missing? <a href="${edit}" rel="noopener">Edit this page on GitHub</a>.</p>
    </article>
    ${pager}
  </main>
  ${tocHtml}
</div>
<div class="scrim" hidden></div>
<script src="${p.prefix}assets/search-index.js"></script>
<script src="${p.prefix}assets/site.js" defer></script>
</body>
</html>
`;
}

// ---------- write -------------------------------------------------------------------------------------------

for (const p of pages) {
  if (p.meta.counterpart && !byKey.has(p.meta.counterpart)) problems.push(`${p.key}: counterpart ${p.meta.counterpart} missing`);
  mkdirSync(dirname(p.out), { recursive: true });
  writeFileSync(p.out, pageHtml(p));
  sectionsOf(renderedPages.get(p.key).html, p.meta.title, p.meta.layer, p.url);
}

mkdirSync(join(OUT, 'assets'), { recursive: true });
writeFileSync(
  join(OUT, 'assets', 'search-index.js'),
  `// Generated by docs/site-src/build.mjs. Search runs in the browser, offline.\nwindow.SITE_SEARCH_INDEX = ${JSON.stringify(searchEntries)};\n`
);

if (problems.length) {
  console.error('Guide build found problems:\n- ' + problems.join('\n- '));
  process.exit(1);
}
console.log(`Guide built: ${pages.length} pages, ${searchEntries.length} search sections, in ${relative(REPO, OUT)}/`);
