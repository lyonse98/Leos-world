import { useEffect, useRef, useState } from 'react';
import { Play, Send, MapPin } from 'lucide-react';
import { Tour, type TourView } from './core/tour';
import { createBrowserAudio } from './core/player';
import { isTesterUnlocked, tryTesterUnlock } from './core/accessGate';
import { usePosition, useWakeLock } from './hooks';

/**
 * Q&A master switch for the APP LAYER (Erik, Nov 2, 2026 — liability
 * ruling): while false, no question surface renders anywhere in the
 * app and no component can reach the engine's question pipeline.
 * The pipeline itself (Tour.submitQuestion and everything downstream
 * of it, including the playback serialization it coordinates) is
 * deliberately left intact and dormant in the engine — the
 * fresh-verify harness still exercises it — so re-enabling Q&A is
 * flipping this flag back, nothing more.
 */
const QA_ENABLED = false;

type Pose = 'idle' | 'speaking' | 'listening' | 'thinking' | 'wave' | 'pointing' | 'liked';

function MilesFigure({ pose, large }: { pose: Pose; large?: boolean }) {
  return (
    <div className={`relative ${large ? 'h-52 sm:h-72' : 'h-36 sm:h-48'} flex items-end justify-center`}>
      <div className="absolute bottom-0 h-24 w-24 rounded-full bg-sky-500/20 blur-2xl" />
      <img
        src={`/miles/miles-${pose}.webp`}
        alt="Miles, your tour guide"
        className="relative max-h-full w-auto object-contain drop-shadow-2xl"
        draggable={false}
      />
    </div>
  );
}

/**
 * The Q&A form — text only (Erik's Oct 29 decision). Rendered ONLY
 * under QA_ENABLED (Nov 2, 2026): while the flag is off this
 * component never mounts, so no question input, hint, or submit
 * affordance exists anywhere in the app.
 */
function QuestionForm({
  question,
  qaLocked,
  qaPhase,
  onQuestionChange,
  onFocusChange,
  onSubmit,
}: {
  question: string;
  qaLocked: boolean;
  qaPhase: TourView['qaPhase'];
  onQuestionChange: (q: string) => void;
  onFocusChange: (focused: boolean) => void;
  onSubmit: (e: React.FormEvent) => void;
}) {
  return (
    <form onSubmit={onSubmit} className="mt-5 w-full max-w-xl">
      <div
        className={`flex items-center gap-2 rounded-2xl border px-3 py-2 ${
          qaLocked ? 'border-slate-800 bg-slate-900/40 opacity-60' : 'border-slate-700 bg-slate-900/70'
        }`}
      >
        <input
          value={question}
          onChange={e => onQuestionChange(e.target.value)}
          onFocus={() => onFocusChange(true)}
          onBlur={() => onFocusChange(false)}
          disabled={qaLocked}
          placeholder={
            qaLocked
              ? qaPhase === 'generating'
                ? 'Miles is answering…'
                : 'One question at a time…'
              : 'Ask Miles about this place…'
          }
          className="w-full bg-transparent text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none"
          maxLength={300}
        />
        <button
          type="submit"
          disabled={qaLocked || question.trim().length === 0}
          aria-label="Ask"
          className="rounded-full bg-sky-500 p-2 text-white transition enabled:hover:bg-sky-400 disabled:opacity-40"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
      <p className="mt-1.5 text-center text-[11px] text-slate-500">
        Type a question — Miles answers one at a time, then the tour rolls on.
      </p>
    </form>
  );
}

/**
 * Tester access gate screen (Nov 2, 2026). Rendered INSTEAD of the
 * tour shell while locked: nothing in MilesApp — no Tour, no landing
 * warm, no position watch — mounts behind this screen, so a locked
 * boot fires zero Gemini/Places traffic. Miles' landing styling.
 */
