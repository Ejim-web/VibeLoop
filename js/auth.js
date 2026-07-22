import { auth, db } from './app.js';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut, sendEmailVerification, updateProfile } from 'firebase/auth';
import { doc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore';
import { showToast } from './utils.js';

export function initAuth() {
  // ─── Email Login ──────────────────────────────────────────
  document.getElementById('emailLoginBtn').addEventListener('click', async () => {
    const email = document.getElementById('loginEmail').value;
    const pass = document.getElementById('loginPass').value;
    try {
      await signInWithEmailAndPassword(auth, email, pass);
    } catch (e) { showToast(e.message, 'error'); }
  });

  // ─── Email Signup ─────────────────────────────────────────
  document.getElementById('emailSignupBtn').addEventListener('click', async () => {
    const email = document.getElementById('loginEmail').value;
    const pass = document.getElementById('loginPass').value;
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, pass);
      await createUserDoc(cred.user);
      await sendEmailVerification(cred.user);
      showToast('Verification email sent. Please verify before posting.');
    } catch (e) { showToast(e.message, 'error'); }
  });

  // ─── Google Login ─────────────────────────────────────────
  document.getElementById('googleLoginBtn').addEventListener('click', async () => {
    const provider = new GoogleAuthProvider();
    try {
      const result = await signInWithPopup(auth, provider);
      const user = result.user;
      const docSnap = await getDoc(doc(db, 'users', user.uid));
      if (!docSnap.exists()) await createUserDoc(user);
    } catch (e) { showToast(e.message, 'error'); }
  });

  // ─── Auth State Listener ──────────────────────────────────
  onAuthStateChanged(auth, (user) => {
    if (user) {
      document.getElementById('loginScreen').classList.add('hidden');
      document.getElementById('mainApp').classList.remove('hidden');
      // Load user data
      loadUserData(user.uid);
    } else {
      document.getElementById('loginScreen').classList.remove('hidden');
      document.getElementById('mainApp').classList.add('hidden');
    }
  });
}

async function createUserDoc(user) {
  await setDoc(doc(db, 'users', user.uid), {
    email: user.email,
    username: user.displayName || user.email.split('@')[0],
    avatarUrl: user.photoURL || '',
    bio: '',
    coins: 0,
    followersCount: 0,
    followingCount: 0,
    emailVerified: user.emailVerified || false,
    createdAt: serverTimestamp(),
  });
}

async function loadUserData(uid) {
  // Load followed users, drafts, notifications, etc.
  const userSnap = await getDoc(doc(db, 'users', uid));
  if (userSnap.exists()) {
    const userData = userSnap.data();
    // Store in global state if needed
  }
}

export function logout() {
  signOut(auth);
  showToast('Logged out');
}
