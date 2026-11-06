import { useEffect, useRef, useState } from 'react';
import { Play, Pause, Square, Send, MapPin, MessageCircle, Volume2, Waves } from 'lucide-react';
import { Tour, type TourView } from './core/tour';
import { createBrowserAudio } from './core/player';
import { isTesterUnlocked, tryTesterUnlock } from './core/accessGate';
import { usePosition, useWakeLock } from './hooks';
import {
  assessThreadCarried,
  budgetSecFor,
  buildWrapUpContext,
  composeRoutePlan,
  computeRoute,
  distanceToPathM,
  estimateDurationSec,
  familyHardExcluded,
  fetchHeardAwareCandidates,
  generatedRatingForAudioPath,
  haversineM,
  heardKeysForStories,
  isRouteModeEnabled,
  memberFetchSizing,
  orderFetchCandidates,
  parseRouteInput,
  qaGateOpen,
  qualifyingForkAlternatives,
  resolveDestination,
  routeOptionLabel,
  seatWovenMembers,
  selectMemberFetchEntries,
  wovenIndexSupportByTopic,
  WOVEN_MEMBER_CAP,
  ROUTE_TONES,
  ROUTE_TOPICS,
  type ComputedRouteOption,
  type LibraryUnit,
  type RouteAudience,
  type RouteChoiceRecord,
  type TourMode,
} from './core/routeMode';
import {
  advanceRouteBuildStage,
  routeBuildFailure,
  routeBuildUiState,
  RoutePlanRunner,
  routeStartButtonState,
  ROUTE_BUILD_STAGE_LABELS,
  type RouteBuildFailure,
  type RouteBuildStage,
  type RouteRunnerView,
} from './core/routePlayback';
import { finishLiveRenderBlob } from './core/audioFinish';
import {
  DEFAULT_NARRATION_VOICE,
  narrationRequest,
  wrapUpTextFor,
  type NarrationDeps,
} from './core/narration';
import { discoverGapSubjects, fillRouteGaps } from './core/routeGapFill';
import { colorizeRoutePlan } from './core/routeColor';
import { buildManifest, originAreaName, type RouteManifest } from './core/routeManifest';
import {
  loadDriveRecords,
  normalizePlaceName,
  saveDriveRecord,
  stillOwedSubjects,
} from './core/routeHistory';
import { tagsFor } from './data/routeTags';
import { presenceFor, wovenEligibleFor } from './data/routePresence';
import { loadAmbientEnabled, saveAmbientEnabled } from './core/ambience';
import {
  BUILD_ID,
  bucketUrl,
  captureRouteEpisode,
  deviceKey,
  emitEvent,
  fetchHeardStoryTexts,
  fetchHeardTopics,
  fetchHostedFillerRows,
  fetchLibraryIndex,
  fetchLibraryRow,
  ingestRouteGapStory,
  lsGet,
  lsSet,
  recordHeard,
} from './core/backend';
import { deliverEpisodeCapture } from './core/episodeCapture';
import { generateAnswerText, generateStoryText, synthesizeSpeech } from './core/gemini';
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
 * Drive-record store (addendum 2): the shell's own localStorage
 * helpers — client-side only, like the rest of the local state.
 * A failed read degrades to "no prior drives", never an error.
 */
const driveRecordStore = {
  read: () => lsGet('routeDrives'),
  write: (value: string) => lsSet('routeDrives', value),
};

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
 * Compact header for the stepped pre-tour screens (Nov 3, 2026
 * landing restructure): Miles's face at the standard (non-large)
 * size, the wordmark, and the located line — sized so each step
 * fits one phone viewport with room for its choices below.
 */
