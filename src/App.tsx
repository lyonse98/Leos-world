import { useEffect, useRef, useState } from 'react';
import { Play, Pause, Square, Send, MapPin, MessageCircle } from 'lucide-react';
import { Tour, type TourView } from './core/tour';
import { createBrowserAudio } from './core/player';
import { isTesterUnlocked, tryTesterUnlock } from './core/accessGate';
import { usePosition, useWakeLock } from './hooks';
import {
  budgetSecFor,
  composeRoutePlan,
  computeRoute,
  distanceToPathM,
  estimateDurationSec,
  geocodeDestination,
  isRouteModeEnabled,
  parseRouteInput,
  qaGateOpen,
  progressAlongPath,
  ROUTE_TONES,
  ROUTE_TOPICS,
  type LibraryUnit,
  type TourMode,
} from './core/routeMode';
import { RoutePlanRunner, type RouteRunnerView } from './core/routePlayback';
import { tagsFor } from './data/routeTags';
import {
  deviceKey,
  emitEvent,
  fetchHeardTopics,
  fetchHostedFillerRows,
  fetchLibraryIndex,
  fetchLibraryRow,
  recordHeard,
} from './core/backend';
import { generateAnswerText, synthesizeSpeech } from './core/gemini';
import { LEO_QA_MODEL_ID } from './services/leoPersona';

/**
 * Route-mode flag (v16.1, Nov 2, 2026): defaults ON on this branch
 * so Erik's branch-switch publish shows the mode box with no env
 * fiddling; VITE_ROUTE_MODE=0 restores the exact v15 landing (no
 * mode box, no intake form, freeform only). The freeform engine is
 * never touched by route code — route tours run on RoutePlanRunner,
 * a thin shell over the same Player.
 */
const ROUTE_MODE_ENABLED = isRouteModeEnabled(
  import.meta.env.VITE_ROUTE_MODE as string | undefined,
);

/**
 * Q&A gate (v16 phase 2 — Erik, Nov 3, 2026, activating the Nov 2
 * mode ruling): Q&A is available if and only if the ride's DECLARED
 * mode is Passenger/Walking. The Nov 2 liability suspension lifted
 * for passengers and walkers only; Driving keeps the suspension's
 * exact behavior — no question surface anywhere, and no component
 * can reach the question pipeline (the submit handlers refuse, and
 * a driving route runner never receives an answer generator).
 * The gate is qaGateOpen(ROUTE_MODE_ENABLED, rideMode) from
 * routeMode.ts: flag off (the v15 landing has no mode box, so no
 * mode is ever declared) also keeps Q&A off. The freeform pipeline
 * itself (Tour.submitQuestion and everything downstream, including
 * serialization and the welcome discharge) was left intact and
 * dormant in the engine through the suspension; phase 2 only
 * re-wires the App layer to it under this gate.
 */

type Pose = 'idle' | 'speaking' | 'listening' | 'thinking' | 'wave' | 'pointing' | 'liked';

/**
 * Miles in his world (Erik, Nov 2, 2026 ~12:03 — UI/presentation
 * only): the pose renders started life as square RGB images with a
 * baked-in background and no alpha, so dropping one into a flex slot
 * read as "a box with Miles in it" — a JPG in a frame. First pass
 * dissolved the square in feather masks; this pass removes the
 * background for real: MilesFigure renders the transparent CUTOUTS
 * (public/miles/miles-<pose>-cut.webp, generated from the approved
 * renders by scripts/assets/make-cutouts.py — same art, alpha
 * channel, cropped to the full head-to-waist bust). No masks remain
 * on the figure: a soft drop shadow is legitimate again because it
 * now traces HIM, not a rectangle. He stands inside a layered
 * CSS/SVG scene (sky wash, sun disc, sage hill silhouettes, a road
 * ribbon and ground plane with a soft contact shadow) shared by the
 * gate, the landing, and the tour screen. Pose selection and every
 * behavior around this component are unchanged.
 */
