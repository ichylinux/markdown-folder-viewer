# Markdown Folder Viewer

A local-only Chrome extension (Manifest V3) for browsing Markdown files under a user-selected folder. It includes a recursive tree, file filtering, a table of contents, relative `.md` links, relative image paths, and a **small built-in Mermaid flowchart subset renderer**.

## Install
1. Extract the ZIP to a folder.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select this folder (the folder containing `manifest.json`).
5. Click the extension icon, then **Open viewer**, and choose a folder.

## Notes / limitations
- The extension has no host permissions and makes no network requests. Markdown rendering and sanitization are implemented locally in `markdown.js`.
- To keep the package self-contained and offline, the Markdown parser is a lightweight built-in renderer rather than the full CommonMark specification. It supports headings, paragraphs, emphasis, inline code, fenced code blocks, links, images, blockquotes, lists, horizontal rules, and basic pipe tables.
- The Mermaid renderer currently supports simple `flowchart` / `graph` diagrams with `TD`, `TB`, and `LR` direction and basic node/edge syntax. It is not the full Mermaid engine; advanced Mermaid syntax is shown as source code instead of being rendered.
- Folder handles are saved in IndexedDB. Chrome may require the user to grant permission again after a browser restart or permission change.
- Relative Markdown links are resolved inside the selected folder. Remote HTTP(S) links open in a new tab. Relative images are read from the selected folder.
- This extension is read-only; it does not modify local files.

## Security
Rendered Markdown HTML is sanitized against an explicit tag and attribute allowlist. Script-capable tags, event-handler attributes, and `javascript:`, `vbscript:`, and `data:` URL schemes are removed. External links use `rel="noopener noreferrer"`.
