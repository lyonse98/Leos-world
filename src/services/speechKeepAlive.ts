// Mobile browsers suspend speech synthesis while the page is hidden, which can
// cut a tour short the moment the listener switches to another app.
//
// A worker with a live timer keeps the page from being treated as fully idle,
// which in turn keeps the speech engine from being suspended outright. This is
// best effort by nature: the platform may still suspend us, which is why the
// app also offers a tap-to-resume path when it does.

let worker: Worker | null = null;
let workerUrl: string | null = null;

export function startSpeechKeepAlive(): void {
  if (worker) return;
  if (typeof Worker === 'undefined' || typeof Blob === 'undefined' || typeof URL === 'undefined') {
    return;
  }

  try {
    const source = 'let n = 0; setInterval(function () { n += 1; }, 1000);';
    workerUrl = URL.createObjectURL(new Blob([source], { type: 'application/javascript' }));
    worker = new Worker(workerUrl);
  } catch {
    // Worker unavailable (locked-down browser) — the tour still runs, it just
    // gets no help staying alive while hidden.
    worker = null;
    workerUrl = null;
  }
}

export function stopSpeechKeepAlive(): void {
  if (worker) {
    worker.terminate();
    worker = null;
  }
  if (workerUrl) {
    URL.revokeObjectURL(workerUrl);
    workerUrl = null;
  }
}
