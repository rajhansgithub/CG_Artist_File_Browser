# Achievements

Badges, XP and levels for real work in CG Artist File Browser. Added in 1.24.0. Built to the Emulsion Labs achievements
standard, so a level, a rank and a tier mean the same effort in every Emulsion Labs tool. Only the theme is this app's own.

Live preview (every version, shaders running): see `docs/achievements-preview.html`, published as the artifact
"CG Artist File Browser Achievements" (link at the end of this file).

## Rules

- Watch only. Achievements never change, wait on, slow or block the app's work. Every hook is wrapped so it cannot throw.
- Quality, not volume. Only files that really loaded and jobs that really finished count. Opening the same file again counts
  nothing (the last 1,000 counted files and jobs are remembered as short hashes, never as paths).
- Never take anything away. Failures give funny "Happy accidents" badges (10 XP). Totals, never streaks.
- No login, no server, no network, no new permissions. Saved on this PC only.
- FREE MODE: the app has no paid plan, so there are no paid tags, no "Welcome to Pro" badge and nothing locked behind money.
  Emulsion is earned slowly through the Emulsion gate (below).

## Scoring (shared by every Emulsion Labs tool, never tuned per tool)

- XP to the next level: `round(60 + 40 × level^1.25)`.
- Flat XP: +2 per finished job, +1 per small real action (a model, HDR, image or texture opened). At most 40 a day.
- Ladder XP per tier: 25, 50, 100, 250, 500, 1000, 2000. A big job can skip tiers; the XP is the sum of every tier passed.
- Showreel (set) XP per tier: 100, 200, 400, 800, 1500, 3000, 6000.
- Ranks: Bronze 1-4, Silver 5-9, Gold 10-14, Platinum 15-19, Diamond 20-29, Ruby 30-39, Emulsion 40+ (gate open only).
- Titles: Intern (1), Junior Artist (3), Artist (6), Senior Artist (8), Lead (12), Supervisor (16), VFX Legend (20).
- Seven tiers: Bronze, Silver, Gold, Platinum, Diamond, Ruby, Emulsion.

## Catalog (45 badges)

| Category | Badge | Counts | Tiers (Bronze → Emulsion) |
|---|---|---|---|
| Getting started | First Light | Open a folder with files in it | single, 25 XP |
| | Globetrotter | Folders on 3 different drives | single, 50 XP |
| | Deep Diver | A folder 10 levels deep | single, 50 XP |
| | Quick Draw | Quick Look 10 different files | single, 50 XP |
| | Color Coded | A colour label or tag | single, 25 XP |
| | Plugged In | Sign in to a network share | single, 50 XP |
| Reviewing | Model Citizen | Different 3D models opened, no error | 5, 25, 100, 400, 1500, 5000, 15000 |
| | Light Meter | Different HDR / EXR files opened | 5, 25, 100, 400, 1500, 5000, 15000 |
| | Dailies | Videos and sequences played to the end | 1, 10, 50, 200, 800, 3000, 8000 |
| | Lookdev Lead | Different pairs compared | 1, 10, 50, 200, 1000, 4000, 10000 |
| | Format Hopper | 3D models in 4 formats | single, 100 XP |
| | Reading Room | A PDF and a Markdown file | single, 25 XP |
| | Mip Master | A .tx or .tex texture | single, 50 XP |
| Organising | Mover & Shaker | Files copied or moved, finished | 10, 100, 500, 2000, 10000, 50000, 100000 |
| | Tidy Desk | Files and folders renamed | 5, 50, 250, 1000, 5000, 20000, 50000 |
| | Taxonomist | Files given a label or tags | 10, 100, 500, 2000, 10000, 50000, 100000 |
| | Clean Sweep | Files sent to the Recycle Bin or deleted | 10, 100, 500, 2000, 10000, 50000, 100000 |
| | Interior Designer | Custom folder icons set | 1, 5, 20, 50, 150, 400, 1000 |
| Pipeline | Factory Line | Files batch converted | 10, 100, 500, 2000, 10000, 50000, 100000 |
| | Hand Off | Files sent to another app or dragged out | 1, 25, 100, 500, 2000, 10000, 25000 |
| | Twin Finder | Duplicate scans run to the end | 1, 5, 20, 60, 150, 400, 1000 |
| | Conversion Therapy | A batch convert with zero failures | single, 50 XP |
| | Full Set | Open a PBR texture set | single, 50 XP |
| Mastery | Pipeline TD | Finished file changes in total | 100, 1000, 5000, 20000, 100000, 500000, 1000000 |
| | Omnivore | Every kind of viewer (10) | single, 250 XP |
| | Flawless Week | 7 days in a row with work and no failed job | single, 250 XP |
| | Big Batch | 500+ files in one batch, none failed | single, 250 XP |
| | Completionist | Every badge you can see | single, 500 XP |
| Loyalty | Regular | Days of real work | 3, 10, 30, 100, 250, 500, 1000 |
| | Still Here | Months with a day of real work | 2, 4, 6, 12, 24, 36, 48 |
| | Weekly Ritual | Weeks with 3+ days of real work | 1, 4, 12, 26, 52, 104, 156 |
| Happy accidents (10 XP) | It Worked on My Machine, Render Farm Is Down, 404 Share Not Found, Wrong Password Again, That's Not a File That's a Feeling, Pixel Soup, Conflict Resolution, Cancel Culture, Nothing to See Here | harmless failures | single |
| Secrets (shown as "?") | Night Shift, Weekend Warrior, Long Take, One Year In, Professional Clown | | single |

