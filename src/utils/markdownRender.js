// Turns the text of a Markdown file into a safe, ready-to-show piece of page.
//   marked          reads the Markdown (GitHub-style: tables, task lists, strikethrough, autolinks)
//   highlight.js    colours the code blocks (a short list of languages, so the viewer stays small)
//   DOMPurify       removes everything that could run code or load something unexpected, then hands back real DOM nodes
//                   (not a string), so the browser never parses the cleaned page a second time
// Pictures and links are resolved against the folder of the .md file, so `![](img/shot.gif)` shows the file next to
// the document, on a drive or on a network share. Nothing from the document is ever allowed to run as a script.
import { Marked } from 'marked';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import dos from 'highlight.js/lib/languages/dos';
import glsl from 'highlight.js/lib/languages/glsl';
import go from 'highlight.js/lib/languages/go';
import ini from 'highlight.js/lib/languages/ini';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import lua from 'highlight.js/lib/languages/lua';
import markdown from 'highlight.js/lib/languages/markdown';
import mel from 'highlight.js/lib/languages/mel';
import powershell from 'highlight.js/lib/languages/powershell';
import python from 'highlight.js/lib/languages/python';
import rust from 'highlight.js/lib/languages/rust';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import { resolveReference, slugify } from './markdownPaths.js';

const LANGUAGES = {
  bash, c, cpp, csharp, css, diff, dos, glsl, go, ini, java, javascript, json, lua, markdown, mel,
  powershell, python, rust, sql, typescript, xml, yaml
};
for (const [name, definition] of Object.entries(LANGUAGES)) hljs.registerLanguage(name, definition);
// Names people write after the opening fence that highlight.js does not know by itself
hljs.registerAliases(['html', 'svg', 'vue'], { languageName: 'xml' });
hljs.registerAliases(['sh', 'shell', 'zsh', 'console'], { languageName: 'bash' });
hljs.registerAliases(['bat', 'cmd', 'batch'], { languageName: 'dos' });
hljs.registerAliases(['ps1', 'pwsh'], { languageName: 'powershell' });
hljs.registerAliases(['toml'], { languageName: 'ini' });
hljs.registerAliases(['jsonc', 'json5'], { languageName: 'json' });
hljs.registerAliases(['frag', 'vert', 'hlsl'], { languageName: 'glsl' });

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const marked = new Marked({
  gfm: true,
  breaks: false,
  renderer: {
    // Coloured code with the language kept on the block for the label above it. Unknown languages stay plain.
    code({ text, lang }) {
      const name = String(lang || '').trim().split(/\s+/)[0].toLowerCase();
      const known = name && hljs.getLanguage(name);
      const body = known ? hljs.highlight(text, { language: name, ignoreIllegals: true }).value : escapeHtml(text);
      const cls = name ? ` language-${escapeHtml(name.replace(/[^\w+#-]/g, ''))}` : '';
      return `<pre><code class="hljs${cls}">${body}</code></pre>\n`;
    }
  }
});

// ---- Cleaning ---------------------------------------------------------------------------------------------------

// Everything except the plain HTML profile (no SVG, no MathML), minus forms, styles and anything that can hold state.
// Media tags are added so <video> and <audio> next to the document play.
const SANITIZE_CONFIG = {
  USE_PROFILES: { html: true },
  ADD_TAGS: ['video', 'audio', 'source'],
  FORBID_TAGS: ['style', 'form', 'button', 'textarea', 'select', 'option', 'optgroup', 'fieldset', 'label', 'script', 'iframe', 'object', 'embed', 'link', 'meta', 'base', 'track', 'map', 'area'],
  // `id` and `name` are dropped so a document cannot clobber the app's own page (headings get data-slug instead);
  // `style` and `srcset` could pull in remote files, and `autoplay` should never start by itself.
  FORBID_ATTR: ['style', 'id', 'name', 'srcset', 'sizes', 'autoplay', 'ping', 'formaction', 'target'],
  ALLOW_DATA_ATTR: false,
  RETURN_DOM_FRAGMENT: true
};

