const functions = require('firebase-functions');
const admin = require('firebase-admin');
const cloudinary = require('cloudinary').v2;

admin.initializeApp();

// Critical: define db for use in all functions
const db = admin.firestore();

cloudinary.config({
  cloud_name: functions.config().cloudinary.cloud_name,
  api_key: functions.config().cloudinary.api_key,
  api_secret: functions.config().cloudinary.api_secret,
});

// ─── Delete media ────────────────────────────────────────────
exports.deleteMedia = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Must be logged in');
  const { publicId, resourceType = 'image', collectionName, docId } = data;
  if (!publicId) throw new functions.https.HttpsError('invalid-argument', 'publicId required');

  const uid = context.auth.uid;
  const isAdmin = context.auth.token.admin || false;
  let isOwner = false;

  if (!isAdmin && collectionName && docId) {
    const docSnap = await db.collection(collectionName).doc(docId).get();
    if (docSnap.exists) {
      const docData = docSnap.data();
      if (docData.userId === uid || docData.creatorId === uid) isOwner = true;
    }
  }

  if (!isOwner && !isAdmin) {
    throw new functions.https.HttpsError('permission-denied', 'You do not own this media');
  }

  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
    if (docId && collectionName) await db.collection(collectionName).doc(docId).delete();
    return { success: true };
  } catch (e) {
    throw new functions.https.HttpsError('internal', e.message);
  }
});

// ─── Rate limit check ──────────────────────────────────────
exports.checkRateLimit = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Must be logged in');
  const uid = context.auth.uid;
  const type = data.type || 'upload';
  const hour = new Date().toISOString().slice(0, 13);
  const ref = db.collection('rateLimits').doc(`${uid}_${type}_${hour}`);

  const result = await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
    const count = snap.exists ? snap.data().count : 0;
    const limits = { upload: 10, comment: 30, story: 20 };
    const limit = limits[type] || 10;
    if (count >= limit) {
      throw new functions.https.HttpsError('resource-exhausted', `Rate limit exceeded for ${type}`);
    }
    transaction.set(ref, { count: count + 1 }, { merge: true });
    return { allowed: true };
  });
  return result;
});

// ─── Report error ──────────────────────────────────────────
exports.reportError = functions.https.onCall(async (data, context) => {
  console.error('Client error:', data);
  return { received: true };
});

// ─── Moderate video ──────────────────────────────────────
exports.moderateVideo = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Must be logged in');
  const { publicId } = data;
  if (!publicId) throw new functions.https.HttpsError('invalid-argument', 'publicId required');

  try {
    const result = await cloudinary.api.resource(publicId, { moderation: 'aws_rek' });
    const moderation = result.moderation || [];
    const flags = moderation.filter(m => m.status === 'rejected');
    return {
      status: flags.length > 0 ? 'rejected' : 'approved',
      flags: flags.map(f => f.reason)
    };
  } catch (e) {
    console.warn('Moderation failed, defaulting to approved', e);
    return { status: 'approved', flags: [] };
  }
});

// ─── Expire stories ─────────────────────────────────────────
exports.expireStories = functions.pubsub.schedule('0 * * * *')
  .timeZone('UTC')
  .onRun(async () => {
    let deleted = 0;
    while (true) {
      const expired = await db.collection('stories')
        .where('expiresAt', '<', new Date())
        .limit(500)
        .get();
      if (expired.empty) break;

      const batch = db.batch();
      const deletePromises = [];

      for (const doc of expired.docs) {
        const data = doc.data();
        if (data.publicId) {
          const resType = data.type === 'video' ? 'video' : 'image';
          deletePromises.push(
            cloudinary.uploader.destroy(data.publicId, { resource_type: resType })
              .then(() => console.log(`Deleted ${data.publicId}`))
              .catch(e => console.error(`Failed to delete ${data.publicId}:`, e))
          );
        }
        batch.delete(doc.ref);
        deleted++;
      }

      await Promise.all(deletePromises);
      await batch.commit();
    }
    console.log(`Deleted ${deleted} expired stories`);
  });
