import { db } from './app.js';
import { collection, query, where, getDocs, orderBy, limit } from 'firebase/firestore';
import { showToast, escapeHtml } from './utils.js';

export async function renderExplore() {
  const area = document.getElementById('contentArea');
  area.innerHTML = `
    <div class="search-container">
      <input id="globalSearch" placeholder="Search users, videos, hashtags..." />
      <div id="searchResults"></div>
    </div>
  `;
  document.getElementById('globalSearch').addEventListener('input', async (e) => {
    const q = e.target.value;
    if (q.length < 2) return;
    const results = await performSearch(q);
    renderSearchResults(results);
  });
}

export async function performSearch(queryText) {
  const results = { users: [], videos: [], hashtags: [] };
  if (!queryText || queryText.length < 2) return results;
  const q = queryText.toLowerCase();
  const end = q + '\uf8ff';

  try {
    const userSnap = await getDocs(query(collection(db, 'users'), where('username', '>=', q), where('username', '<=', end), limit(10)));
    results.users = userSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const videoSnap = await getDocs(query(collection(db, 'videos'), where('caption', '>=', q), where('caption', '<=', end), limit(10)));
    results.videos = videoSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) {
    showToast('Search failed', 'error');
  }
  return results;
}

function renderSearchResults(results) {
  const container = document.getElementById('searchResults');
  container.innerHTML = '';
  if (results.users.length) {
    const div = document.createElement('div');
    div.innerHTML = `<h3>Users</h3>`;
    results.users.forEach(u => {
      div.innerHTML += `<div>${escapeHtml(u.username)}</div>`;
    });
    container.appendChild(div);
  }
  if (results.videos.length) {
    const div = document.createElement('div');
    div.innerHTML = `<h3>Videos</h3>`;
    results.videos.forEach(v => {
      div.innerHTML += `<div>${escapeHtml(v.caption)}</div>`;
    });
    container.appendChild(div);
  }
}
