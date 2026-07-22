import { db, auth } from './app.js';
import { doc, setDoc, increment, serverTimestamp, collection, addDoc, writeBatch } from 'firebase/firestore';

let eventQueue = [];
let flushTimeout = null;
const FLUSH_INTERVAL = 5000;
const BATCH_SIZE = 20;

export function trackEvent(eventType, data = {}) {
  if (!auth.currentUser) return;
  eventQueue.push({ eventType, data, timestamp: new Date() });
  if (eventQueue.length >= BATCH_SIZE) flushEvents();
  if (!flushTimeout) flushTimeout = setTimeout(flushEvents, FLUSH_INTERVAL);
}

async function flushEvents() {
  if (eventQueue.length === 0) return;
  clearTimeout(flushTimeout);
  flushTimeout = null;

  const events = eventQueue.slice();
  eventQueue = [];

  const batch = writeBatch(db);
  const now = serverTimestamp();

  for (const evt of events) {
    // Raw events
    const ref = doc(collection(db, 'users', auth.currentUser.uid, 'events'));
    batch.set(ref, { type: evt.eventType, data: evt.data, timestamp: now });

    // Aggregated counters
    const dayKey = new Date(evt.timestamp).toISOString().slice(0, 10);
    const aggRef = doc(db, 'aggregatedEvents', `${auth.currentUser.uid}_${evt.eventType}_${dayKey}`);
    batch.set(aggRef, { count: increment(1) }, { merge: true });
  }

  try {
    await batch.commit();
  } catch (e) {
    console.warn('Failed to flush events:', e);
    eventQueue = events.concat(eventQueue);
  }
}
