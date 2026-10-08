// The built-in folder icon library: neutral, original-style glyphs grouped for CG work.
// No software logos are bundled (they are trademarked); users import their own PNG/SVG/ICO images for those.
// Every id is saved in the user's settings, so an id must never be renamed or reused once released.
import {
  AppWindow,
  Archive,
  Aperture,
  AudioLines,
  Blocks,
  Bone,
  BookOpen,
  Bookmark,
  Bot,
  BrainCircuit,
  Brush,
  Box,
  Boxes,
  Building2,
  Camera,
  Car,
  Clapperboard,
  Cloud,
  Code,
  Cog,
  Contrast,
  Cpu,
  Database,
  Dices,
  DraftingCompass,
  Download,
  Droplets,
  Eye,
  Film,
  Flame,
  FileText,
  GitBranch,
  Gamepad2,
  Gem,
  Globe,
  GraduationCap,
  Grid3x3,
  HardDrive,
  Hammer,
  Heart,
  Image as ImageIcon,
  Images,
  Layers,
  Library,
  Lightbulb,
  Mic,
  MonitorPlay,
  Mountain,
  Move3d,
  Music,
  Network,
  Package,
  Paintbrush,
  Palette,
  PersonStanding,
  Pipette,
  Plug,
  Puzzle,
  Rocket,
  Rotate3d,
  Ruler,
  Scan,
  Shapes,
  Shirt,
  SlidersHorizontal,
  Sparkles,
  Spline,
  Star,
  Sticker,
  SunMedium,
  Tag,
  Terminal,
  TreePine,
  Type,
  Video,
  WandSparkles,
  Wind,
  Workflow,
  Wrench,
  Zap,
  createLucideIcon
} from 'lucide-react';

// A few CG-specific glyphs drawn in the same 24px outline style as the rest
const MeshIcon = createLucideIcon('FolderIconMesh', [
  ['path', { d: 'M12 3 4 8l2 9 6 4 6-4 2-9z', key: 'a' }],
  ['path', { d: 'M12 12V3', key: 'b' }],
  ['path', { d: 'M12 12 4 8', key: 'c' }],
  ['path', { d: 'M12 12l-6 5', key: 'd' }],
  ['path', { d: 'M12 12v9', key: 'e' }],
  ['path', { d: 'm12 12 6 5', key: 'f' }],
  ['path', { d: 'm12 12 8-4', key: 'g' }]
]);

const UvIcon = createLucideIcon('FolderIconUv', [
  ['rect', { x: '3', y: '3', width: '18', height: '18', rx: '2', key: 'a' }],
  ['path', { d: 'M7 7h4v5H7z', key: 'b' }],
  ['path', { d: 'm14 9 3-2 1.5 6H14z', key: 'c' }],
  ['path', { d: 'M7 15.5h5V18H7z', key: 'd' }]
]);

const SculptIcon = createLucideIcon('FolderIconSculpt', [
  ['path', { d: 'M4 16c-1.5-4 0-9 5-10.5 4.5-1.3 9 .5 10.5 4.5 1 3-.5 5-2.5 6.5-1.5 1.2-1 3.5-4 4s-6-.5-7-3.5c-.5-1.5-.5-1.8-2-1z', key: 'a' }],
  ['path', { d: 'M13 9.5c1.5.5 2.5 1.5 3 3', key: 'b' }]
]);

const MaterialIcon = createLucideIcon('FolderIconMaterial', [
  ['circle', { cx: '12', cy: '12', r: '9', key: 'a' }],
  ['path', { d: 'M8 9a5 5 0 0 1 3-3', key: 'b' }],
  ['path', { d: 'M4.5 14.5c4 2.5 11 2.5 15 0', key: 'c' }]
]);

