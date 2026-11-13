// Profile UI (Nov 13, 2026): the declared seed card and the
// Your Miles screen, built on src/core/profile.ts. One shared
// editor (ProfileEditor) serves both — the seed card is the
// first-run, 60-second version of the same form the user can
// reopen and change any time. Plain, friendly copy throughout;
// no account, no email, nothing leaves the device (see the use
// fence in core/profile.ts).

import { useRef, useState } from 'react';
import { Download, Trash2, Upload, X } from 'lucide-react';
import {
  ACTIVITY_OPTIONS,
  BUDGET_COMFORT_OPTIONS,
  CUISINE_OPTIONS,
  DETOUR_MINUTE_OPTIONS,
  DIETARY_OPTIONS,
  DRINK_OPTIONS,
  OPTION_LABELS,
  STORY_TOPICS,
  SURPRISE_TOLERANCE_OPTIONS,
  WALKING_TOLERANCE_OPTIONS,
  agedConfidence,
  clearDeclared,
  deleteInferredTopic,
  exportProfile,
  importProfile,
  loadProfile,
  setDeclaredConstraint,
  setDeclaredTaste,
  setPaused,
  setSeedState,
  wipeProfile,
  type BudgetComfort,
  type MilesProfile,
  type SurpriseTolerance,
  type WalkingTolerance,
} from './core/profile';

// ------------------------------------------------------------ form state

export interface DeclaredForm {
  cuisines: string[];
  drinks: string[];
  activities: string[];
  storyTopics: string[];
  dietary: string[];
  budgetComfort: BudgetComfort | null;
  maxDetourMinutes: number | null;
  alcoholOk: boolean | null;
  usuallyWithKids: boolean | null;
  dogFriendly: boolean | null;
  walkingTolerance: WalkingTolerance | null;
  surpriseTolerance: SurpriseTolerance | null;
}

export function formFromProfile(p: MilesProfile): DeclaredForm {
  return {
    cuisines: p.tastes.cuisines?.value ?? [],
    drinks: p.tastes.drinks?.value ?? [],
    activities: p.tastes.activities?.value ?? [],
    storyTopics: p.tastes.storyTopics?.value ?? [],
    dietary: p.constraints.dietary?.value ?? [],
    budgetComfort: p.constraints.budgetComfort?.value ?? null,
    maxDetourMinutes: p.constraints.maxDetourMinutes?.value ?? null,
    alcoholOk: p.constraints.alcoholOk?.value ?? null,
    usuallyWithKids: p.constraints.usuallyWithKids?.value ?? null,
    dogFriendly: p.constraints.dogFriendly?.value ?? null,
    walkingTolerance: p.constraints.walkingTolerance?.value ?? null,
    surpriseTolerance: p.constraints.surpriseTolerance?.value ?? null,
  };
}

/** Write a form back as declared entries; emptied fields are cleared. */
export function saveDeclaredForm(form: DeclaredForm, provenance: string): void {
  const list = (field: 'cuisines' | 'drinks' | 'activities' | 'storyTopics', values: string[]) => {
    if (values.length > 0) setDeclaredTaste(field, values, provenance);
    else clearDeclared('tastes', field);
  };
  list('cuisines', form.cuisines);
  list('drinks', form.drinks);
  list('activities', form.activities);
  list('storyTopics', form.storyTopics);
  const cons = <K extends Parameters<typeof setDeclaredConstraint>[0]>(
    field: K,
    value: Parameters<typeof setDeclaredConstraint>[1] | null,
  ) => {
    if (value !== null && value !== undefined) setDeclaredConstraint(field, value as never, provenance);
    else clearDeclared('constraints', field);
  };
  cons('budgetComfort', form.budgetComfort);
  cons('maxDetourMinutes', form.maxDetourMinutes);
  cons('alcoholOk', form.alcoholOk);
  cons('usuallyWithKids', form.usuallyWithKids);
  cons('dogFriendly', form.dogFriendly);
  cons('walkingTolerance', form.walkingTolerance);
  cons('surpriseTolerance', form.surpriseTolerance);
  if (form.dietary.length > 0) setDeclaredConstraint('dietary', form.dietary, provenance);
  else clearDeclared('constraints', 'dietary');
}

// ------------------------------------------------------------ editor pieces

