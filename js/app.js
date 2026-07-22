import { CONFIG } from './config.js';
import { initAuth } from './auth.js';
import { initFeed } from './feed.js';
import { initUpload } from './upload.js';
import { initProfile } from './profile.js';
import { initInteractions } from './interactions.js';
import { initChat } from './chat.js';
import { initNotifications } from './notifications.js';
import { initStories } from './stories.js';
import { initAdmin } from './admin.js';
import { initSettings } from './settings.js';
import { initAI } from './ai.js';
import { initAnalytics } from './analytics.js';
import { initLive } from './live.js';
import { initSearch } from './search.js';
import { showToast, logError } from './utils.js';
import { initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

// ─── Init Firebase ──────────────────────────────────────────
const app = initializeApp(CONFIG.FIREBASE);
const auth = getAuth(app);
const db = getFirestore(app);

// ─── Export for other modules ──────────────────────────────
export { auth, db };

// ─── Init all modules ──────────────────────────────────────
initAuth();
initFeed();
initUpload();
initProfile();
initInteractions();
initChat();
initNotifications();
initStories();
initAdmin();
initSettings();
initAI();
initAnalytics();
initLive();
initSearch();

// ─── Navigation ─────────────────────────────────────────────
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.nav;
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    switch (tab) {
      case 'feed': import('./feed.js').then(m => m.loadFeed(true)); break;
      case 'explore': import('./search.js').then(m => m.renderExplore()); break;
      case 'upload': document.getElementById('videoUploadInput').click(); break;
      case 'chat': import('./chat.js').then(m => m.renderChatList()); break;
      case 'profile': import('./profile.js').then(m => m.renderMyProfile()); break;
      default: break;
    }
  });
});

// ─── Upload FAB ─────────────────────────────────────────────
document.getElementById('uploadFab').addEventListener('click', () => {
  document.getElementById('videoUploadInput').click();
});

// ─── Global error handler ──────────────────────────────────
window.addEventListener('error', (event) => {
  logError(event.error || event.message, { source: 'global' });
});
