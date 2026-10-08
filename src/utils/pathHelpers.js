// Path helpers for the breadcrumb bar and "open the containing folder" logic.
// Handles drive paths (J:\Assets), network shares (\\server\share\Assets) and mixed slashes.

const UNC_PATTERN = /^[\\/]{2}[^\\/]/;

export function isUncPath(path) {
  return typeof path === 'string' && UNC_PATTERN.test(path);
}

// `\\server\share\a\b` -> ['server', 'share', 'a', 'b']
function splitSegments(path) {
  return path.split(/[\\/]+/).filter(Boolean);
}

// A share root keeps its trailing slash like a drive root (J:\)
function joinUnc(segments) {
  const joined = `\\\\${segments.join('\\')}`;
  return segments.length === 2 ? `${joined}\\` : joined;
}

// Folder that contains a file or folder path. '' when there is none.
export function getParentDir(path) {
  if (!path) return '';
  if (isUncPath(path)) {
    const segs = splitSegments(path);
    return segs.length > 2 ? joinUnc(segs.slice(0, -1)) : '';
  }
  const lastSlash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  let parent = lastSlash > 0 ? path.slice(0, lastSlash) : '';
  if (parent.endsWith(':')) {
    parent += '\\';
  }
  return parent;
}

// [{ name, path }] from the drive / share root down to the current folder
export function buildBreadcrumbs(currentPath) {
  if (!currentPath) return [];

  if (isUncPath(currentPath)) {
    const segs = splitSegments(currentPath);
    if (segs.length < 2) {
      return [{ name: `\\\\${segs[0]}`, path: `\\\\${segs[0]}` }];
    }
    const crumbs = [{ name: `\\\\${segs[0]}\\${segs[1]}`, path: joinUnc(segs.slice(0, 2)) }];
    for (let i = 3; i <= segs.length; i++) {
      crumbs.push({ name: segs[i - 1], path: joinUnc(segs.slice(0, i)) });
    }
    return crumbs;
  }

  const segments = currentPath.replace(/\\/g, '/').split('/').filter(Boolean);
  const crumbs = [];
  let accum = '';
  segments.forEach((seg, idx) => {
    accum += idx === 0 ? seg : '/' + seg;
    // Windows drive root fix (e.g., J: -> J:\)
    const full = idx === 0 && seg.endsWith(':') ? seg + '\\' : accum.replace(/\//g, '\\');
    crumbs.push({ name: seg, path: full });
  });
  return crumbs;
}