function MilesFigure({ pose, large, tour }: { pose: Pose; large?: boolean; tour?: boolean }) {
  const sizeClass = tour ? 'h-[min(62vh,36rem)]' : large ? 'h-64 sm:h-80' : 'h-44 sm:h-56';
  return (
    <div className={`relative w-full overflow-x-clip ${sizeClass}`}>
      {/* The world he stands in — decorative only, pointer-events
          none throughout. The clip layer keeps the scene's bleed
          from ever widening the page, and its own radial mask
          dissolves the scene's edges into the app ground. */}
      <div aria-hidden="true" className="pointer-events-none absolute -inset-x-5 top-0 bottom-0 z-0 sm:-inset-x-8">
        <div className="miles-scene-clip absolute inset-0 overflow-hidden">
          <div className="miles-sky absolute -inset-x-[10%] -top-[14%] bottom-[4%]" />
          <div
            className={`miles-sun absolute rounded-full ${
              tour ? 'top-[1%] right-[4%] h-48 w-48' : 'top-[3%] right-[8%] h-32 w-32'
            }`}
          />
          <svg
            className={`absolute left-1/2 -translate-x-1/2 ${tour ? 'bottom-[8%] w-[175%]' : 'bottom-[10%] w-[155%]'}`}
            viewBox="0 0 600 180"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <path
              d="M0 112 C70 74 148 122 228 94 C308 66 388 114 468 86 C528 65 572 84 600 74 L600 180 L0 180 Z"
              fill="#6d8a63"
              fillOpacity="0.16"
            />
            <path
              d="M0 140 C86 106 168 150 258 126 C348 102 430 148 518 120 C556 108 584 116 600 110 L600 180 L0 180 Z"
              fill="#4f6b47"
              fillOpacity="0.2"
            />
          </svg>
          <div className="miles-ground absolute -bottom-[8%] left-1/2 h-[36%] w-[135%] -translate-x-1/2" />
          <div
            className={`miles-road absolute -bottom-[5%] left-1/2 -translate-x-1/2 ${
              tour ? 'h-[34%] w-[58%]' : 'h-[30%] w-[52%] opacity-80'
            }`}
          />
          <div className="absolute bottom-[2.5%] left-1/2 h-[6%] w-[54%] -translate-x-1/2 rounded-[100%] bg-ink/20 blur-md" />
        </div>
      </div>

      {/* The figure himself: the transparent cutout, bottom-anchored
          at full height so the whole head-to-waist bust is always
          visible — the container never crops his torso. The drop
          shadow follows his silhouette (hair, arms, pointing hand),
          which is what grounds him in the scene; the elliptical
          contact shadow in the scene layer sits under his waist. */}
      <div className="absolute inset-0 z-10 flex items-end justify-center">
        <img
          src={`/miles/miles-${pose}-cut.webp`}
          alt="Miles, your tour guide"
          className="relative h-full w-auto max-w-none object-contain select-none [filter:drop-shadow(0_10px_16px_rgba(21,34,45,0.22))]"
          draggable={false}
        />
      </div>
    </div>
  );
}

/**
 * The Q&A form — text only (Erik's Oct 29 decision; voice /
 * hold-to-talk stays removed). Rendered ONLY when the phase-2
 * declared-mode gate is open (Passenger/Walking), inside the Ask
 * sheet on the tour screens. In Driving mode — and on the
 * flag-off v15 landing's tours — this component never mounts, so
 * no question input, hint, or submit affordance exists. Styling
 * follows the Nov 2 friendliness pass (cream card, pill input,
 * ink button), replacing the pre-suspension dark chrome.
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
    <form onSubmit={onSubmit} className="w-full">
      <div
        className={`flex items-center gap-2 rounded-full border-2 bg-white py-1.5 pr-1.5 pl-5 ${
          qaLocked ? 'border-sage/20 opacity-60' : 'border-sage/30'
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
          className="w-full bg-transparent text-sm text-ink placeholder:text-inksoft/50 focus:outline-none"
          maxLength={300}
        />
        <button
          type="submit"
          disabled={qaLocked || question.trim().length === 0}
          aria-label="Ask"
          className="rounded-full bg-ink p-2.5 text-cream shadow-md shadow-ink/20 transition enabled:hover:bg-sagedeep disabled:opacity-40"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
      <p className="mt-1.5 text-center text-[11px] text-inksoft">
        Type a question — Miles answers one at a time, then the tour rolls on.
      </p>
    </form>
  );
}

/**
 * trymiles.app poster backdrop (Nov 2, 2026 friendliness pass;
 * composition adjusted the same day for the cutouts): soft sage +
 * warm-sand light blobs and the site's giant outlined MILES behind
 * everything — warm cream ground via the root's bg-cream.
 *
 * Poster composition (Erik, Nov 2, 2026 ~12:11 — "i dont like how
 * image is opaque over the 'miles' text. either rearrange or change
 * opacity"): the text band is pinned to the TOP of the screen, so it
 * sits behind the figure's head-and-shoulders zone rather than
 * centered behind his torso, and the figure — rendered later, in
 * <main>'s relative stacking context — is unambiguously in front.
 * With the opaque square this arrangement failed because the whole
 * rectangle swallowed the letters; with the transparent cutouts
 * only his silhouette crosses the outline text, which is the
 * trymiles poster look. The stroke opacity also drops a notch
 * (0.10 → 0.08) so the band reads as backdrop, not a headline
 * competing with him. Purely decorative; pointer-events-none
 * throughout.
 */
function PosterBackdrop() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="leo-float absolute -top-20 -left-20 h-72 w-72 rounded-full bg-sage/25 blur-3xl" />
      <div className="leo-float-slow absolute top-1/3 -right-24 h-80 w-80 rounded-full bg-amber-200/40 blur-3xl" />
      <div
        aria-hidden="true"
        className="absolute top-1 left-1/2 -translate-x-1/2 text-[6.5rem] leading-none font-black tracking-wide whitespace-nowrap text-transparent select-none [-webkit-text-stroke:2px_rgba(21,34,45,0.08)] sm:text-[9rem]"
      >
        MILES
      </div>
    </div>
  );
}

/**
 * Legal links footer (Nov 2, 2026): Terms of Use + Privacy Policy,
 * live at trymiles.app/terms and trymiles.app/privacy. Shown on the
 * access gate and the pre-tour landing only — the in-tour screen
 * stays face-only with nothing tappable beyond the transport bar.
 */