function AccessGate({ onUnlock }: { onUnlock: () => void }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState(false);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (tryTesterUnlock(code)) onUnlock();
    else setError(true);
  };

  return (
    <div className="min-h-full overflow-y-auto bg-slate-950 text-slate-100">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="leo-float absolute -top-20 -left-20 h-72 w-72 rounded-full bg-sky-600/20 blur-3xl" />
        <div className="leo-float-slow absolute top-1/3 -right-24 h-80 w-80 rounded-full bg-amber-500/10 blur-3xl" />
      </div>
      <main className="safe-top safe-bottom relative mx-auto flex min-h-full w-full max-w-xl flex-col items-center px-6 py-8">
        <MilesFigure pose="wave" large />
        <h1 className="leo-shimmer mt-2 bg-gradient-to-r from-sky-200 via-white to-amber-200 bg-clip-text text-center text-4xl font-bold text-transparent sm:text-5xl">
          Miles
        </h1>
        <p className="mt-3 text-center text-sm leading-relaxed text-slate-300 sm:text-base">
          Miles is in early testing right now. If someone sent you this link,
          they&rsquo;ll have given you a tester code — pop it in and we&rsquo;ll roll.
        </p>

        <form onSubmit={submit} className="mt-8 w-full rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
          <input
            value={code}
            onChange={e => {
              setCode(e.target.value);
              setError(false);
            }}
            type="text"
            placeholder="Tester code"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="go"
            aria-label="Tester code"
            className="w-full rounded-xl border border-slate-700 bg-slate-900/70 px-4 py-3 text-center text-base tracking-widest text-slate-100 placeholder:normal-case placeholder:tracking-normal placeholder:text-slate-500 focus:outline-none"
          />
          {error && (
            <p className="mt-2 text-center text-xs text-amber-300">
              That code doesn&rsquo;t look right — check with whoever sent you the link.
            </p>
          )}
          <button
            type="submit"
            className="mt-3 w-full rounded-xl bg-sky-500 px-4 py-3 text-sm font-semibold text-white transition hover:bg-sky-400 active:scale-[0.99]"
          >
            Unlock
          </button>
        </form>

        <p className="mt-auto pt-8 text-center text-xs leading-relaxed text-slate-400">
          Miles is an AI guide. Stories are drawn from public records and local history —
          and like any good storyteller, he may occasionally get a detail wrong.
        </p>
      </main>
    </div>
  );
}

export default function App() {
  // Tester gate first (Nov 2, 2026): the unlock check is a synchronous
  // localStorage read in the state initializer, so the very first
  // render already knows. Locked → the gate screen alone mounts;
  // MilesApp (which constructs the Tour and warms the landing) never
  // mounts, and no spend machinery starts. Unlocked → straight to
  // the shell, exactly as before, gate never shown again on this
  // device.
  const [unlocked, setUnlocked] = useState<boolean>(() => isTesterUnlocked());
  if (!unlocked) return <AccessGate onUnlock={() => setUnlocked(true)} />;
  return <MilesApp />;
}

