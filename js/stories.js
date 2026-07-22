import { db, auth } from './app.js';
import { collection, doc, setDoc, getDoc, getDocs, query, where, orderBy, deleteDoc, updateDoc, serverTimestamp, increment, addDoc, limit, Timestamp } from 'firebase/firestore';
import { uploadToCloudinary, showToast, logError } from './utils.js';
import { CONFIG } from './config.js';
import { checkRateLimit } from './cloudFunctions.js';

const MAX_RETRIES = 3;

export async function createStory(file, type = 'photo', caption = '') {
  if (!auth.currentUser) { showToast('Login to post stories', 'error'); return; }
  if (file.size > CONFIG.APP.maxUploadSize) {
    showToast(`File too large (max ${CONFIG.APP.maxUploadSize/1024/1024}MB)`, 'error');
    return;
  }
  if (!auth.currentUser.emailVerified) {
    showToast('Please verify your email before posting stories', 'error');
    return;
  }
  try {
    await checkRateLimit({ type: 'story' });
  } catch (e) {
    showToast('Story limit exceeded. Try again later.', 'error');
    return;
  }

  let attempt = 0;
  let mediaData = null;
  while (attempt < MAX_RETRIES && !mediaData) {
    try {
      attempt++;
      const resourceType = type === 'video' ? 'video' : 'image';
      mediaData = await uploadToCloudinary(file, resourceType, {
        folder: `stories/${auth.currentUser.uid}`,
        tags: ['story'],
        transformation: 'f_auto,q_auto,vc_auto,dpr_auto',
      });
    } catch (e) {
      console.warn(`Story attempt ${attempt} failed:`, e);
      if (attempt >= MAX_RETRIES) throw e;
      await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }
  if (!mediaData) { showToast('Failed to upload story', 'error'); return; }

  const expiresAt = new Date(Date.now() + CONFIG.APP.storyDuration);
  await addDoc(collection(db, 'stories'), {
    userId: auth.currentUser.uid,
    userName: auth.currentUser.displayName || auth.currentUser.email.split('@')[0],
    userAvatar: auth.currentUser.photoURL || '',
    mediaUrl: mediaData.secure_url,
    publicId: mediaData.public_id,
    type,
    caption,
    duration: mediaData.duration || 0,
    createdAt: serverTimestamp(),
    expiresAt: Timestamp.fromDate(expiresAt),
    views: 0,
  });
  showToast('Story posted!');
}
