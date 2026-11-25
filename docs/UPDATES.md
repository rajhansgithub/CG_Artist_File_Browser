# In-app updates

Settings > **Updates** checks for a newer version, shows what is new, then downloads and installs it.
The app also checks quietly once a day (can be turned off there) and puts a small blue dot on the Settings
button plus a notice in the corner when a new version is out. Nothing installs without a click.

Code: `src-tauri/src/app_update.rs` (Rust, uses `tauri-plugin-updater`), `src/utils/updateStore.js`,
`src/components/UpdateSection.jsx`, `src/components/UpdateNotice.jsx`. Release tools: `scripts/updater.js`.

## How it stays safe

| Risk | What stops it |
| :--- | :--- |
| A changed or fake download | Every file is signed with the release key. The app only installs a file whose signature matches the public key built into it (`tauri.conf.json > plugins.updater.pubkey`). |
| An old release passed off as new (downgrade) | The signature also names the version it was made for (`--app-version`, `requireSignedVersion: true`). A manifest that says 1.30.0 but points at the 1.24.0 file is refused. |
| Going backwards or onto a beta | Only a version newer than the running one, without a `-beta` style suffix, is offered. |
| Offline, proxy, slow line | The check gives up after 20 s, a stalled download after 60 s without data. The daily check fails silently and tries again later. The system proxy is used. |
| Download cut off | The signature check fails, nothing is changed. |
| Portable exe in a read-only folder | Found before the download; the message says to move it or use the download page. |
| New portable exe does not start | The old exe is kept as `<name>.old` and put back if the new one closes before its window opens. It is deleted once the new one runs. |
| Installer fails | The app reports "The update to vX did not finish" next time it opens, still on the old version. |

No account, token or secret is in the app. The only request is a plain HTTPS GET of `latest.json` and of the
file it names.

## The signing key (once per app)

```
npm run updater:keygen
```

Makes the key at `%USERPROFILE%\.tauri\cg-artist-file-browser-updater.key` (outside the repo) and writes its
public half into `src-tauri/tauri.conf.json`. **Back up the key file.** If it is lost, installed apps cannot be
updated any more and everyone has to download the app again by hand. Never commit it (`*.key` is gitignored).
Running keygen again reuses the existing key. Another location: set `TAURI_SIGNING_PRIVATE_KEY_PATH`.

## Every release

1. Build as usual (`npm run tauri:build`), copy the installer and the portable exe to `release/` with their
   usual names (`CG-Artist-File-Browser-Setup-v<ver>.exe`, `CG-Artist-File-Browser-v<ver>-Portable.exe`).
2. `npm run updater:sign -- <ver> --notes "What changed, in plain words"`
   signs both and writes `release/latest.json`.
3. Upload both exes **and `latest.json`** to the GitHub release `v<ver>`. Best: create the release as a draft,
   upload everything, then publish, so the app never sees a release without its `latest.json`.

`npm run release <ver> -- --notes "..."` does all three (draft, upload, publish).

The app reads `https://github.com/<owner>/<repo>/releases/latest/download/latest.json`. GitHub only serves
that without a login when the repo is **public**.

## Private apps (source stays private)

Never put a GitHub token in an app: anyone can pull it out of the exe. Instead publish only the release files
somewhere public:

1. **Public release mirror repo (recommended).** Make an empty public repo, for example
   `<owner>/<app>-releases`, that holds no source, only releases. Point the endpoint at it:
   `"endpoints": ["https://github.com/<owner>/<app>-releases/releases/latest/download/latest.json"]`.
   `npm run updater:sign` then writes download links to the mirror, and `npm run release` publishes the files
   there too. People can also download from that repo's Releases page.
2. **Any HTTPS static host** (your website, Cloudflare R2/Pages, S3). Upload `latest.json` and the two exes,
   set the endpoint to the `latest.json` URL and sign with `--base-url https://host/path/v<ver>`.
3. **Both.** `endpoints` is a list; the app tries them in order and uses the first that answers.

## latest.json

```json
{
  "version": "1.26.0",
  "notes": "What changed",
  "pub_date": "2026-12-01T10:00:00Z",
  "platforms": {
    "windows-x86_64":          { "url": ".../CG-Artist-File-Browser-Setup-v1.26.0.exe",    "signature": "<.sig content>" },
    "windows-x86_64-nsis":     { "url": ".../CG-Artist-File-Browser-Setup-v1.26.0.exe",    "signature": "<.sig content>" },
    "windows-x86_64-portable": { "url": ".../CG-Artist-File-Browser-v1.26.0-Portable.exe", "signature": "<.sig content>" }
  }
}
```

The installed app uses `windows-x86_64`, the portable exe `windows-x86_64-portable` (told apart by the
`uninstall.exe` the installer puts next to the app).

## Rules for later versions

- Keep the same key forever. A new key locks out every installed copy.
- A new portable exe must keep writing its ready file when started with `--update-ready=<path>` (done by
  `update_startup`), or the old exe waits 45 s before it closes.
- The first version with the updater is 1.25.0. Copies older than that must be updated by hand once.
