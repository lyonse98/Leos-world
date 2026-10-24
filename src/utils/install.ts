// Home-screen install helpers. Until Leo's World is a native app, the
// home-screen icon IS the app — these detect whether it is already
// installed, which platform's instructions apply, and capture Android
// Chrome's install prompt so the app can offer a real one-tap Install
// button instead of menu instructions.

export type InstallPlatform = 'ios-safari' | 'ios-other-browser' | 'android' | 'other';

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return (
    (typeof window.matchMedia === 'function' &&
      window.matchMedia('(display-mode: standalone)').matches) ||
    nav.standalone === true
  );
}

export function detectInstallPlatform(): InstallPlatform {
  if (typeof window === 'undefined') return 'other';
  const ua = window.navigator.userAgent;
  // iPadOS 13+ reports as Macintosh; the touch-point count gives it away.
  const isIOS =
    /iphone|ipad|ipod/i.test(ua) ||
    (window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1);
  if (isIOS) {
    // Add to Home Screen only exists in Safari — Chrome/Firefox on iOS
    // cannot install, so those users get "open in Safari" guidance.
    const isSafari = /safari/i.test(ua) && !/crios|fxios|edgios|opios/i.test(ua);
    return isSafari ? 'ios-safari' : 'ios-other-browser';
  }
  if (/android/i.test(ua)) return 'android';
  return 'other';
}

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    // Keep Chrome from showing its own mini-infobar; the app offers the
    // install at its own chosen moments (landing tip, post-tour nudge).
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
  });
}

export function canNativeInstall(): boolean {
  return deferredPrompt !== null;
}

export async function nativeInstall(): Promise<boolean> {
  if (!deferredPrompt) return false;
  const promptEvent = deferredPrompt;
  deferredPrompt = null;
  await promptEvent.prompt();
  const choice = await promptEvent.userChoice;
  return choice.outcome === 'accepted';
}
