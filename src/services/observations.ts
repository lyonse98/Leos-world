// Local template pool for transitional observations that fill dead air
// between stories. Chosen with no-repeat tracking so consecutive fills
// never sound canned.

export interface ObservationContext {
  street: string | null;
  neighborhood: string | null;
  timeOfDay: 'morning' | 'afternoon' | 'evening' | 'night';
  lastTopic: string | null;
}

// 'waiting' is for a genuine lull — nothing queued, nothing generating. Those
// lines acknowledge the pause out loud so it reads as deliberate rather than
// broken. The other two are for the brief hold while a story is still being
// written, where a reflective line lands better than an announcement.
export type ObservationMode = 'moving' | 'stationary' | 'waiting';

const MORNING = [
  "Morning's a good hour for this — the streets are still waking up.",
  "Early light does these old buildings a favor. Good timing.",
  "Morning crew. The quiet makes the stories land better.",
  "This is the hour when a lot of the good history actually happened.",
];

const AFTERNOON = [
  "Prime exploring hours right now.",
  "Afternoon light hits these buildings differently. Worth noticing.",
  "The day slows down around now — good pace for a story.",
  "Midday wandering. I approve.",
];

const EVENING = [
  "Evening's when places like this show their real character.",
  "Golden hour plus old architecture — hard to beat.",
  "The lights are coming on. This area looked very different at night a century ago.",
  "Best stories always land a little better at dusk.",
];

const NIGHT = [
  "Night mode. This place has some after-dark history, believe me.",
  "The streets are quiet, but the history never is.",
  "Night walks reveal the strange details. I like it.",
  "Most of the spooky stories about this area happen after dark, for what it's worth.",
];

const STREET = [
  "Quick one while we move — ever wonder who named {street}? Street names usually hide a story.",
  "Fun detail: {street} hasn't always looked like this. Streets rewrite themselves constantly.",
  "That stretch of {street} you just crossed is older than it looks. By a lot.",
  "Streets like {street} are basically unread history books. Someone should read them. That's me. I'm someone.",
  "{street} has seen some things over the years. Some of it I'll get to on this tour.",
  "You're walking a route people have used for generations. Worth a moment's thought.",
];

const NEIGHBORHOOD = [
  "Every block in {neighborhood} has at least one secret. I know most of them.",
  "{neighborhood} didn't always look like this. The transformation is half the story.",
  "Locals in {neighborhood} will argue about its history over anything. They're all a little bit right.",
  "There's a reason {neighborhood} feels the way it does. History shaped the vibe.",
  "People fought over this ground long before anyone called it {neighborhood}.",
];

const GENERIC_MOVING = [
  "Quick breather between stories — but more's coming.",
  "Hang tight, I'm lining up the next one. It's a good one.",
  "While we roll, a thought: the world is basically a museum you can walk through.",
  "The gaps between stories are where you notice things yourself. Use them.",
  "Next story's coming. It involves at least one thing that sounds made up but isn't.",
  "Little pause here — look around. That's half the point of a tour.",
  "I pace these with breathing room on purpose. You're welcome.",
  "More in a moment. Meanwhile, the air really does feel different a block over. Microclimates are real.",
  "Heads up — the next stretch is one of my favorites.",
  "Taking a breath, then hitting you with something good.",
  "Between-stories moment: have you ever counted how many lamppost styles exist? Nobody has. Except me.",
  "A short pause lets the last story settle in. Then we go again.",
  "Fun stretch coming up. Giving you a second to just walk it.",
  "You know what I love about this job? Nobody's ever asked me to be quiet. Keep it that way.",
  "Quick aside — I once spent a whole week researching a single fountain. Today it pays off.",
  "If you're wondering why I paused: letting the neighborhood talk for a second. It's better at it than me.",
  "Story's almost ready. Stretch your legs, that's an order.",
  "Quiet stretch here. I'll take the next block off, then we're back at it.",
  "While we move: fun fact I've been saving. No wait, it pairs better with the next stop. Ignore me.",
  "Little lull. Good tours have rhythm, like songs. This is the rest between verses.",
];

const GENERIC_STATIONARY = [
  "Taking in the view? Same. Give me a moment and I'll have more.",
  "Not every second needs narration. Sometimes a place speaks for itself.",
  "Standing still is underrated. This spot has layers.",
  "Quick pause. Look around slowly — you'll catch details I can't narrate.",
  "Notice anything odd around here? If yes, I probably have the story.",
  "This is a good people-watching corner, for what it's worth. I've logged hours here.",
  "Give this one a minute. The best detail isn't obvious until you stop.",
];

