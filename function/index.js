const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();
const db = admin.firestore();

exports.addCoins = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', '');
  const { amount, reason } = data;
  const allowed = ['daily_reward', 'referral_bonus', 'ad_reward'];
  if (!allowed.includes(reason)) throw new functions.https.HttpsError('permission-denied', 'Invalid reason');
  const num = Number(amount);
  if (num <= 0 || num > 100) throw new functions.https.HttpsError('invalid-argument', 'Amount too high');
  await db.collection('users').doc(context.auth.uid).update({ coins: admin.firestore.FieldValue.increment(num) });
  await db.collection('coin_transactions').add({ userId: context.auth.uid, amount: num, reason, timestamp: admin.firestore.FieldValue.serverTimestamp() });
  return { success: true };
});

exports.sendGift = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', '');
  const { toUserId, videoId, giftType } = data;
  const cost = { rose: 50, diamond: 500, rocket: 5000 }[giftType] || 50;
  const senderRef = db.collection('users').doc(context.auth.uid);
  const receiverRef = db.collection('users').doc(toUserId);
  await db.runTransaction(async t => {
    const sender = await t.get(senderRef);
    if ((sender.data().coins || 0) < cost) throw new Error('Insufficient coins');
    t.update(senderRef, { coins: admin.firestore.FieldValue.increment(-cost) });
    t.update(receiverRef, { coins: admin.firestore.FieldValue.increment(Math.floor(cost * 0.7)) });
    t.create(db.collection('gifts').doc(), { from: context.auth.uid, to: toUserId, videoId, amount: cost, timestamp: admin.firestore.FieldValue.serverTimestamp() });
  });
  return { success: true };
});

exports.sendNotification = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', '');
  const { userId, title, body } = data;
  const userDoc = await db.collection('users').doc(userId).get();
  const token = userDoc.data().fcmToken;
  if (token) {
    await admin.messaging().send({ token, notification: { title, body } });
  }
  return { success: true };
});

// Admin delete function (optional)
exports.adminDeleteVideo = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', '');
  const user = await admin.auth().getUser(context.auth.uid);
  if (user.customClaims?.admin !== true) throw new functions.https.HttpsError('permission-denied', 'Admin only');
  await db.collection('videos').doc(data.videoId).delete();
  return { success: true };
});
