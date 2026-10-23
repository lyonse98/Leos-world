// Story tags turn a single rating into a reusable preference. A thumbs-up on a
// Prohibition-era story should lift other Prohibition-era stories, so every
// story is reduced to a small set of tags when it is rated — the rating
// attaches to the tags, not just to that one story.
//
// Tags are derived rather than asked for: on a drive there is no time to file a
// story into a category, and the whole point is that the listener does nothing
// but tap once.

// Which angle Leo was told to take, when the story was written from a standing
// stop. These come straight from the depth directive in the story prompt.
const CONTEXT_TAGS: Record<string, string> = {
  stationary_landmark: 'landmarks',
  stationary_neighborhood: 'neighborhood',
  stationary_region: 'regional',
  stationary_figures: 'people',
  stationary_culture: 'culture',
  stationary_streets: 'streets',
  stationary_architecture: 'architecture',
  stationary_nature: 'nature',
  stationary_transport: 'transport',
  stationary_demographics: 'people',
  stationary_geology: 'geology',
  stationary_folklore: 'folklore',
};

// Google place types, mapped onto the same vocabulary. This is what gives a
// place a tag set before anyone has heard a word about it — which is exactly
// what story selection needs, since it runs before generation.
const TYPE_TAGS: Record<string, string[]> = {
  museum: ['architecture', 'culture'],
  art_gallery: ['architecture', 'culture'],
  church: ['architecture'],
  place_of_worship: ['architecture'],
  hindu_temple: ['architecture'],
  synagogue: ['architecture'],
  mosque: ['architecture'],
  city_hall: ['politics', 'architecture'],
  courthouse: ['politics', 'architecture'],
  library: ['culture', 'architecture'],
  university: ['culture', 'architecture'],
  school: ['architecture'],
  cemetery: ['folklore'],
  funeral_home: ['folklore'],
  park: ['nature'],
  campground: ['nature'],
  zoo: ['nature'],
  aquarium: ['nature'],
  stadium: ['sports'],
  train_station: ['transport'],
  transit_station: ['transport'],
  subway_station: ['transport'],
  bus_station: ['transport'],
  bridge: ['transport', 'architecture'],
  restaurant: ['food'],
  cafe: ['food'],
  bar: ['food'],
  bakery: ['food'],
  meal_takeaway: ['food'],
  shopping_mall: ['commerce'],
  department_store: ['commerce'],
  movie_theater: ['music'],
  night_club: ['music'],
  performing_arts_theater: ['music'],
  hospital: ['medicine'],
  police: ['crime'],
  local_government_office: ['politics'],
  post_office: ['politics'],
  lodging: ['architecture'],
  rv_park: ['nature'],
};

const SUBJECT_KEYWORDS: Record<string, string[]> = {
  crime: ['murder', 'crime', 'mob', 'gangster', 'bootleg', 'prohibition', 'heist', 'robbery', 'smuggl', 'outlaw', 'sheriff', 'jail', 'prison', 'lynch'],
  industry: ['factory', 'mill', 'railroad', 'railway', 'manufactur', 'industrial', 'foundry', 'brewery', 'warehouse', 'mining', 'canal', 'refinery'],
  military: ['battle', 'fort', 'regiment', 'army', 'navy', 'civil war', 'garrison', 'militia', 'arsenal'],
  politics: ['mayor', 'senator', 'governor', 'politic', 'election', 'capitol', 'city hall', 'legislat', 'court house'],
  sports: ['stadium', 'ballpark', 'boxing', 'baseball', 'football', 'arena'],
  food: ['restaurant', 'diner', 'bakery', 'tavern', 'saloon', 'market', 'cafe', 'grill', 'deli'],
  music: ['jazz', 'blues', 'theater', 'theatre', 'opera', 'concert', 'bandstand', 'music hall'],
  nature: ['river', 'creek', 'lake', 'forest', 'marsh', 'wetland', 'spring', 'ravine', 'grove'],
  disasters: ['fire', 'flood', 'earthquake', 'tornado', 'hurricane', 'explosion', 'collapse', 'epidemic', 'plague', 'wreck'],
  architecture: ['church', 'cathedral', 'tower', 'bridge', 'mansion', 'hotel', 'architect', 'facade', 'courthouse', 'hall', 'depot'],
  people: ['founded', 'settled', 'born', 'family', 'pioneer', 'settler', 'resident'],
};

const ERA_KEYWORDS: Array<[string, string[]]> = [
  ['colonial', ['colonial', 'settler', 'pilgrim', '1600s', '1700s', '17th century', '18th century']],
  ['1800s', ['1800s', '19th century', 'victorian', 'antebellum', 'civil war', 'gilded age']],
  ['early-1900s', ['1900s', 'turn of the century', 'prohibition', 'depression', '1920s', '1930s', '1940s', 'world war']],
  ['mid-century', ['1950s', '1960s', '1970s', 'postwar', 'post-war', 'mid-century']],
  ['modern', ['1980s', '1990s', '2000s', 'recent years', 'modern']],
];

const TONE_KEYWORDS: Record<string, string[]> = {
  dark: ['death', 'died', 'killed', 'murder', 'tragedy', 'disaster', 'blaze', 'disease', 'buried', 'ghost', 'haunt', 'victim'],
  uplifting: ['founded', 'built', 'opened', 'celebrat', 'invented', 'triumph', 'beloved', 'saved', 'thriving'],
  weird: ['strange', 'bizarre', 'legend', 'myth', 'rumor', 'rumour', 'unexplained', 'curse', 'hoax', 'odd'],
};

function scan(haystack: string, keywords: string[]): boolean {
  return keywords.some(keyword => haystack.includes(keyword));
}

export interface TagInput {
  topic: string;
  types?: string[];
  text?: string;
  context?: string | null;
  mode?: string | null;
}

export function deriveTags(input: TagInput): string[] {
  const tags = new Set<string>();
  const topic = (input.topic || '').toLowerCase();

  if (input.context && CONTEXT_TAGS[input.context]) tags.add(CONTEXT_TAGS[input.context]);
  if (input.mode === 'driving' || input.mode === 'walking') tags.add(input.mode);

  for (const type of input.types ?? []) {
    for (const tag of TYPE_TAGS[type] ?? []) tags.add(tag);
  }

  // Subject words are looked for in the topic itself — a place called "Old
  // Brewery Flats" is an industry story whatever else the text says.
  for (const [tag, words] of Object.entries(SUBJECT_KEYWORDS)) {
    if (scan(topic, words)) tags.add(tag);
  }

  // Era and tone only show up in the telling, so they are read from the body.
  const body = `${topic} ${(input.text || '').toLowerCase()}`;
  for (const [tag, words] of ERA_KEYWORDS) {
    if (scan(body, words)) tags.add(tag);
  }
  for (const [tag, words] of Object.entries(TONE_KEYWORDS)) {
    if (scan(body, words)) tags.add(tag);
  }

  return [...tags].slice(0, 24);
}

// Mode tags describe the drive, not the story, so they are kept out of the
// taste summary Leo is shown — "you enjoy driving" is not a useful note.
const NON_INTEREST_TAGS = new Set(['driving', 'walking']);

export function describeTag(tag: string): string {
  return tag.replace(/-/g, ' ');
}

export function isInterestTag(tag: string): boolean {
  return !NON_INTEREST_TAGS.has(tag);
}
