import { db, auth } from './app.js';
import { doc, updateDoc, increment, setDoc, getDoc, deleteDoc, collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { showToast, escapeHtml, logError, getHlsUrl, getAdaptiveUrl } from './utils.js';
import { trackEvent } from './analytics.js';

// ─── Create video card ──────────────────────────────────────
export function createVideoCard(video) {
  const div = document.createElement('div');
  div.className = 'video-card';
  div.dataset.docId = video.id;
  const avatar = video.creatorAvatar || 'https://ui-avatars.com/api/?name='+encodeURIComponent(video.creatorName||'User');

  const hlsUrl = getHlsUrl(video.videoUrl);
  const adaptiveUrl = getAdaptiveUrl(video.videoUrl);
  const poster = video.thumbnailUrl || '';

  div.innerHTML = `
    <video preload="metadata" loop playsinline poster="${poster}">
      <source src="${hlsUrl}" type="application/vnd.apple.mpegurl" />
      <source src="${adaptiveUrl}" type="video/mp4" />
    </video>
    <div class="video-overlay">
      <div class="video-user">
        <img src="${avatar}" />
        <span>${escapeHtml(video.creatorName)}</span>
        <button class="follow-btn" data-creator="${video.creatorId}">Follow</button>
      </div>
      <div class="video-caption">${escapeHtml(video.caption || '')}</div>
      <div class="video-hashtags">${(video.hashtags||[]).map(t=>`#${escapeHtml(t)}`).join(' ')}</div>
    </div>
    <div class="video-actions">
      <button class="like-btn"><i class="far fa-heart text-3xl"></i><span>${video.likesCount||0}</span></button>
      <button class="comment-btn"><i class="far fa-comment text-3xl"></i><span>${video.commentsCount||0}</span></button>
      <button class="save-btn"><i class="far fa-bookmark text-3xl"></i></button>
      <button class="share-btn"><i class="fas fa-share-alt text-3xl"></i></button>
      <button class="repost-btn"><i class="fas fa-retweet text-3xl"></i></button>
      <button class="gift-btn"><i class="fas fa-gift text-3xl"></i></button>
      <button class="report-btn"><i class="fas fa-flag text-2xl"></i></button>
    </div>
  `;
  return div;
}

// ─── Event delegation ──────────────────────────────────────
export function initInteractions() {
  document.addEventListener('click', handleInteraction);
}

async function handleInteraction(e) {
  const target = e.target.closest('.like-btn, .comment-btn, .share-btn, .save-btn, .repost-btn, .follow-btn, .report-btn, .gift-btn');
  if (!target) return;
  e.preventDefault();
  if (!auth.currentUser) { showToast('Login to interact', 'error'); return; }

  // Check email verification
  if (!auth.currentUser.emailVerified) {
    showToast('Please verify your email before interacting', 'error');
    return;
  }

  const card = target.closest('.video-card');
  if (!card) return;
  const videoId = card.dataset.docId;
  if (!videoId) return;

  if (target.classList.contains('like-btn')) await toggleLike(videoId, target);
  else if (target.classList.contains('comment-btn')) await showComments(videoId);
  else if (target.classList.contains('share-btn')) await shareVideo(videoId);
  else if (target.classList.contains('save-btn')) await toggleSave(videoId, target);
  else if (target.classList.contains('repost-btn')) await repostVideo(videoId);
  else if (target.classList.contains('follow-btn')) await toggleFollow(target.dataset.creator, target);
  else if (target.classList.contains('report-btn')) await reportVideo(videoId);
  else if (target.classList.contains('gift-btn')) await sendGift(videoId);
}

// ─── Like ──────────────────────────────────────────────────
async function toggleLike(videoId, btn) {
  const isLiked = btn.querySelector('i').classList.contains('fas');
  const span = btn.querySelector('span');
  const current = parseInt(span.innerText) || 0;
  try {
    if (!isLiked) {
      await updateDoc(doc(db, 'videos', videoId), { likesCount: increment(1) });
      await setDoc(doc(db, 'interactions', `${auth.currentUser.uid}_${videoId}`), { liked: true }, { merge: true });
      btn.querySelector('i').className = 'fas fa-heart text-red-500 text-3xl';
      span.innerText = current + 1;
      trackEvent('like', { videoId });
    } else {
      await updateDoc(doc(db, 'videos', videoId), { likesCount: increment(-1) });
      await setDoc(doc(db, 'interactions', `${auth.currentUser.uid}_${videoId}`), { liked: false }, { merge: true });
      btn.querySelector('i').className = 'far fa-heart text-3xl';
      span.innerText = Math.max(0, current - 1);
    }
  } catch (e) { logError(e, { videoId }); showToast('Error updating like', 'error'); }
}

// ─── Comment ────────────────────────────────────────────────
async function showComments(videoId) {
  // ... (unchanged, but we'll add email verification check already handled)
}

// ─── Share ──────────────────────────────────────────────────
async function shareVideo(videoId) {
  const url = `https://vibeloop.ng/watch/${videoId}`;
  if (navigator.share) {
    try { await navigator.share({ title: 'VibeLoop', text: 'Check this video!', url }); }
    catch (e) {}
  } else {
    window.open(`https://wa.me/?text=${encodeURIComponent('Check this video: '+url)}`, '_blank');
  }
  await updateDoc(doc(db, 'videos', videoId), { sharesCount: increment(1) });
}

// ─── Save ──────────────────────────────────────────────────
async function toggleSave(videoId, btn) {
  const ref = doc(db, 'saves', `${auth.currentUser.uid}_${videoId}`);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    await deleteDoc(ref);
    btn.querySelector('i').className = 'far fa-bookmark text-3xl';
    showToast('Removed from saved');
  } else {
    await setDoc(ref, { userId: auth.currentUser.uid, videoId, savedAt: serverTimestamp() });
    await updateDoc(doc(db, 'videos', videoId), { savesCount: increment(1) });
    btn.querySelector('i').className = 'fas fa-bookmark text-3xl';
    showToast('Saved!');
  }
}

