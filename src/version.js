// Single source of truth for application version
// Populated at build time from package.json via Vite define
export const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'v1.1.0';