const chipBase = 'rounded-full px-3.5 py-2 text-sm font-semibold transition active:scale-[0.98]';
const chipOn = 'bg-ink text-cream shadow-md shadow-ink/20';
const chipOff = 'bg-white/80 text-ink shadow-sm shadow-ink/5 hover:bg-white';

function ChipRow({
  options,
  labels,
  selected,
  onToggle,
}: {
  options: readonly string[];
  labels?: Record<string, string>;
  selected: string[];
  onToggle: (v: string) => void;
}) {
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {options.map(o => (
        <button
          key={o}
          type="button"
          onClick={() => onToggle(o)}
          className={`${chipBase} ${selected.includes(o) ? chipOn : chipOff}`}
        >
          {labels?.[o] ?? OPTION_LABELS[o] ?? o}
        </button>
      ))}
    </div>
  );
}

function SingleRow<T extends string>({
  options,
  labels,
  selected,
  onPick,
}: {
  options: readonly T[];
  labels?: Record<string, string>;
  selected: T | null;
  onPick: (v: T | null) => void;
}) {
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {options.map(o => (
        <button
          key={o}
          type="button"
          onClick={() => onPick(selected === o ? null : o)}
          className={`${chipBase} ${selected === o ? chipOn : chipOff}`}
        >
          {labels?.[o] ?? OPTION_LABELS[o] ?? o}
        </button>
      ))}
    </div>
  );
}

function ToggleRow({
  label,
  caption,
  value,
  onPick,
}: {
  label: string;
  caption: string;
  value: boolean | null;
  onPick: (v: boolean | null) => void;
}) {
  const btn = (v: boolean | null, text: string) => (
    <button
      type="button"
      onClick={() => onPick(v)}
      className={`${chipBase} ${value === v ? chipOn : chipOff}`}
    >
      {text}
    </button>
  );
  return (
    <div className="mt-4">
      <p className="text-sm font-bold text-ink">{label}</p>
      <p className="text-xs text-inksoft">{caption}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {btn(true, 'Yes')}
        {btn(false, 'No')}
        {btn(null, 'No preference')}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-5">
      <p className="text-sm font-bold text-ink">{title}</p>
      {children}
    </div>
  );
}

const toggleIn = (list: string[], v: string): string[] =>
  list.includes(v) ? list.filter(x => x !== v) : [...list, v];

export function ProfileEditor({
  form,
  onChange,
}: {
  form: DeclaredForm;
  onChange: (f: DeclaredForm) => void;
}) {
  const set = (patch: Partial<DeclaredForm>) => onChange({ ...form, ...patch });
  return (
    <div>
      <Section title="Food you love">
        <ChipRow
          options={CUISINE_OPTIONS}
          selected={form.cuisines}
          onToggle={v => set({ cuisines: toggleIn(form.cuisines, v) })}
        />
      </Section>
      <Section title="Drinks">
        <ChipRow
          options={DRINK_OPTIONS}
          selected={form.drinks}
          onToggle={v => set({ drinks: toggleIn(form.drinks, v) })}
        />
      </Section>
      <Section title="Getting out">
        <ChipRow
          options={ACTIVITY_OPTIONS}
          selected={form.activities}
          onToggle={v => set({ activities: toggleIn(form.activities, v) })}
        />
      </Section>
      <Section title="Story topics that land for you">
        <ChipRow
          options={STORY_TOPICS}
          selected={form.storyTopics}
          onToggle={v => set({ storyTopics: toggleIn(form.storyTopics, v) })}
        />
      </Section>
      <Section title="A good stop usually costs…">
        <SingleRow
          options={BUDGET_COMFORT_OPTIONS}
          selected={form.budgetComfort}
          onPick={v => set({ budgetComfort: v })}
        />
      </Section>
      <Section title="Worth a detour of…">
        <div className="mt-2 flex flex-wrap gap-2">
          {DETOUR_MINUTE_OPTIONS.map(m => (
            <button
              key={m}
              type="button"
              onClick={() => set({ maxDetourMinutes: form.maxDetourMinutes === m ? null : m })}
              className={`${chipBase} ${form.maxDetourMinutes === m ? chipOn : chipOff}`}
            >
              {m} minutes
            </button>
          ))}
        </div>
      </Section>
      <Section title="Walking once you park">
        <SingleRow
          options={WALKING_TOLERANCE_OPTIONS}
          labels={{ low: 'Short walks', medium: 'A few blocks', high: 'Happy to roam' }}
          selected={form.walkingTolerance}
          onPick={v => set({ walkingTolerance: v })}
        />
      </Section>
      <Section title="How adventurous should picks be?">
        <SingleRow
          options={SURPRISE_TOLERANCE_OPTIONS}
          labels={{ favorites: 'Stick to favorites', mix: 'A mix', 'surprise-me': 'Surprise me' }}
          selected={form.surpriseTolerance}
          onPick={v => set({ surpriseTolerance: v })}
        />
      </Section>
      <ToggleRow
        label="Drinks for the 21+ crowd are fair game"
        caption="Bars, breweries, cocktail spots."
        value={form.alcoholOk}
        onPick={v => set({ alcoholOk: v })}
      />
      <ToggleRow
        label="Usually have kids along"
        caption="Keeps picks family-workable."
        value={form.usuallyWithKids}
        onPick={v => set({ usuallyWithKids: v })}
      />
      <ToggleRow
        label="Dog usually comes too"
        caption="Patios and places that welcome dogs."
        value={form.dogFriendly}
        onPick={v => set({ dogFriendly: v })}
      />
      <Section title="Eating needs (optional)">
        <ChipRow
          options={DIETARY_OPTIONS}
          selected={form.dietary}
          onToggle={v => set({ dietary: toggleIn(form.dietary, v) })}
        />
      </Section>
    </div>
  );
}