function LegalLinks() {
  return (
    <p className="pt-3 text-center text-xs text-inksoft/70">
      <a
        href="https://trymiles.app/terms"
        target="_blank"
        rel="noreferrer"
        className="underline underline-offset-2"
      >
        Terms
      </a>
      {' · '}
      <a
        href="https://trymiles.app/privacy"
        target="_blank"
        rel="noreferrer"
        className="underline underline-offset-2"
      >
        Privacy
      </a>
    </p>
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
    <div className="miles-app-bg relative min-h-full overflow-y-auto bg-cream text-ink">
      <PosterBackdrop />
      <main className="safe-top safe-bottom relative mx-auto flex min-h-full w-full max-w-xl flex-col items-center px-6 py-8">
        <MilesFigure pose="wave" large />
        <h1 className="mt-2 text-center text-5xl font-black tracking-tight text-ink sm:text-6xl">
          Miles
        </h1>
        <p className="mt-3 text-center text-sm leading-relaxed text-inksoft sm:text-base">
          Miles is in early testing right now. If someone sent you this link,
          they&rsquo;ll have given you a tester code — pop it in and we&rsquo;ll roll.
        </p>

        <form onSubmit={submit} className="mt-8 w-full rounded-[2rem] bg-white/70 p-5 shadow-xl shadow-ink/10">
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
            className="w-full rounded-full border-2 border-sage/30 bg-white px-5 py-3.5 text-center text-base tracking-widest text-ink placeholder:normal-case placeholder:tracking-normal placeholder:text-inksoft/50 focus:border-sagedeep focus:outline-none"
          />
          {error && (
            <p className="mt-2 text-center text-xs text-amber-700">
              That code doesn&rsquo;t look right — check with whoever sent you the link.
            </p>
          )}
          <button
            type="submit"
            className="mt-3 w-full rounded-full bg-ink px-4 py-3.5 text-sm font-bold text-cream shadow-lg shadow-ink/20 transition hover:bg-sagedeep active:scale-[0.99]"
          >
            Unlock
          </button>
        </form>

        <p className="mt-auto pt-8 text-center text-xs leading-relaxed text-inksoft/80">
          Miles is an AI guide. Stories are drawn from public records and local history —
          and like any good storyteller, he may occasionally get a detail wrong.
        </p>
        <LegalLinks />
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

  // ---- route mode state (v16.1; all inert unless ROUTE_MODE_ENABLED) ----
  const [tourMode, setTourMode] = useState<TourMode>('driving');
  // The mode snapshot for the ride actually running (v16 phase 2):
  // tourMode is the landing's declared choice; rideMode copies it
  // at the moment a tour starts (freeform or route) and is what
  // the Q&A gate reads in-tour. It defaults to 'driving' — the
  // closed position — and the mode box is the only way it ever
  // becomes 'passenger', so a flag-off build can never open the
  // gate. The Ask sheet's open state lives here too.
  const [rideMode, setRideMode] = useState<TourMode>('driving');
  const [askOpen, setAskOpen] = useState(false);
  const qaOpen = qaGateOpen(ROUTE_MODE_ENABLED, rideMode);
  const [routeFormOpen, setRouteFormOpen] = useState(false);
  const [routeDest, setRouteDest] = useState('');
  const [routeArrival, setRouteArrival] = useState('');
  const [routeTone, setRouteTone] = useState('');
  const [routeTopics, setRouteTopics] = useState<string[]>([]);
  const [routeStatus, setRouteStatus] = useState('');
  const [routeBuilding, setRouteBuilding] = useState(false);
  const [routeRunner, setRouteRunner] = useState<RoutePlanRunner | null>(null);
  const [routeView, setRouteView] = useState<RouteRunnerView | null>(null);
  const [routeActive, setRouteActive] = useState(false);
  const [owedLine, setOwedLine] = useState<string | null>(null);
  const routeRunnerRef = useRef<RoutePlanRunner | null>(null);
  const routeSessionRef = useRef('');
  const positionRef = useRef<{ lat: number; lng: number } | null>(null);

  const { position, error: locationError, granted } = usePosition(pos => {
    engineRef.current?.onPosition(pos);
    positionRef.current = { lat: pos.lat, lng: pos.lng };
    routeRunnerRef.current?.onPosition({ lat: pos.lat, lng: pos.lng });
  });
  useWakeLock(view.phase === 'active' || routeActive);

  useEffect(() => {
    if (!routeRunner) return;
    setRouteView(routeRunner.view());
    return routeRunner.subscribe(() => setRouteView(routeRunner.view()));
  }, [routeRunner]);

  // Route closeout transition: only once the closeout line has
  // sounded (or failed) does the App move on — overrun resumes
  // freeform for the tail; arrival ends on the landing with the
  // 'Miles owes you' line as post-tour state (a line, not a screen).
  useEffect(() => {
    if (!routeActive || !routeView?.closeoutDone || !routeView.endedKind) return;
    const owed = routeView.owed;
    const tail = routeView.freeformTail;
    setRouteActive(false);
    routeRunnerRef.current = null;
    if (owed) setOwedLine(owed);
    if (tail) {
      setResumeOffered(false);
      const fresh = new Tour({ audio: createBrowserAudio(), clipUrls: engineRef.current?.clipUrls });
      engineRef.current = fresh;
      setEngine(fresh);
      fresh.start(false);
    }
  }, [routeActive, routeView]);

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

  // Media Session for route tours: same OS controls, wired to the
  // runner instead of the freeform engine. Face-only screen + these
  // controls are the whole route chrome (spec: OS Media Session
  // controls unaffected in both modes).
  useEffect(() => {
    if (!routeActive || !routeRunner || !('mediaSession' in navigator)) return;
    if (routeView?.nowPlaying) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: routeView.nowPlaying.label,
        artist: 'Miles',
        album: 'Miles — AI Guide for the Road',
      });
    }
    const set = (action: MediaSessionAction, fn: (() => void) | null) => {
      try {
        navigator.mediaSession.setActionHandler(action, fn);
      } catch {
        /* unsupported action on this platform */
      }
    };
    set('play', () => routeRunner.resumeByUser());
    set('pause', () => routeRunner.pauseByUser());
    set('seekbackward', () => routeRunner.seekBy(-30));
    set('seekforward', () => routeRunner.seekBy(30));
    set('nexttrack', () => routeRunner.skip());
    return () => {
      set('play', null);
      set('pause', null);
      set('seekbackward', null);
      set('seekforward', null);
      set('nexttrack', null);
    };
  }, [routeActive, routeRunner, routeView?.nowPlaying]);

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
    // Snapshot the declared mode for this ride (phase-2 Q&A gate).
    setRideMode(tourMode);
    setAskOpen(false);
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

  /**
   * Route build (v16.1): ONE static composition pass at departure.
   * Live calls, exactly three per build: one Gemini parse (local
   * fallback), one Places text search, one Routes computeRoutes.
   * Library rows are fetched only for corridor candidates in route
   * order (bounded at 60), so a build costs reads, not a shelf scan.
   * Heard exclusion keys on the heard ledger's own vocabulary
   * (place names — heard_stories.topic records labels, not keys).
   */
  const buildRoute = async () => {
    const origin = positionRef.current ?? (position ? { lat: position.lat, lng: position.lng } : null);
    if (!origin) {
      setRouteStatus('Miles needs your location first — wait for the “Located” line above.');
      return;
    }
    if (routeDest.trim().length === 0) {
      setRouteStatus('Tell Miles where you’re headed.');
      return;
    }
    setRouteBuilding(true);
    setRouteStatus('Building your route…');
    try {
      const nowMs = Date.now();
      const parsed = await parseRouteInput(
        routeDest,
        nowMs,
        import.meta.env.VITE_GEMINI_API_KEY as string | undefined,
      );
      const arrivalMs = routeArrival ? Date.parse(routeArrival) : null;
      const input = {
        ...parsed,
        arrivalTimeMs: Number.isFinite(arrivalMs) && (arrivalMs as number) > nowMs ? (arrivalMs as number) : parsed.arrivalTimeMs,
        tone: routeTone || parsed.tone,
        topics: routeTopics.length > 0 ? routeTopics : parsed.topics,
      };
      const placesKey =
        (import.meta.env.VITE_GOOGLE_PLACES_API_KEY as string | undefined) ??
        (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined) ??
        '';
      const geocoded = await geocodeDestination(input.destinationText, placesKey);
      if (!geocoded) {
        setRouteStatus('Couldn’t find that place — try a fuller name (e.g. “Balboa Park, San Diego”).');
        return;
      }
      const route = await computeRoute(origin, geocoded.location, placesKey);
      if (!route) {
        setRouteStatus('Couldn’t compute a route — check the drive and try again.');
        return;
      }
      const budget = budgetSecFor(input, nowMs, route.durationSec);
      const index = await fetchLibraryIndex();
      const candidates = index
        .map(e => ({
          entry: e,
          progress: progressAlongPath({ lat: e.lat, lng: e.lng }, route.path),
          near:
            distanceToPathM({ lat: e.lat, lng: e.lng }, route.path) <= 1500 ||
            Math.hypot(e.lat - geocoded.location.lat, e.lng - geocoded.location.lng) < 0.02,
        }))
        .filter(c => c.near)
        .sort((a, b) => a.progress - b.progress)
        .slice(0, 60);
      const heardLabels = new Set(await fetchHeardTopics(deviceKey()));
      const units: LibraryUnit[] = [];
      for (const c of candidates) {
        const row = await fetchLibraryRow(c.entry.place_key, c.entry.angle);
        if (!row) continue;
        const tags = tagsFor(row.place_key, row.angle);
        units.push({
          id: `${row.place_key}|${row.angle}`,
          placeKey: row.place_key,
          placeName: row.place_name,
          angle: row.angle,
          lat: row.lat,
          lng: row.lng,
          durationSec: estimateDurationSec(row.story_text),
          topics: tags.topics,
          tone: tags.tone,
          toneSecondary: tags.toneSecondary,
          audioPath: row.audio_path,
          storyText: row.story_text,
        });
      }
      const heardKeys = new Set(
        units.filter(u => heardLabels.has(u.placeName)).map(u => u.id),
      );
      const hosted = await fetchHostedFillerRows();
      const fillerUnits: LibraryUnit[] = hosted.slice(0, 10).map(f => ({
        id: `${f.place_key}|filler_hosted`,
        placeKey: f.place_key,
        placeName: f.place_name,
        angle: 'filler_hosted',
        lat: geocoded.location.lat,
        lng: geocoded.location.lng,
        durationSec: estimateDurationSec(f.story_text),
        topics: [],
        tone: null,
        toneSecondary: null,
        audioPath: f.audio_path,
        storyText: f.story_text,
      }));
      const plan = composeRoutePlan(units, route.path, geocoded.location, geocoded.name, input, {
        nowMs,
        heardKeys,
        fillerUnits,
        budgetSecOverride: budget,
      });
      plan.driveSec = route.durationSec;
      plan.budgetSec = budget;
      const plannedIds = new Set(plan.items.map(it => it.id));
      plan.shelfTease = units.find(u => !plannedIds.has(u.id) && !heardKeys.has(u.id)) ?? null;
      const sessionId = `route-${Date.now()}`;
      routeSessionRef.current = sessionId;
      // Phase-2 Q&A wiring: the runner receives the answer
      // generator ONLY when the declared-mode gate is open for
      // this ride. A driving route runner has no generator dep at
      // all — the Q&A pipeline is unreachable in it, not hidden.
      const qaAtBuild = qaGateOpen(ROUTE_MODE_ENABLED, tourMode);
      setRideMode(tourMode);
      setAskOpen(false);
      const runner = new RoutePlanRunner({
        audio: createBrowserAudio(),
        synthUrl: async text => {
          const blob = await synthesizeSpeech(text);
          return URL.createObjectURL(blob);
        },
        ...(qaAtBuild
          ? {
              generateAnswer: (prompt: string) => generateAnswerText(prompt),
              answerModelLabel: LEO_QA_MODEL_ID,
            }
          : {}),
        onStoryHeard: unit => {
          void recordHeard(sessionId, deviceKey(), unit.placeName, unit.storyText, unit.lat, unit.lng);
        },
        onEvent: (type, payload) => {
          const pos = positionRef.current;
          void emitEvent(sessionId, type, payload, { lat: pos?.lat ?? null, lng: pos?.lng ?? null, movementMode: tourMode });
        },
      });
      routeRunnerRef.current = runner;
      setRouteRunner(runner);
      setRouteActive(true);
      setRouteFormOpen(false);
      setRouteStatus('');
      await runner.start(plan);
    } catch {
      setRouteStatus('Something went wrong building the route — try again.');
    } finally {
      setRouteBuilding(false);
    }
  };

  const endRoute = () => {
    // The runner keeps any closeout 'Miles owes you' state it
    // already set; ending from the bar is a plain user end.
    if (routeRunnerRef.current?.view().owed) setOwedLine(routeRunnerRef.current.view().owed);
    routeRunnerRef.current?.endTour();
    setRouteActive(false);
    routeRunnerRef.current = null;
    setRouteRunner(null);
  };

  const submitQuestion = (e: React.FormEvent) => {
    e.preventDefault();
    // Phase-2 gate (Nov 3, 2026): while the declared mode is
    // Driving (or no mode was declared), this handler refuses to
    // reach the engine's question pipeline even if a question
    // surface were somehow mounted — the Nov 2 suspension's
    // discipline, scoped by the mode ruling.
    if (!qaOpen) return;
    if (engine.submitQuestion(question)) {
      setQuestion('');
      setAskOpen(false);
    }
  };

  const submitRouteQuestion = (e: React.FormEvent) => {
    e.preventDefault();
    // Same gate, route side: the runner additionally has no
    // generator dep at all on a driving ride, so this is the
    // second of two closed doors.
    if (!qaOpen) return;
    if (routeRunnerRef.current?.submitQuestion(question)) {
      setQuestion('');
      setAskOpen(false);
    }
  };

  /**
   * Tap-anywhere backup (Nov 2, 2026, face-only ruling): a tap
   * anywhere on the running tour is invisible chrome carrying the
   * functions the old banners held — the sound-blocked gesture
   * retry (bannerTap), resume after a platform interruption or an
   * OS-level pause (resumeByUser), and otherwise the audio latch's
   * gesture re-prime (noteGesture, the P2/P8 net). Since Erik's
   * amendment later the same day, the VISIBLE transport bar below
   * is the primary path for pause / resume / end; this surface
   * stays working as the backup it was built as. Media Session
   * handlers above also still cover transport from the lock
   * screen / car.
   */
  const onTourTap = () => {
    if (view.banner === 'blocked') engine.bannerTap();
    else if (view.banner === 'interrupted' || view.userPaused) engine.resumeByUser();
    else engine.noteGesture();
  };

  /**
   * Visible transport (Erik's amendment, Nov 2, 2026 ~11:55): the
   * primary toggle reads real engine state out of the view —
   * banner 'blocked' → Resume (the press IS the gesture retry,
   * bannerTap); banner 'interrupted' or userPaused → Resume
   * (resumeByUser); otherwise the tour is playing → Pause
   * (pauseByUser). End Tour (in the bar's JSX) calls the engine's
   * real endTour(): session_end telemetry files on the way out and
   * the flow returns to the landing.
   */
  const transportNeedsResume = view.banner !== null || view.userPaused;
  const onTransportPrimary = () => {
    if (view.banner === 'blocked') engine.bannerTap();
    else if (view.banner === 'interrupted' || view.userPaused) engine.resumeByUser();
    else engine.pauseByUser();
  };

  const isStandalone =
    typeof window !== 'undefined' &&
    (window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true);

  // ------------------------------------------------------------ landing
  // (routeActive skips the landing: the route screen below owns the
  // frame while a route tour runs, even though the freeform engine
  // is idle — route tours never construct a freeform Tour.)
  if (view.phase !== 'active' && !routeActive) {
    return (
      <div className="miles-app-bg relative min-h-full overflow-y-auto bg-cream text-ink">
        <PosterBackdrop />
        <main className="safe-top safe-bottom relative mx-auto flex min-h-full w-full max-w-xl flex-col items-center px-6 py-8">
          <MilesFigure pose="wave" large />
          <h1 className="mt-2 text-center text-5xl font-black tracking-tight text-ink sm:text-6xl">
            Miles
          </h1>
          <p className="mt-3 text-center text-sm leading-relaxed text-inksoft sm:text-base">
            A local friend riding shotgun — real stories about the streets you&rsquo;re
            driving, told as you pass them.
          </p>

          <div className="mt-5 flex items-center gap-2 text-xs font-semibold text-inksoft">
            <MapPin className="h-4 w-4 text-sagedeep" />
            {granted && position ? (
              <span>
                Located — {position.lat.toFixed(3)}, {position.lng.toFixed(3)}
              </span>
            ) : locationError ? (
              <span className="text-amber-700">{locationError}</span>
            ) : (
              <span>Finding you…</span>
            )}
          </div>

          {/* Route mode (v16.1): the mode box comes FIRST in the
              pre-tour flow — Passenger/Walking vs Driving, declared
              before Start Tour and never changeable mid-drive.
              Route mode and freeform both sit behind it. When the
              flag is off, none of this renders: the v15 landing. */}
          {ROUTE_MODE_ENABLED && (
            <div className="mt-8 w-full rounded-[2rem] bg-white/70 p-5 shadow-xl shadow-ink/10">
              <p className="text-sm font-bold text-ink">How are you riding?</p>
              <div className="mt-3 flex gap-3">
                <button
                  type="button"
                  onClick={() => setTourMode('passenger')}
                  aria-pressed={tourMode === 'passenger'}
                  className={`flex-1 rounded-full px-4 py-3 text-sm font-bold transition ${
                    tourMode === 'passenger' ? 'bg-ink text-cream shadow-lg shadow-ink/20' : 'bg-cream2 text-ink hover:bg-sage/25'
                  }`}
                >
                  Passenger / Walking
                </button>
                <button
                  type="button"
                  onClick={() => setTourMode('driving')}
                  aria-pressed={tourMode === 'driving'}
                  className={`flex-1 rounded-full px-4 py-3 text-sm font-bold transition ${
                    tourMode === 'driving' ? 'bg-ink text-cream shadow-lg shadow-ink/20' : 'bg-cream2 text-ink hover:bg-sage/25'
                  }`}
                >
                  Driving
                </button>
              </div>
              <p className="mt-2 text-center text-[11px] text-inksoft">
                This stays set for the whole ride — it can’t change mid-drive.
              </p>
            </div>
          )}

          {owedLine && (
            <p className="mt-6 w-full rounded-[2rem] bg-white/70 p-4 text-center text-sm font-bold text-ink shadow-lg shadow-ink/10">
              {owedLine}
            </p>
          )}

          {resumeOffered && view.phase === 'idle' ? (
            <div className="mt-8 w-full rounded-[2rem] bg-white/70 p-5 text-center shadow-xl shadow-ink/10">
              <p className="text-sm font-bold text-ink">Tour in progress</p>
              <p className="mt-1 text-xs text-inksoft">
                You stepped away recently. Pick it back up, or start fresh.
              </p>
              <div className="mt-4 flex gap-3">
                <button
                  onPointerDown={startOnPointerDown(true)}
                  onClick={startOnKeyboardClick(true)}
                  className="flex-1 rounded-full bg-ink px-4 py-3.5 text-sm font-bold text-cream shadow-lg shadow-ink/20 transition hover:bg-sagedeep"
                >
                  RESUME TOUR
                </button>
                <button
                  onClick={() => setResumeOffered(false)}
                  className="flex-1 rounded-full bg-cream2 px-4 py-3.5 text-sm font-bold text-ink transition hover:bg-sage/25"
                >
                  Start Fresh
                </button>
              </div>
            </div>
          ) : (
            <button
              onPointerDown={startOnPointerDown(false)}
              onClick={startOnKeyboardClick(false)}
              className="mt-8 flex w-full items-center justify-center gap-2 rounded-full bg-ink px-6 py-4 text-lg font-extrabold tracking-wide text-cream shadow-xl shadow-ink/25 transition hover:bg-sagedeep active:scale-[0.99]"
            >
              <Play className="h-6 w-6" /> START TOUR
            </button>
          )}

          {ROUTE_MODE_ENABLED && (
            <div className="mt-4 w-full">
              <button
                type="button"
                onClick={() => setRouteFormOpen(v => !v)}
                className="w-full rounded-full bg-cream2 px-6 py-3.5 text-sm font-bold text-ink transition hover:bg-sage/25"
              >
                {routeFormOpen ? 'Hide route planner' : 'Plan a route instead'}
              </button>
              {routeFormOpen && (
                <div className="mt-3 rounded-[2rem] bg-white/70 p-5 shadow-xl shadow-ink/10">
                  <label className="block text-sm font-bold text-ink" htmlFor="route-dest">
                    Where to?
                  </label>
                  <input
                    id="route-dest"
                    value={routeDest}
                    onChange={e => setRouteDest(e.target.value)}
                    placeholder="e.g. Balboa Park"
                    className="mt-2 w-full rounded-full border-2 border-sage/30 bg-white px-5 py-3 text-base text-ink placeholder:text-inksoft/50 focus:border-sagedeep focus:outline-none"
                  />
                  <label className="mt-4 block text-sm font-bold text-ink" htmlFor="route-arrival">
                    Arrive by (optional)
                  </label>
                  <input
                    id="route-arrival"
                    type="datetime-local"
                    value={routeArrival}
                    onChange={e => setRouteArrival(e.target.value)}
                    className="mt-2 w-full rounded-full border-2 border-sage/30 bg-white px-5 py-3 text-base text-ink focus:border-sagedeep focus:outline-none"
                  />
                  <label className="mt-4 block text-sm font-bold text-ink" htmlFor="route-tone">
                    Mood for the ride (optional)
                  </label>
                  <select
                    id="route-tone"
                    value={routeTone}
                    onChange={e => setRouteTone(e.target.value)}
                    className="mt-2 w-full rounded-full border-2 border-sage/30 bg-white px-5 py-3 text-base text-ink focus:border-sagedeep focus:outline-none"
                  >
                    <option value="">Any mood</option>
                    {ROUTE_TONES.map(t => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                  <p className="mt-4 text-sm font-bold text-ink">Topics (optional)</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {ROUTE_TOPICS.map(t => (
                      <button
                        key={t}
                        type="button"
                        aria-pressed={routeTopics.includes(t)}
                        onClick={() =>
                          setRouteTopics(prev => (prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]))
                        }
                        className={`rounded-full px-3 py-1.5 text-xs font-bold transition ${
                          routeTopics.includes(t) ? 'bg-ink text-cream' : 'bg-cream2 text-ink hover:bg-sage/25'
                        }`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => void buildRoute()}
                    disabled={routeBuilding}
                    className="mt-5 w-full rounded-full bg-ink px-4 py-3.5 text-sm font-bold text-cream shadow-lg shadow-ink/20 transition hover:bg-sagedeep disabled:opacity-50"
                  >
                    {routeBuilding ? 'Building…' : 'Build my route'}
                  </button>
                  {routeStatus && <p className="mt-3 text-center text-xs leading-relaxed text-inksoft">{routeStatus}</p>}
                  <p className="mt-2 text-center text-[11px] text-inksoft">
                    One route, composed at departure from stories you haven’t heard — no re-planning mid-drive.
                  </p>
                </div>
              )}
            </div>
          )}

          {!isStandalone && (
            <div className="mt-6 w-full rounded-[2rem] bg-white/70 p-5 shadow-lg shadow-ink/10">
              <p className="text-sm font-bold text-ink">Add Miles to your home screen</p>
              <p className="mt-1 text-xs leading-relaxed text-inksoft">
                On iPhone: tap Share, then &ldquo;Add to Home Screen.&rdquo; On Android: use the
                browser menu&rsquo;s &ldquo;Install app.&rdquo; Best first run: stay in this
                browser tab so the location prompt behaves.
              </p>
            </div>
          )}

          <p className="mt-auto pt-8 text-center text-xs leading-relaxed text-inksoft/80">
            Miles is an AI guide. Stories are drawn from public records and local history —
            and like any good storyteller, he may occasionally get a detail wrong.
          </p>
          <LegalLinks />
        </main>
      </div>
    );
  }

  // ------------------------------------------------------------ route tour
  // Route in-tour screen (v16.1): face-only, exactly like freeform
  // — Miles's face plus ONE minimal transport bar. No mode control
  // (the mode was declared pre-tour and never changes mid-drive),
  // no now-playing card, no route map, no summary screen. The
  // 'Miles owes you' tease lands on the landing as one line.
  // Phase 2 adds ONE thing, Passenger/Walking rides only: an Ask
  // pill in the bar opening the question sheet. Driving route
  // tours render exactly the phase-1 screen.
  if (routeActive && routeRunner) {
    const rView = routeView;
    const routeNeedsResume = Boolean(rView?.userPaused || rView?.guardPaused);
    return (
      <div
        className="miles-app-bg relative flex min-h-full flex-col bg-cream text-ink"
        onPointerDown={() => routeRunner.noteGesture()}
      >
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="leo-float absolute -top-24 right-0 h-72 w-72 rounded-full bg-sage/25 blur-3xl" />
          <div className="leo-float-slow absolute -bottom-24 -left-24 h-72 w-72 rounded-full bg-amber-200/40 blur-3xl" />
        </div>
        <main className="safe-top safe-bottom relative flex flex-1 flex-col items-center px-5">
          <div className="flex w-full flex-1 flex-col items-center justify-end">
            <MilesFigure
              pose={rView?.qaPhase === 'generating' ? 'thinking' : rView?.nowPlaying ? 'speaking' : 'idle'}
              large
              tour
            />
          </div>
          <div className="w-full max-w-xl pb-1" onPointerDown={e => e.stopPropagation()}>
            {qaOpen && askOpen && (
              <div className="mb-2 rounded-[2rem] bg-white/80 p-4 shadow-xl shadow-ink/15 backdrop-blur">
                <QuestionForm
                  question={question}
                  qaLocked={(rView?.qaPhase ?? 'idle') !== 'idle'}
                  qaPhase={rView?.qaPhase ?? 'idle'}
                  onQuestionChange={setQuestion}
                  onFocusChange={setQuestionFocused}
                  onSubmit={submitRouteQuestion}
                />
              </div>
            )}
            <div className="flex items-center gap-2 rounded-full bg-white/75 p-2 shadow-xl shadow-ink/15 backdrop-blur">
              <button
                type="button"
                onClick={() => (routeNeedsResume ? routeRunner.resumeByUser() : routeRunner.pauseByUser())}
                aria-label={routeNeedsResume ? 'Resume route' : 'Pause route'}
                className="flex flex-1 items-center justify-center gap-2 rounded-full bg-ink px-5 py-3.5 text-base font-bold text-cream shadow-md shadow-ink/20 transition hover:bg-sagedeep active:scale-[0.99]"
              >
                {routeNeedsResume ? <Play className="h-5 w-5" /> : <Pause className="h-5 w-5" />}
                {routeNeedsResume ? 'Resume' : 'Pause'}
              </button>
              {qaOpen && (
                <button
                  type="button"
                  onClick={() => setAskOpen(v => !v)}
                  aria-label="Ask Miles a question"
                  aria-expanded={askOpen}
                  className="flex items-center justify-center gap-2 rounded-full bg-sage/25 px-5 py-3.5 text-base font-bold text-ink transition hover:bg-sage/40 active:scale-[0.99]"
                >
                  <MessageCircle className="h-5 w-5" />
                  Ask
                </button>
              )}
              <button
                type="button"
                onClick={endRoute}
                aria-label="End route"
                className="flex items-center justify-center gap-2 rounded-full bg-cream2 px-5 py-3.5 text-base font-bold text-ink transition hover:bg-sage/25 active:scale-[0.99]"
              >
                <Square className="h-4 w-4" />
                End route
              </button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // ------------------------------------------------------------ tour
  // In-tour screen (Erik, Nov 2, 2026 — liability ruling, amended
  // by Erik ~11:55 the same day): while a tour is RUNNING the
  // screen is Miles's face plus ONE minimal visible transport bar
  // docked at the bottom — a Pause/Resume toggle and an End Tour
  // button, labels and all. Nothing else from the old chrome
  // returns: no header, clock, now-playing, Up next, cards, or
  // diagnostics. Every background system (GPS, selection and
  // playback, the filler / bridge / hosted lanes, wake lock,
  // telemetry and diagnostics state) keeps running exactly as
  // before. The pre-tour landing above is untouched, the audio
  // unlock still rides the START tap, the tap-anywhere surface
  // (onTourTap) still works as a backup, and OS Media Session
  // controls still work. Phase 2 (Nov 3, 2026): Passenger/Walking
  // rides add an Ask pill in the bar + the question sheet (the
  // mode gate above); Driving rides render exactly this screen
  // as it stood under the suspension — face + transport bar.
  return (
    <div
      className="miles-app-bg relative flex min-h-full flex-col bg-cream text-ink"
      onPointerDown={onTourTap}
    >
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="leo-float absolute -top-24 right-0 h-72 w-72 rounded-full bg-sage/25 blur-3xl" />
        <div className="leo-float-slow absolute -bottom-24 -left-24 h-72 w-72 rounded-full bg-amber-200/40 blur-3xl" />
      </div>

      <main className="safe-top safe-bottom relative flex flex-1 flex-col items-center px-5">
        <div className="flex w-full flex-1 flex-col items-center justify-end">
          <MilesFigure pose={pose} large tour />
        </div>

        {/* Visible transport bar. The bar swallows its own
            pointerdowns so a button press doesn't also fire the
            tap-anywhere backup behind it — the buttons are real
            gestures, and their handlers prime/resume the audio
            latch themselves, exactly as the old banners did. The
            safe-area padding lives on <main> (.safe-bottom), so
            the bar clears the home indicator. */}
        <div className="w-full max-w-xl pb-1" onPointerDown={e => e.stopPropagation()}>
          {qaOpen && askOpen && (
            <div className="mb-2 rounded-[2rem] bg-white/80 p-4 shadow-xl shadow-ink/15 backdrop-blur">
              <QuestionForm
                question={question}
                qaLocked={view.qaLocked}
                qaPhase={view.qaPhase}
                onQuestionChange={setQuestion}
                onFocusChange={setQuestionFocused}
                onSubmit={submitQuestion}
              />
            </div>
          )}
          <div className="flex items-center gap-2 rounded-full bg-white/75 p-2 shadow-xl shadow-ink/15 backdrop-blur">
            <button
              type="button"
              onClick={onTransportPrimary}
              aria-label={transportNeedsResume ? 'Resume tour' : 'Pause tour'}
              className="flex flex-1 items-center justify-center gap-2 rounded-full bg-ink px-5 py-3.5 text-base font-bold text-cream shadow-md shadow-ink/20 transition hover:bg-sagedeep active:scale-[0.99]"
            >
              {transportNeedsResume ? <Play className="h-5 w-5" /> : <Pause className="h-5 w-5" />}
              {transportNeedsResume ? 'Resume' : 'Pause'}
            </button>
            {qaOpen && (
              <button
                type="button"
                onClick={() => setAskOpen(v => !v)}
                aria-label="Ask Miles a question"
                aria-expanded={askOpen}
                className="flex items-center justify-center gap-2 rounded-full bg-sage/25 px-5 py-3.5 text-base font-bold text-ink transition hover:bg-sage/40 active:scale-[0.99]"
              >
                <MessageCircle className="h-5 w-5" />
                Ask
              </button>
            )}
            <button
              type="button"
              onClick={() => engine.endTour()}
              aria-label="End tour"
              className="flex items-center justify-center gap-2 rounded-full bg-cream2 px-5 py-3.5 text-base font-bold text-ink transition hover:bg-sage/25 active:scale-[0.99]"
            >
              <Square className="h-4 w-4" />
              End tour
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
