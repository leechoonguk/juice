/**
 * Work the platform starts without the window: Android's home screen widget
 * runs as a background task in JavaScript. macOS keeps its widget in Swift, so
 * nothing registers here; Metro swaps this module on Android
 * (`metro.config.js`), which is why `index.js` can call it everywhere.
 */
export function registerBackgroundTasks(): void {}
