// Minimal chrome.* stub for running page.js (a content script) in a plain page.
window.chrome = {
  runtime: {
    getURL: (path) => 'chrome-extension://testid/' + path,
  },
};
