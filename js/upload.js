import { db, auth } from './app.js';
import { collection, addDoc, serverTimestamp, doc, updateDoc, getDoc } from 'firebase/firestore';
import { uploadToCloudinary, showToast, logError } from './utils.js';
import { CONFIG } from './config.js';
import { checkRateLimit } from './cloudFunctions.js';

let isUploading = false;

export function initUpload() {
  document.getElementById('navUpload').addEventListener('click', openUploadModal);
  document.getElementById('uploadFab').addEventListener('click', openUploadModal);
  document.getElementById('videoUploadInput').addEventListener('change', handleFileSelect);
}

function openUploadModal() {
  // Show upload options (video, photo, carousel, draft)
  // Simplified: we directly trigger file input for video
  document.getElementById('videoUploadInput').click();
}

async function handleFileSelect(e) {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > CONFIG.APP.maxUploadSize) {
    showToast(`File too large (max ${CONFIG.APP.maxUploadSize/1024/1024}MB)`, 'error');
    return;
  }
  // Check email verification
  if (!auth.currentUser.emailVerified) {
    showToast('Please verify your email before uploading', 'error');
    return;
  }
  // Rate limit check
  try {
    await checkRateLimit({ type: 'upload' });
  } catch (e) {
    showToast('Upload limit exceeded. Try again later.', 'error');
    return;
  }
  const metadata = await showUploadForm(file);
  if (!metadata) return;
  if (metadata.draft) {
    await saveDraft(file, metadata);
  } else {
    await publishVideo(file, metadata);
  }
  e.target.value = '';
}

function showUploadForm(file) {
  return new Promise((resolve) => {
    const modal = document.createElement('div');
    modal.className = 'edit-modal';
    modal.innerHTML = `
      <div class="edit-modal-content">
        <h2>Post Details</h2>
        <input id="captionInput" placeholder="Caption..." />
        <input id="hashtagsInput" placeholder="#hashtags (comma separated)" />
        <div class="upload-actions" style="margin-top:16px; display:flex; gap:8px; justify-content:flex-end;">
          <button class="cancel-btn" id="cancelUpload">Cancel</button>
          <button class="save-btn" id="saveDraftBtn">Save Draft</button>
          <button class="save-btn" id="publishBtn">Publish</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    modal.querySelector('#cancelUpload').addEventListener('click', () => { modal.remove(); resolve(null); });
    modal.querySelector('#saveDraftBtn').addEventListener('click', () => {
      const data = {
        caption: document.getElementById('captionInput').value,
        hashtags: document.getElementById('hashtagsInput').value.split(',').map(s=>s.trim()).filter(Boolean),
        draft: true
      };
      modal.remove();
      resolve(data);
    });
    modal.querySelector('#publishBtn').addEventListener('click', () => {
      const data = {
        caption: document.getElementById('captionInput').value,
        hashtags: document.getElementById('hashtagsInput').value.split(',').map(s=>s.trim()).filter(Boolean),
        draft: false
      };
      modal.remove();
      resolve(data);
    });
  });
}

async function publishVideo(file, metadata) {
  if (isUploading) return;
  isUploading = true;
  showToast('Uploading to Cloudinary...', 'info');
  try {
    const data = await uploadToCloudinary(file, 'video', {
      folder: `videos/${auth.currentUser.uid}`,
      tags: ['feed', 'video'],
    });
    const videoUrl = data.secure_url;
    const publicId = data.public_id;
    // Optimized URLs
    const thumbnailUrl = getThumbnailUrl(videoUrl);
    const lowResUrl = getLowResUrl(videoUrl);
    const highResUrl = getHighResUrl(videoUrl);

    // Moderate using Cloud Function
    const { moderateVideo } = await import('./cloudFunctions.js');
    const moderation = await moderateVideo({ publicId });

    await addDoc(collection(db, 'videos'), {
      ...metadata,
      videoUrl,
      thumbnailUrl,
      lowResUrl,
      highResUrl,
      publicId,
      creatorId: auth.currentUser.uid,
      creatorName: auth.currentUser.displayName || auth.currentUser.email.split('@')[0],
      creatorAvatar: auth.currentUser.photoURL || '',
      likesCount: 0,
      commentsCount: 0,
      sharesCount: 0,
      savesCount: 0,
      repostsCount: 0,
      status: moderation.status === 'approved' ? 'published' : 'pending',
      moderation: moderation.flags,
      createdAt: serverTimestamp(),
    });
    showToast('Video published!');
  } catch (e) {
    logError(e, { file: file.name });
    showToast('Upload failed: ' + e.message, 'error');
  } finally {
    isUploading = false;
  }
}

async function saveDraft(file, metadata) {
  try {
    const data = await uploadToCloudinary(file, 'video', { folder: `drafts/${auth.currentUser.uid}`, tags: ['draft'] });
    await addDoc(collection(db, 'videos'), {
      ...metadata,
      videoUrl: data.secure_url,
      publicId: data.public_id,
      creatorId: auth.currentUser.uid,
      creatorName: auth.currentUser.displayName,
      status: 'draft',
      createdAt: serverTimestamp(),
    });
    showToast('Draft saved!');
  } catch (e) {
    logError(e);
    showToast('Failed to save draft', 'error');
  }
}
