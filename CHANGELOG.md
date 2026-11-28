# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Bump `version` in both `manifest.json` and `package.json` when cutting a release.

## [Unreleased]

## [1.3.2] - 2026-11-28

### Fixed

- In-page anchor links and the browser back button restore the previous scroll position in the reader (viewer and `file://` Markdown pages), including when moving back to another file in the folder viewer.

## [1.3.1] - 2026-11-26

### Fixed

- Forgetting a folder clears it as the last-opened folder when it was still remembered that way, so reloading the extension no longer reopens and saves it again.

## [1.3.0] - 2026-11-24

### Added

- The folder tree pane can be resized by dragging the border between the pane and the document, or with the arrow keys while the border is focused. Double-clicking the border restores the default width, and the width is remembered across navigations.

## [1.2.5] - 2026-11-23

### Added

- `CHANGELOG.md` to track changes between releases.

### Fixed

- Ordered lists keep their numbering when an item spans several lines or contains a nested list; previously every item restarted at 1.
- Ordered lists that start above 1 (for example, after a heading in the middle of a numbered list) keep their start number.
- Nested lists render as nested instead of being flattened into the surrounding text.

## [1.2.4] - 2026-11-22

### Changed

- The generated table of contents starts collapsed.
- The viewer can be opened for any `file://` page, not only `.md` / `.mdown` / `.markdown` URLs.
- README lists strikethrough and the `<details>` / `<summary>` and HTML comment exceptions to HTML escaping.

## [1.2.3] - 2026-11-19

### Security

- Images may only point inside the document's folder; remote and protocol-relative images render as links, so opening a file makes no network request.
- Links use an allowlist of schemes (relative, http(s), `mailto`, `tel`).
- The sanitizer allows attributes per element, and nesting of `<details>` and blockquotes is capped at 32 levels.
- The sidebar iframe requires a nonce plus type, origin and source checks before the content script navigates.
- The extension CSP is pinned to `script-src 'self'; object-src 'none'`.

### Added

- Headless-Chrome DOM tests for the sanitizer and the content script, run by `npm test`.
- `npm run verify-package` fails a release when `dist/` drifts from the working tree.

## [1.2.2] - 2026-11-19

### Changed

- The saved folders list is collapsible.
- The start page explains why the containing folder must be picked when saving.

## [1.2.1] - 2026-11-15

### Added

- `npm run package` builds the Chrome Web Store ZIP.
- Chrome Web Store listing icon and screenshots.

### Changed

- Saved folders show their `file://` paths, and the folder picker is gone.
- Minimum Chrome version is 88, the Chrome Web Store minimum for Manifest V3.

### Fixed

- Mermaid flowcharts render again, with a corrected layout.

### Removed

- The `unlimitedStorage` permission.

## [1.2.0] - 2026-11-11

### Added

- Multiple folders can be saved and reopened from a start page shown by the popup.
- `<details>` / `<summary>` blocks render as collapsible sections.
- Scroll position in a Markdown file is kept across reloads.
- `README.md` is shown by default on first open.

### Changed

- Folders are scanned lazily; Refresh reads only the top level.
- HTML comments are hidden in rendered Markdown.
- Wider line spacing and no maximum width for the document body.

## [1.1.0] - 2026-11-11

### Added

- Setext headings and unique heading ids for the table of contents.
- One-click "Grant access" flow for expired folder permissions.
- PNG extension icons.

### Fixed

- Emphasis no longer corrupts URLs, code spans or link targets.
- Horizontal rules, tables and setext headings are no longer swallowed by a preceding paragraph.
- Folder expand/collapse state is kept when opening a file.
- Links such as `100%.md` no longer break the whole document.

### Security

- `javascript:`, `vbscript:`, `data:` and `file:` URLs are dropped at render time.

### Removed

- The unused `storage` permission.

## [1.0.0] - 2026-11-11

### Added

- Initial release: browse Markdown files under a selected folder with a folder tree, file filter, table of contents, relative links and images, and a built-in Mermaid flowchart subset renderer.

[Unreleased]: https://github.com/ichylinux/markdown-folder-viewer/compare/v1.3.1...HEAD
[1.3.1]: https://github.com/ichylinux/markdown-folder-viewer/compare/v1.3.0...v1.3.1
[1.3.0]: https://github.com/ichylinux/markdown-folder-viewer/compare/v1.2.5...v1.3.0
[1.2.5]: https://github.com/ichylinux/markdown-folder-viewer/compare/f8aea36...v1.2.5
