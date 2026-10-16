// Chrome MV3 uses promise-returning extension APIs on modern Chromium builds.
// Alias only inside the isolated extension content-script world.
if (typeof browser === 'undefined' && typeof chrome !== 'undefined') globalThis.browser = chrome;
