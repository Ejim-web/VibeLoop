import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, collection, doc, setDoc, getDoc, getDocs, updateDoc, addDoc, deleteDoc, query, where, orderBy, limit, startAfter, onSnapshot, increment, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getStorage, ref, uploadBytesResumable, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";
import { getMessaging, getToken } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-functions.js";

const firebaseConfig = {
  apiKey: "AIzaSyCr1IkJ6_SMhTJvY3K3GG6SoIRe1LOZ0nQ",
  authDomain: "vibeloop-44c45.firebaseapp.com",
  projectId: "vibeloop-44c45",
  storageBucket: "vibeloop-44c45.appspot.com",
  messagingSenderId: "776248914692",
  appId: "1:776248914692:web:b883192e8498e5a5351651"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);
const functions = getFunctions(app);
const messaging = getMessaging(app);
const googleProvider = new GoogleAuthProvider();

const addCoins = httpsCallable(functions, 'addCoins');
const sendGift = httpsCallable(functions, 'sendGift');
const sendNotification = httpsCallable(functions, 'sendNotification');

// Global state
let currentUser = null;
let activeTab = 'feed';
let feedVideos = [];
let lastVideoDoc = null;
let isLoading = false;
let videoObserver = null;
let watchStartTimes = new Map();
let sessionCount = parseInt(localStorage.getItem('sessionCount') || 0);
let notificationsRequested = false;
let unsubscribeComments = null;

function showToast(msg, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `fixed bottom-20 left-4 right-4 z-[100] p-3 rounded-xl text-center text-sm font-semibold shadow-2xl transition-all duration-300 ${type === 'error' ? 'bg-red-600' : 'bg-black/80 backdrop-blur-lg'} text-white`;
  toast.innerText = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2500);
}