// [id, label, glyph, search words]
const GROUPS = [
  [
    '3D & Modeling',
    [
      ['models', '3D Models', Box, 'obj fbx glb mesh asset'],
      ['scenes', 'Scenes', Boxes, 'scene layout set'],
      ['mesh', 'Meshes', MeshIcon, 'wireframe topology geometry'],
      ['sculpt', 'Sculpting', SculptIcon, 'zbrush clay sculpt'],
      ['characters', 'Characters', PersonStanding, 'character human person'],
      ['rigs', 'Rigs', Bone, 'rig skeleton bones armature'],
      ['props', 'Props', Package, 'prop object asset pack'],
      ['environments', 'Environments', Mountain, 'landscape terrain world'],
      ['architecture', 'Architecture', Building2, 'building archviz house city'],
      ['vehicles', 'Vehicles', Car, 'car vehicle automotive'],
      ['foliage', 'Foliage', TreePine, 'tree plant vegetation speedtree'],
      ['cloth', 'Cloth', Shirt, 'clothing garment fabric marvelous'],
      ['kitbash', 'Kitbash', Blocks, 'kit parts modular blocks'],
      ['scans', '3D Scans', Scan, 'scan photogrammetry lidar quixel megascans'],
      ['blueprints', 'Blueprints', DraftingCompass, 'blueprint plan drawing schematic technical'],
      ['procedural', 'Procedural', SlidersHorizontal, 'procedural hda digital asset parameters houdini']
    ]
  ],
  [
    'Texturing & Materials',
    [
      ['textures', 'Textures', Grid3x3, 'texture maps tileable'],
      ['materials', 'Materials', MaterialIcon, 'shader material pbr substance'],
      ['uvs', 'UV Maps', UvIcon, 'uv unwrap layout'],
      ['painting', 'Texture Painting', Paintbrush, 'paint painter brush'],
      ['brushes', 'Brushes', Brush, 'brush alpha stamp'],
      ['alphas', 'Alphas & Masks', Contrast, 'alpha mask stencil opacity'],
      ['decals', 'Decals', Sticker, 'decal sticker label'],
      ['palettes', 'Color Palettes', Palette, 'color colour palette swatch'],
      ['sampling', 'Color Sampling', Pipette, 'eyedropper color reference']
    ]
  ],
  [
    'Lighting & Rendering',
    [
      ['hdri', 'HDRIs', SunMedium, 'hdr exr environment sky dome'],
      ['lighting', 'Light Rigs', Lightbulb, 'light lighting studio lookdev'],
      ['renders', 'Renders', Aperture, 'render output beauty frames'],
      ['cameras', 'Cameras', Camera, 'camera lens shot'],
      ['lookdev', 'Look Dev', Eye, 'look development shading review']
    ]
  ],
  [
    'Compositing & VFX',
    [
      ['compositing', 'Compositing', Layers, 'comp nuke fusion layers'],
      ['nodes', 'Node Graphs', Workflow, 'nodes graph network procedural'],
      ['vfx', 'VFX', WandSparkles, 'effects magic fx'],
      ['fire', 'Fire & Explosions', Flame, 'fire explosion burn'],
      ['fluids', 'Fluids & Water', Droplets, 'water liquid ocean fluid'],
      ['smoke', 'Smoke & Wind', Wind, 'smoke wind air gas'],
      ['particles', 'Particles', Sparkles, 'particles dust sparks'],
      ['energy', 'Energy', Zap, 'lightning electric energy power'],
      ['volumes', 'Volumes & VDB', Cloud, 'vdb volume cloud']
    ]
  ],
  [
    'Animation',
    [
      ['animation', 'Animation', Clapperboard, 'anim shot clip'],
      ['curves', 'Curves & Splines', Spline, 'curve spline graph path'],
      ['mocap', 'Motion Capture', Move3d, 'mocap motion move capture'],
      ['turntables', 'Turntables', Rotate3d, 'turntable rotate spin 360']
    ]
  ],
  [
    'Media',
    [
      ['video', 'Videos', Film, 'video movie clip mov mp4'],
      ['footage', 'Footage', Video, 'footage plate stock camera'],
      ['music', 'Music', Music, 'music songs soundtrack'],
      ['sfx', 'Sound FX', AudioLines, 'sound sfx audio wave'],
      ['voice', 'Voice', Mic, 'voice vo dialogue record'],
      ['images', 'Images', ImageIcon, 'image picture png jpg'],
      ['photos', 'Photos', Images, 'photos gallery photography'],
      ['showreels', 'Showreels', MonitorPlay, 'showreel reel demo'],
      ['references', 'References', Bookmark, 'reference refs moodboard concept']
    ]
  ],
  [
    'Documents & Learning',
    [
      ['documents', 'Documents', FileText, 'document pdf text notes'],
      ['tutorials', 'Tutorials', GraduationCap, 'tutorial course learning training'],
      ['books', 'Books', BookOpen, 'book manual guide'],
      ['libraries', 'Libraries', Library, 'library collection'],
      ['fonts', 'Fonts', Type, 'font type typography'],
      ['archives', 'Archives', Archive, 'archive zip backup old']
    ]
  ],
  [
    'Code & Tools',
    [
      ['scripts', 'Scripts', Terminal, 'script python mel shell terminal'],
      ['code', 'Code', Code, 'code source programming'],
      ['plugins', 'Plugins', Plug, 'plugin plug-in addon'],
      ['addons', 'Add-ons', Puzzle, 'addon extension puzzle'],
      ['tools', 'Tools', Wrench, 'tools utilities system'],
      ['software', 'Software', AppWindow, 'software app application installer program'],
      ['automation', 'Automation', Bot, 'automation bot workflow'],
      ['ai', 'AI & ML', BrainCircuit, 'ai ml machine learning diffusion comfyui'],
      ['pipeline', 'Pipeline', GitBranch, 'pipeline version git branch'],
      ['settings', 'Settings', Cog, 'settings config preferences'],
      ['data', 'Data', Database, 'data database'],
      ['hardware', 'Hardware', Cpu, 'hardware cpu gpu system'],
      ['network', 'Network', Network, 'network share server']
    ]
  ],
  [
    'General',
    [
      ['star', 'Favorites', Star, 'star favorite best'],
      ['heart', 'Loved', Heart, 'heart love like'],
      ['projects', 'Projects', Rocket, 'project launch rocket'],
      ['premium', 'Premium', Gem, 'premium paid gem'],
      ['web', 'Web', Globe, 'web internet online globe'],
      ['downloads', 'Downloads', Download, 'download incoming'],
      ['storage', 'Storage', HardDrive, 'drive storage disk'],
      ['games', 'Games', Gamepad2, 'game games gamedev'],
      ['build', 'Work in Progress', Hammer, 'wip build working'],
      ['measure', 'Measurements', Ruler, 'ruler scale measure cad'],
      ['logos', 'Logos', Shapes, 'logo logos brand icons'],
      ['tags', 'Tagged', Tag, 'tag label'],
      ['misc', 'Misc', Dices, 'misc random other']
    ]
  ]
];

export const FOLDER_ICON_GROUPS = GROUPS.map(([title, icons]) => ({
  title,
  icons: icons.map(([id, label, Icon, words]) => ({ id, label, Icon, words }))
}));

const BY_ID = new Map();
for (const group of FOLDER_ICON_GROUPS) {
  for (const icon of group.icons) BY_ID.set(icon.id, icon);
}

export function getLibraryIcon(id) {
  return BY_ID.get(id) || null;
}