const purify = DOMPurify(window);
const MEDIA_TAGS = new Set(['IMG', 'VIDEO', 'AUDIO', 'SOURCE']);
// Attributes that hold an address. Only the two the hooks below rebuild themselves (a[href], img / video / audio / source [src])
// survive; any other one is removed.
const ADDRESS_ATTRIBUTES = ['href', 'src', 'poster', 'background', 'cite', 'longdesc', 'action', 'data', 'usemap', 'lowsrc', 'dynsrc', 'codebase', 'manifest', 'profile', 'icon'];

// Hooks read the addresses before DOMPurify's own checks (which would reject a Windows path) and write the final
// ones afterwards, built only from classifyReference() results, never copied from the document.
const originals = new WeakMap();
let renderContext = { baseDir: '', toAssetUrl: (path) => path };

function mediaUrl(src) {
  const ref = resolveReference(src, renderContext.baseDir);
  if (!ref) return null;
  if (ref.kind === 'data') return ref.url;
  if (ref.kind === 'local') return renderContext.toAssetUrl(ref.path);
  if (ref.kind === 'external' && /^https?:/i.test(ref.url)) return ref.url;
  return null;
}

purify.addHook('beforeSanitizeAttributes', (node) => {
  if (node.nodeType !== 1) return;
  if (node.tagName === 'A') originals.set(node, node.getAttribute('href'));
  else if (MEDIA_TAGS.has(node.tagName)) originals.set(node, node.getAttribute('src'));
});

purify.addHook('afterSanitizeAttributes', (node) => {
  if (node.nodeType !== 1) return;
  const tag = node.tagName;

  for (const name of ADDRESS_ATTRIBUTES) {
    if (node.hasAttribute(name) && !(tag === 'A' && name === 'href') && !(MEDIA_TAGS.has(tag) && name === 'src')) {
      node.removeAttribute(name);
    }
  }

  if (tag === 'A') {
    node.removeAttribute('href');
    const ref = resolveReference(originals.get(node), renderContext.baseDir);
    // The page itself never follows a link: clicks are caught by the viewer, which opens each one the right way
    node.setAttribute('href', '#');
    if (ref?.kind === 'anchor') {
      node.dataset.mdKind = 'anchor';
      node.dataset.mdSlug = ref.slug;
    } else if (ref?.kind === 'external') {
      node.dataset.mdKind = 'external';
      node.dataset.mdUrl = ref.url;
      if (!node.getAttribute('title')) node.setAttribute('title', ref.url);
    } else if (ref?.kind === 'local') {
      node.dataset.mdKind = 'local';
      node.dataset.mdPath = ref.path;
      node.dataset.mdSlug = ref.slug || '';
      if (!node.getAttribute('title')) node.setAttribute('title', ref.path);
    } else {
      node.dataset.mdKind = 'blocked';
    }
  } else if (MEDIA_TAGS.has(tag)) {
    const url = mediaUrl(originals.get(node));
    if (!url) {
      node.removeAttribute('src');
      if (tag === 'IMG') node.dataset.mdBroken = '1';
    } else {
      node.setAttribute('src', url);
    }
    if (tag === 'IMG') {
      // The file name, shown instead of the picture when it cannot be loaded
      const written = String(originals.get(node) || '').split('?')[0].split(/[\\/]/).pop();
      try {
        node.dataset.mdName = decodeURIComponent(written);
      } catch {
        node.dataset.mdName = written;
      }
      node.setAttribute('loading', 'lazy');
      node.setAttribute('decoding', 'async');
      node.setAttribute('referrerpolicy', 'no-referrer');
    } else if (tag !== 'SOURCE') {
      node.setAttribute('controls', '');
      node.setAttribute('preload', 'metadata');
      node.removeAttribute('poster');
    }
  } else if (tag === 'INPUT') {
    // Task list boxes are the only inputs a document may have, and they only show state
    if (node.getAttribute('type') === 'checkbox') node.setAttribute('disabled', '');
    else node.remove();
  }
});

// ---- Reading -----------------------------------------------------------------------------------------------------

// `---` block at the very top (YAML front matter): kept apart from the text and shown as a small note
function splitFrontMatter(text) {
  const match = text.match(/^﻿?---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/);
  if (!match) return { frontMatter: '', body: text };
  return { frontMatter: match[1], body: text.slice(match[0].length) };
}