A "day of real work" is a day with a finished job or a real file opened. Opening the app and leaving it counts nothing.

Release switch: badges with a `feature` key show "Coming soon" unless the feature is in `SHIPPED` (src/achievements/core.js).

## Certified showreels (sets)

Three sets of four ladder badges. All four at a tier make that set's showreel of that metal (7 per set).

- The Reviewer: Model Citizen, Light Meter, Dailies, Lookdev Lead.
- The Wrangler: Mover & Shaker, Tidy Desk, Taxonomist, Clean Sweep.
- The Pipeline: Factory Line, Hand Off, Twin Finder, Pipeline TD.

## The Emulsion gate (FREE MODE)

Emulsion (tier 7) opens only when ALL of these hold, checked after each real event (never by a timer):

1. Level 30 or higher (about a year of normal use).
2. 180 days of real work, in at least 6 different months.
3. 3 ladder badges at Ruby.
4. Tool factor: 50,000 files organised (copied, moved, renamed, labelled, deleted, converted, handed off) and 1,000 3D models
   and HDR / EXR files reviewed (different files, loaded with no error).

When it opens: one moment (the bubble big, what was done to earn it, "Let's go"), then ladders already past their Emulsion
count climb quietly. Rank Emulsion also needs level 40. A showreel turns Emulsion when all four pieces are Emulsion.
The Achievements screen shows each condition honestly with a tick or "have / need".

## Theme: lens iris medals and certified showreels

Picked by the owner on 2026-11-21 (options: lens iris medal, clapperboard plaque, film plate).

- Why: the app is made for CG and VFX artists. What they are proud of comes from the camera and the screening room, so a
  medal whose face is a camera iris (six aperture blades round the icon) reads as theirs, and the blades catch the shader
  light well. Sets are framed film reels on a wall: "Certified Gold · The Wrangler".
- Tiers 1-4 (Bronze, Silver, Gold, Platinum): struck metal medal, brushed blades with shadows, a hex opening with the icon
  frosted inside, the badge, tier and date engraved round the rim on big medals.
- Tiers 5-6 (Diamond, Ruby): the same iris on a dark gunmetal plate, the rim carved from the stone, a real cut stone seen
  through the opening (refraction, dispersion, Fresnel, absorption).
