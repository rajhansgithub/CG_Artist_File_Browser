# GitHub Repository Reference & Configuration

> **IMPORTANT**: This document serves as the permanent configuration record for this project's GitHub repository.

---

## 📌 Repository Information

- **Repository Name**: `CG_Artist_File_Browser`
- **Owner**: `rajhansgithub`
- **Primary Branch**: `main`
- **Official Repository URL**: [https://github.com/rajhansgithub/CG_Artist_File_Browser](https://github.com/rajhansgithub/CG_Artist_File_Browser)
- **Git Clone (HTTPS)**: `https://github.com/rajhansgithub/CG_Artist_File_Browser.git`
- **Releases Page**: [https://github.com/rajhansgithub/CG_Artist_File_Browser/releases](https://github.com/rajhansgithub/CG_Artist_File_Browser/releases)
- **GitHub Actions (CI/CD)**: [https://github.com/rajhansgithub/CG_Artist_File_Browser/actions](https://github.com/rajhansgithub/CG_Artist_File_Browser/actions)
- **Issues Tracker**: [https://github.com/rajhansgithub/CG_Artist_File_Browser/issues](https://github.com/rajhansgithub/CG_Artist_File_Browser/issues)

---

## 📝 Historical Context

* **Consolidation**: The repository was previously hosted under the temporary name `CG_Artist_File_Browser_Tauri`.
* **Current Status**: It has been renamed to **`CG_Artist_File_Browser`**, consolidating all modern Rust + Tauri v2 + React 19 desktop features under the unified repository.

---

## 🔧 Git Remote Verification

To verify that local repositories are synced to the correct remote URL:

```bash
# Check current remote URL
git remote -v

# If remote needs to be updated:
git remote set-url origin https://github.com/rajhansgithub/CG_Artist_File_Browser.git

# Verify connection:
git fetch origin
```

---

## 🚀 Releasing New Versions

Automated release bundling and tagging script:

```bash
# Bump version, build local artifacts, tag git, and publish:
npm run release <version>

# Example:
npm run release 1.0.4
```
