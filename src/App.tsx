import { useEffect, useRef, useState } from 'react';
import {
  Play,
  Pause,
  SkipForward,
  Heart,
  X,
  Send,
  VolumeX,
  MapPin,
  Gauge,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { Tour, type TourView } from './core/tour';
import { createBrowserAudio } from './core/player';
import { BUILD_ID } from './core/backend';
import { usePosition, useWakeLock } from './hooks';

type Pose = 'idle' | 'speaking' | 'listening' | 'thinking' | 'wave' | 'pointing' | 'liked';

function LeoFigure({ pose, large }: { pose: Pose; large?: boolean }) {
  return (
    <div className={`relative ${large ? 'h-52 sm:h-72' : 'h-36 sm:h-48'} flex items-end justify-center`}>
      <div className="absolute bottom-0 h-24 w-24 rounded-full bg-sky-500/20 blur-2xl" />
      <img
        src={`/leo/leo-${pose}.webp`}
        alt="Leo, your tour guide"
        className="relative max-h-full w-auto object-contain drop-shadow-2xl"
        draggable={false}
      />
    </div>
  );
}

function WaveBars() {
  return (
    <div className="flex h-5 items-center gap-1" aria-hidden>
      {[0, 1, 2, 3, 4].map(i => (
        <span
          key={i}
          className="leo-wave-bar w-1 rounded bg-sky-300"
          style={{ height: '100%', animationDelay: `${i * 0.12}s` }}
        />
      ))}
    </div>
  );
}

export default function App() {
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
  const [showDiagnostics, setShowDiagnostics] = useState(false);
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

  // Media Session: metadata + transport handlers (seek ±30 s).
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    if (view.nowPlaying) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: view.nowPlaying.label,
        artist: "Leo — Leo's World",
        album: "Leo's World Tour",
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
    const fresh = new Tour({ audio: createBrowserAudio() });
    engineRef.current = fresh;
    setEngine(fresh);
    fresh.start(resume);
  };

  const submitQuestion = (e: React.FormEvent) => {
    e.preventDefault();
    if (engine.submitQuestion(question)) setQuestion('');
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
          <LeoFigure pose="wave" large />
          <h1 className="leo-shimmer mt-2 bg-gradient-to-r from-sky-200 via-white to-amber-200 bg-clip-text text-center text-4xl font-bold text-transparent sm:text-5xl">
            Leo&rsquo;s World
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
                  onClick={() => startTour(true)}
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
              onClick={() => startTour(false)}
              className="mt-8 flex w-full items-center justify-center gap-2 rounded-2xl bg-sky-500 px-6 py-4 text-lg font-bold tracking-wide text-white shadow-lg shadow-sky-900/50 transition hover:bg-sky-400 active:scale-[0.99]"
            >
              <Play className="h-6 w-6" /> START TOUR
            </button>
          )}

          {!isStandalone && (
            <div className="mt-6 w-full rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
              <p className="text-sm font-medium text-slate-200">Add Leo to your home screen</p>
              <p className="mt-1 text-xs leading-relaxed text-slate-400">
                On iPhone: tap Share, then &ldquo;Add to Home Screen.&rdquo; On Android: use the
                browser menu&rsquo;s &ldquo;Install app.&rdquo; Best first run: stay in this
                browser tab so the location prompt behaves.
              </p>
            </div>
          )}

          <p className="mt-auto pt-8 text-center text-xs leading-relaxed text-slate-400">
            Leo is an AI guide. Stories are drawn from public records and local history —
            and like any good storyteller, he may occasionally get a detail wrong.
          </p>
        </main>
      </div>
    );
  }

  // ------------------------------------------------------------ tour
  const d = view.diagnostics;
  return (
    <div
      className="flex min-h-full flex-col bg-slate-950 text-slate-100"
      onPointerDown={() => engine.noteGesture()}
    >
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="leo-float absolute -top-24 right-0 h-72 w-72 rounded-full bg-sky-600/15 blur-3xl" />
      </div>

      <header className="safe-top relative flex items-center justify-between px-4 pt-2">
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <Gauge className="h-4 w-4 text-sky-300" />
          <span>
            {Math.floor(tourSeconds / 60)}:{String(tourSeconds % 60).padStart(2, '0')}
          </span>
          {d.neighborhood && <span className="text-slate-300">· {d.neighborhood}</span>}
        </div>
        <button
          onClick={() => engine.endTour()}
          className="flex items-center gap-1 rounded-full border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:bg-slate-800"
        >
          <X className="h-3.5 w-3.5" /> End tour
        </button>
      </header>

      <main className="relative flex flex-1 flex-col items-center px-5 pt-1">
        <LeoFigure pose={pose} />

        {view.banner === 'blocked' && (
          <button
            onClick={e => {
              e.stopPropagation();
              engine.bannerTap();
            }}
            className="mt-1 flex w-full max-w-md items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-3 text-sm font-semibold text-amber-950 shadow-lg transition hover:bg-amber-400"
          >
            <VolumeX className="h-5 w-5" /> Sound is blocked — tap to turn it on.
          </button>
        )}
        {view.banner === 'interrupted' && (
          <button
            onClick={e => {
              e.stopPropagation();
              engine.resumeByUser();
            }}
            className="mt-1 flex w-full max-w-md items-center justify-center gap-2 rounded-xl bg-sky-600 px-4 py-3 text-sm font-semibold text-white shadow-lg transition hover:bg-sky-500"
          >
            <Play className="h-5 w-5" /> Welcome back. Tap to keep the tour going.
          </button>
        )}

        <div className="mt-2 flex h-6 items-center gap-3">
          {view.nowPlaying ? <WaveBars /> : null}
          <p className="text-center text-sm font-medium text-sky-100">
            {view.nowPlaying
              ? view.nowPlaying.label
              : view.qaPhase === 'generating'
                ? 'Leo is thinking…'
                : 'Listening to the road…'}
          </p>
        </div>
        {view.upNext && (
          <p className="mt-0.5 text-center text-xs text-slate-400">Up next: {view.upNext}</p>
        )}

        {view.lastStory?.text && (
          <div className="mt-3 max-h-44 w-full max-w-xl overflow-y-auto rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
            <p className="text-sm leading-relaxed text-slate-200">{view.lastStory.text}</p>
          </div>
        )}

        {/* Transport */}
        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={() => engine.likeCurrent()}
            aria-label="Like this story"
            className={`rounded-full border p-3 transition ${
              view.likedSubject
                ? 'border-rose-400 bg-rose-500/20 text-rose-300'
                : 'border-slate-700 text-slate-300 hover:bg-slate-800'
            }`}
          >
            <Heart className="h-5 w-5" fill={view.likedSubject ? 'currentColor' : 'none'} />
          </button>
          {view.userPaused ? (
            <button
              onClick={() => engine.resumeByUser()}
              className="flex items-center gap-2 rounded-full bg-sky-500 px-6 py-3 text-sm font-semibold text-white transition hover:bg-sky-400"
            >
              <Play className="h-5 w-5" /> Resume
            </button>
          ) : (
            <button
              onClick={() => engine.pauseByUser()}
              className="flex items-center gap-2 rounded-full border border-slate-600 px-6 py-3 text-sm font-semibold text-slate-100 transition hover:bg-slate-800"
            >
              <Pause className="h-5 w-5" /> Pause
            </button>
          )}
          <button
            onClick={() => engine.skip()}
            aria-label="Skip this story"
            className="rounded-full border border-slate-700 p-3 text-slate-300 transition hover:bg-slate-800"
          >
            <SkipForward className="h-5 w-5" />
          </button>
        </div>

        {/* Q&A — text only (Erik's Oct 29 decision) */}
        <form onSubmit={submitQuestion} className="mt-5 w-full max-w-xl">
          <div
            className={`flex items-center gap-2 rounded-2xl border px-3 py-2 ${
              view.qaLocked ? 'border-slate-800 bg-slate-900/40 opacity-60' : 'border-slate-700 bg-slate-900/70'
            }`}
          >
            <input
              value={question}
              onChange={e => setQuestion(e.target.value)}
              onFocus={() => setQuestionFocused(true)}
              onBlur={() => setQuestionFocused(false)}
              disabled={view.qaLocked}
              placeholder={
                view.qaLocked
                  ? view.qaPhase === 'generating'
                    ? 'Leo is answering…'
                    : 'One question at a time…'
                  : 'Ask Leo about this place…'
              }
              className="w-full bg-transparent text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none"
              maxLength={300}
            />
            <button
              type="submit"
              disabled={view.qaLocked || question.trim().length === 0}
              aria-label="Ask"
              className="rounded-full bg-sky-500 p-2 text-white transition enabled:hover:bg-sky-400 disabled:opacity-40"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
          <p className="mt-1.5 text-center text-[11px] text-slate-500">
            Type a question — Leo answers one at a time, then the tour rolls on.
          </p>
        </form>

        {/* Diagnostics */}
        <button
          onClick={() => setShowDiagnostics(s => !s)}
          className="mt-4 flex items-center gap-1 text-xs text-slate-500 transition hover:text-slate-300"
        >
          Diagnostics {showDiagnostics ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>
        {showDiagnostics && (
          <div className="safe-bottom mb-4 mt-2 w-full max-w-xl rounded-xl border border-slate-800 bg-slate-900/70 p-3 font-mono text-[11px] leading-relaxed text-slate-400">
            <p>build: {BUILD_ID} · variant: fresh</p>
            <p>
              opening: {view.opening} · latch: {view.latch} · phase: {view.phase}
            </p>
            <p>
              stories played {d.storiesPlayed} · dropped {d.storiesDropped} · fillers {d.fillersPlayed} ·
              answers {d.questionsAnswered}
            </p>
            <p>
              storm: {d.storm ? 'yes' : 'no'} · tts quota: {d.ttsQuota ? 'TRIPPED' : 'ok'} · text
              quota: {d.storyQuota ? 'TRIPPED' : 'ok'} · prefetch buffer: {d.bufferCount}
            </p>
            <p>neighborhood: {d.neighborhood ?? '—'}</p>
          </div>
        )}
      </main>
    </div>
  );
}
