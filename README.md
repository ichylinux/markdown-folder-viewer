# Markdown Folder Viewer

A local-only Chrome extension (Manifest V3) for browsing Markdown files under a user-selected folder. It includes a recursive tree, file filtering, a table of contents, relative `.md` links, relative image paths, and a **small built-in Mermaid flowchart subset renderer**.

## Install
1. Extract the ZIP to a folder.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select this folder (the folder containing `manifest.json`).
5. Click the extension icon, then **Open viewer**, and choose a folder.

Requires Chrome 86 or newer (File System Access API).

## Development
```bash
npm test       # Markdown renderer tests (node --test, no dependencies)
npm run icons  # regenerate icons/icon{16,48,128}.png from tools/make-icons.mjs
```
Chrome does not accept SVG for manifest icons, so the PNGs are generated from the
same shapes as `icons/icon.svg` by a dependency-free Node script. Re-run
`npm run icons` after changing the design.

## Notes / limitations
- The extension has no host permissions and makes no network requests. Markdown rendering and sanitization are implemented locally in `markdown.js`.
- To keep the package self-contained and offline, the Markdown parser is a lightweight built-in renderer rather than the full CommonMark specification. It supports headings (ATX and setext), paragraphs, emphasis, inline code, fenced code blocks, links, images, blockquotes, lists, horizontal rules, and basic pipe tables. Nested lists are flattened to a single level, and raw HTML in source files is escaped rather than rendered.
- The Mermaid renderer currently supports simple `flowchart` / `graph` diagrams with `TD`, `TB`, `LR`, `RL`, and `BT` direction and basic node/edge syntax. It is not the full Mermaid engine; advanced Mermaid syntax is shown as source code instead of being rendered.
- Folder handles are saved in IndexedDB. After a browser restart Chrome usually needs permission again; the viewer offers a **Grant access** button so you do not have to re-pick the folder. If that fails, choose the folder again.
- Folder expand/collapse state and the current file are preserved when you switch documents; *Refresh* re-scans the folder and re-renders the active file.
- On first open, the viewer shows `README.md` (preferring one at the folder root) so the folder's landing page appears instead of the alphabetically first file. If no README exists, the first Markdown file is shown.
- Relative Markdown links are resolved inside the selected folder. Remote HTTP(S) links open in a new tab. Relative images are read from the selected folder.
- This extension is read-only; it does not modify local files.

## Security
Rendered Markdown HTML is sanitized against an explicit tag and attribute allowlist. Script-capable tags, event-handler attributes, and `javascript:`, `vbscript:`, `data:`, and `file:` URL schemes are removed. Control characters are stripped from URLs before the scheme check, since browsers ignore them when parsing. Source HTML is escaped by the renderer itself, so raw HTML never reaches the DOM. External links use `rel="noopener noreferrer"`.
