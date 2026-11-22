import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './styles/index.css';
import './styles/mac-shell.css';
import { setupTauriBridge } from './tauriBridge.js';
import { watchBridge, start as startAchievements } from './achievements/observer.js';

setupTauriBridge();
// Achievements (docs/ACHIEVEMENTS.md): watch only. The pop-ups and shaders load a moment after the app, on their own.
watchBridge(window.electronAPI);
startAchievements();
const loadAchievementMoments = () => import('./achievements/ui.js').then((m) => m.startMoments()).catch(() => {});
if (window.requestIdleCallback) window.requestIdleCallback(loadAchievementMoments, { timeout: 4000 });
else setTimeout(loadAchievementMoments, 1500);

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
