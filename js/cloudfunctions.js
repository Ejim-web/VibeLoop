import { getFunctions, httpsCallable } from 'firebase/functions';
const functions = getFunctions();

export const deleteMedia = httpsCallable(functions, 'deleteMedia');
export const checkRateLimit = httpsCallable(functions, 'checkRateLimit');
export const reportError = httpsCallable(functions, 'reportError');
export const moderateVideo = httpsCallable(functions, 'moderateVideo');