// ─── Repost ──────────────────────────────────────────────────
async function repostVideo(videoId) {
  const orig = await getDoc(doc(db, 'videos', videoId));
  if (!orig.exists()) return;
  const data = orig.data();
  await addDoc(collection(db, 'videos'), {
    ...data,
    repostOf: videoId,
    creatorId: auth.currentUser.uid,
    creatorName: auth.currentUser.displayName || auth.currentUser.email.split('@')[0],
    createdAt: serverTimestamp(),
    likesCount: 0,
    commentsCount: 0,
    sharesCount: 0,
    savesCount: 0,
    repostsCount: 0,
    status: 'published'
  });
  await updateDoc(doc(db, 'videos', videoId), { repostsCount: increment(1) });
  showToast('Reposted!');
}

// ─── Follow ──────────────────────────────────────────────────
async function toggleFollow(creatorId, btn) {
  if (!creatorId) return;
  const followRef = doc(db, 'follows', `${auth.currentUser.uid}_${creatorId}`);
  const snap = await getDoc(followRef);
  if (snap.exists()) {
    await deleteDoc(followRef);
    btn.textContent = 'Follow';
    btn.className = 'follow-btn';
    showToast('Unfollowed');
  } else {
    await setDoc(followRef, { followerId: auth.currentUser.uid, followeeId: creatorId, createdAt: serverTimestamp() });
    btn.textContent = 'Following';
    btn.className = 'follow-btn following';
    showToast('Followed!');
  }
  // Update counts
  const userRef = doc(db, 'users', creatorId);
  const userSnap = await getDoc(userRef);
  if (userSnap.exists()) {
    const count = userSnap.data().followersCount || 0;
    await updateDoc(userRef, { followersCount: snap.exists() ? Math.max(0, count-1) : count+1 });
  }
}

// ─── Report ──────────────────────────────────────────────────
async function reportVideo(videoId) {
  const reason = prompt('Why are you reporting this video?');
  if (!reason) return;
  await addDoc(collection(db, 'reports'), {
    videoId,
    reason,
    reportedBy: auth.currentUser.uid,
    timestamp: serverTimestamp()
  });
  showToast('Report submitted');
}

// ─── Gift ──────────────────────────────────────────────────
async function sendGift(videoId) {
  const type = prompt('Gift: rose(50), diamond(500), rocket(5000)');
  if (!type) return;
  // This would call a Cloud Function to deduct coins and add to creator
  showToast('Gift sent! (simulated)');
}