const ALERT_KINDS = {
  note: 'Note',
  tip: 'Tip',
  important: 'Important',
  warning: 'Warning',
  caution: 'Caution'
};

// > [!NOTE] blocks (GitHub alerts) become labelled call-outs
function enhanceAlerts(root) {
  for (const quote of root.querySelectorAll('blockquote')) {
    const first = quote.firstElementChild;
    if (!first || first.tagName !== 'P') continue;
    const match = first.textContent.match(/^\s*\[!(note|tip|important|warning|caution)\]\s*/i);
    if (!match) continue;
    const kind = match[1].toLowerCase();

    // Remove the marker from the first text node(s) of the paragraph
    let toRemove = match[0].length;
    const walker = document.createTreeWalker(first, NodeFilter.SHOW_TEXT);
    let textNode = walker.nextNode();
    while (textNode && toRemove > 0) {
      const take = Math.min(toRemove, textNode.data.length);
      textNode.data = textNode.data.slice(take);
      toRemove -= take;
      textNode = walker.nextNode();
    }
    while (first.firstChild?.nodeType === 1 && first.firstChild.tagName === 'BR') first.firstChild.remove();
    if (!first.textContent.trim() && !first.querySelector('img')) first.remove();

    quote.classList.add('md-alert', `md-alert-${kind}`);
    const title = document.createElement('div');
    title.className = 'md-alert-title';
    title.textContent = ALERT_KINDS[kind];
    quote.prepend(title);
  }
}

// Label and Copy button above every code block
function enhanceCode(root) {
  for (const pre of root.querySelectorAll('pre')) {
    const code = pre.querySelector('code');
    const lang = (code?.className.match(/language-([\w+#-]+)/) || [])[1] || '';
    const frame = document.createElement('div');
    frame.className = 'md-code';
    const head = document.createElement('div');
    head.className = 'md-code-head';
    const label = document.createElement('span');
    label.className = 'md-code-lang';
    label.textContent = lang;
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'md-code-copy';
    copy.textContent = 'Copy';
    head.append(label, copy);
    pre.replaceWith(frame);
    frame.append(head, pre);
  }
}

// Wide tables scroll sideways inside their own box instead of stretching the page
function enhanceTables(root) {
  for (const table of root.querySelectorAll('table')) {
    const wrap = document.createElement('div');
    wrap.className = 'md-table-wrap';
    table.replaceWith(wrap);
    wrap.append(table);
  }
}

// Heading anchors (GitHub-style, repeated names get -1, -2 ...) and the list for the outline
function collectHeadings(root) {
  const seen = new Map();
  const headings = [];
  let index = 0;
  for (const heading of root.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
    const text = heading.textContent.replace(/\s+/g, ' ').trim();
    let slug = slugify(text) || 'section';
    const count = seen.get(slug) || 0;
    seen.set(slug, count + 1);
    if (count > 0) slug = `${slug}-${count}`;
    heading.dataset.mdSlug = slug;
    heading.dataset.mdIndex = String(index);
    headings.push({ index, slug, text, level: Number(heading.tagName[1]) });
    index += 1;
  }
  return headings;
}

/**
 * @param {string} text Markdown source
 * @param {{ baseDir: string, toAssetUrl: (path: string) => string }} options
 *   baseDir: folder of the .md file; toAssetUrl: how a local file is made loadable by the page
 * @returns {{ fragment: DocumentFragment, headings: Array<{index:number,slug:string,text:string,level:number}>, frontMatter: string, words: number }}
 */
export function renderMarkdown(text, { baseDir, toAssetUrl }) {
  const { frontMatter, body } = splitFrontMatter(text);
  renderContext = { baseDir, toAssetUrl: toAssetUrl || ((path) => path) };
  let fragment;
  try {
    fragment = purify.sanitize(marked.parse(body, { async: false }), SANITIZE_CONFIG);
  } finally {
    renderContext = { baseDir: '', toAssetUrl: (path) => path };
  }
  enhanceAlerts(fragment);
  enhanceCode(fragment);
  enhanceTables(fragment);
  const headings = collectHeadings(fragment);
  const words = (fragment.textContent.match(/\S+/g) || []).length;
  return { fragment, headings, frontMatter, words };
}
