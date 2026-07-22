import { db, auth } from './app.js';
import { collection, doc, setDoc, getDoc, getDocs, query, orderBy, onSnapshot, addDoc, updateDoc, serverTimestamp, where } from 'firebase/firestore';
import { showToast, escapeHtml, uploadToCloudinary } from './utils.js';

let currentChatPartner = null;
let unsubMessages = null;

export async function renderChatList() {
  const area = document.getElementById('contentArea');
  area.innerHTML = `<div class="chat-list"><h2>Messages</h2><div id="chatUsers"></div><button id="newChatBtn">New Chat</button></div>`;
  const usersSnap = await getDocs(collection(db, 'users'));
  const list = document.getElementById('chatUsers');
  list.innerHTML = '';
  usersSnap.forEach(d => {
    const u = d.data();
    if (d.id === auth.currentUser.uid) return;
    const div = document.createElement('div');
    div.className = 'chat-user';
    div.dataset.uid = d.id;
    const avatar = u.avatarUrl || 'https://ui-avatars.com/api/?name='+encodeURIComponent(u.username||'User');
    div.innerHTML = `<img src="${avatar}" /><div><strong>${escapeHtml(u.username||'User')}</strong></div>`;
    div.addEventListener('click', () => openChat(d.id));
    list.appendChild(div);
  });
  document.getElementById('newChatBtn').addEventListener('click', () => {
    const uid = prompt('Enter user ID to chat with:');
    if (uid) openChat(uid);
  });
}

export async function openChat(partnerUid) {
  if (!partnerUid) return;
  currentChatPartner = partnerUid;
  const roomId = [auth.currentUser.uid, partnerUid].sort().join('_');
  const area = document.getElementById('contentArea');
  area.innerHTML = `
    <div class="chat-container">
      <div class="chat-header"><button id="backChat"><i class="fas fa-arrow-left"></i></button><span>Chat</span></div>
      <div id="chatMessages" class="chat-messages"></div>
      <div class="chat-input"><input id="chatInput" placeholder="Type a message..." /><button id="sendChat">Send</button></div>
    </div>
  `;
  document.getElementById('backChat').addEventListener('click', renderChatList);

  if (unsubMessages) unsubMessages();
  const q = query(collection(db, 'chats', roomId, 'messages'), orderBy('timestamp', 'asc'));
  unsubMessages = onSnapshot(q, (snap) => {
    const container = document.getElementById('chatMessages');
    container.innerHTML = '';
    snap.forEach(d => {
      const msg = d.data();
      const div = document.createElement('div');
      div.className = `message ${msg.senderId === auth.currentUser.uid ? 'sent' : 'received'}`;
      div.textContent = msg.text;
      container.appendChild(div);
    });
    container.scrollTop = container.scrollHeight;
  });

  document.getElementById('sendChat').addEventListener('click', sendMessage);
  document.getElementById('chatInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendMessage();
  });
}

async function sendMessage() {
  const input = document.getElementById('chatInput');
  const text = input.value.trim();
  if (!text) return;
  const roomId = [auth.currentUser.uid, currentChatPartner].sort().join('_');
  await addDoc(collection(db, 'chats', roomId, 'messages'), {
    senderId: auth.currentUser.uid,
    senderName: auth.currentUser.displayName || auth.currentUser.email.split('@')[0],
    text,
    timestamp: serverTimestamp()
  });
  input.value = '';
}
