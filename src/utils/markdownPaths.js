// Where the links and pictures of a Markdown document point. Pure helpers (no DOM), used by markdownRender.js.
// Handles drive paths (J:\Docs), network shares (\\server\share\Docs) and mixed slashes, like pathHelpers.js.

const SCHEME = /^([a-zA-Z][a-zA-Z0-9+.-]*):/;
const DRIVE_ABSOLUTE = /^[a-zA-Z]:[\\/]/;
const MARKDOWN_EXTENSIONS = ['.md', '.markdown'];

export function isMarkdownPath(path) {
  const lower = String(path || '').toLowerCase();
  return MARKDOWN_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function safeDecode(text) {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

// The root of a path ('C:', '\\server\share', '' for a relative one) and the folder names below it
function splitRoot(path) {
  const unc = path.match(/^[\\/]{2}([^\\/]+)[\\/]+([^\\/]+)(.*)$/);
  if (unc) {
    return { root: `\\\\${unc[1]}\\${unc[2]}`, rest: unc[3], sep: '\\' };
  }
  const drive = path.match(/^([a-zA-Z]:)(.*)$/);
  if (drive) {
    return { root: drive[1], rest: drive[2], sep: '\\' };
  }
  if (path.startsWith('/')) {
    return { root: '', rest: path, sep: '/', absolute: true };
  }
  return { root: '', rest: path, sep: path.includes('\\') ? '\\' : '/' };
}

function segmentsOf(text) {
  return text.split(/[\\/]+/).filter(Boolean);
}

// `rel` (a relative path with / or \ and .. parts) taken from the folder `baseDir`. A leading slash means the
// root of baseDir's drive or share. `..` never climbs above that root.
export function joinPath(baseDir, rel) {
  const base = splitRoot(baseDir || '');
  const startsAtRoot = /^[\\/]/.test(rel);
  const out = startsAtRoot ? [] : segmentsOf(base.rest);
  for (const part of segmentsOf(rel)) {
    if (part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  if (base.sep === '/') return `/${out.join('/')}`;
  const joined = out.join('\\');
  if (!base.root) return joined;
  return joined ? `${base.root}\\${joined}` : `${base.root}\\`;
}

// The Windows path a file: link points at ('file:///C:/a%20b.png' -> 'C:\a b.png', 'file://server/share/x' -> '\\server\share\x')
function fileUrlToPath(url) {
  const rest = url.replace(/^file:/i, '');
  const noQuery = rest.split(/[?#]/)[0];
  const decoded = safeDecode(noQuery);
  const drive = decoded.match(/^\/{2,3}([a-zA-Z]:.*)$/);
  if (drive) return drive[1].replace(/\//g, '\\');
  const host = decoded.match(/^\/\/([^/]+)(\/.*)?$/);
  if (host) return `\\\\${host[1]}${(host[2] || '').replace(/\//g, '\\')}`;
  return null;
}

// Classifies a link or image address found in a document at `baseDir`:
//   { kind: 'anchor', slug }        a heading in the same document (#section)
//   { kind: 'external', url }       http, https or mailto
//   { kind: 'data', url }           an inline data:image (pictures only)
//   { kind: 'local', path, slug? }  a file or folder on this PC or on a network share
//   null                            anything else (javascript:, vbscript:, custom schemes ...)
export function resolveReference(href, baseDir) {
  const text = String(href ?? '').trim();
  if (!text) return null;

  if (text.startsWith('#')) return { kind: 'anchor', slug: safeDecode(text.slice(1)) };

  if (/^data:image\//i.test(text)) return { kind: 'data', url: text };

  if (/^file:/i.test(text)) {
    const path = fileUrlToPath(text);
    return path ? { kind: 'local', path } : null;
  }

  // Windows drive letters look like a one-letter scheme, so they are checked first
  if (DRIVE_ABSOLUTE.test(text)) {
    const [pathPart, hash] = splitHash(text);
    return { kind: 'local', path: joinPath(pathPart, ''), slug: hash };
  }

  const scheme = text.match(SCHEME);
  if (scheme) {
    const name = scheme[1].toLowerCase();
    return name === 'http' || name === 'https' || name === 'mailto' ? { kind: 'external', url: text } : null;
  }

  // \\server\share and //server/share are network paths
  if (/^[\\/]{2}[^\\/]/.test(text)) {
    const [pathPart, hash] = splitHash(text);
    return { kind: 'local', path: joinPath(pathPart.replace(/\//g, '\\'), ''), slug: hash };
  }

  if (!baseDir) return null;
  const [pathPart, hash] = splitHash(text);
  const cleaned = safeDecode(pathPart.split('?')[0]);
  return { kind: 'local', path: joinPath(baseDir, cleaned), slug: hash };
}

function splitHash(text) {
  const at = text.indexOf('#');
  return at < 0 ? [text, ''] : [text.slice(0, at), safeDecode(text.slice(at + 1))];
}

// GitHub-style heading anchor: lower case, punctuation dropped, spaces turned into hyphens
export function slugify(text) {
  return String(text)
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '')
    .replace(/\s/g, '-');
}
