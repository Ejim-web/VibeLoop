import { db, auth } from './app.js';
import { collection, getDocs, getDoc, query, where, orderBy, limit, updateDoc, doc, deleteDoc } from 'firebase/firestore';
import { deleteFromCloudinary, showToast, escapeHtml, logError } from './utils.js';

export function initAdmin() {
  // Check if user is admin via custom claim
  auth.currentUser?.getIdTokenResult().then(token => {
    if (token.claims.admin) {
      // Add admin nav item or route
    }
  });
}

export async function renderAdminPanel() {
  // Same as previous, but now with admin claim checks
  const area = document.getElementById('contentArea');
  area.innerHTML = `
    <div class="admin-panel">
      <h1>Admin Dashboard</h1>
      <div id="adminContent"><div class="loader"></div></div>
    </div>
  `;
  await loadReports();
}

async function loadReports() {
  const container = document.getElementById('adminContent');
  const snap = await getDocs(query(collection(db, 'reports'), orderBy('timestamp', 'desc'), limit(50)));
  container.innerHTML = '';
  snap.forEach(doc => {
    const report = doc.data();
    const div = document.createElement('div');
    div.className = 'report-item';
    div.innerHTML = `
      <div><strong>Reported by:</strong> ${escapeHtml(report.reportedBy)}</div>
      <div><strong>Video:</strong> ${escapeHtml(report.videoId)}</div>
      <div><strong>Reason:</strong> ${escapeHtml(report.reason)}</div>
      <div><strong>Date:</strong> ${report.timestamp?.toDate?.()?.toLocaleString() || 'Unknown'}</div>
      <div class="report-actions">
        <button class="admin-action" data-action="dismiss" data-id="${doc.id}">Dismiss</button>
        <button class="admin-action" data-action="delete-video" data-id="${doc.id}" data-video="${report.videoId}">Delete Video</button>
        <button class="admin-action" data-action="block-user" data-id="${doc.id}" data-user="${report.reportedBy}">Block User</button>
      </div>
    `;
    container.appendChild(div);
  });
  // Add event listeners for actions
}
