import { db, auth } from './app.js';
import { collection, query, orderBy, limit, startAfter, getDocs, where, onSnapshot } from 'firebase/firestore';
import { createVideoCard } from './interactions.js';
import { showToast, logError, getAdaptiveUrl, getHlsUrl } from './utils.js';
import { CONFIG } from './config.js';
import { trackEvent } from './analytics.js';

let lastDoc = null;
let isLoading = false;
let hasMore = true;
let feedVideos = [];

export function initFeed() {
  const header = `
    <div class="feed-header">
      <div class="feed-tabs">
        <button class="feed-tab active" data-tab="forYou">For You</button>
        <button class="feed-tab" data-tab="following">Following</button>
      </div>
      <div class="feed-search">
        <i class="fas fa-search"></i>
        <input id="feedSearch" placeholder="Search videos..." />
      </div>
    </div>
    <div id="feedStack" class="feed-stack"></div>
    <div id="feedLoader" class="loader"></div>
  `;
  document.getElementById('contentArea').innerHTML = header;
  // Event listeners for tabs and search
  document.querySelectorAll('.feed-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.feed-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      resetFeed(tab.dataset.tab);
    });
  });
  document.getElementById('feedSearch').addEventListener('input', debounce((e) => {
    // Implement search filtering
  }, 500));

  resetFeed('forYou');
}

async function resetFeed(tab) {
  feedVideos = [];
  lastDoc = null;
  hasMore = true;
  document.getElementById('feedStack').innerHTML = '';
  document.getElementById('feedLoader').style.display = 'block';
  await loadFeed(true);
}

export async function loadFeed(reset = false) {
  if (isLoading || !hasMore) return;
  isLoading = true;
  let q = query(collection(db, 'videos'), where('status', '==', 'published'), orderBy('createdAt', 'desc'), limit(CONFIG.APP.feedPageSize));
  if (!reset && lastDoc) {
    q = query(q, startAfter(lastDoc));
  }
  try {
    const snap = await getDocs(q);
    if (snap.empty) { hasMore = false; isLoading = false; return; }
    lastDoc = snap.docs[snap.docs.length - 1];
    const videos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    feedVideos = reset ? videos : [...feedVideos, ...videos];
    renderVideos(videos, reset);
    videos.forEach(v => trackEvent('view', { videoId: v.id, creatorId: v.creatorId }));
  } catch (e) {
    logError(e, { location: 'loadFeed' });
    showToast('Failed to load feed', 'error');
  }
  isLoading = false;
}

function renderVideos(videos, reset) {
  const stack = document.getElementById('feedStack');
  if (reset) stack.innerHTML = '';
  videos.forEach(v => {
    const card = createVideoCard(v);
    stack.appendChild(card);
  });
  // Intersection observer for infinite scroll and autoplay
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const vid = entry.target.querySelector('video');
        if (vid) vid.play().catch(() => {});
        if (entry.target === stack.lastChild) loadFeed();
      } else {
        const vid = entry.target.querySelector('video');
        if (vid) vid.pause();
      }
    });
  }, { threshold: 0.5 });
  document.querySelectorAll('.video-card').forEach(c => observer.observe(c));
}

function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}
