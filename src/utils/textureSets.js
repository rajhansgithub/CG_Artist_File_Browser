/**
 * PBR texture set detection.
 *
 * A material is exported as several maps that share a base name: wood_basecolor.png, wood_normal.png,
 * wood_roughness.png. "View as texture set" groups them on request only. The grid always shows every
 * file on its own, and nothing is hidden or merged automatically.
 *
 * Matching is strict:
 *  - the file name must end in "<base><separator><known map suffix>", e.g. wood_normal, Wood-Normal, wood.nor_gl
 *  - the base must be identical (case-insensitive) and the files must be in the same folder
 *  - a set needs at least two different map roles, and each role may appear only once
 *    (wood_normal.png next to wood_normal.jpg is ambiguous, so no set is offered)
 */

// Image formats a texture map can be stored in
const TEXTURE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.tif', '.tiff', '.tga', '.exr', '.hdr']);

// Map roles and the suffixes that name them. Suffixes are matched against the whole end of the name,
// so "robot_arm" is not an ORM map and "wood_colors" is not a colour map.
const ROLE_SUFFIXES = [
  { role: 'albedo', label: 'Base colour', suffixes: ['base[_\\- ]?colou?r', 'albedo', 'diffuse', 'diff', 'colou?r'] },
  { role: 'normal', label: 'Normal', suffixes: ['normal[_\\- ]?(?:gl|dx|map)?', 'nor(?:[_\\- ]?(?:gl|dx))?', 'nrm', 'norm'] },
  { role: 'roughness', label: 'Roughness', suffixes: ['roughness', 'rough', 'rgh'] },
  { role: 'metallic', label: 'Metallic', suffixes: ['metallic', 'metalness', 'metal', 'mtl'] },
  { role: 'height', label: 'Height', suffixes: ['height', 'displacement', 'disp', 'bump'] },
  { role: 'ao', label: 'Ambient occlusion', suffixes: ['ambient[_\\- ]?occlusion', 'occlusion', 'ao'] },
  { role: 'opacity', label: 'Opacity', suffixes: ['opacity', 'alpha'] },
  { role: 'specular', label: 'Specular', suffixes: ['specular', 'spec'] },
  { role: 'emissive', label: 'Emissive', suffixes: ['emissive', 'emission', 'emit'] },
  { role: 'orm', label: 'ORM (packed)', suffixes: ['orm'] }
];

const ROLE_PATTERNS = ROLE_SUFFIXES.map(({ role, label, suffixes }) => ({
  role,
  label,
  // "<base><separator><suffix>" where the base is the shortest prefix that fits
  pattern: new RegExp(`^(.+?)[_\\-. ]+(?:${suffixes.join('|')})$`)
}));

function splitPath(path) {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return cut < 0 ? '' : path.slice(0, cut).toLowerCase();
}

// Returns { base, role, label } for a texture map file name, or null when the name is not a map
export function parseTextureMap(name) {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return null;
  const stem = name.slice(0, dot).toLowerCase();
  if (!TEXTURE_EXTENSIONS.has(name.slice(dot).toLowerCase())) return null;
  for (const { role, label, pattern } of ROLE_PATTERNS) {
    const match = pattern.exec(stem);
    // A base with no letters (a bare frame number) is never a material name
    if (match && /[a-z]/.test(match[1])) return { base: match[1], role, label };
  }
  return null;
}

// Finds the texture set a file belongs to within `items` (the files of one folder). Returns
// { base, maps: [{ role, label, item }] } with maps in ROLE_SUFFIXES order, or null when there is no set.
export function findTextureSet(item, items) {
  if (!item || item.isDirectory || item.isSequence) return null;
  const own = parseTextureMap(item.name);
  if (!own) return null;

  const folder = splitPath(item.path);
  const base = own.base;
  const byRole = new Map();
  for (const candidate of items) {
    if (candidate.isDirectory || candidate.isSequence) continue;
    if (splitPath(candidate.path) !== folder) continue;
    const parsed = parseTextureMap(candidate.name);
    if (!parsed || parsed.base !== base) continue;
    if (!byRole.has(parsed.role)) byRole.set(parsed.role, []);
    byRole.get(parsed.role).push({ role: parsed.role, label: parsed.label, item: candidate });
  }

  // Two files for one role (two formats, or two resolutions) means the set is unclear
  for (const candidates of byRole.values()) {
    if (candidates.length > 1) return null;
  }
  if (byRole.size < 2) return null;

  const maps = ROLE_SUFFIXES.filter(({ role }) => byRole.has(role)).map(({ role }) => byRole.get(role)[0]);
  // The base keeps the spelling of the clicked file (the match itself is case-insensitive)
  const stem = item.name.slice(0, item.name.lastIndexOf('.'));
  return { base: stem.slice(0, base.length), maps };
}
