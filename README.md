# Markdown Folder Viewer

A local-only Chrome extension (Manifest V3) for browsing Markdown files under a user-selected folder. It includes a lazily loaded folder tree, file filtering, a table of contents, relative `.md` links, relative image paths, and a **small built-in Mermaid flowchart subset renderer**.

## Install
1. Extract the ZIP to a folder.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select this folder (the folder containing `manifest.json`).
5. Click the extension icon, then **Open viewer**, and choose a folder.

Requires Chrome 86 or newer (File System Access API).

### Opening `file://` Markdown directly
The extension can also render a Markdown file opened directly in Chrome, such as `file:///home/me/notes/README.md`, so the address bar shows the real file path.

1. On `chrome://extensions`, open the extension's **Details** and turn on **Allow access to file URLs**.
2. Open a local `.md` file. The document is rendered, with the folder tree on the left.
3. The first time, click **Remember this folder** in the left pane and pick the folder that contains the open file (its own folder or any folder above it). Chrome does not allow a picker inside the pane, so a small window opens for this.

Chrome reveals only a picked folder's name, not its location, so the pane takes the location from the open file's path and saves the folder only if it really contains that file. Saved folders are listed in the pane and open with one click; opening any file under a saved folder from the address bar also switches the tree to it. When the current folder already contains the open file, **Remember this folder** saves the file's parent folder without a picker. Clicking a file in the tree navigates the tab to that file's `file://` URL. Expanded folders are remembered across navigations.

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
- Folders start collapsed and are scanned lazily: the initial load reads only the top level, and expanding a folder scans just that folder's direct children. Opening a relative link to a file in an unopened folder still works. The file counter reflects the levels loaded so far.
- The current document is preserved when you switch files.
- On first open, the viewer shows the top-level `README.md` so the folder's landing page appears instead of the alphabetically first file. If there is no top-level README, the first top-level Markdown file is shown.
- Relative Markdown links are resolved inside the selected folder. Remote HTTP(S) links open in a new tab. Relative images are read from the selected folder.
- This extension is read-only; it does not modify local files.

## Security
Rendered Markdown HTML is sanitized against an explicit tag and attribute allowlist. Script-capable tags, event-handler attributes, and `javascript:`, `vbscript:`, `data:`, and `file:` URL schemes are removed. Control characters are stripped from URLs before the scheme check, since browsers ignore them when parsing. Source HTML is escaped by the renderer itself, so raw HTML never reaches the DOM. External links use `rel="noopener noreferrer"`.
