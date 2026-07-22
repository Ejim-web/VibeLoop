import { db, auth } from './app.js';
import { doc, getDoc, getDocs, query, where, orderBy, collection, updateDoc, deleteDoc } from 'firebase/firestore';
import { showToast, escapeHtml, uploadToCloudinary, deleteFromCloudinary } from './utils.js';
import { createVideoCard } from './interactions.js';
import { checkRateLimit } from './cloudFunctions.js';

export async function renderMyProfile() {
  const uid = auth.currentUser.uid;
  await renderUserProfile(uid, true);
}

export async function renderUserProfile(uid, isSelf = false) {
  const area = document.getElementById('contentArea');
  area.innerHTML = `<div class="loader"></div>`;
  const userSnap = await getDoc(doc(db, 'users', uid));
  if (!userSnap.exists()) { area.innerHTML = '<p>User not found</p>'; return; }
  const user = userSnap.data();
  const videosSnap = await getDocs(query(collection(db, 'videos'), where('creatorId','==',uid), where('status','==','published'), orderBy('createdAt','desc')));
  const totalViews = videosSnap.docs.reduce((acc, d) => acc + (d.data().viewsCount||0), 0);
  const avatarUrl = user.avatarUrl || 'https://ui-avatars.com/api/?name='+encodeURIComponent(user.username||'User')+'&size=120';

  let actionsHtml = '';
  if (isSelf) {
    actionsHtml = `<button class="edit-btn" id="editProfileBtn"><i class="fas fa-pen"></i> Edit Profile</button>`;
  } else {
    const isFollowing = await checkFollow(uid);
    actionsHtml = `
      <button class="follow-btn ${isFollowing?'following':''}" id="profileFollowBtn">${isFollowing?'Following':'Follow'}</button>
      ${isFollowing ? `<button class="message-btn" id="profileMessageBtn"><i class="fas fa-comment-dots"></i> Message</button>` : ''}
    `;
  }

  area.innerHTML = `
    <div class="profile-header">
      <img src="${avatarUrl}" class="profile-avatar" />
      <div class="profile-name">@${escapeHtml(user.username||'User')}</div>
      <div class="profile-bio">${escapeHtml(user.bio||'')}</div>
      <div class="profile-actions">${actionsHtml}</div>
      <div class="profile-stats">
        <div><span>${user.followersCount||0}</span><p>Followers</p></div>
        <div><span>${user.followingCount||0}</span><p>Following</p></div>
        <div><span>${user.coins||0}</span><p>Coins</p></div>
        <div><span>${totalViews}</span><p>Views</p></div>
      </div>
      <div id="userVideos" class="video-grid"></div>
    </div>
  `;
  // Show videos
  const grid = document.getElementById('userVideos');
  grid.innerHTML = '';
  videosSnap.forEach(d => {
    const card = createVideoCard({ id: d.id, ...d.data() });
    grid.appendChild(card);
  });

  // Event listeners
  if (isSelf) {
    document.getElementById('editProfileBtn').addEventListener('click', showEditProfileModal);
  } else {
    const followBtn = document.getElementById('profileFollowBtn');
    if (followBtn) {
      followBtn.addEventListener('click', async () => {
        await toggleFollow(uid, followBtn);
        renderUserProfile(uid, false);
      });
    }
    const msgBtn = document.getElementById('profileMessageBtn');
    if (msgBtn) {
      msgBtn.addEventListener('click', () => {
        import('./chat.js').then(m => m.openChat(uid));
      });
    }
  }
}

async function checkFollow(uid) {
  if (!auth.currentUser) return false;
  const followRef = doc(db, 'follows', `${auth.currentUser.uid}_${uid}`);
  const snap = await getDoc(followRef);
  return snap.exists();
}

async function toggleFollow(uid, btn) {
  // Reuse from interactions.js – we can import and call
  const { toggleFollow: tf } = await import('./interactions.js');
  await tf(uid, btn);
}

function showEditProfileModal() {
  const modal = document.createElement('div');
  modal.className = 'edit-modal';
  modal.innerHTML = `
    <div class="edit-modal-content">
      <h2>Edit Profile</h2>
      <label>Profile Photo</label>
      <input type="file" id="avatarInput" accept="image/*" />
      <label>Bio</label>
      <textarea id="bioInput">${auth.currentUser?.bio || ''}</textarea>
      <div class="actions">
        <button class="cancel-btn" id="cancelEdit">Cancel</button>
        <button class="save-btn" id="saveEdit">Save</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.querySelector('#cancelEdit').addEventListener('click', () => modal.remove());
  modal.querySelector('#saveEdit').addEventListener('click', async () => {
    const bio = modal.querySelector('#bioInput').value.trim();
    const file = modal.querySelector('#avatarInput').files[0];
    if (file) {
      await uploadAvatar(file);
    }
    await updateDoc(doc(db, 'users', auth.currentUser.uid), { bio });
    showToast('Profile updated');
    modal.remove();
    renderMyProfile();
  });
}

async function uploadAvatar(file) {
  try {
    const userSnap = await getDoc(doc(db, 'users', auth.currentUser.uid));
    const oldAvatarPublicId = userSnap.data()?.avatarPublicId;

    const data = await uploadToCloudinary(file, 'image', {
      folder: `avatars/${auth.currentUser.uid}`,
      public_id: 'profile',
      transformation: 'f_auto,q_auto,c_thumb,w_200,h_200,g_face',
    });
    await updateDoc(doc(db, 'users', auth.currentUser.uid), {
      avatarUrl: data.secure_url,
      avatarPublicId: data.public_id,
    });

    if (oldAvatarPublicId && oldAvatarPublicId !== data.public_id) {
      await deleteFromCloudinary(oldAvatarPublicId, 'image');
    }
  } catch (e) {
    showToast('Avatar upload failed', 'error');
    logError(e);
  }
}
