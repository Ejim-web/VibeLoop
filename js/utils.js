import { CONFIG } from './config.js';
const { cloudName, uploadPreset } = CONFIG.CLOUDINARY;

// ─── Cloudinary upload (supports resumable chunks) ──────────
export async function uploadToCloudinary(file, resourceType = 'video', options = {}) {
  const CHUNK_SIZE = 20 * 1024 * 1024; // 20 MB
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

  if (totalChunks === 1) {
    return uploadSingle(file, resourceType, options);
  }

  const uploadId = options.uploadId || `upload_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  let publicId = options.public_id || `video_${Date.now()}`;
  let uploadedBytes = 0;
  const savedState = getUploadState(uploadId);
  let startChunk = savedState ? savedState.chunk : 0;

  for (let i = startChunk; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, file.size);
    const chunk = file.slice(start, end);

    const formData = new FormData();
    formData.append('file', chunk);
    formData.append('upload_preset', uploadPreset);
    formData.append('resource_type', resourceType);
    formData.append('public_id', publicId);
    formData.append('upload_id', uploadId);
    formData.append('chunk_number', i + 1);
    formData.append('total_chunks', totalChunks);
    if (options.folder) formData.append('folder', options.folder);
    if (options.tags) formData.append('tags', options.tags);

    try {
      const response = await fetch(
        `https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/upload_large`,
        { method: 'POST', body: formData }
      );
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error?.message || `Chunk ${i+1} failed`);
      }
      const data = await response.json();
      uploadedBytes += chunk.size;
      saveUploadState(uploadId, i + 1, totalChunks, file.name);
      if (i === totalChunks - 1) {
        clearUploadState(uploadId);
        return data;
      }
    } catch (e) {
      console.warn(`Chunk ${i+1} failed:`, e);
      throw e;
    }
  }
}

async function uploadSingle(file, resourceType, options) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('upload_preset', uploadPreset);
  formData.append('resource_type', resourceType);
  if (options.folder) formData.append('folder', options.folder);
  if (options.tags) formData.append('tags', options.tags);
  if (options.public_id) formData.append('public_id', options.public_id);

  const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/upload`, {
    method: 'POST',
    body: formData,
  });
  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error?.message || 'Upload failed');
  }
  return response.json();
}

function getUploadState(uploadId) {
  try {
    return JSON.parse(localStorage.getItem(`upload_${uploadId}`));
  } catch { return null; }
}

function saveUploadState(uploadId, chunk, totalChunks, fileName) {
  localStorage.setItem(`upload_${uploadId}`, JSON.stringify({ chunk, totalChunks, fileName }));
}

function clearUploadState(uploadId) {
  localStorage.removeItem(`upload_${uploadId}`);
}

// ─── HLS streaming URL ───────────────────────────────────────
export function getHlsUrl(videoUrl) {
  const parts = videoUrl.split('/upload/');
  if (parts.length !== 2) return videoUrl;
  return `${parts[0]}/upload/vc_auto,hls/${parts[1]}`;
}

// ─── Optimized transformations ──────────────────────────────
export function getOptimizedUrl(url, options = {}) {
  const parts = url.split('/upload/');
  if (parts.length !== 2) return url;
  let transform = 'f_auto,q_auto,dpr_auto';
  if (options.width) transform += `,w_${options.width}`;
  if (options.height) transform += `,h_${options.height}`;
  if (options.crop) transform += `,c_${options.crop}`;
  if (options.quality) transform += `,q_${options.quality}`;
  return `${parts[0]}/upload/${transform}/${parts[1]}`;
}

export function getThumbnailUrl(url) {
  return getOptimizedUrl(url, { width: 540, height: 960, crop: 'fill' });
}

export function getLowResUrl(url) {
  return getOptimizedUrl(url, { width: 360 });
}

export function getHighResUrl(url) {
  return getOptimizedUrl(url, { width: 1080 });
}

// ─── Adaptive quality ──────────────────────────────────────
export function getAdaptiveUrl(url) {
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (!connection) return getOptimizedUrl(url, { quality: 70 });
  const quality = {
    'slow-2g': 20,
    '2g': 40,
    '3g': 60,
    '4g': 80,
  }[connection.effectiveType] || 70;
  return getOptimizedUrl(url, { quality });
}

// ─── Delete from Cloudinary (via Cloud Function) ────────────
export async function deleteFromCloudinary(publicId, resourceType = 'image') {
  const { deleteMedia } = await import('./cloudFunctions.js');
  return deleteMedia({ publicId, resourceType });
}

// ─── Toast ──────────────────────────────────────────────────
export function showToast(msg, type = 'info') {
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

export function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>"]/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[m]));
}

// ─── Error logging (async) ────────────────────────────────
export async function logError(error, context = {}) {
  console.error('VibeLoop Error:', error, context);
  try {
    const { reportError } = await import('./cloudFunctions.js');
    await reportError({ message: error.message, stack: error.stack, context });
  } catch (e) {
    // ignore
  }
}