function MilesApp() {
  // One Tour instance per tour (C2 discipline): an ended engine is
  // never restarted — START constructs a fresh engine, so no
  // per-tour state (ledgers, timers, the player's teardown) can
  // leak across tours. The landing instance only warms caches (S1);
  // its warming lives in shared on-device caches, so replacing it
  // at START loses nothing.
  const [engine, setEngine] = useState<Tour>(() => new Tour({ audio: createBrowserAudio() }));
  const engineRef = useRef(engine);
  engineRef.current = engine;

  const [view, setView] = useState<TourView>(() => engine.view());
  useEffect(() => {
    setView(engine.view());
    return engine.subscribe(() => setView(engine.view()));
  }, [engine]);

  const { position, error: locationError, granted } = usePosition(pos =>
    engineRef.current?.onPosition(pos),
  );
  useWakeLock(view.phase === 'active');

  const [resumeOffered, setResumeOffered] = useState<boolean>(() => Tour.hasResumableSession());
  const [question, setQuestion] = useState('');
  const [questionFocused, setQuestionFocused] = useState(false);
  const [tourSeconds, setTourSeconds] = useState(0);
  const warmedForRef = useRef<Tour | null>(null);

  // Landing warm (S1): opener assets + library index, committing nothing.
  useEffect(() => {
    if (granted && warmedForRef.current !== engine && view.phase === 'idle') {
      warmedForRef.current = engine;
      void engine.warmLanding();
    }
  }, [granted, view.phase, engine]);

  // Tour clock (display only).
  useEffect(() => {
    if (view.phase !== 'active') return;
    const started = Date.now();
    const t = setInterval(() => setTourSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(t);
  }, [view.phase]);

  // Interruption: stepping away mid-story arms the resume banner.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden' && view.phase === 'active' && view.nowPlaying) {
        engine.setInterrupted();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [engine, view.phase, view.nowPlaying]);

  // P2 salvage — document-level hold-retry net (A's hold watch):
  // while the unlock latch is unearned or lost, ANY pointerdown
  // anywhere retries the unlock — capture phase, so the retry
  // primes before the tap's own handlers run, and the driver never
  // has to find a specific control. The net lives exactly while the
  // latch is unearned/lost in an active tour; the Player coalesces
  // retries onto an in-flight prime, so extra taps are free.
  useEffect(() => {
    if (view.phase !== 'active' || view.latch === 'earned') return;
    const onDown = () => engineRef.current?.noteGesture();
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [view.phase, view.latch]);

  // Media Session: metadata + transport handlers (seek ±30 s).
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    if (view.nowPlaying) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: view.nowPlaying.label,
        artist: "Miles",
        album: "Miles — AI Guide for the Road",
      });
    }
    const set = (action: MediaSessionAction, fn: (() => void) | null) => {
      try {
        navigator.mediaSession.setActionHandler(action, fn);
      } catch {
        /* unsupported action on this platform */
      }
    };
    set('play', () => engine.resumeByUser());
    set('pause', () => engine.pauseByUser());
    set('seekbackward', () => engine.seekBy(-30));
    set('seekforward', () => engine.seekBy(30));
    set('nexttrack', () => engine.skip());
    return () => {
      set('play', null);
      set('pause', null);
      set('seekbackward', null);
      set('seekforward', null);
      set('nexttrack', null);
    };
  }, [engine, view.nowPlaying]);

  const pose: Pose = view.likedSubject
    ? 'liked'
    : view.banner
      ? 'pointing'
      : view.nowPlaying
        ? 'speaking'
        : view.qaPhase === 'generating'
          ? 'thinking'
          : questionFocused
            ? 'listening'
            : view.phase === 'active' && tourSeconds < 6
              ? 'wave'
              : 'idle';

  const startTour = (resume: boolean) => {
    setResumeOffered(false);
    // A fresh engine per tour, constructed and started inside the
    // tap: the GREETING's attempt is the handler's first media
    // action (O1), and no state from a previous tour can leak in.
    // The landing engine's warmed clip blob URLs ride along (P2):
    // the greeting — the prime carrier — plays from a local blob,
    // not a network fetch inside the tap.
    const fresh = new Tour({
      audio: createBrowserAudio(),
      clipUrls: engineRef.current?.clipUrls,
    });
    engineRef.current = fresh;
    setEngine(fresh);
    fresh.start(resume);
  };

  /**
   * P2 salvage — pointerdown-first-action: the tour starts on the
   * START tap's pointerdown (the earliest user-activation moment),
   * not on click, which trails it by the tap's full press duration.
   * Keyboard activation has no pointerdown; it arrives as a click
   * with detail === 0 and takes the same path. A mouse/touch tap
   * fires BOTH events — the detail guard keeps it to one start.
   */
  const startOnPointerDown = (resume: boolean) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    startTour(resume);
  };
  const startOnKeyboardClick = (resume: boolean) => (e: React.MouseEvent) => {
    if (e.detail !== 0) return; // a real tap already started on pointerdown
    startTour(resume);
  };

  const submitQuestion = (e: React.FormEvent) => {
    e.preventDefault();
    // QA_ENABLED gate (Nov 2, 2026): while Q&A is off, this handler
    // refuses to reach the engine's question pipeline even if a
    // question surface were somehow mounted.
    if (!QA_ENABLED) return;
    if (engine.submitQuestion(question)) setQuestion('');
  };

  /**
   * Face-only tour screen (Nov 2, 2026): a tap anywhere on the
   * running tour is invisible chrome carrying the functions the old
   * banners and transport buttons held — the sound-blocked gesture
   * retry (bannerTap), resume after a platform interruption or an
   * OS-level pause (resumeByUser), and otherwise the audio latch's
   * gesture re-prime (noteGesture, the P2/P8 net). Nothing renders
   * for any of these; Media Session handlers above cover transport
   * from the lock screen / car.
   */
  const onTourTap = () => {
    if (view.banner === 'blocked') engine.bannerTap();
    else if (view.banner === 'interrupted' || view.userPaused) engine.resumeByUser();
    else engine.noteGesture();
  };

  const isStandalone =
    typeof window !== 'undefined' &&
    (window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true);

  // ------------------------------------------------------------ landing
  if (view.phase !== 'active') {
    return (
      <div className="min-h-full overflow-y-auto bg-slate-950 text-slate-100">
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="leo-float absolute -top-20 -left-20 h-72 w-72 rounded-full bg-sky-600/20 blur-3xl" />
          <div className="leo-float-slow absolute top-1/3 -right-24 h-80 w-80 rounded-full bg-amber-500/10 blur-3xl" />
        </div>
        <main className="safe-top safe-bottom relative mx-auto flex min-h-full w-full max-w-xl flex-col items-center px-6 py-8">
          <MilesFigure pose="wave" large />
          <h1 className="leo-shimmer mt-2 bg-gradient-to-r from-sky-200 via-white to-amber-200 bg-clip-text text-center text-4xl font-bold text-transparent sm:text-5xl">
            Miles
          </h1>
          <p className="mt-3 text-center text-sm leading-relaxed text-slate-300 sm:text-base">
            A local friend riding shotgun — real stories about the streets you&rsquo;re
            driving, told as you pass them.
          </p>

          <div className="mt-5 flex items-center gap-2 text-xs text-slate-400">
            <MapPin className="h-4 w-4 text-sky-300" />
            {granted && position ? (
              <span>
                Located — {position.lat.toFixed(3)}, {position.lng.toFixed(3)}
              </span>
            ) : locationError ? (
              <span className="text-amber-300">{locationError}</span>
            ) : (
              <span>Finding you…</span>
            )}
          </div>

          {resumeOffered && view.phase === 'idle' ? (
            <div className="mt-8 w-full rounded-2xl border border-sky-500/30 bg-sky-950/60 p-4 text-center">
              <p className="text-sm font-medium text-sky-100">Tour in progress</p>
              <p className="mt-1 text-xs text-slate-400">
                You stepped away recently. Pick it back up, or start fresh.
              </p>
              <div className="mt-4 flex gap-3">
                <button
                  onPointerDown={startOnPointerDown(true)}
                  onClick={startOnKeyboardClick(true)}
                  className="flex-1 rounded-xl bg-sky-500 px-4 py-3 text-sm font-semibold text-white transition hover:bg-sky-400"
                >
                  RESUME TOUR
                </button>
                <button
                  onClick={() => setResumeOffered(false)}
                  className="flex-1 rounded-xl border border-slate-600 px-4 py-3 text-sm font-semibold text-slate-200 transition hover:bg-slate-800"
                >
                  Start Fresh
                </button>
              </div>
            </div>
          ) : (
            <button
              onPointerDown={startOnPointerDown(false)}
              onClick={startOnKeyboardClick(false)}
              className="mt-8 flex w-full items-center justify-center gap-2 rounded-2xl bg-sky-500 px-6 py-4 text-lg font-bold tracking-wide text-white shadow-lg shadow-sky-900/50 transition hover:bg-sky-400 active:scale-[0.99]"
            >
              <Play className="h-6 w-6" /> START TOUR
            </button>
          )}

          {!isStandalone && (
            <div className="mt-6 w-full rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
              <p className="text-sm font-medium text-slate-200">Add Miles to your home screen</p>
              <p className="mt-1 text-xs leading-relaxed text-slate-400">
                On iPhone: tap Share, then &ldquo;Add to Home Screen.&rdquo; On Android: use the
                browser menu&rsquo;s &ldquo;Install app.&rdquo; Best first run: stay in this
                browser tab so the location prompt behaves.
              </p>
            </div>
          )}

          <p className="mt-auto pt-8 text-center text-xs leading-relaxed text-slate-400">
            Miles is an AI guide. Stories are drawn from public records and local history —
            and like any good storyteller, he may occasionally get a detail wrong.
          </p>
        </main>
      </div>
    );
  }

  // ------------------------------------------------------------ tour
  // In-tour screen (Erik, Nov 2, 2026 — liability ruling): while a
  // tour is RUNNING the screen is Miles's face and nothing else —
  // no buttons, no text, no now-playing card, no controls of any
  // kind. Every background system (GPS, selection and playback,
  // the filler / bridge / hosted lanes, wake lock, telemetry and
  // diagnostics state) keeps running exactly as before; only the
  // display changed. The pre-tour landing above is untouched, the
  // audio unlock still rides the START tap and the tap routing in
  // onTourTap, and OS Media Session controls still work. Q&A
  // mounts only under QA_ENABLED, which is off.
  return (
    <div
      className="flex min-h-full flex-col bg-slate-950 text-slate-100"
      onPointerDown={onTourTap}
    >
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="leo-float absolute -top-24 right-0 h-72 w-72 rounded-full bg-sky-600/15 blur-3xl" />
      </div>

      <main className="safe-top safe-bottom relative flex flex-1 flex-col items-center justify-center px-5">
        <MilesFigure pose={pose} large />
        {QA_ENABLED && (
          <QuestionForm
            question={question}
            qaLocked={view.qaLocked}
            qaPhase={view.qaPhase}
            onQuestionChange={setQuestion}
            onFocusChange={setQuestionFocused}
            onSubmit={submitQuestion}
          />
        )}
      </main>
    </div>
  );
}