function escapeHtml(str) { return str?.replace(/[&<>]/g, m => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;' }[m])) || ''; }

// Notifications
async function requestNotificationPermission() {
  if (notificationsRequested) return;
  notificationsRequested = true;
  try {
    const token = await getToken(messaging, { vapidKey: 'YOUR_VAPID_KEY' });
    await updateDoc(doc(db, 'users', currentUser.uid), { fcmToken: token });
    showToast("Notifications enabled");
  } catch (e) { console.log("Notification denied"); }
}

// Video compression (only >15MB)
async function loadFFmpeg() {
  if (window.FFmpegLoaded) return;
  await import('https://unpkg.com/@ffmpeg/ffmpeg@0.12.6/dist/ffmpeg.min.js');
  await import('https://unpkg.com/@ffmpeg/core@0.12.6/dist/ffmpeg-core.js');
  window.FFmpegLoaded = true;
}
async function compressVideo(file, targetWidth = 540) {
  if (!window.FFmpegLoaded) { showToast("Loading compressor...", "info"); await loadFFmpeg(); }
  return new Promise(async (resolve) => {
    try {
      const { createFFmpeg, fetchFile } = window.FFmpeg;
      const ff = createFFmpeg({ log: false });
      await ff.load();
      ff.FS('writeFile', 'input.mp4', await fetchFile(file));
      await ff.run('-i', 'input.mp4', '-vf', `scale=${targetWidth}:-2`, '-b:v', '800k', '-preset', 'fast', 'output.mp4');
      const data = ff.FS('readFile', 'output.mp4');
      resolve(new Blob([data.buffer], { type: 'video/mp4' }));
    } catch (err) { resolve(file); }
  });
}
async function uploadVideo(file, caption) {
  const banned = ['spam','scam','sex','porn','hate'];
  if (banned.some(w => caption.toLowerCase().includes(w))) return showToast("Banned word", "error");
  if (file.size > 50*1024*1024) return showToast("Max 50MB", "error");
  let processed = file;
  if (file.size > 15*1024*1024) {
    showToast("Compressing...", "info");
    processed = await compressVideo(file, 540);
  }
  const videoId = Date.now()+'_'+Math.random().toString(36);
  const storageRef = ref(storage, `raw_videos/${videoId}.mp4`);
  const task = uploadBytesResumable(storageRef, processed);
  task.on('state_changed', (snap) => {
    const pct = (snap.bytesTransferred / snap.totalBytes)*100;
    if (Math.floor(pct)%20===0) showToast(`Upload ${Math.floor(pct)}%`);
  }, err => showToast(err.message,"error"), async () => {
    const url = await getDownloadURL(task.snapshot.ref);
    const hashtags = (caption.match(/#[\w\u0600-\u06FF]+/g) || []).map(t=>t.toLowerCase());
    await addDoc(collection(db,'videos'), {
      id: videoId, creatorId: currentUser.uid, creatorName: currentUser.displayName || currentUser.email.split('@')[0],
      caption, rawUrl: url, status: 'processing', hashtags, likesCount:0, commentsCount:0, sharesCount:0, viewsCount:0, watchTimeTotal:0,
      createdAt: serverTimestamp()
    });
    showToast("Uploaded! Processing...");
  });
}

// Feed ranking
async function getPersonalizedFeed(limit=5) {
  let q = query(collection(db,'videos'), where('status','==','ready'), orderBy('createdAt','desc'), limit(30));
  if (lastVideoDoc) q = query(q, startAfter(lastVideoDoc));
  const snap = await getDocs(q);
  if (snap.empty) return { videos:[], lastDoc:null };
  lastVideoDoc = snap.docs[snap.docs.length-1];
  const candidates = snap.docs.map(d=> ({ id:d.id, ...d.data() }));
  const seenIds = new Set(feedVideos.map(v=>v.id));
  const unseen = candidates.filter(v=>!seenIds.has(v.id));
  const scored = unseen.map(v=>{
    const age = (Date.now() - (v.createdAt?.toDate?.()||new Date()))/3600000;
    const recency = Math.max(0, 1-age/72);
    const engagement = (v.likesCount||0)*0.4 + (v.sharesCount||0)*0.2;
    const viral = (age<2 && (v.likesCount||0)/((v.viewsCount||1))>0.1) ? 0.5 : 0;
    return { id:v.id, score: engagement*0.6 + recency*0.3 + viral };
  });
  scored.sort((a,b)=>b.score-a.score);
  const topIds = scored.slice(0,limit).map(s=>s.id);
  const result = topIds.map(id=>unseen.find(v=>v.id===id)).filter(v=>v);
  return { videos: result, lastDoc: lastVideoDoc };
}
async function loadFeed(reset=true) {
  if (isLoading) return;
  isLoading = true;
  if (reset) {
    feedVideos = []; lastVideoDoc = null;
    if (videoObserver) videoObserver.disconnect();
    document.getElementById('feedStack')?.remove();
    document.getElementById('contentArea').innerHTML = `<div id="feedStack" class="h-screen overflow-y-scroll snap-y snap-mandatory scroll-smooth"></div><div id="feedLoader" class="loader"></div>`;
  }
  const { videos, lastDoc } = await getPersonalizedFeed(5);
  if (videos.length===0) { document.getElementById('feedLoader')?.remove(); isLoading=false; return; }
  lastVideoDoc = lastDoc;
  feedVideos.push(...videos);
  renderFeedStack(videos);
  isLoading = false;
}
function renderFeedStack(videos) {
  const stack = document.getElementById('feedStack');
  if (!stack) return;
  videos.forEach(v => stack.appendChild(createVideoCard(v)));
  if (videoObserver) videoObserver.disconnect();
  videoObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      const vid = entry.target.querySelector('video');
      if (!vid) return;
      if (entry.isIntersecting) {
        if (vid.src !== entry.target.dataset.videoUrl) vid.src = entry.target.dataset.videoUrl;
        vid.play().catch(e=>console.log);
        watchStartTimes.set(entry.target.dataset.id, Date.now());
      } else {
        vid.pause();
        if (watchStartTimes.has(entry.target.dataset.id)) {
          const watched = Math.floor((Date.now() - watchStartTimes.get(entry.target.dataset.id))/1000);
          if (watched>0) updateWatchTime(entry.target.dataset.id, watched);
          watchStartTimes.delete(entry.target.dataset.id);
        }
      }
    });
  }, { threshold:0.5 });
  document.querySelectorAll('.video-card').forEach(card=>videoObserver.observe(card));
  const lastCard = stack.lastChild;
  if (lastCard) {
    const scrollObs = new IntersectionObserver(entries => { if (entries[0].isIntersecting && !isLoading) loadFeed(false); }, { threshold:0.1 });
    scrollObs.observe(lastCard);
  }
}
function createVideoCard(video) {
  const div = document.createElement('div');
  div.className = 'video-card relative h-screen snap-start snap-always bg-black';
  div.dataset.id = video.id;
  div.dataset.videoUrl = video.videoUrl || video.lowResUrl || '';
  div.innerHTML = `
    <video class="absolute inset-0 w-full h-full object-cover" muted playsinline poster="${video.thumbnailUrl||''}" preload="none"></video>
    <div class="absolute bottom-28 left-4 right-20 z-20">
      <div class="flex items-center gap-2"><i class="fas fa-user-circle text-2xl"></i><span class="font-bold">${escapeHtml(video.creatorName)}</span>
        <button class="follow-btn text-xs bg-white/20 px-2 py-1 rounded-full" data-creator="${video.creatorId}">Follow</button>
      </div>
      <p class="text-sm mt-2">${escapeHtml(video.caption||'')}</p>
      <div class="flex gap-1 text-xs text-gray-300 mt-1">${(video.hashtags||[]).map(t=>`<span>${escapeHtml(t)}</span>`).join(' ')}</div>
    </div>
    <div class="absolute bottom-28 right-3 z-20 flex flex-col gap-5 items-center">
      <button class="like-btn"><i class="far fa-heart text-3xl"></i><span class="text-xs">${video.likesCount||0}</span></button>
      <button class="comment-btn"><i class="far fa-comment text-3xl"></i><span class="text-xs">${video.commentsCount||0}</span></button>
      <button class="share-btn"><i class="fas fa-share-alt text-3xl"></i></button>
      <button class="gift-btn"><i class="fas fa-gift text-3xl"></i></button>
      <button class="report-btn"><i class="fas fa-flag text-2xl"></i></button>
    </div>
  `;
  return div;
}
async function updateWatchTime(videoId, seconds) {
  const interactionId = `${currentUser.uid}_${videoId}`;
  const refInt = doc(db,'interactions',interactionId);
  const snap = await getDoc(refInt);
  if (snap.exists()) await updateDoc(refInt, { watchedSeconds: increment(seconds), lastUpdated: serverTimestamp() });
  else await setDoc(refInt, { userId: currentUser.uid, videoId, watchedSeconds: seconds, lastUpdated: serverTimestamp() });
  await updateDoc(doc(db,'videos',videoId), { watchTimeTotal: increment(seconds) });
  const viewKey = `${currentUser.uid}_${videoId}`;
  const viewRef = doc(db,'video_views',viewKey);
  if (!(await getDoc(viewRef)).exists()) {
    await setDoc(viewRef, { userId: currentUser.uid, videoId, createdAt: serverTimestamp() });
    await updateDoc(doc(db,'videos',videoId), { viewsCount: increment(1) });
  }
}

