import { showToast } from './utils.js';

export function initLive() {
  console.log('Live streaming will use LiveKit or Agora in production.');
}

export async function startLiveStream() {
  showToast('Live streaming coming soon', 'info');
}
