// Listen before React mounts so an early browser install event is retained.
const dismissalKey = 'residens_install_dismissed';
const listeners = new Set();
const standalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
let dismissed = false;
try { dismissed = sessionStorage.getItem(dismissalKey) === '1'; } catch { /* Optional preference only. */ }
let state = { prompt: null, installed: standalone(), manual: false, dismissed, busy: false, error: '' };
const update = patch => { state = { ...state, ...patch }; listeners.forEach(listener => listener()); };

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  if (!standalone()) update({ prompt: event, installed: false, error: '' });
});
window.addEventListener('appinstalled', () => update({ installed: true, prompt: null, manual: false, busy: false }));
window.matchMedia('(display-mode: standalone)').addEventListener('change', () => update({ installed: standalone() }));

export const subscribeInstall = listener => { listeners.add(listener); return () => listeners.delete(listener); };
export const getInstallState = () => state;
export const isIosInstall = ios;
export const supportsInstall = window.isSecureContext && 'serviceWorker' in navigator;
export const openInstall = () => update({ manual: true, error: '' });
export function dismissInstall() {
  try { sessionStorage.setItem(dismissalKey, '1'); } catch { /* In-memory dismissal still works. */ }
  update({ dismissed: true, manual: false });
}

export async function requestInstall() {
  const prompt = state.prompt;
  if (!prompt || state.busy) return;
  update({ prompt: null, busy: true, error: '' });
  try {
    // Called directly by the Install click; the browser requires user activation.
    await prompt.prompt();
    await prompt.userChoice;
    dismissInstall();
    update({ busy: false });
  } catch {
    update({ busy: false, manual: true, error: 'The install prompt could not open. You can use the browser menu instead.' });
  }
}