// Comments modal
async function showComments(videoId) {
  if (unsubscribeComments) unsubscribeComments();
  const modal = document.createElement('div');
  modal.className = 'fixed inset-0 z-[60] flex flex-col justify-end';
  modal.innerHTML = `
    <div class="bg-black/80 absolute inset-0" onclick="this.parentElement.remove()"></div>
    <div class="comments-panel bg-[#111] p-4 relative">
      <h3 class="font-bold text-lg mb-2">Comments</h3>
      <div id="commentsList" class="max-h-64 overflow-y-auto space-y-2 mb-3"></div>
      <div class="flex gap-2"><input id="commentInput" placeholder="Add a comment..." class="flex-1 bg-white/10 rounded-full p-2 text-sm"><button id="postCommentBtn" class="bg-purple-600 px-4 rounded-full">Post</button></div>
      <button id="closeComments" class="mt-3 text-gray-400 text-sm w-full">Close</button>
    </div>
  `;
  document.body.appendChild(modal);
  const q = query(collection(db,'videos',videoId,'comments'), orderBy('createdAt','desc'), limit(50));
  unsubscribeComments = onSnapshot(q, snap => {
    const list = modal.querySelector('#commentsList');
    list.innerHTML = '';
    snap.forEach(d => {
      const c = d.data();
      list.innerHTML += `<div class="text-sm"><strong>${escapeHtml(c.userName)}</strong>: ${escapeHtml(c.text)}</div>`;
    });
  });
  modal.querySelector('#postCommentBtn').onclick = async () => {
    const input = modal.querySelector('#commentInput');
    const text = input.value.trim();
    if (!text) return;
    await addDoc(collection(db,'videos',videoId,'comments'), { userId: currentUser.uid, userName: currentUser.displayName || currentUser.email.split('@')[0], text, createdAt: serverTimestamp() });
    await updateDoc(doc(db,'videos',videoId), { commentsCount: increment(1) });
    input.value = '';
    const vidSnap = await getDoc(doc(db,'videos',videoId));
    const creatorId = vidSnap.data().creatorId;
    if (creatorId !== currentUser.uid) await sendNotification({ userId: creatorId, title: 'New comment', body: `${currentUser.displayName} commented` });
  };
  modal.querySelector('#closeComments').onclick = () => { if(unsubscribeComments) unsubscribeComments(); modal.remove(); };
}