// ------------------------------------------------------------ seed card

/**
 * The declared seed card: optional, skippable, about sixty
 * seconds of chips. Offered once on the pre-tour landing;
 * skipping is recorded so it never nags again, and the same
 * form lives on in Your Miles either way.
 */
export function SeedCard({ onDone }: { onDone: () => void }) {
  const [form, setForm] = useState<DeclaredForm>(() => formFromProfile(loadProfile()));
  return (
    <OverlayShell title="Make Miles yours" onClose={onDone}>
      <p className="text-sm leading-relaxed text-inksoft">
        Sixty seconds of tapping what you like, and Miles gets better at picking stories and,
        soon, stops worth making. Skip anything. Everything stays on this phone — no account, no
        email, nothing sent anywhere — and you can change or erase it any time in Your Miles.
      </p>
      <ProfileEditor form={form} onChange={setForm} />
      <button
        type="button"
        onClick={() => {
          saveDeclaredForm(form, 'seed-card');
          setSeedState('completed');
          onDone();
        }}
        className="mt-6 w-full rounded-full bg-ink px-6 py-4 text-base font-extrabold text-cream shadow-xl shadow-ink/25 transition hover:bg-sagedeep active:scale-[0.99]"
      >
        Save my tastes
      </button>
      <button
        type="button"
        onClick={() => {
          setSeedState('skipped');
          onDone();
        }}
        className="mt-3 w-full py-2 text-center text-sm font-bold text-inksoft underline underline-offset-2"
      >
        Skip for now
      </button>
    </OverlayShell>
  );
}

// ------------------------------------------------------------ Your Miles screen

function OverlayShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-cream text-ink">
      <main className="safe-top safe-bottom mx-auto w-full max-w-xl px-6 py-6">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-black tracking-tight">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-full bg-cream2 p-2.5 text-ink transition hover:bg-sage/25"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </main>
    </div>
  );
}

const confidenceWord = (c: number): string => (c >= 0.7 ? 'Strong' : c >= 0.4 ? 'Building' : 'Faint');

