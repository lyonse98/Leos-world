import { locationTracker } from './locationTracker';
import { deriveTags, isInterestTag, describeTag } from './storyTags';

// The drive arc (Pass 2, Oct 27, 2026) — the session's memory of
// itself, kept just structured enough to hand Leo at prompt time.
//
// Why it exists: v13's connective tissue was deliberately weak — the
// persona forbade a throughline ("the dots connect in hindsight, not
// by force") and the prompt offered only the previous story's text
// plus a do-not-retell list. Field result: stories that felt brief,
// disparate, and small — segments, not a tour. A real guide runs the
// opposite architecture: the drive itself is the narrative, and each
// story knows where it sits inside it. This module is the light
// version of that: no character-thread machinery (parked with the
// rest of the v14 list), just an honest summary of where the drive
// has been, fed to prompt assembly alongside the persona's revised
// connect-when-natural rule.
//
// What it tracks, per session (a tour):
// - Neighborhoods entered, in entry order — noted at prompt assembly
//   from the fact pack's own area info, the one moment every
//   generated story passes through with its neighborhood resolved.
// - Subjects told and angles used — DERIVED at read time from
//   locationTracker's told-topic record, which every serve path
//   (live, ephemeral cache, library) already writes. Deriving rather
//   than recording means the arc can never drift from what was
//   actually told, and cache/library serves count exactly like live
//   ones. Topics are metadata ("<Place> — <angle label>"); story
//   TEXT is never parsed.
// - Themes touched — interest tags derived from those same topics.
// - Notable named people — STRUCTURED METADATA ONLY. No fact pack in
//   the current pipeline carries a people field, and story text is
//   never mined for names, so today this list stays empty by design:
//   noteNamedPeople exists for the first caller that genuinely has
//   structured people data (a registry/fact-pack field), and the
//   prompt block names people only when the list is non-empty. An
//   empty slot is the honest shape; an invented cast would be
//   fabrication with extra steps.

const MAX_NEIGHBORHOODS = 12;
const MAX_PEOPLE = 12;

class DriveArcService {
  private neighborhoods: string[] = [];
  private namedPeople: string[] = [];

  // A new tour starts a new arc. Called at tour start next to
  // locationTracker.reset() (App).
  reset(): void {
    this.neighborhoods = [];
    this.namedPeople = [];
  }

  // Record entering a neighborhood. Consecutive duplicates collapse
  // (a drive sits in one neighborhood across many fetches); re-entry
  // after leaving is a new entry — A → B → A is real route shape.
  noteNeighborhood(name: string | null | undefined): void {
    const n = (name ?? '').trim();
    if (!n) return;
    if (this.neighborhoods[this.neighborhoods.length - 1] === n) return;
    this.neighborhoods.push(n);
    if (this.neighborhoods.length > MAX_NEIGHBORHOODS) {
      this.neighborhoods = this.neighborhoods.slice(-MAX_NEIGHBORHOODS);
    }
  }

  // Record notable named people from STRUCTURED story metadata (see
  // the header: no caller passes any today, and none may pass names
  // extracted from story text).
  noteNamedPeople(names: readonly string[]): void {
    for (const raw of names) {
      const n = raw.trim();
      if (!n || this.namedPeople.includes(n)) continue;
      this.namedPeople.push(n);
    }
    if (this.namedPeople.length > MAX_PEOPLE) {
      this.namedPeople = this.namedPeople.slice(-MAX_PEOPLE);
    }
  }

  // The compact arc summary for prompt assembly, or '' while the tour
  // has no past to connect to (first story: nothing told, nowhere
  // been — the persona's first-story handling governs instead).
  buildPromptBlock(): string {
    const topics = locationTracker.getAllToldStories();
    if (topics.length === 0 && this.neighborhoods.length === 0) return '';

    const lines: string[] = [
      'DRIVE ARC — WHERE THIS TOUR HAS BEEN (context for connective tissue, not a script):',
    ];

    if (this.neighborhoods.length > 0) {
      const shown = this.neighborhoods.slice(-5);
      const elided = this.neighborhoods.length - shown.length;
      lines.push(
        `Route so far: ${elided > 0 ? '… → ' : ''}${shown.join(' → ')}.`
      );
    }

    if (topics.length > 0) {
      const recentTopics = topics.slice(-6);
      lines.push(
        `Stories already told: ${recentTopics.map(t => `"${t}"`).join('; ')}.`
      );

      const angleLabels: string[] = [];
      for (const topic of topics) {
        const sep = topic.indexOf(' — ');
        if (sep === -1) continue;
        const label = topic.slice(sep + 3).trim();
        if (label && !angleLabels.includes(label)) angleLabels.push(label);
      }
      if (angleLabels.length > 0) {
        lines.push(`Angles already used: ${angleLabels.slice(-6).join(', ')}.`);
      }

      const themes: string[] = [];
      for (const topic of topics) {
        for (const tag of deriveTags({ topic })) {
          if (!isInterestTag(tag)) continue;
          const label = describeTag(tag);
          if (!themes.includes(label)) themes.push(label);
        }
      }
      if (themes.length > 0) {
        lines.push(`Themes the drive has touched: ${themes.slice(0, 6).join(', ')}.`);
      }
    }

    if (this.namedPeople.length > 0) {
      lines.push(
        `Named people who have figured in the drive so far: ${this.namedPeople.join(', ')}.`
      );
    }

    lines.push(
      'Connect when it is natural: ONE brief callback, or ONE sentence placing this ' +
        'story inside the drive\'s or the city\'s larger story, is welcome — a sentence ' +
        'or two of connective tissue at most. Never force a connection, and never ' +
        'invent a link or a fact to make one.'
    );

    return lines.join('\n');
  }
}

export const driveArc = new DriveArcService();