function PreTourHeader({
  granted,
  position,
  locationError,
}: {
  granted: boolean;
  position: { lat: number; lng: number } | null;
  locationError: string | null;
}) {
  return (
    <>
      <MilesFigure pose="wave" />
      <h1 className="mt-1 text-center text-4xl font-black tracking-tight text-ink">Miles</h1>
      <div className="mt-2 flex items-center justify-center gap-2 text-xs font-semibold text-inksoft">
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
    </>
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

/**
 * Route choice (Nov 5, 2026): one row of the fork picker — a
 * road the build could compose on, with its index into the
 * build's full parsed option list (the index capture and the
 * route_picked event file). Display order is the picker's
 * own: the default road first, then the qualifying
 * alternatives fastest-first.
 */
interface RoutePickChoice {
  option: ComputedRouteOption;
  captureIndex: number;
}

interface RoutePickerState {
  choices: RoutePickChoice[];
  /** Display index of the selected row (the fastest road pre-selected). */
  selected: number;
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
  // Landing steps (Nov 3, 2026 restructure, flag-on only): 'mode'
  // (Driving vs Passenger/Walking) → 'choice' (Freeform vs Route,
  // equal prominence) → 'route' (the intake). Each step fits one
  // viewport — no scrolling. Flag-off never reads this: the exact
  // v15 landing renders instead.
  const [landingStep, setLandingStep] = useState<'mode' | 'choice' | 'route'>('mode');
  const [routeDest, setRouteDest] = useState('');
  const [routeTone, setRouteTone] = useState('');
  // Audience coloring (Nov 5, 2026): the rating for THIS
  // build — 'standard' (the full story, Color Puck riding
  // along) or 'family' (the G-rated telling). Per-build like
  // tone/topics, never remembered, and deliberately NOT
  // coupled to the Driving/Passenger mode box: the kids-in-
  // the-car case is a Driving drive. The control is the only
  // source — the parse never reads a rating out of prose.
  const [routeAudience, setRouteAudience] = useState<RouteAudience>('standard');
  const [routeTopics, setRouteTopics] = useState<string[]>([]);
  const [routeStatus, setRouteStatus] = useState('');
  const [routeBuilding, setRouteBuilding] = useState(false);
  // Build staging honesty (Nov 4, 2026): the build's current
  // phase (its label rides the status line) and its filed
  // failure — a dead build renders a dedicated failed state
  // with a Try again, never a silent return to the idle form.
  const [routeBuildStage, setRouteBuildStage] = useState<RouteBuildStage>('route');
  const [routeFailure, setRouteFailure] = useState<RouteBuildFailure | null>(null);
  // Route choice (Nov 5, 2026): the fork picker's state while
  // a build pauses at the route hand-off, and the resolver
  // that resumes it — the confirm tap (or Back) settles the
  // promise buildRoute is awaiting. Null whenever no picker
  // is up; a build with no fork never touches either.
  const [routePicker, setRoutePicker] = useState<RoutePickerState | null>(null);
  const routePickResolveRef = useRef<((pick: RoutePickChoice | null) => void) | null>(null);
  const [routeRunner, setRouteRunner] = useState<RoutePlanRunner | null>(null);
  const [routeView, setRouteView] = useState<RouteRunnerView | null>(null);
  // Manifest (differentiator 3): the built plan's episode card,
  // shown on the tour screen until the Start tour tap.
  const [routeManifest, setRouteManifest] = useState<RouteManifest | null>(null);
  const [routeActive, setRouteActive] = useState(false);
  const [owedLine, setOwedLine] = useState<string | null>(null);
  const routeRunnerRef = useRef<RoutePlanRunner | null>(null);
  const routeSessionRef = useRef('');
  const positionRef = useRef<{ lat: number; lng: number } | null>(null);

  const { position, error: locationError, granted } = usePosition(pos => {
    engineRef.current?.onPosition(pos);
    positionRef.current = { lat: pos.lat, lng: pos.lng };
    routeRunnerRef.current?.onPosition({ lat: pos.lat, lng: pos.lng, speedMps: pos.speedMps });
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
    setLandingStep('mode');
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

  // The same net, route side (Nov 3, 2026): a route tour runs on
  // the runner's OWN audio element, which the freeform net above
  // can never prime. While a route tour is active and its latch
  // is unearned or lost, any pointerdown retries the route
  // player's unlock — capture phase, same discipline.
  const routeLatch = routeView?.latch;
  useEffect(() => {
    if (!routeActive || routeLatch === undefined || routeLatch === 'earned') return;
    const onDown = () => routeRunnerRef.current?.noteGesture();
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [routeActive, routeLatch]);

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
   * Route build (v16.1; composer v2, Nov 3, 2026): ONE static
   * composition pass at departure. The composition's live calls
   * are exactly three per build: one Gemini parse (local
   * fallback), one Places text search, one Routes computeRoutes
   * — each maps call walks ALL configured Google keys until one
   * answers (Nov 3, 2026: the keys' API-restriction lists differ
   * per key, so key selection is per call, never once per build).
   * The Coverage Guarantee pass after composition may add bounded
   * plan-time calls (discovery + generation + TTS + ingest, ≤2
   * generated stories) ONLY when the composed plan has a dead
   * stretch over 180 s — see fillRouteGaps. Library rows are
   * fetched HEARD-AWARE (composer v3.1): the fair candidate
   * order (round-robin across the whole path's progress
   * deciles, then topic-connected portals) is read in parallel
   * chunks until each decile holds its target of UNHEARD
   * candidates — the old ≤120 + ≤30 caps are what a fresh
   * shelf stops at; heard-saturated windows read deeper,
   * bounded by the read ceilings — never a shelf scan, and
   * no stretch of the drive is crowded out by a dense start.
   * Heard exclusion is STORY-level (composer v3.1): the ledger
   * files each telling's verbatim story text, so the build
   * matches fetched units against the filed texts and excludes
   * exactly the (place, angle) tellings heard — an unheard
   * angle of a heard place stays in play. Place-name labels
   * are still read for the subject-level consumers that speak
   * them (owed discharge, the manifest's new-to-you count).
   */
  const buildRoute = async () => {
    // Episode capture (Nov 4, 2026): the build's clock starts
    // at the tap — the stage marks below are the boundaries
    // the plan row files as its latency record.
    const buildT0 = Date.now();
    const origin = positionRef.current ?? (position ? { lat: position.lat, lng: position.lng } : null);
    if (!origin) {
      setRouteStatus('Miles needs your location first — give it a moment, then try again.');
      return;
    }
    if (routeDest.trim().length === 0) {
      setRouteStatus('Tell Miles where you’re headed.');
      return;
    }
    // A picker pause left by a superseded build resolves as a
    // Back — that build abandons quietly (it discards its own
    // runner on the null pick) rather than hanging forever.
    routePickResolveRef.current?.(null);
    routePickResolveRef.current = null;
    setRoutePicker(null);
    setRouteBuilding(true);
    setRouteFailure(null);
    setRouteBuildStage('route');
    setRouteStatus(ROUTE_BUILD_STAGE_LABELS.route);
    // One session id for the whole build, minted up front so a
    // build-time failure (geocode / route) files its telemetry
    // under the same id the tour itself would have used.
    const sessionId = `route-${Date.now()}`;
    routeSessionRef.current = sessionId;
    // The destination's library place_key (addendum 2), derived
    // once the library rows are in — the runner's drive record
    // is enriched with it at write time via this closure.
    let destPlaceKey: string | null = null;
    // The runner — and its audio element — is constructed and
    // PRIMED here, synchronously inside the Build tap, before the
    // build's first await (Nov 3, 2026 first-sound fix). Freeform
    // primes inside its START tap; the route player used to be
    // constructed only after the whole async build (parse →
    // geocode → routes → library fetches → plan-time rendering),
    // minutes past the tap, so its first play fell outside the
    // gesture window: WebKit refused it, the unlock latch never
    // earned, and the tour opened silent while claiming to speak.
    // The tap prime rides the local sample on the ROUTE element;
    // the composed plan is handed to this same runner below. A
    // build that fails discards the runner (a primed element,
    // nothing filed, no tour ran).
    // Phase-2 Q&A wiring is decided at tap time too: the runner
    // receives the answer generator ONLY when the declared-mode
    // gate is open for this ride. A driving route runner has no
    // generator dep at all — the Q&A pipeline is unreachable in
    // it, not hidden.
    // Episode capture (Nov 4, 2026): at most ONE
    // route_episode_capture_failed telemetry event per build,
    // however many rows fail to land (a missing table before
    // Erik's SQL paste is an expected state — the signal must
    // stay meaningful, not become per-build noise). The latch
    // is a plain closure: the outcome dep below can fire long
    // after this function returns, and it shares the latch.
    let captureFailureFiled = false;
    const fileCaptureFailure = (kind: 'plan' | 'outcome') => {
      if (captureFailureFiled) return;
      captureFailureFiled = true;
      const pos = positionRef.current;
      void emitEvent(
        sessionId,
        'route_episode_capture_failed',
        { kind },
        { lat: pos?.lat ?? null, lng: pos?.lng ?? null, movementMode: tourMode },
      );
    };
    const qaAtBuild = qaGateOpen(ROUTE_MODE_ENABLED, tourMode);
    // The narration seam (addendum 5): ONE deps object for
    // every piece of route-mode live narration in this build —
    // the runner's bridge/preview synthesis, the gap-fill
    // pass's gap stories, and the wrap-up (text authored
    // below; its synthesis rides the runner's render queue
    // through synthFinishedUrl) all draw from it, in Miles'
    // solo voice. A future second chair changes this wiring
    // and the narration layer, nothing else.
    const narration: NarrationDeps = {
      voice: DEFAULT_NARRATION_VOICE,
      synthesize: text => synthesizeSpeech(text),
      generateStory: prompt => generateStoryText(prompt),
    };
    const runner = new RoutePlanRunner({
      audio: createBrowserAudio(),
      synthUrl: async text => {
        const blob = await narration.synthesize(text);
        return URL.createObjectURL(blob);
      },
      // The wrap-up's seam (render-ahead pipeline, Nov 4,
      // 2026): synthesis WITH the standing audio finish — the
      // finish the wrap-up always carried when it rendered at
      // preparation time, now applied when its queue render
      // runs during the tour.
      synthFinishedUrl: async text => {
        const blob = await narration.synthesize(text);
        return URL.createObjectURL(await finishLiveRenderBlob(blob));
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
      onDriveRecord: record => {
        saveDriveRecord(driveRecordStore, { ...record, destinationPlaceKey: destPlaceKey });
      },
      // Episode capture (Nov 4, 2026): the runner files the
      // outcome row's payload at tour close; this wiring only
      // persists it. Fire-and-forget — deliverEpisodeCapture
      // never throws, and a failed insert (the table doesn't
      // exist until Erik pastes the SQL) changes nothing.
      episodeIds: { tourId: sessionId, buildId: BUILD_ID },
      onEpisodeOutcome: payload => {
        void deliverEpisodeCapture({
          insert: captureRouteEpisode,
          row: {
            tourId: sessionId,
            kind: 'outcome',
            buildId: BUILD_ID,
            payload: payload as unknown as Record<string, unknown>,
          },
          onFailure: () => fileCaptureFailure('outcome'),
        });
      },
      onEvent: (type, payload) => {
        const pos = positionRef.current;
        void emitEvent(sessionId, type, payload, { lat: pos?.lat ?? null, lng: pos?.lng ?? null, movementMode: tourMode });
      },
      // Ambient bed (Nov 5, 2026): route tours only — this
      // runner exists only for route mode, so freeform never
      // gets a bed in v1. Loops live in the tts-audio bucket
      // beside the story audio; the on/off state is the
      // persisted kill-switch setting (default ON).
      bed: {
        assets: {
          ocean: bucketUrl('ambience/ocean-v1.m4a'),
          road: bucketUrl('ambience/road-v1.m4a'),
          city: bucketUrl('ambience/city-air-v1.m4a'),
        },
        enabled: loadAmbientEnabled(),
        declaredMode: tourMode,
      },
    });
    routeRunnerRef.current = runner;
    runner.prime();
    let handedOver = false;
    const discardRunner = () => {
      if (handedOver) return;
      if (routeRunnerRef.current === runner) routeRunnerRef.current = null;
      runner.dispose();
    };
    try {
      const nowMs = Date.now();
      const parsed = await parseRouteInput(
        routeDest,
        nowMs,
        import.meta.env.VITE_GEMINI_API_KEY as string | undefined,
      );
      // Erik, Nov 3, 2026: ride duration replaces Arrive-by. The
      // parser still reads a typed "by <time>" clause, but no
      // arrival time is solicited by the UI or used anywhere —
      // the Routes drive-time estimate is the composition's sole
      // budget (budgetSecFor below).
      const input = {
        ...parsed,
        arrivalTimeMs: null,
        tone: routeTone || parsed.tone,
        topics: routeTopics.length > 0 ? routeTopics : parsed.topics,
        // Audience coloring (Nov 5, 2026): the rating is the
        // control's value, period — the parse never produces
        // one, and there is no prose that can talk a Standard
        // build Family or a Family build Standard.
        audience: routeAudience,
      };
      // Every configured Google key, in order (Nov 3, 2026): the
      // bundle's keys carry DIFFERENT API-restriction lists —
      // Places (New) answers on one key, Routes on another — so
      // geocodeDestination / computeRoute each walk this list
      // until a key answers, per call.
      const googleKeys = [
        import.meta.env.VITE_GOOGLE_PLACES_API_KEY as string | undefined,
        import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined,
        import.meta.env.VITE_GEMINI_API_KEY as string | undefined,
      ].filter((k): k is string => typeof k === 'string' && k.length > 0);
      // Destination resolution (Nov 4, 2026): a destination
      // that arrived WITH coordinates (a Places selection)
      // would resolve locally inside resolveDestination — no
      // geocode, immune to key restrictions. The shipped
      // intake is text-only, so no selection exists today and
      // free text geocodes, with the key rotation AND the one
      // retry pass behind it (tap 1 of Erik's first stationary
      // test died on the single-pass merged failure — see
      // routeMode.geocodeDestination).
      const geocodeStartMs = Date.now();
      const geo = await resolveDestination(input.destinationText, googleKeys, null);
      const geocodeEndMs = Date.now();
      if (!geo.destination) {
        // The failure SURFACES (Nov 4, 2026): a dedicated
        // failed state with a Try again (routeBuildFailure
        // carries the Nov 3 class split as its copy), in place
        // of the status-line whisper that left tap 1's dead
        // build looking merely quiet. The class still files
        // to telemetry, so the blockage stays visible in
        // analytics rather than masked as a bad query.
        setRouteStatus('');
        setRouteFailure(routeBuildFailure('geocode', geo.failure));
        void emitEvent(
          sessionId,
          'route_build_failed',
          { stage: 'geocode', reason: geo.failure ?? 'unknown' },
          { lat: origin.lat, lng: origin.lng, movementMode: tourMode },
        );
        discardRunner();
        return;
      }
      const geocoded = geo.destination;
      const routed = await computeRoute(origin, geocoded.location, googleKeys);
      const routeEndMs = Date.now();
      if (!routed.route) {
        // Same surfaced failed state as the geocode exit —
        // one failure surface for every stage of the build.
        setRouteStatus('');
        setRouteFailure(routeBuildFailure('route', routed.failure));
        void emitEvent(
          sessionId,
          'route_build_failed',
          { stage: 'route', reason: routed.failure ?? 'unknown' },
          { lat: origin.lat, lng: origin.lng, movementMode: tourMode },
        );
        discardRunner();
        return;
      }
      // Route choice (Nov 5, 2026) — phase A ends at this
      // hand-off. The Routes call returned every road it
      // found; the fork gate (competitiveness + divergence,
      // pure local geometry) decides whether the driver is
      // asked which road the episode composes on. The offered
      // facts file to telemetry on EVERY build, fork or not —
      // the friction audit that decides whether this step
      // earns its place (picker-show rate, non-fastest pick
      // rate) reads exactly this event.
      const offeredOptions = routed.options;
      const fork = qualifyingForkAlternatives(routed.route, offeredOptions.slice(1));
      const pickerShown = fork.length > 0;
      void emitEvent(
        sessionId,
        'route_alternatives_offered',
        {
          fork: pickerShown,
          count: offeredOptions.length - 1,
          durations: offeredOptions.map(o => o.durationSec),
        },
        { lat: origin.lat, lng: origin.lng, movementMode: tourMode },
      );
      let route: ComputedRouteOption = offeredOptions[0];
      let pickedIndex = 0;
      // The picker's human dwell, excluded from the compose
      // stage timing below: it is neither maps nor compose
      // work (the end-to-end total keeps it — the listener
      // did live through it).
      let pickerDwellMs = 0;
      if (pickerShown) {
        // The build pauses, pre-departure — the driver's own
        // seconds, the same character as the manifest card's
        // pause after it. The picker renders in the intake
        // card's status slot; the promise resolves on the
        // confirm tap, or with null on Back, which abandons
        // the build quietly: nothing composed, nothing spent.
        // No fork → this whole block is skipped and the build
        // proceeds on the default road exactly as before.
        const choices: RoutePickChoice[] = [
          { option: offeredOptions[0], captureIndex: 0 },
          ...fork.map(option => ({ option, captureIndex: offeredOptions.indexOf(option) })),
        ];
        setRouteStatus('Two good roads — pick the one you’re driving');
        const pickShownAtMs = Date.now();
        const pick = await new Promise<RoutePickChoice | null>(resolve => {
          routePickResolveRef.current = resolve;
          setRoutePicker({ choices, selected: 0 });
        });
        routePickResolveRef.current = null;
        setRoutePicker(null);
        pickerDwellMs = Date.now() - pickShownAtMs;
        if (!pick) {
          discardRunner();
          setRouteStatus('');
          return;
        }
        route = pick.option;
        pickedIndex = pick.captureIndex;
        void emitEvent(
          sessionId,
          'route_picked',
          {
            index: pickedIndex,
            is_fastest: route.durationSec === Math.min(...offeredOptions.map(o => o.durationSec)),
          },
          { lat: origin.lat, lng: origin.lng, movementMode: tourMode },
        );
      }
      // The choice record: every offered road, whether the
      // picker showed, and the road phase B composes on. Set
      // on the plan below (beside fetchStats) — the runner
      // files it in the decisions record, capture copies it
      // onto the plan payload.
      const routeChoice: RouteChoiceRecord = {
        offered: offeredOptions.map(o => ({
          description: o.description,
          durationSec: o.durationSec,
          distanceMeters: o.distanceMeters,
          routeLabels: [...o.routeLabels],
        })),
        pickerShown,
        pickedIndex,
      };
      // The route is known — the build enters the compose
      // phase (library fetch → compose → guarantee → seating),
      // and the status line names it. The ride estimate itself
      // rides the manifest card from here (its runtime line).
      setRouteBuildStage(s => advanceRouteBuildStage(s, 'compose'));
      setRouteStatus(ROUTE_BUILD_STAGE_LABELS.compose);
      const budget = budgetSecFor(route.durationSec);
      const index = await fetchLibraryIndex();
      const [heardLabelList, heardTextList] = await Promise.all([
        fetchHeardTopics(deviceKey()),
        fetchHeardStoryTexts(deviceKey()),
      ]);
      const heardLabels = new Set(heardLabelList);
      const heardTexts = new Set(heardTextList);
      // Corridor lifetime cap (Nov 4, 2026, addendum B): the
      // ledger files one row per telling with topic = the
      // place name, so counting a place's labels counts its
      // tellings across ALL angles — the input to the route
      // composer's stretch-retirement predicate. The ledger
      // read carries its standing 500-row window, the same
      // evidence window story-level heard already works from.
      // Keyed by the shared place-name normalizer the composer
      // looks up with.
      const corridorTellingCounts = new Map<string, number>();
      for (const label of heardLabelList) {
        const key = normalizePlaceName(label);
        corridorTellingCounts.set(key, (corridorTellingCounts.get(key) ?? 0) + 1);
      }
      // Heard-aware fetch (composer v3.1, commit B): walk the
      // fair candidate order in parallel chunks of 12, filing
      // each read row heard/unheard by its story text, and keep
      // reading deeper into the order until every progress
      // decile holds its unheard target — a heard-saturated
      // stretch refills instead of starving the plan. A fresh
      // shelf stops at the old caps' worth of reads; the read
      // ceilings bound the worst case (see routeMode).
      const fetchOrder = orderFetchCandidates(index, route.path, geocoded.location, (pk, ang) => tagsFor(pk, ang), {
        userTopics: input.topics,
      });
      const fetched = await fetchHeardAwareCandidates({
        geoOrder: fetchOrder.geo,
        portalOrder: fetchOrder.portals,
        path: route.path,
        readRow: e => fetchLibraryRow(e.place_key, e.angle),
        rowText: row => row.story_text,
        heardTexts,
      });
      const units: LibraryUnit[] = [];
      for (const { row } of [...fetched.geo, ...fetched.portals]) {
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
          // Woven eligibility (Nov 4, 2026): the presence
          // audit's register call for this telling, from the
          // bundled presence data — the composer consults it
          // for thread support, the seating pass for members.
          wovenEligible: wovenEligibleFor(row.place_key, row.angle),
          // Audience coloring (Nov 5, 2026): the Protected
          // register from the same presence data (the
          // composer/seating/gap code reads it on the unit),
          // and the generated-rating stamp read off the row's
          // audio key — Family classifications consult both.
          protectedRegister: presenceFor(row.place_key, row.angle)?.protected ?? false,
          generatedRating: generatedRatingForAudioPath(row.audio_path),
        });
      }
      // Story-level heard (composer v3.1): a unit is excluded
      // only when the ledger holds a telling with its own
      // verbatim text — one heard angle no longer takes the
      // whole place out of the route's window.
      const heardKeys = heardKeysForStories(units, heardTexts);
      // Index-level thread support (the member-fetch lever,
      // Nov 4, 2026): the county index this build already
      // fetched (bundled tags + presence data) holds seatable
      // woven depth far beyond the departure fetch's window.
      // Support is recomputed before every compose with the
      // build's GROWING fetched set — departure fetch, then
      // the climax fetch, then the member fetch — so a row
      // in hand is never also counted as index promise.
      const fetchedIdSet = new Set(
        [...fetched.geo, ...fetched.portals].map(x => `${x.entry.place_key}|${x.entry.angle}`),
      );
      const wovenSupportNow = () =>
        wovenIndexSupportByTopic(
          index,
          route.path,
          geocoded.location,
          (pk, ang) => tagsFor(pk, ang),
          (pk, ang) => wovenEligibleFor(pk, ang),
          { fetchedIds: fetchedIdSet, heardIds: heardKeys },
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
      // "Previously on Miles" (addendum 2): derive the
      // destination's library place_key (a fetched unit that IS
      // the destination, by name) and load the stored prior
      // drives with their owed lists discharged against THIS
      // build's heard ledger — a subject heard since that drive
      // is never presented as still owed. The composer matches
      // at most one record (destination, then thread) and feeds
      // it to the spoken preview only.
      destPlaceKey =
        units.find(u => normalizePlaceName(u.placeName) === normalizePlaceName(geocoded.name))?.placeKey ??
        null;
      const driveRecords = loadDriveRecords(driveRecordStore).map(r => ({
        ...r,
        owedSubjects: stillOwedSubjects(r, heardLabels),
      }));
      const composeOpts = {
        nowMs,
        heardKeys,
        fillerUnits,
        budgetSecOverride: budget,
        driveSec: route.durationSec,
        driveRecords,
        destinationPlaceKey: destPlaceKey,
        corridorTellingCounts,
        wovenIndexSupport: wovenSupportNow(),
      };
      let plan = composeRoutePlan(units, route.path, geocoded.location, geocoded.name, input, composeOpts);
      // The off-route portal climax (consolidation §4): when the
      // composed plan left the slot open on a topic, ONE
      // additional bounded fetch may answer it — landmark-class
      // units carrying that topic from anywhere in the county
      // (off this route's corridor, away from the destination),
      // drawn from the library index this build already fetched.
      // Survivors join a SINGLE re-compose as climax-only
      // candidates: they can take the climax slot and nothing
      // else — they never tile, hop, or open chapters. No
      // survivors (or a bar still unmet) ships the first plan
      // exactly as composed; there is never a second fetch.
      let climaxOnlyUnits: LibraryUnit[] = [];
      if (plan.portalClimaxSeeking) {
        const topic = plan.portalClimaxSeeking;
        const extraRows = index
          .filter(
            e =>
              e.angle.startsWith('landmark') &&
              !fetchedIdSet.has(`${e.place_key}|${e.angle}`) &&
              tagsFor(e.place_key, e.angle).topics.includes(topic) &&
              distanceToPathM({ lat: e.lat, lng: e.lng }, route.path) > 1500 &&
              haversineM({ lat: e.lat, lng: e.lng }, geocoded.location) > 1500,
          )
          .slice(0, 12);
        for (const e of extraRows) {
          const row = await fetchLibraryRow(e.place_key, e.angle);
          // Story-level heard (v3.1): only this exact telling is out.
          if (!row || (row.story_text != null && heardTexts.has(row.story_text))) continue;
          const tags = tagsFor(row.place_key, row.angle);
          climaxOnlyUnits.push({
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
            // Audience coloring (Nov 5, 2026): the portal-
            // climax pool is one of the lanes the composer's
            // partition never sees — its Family exclusion
            // consults these fields on the unit directly.
            protectedRegister: presenceFor(row.place_key, row.angle)?.protected ?? false,
            generatedRating: generatedRatingForAudioPath(row.audio_path),
          });
        }
        if (climaxOnlyUnits.length > 0) {
          for (const u of climaxOnlyUnits) fetchedIdSet.add(u.id);
          plan = composeRoutePlan(units, route.path, geocoded.location, geocoded.name, input, {
            ...composeOpts,
            wovenIndexSupport: wovenSupportNow(),
            climaxOnlyUnits,
          });
        }
      }
      // The member fetch (the member-fetch lever, Nov 4,
      // 2026): when the composed plan's thread cannot seat
      // its members from the departure fetch's candidates,
      // ONE additional bounded fetch answers it — landmark-
      // class, woven-eligible units carrying the thread's
      // topic from anywhere in the county, drawn from the
      // same library index (selectMemberFetchEntries), read
      // in the heard-aware chunk size toward the seat need's
      // survivor target and never past its read cap. The
      // need is the plan's own (wovenMemberNeed): the
      // standing 4 seats, or 8 when the composed plan's geo
      // coverage already sits below the thread-carried
      // floor — the fetch provisions for the cap the
      // post-guarantee assessment may raise (memberFetch-
      // Sizing scales both numbers off the seat count).
      // Survivors join a SINGLE re-compose as member units:
      // they can seat as thread members and nothing else —
      // they never tile, hop, or contest the climax (the
      // climax units above ride along so a settled portal
      // climax survives the re-compose). No survivors ships
      // the plan exactly as composed; there is never a
      // second member fetch.
      let memberUnits: LibraryUnit[] = [];
      let memberFetchRecord: { topic: string; reads: number; candidates: number } | null = null;
      if (plan.wovenMembersSeeking) {
        const topic = plan.wovenMembersSeeking;
        const sizing = memberFetchSizing(plan.wovenMemberNeed ?? WOVEN_MEMBER_CAP);
        const entries = selectMemberFetchEntries(index, {
          topic,
          fetchedIds: fetchedIdSet,
          path: route.path,
          destination: geocoded.location,
          tagsOf: (pk, ang) => tagsFor(pk, ang),
          eligibleOf: (pk, ang) => wovenEligibleFor(pk, ang),
          cap: sizing.readCap,
        });
        let reads = 0;
        for (let i = 0; i < entries.length && memberUnits.length < sizing.target; i += 12) {
          const chunk = entries.slice(i, i + 12);
          const rows = await Promise.all(chunk.map(e => fetchLibraryRow(e.place_key, e.angle)));
          reads += chunk.length;
          for (let j = 0; j < chunk.length; j++) {
            const row = rows[j];
            // Story-level heard (v3.1): only this exact telling is out.
            if (!row || (row.story_text != null && heardTexts.has(row.story_text))) continue;
            const tags = tagsFor(row.place_key, row.angle);
            memberUnits.push({
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
              wovenEligible: wovenEligibleFor(row.place_key, row.angle),
              // Audience coloring (Nov 5, 2026): member
              // candidacy consults the Protected register and
              // the rating stamp (wovenMemberCandidates).
              protectedRegister: presenceFor(row.place_key, row.angle)?.protected ?? false,
              generatedRating: generatedRatingForAudioPath(row.audio_path),
            });
          }
        }
        memberFetchRecord = { topic, reads, candidates: memberUnits.length };
        if (memberUnits.length > 0) {
          for (const u of memberUnits) fetchedIdSet.add(u.id);
          plan = composeRoutePlan(units, route.path, geocoded.location, geocoded.name, input, {
            ...composeOpts,
            wovenIndexSupport: wovenSupportNow(),
            climaxOnlyUnits,
            memberUnits,
          });
        }
      }
      // Coverage Guarantee (Nov 3, 2026 — route differentiator 1):
      // walk the composed plan for dead stretches over 180 s and
      // fill them at plan time. Untiled units from THIS build's
      // fetched set tile first (library first, always); a stretch
      // still bare after the shelf pass gets one plan-time
      // generated story — fetch-ahead discovery over the build's
      // Google keys, the freeform live-generation path, the style
      // gate, the runner's own TTS path — capped at 2 per build,
      // promoted into story_library on success, and every step
      // timeout-guarded: any failure ships the composed plan as
      // it was. One route_gap_fill telemetry event per gap.
      plan = await fillRouteGaps(
        plan,
        { fetchedUnits: units, heardKeys, input, driveSec: route.durationSec },
        {
          discoverSubjects: points => discoverGapSubjects(points, googleKeys),
          generateStory: prompt => narration.generateStory(prompt),
          synthesize: text => narration.synthesize(text),
          ingest: ({ unit, audio }) =>
            ingestRouteGapStory({
              placeKey: unit.placeKey,
              placeName: unit.placeName,
              angle: unit.angle,
              lat: unit.lat,
              lng: unit.lng,
              storyText: unit.storyText ?? '',
              audio,
              // Audience coloring (Nov 5, 2026): the
              // generating rating (stamped on the unit by
              // the fill pass) becomes the promotion-key
              // marker — the row's durable rating record.
              rating: unit.generatedRating ?? 'standard',
            }),
          onEvent: event => {
            void emitEvent(
              sessionId,
              'route_gap_fill',
              { ...event },
              { lat: origin.lat, lng: origin.lng, movementMode: tourMode },
            );
          },
          onGenerateStart: () => setRouteStatus('Filling a quiet stretch…'),
        },
      );
      plan.driveSec = route.durationSec;
      plan.budgetSec = budget;
      // Woven seated members (Nov 4, 2026): AFTER the Coverage
      // Guarantee has claimed its ground — off-route,
      // woven-eligible stories on the plan's through-line
      // thread seat into the silence that remains, up to 4,
      // as windowless members with honest ranging bridges.
      // The climax is already settled (a member is never the
      // climax), heard exclusion is the build's own story-
      // level set, and the pass is a no-op when the plan has
      // no thread or no eligible candidate fits a real gap.
      plan = seatWovenMembers(plan, [...units, ...memberUnits], { heardKeys });
      // Thread-carried episodes (Nov 4, 2026): the
      // assessment runs on the guaranteed plan — geo-
      // anchored coverage (stories + guarantee fills,
      // members excluded) under half the drive, with a
      // thread to carry it, engages the mode. The record
      // rides the plan into route_plan_started; when
      // active, the seating pass runs once more in its
      // anchoring mode — members may open and anchor the
      // episode under the raised cap (8 total), the
      // strongest takes the climax position when the road
      // crowned none, and the preview is reframed around
      // the quiet road and the thread. Inactive (every
      // geo-healthy plan): nothing below changes the plan.
      const threadCarried = assessThreadCarried(plan);
      plan = { ...plan, threadCarried };
      if (threadCarried.active) {
        plan = seatWovenMembers(plan, [...units, ...memberUnits], {
          heardKeys,
          maxMembers: threadCarried.memberCap,
          threadCarried: true,
        });
      }
      // Color Puck (audience coloring, Nov 5, 2026): the plan
      // shape is final — author the color pieces into it.
      // Standard builds gain Color Puck beats on the reaction
      // slots, as asides after uncovered stories, and as one
      // closeout line; Family builds pass through untouched
      // (the color prompt never runs there — Miles hosts
      // alone). The pieces are plan tissue whose texts exist
      // at plan-fix like every live piece's; their synthesis
      // rides the render-ahead queue and the runner's feed
      // gate kills any piece whose story drops. A generation
      // failure anywhere in the pass degrades to the composed
      // plan — color is garnish, never a build failure.
      plan = await colorizeRoutePlan(plan, {
        generateColor: prompt => narration.generateStory(prompt),
      });
      const plannedIds = new Set(plan.items.map(it => it.id));
      plan.shelfTease =
        units.find(
          u =>
            !plannedIds.has(u.id) &&
            !heardKeys.has(u.id) &&
            // The owed story the wrap-up teases must be
            // seatable under the build's rating: never tease
            // a story the Family build itself could not tell
            // (the hard class can never be owed).
            !(input.audience === 'family' && familyHardExcluded(u)),
        ) ?? null;
      // The fetch's read accounting rides the plan into the
      // runner's route_plan_started telemetry (v3.1, commit B) —
      // the member fetch's own record rides beside it when
      // the lever fired, never folded into the window's counts.
      plan.fetchStats = memberFetchRecord
        ? { ...fetched.stats, memberFetch: memberFetchRecord }
        : fetched.stats;
      // The route-choice record rides the same way (Nov 5,
      // 2026): the runner files it in route_plan_started's
      // decisions and the capture's plan payload reads it.
      plan.routeChoice = routeChoice;
      // The wrap-up (addendum 3): ONE closing narration for the
      // episode, written for the planned drive played to finish
      // (destination arrival beat + thread payoff as arc
      // language + sign-off; the context carries plan facts
      // only, never a played set, so it can assert no recap).
      // Its TEXT is authored NOW, at preparation — deterministic
      // from plan facts, like every live piece's text. Its
      // SYNTHESIS is a render-ahead queue item in the runner
      // (last in plan order, through the finished-audio seam):
      // the runner holds it as the plan's closing piece and
      // plays it only on arrival with the plan run out; an
      // early end or overrun never uses it. Failure here never
      // fails the build: a text-authoring failure proceeds
      // without it, and a synthesis failure degrades the same
      // way at close — arrival falls back to today's closeout
      // either way. route_wrap_up 'generated'/'failed' for the
      // SYNTHESIS now fire from the runner when the render
      // completes; the 'failed' below is text-authoring only.
      // The recording phase begins at this exact milestone:
      // the plan is about to be fixed and the runner's render
      // queue IS the recording — the opening completes behind
      // the manifest card, under the same stage label, and the
      // remaining pieces record ahead of the listener.
      const recordingStartMs = Date.now();
      setRouteBuildStage(s => advanceRouteBuildStage(s, 'recording'));
      setRouteStatus(ROUTE_BUILD_STAGE_LABELS.recording);
      try {
        const wrapReq = narrationRequest('wrapup', buildWrapUpContext(plan));
        const wrapText = wrapUpTextFor(wrapReq.context);
        plan.wrapUp = { text: wrapText, audioUrl: null };
      } catch {
        plan.wrapUp = null;
        void emitEvent(
          sessionId,
          'route_wrap_up',
          { wrap_up: 'failed' },
          { lat: origin.lat, lng: origin.lng, movementMode: tourMode },
        );
      }
      // Hand the plan to the runner primed at the tap (above):
      // same runner, same element, latch already earned inside
      // the gesture window — item 1 now begins as a normal play,
      // not as a prime attempted minutes too late.
      setRideMode(tourMode);
      setAskOpen(false);
      handedOver = true;
      setRouteRunner(runner);
      setRouteActive(true);
      setRouteFormOpen(false);
      setRouteStatus('');
      // Manifest (differentiator 3): the composed episode gets
      // its card before it gets its first sound. The manifest
      // is built from the FINAL plan (post-gap-fill) and the
      // heard ledger this build already read: place-key set for
      // the new-to-you count, nearest fetched unit for the
      // origin area's name. The runner renders the plan and
      // HOLDS it behind the card — no story window is consumed
      // while the listener reads — and the card's Start
      // listening tap begins (and re-primes) playback. An empty
      // plan has no episode to present: it takes the standing
      // overrun path immediately, exactly as before.
      const storyCount = plan.items.filter(it => it.kind === 'story').length;
      if (storyCount === 0) {
        setRouteManifest(null);
        await runner.start(plan);
      } else {
        const heardPlaceKeys = new Set(
          units.filter(u => heardLabels.has(u.placeName)).map(u => u.placeKey),
        );
        const firstStory = plan.items.find(it => it.kind === 'story' && it.unit);
        setRouteManifest(
          buildManifest(plan, heardPlaceKeys, {
            originName: originAreaName(units, origin, firstStory?.unit?.placeName ?? 'Here'),
          }),
        );
        await runner.stage(plan);
      }
      // Episode capture (Nov 4, 2026; schema 2 under the
      // render-ahead pipeline): the OPENING has settled —
      // stage()/start() resolved when the runner's Start gate
      // flipped ready (behind the manifest card, or already
      // running for an empty plan) — and every live text
      // exists, since texts are authored at compose time and
      // only synthesis is pipelined. The stage timings read
      // accordingly: recording = plan-fix → opening settled,
      // total = tap → opening settled. File the plan row NOW,
      // tour or no tour: stationary builds are episodes too,
      // and the analysis needs their words. The render
      // verdicts for pieces still in flight ride the outcome
      // row. Fire-and-forget by construction.
      const settledAtMs = Date.now();
      const planCapture = runner.episodePlanCapture({
        declaredMode: tourMode,
        destinationText: input.destinationText,
        tone: input.tone,
        topics: input.topics,
        // Audience coloring (Nov 5, 2026): the build's rating
        // rides the plan row (additive; schema stays 2) —
        // alongside color_pieces, the count of Color Puck
        // beats the plan carries. The outcome row's dropped[]
        // says which pieces died with their stories.
        audience: input.audience,
        stageTimingsMs: {
          geocode: geocodeEndMs - geocodeStartMs,
          routes: routeEndMs - geocodeEndMs,
          maps: routeEndMs - buildT0,
          // The fork picker's human dwell (fork builds only)
          // is excluded — it is neither maps nor compose work.
          compose: recordingStartMs - routeEndMs - pickerDwellMs,
          recording: settledAtMs - recordingStartMs,
          total: settledAtMs - buildT0,
        },
        settledAtMs,
      });
      if (planCapture) {
        void deliverEpisodeCapture({
          insert: captureRouteEpisode,
          row: {
            tourId: sessionId,
            kind: 'plan',
            buildId: BUILD_ID,
            payload: planCapture as unknown as Record<string, unknown>,
          },
          onFailure: () => fileCaptureFailure('plan'),
        });
      }
    } catch {
      // Any later-stage failure (compose / fetch / render)
      // surfaces in the same failed state (Nov 4, 2026). If the
      // plan had already been handed over when it threw, unwind
      // the handover first: the failed state lives on the form,
      // and a half-started route screen must not be left holding
      // a runner that will never play.
      if (handedOver) {
        handedOver = false;
        if (routeRunnerRef.current === runner) routeRunnerRef.current = null;
        try {
          runner.dispose();
        } catch {
          /* already gone */
        }
        setRouteRunner(null);
        setRouteActive(false);
        setRouteManifest(null);
        setRouteFormOpen(true);
      } else {
        discardRunner();
      }
      setRouteStatus('');
      setRouteFailure(routeBuildFailure('build', null));
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
    setRouteManifest(null);
    setLandingStep('mode');
    routeRunnerRef.current = null;
    setRouteRunner(null);
  };

  // The route build's failed state (Nov 4, 2026), rendered by
  // BOTH route forms: a plain-language message and a Try again
  // that restarts the build cleanly (buildRoute mints a fresh
  // session id and a fresh primed runner per call — no wedged
  // state survives into the retry). The derivation is
  // routeBuildUiState's: the block exists only in the failed
  // kind — a retry in flight shows its stage label instead.
  const routeBuildUi = routeBuildUiState({
    building: routeBuilding,
    stage: routeBuildStage,
    failure: routeFailure,
  });
  const routeFailureBlock =
    routeBuildUi.kind === 'failed' ? (
      <div className="mt-3 rounded-[1.5rem] bg-white/80 p-4 text-center shadow-lg shadow-ink/10">
        <p className="text-sm font-bold text-ink">{routeBuildUi.failure.message}</p>
        <button
          type="button"
          onClick={() => void buildRoute()}
          className="mt-3 w-full rounded-full bg-ink px-4 py-3 text-sm font-bold text-cream shadow-lg shadow-ink/20 transition hover:bg-sagedeep active:scale-[0.99]"
        >
          Try again
        </button>
      </div>
    ) : null;

  // Route choice (Nov 5, 2026): the fork picker's taps. The
  // confirm settles the paused build's promise with the
  // selected road (the build button reads 'Build on this
  // road' while the picker is up — see the forms below); Back
  // settles it with null, which abandons the build quietly.
  // The resolver is claimed (nulled) before it fires, so a
  // double tap settles the build exactly once.
  const confirmRoutePick = () => {
    const resolve = routePickResolveRef.current;
    const picker = routePicker;
    routePickResolveRef.current = null;
    if (!resolve || !picker) return;
    resolve(picker.choices[picker.selected] ?? picker.choices[0]);
  };
  const cancelRoutePick = () => {
    const resolve = routePickResolveRef.current;
    routePickResolveRef.current = null;
    resolve?.(null);
  };

  // The fork picker (Nov 5, 2026), rendered by BOTH route
  // forms in the slot the build status/failure block occupies
  // — it replaces the status area of an already-submitted
  // form, adding no page height beyond its ≤3 rows (the
  // no-scroll discipline). Tapping a row only moves the
  // selection; no build starts on a stray tap.
  const routePickerBlock = routePicker ? (
    <div className="mt-3 rounded-[1.5rem] bg-white/80 p-4 shadow-lg shadow-ink/10">
      <p className="text-center text-sm font-bold text-ink">Which road are you taking?</p>
      <div className="mt-3 flex flex-col gap-2">
        {routePicker.choices.map((choice, i) => (
          <button
            key={choice.captureIndex}
            type="button"
            aria-pressed={routePicker.selected === i}
            onClick={() => setRoutePicker(p => (p ? { ...p, selected: i } : p))}
            className={`w-full rounded-full px-4 py-3 text-sm font-bold transition ${
              routePicker.selected === i
                ? 'bg-ink text-cream shadow-lg shadow-ink/20'
                : 'bg-cream2 text-ink hover:bg-sage/25'
            }`}
          >
            {routeOptionLabel(choice.option, i)}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={cancelRoutePick}
        className="mt-3 w-full rounded-full px-4 py-2 text-xs font-bold text-inksoft transition hover:text-ink"
      >
        Back
      </button>
    </div>
  ) : null;

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

  // ------------------------------------------------------------ landing (stepped, flag-on)
  // Erik's restructure (Nov 3, 2026): with route mode on, the
  // pre-tour flow is three one-viewport steps — (1) the declared
  // mode, Driving vs Passenger/Walking, as two large EQUAL
  // choices; (2) Freeform vs Route as two EQUAL choices (route is
  // no longer a collapsed "instead" tucked under the freeform
  // button); (3) the route intake. No step scrolls on mobile: the
  // shell is h-dvh with overflow hidden and a compact header. The
  // declared mode still snapshots at tour start exactly as before
  // (startTour / buildRoute read tourMode), stays immutable
  // mid-drive, and the Q&A gate consumes it unchanged. Flag off
  // never reaches here — the legacy landing below renders instead,
  // byte-for-byte the v15 landing.
  if (ROUTE_MODE_ENABLED && view.phase !== 'active' && !routeActive) {
    const equalChoiceBtn =
      'w-full rounded-full bg-ink px-6 py-5 text-lg font-extrabold tracking-wide text-cream shadow-xl shadow-ink/25 transition hover:bg-sagedeep active:scale-[0.99]';
    const choiceCaption = 'mt-0.5 block text-xs font-semibold tracking-normal text-cream/70';
    return (
      <div className="miles-app-bg relative h-dvh overflow-hidden bg-cream text-ink">
        <PosterBackdrop />
        <main className="safe-top safe-bottom relative mx-auto flex h-full w-full max-w-xl flex-col px-6 py-4">
          {landingStep !== 'route' && !(landingStep === 'choice' && resumeOffered) && (
            <PreTourHeader granted={granted} position={position} locationError={locationError} />
          )}

          {landingStep === 'mode' && (
            <>
              {owedLine && (
                <p className="mt-4 w-full rounded-[2rem] bg-white/70 p-4 text-center text-sm font-bold text-ink shadow-lg shadow-ink/10">
                  {owedLine}
                </p>
              )}
              <div className="flex flex-1 flex-col justify-end pb-2">
                <p className="text-center text-base font-bold text-ink">How are you riding?</p>
                <div className="mt-4 flex flex-col gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setTourMode('driving');
                      setLandingStep('choice');
                    }}
                    className={equalChoiceBtn}
                  >
                    Driving
                    <span className={choiceCaption}>Just the stories — eyes on the road</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setTourMode('passenger');
                      setLandingStep('choice');
                    }}
                    className={equalChoiceBtn}
                  >
                    Passenger / Walking
                    <span className={choiceCaption}>Stories — and you can ask Miles questions</span>
                  </button>
                </div>
                <p className="mt-3 text-center text-[11px] text-inksoft">
                  This stays set for the whole ride — it can&rsquo;t change mid-drive.
                </p>
              </div>
            </>
          )}

          {landingStep === 'choice' && (
            <>
              <div className="mt-3 flex items-center justify-center gap-2 text-xs font-semibold text-inksoft">
                <span>Riding: {tourMode === 'driving' ? 'Driving' : 'Passenger / Walking'}</span>
                <button
                  type="button"
                  onClick={() => setLandingStep('mode')}
                  className="font-bold text-sagedeep underline underline-offset-2"
                >
                  Change
                </button>
              </div>
              {resumeOffered && view.phase === 'idle' && (
                <div className="mt-4 w-full rounded-[2rem] bg-white/70 p-5 text-center shadow-xl shadow-ink/10">
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
              )}
              <div className="flex flex-1 flex-col justify-end pb-2">
                <p className="text-center text-base font-bold text-ink">How do you want to ride?</p>
                <div className="mt-4 flex flex-col gap-3">
                  <button onPointerDown={startOnPointerDown(false)} onClick={startOnKeyboardClick(false)} className={equalChoiceBtn}>
                    <span className="flex items-center justify-center gap-2">
                      <Play className="h-6 w-6" /> Freeform
                    </span>
                    <span className={choiceCaption}>Stories as you pass them — no destination</span>
                  </button>
                  <button type="button" onClick={() => setLandingStep('route')} className={equalChoiceBtn}>
                    <span className="flex items-center justify-center gap-2">
                      <MapPin className="h-6 w-6" /> Route
                    </span>
                    <span className={choiceCaption}>One destination — Miles plans the ride</span>
                  </button>
                </div>
              </div>
            </>
          )}

          {landingStep === 'route' && (
            <div className="flex flex-1 flex-col">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setLandingStep('choice')}
                  className="rounded-full bg-cream2 px-4 py-2 text-xs font-bold text-ink transition hover:bg-sage/25"
                >
                  ‹ Back
                </button>
                <p className="text-base font-extrabold text-ink">Plan a route</p>
              </div>
              <label className="mt-4 block text-sm font-bold text-ink" htmlFor="route-dest-step">
                Where to?
              </label>
              <input
                id="route-dest-step"
                value={routeDest}
                onChange={e => {
                  setRouteDest(e.target.value);
                  setRouteFailure(null);
                }}
                placeholder="e.g. Balboa Park"
                className="mt-2 w-full rounded-full border-2 border-sage/30 bg-white px-5 py-3 text-base text-ink placeholder:text-inksoft/50 focus:border-sagedeep focus:outline-none"
              />
              <label className="mt-3 block text-sm font-bold text-ink" htmlFor="route-tone-step">
                Mood for the ride (optional)
              </label>
              <select
                id="route-tone-step"
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
              {/* Audience coloring (Nov 5, 2026): the rating
                  selector sits beside Mood in both route forms
                  — a per-build choice, defaulting to Standard,
                  deliberately separate from the Driving /
                  Passenger mode box. */}
              <label className="mt-3 block text-sm font-bold text-ink" htmlFor="route-audience-step">
                Audience (optional)
              </label>
              <select
                id="route-audience-step"
                value={routeAudience}
                onChange={e => setRouteAudience(e.target.value as RouteAudience)}
                className="mt-2 w-full rounded-full border-2 border-sage/30 bg-white px-5 py-3 text-base text-ink focus:border-sagedeep focus:outline-none"
              >
                <option value="standard">Standard — the full story</option>
                <option value="family">Family — the G-rated telling</option>
              </select>
              <p className="mt-3 text-sm font-bold text-ink">Topics (optional)</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {ROUTE_TOPICS.map(t => (
                  <button
                    key={t}
                    type="button"
                    aria-pressed={routeTopics.includes(t)}
                    onClick={() =>
                      setRouteTopics(prev => (prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]))
                    }
                    className={`rounded-full px-2.5 py-1 text-[11px] font-bold transition ${
                      routeTopics.includes(t) ? 'bg-ink text-cream' : 'bg-cream2 text-ink hover:bg-sage/25'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => (routePicker ? confirmRoutePick() : void buildRoute())}
                disabled={routeBuilding && !routePicker}
                className="mt-4 w-full rounded-full bg-ink px-4 py-3.5 text-sm font-bold text-cream shadow-lg shadow-ink/20 transition hover:bg-sagedeep disabled:opacity-50"
              >
                {routePicker ? 'Build on this road' : routeBuilding ? 'Building…' : 'Build my route'}
              </button>
              {routeStatus && <p className="mt-2 text-center text-xs leading-relaxed text-inksoft">{routeStatus}</p>}
              {routePickerBlock}
              {routeFailureBlock}
              <p className="mt-2 text-center text-[11px] text-inksoft">
                One route, composed at departure from stories you haven&rsquo;t heard — no re-planning mid-drive.
              </p>
            </div>
          )}

          <p className="pt-3 text-center text-[11px] leading-relaxed text-inksoft/80">
            Miles is an AI guide — he may occasionally get a detail wrong.
          </p>
          <LegalLinks />
        </main>
      </div>
    );
  }

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
                    onChange={e => {
                      setRouteDest(e.target.value);
                      setRouteFailure(null);
                    }}
                    placeholder="e.g. Balboa Park"
                    className="mt-2 w-full rounded-full border-2 border-sage/30 bg-white px-5 py-3 text-base text-ink placeholder:text-inksoft/50 focus:border-sagedeep focus:outline-none"
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
                  {/* Audience coloring (Nov 5, 2026): the same
                      rating selector as the stepped form —
                      beside Mood, per-build, default Standard. */}
                  <label className="mt-4 block text-sm font-bold text-ink" htmlFor="route-audience">
                    Audience (optional)
                  </label>
                  <select
                    id="route-audience"
                    value={routeAudience}
                    onChange={e => setRouteAudience(e.target.value as RouteAudience)}
                    className="mt-2 w-full rounded-full border-2 border-sage/30 bg-white px-5 py-3 text-base text-ink focus:border-sagedeep focus:outline-none"
                  >
                    <option value="standard">Standard — the full story</option>
                    <option value="family">Family — the G-rated telling</option>
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
                    onClick={() => (routePicker ? confirmRoutePick() : void buildRoute())}
                    disabled={routeBuilding && !routePicker}
                    className="mt-5 w-full rounded-full bg-ink px-4 py-3.5 text-sm font-bold text-cream shadow-lg shadow-ink/20 transition hover:bg-sagedeep disabled:opacity-50"
                  >
                    {routePicker ? 'Build on this road' : routeBuilding ? 'Building…' : 'Build my route'}
                  </button>
                  {routeStatus && <p className="mt-3 text-center text-xs leading-relaxed text-inksoft">{routeStatus}</p>}
                  {routePickerBlock}
                  {routeFailureBlock}
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
  // tours render exactly the phase-1 screen. Manifest
  // (differentiator 3): before the Start tour tap the screen
  // is the episode card instead of the bar — the face above it,
  // the card under it, nothing scrolling.
  if (routeActive && routeRunner) {
    const rView = routeView;
    // Composer v3 (commit D): the manifest card's primary
    // button is honest about preparation — disabled under the
    // recording-stage label until the runner's OPENING has
    // settled (render-ahead pipeline, Nov 4, 2026: the rest
    // of the episode records ahead of the listener), then
    // enabled 'Start tour'.
    const startBtn = routeStartButtonState(rView ?? { narrationReady: false });
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
            {rView?.phase === 'ready' && routeManifest && (
              // The manifest (differentiator 3): the episode card,
              // shown before the first sound — title, runtime,
              // story count with the new-to-you count, the thread
              // line when the plan has one, and the closing story.
              // Start tour is the play gesture: it begins the
              // staged runner and re-primes its audio on the tap.
              // Until the opening has settled the button sits
              // disabled under the recording-stage label — the
              // card is up while the opening records, and says
              // which phase it's in (composer v3, commit D;
              // stage labels + opening settle Nov 4).
              <div className="mb-2 rounded-[2rem] bg-white/80 p-5 shadow-xl shadow-ink/15 backdrop-blur">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-sagedeep">Your episode</p>
                <h2 className="mt-1 text-xl font-black leading-tight">{routeManifest.title}</h2>
                <p className="mt-2 text-sm font-semibold text-ink/70">{routeManifest.runtimeLine}</p>
                <p className="text-sm font-semibold text-ink/70">
                  {routeManifest.storyCount} {routeManifest.storyCount === 1 ? 'story' : 'stories'} ·{' '}
                  {routeManifest.newCount} you’ve never heard
                </p>
                {routeManifest.threadLine && (
                  <p className="text-sm font-semibold text-ink/70">{routeManifest.threadLine}</p>
                )}
                {routeManifest.closingStoryName && (
                  <p className="text-sm font-semibold text-ink/70">Ends with {routeManifest.closingStoryName}</p>
                )}
                <button
                  type="button"
                  onClick={() => routeRunner.beginStaged()}
                  disabled={startBtn.disabled}
                  aria-label={startBtn.label}
                  className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-ink px-5 py-3.5 text-base font-bold text-cream shadow-md shadow-ink/20 transition hover:bg-sagedeep active:scale-[0.99] disabled:opacity-60"
                >
                  <Play className="h-5 w-5" />
                  {startBtn.label}
                </button>
                <button
                  type="button"
                  onClick={endRoute}
                  aria-label="End route"
                  className="mt-1 w-full py-1.5 text-center text-sm font-bold text-ink/50 transition hover:text-ink"
                >
                  Not now
                </button>
              </div>
            )}
            {rView?.awaitingGesture && (
              // Tap-to-hear (Nov 3, 2026): the first play was
              // refused and the latch is unearned — the tour is
              // HELD, not speaking, and says so. The tap is the
              // gesture retry: item 1 rides it as the prime
              // carrier. (Any tap anywhere also retries via the
              // document net; this is the labeled, findable path.)
              <button
                type="button"
                onClick={() => routeRunner.bannerTap()}
                aria-label="Tap to hear Miles"
                className="mb-2 flex w-full items-center justify-center gap-2 rounded-full bg-sagedeep px-5 py-3.5 text-base font-bold text-cream shadow-xl shadow-ink/20 transition active:scale-[0.99]"
              >
                <Volume2 className="h-5 w-5" />
                Tap to hear Miles
              </button>
            )}
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
            {rView?.phase !== 'ready' && (
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
                onClick={() => {
                  const next = !(rView?.bedOn ?? false);
                  routeRunner?.setBedEnabled(next);
                  saveAmbientEnabled(next);
                }}
                aria-label={rView?.bedOn ? 'Turn ambient sound off' : 'Turn ambient sound on'}
                aria-pressed={rView?.bedOn ?? false}
                className={`flex items-center justify-center gap-2 rounded-full px-5 py-3.5 text-base font-bold transition active:scale-[0.99] ${
                  rView?.bedOn
                    ? 'bg-sage/25 text-ink hover:bg-sage/40'
                    : 'bg-cream2 text-ink/50 hover:bg-sage/25'
                }`}
              >
                <Waves className="h-5 w-5" />
                Ambience
              </button>
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
            )}
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