export function YourMilesScreen({ onClose }: { onClose: () => void }) {
  const [profile, setProfile] = useState<MilesProfile>(() => loadProfile());
  const [form, setForm] = useState<DeclaredForm>(() => formFromProfile(loadProfile()));
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [confirmWipe, setConfirmWipe] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const refresh = () => {
    const p = loadProfile();
    setProfile(p);
    setForm(formFromProfile(p));
  };

  const now = Date.now();
  const inferred = Object.values(profile.inferredTopics)
    .map(e => ({ ...e, effective: agedConfidence(e, now) }))
    .filter(e => e.effective >= 0.15)
    .sort((a, b) => b.effective - a.effective);

  return (
    <OverlayShell title="Your Miles" onClose={onClose}>
      <p className="mt-1 text-sm leading-relaxed text-inksoft">
        What Miles knows about you, in plain sight. It all lives only on this phone — Miles uses
        it to rank his own stories and suggestions. It is never sent anywhere, sold, or used for
        ads.
      </p>

      <div className="mt-5 flex items-center justify-between rounded-[2rem] bg-white/70 p-4 shadow-lg shadow-ink/10">
        <div>
          <p className="text-sm font-bold text-ink">Personalization</p>
          <p className="text-xs text-inksoft">
            {profile.paused ? 'Paused — Miles uses none of this.' : 'On — Miles learns and uses this.'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setPaused(!profile.paused);
            refresh();
          }}
          className="rounded-full bg-ink px-4 py-2.5 text-sm font-bold text-cream shadow-md shadow-ink/20 transition hover:bg-sagedeep"
        >
          {profile.paused ? 'Resume' : 'Pause'}
        </button>
      </div>

      <p className="mt-6 text-base font-extrabold text-ink">You told Miles</p>
      <p className="text-xs text-inksoft">
        Change anything. Unselect everything in a section to clear it.
      </p>
      <ProfileEditor form={form} onChange={setForm} />
      <button
        type="button"
        onClick={() => {
          saveDeclaredForm(form, 'your-miles-edit');
          refresh();
        }}
        className="mt-5 w-full rounded-full bg-ink px-6 py-3.5 text-sm font-bold text-cream shadow-lg shadow-ink/20 transition hover:bg-sagedeep"
      >
        Save changes
      </button>

      <p className="mt-8 text-base font-extrabold text-ink">Miles has picked up</p>
      <p className="text-xs leading-relaxed text-inksoft">
        Only story topics, learned from what you finish and what you pick — never a guess about
        your budget, your family, or anything else. Fades if it goes unused for a few months.
      </p>
      {inferred.length === 0 ? (
        <p className="mt-3 text-sm text-inksoft">Nothing yet — it builds as you listen.</p>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          {inferred.map(e => (
            <div
              key={e.topic}
              className="flex items-center justify-between rounded-full bg-white/70 py-2 pr-2 pl-4 shadow-sm shadow-ink/5"
            >
              <span className="text-sm font-semibold text-ink">
                {e.topic} <span className="font-normal text-inksoft">· {confidenceWord(e.effective)}</span>
              </span>
              <button
                type="button"
                aria-label={`Forget ${e.topic}`}
                onClick={() => {
                  deleteInferredTopic(e.topic);
                  refresh();
                }}
                className="rounded-full bg-cream2 p-1.5 text-inksoft transition hover:bg-sage/25"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      <p className="mt-8 text-base font-extrabold text-ink">Take it with you</p>
      <p className="text-xs leading-relaxed text-inksoft">
        Your tastes can travel — export this profile and import it on another phone or in a new
        city, and Miles knows you from day one.
      </p>
      <div className="mt-3 flex gap-3">
        <button
          type="button"
          onClick={() => {
            const blob = new Blob([exportProfile()], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'miles-profile.json';
            a.click();
            URL.revokeObjectURL(url);
          }}
          className="flex flex-1 items-center justify-center gap-2 rounded-full bg-cream2 px-4 py-3 text-sm font-bold text-ink transition hover:bg-sage/25"
        >
          <Download className="h-4 w-4" /> Export
        </button>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="flex flex-1 items-center justify-center gap-2 rounded-full bg-cream2 px-4 py-3 text-sm font-bold text-ink transition hover:bg-sage/25"
        >
          <Upload className="h-4 w-4" /> Import
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={async ev => {
            const file = ev.target.files?.[0];
            ev.target.value = '';
            if (!file) return;
            const result = importProfile(await file.text());
            setImportMsg(result.ok ? 'Profile imported — welcome back.' : result.error);
            if (result.ok) refresh();
          }}
        />
      </div>
      {importMsg && <p className="mt-2 text-center text-xs font-semibold text-inksoft">{importMsg}</p>}

      <div className="mt-10 border-t border-ink/10 pt-5">
        <button
          type="button"
          onClick={() => {
            if (!confirmWipe) {
              setConfirmWipe(true);
              return;
            }
            wipeProfile();
            onClose();
          }}
          className="flex items-center gap-2 text-sm font-bold text-red-800"
        >
          <Trash2 className="h-4 w-4" />
          {confirmWipe ? 'Tap again to erase everything' : 'Erase everything'}
        </button>
      </div>
    </OverlayShell>
  );
}