const BRIDGES = [
  "And remember {lastTopic}? It connects forward more than you'd think.",
  "That {lastTopic} story is one thread of a bigger picture around here.",
];

// The lull pool. Every one of these says the same thing in a different way:
// there is nothing to tell you this second, and that is on purpose. They only
// play after a real stretch of quiet, never as a quick reflex after a story,
// which is what stops them turning into a tic.
const WAITING = [
  "Sit tight — I'm lining up the next talking point. It's a good one.",
  "Nothing to narrate this second. Consider it a scheduled pause.",
  "Holding here until the next talking point lines up. Won't be long.",
  "This is the part where I go quiet and let the place do the talking.",
  "No story queued this second — sit tight, I'm working on it.",
  "Give me a beat. The next talking point is loading.",
  "Standby. Next talking point is a couple of minutes out.",
  "I'm between stories. Enjoy the gap — it's load-bearing.",
  "Quiet stretch. I'm using it to find you something good.",
  "No story right this second. Sit tight, I've got you.",
  "Breather. The next one's coming, I just want it to be right.",
  "Nothing queued. Give me a second and I'll have something worth your ears.",
  "This is me stalling, but tastefully. Story incoming.",
  "Between talking points. Look around — that's the assignment.",
  "One moment. I'm choosing the next thing carefully.",
  "Silence is fine here. I'll break it when I've got something real.",
  "Holding pattern. The next talking point is worth the wait.",
  "Taking a beat. Next talking point is already in the works.",
  "Standing by. Good stories take a second to line up.",
  "Nothing yet. I'd rather say nothing than say something forgettable.",
  "Still with you. Just waiting on the next talking point to land.",
  "Pause here. It'll fill in a moment.",
];

const ALL_POOLS: string[] = [
  ...MORNING, ...AFTERNOON, ...EVENING, ...NIGHT,
  ...STREET, ...NEIGHBORHOOD, ...GENERIC_MOVING, ...GENERIC_STATIONARY, ...WAITING, ...BRIDGES,
];

class ObservationService {
  private recent: string[] = [];
  private static readonly NO_REPEAT_WINDOW = 12;

  pick(observing: ObservationMode, context: ObservationContext): string {
    const pool = this.buildPool(observing, context);
    const fresh = pool.filter(t => !this.recent.includes(t));
    const candidates = fresh.length > 0 ? fresh : ALL_POOLS.filter(t => !this.recent.includes(t));
    const finalPool = candidates.length > 0 ? candidates : ALL_POOLS;

    const choice = finalPool[Math.floor(Math.random() * finalPool.length)];
    this.remember(choice);
    return this.fillSlots(choice, context);
  }

  reset() {
    this.recent = [];
  }

  private buildPool(mode: ObservationMode, context: ObservationContext): string[] {
    const parts: string[] = [];

    parts.push(...(context.timeOfDay === 'morning' ? MORNING
      : context.timeOfDay === 'afternoon' ? AFTERNOON
      : context.timeOfDay === 'evening' ? EVENING : NIGHT));

    if (mode === 'waiting') {
      // Lead with the lull lines and skip the street and neighbourhood trivia —
      // this is a pause, not a fact, and a fact here would read as filler.
      parts.push(...WAITING);
      if (context.lastTopic) parts.push(...BRIDGES);
      return parts;
    }

    if (context.street) parts.push(...STREET);
    if (context.neighborhood) parts.push(...NEIGHBORHOOD);
    parts.push(...(mode === 'moving' ? GENERIC_MOVING : GENERIC_STATIONARY));
    if (context.lastTopic) parts.push(...BRIDGES);

    return parts;
  }

  private fillSlots(template: string, context: ObservationContext): string {
    return template
      .replace(/\{street\}/g, context.street || 'this street')
      .replace(/\{neighborhood\}/g, context.neighborhood || 'this neighborhood')
      .replace(/\{lastTopic\}/g, context.lastTopic || 'that last spot');
  }

  private remember(text: string) {
    this.recent.push(text);
    if (this.recent.length > ObservationService.NO_REPEAT_WINDOW) {
      this.recent.shift();
    }
  }
}

export const observationService = new ObservationService();

export const OBSERVATION_POOL_SIZE = ALL_POOLS.length;
