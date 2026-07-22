import { db, auth, messaging } from './app.js';
import { getToken, onMessage } from 'firebase/messaging';
import { doc, updateDoc, collection, query, where, onSnapshot, orderBy, limit } from 'firebase/firestore';
import { showToast } from './utils.js';
import { CONFIG } from './config.js';

export function initNotifications() {
  if (!auth.currentUser) return;

  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }

  const vapidKey = CONFIG.NOTIFICATIONS.vapidKey;
  getToken(messaging, { vapidKey }).then(token => {
    updateDoc(doc(db, 'users', auth.currentUser.uid), { fcmToken: token });
  }).catch(() => {});

  onMessage(messaging, (payload) => {
    showToast(payload.notification.body);
  });

  // In-app notifications
  const q = query(collection(db, 'notifications'), where('userId','==',auth.currentUser.uid), orderBy('createdAt','desc'), limit(20));
  onSnapshot(q, (snap) => {
    // Update badge or list
  });
}