- Tier 7 (Emulsion): the live soap bubble with the app's mark (the layers icon) inside. Same shader as every Emulsion Labs tool.
- Full view (1.26.0): the medal as a real 3D object in its Iris housing (the owner's pick, 2026-11-24). Real geometry,
  ray marched: the blades, rim and stone keep their depth at every angle, never a flat picture. Drag turns it any way
  (a flick keeps it turning, then it slows), the pointer tilts it, click / Enter / Space turns it over to its certificate
  (number `CGB-xxxx`). Diamond and Ruby are real cut stones seated in the ring; Emulsion is the live bubble held in the ring.
- Smooth by design: one shared WebGL context, programs compiled in the background while the cards show, then one 1 px
  draw each so the first full view frame never pays the compile; the flat medal shows until the first 3D frame is ready;
  no layout reads inside the frame loop; the cards' medals hold still while the full view is open; resolution adapts
  to keep 60 fps (it never removes geometry).

## Dust and cobwebs (1.26.0)

An earned medal slowly gathers dust on the shelf, and after about 20 days a cobweb, in real time. Polish in the full
view takes the cobweb off at once and some of the dust each rub. Only the look changes: no XP, nothing taken away. The
Emulsion bubble never ages. Kept per badge in this browser only, key `cgabAchWearV1` (`src/achievements/wear.js`):
`{ d: dust after the last polish, t: last polished, n: polishes }`. Same maths as the Achievements Lab, real days.

Theme contract: `shape: 'iris'` (gem.js shape 3), `metalLabel: 'Certified'`, `back: 'certificate'`, `pocketIcon: true`.

## Files

- `src/achievements/core.js`: pure logic (catalog, curve, apply, merge, normalize, gate). No UI. Tests: `npm run test:achievements`.
- `src/achievements/observer.js`: watches the bridge calls and job events, saves; the viewers call `opened` / `watched`.
- `src/achievements/level.js` + `pill.css`: the small level pill in the side rail (loads with the app).
- `src/achievements/ui.js` + `achievements.css`: screen, pop-ups, level-up, full view, settings (loads a moment after start).
- `src/achievements/medal3d.js` + `view3d.js`: the 3D medal in the full view (engine from the Achievements Lab, and its
  drag, flick, tilt and turn-over). `wear.js`: dust and cobwebs.
- `src/achievements/bubble.js`, `gem.js`: the live shaders (one shared WebGL context each, 60 fps, still frame with reduced motion,
  CSS / SVG fallback only where there is no WebGL).
- `src/components/AchievementsScreen.jsx`: React host for the screen and the Settings section.
- `src-tauri/src/achievements.rs`: `load_achievements` / `save_achievements`, two copies (local and roaming app data), merged on load.

## Storage

One small JSON object under 4 KB, key `cgabAchV1`:
`{ v, u (badge → first earned), k (badge → tier), kd (badge → day of each tier), ps (set → tier), lx, c (counters), f, d (today's flat XP), days, first, fm, dr, g (day the gate opened) }`.

- Saved to `achievements.json` in `%LOCALAPPDATA%` and `%APPDATA%` (roaming) app data, mirrored in the webview's storage.
  All copies merge on load by union / max (badges keep the earliest date, tiers and counters the highest), so nothing is lost.
- Kept in this browser only: the pop-up queue `cgabAchNewV1`, the recently counted hashes `cgabAchSeenV1`, settings `cgabAchCfgV1`.

## Preview artifact

CG Artist File Browser Achievements: https://claude.ai/artifact/3vC7a42btzsMjEwxKgt9gy

Source: `docs/achievements-preview.html`, built by `node docs/build-achievements-preview.mjs` from
`docs/achievements-preview.template.html` and `docs/achievements-preview.entry.js`. Republish to the same URL; each change adds a
version to the Versions bar.