// Event delegation
document.addEventListener('click', async (e) => {
  const like = e.target.closest('.like-btn');
  if (like && currentUser) {
    const card = like.closest('.video-card');
    const videoId = card.dataset.id;
    const isLiked = like.querySelector('i').classList.contains('fas');
    if (!isLiked) {
      await updateDoc(doc(db,'videos',videoId), { likesCount: increment(1) });
      await setDoc(doc(db,'interactions',`${currentUser.uid}_${videoId}`), { liked: true }, { merge: true });
      like.querySelector('i').className = 'fas fa-heart text-red-500 text-3xl';
      like.querySelector('span').innerText = parseInt(like.querySelector('span').innerText)+1;
      const vidSnap = await getDoc(doc(db,'videos',videoId));
      const creatorId = vidSnap.data().creatorId;
      if (creatorId !== currentUser.uid) await sendNotification({ userId: creatorId, title: 'New like', body: `${currentUser.displayName} liked your video` });
    } else {
      await updateDoc(doc(db,'videos',videoId), { likesCount: increment(-1) });
      await setDoc(doc(db,'interactions',`${currentUser.uid}_${videoId}`), { liked: false }, { merge: true });
      like.querySelector('i').className = 'far fa-heart text-3xl';
      like.querySelector('span').innerText = parseInt(like.querySelector('span').innerText)-1;
    }
    return;
  }
  const follow = e.target.closest('.follow-btn');
  if (follow && currentUser) {
    const creatorId = follow.dataset.creator;
    await setDoc(doc(db,'follows',`${currentUser.uid}_${creatorId}`), { followerId: currentUser.uid, followeeId: creatorId, createdAt: serverTimestamp() });
    showToast("Followed");
    if (sessionCount>=2 && !notificationsRequested) requestNotificationPermission();
    return;
  }
  const share = e.target.closest('.share-btn');
  if (share) {
    const card = share.closest('.video-card');
    const videoId = card.dataset.id;
    const url = `https://vibeloop.ng/watch/${videoId}`;
    const text = `Check this video on VibeLoop! Use my code ${currentUser?.uid.slice(0,6)} for coins.`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text+' '+url)}`,'_blank');
    await updateDoc(doc(db,'videos',videoId), { sharesCount: increment(1) });
    return;
  }
  const gift = e.target.closest('.gift-btn');
  if (gift && currentUser) {
    const card = gift.closest('.video-card');
    const videoId = card.dataset.id;
    const vidSnap = await getDoc(doc(db,'videos',videoId));
    const creatorId = vidSnap.data().creatorId;
    const type = prompt("Gift: rose(50), diamond(500), rocket(5000)");
    if (!type) return;
    try { await sendGift({ toUserId: creatorId, videoId, giftType: type }); showToast("Gift sent!"); } catch(e) { showToast("Not enough coins","error"); }
    return;
  }
  const report = e.target.closest('.report-btn');
  if (report && currentUser) {
    const card = report.closest('.video-card');
    const videoId = card.dataset.id;
    const reason = prompt("Why report?");
    if (reason) { await addDoc(collection(db,'reports'), { videoId, reason, reportedBy: currentUser.uid, timestamp: serverTimestamp() }); showToast("Reported"); }
    return;
  }
  const comment = e.target.closest('.comment-btn');
  if (comment && currentUser) {
    const card = comment.closest('.video-card');
    showComments(card.dataset.id);
  }
});

// Trending page
async function renderTrending() {
  document.getElementById('contentArea').innerHTML = `<div class="p-4"><h2 class="text-2xl font-bold">🔥 Nigeria Trending</h2><div id="trendingList" class="space-y-3 mt-4"></div></div>`;
  const snap = await getDocs(query(collection(db,'videos'), where('status','==','ready'), orderBy('likesCount','desc'), limit(20)));
  const list = document.getElementById('trendingList');
  list.innerHTML = '';
  snap.forEach(d=>{ const v=d.data(); list.innerHTML += `<div class="flex gap-3 bg-white/5 rounded-xl p-2"><video src="${v.lowResUrl||v.videoUrl}" class="w-28 h-40 rounded-lg object-cover"></video><div><p class="font-bold">${escapeHtml(v.caption?.slice(0,40))}</p><p>❤️ ${v.likesCount} 👁️ ${v.viewsCount}</p></div></div>`; });
}

// Profile with analytics
async function renderProfile() {
  const userSnap = await getDoc(doc(db,'users',currentUser.uid));
  const user = userSnap.data();
  const videosSnap = await getDocs(query(collection(db,'videos'), where('creatorId','==',currentUser.uid)));
  let totalViews=0, totalWatch=0, totalCoins=0;
  videosSnap.forEach(v=>{ totalViews += v.data().viewsCount||0; totalWatch += v.data().watchTimeTotal||0; });
  const giftsSnap = await getDocs(query(collection(db,'gifts'), where('to','==',currentUser.uid)));
  giftsSnap.forEach(g=> totalCoins += g.data().amount||0);
  document.getElementById('contentArea').innerHTML = `
    <div class="p-5 text-center">
      <img src="${user.avatarUrl||'https://i.pravatar.cc/150'}" class="w-24 h-24 rounded-full mx-auto border-4 border-purple-500">
      <h2 class="text-2xl font-bold mt-2">@${escapeHtml(user.username||currentUser.email.split('@')[0])}</h2>
      <p>${escapeHtml(user.bio||'VibeLooper')}</p>
      <div class="flex justify-center gap-6 my-4"><div><span class="font-bold">${user.followersCount||0}</span><p class="text-xs">Followers</p></div><div><span>${user.followingCount||0}</span><p class="text-xs">Following</p></div><div><span>${user.coins||0}</span><p class="text-xs">💰 Coins</p></div></div>
      <div class="bg-white/5 rounded-xl p-3 mb-4"><h3 class="font-bold">📊 Creator Analytics</h3><div class="flex justify-around text-sm mt-2"><div>👁️ ${totalViews} views</div><div>⏱️ ${Math.floor(totalWatch/60)} min</div><div>🎁 ${totalCoins} coins</div></div></div>
      <button id="buyCoinsBtn" class="bg-yellow-600 px-4 py-2 rounded-full text-sm">Buy Coins</button>
      <button id="logoutBtnApp" class="bg-red-600/50 px-4 py-2 rounded-full text-sm ml-2">Logout</button>
      <div id="userVideos" class="grid grid-cols-3 gap-1 mt-4"></div>
    </div>
  `;
  const grid = document.getElementById('userVideos');
  grid.innerHTML = '';
  videosSnap.forEach(v=>{ grid.innerHTML += `<video src="${v.data().lowResUrl||v.data().videoUrl}" class="aspect-square object-cover rounded-md"></video>`; });
  document.getElementById('buyCoinsBtn').onclick = () => showToast("Paystack integration coming","info");
  document.getElementById('logoutBtnApp').onclick = () => signOut(auth);
}

// Navigation
function setActiveTab(tab) {
  activeTab = tab;
  document.querySelectorAll('.nav-btn').forEach(btn=>{
    if(btn.dataset.nav===tab) btn.classList.add('text-purple-500');
    else btn.classList.remove('text-purple-500');
  });
  if(tab==='feed') loadFeed(true);
  else if(tab==='trending') renderTrending();
  else if(tab==='chat') document.getElementById('contentArea').innerHTML = '<div class="p-4"><h2>💬 Chat coming soon</h2></div>';
  else if(tab==='profile') renderProfile();
}

// Auth events
document.getElementById('emailLoginBtn').onclick = async () => {
  const email = document.getElementById('loginEmail').value;
  const pass = document.getElementById('loginPass').value;
  try { await signInWithEmailAndPassword(auth, email, pass); } catch(e) { showToast(e.message,"error"); }
};
document.getElementById('emailSignupBtn').onclick = async () => {
  const email = document.getElementById('loginEmail').value;
  const pass = document.getElementById('loginPass').value;
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, pass);
    await setDoc(doc(db,'users',cred.user.uid), { email, username: email.split('@')[0], coins:0, createdAt: serverTimestamp() });
    const refCode = prompt("Referral code?");
    if (refCode) {
      const refSnap = await getDoc(doc(db,'referrals',refCode));
      if (refSnap.exists()) await addCoins({ amount:50, reason:'referral_bonus' });
    }
    await setDoc(doc(db,'referrals',cred.user.uid.slice(0,8)), { userId: cred.user.uid });
    showToast("Account created! Please login.");
  } catch(e) { showToast(e.message,"error"); }
};
document.getElementById('googleLoginBtn').onclick = async () => {
  const result = await signInWithPopup(auth, googleProvider);
  const user = result.user;
  const ref = doc(db,'users',user.uid);
  if (!(await getDoc(ref)).exists()) await setDoc(ref, { email: user.email, username: user.displayName, avatarUrl: user.photoURL, coins:0, createdAt: serverTimestamp() });
};
onAuthStateChanged(auth, user => {
  if (user) {
    currentUser = user;
    sessionCount++; localStorage.setItem('sessionCount',sessionCount);
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('mainApp').classList.remove('hidden');
    setActiveTab('feed');
    if (sessionCount>=2 && !notificationsRequested) setTimeout(()=>requestNotificationPermission(),5000);
  } else {
    document.getElementById('loginScreen').classList.remove('hidden');
    document.getElementById('mainApp').classList.add('hidden');
  }
});
document.getElementById('uploadFab').onclick = () => document.getElementById('videoUploadInput').click();
document.getElementById('videoUploadInput').onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const caption = prompt("Caption (use #hashtags)");
  if (caption) await uploadVideo(file, caption);
  else showToast("Caption required","error");
  e.target.value = '';
};
