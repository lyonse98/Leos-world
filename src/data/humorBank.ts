// The Unfiltered humor bank (humor layer, Nov 6, 2026).
//
// Erik's ruling, from the scope: the jokes must NOT be live
// AI improvisation — that is exactly what makes generated
// humor feel like AI. The layer is a CURATED bank: short,
// specific, local one-liners and deadpan asides, written
// once, human-edited line by line, and drawn contextually
// into the live tissue under strict timing discipline
// (routeColor's Unfiltered branch is the draw engine).
//
// POPULATED Nov 6, 2026 — Erik approved the drafted bank
// (~/workspace/leos-world/humor-bank-review-v1.md) "with
// your recommendations," i.e. the drafter's self-audit
// calls applied: 149 of the 150 drafted lines ship below,
// VERBATIM in text, heat, and slots. The one exclusion is
// T-10 (the checkpoint line) — the audit's own expected
// kill. P-02, W-06, N-13, P-26 and the S-07 Gwynn tribute
// ship as written, as the audit defends them; the drafted
// profanity (three mild uses) stands un-reseasoned. V-01
// carries an expires date: the Zoo's pandas are on a
// ten-year loan from their June 27, 2024 arrival.
//
// The review file's context tags were prose ("roads
// I-5/I-805, the merge", "place naval-base-san-diego").
// Converting them to the typed shapes below followed three
// rules: a line whose joke depends on a specific road,
// place, or region is NEVER context-free — it maps to the
// nearest typed equivalent (real library place_keys, real
// topic tags: 'Navy Century', 'Food & Drink', 'Sport';
// state-route tokens in both the CA- and SR- forms the
// matcher might meet); genuinely context-light lines
// (weather-only jokes — the engine has no weather input —
// general freeway lore, and the {destination}/{place}
// thread bits, whose fill IS their context) ship with no
// contexts; and a context with no typed equivalent maps as
// narrowly as the type allows (Murphy Canyon → the Navy
// Century topic; the {road} bits declare the county freeway
// set so their fill can bind). Two matcher notes: road
// matching is substring, so the I-8 token carries a
// trailing space ('I-8 ') to keep it from matching I-805
// labels; and ctx.roads are matched against the picked
// route's routeLabels — which the Routes API fills with
// DEFAULT_ROUTE-style labels, the road NAME riding the
// route's description instead (verified live Nov 6, 2026).
// Road-gated lines are mapped and ready; they draw the day
// the draw reads the picked description alongside the
// labels (routeColor.humorEpisodeContext).
//
// The record shape is the review workflow's contract:
//  - text: the line as it will be spoken (modulo the
//    standing spoken-form normalization every live piece
//    passes through). ≤ HUMOR_MAX_CHARS. May carry slot
//    fills — {road}, {destination}, {place} — filled ONLY
//    from the episode's real facts at draw time; a line
//    whose fills cannot be completed never draws.
//  - contexts: where the line may fire. A line with NO
//    contexts is context-light (the drive-deadpan pool) and
//    is eligible in any episode. A line WITH contexts must
//    match at least one declared value against the episode:
//    a road the route actually takes, a filler region the
//    cast actually sits in, a place_key in the cast, a topic
//    the cast or the thread carries, a thread anchor kind.
//  - slots: the tissue surfaces the line is shaped for, in
//    the scope's vocabulary. The draw engine maps them onto
//    the color seam's slots: 'reaction' → a reaction slot,
//    'bridge' → an aside inserted right after a story (the
//    bridge's neighborhood), 'wrap-up' → the closeout slot,
//    'preview' → the episode's FIRST color slot only (the
//    preview/first-bridge neighborhood).
//  - heat: 'warm' | 'spicy' | 'roast' — spacing discipline
//    (never two roast lines in one episode) and the audit
//    report read it.
//  - exclusions: the line's own vetoes — if the cast carries
//    any listed topic or place_key, the line never draws in
//    that episode, whatever its contexts say. (The reviewed
//    bank declares none; suppression lives in the engine.)
//  - expires: an ISO date (YYYY-MM-DD) after which the line
//    is dead — the refresh discipline for references that
//    date (a player, a construction project).

/** A humor line's register: spacing and the audit report read it. */
export type HumorHeat = 'warm' | 'spicy' | 'roast';

/** The tissue surfaces a line is shaped for (scope vocabulary; the draw engine maps them to color slots). */
export type HumorSlot = 'preview' | 'bridge' | 'wrap-up' | 'reaction';

export interface HumorContexts {
  /** Road names/labels the route may carry ('I-5', 'SR-163', 'the merge' as a label fragment). */
  roads?: string[];
  /** Filler region keys (src/data/fillerRegions: 'coast', 'north', 'central', 'east', 'south', 'backcountry'). */
  regions?: string[];
  /** Library place_keys that may appear in the episode's cast. */
  placeKeys?: string[];
  /** Topic tags the cast or the thread may carry ('Navy Century', 'Food & Drink', …). */
  topics?: string[];
  /** Thread anchor kinds ('destination', 'onroute', 'origin', 'feature', 'topic'). */
  anchorKinds?: string[];
}

export interface HumorExclusions {
  /** The line never draws in an episode whose cast carries any of these topics. */
  topics?: string[];
  /** The line never draws in an episode whose cast includes any of these place_keys. */
  placeKeys?: string[];
}

export interface HumorLine {
  /** Stable identity: the cooldown, the episode ledger, and the capture all key on it. */
  id: string;
  text: string;
  heat: HumorHeat;
  contexts?: HumorContexts;
  slots: HumorSlot[];
  exclusions?: HumorExclusions;
  /** ISO date (YYYY-MM-DD): the line is ineligible after this date. */
  expires?: string;
}

/** Humor pieces per episode, at most (Erik's ruling: cap 2) — inside the shared color budget, never on top of it. */
export const HUMOR_MAX_PER_EPISODE = 2;

/** A drawn line is ineligible again until this many drives have passed (Erik's ruling: 20). */
export const HUMOR_COOLDOWN_DRIVES = 20;

/** A humor line's hard character cap — tighter than color's 260: a bank beat is one breath. */
export const HUMOR_MAX_CHARS = 200;

const HUMOR_HEATS: readonly HumorHeat[] = ['warm', 'spicy', 'roast'];
const HUMOR_SLOTS: readonly HumorSlot[] = ['preview', 'bridge', 'wrap-up', 'reaction'];

/**
 * THE BANK — Erik's reviewed lines (see the file header).
 * Order is draw order: the engine takes the first eligible
 * line per slot, so the review file's category order
 * (specific road/place material ahead of the general pool)
 * is preserved as shipped.
 */
export const HUMOR_BANK: HumorLine[] = [
  // ── Traffic & freeways (21) ──
  { id: 'T-01', text: 'The 5/805 merge: fourteen lanes of confidence narrowing into one long apology.', heat: 'roast', slots: ['bridge', 'reaction'], contexts: { roads: ['I-5', 'I-805'] } },
  { id: 'T-02', text: 'The 805: where San Diego goes to sit and think about its choices. It thinks carefully. It has the time.', heat: 'spicy', slots: ['bridge'], contexts: { roads: ['I-805'] } },
  { id: 'T-03', text: 'The 163 into downtown: the prettiest freeway in the county — which is why nobody minds that it\'s a parking lot with a view.', heat: 'spicy', slots: ['bridge', 'reaction'], contexts: { roads: ['CA-163', 'SR-163'] } },
  { id: 'T-04', text: 'The 52 cuts through San Clemente Canyon so commuters can enjoy nature at a complete standstill.', heat: 'warm', slots: ['bridge'], contexts: { roads: ['CA-52', 'SR-52'] } },
  { id: 'T-05', text: 'When it rains hard, the 8 through Mission Valley floods — even the freeway would rather be a river than a commute.', heat: 'roast', slots: ['bridge', 'reaction'], contexts: { roads: ['I-8 '], placeKeys: ['mission valley'] } },
  { id: 'T-06', text: 'The 15\'s express lanes: pay extra to feel superior at exactly the same speed as everyone else.', heat: 'spicy', slots: ['bridge', 'reaction'], contexts: { roads: ['I-15'] } },
  { id: 'T-07', text: 'The 78: North County\'s crosstown rumor. Everyone agrees it exists; nobody has ever seen it move.', heat: 'warm', slots: ['bridge'], contexts: { roads: ['CA-78', 'SR-78'] } },
  { id: 'T-08', text: 'The Coronado Bridge stopped charging a toll in 2002, and drivers still slow down where the booths were. Muscle memory is forever.', heat: 'spicy', slots: ['bridge', 'reaction'], contexts: { roads: ['CA-75', 'SR-75'], placeKeys: ['coronado'] } },
  { id: 'T-09', text: 'South at San Ysidro, the line to leave the country moves faster than the line to come back. Plan your snacks accordingly.', heat: 'warm', slots: ['bridge'], contexts: { roads: ['I-5'], placeKeys: ['san ysidro'] } },
  // T-10 EXCLUDED — the checkpoint line; the drafter’s own expected kill,
  // applied under Erik’s "approved with your recommendations" (Nov 6, 2026).
  { id: 'T-11', text: 'Seventeen miles of Camp Pendleton on your left — the longest stretch of the 5 with no exit, no coffee, and no excuse.', heat: 'warm', slots: ['bridge'], contexts: { placeKeys: ['i-5 north: through camp pendleton', 'i-5 south: through camp pendleton'] } },
  { id: 'T-12', text: 'The first rain of the year turns the freeway into a county-wide trust fall, and nobody — nobody — is catching anybody.', heat: 'roast', slots: ['reaction', 'bridge'], contexts: { roads: ['I-5', 'I-805'] } },
  { id: 'T-13', text: 'Local pronunciation note: it\'s \'the 5,\' \'the 805,\' \'the 15.\' Drop the \'the\' and everyone in the car knows you\'re visiting.', heat: 'warm', slots: ['preview', 'bridge'] },
  { id: 'T-14', text: 'The 125 toll road: the emptiest pavement in San Diego. You\'re not paying for speed — you\'re paying for solitude.', heat: 'spicy', slots: ['bridge'], contexts: { roads: ['CA-125', 'SR-125'] } },
  { id: 'T-15', text: 'Mira Mesa Boulevard: the 805\'s understudy — same show, half the speed, twice the stoplights.', heat: 'warm', slots: ['bridge', 'reaction'], contexts: { roads: ['I-805'], placeKeys: ['mira mesa'] } },
  { id: 'T-16', text: 'Coast Highway through Del Mar moves at the speed of money: slowly, and with no intention of hurrying for you.', heat: 'spicy', slots: ['bridge'], contexts: { placeKeys: ['del mar'] } },
  { id: 'T-17', text: 'The 15 at the 78: two counties\' worth of commuters negotiating a treaty, twice a day, forever.', heat: 'warm', slots: ['reaction'], contexts: { roads: ['I-15', 'CA-78', 'SR-78'], placeKeys: ['escondido'] } },
  { id: 'T-18', text: 'Sorrento Valley packed an entire tech industry into a valley with two ways out. The math was done by someone who telecommutes.', heat: 'roast', slots: ['bridge', 'reaction'], contexts: { roads: ['I-5', 'I-805'], placeKeys: ['sorrento valley'] } },
  { id: 'T-19', text: 'Overhead is the Cabrillo Bridge, up since 1915. The 163 below it is newer — and somehow the slower way across the canyon.', heat: 'warm', slots: ['bridge'], contexts: { roads: ['CA-163', 'SR-163'], placeKeys: ['balboa park'] } },
  { id: 'T-20', text: 'East on the 8, the temperature climbs a degree a mile, until El Cajon reminds you the beach was a loan, not a gift.', heat: 'spicy', slots: ['reaction'], contexts: { roads: ['I-8 '] } },
  { id: 'T-21', text: 'The 5 has two rush hours: the morning one, and the one caused by everyone who left early to beat the morning one.', heat: 'warm', slots: ['bridge', 'preview'], contexts: { roads: ['I-5'] } },
  { id: 'T-22', text: 'Two freeways become one here every morning, and every morning ten thousand drivers act brand-new about it. It would be funny if it weren\'t so damn reliable.', heat: 'roast', slots: ['reaction'], contexts: { roads: ['I-5', 'I-805'] } },
  // ── Navy & the bases (18) ──
  { id: 'N-01', text: 'At 32nd Street the ships get piers and the sailors get a parking scavenger hunt. Reveille is whenever you find a space.', heat: 'warm', slots: ['bridge', 'reaction'], contexts: { placeKeys: ['naval base san diego'], topics: ['Navy Century'] } },
  { id: 'N-02', text: 'San Diego is the Pacific Fleet\'s principal homeport — Navy for \'most of the ships, most of the time, and all of the traffic on Harbor Drive.\'', heat: 'warm', slots: ['bridge'], contexts: { topics: ['Navy Century'] } },
  { id: 'N-03', text: 'Harbor Drive at shift change: ten thousand sailors leaving at once, and every single one of them needed to be somewhere five minutes ago.', heat: 'spicy', slots: ['reaction'], contexts: { roads: ['Harbor'], placeKeys: ['naval base san diego'] } },
  { id: 'N-04', text: 'That\'s MCRD, where recruits stand on the yellow footprints and learn that the rest of their life starts at a volume setting of eleven.', heat: 'warm', slots: ['bridge'], contexts: { placeKeys: ['marine corps recruit depot san diego'] } },
  { id: 'N-05', text: 'The bus ride from the airport to MCRD takes about four minutes — just long enough to reconsider everything.', heat: 'spicy', slots: ['bridge', 'reaction'], contexts: { placeKeys: ['marine corps recruit depot san diego', 'san diego international airport'] } },
  { id: 'N-06', text: 'Miramar was the Navy\'s Fightertown USA. The Marines kept the jets, the attitude, and the noise complaints from every new subdivision.', heat: 'warm', slots: ['bridge'], contexts: { placeKeys: ['marine corps air station miramar'] } },
  { id: 'N-07', text: 'Jets off Miramar cross the 15 all day. Around here, traffic happens on two levels.', heat: 'spicy', slots: ['reaction'], contexts: { roads: ['I-15'], placeKeys: ['marine corps air station miramar'] } },
  { id: 'N-08', text: 'Point Loma keeps the submarines. You won\'t see them — that\'s rather the point of submarines.', heat: 'warm', slots: ['bridge', 'reaction'], contexts: { placeKeys: ['point loma', 'naval base point loma'] } },
  { id: 'N-09', text: 'North Island: the birthplace of naval aviation, and the only neighborhood in America where an aircraft carrier counts as a local.', heat: 'warm', slots: ['bridge'], contexts: { placeKeys: ['naval air station north island', 'coronado'] } },
  { id: 'N-10', text: 'The Navy runs on two fuels: coffee and hurry-up-and-wait. San Diego refines both in industrial quantities.', heat: 'spicy', slots: ['bridge'], contexts: { topics: ['Navy Century'] } },
  { id: 'N-11', text: 'When a carrier pulls out of 32nd Street, half the waterfront stops to watch. The other half is on the carrier, waving at the first half.', heat: 'warm', slots: ['reaction'], contexts: { placeKeys: ['naval base san diego'] } },
  { id: 'N-12', text: 'Below us is Murphy Canyon, one of the largest military housing areas in the country — a suburb where the lawns are as regulation as the haircuts.', heat: 'warm', slots: ['bridge'], contexts: { topics: ['Navy Century'] } },
  { id: 'N-13', text: 'Liberty in the Gaslamp used to mean a sea of dress whites. These days the Navy is outnumbered by bachelorette parties, and it isn\'t close.', heat: 'spicy', slots: ['reaction'], contexts: { placeKeys: ['gaslamp quarter'], topics: ['Navy Century'] } },
  { id: 'N-14', text: 'The Midway sits downtown as a museum now — after 47 years of service, her hardest deployment is the field-trip season.', heat: 'warm', slots: ['bridge'], contexts: { placeKeys: ['uss midway museum', 'downtown san diego'] } },
  { id: 'N-15', text: 'The Blue Line at rush hour: half sailors, half everyone else, all of them pretending not to race the gate traffic on Harbor Drive.', heat: 'spicy', slots: ['bridge'], contexts: { placeKeys: ['san diego trolley'], topics: ['Navy Century'] } },
  { id: 'N-16', text: 'Ask a sailor when they\'ll be home and you\'ll get a date, a shrug, and a backup date. The shrug is the accurate part.', heat: 'warm', slots: ['reaction'], contexts: { topics: ['Navy Century'] } },
  { id: 'N-17', text: 'From Cabrillo\'s point you can watch the fleet come and go the way it has for a century. Best seat in the county, and it isn\'t close.', heat: 'warm', slots: ['bridge'], contexts: { placeKeys: ['cabrillo national monument', 'point loma'] } },
  { id: 'N-18', text: 'The Navy has a phrase for the morning gate line at 32nd Street. The phrase is not repeatable — but the line is, every single weekday.', heat: 'spicy', slots: ['bridge', 'reaction'], contexts: { placeKeys: ['naval base san diego'] } },
  // ── Place roasts (30) ──
  { id: 'P-01', text: 'Parking in La Jolla is a blood sport with valet pricing. The ocean is free; everything within sight of it is not.', heat: 'roast', slots: ['bridge', 'reaction'], contexts: { placeKeys: ['la jolla'] } },
  { id: 'P-02', text: 'The sea lions at the Cove pay no rent, ignore every sign, and hold the best waterfront property in La Jolla. The homeowners have notes.', heat: 'warm', slots: ['bridge', 'reaction'], contexts: { placeKeys: ['la jolla cove'] } },
  { id: 'P-03', text: 'La Jolla\'s median home could fund a small navy — awkward, since the actual Navy is right there, shopping at the commissary like the rest of us.', heat: 'roast', slots: ['bridge'], contexts: { placeKeys: ['la jolla'] } },
  { id: 'P-04', text: 'Garnet Avenue on a Friday night: a dozen bars, one beach, and a thousand decisions nobody will remember clearly.', heat: 'roast', slots: ['reaction'], contexts: { placeKeys: ['pacific beach'] } },
  { id: 'P-05', text: 'The PB boardwalk runs on bikes, boards, and the total confidence of people who have never once looked where they\'re going.', heat: 'warm', slots: ['bridge'], contexts: { placeKeys: ['pacific beach'] } },
  { id: 'P-06', text: 'North Park has a brewery for every mood and a parking space for every fiftieth car. Plan your feelings accordingly.', heat: 'spicy', slots: ['bridge', 'reaction'], contexts: { placeKeys: ['north park'] } },
  { id: 'P-07', text: '30th Street is the county\'s craft-beer mile — the tasting rooms outnumber the parking spaces, and it isn\'t close.', heat: 'warm', slots: ['bridge'], contexts: { placeKeys: ['north park'] } },
  { id: 'P-08', text: 'Mission Valley: twelve lanes, four malls, and when the river rises, a lovely seasonal lake with retail.', heat: 'roast', slots: ['bridge'], contexts: { placeKeys: ['mission valley'] } },
  { id: 'P-09', text: 'Del Mar in season: the whole county drives to one fairground to eat fried everything and donate to the horses, in that order.', heat: 'spicy', slots: ['bridge', 'reaction'], contexts: { placeKeys: ['del mar', 'del mar racetrack'] } },
  { id: 'P-10', text: 'Coronado calls itself an island and gets away with it, because who\'s going to correct a place that pretty? The Silver Strand is a technicality with a view.', heat: 'warm', slots: ['bridge'], contexts: { placeKeys: ['coronado'] } },
  { id: 'P-11', text: 'Encinitas, where the break at Swami\'s has a standing appointment with half the town. Meetings have been lost to a good swell, and no jury of locals would convict.', heat: 'warm', slots: ['bridge'], contexts: { placeKeys: ['encinitas'] } },
  { id: 'P-12', text: 'Carlsbad in spring: the Flower Fields bloom, Legoland lets out, and the 5 becomes a very scenic place to reconsider your afternoon.', heat: 'spicy', slots: ['bridge', 'reaction'], contexts: { placeKeys: ['carlsbad'] } },
  { id: 'P-13', text: 'Oceanside has one of the longest wooden piers on the West Coast and a front-row seat to Camp Pendleton\'s entire social calendar.', heat: 'warm', slots: ['bridge'], contexts: { placeKeys: ['oceanside'] } },
  { id: 'P-14', text: 'Escondido means \'hidden.\' Mostly what it\'s hiding is that it\'s fifteen degrees hotter than the coast and proud of it.', heat: 'spicy', slots: ['bridge', 'reaction'], contexts: { placeKeys: ['escondido'] } },
  { id: 'P-15', text: 'Poway calls itself \'The City in the Country,\' and the traffic lights on Poway Road honor that pace with real commitment.', heat: 'warm', slots: ['bridge'], contexts: { placeKeys: ['poway'] } },
  { id: 'P-16', text: 'El Cajon is Spanish for \'the box.\' In August, the box is an oven with a courthouse in it.', heat: 'spicy', slots: ['bridge', 'reaction'], contexts: { placeKeys: ['el cajon'] } },
  { id: 'P-17', text: 'Chula Vista means \'beautiful view,\' and for once the name holds up: bay on one side, mountains on the other, Olympians training in between.', heat: 'warm', slots: ['bridge'], contexts: { placeKeys: ['chula vista'] } },
  { id: 'P-18', text: 'National City\'s Mile of Cars: if it has wheels and a price ending in 995, it\'s parked here, next to its cousins.', heat: 'warm', slots: ['bridge'], contexts: { placeKeys: ['national city'] } },
  { id: 'P-19', text: 'Lemon Grove built a three-thousand-pound concrete lemon and wrote \'Best Climate on Earth\' on it. Argument settled, punctuation provided.', heat: 'warm', slots: ['bridge'], contexts: { placeKeys: ['lemon grove', 'the giant lemon'] } },
  { id: 'P-20', text: 'La Mesa calls itself the Jewel of the Hills, and every October it closes the jewel box for Oktoberfest.', heat: 'warm', slots: ['bridge'], contexts: { placeKeys: ['la mesa'] } },
  { id: 'P-21', text: 'Hillcrest: great market, great restaurants, and parking that\'s a rumor started by people who took the bus.', heat: 'spicy', slots: ['bridge', 'reaction'], contexts: { placeKeys: ['hillcrest'] } },
  { id: 'P-22', text: 'The jets cross Bankers Hill low enough to read the airline off the tail. The residents don\'t look up anymore. The passengers do.', heat: 'warm', slots: ['bridge'], contexts: { placeKeys: ['bankers hill'] } },
  { id: 'P-23', text: 'During Comic-Con, the Gaslamp fills with superheroes — for one week, the capes outnumber the parking spaces four to one.', heat: 'spicy', slots: ['bridge'], contexts: { placeKeys: ['gaslamp quarter'] } },
  { id: 'P-24', text: 'December Nights: Balboa Park hosts the entire county for two nights, and the parking holds about eleven of them.', heat: 'roast', slots: ['reaction'], contexts: { placeKeys: ['balboa park'] } },
  { id: 'P-25', text: 'Old Town is where California began, and where every visiting relative must be taken for exactly one margarita the size of a fishbowl.', heat: 'spicy', slots: ['bridge'], contexts: { placeKeys: ['old town'] } },
  { id: 'P-26', text: 'Newport Avenue in OB, where the drum circle has been going since roughly the Johnson administration, and no one has the heart — or the rhythm — to stop it.', heat: 'warm', slots: ['bridge'], contexts: { placeKeys: ['ocean beach'] } },
  { id: 'P-27', text: 'Belmont Park\'s Giant Dipper has been rattling riders since 1925. The coaster is wooden, the screams are modern, the line is eternal.', heat: 'spicy', slots: ['bridge'], contexts: { placeKeys: ['mission beach', 'belmont park'] } },
  { id: 'P-28', text: 'Sunset Cliffs at golden hour: the whole county drives to one cliff to watch the sun do what it does every day, like it\'s a limited engagement.', heat: 'warm', slots: ['bridge', 'reaction'], contexts: { placeKeys: ['sunset cliffs'] } },
  { id: 'P-29', text: 'University Heights was named for a university that was never built. The sign over Park Boulevard remains, holding the dream up all by itself.', heat: 'warm', slots: ['bridge'], contexts: { placeKeys: ['university heights'] } },
  { id: 'P-30', text: 'Borrego Springs is an official Dark Sky community — the only town in the county where the biggest show at night is the one that\'s been running for billions of years.', heat: 'warm', slots: ['bridge'], contexts: { placeKeys: ['borrego springs'] } },
  // ── Weather smugness (10) ──
  { id: 'W-01', text: 'Forecast for the drive: 72 and sunny, with a chance of a local telling you yesterday was 74 and, honestly, better.', heat: 'warm', slots: ['preview', 'bridge'] },
  { id: 'W-02', text: 'May Gray: the marine layer shows up in the morning like it owns the coast, then burns off by lunch like it was never here. It was here. It\'s always here.', heat: 'spicy', slots: ['bridge'] },
  { id: 'W-03', text: 'June Gloom is just May Gray with seniority.', heat: 'warm', slots: ['reaction'] },
  { id: 'W-04', text: 'The marine layer air-conditions the coast for free and charges the inland full price. Nobody out east agreed to this arrangement.', heat: 'spicy', slots: ['bridge'], contexts: { regions: ['coast', 'east'] } },
  { id: 'W-05', text: 'It\'s ten degrees hotter in El Cajon than at the beach, twenty in Ramona — and in Borrego Springs, the thermometer itself has filed a noise complaint.', heat: 'warm', slots: ['bridge', 'reaction'], contexts: { regions: ['east', 'backcountry'] } },
  { id: 'W-06', text: 'San Diego experiences winter as a rumor started by people in Ohio. Locals wear a parka at 58 degrees and mean it with their whole chest.', heat: 'roast', slots: ['reaction'] },
  { id: 'W-07', text: 'The first rain of the season turns every San Diego driver into a student driver: oil comes up, speed goes down, hazard lights come out to celebrate.', heat: 'spicy', slots: ['reaction', 'bridge'] },
  { id: 'W-08', text: 'Locals know the real summer here is September and October. June is just the trailer, and it\'s mostly fog.', heat: 'warm', slots: ['bridge'] },
  { id: 'W-09', text: 'Santa Ana winds today: hot, dry, staticky as hell, and your hair has filed for independence. Anything not nailed down is currently westbound.', heat: 'spicy', slots: ['reaction'] },
  { id: 'W-10', text: 'In January, visitors swim at La Jolla. Locals watch from the sand in jackets, eating burritos, providing the color commentary.', heat: 'warm', slots: ['bridge'], contexts: { placeKeys: ['la jolla'] } },
  // ── Tourists & icons (12) ──
  { id: 'V-01', text: 'The Zoo\'s pandas have an international relocation deal, a bamboo budget, and a fan club. Most San Diegans have two of the three.', heat: 'warm', slots: ['bridge'], contexts: { placeKeys: ['san diego zoo'] }, expires: '2034-06-27' },
  { id: 'V-02', text: 'The Zoo is a hundred acres of uphill. The animals stay in shape, and by the time you reach the Skyfari, so have you.', heat: 'spicy', slots: ['bridge', 'reaction'], contexts: { placeKeys: ['san diego zoo'] } },
  { id: 'V-03', text: 'On summer nights SeaWorld fires off fireworks over Mission Bay, and every dog in three neighborhoods files a formal objection.', heat: 'warm', slots: ['bridge'], contexts: { placeKeys: ['seaworld san diego', 'mission bay'] } },
  { id: 'V-04', text: 'The Hotel del has been receiving beachgoers since 1888 — Marilyn Monroe filmed there, presidents slept there, and the red turrets have outlasted every fashion since.', heat: 'warm', slots: ['bridge'], contexts: { placeKeys: ['hotel del coronado'] } },
  { id: 'V-05', text: 'Downtown there\'s a 25-foot sailor permanently kissing a nurse by the Midway. The actual sailors keep their opinions to themselves.', heat: 'spicy', slots: ['bridge'], contexts: { placeKeys: ['uss midway museum', 'downtown san diego'] } },
  { id: 'V-06', text: 'Legoland: an entire kingdom built from the one toy you\'ve sworn at barefoot at 2 a.m.', heat: 'spicy', slots: ['bridge', 'reaction'], contexts: { placeKeys: ['legoland california', 'carlsbad'] } },
  { id: 'V-07', text: 'At the Safari Park, the rhinos handle the Escondido heat better than the rest of us. In fairness, they were dressed for it.', heat: 'warm', slots: ['bridge'], contexts: { placeKeys: ['san diego zoo safari park', 'escondido'] } },
  { id: 'V-08', text: 'Torrey Pines hosts a PGA Tour stop every January — the rest of the year, it\'s where local golfers lose balls with an ocean view.', heat: 'spicy', slots: ['bridge'], contexts: { placeKeys: ['torrey pines golf course', 'torrey pines'] } },
  { id: 'V-09', text: 'At the Gliderport, people run off a cliff on purpose while the rest of us pay for parking to watch. San Diego\'s spectator sports are undefeated.', heat: 'warm', slots: ['bridge'], contexts: { placeKeys: ['torrey pines'] } },
  { id: 'V-10', text: 'Cabrillo\'s tide pools: twice a day the ocean introduces its smallest citizens, and the line of cars believes it\'s worth it. It is.', heat: 'warm', slots: ['bridge'], contexts: { placeKeys: ['cabrillo national monument', 'point loma'] } },
  { id: 'V-11', text: 'Birch Aquarium sits above La Jolla with the best classroom view in America: the kelp forest gets the ocean, and the students get the window.', heat: 'warm', slots: ['bridge'], contexts: { placeKeys: ['birch aquarium at scripps'] } },
  { id: 'V-12', text: 'The County Fair deep-fries something new every summer as a public service, so the rest of us don\'t have to find out.', heat: 'spicy', slots: ['reaction'], contexts: { placeKeys: ['san diego county fair'] } },
  // ── Food (12) ──
  { id: 'F-01', text: 'The California burrito swaps the rice for french fries, and San Diego will defend that in a parking lot at midnight. Correctly.', heat: 'spicy', slots: ['bridge', 'reaction'], contexts: { topics: ['Food & Drink'] } },
  { id: 'F-02', text: 'Half the taco shops in the county end in \'-berto\'s,\' every one claims to be the original, and the 1 a.m. drive-thru line is the only poll that counts.', heat: 'warm', slots: ['bridge'], contexts: { topics: ['Food & Drink'] } },
  { id: 'F-03', text: 'Carne asada fries were invented here, which means San Diego looked at nachos and said: more.', heat: 'warm', slots: ['bridge'], contexts: { topics: ['Food & Drink'] } },
  { id: 'F-04', text: 'Ask five San Diegans where the best taco is and you\'ll get nine answers, two corrections, and one friendship quietly downgraded.', heat: 'spicy', slots: ['reaction'], contexts: { topics: ['Food & Drink'] } },
  { id: 'F-05', text: 'The fish taco came up from Baja and got adopted so completely that ordering one grilled around here requires a brief defense of your choices.', heat: 'warm', slots: ['bridge'], contexts: { regions: ['coast'], topics: ['Food & Drink'] } },
  { id: 'F-06', text: 'The In-N-Out line wraps the building, the lot, and occasionally the concept of lunch itself. Everyone in it has decided it\'s worth it. Everyone is right.', heat: 'spicy', slots: ['bridge', 'reaction'], contexts: { topics: ['Food & Drink'] } },
  { id: 'F-07', text: 'Convoy Street is the county\'s real food court — a mile of noodles, barbecue, and boba in Kearny Mesa, with parking as the only cover charge.', heat: 'warm', slots: ['bridge'], contexts: { placeKeys: ['convoy pan asian cultural district', 'kearny mesa'] } },
  { id: 'F-08', text: 'San Diego\'s taco shops keep surfer hours, banker hours, and 3 a.m. hours — the drive-thru is this county\'s true 24-hour institution.', heat: 'spicy', slots: ['bridge'], contexts: { topics: ['Food & Drink'] } },
  { id: 'F-09', text: 'Every salsa bar is a personality test: the green says optimist, the red says realist, and the unlabeled one says you\'ve made your peace with the consequences.', heat: 'warm', slots: ['reaction'], contexts: { topics: ['Food & Drink'] } },
  { id: 'F-10', text: 'Phil\'s BBQ has had a line out the door since roughly the Bronze Age. People bring chairs. The chairs have regulars.', heat: 'spicy', slots: ['bridge'], contexts: { topics: ['Food & Drink'] } },
  { id: 'F-11', text: 'Hodad\'s in OB serves a burger the size of a hubcap in a room wallpapered with license plates. Portion control was discussed, and voted down.', heat: 'warm', slots: ['bridge'], contexts: { placeKeys: ['hodads', 'ocean beach'] } },
  { id: 'F-12', text: 'San Diego calls itself the craft beer capital, and the tasting-room count suggests the county has made its decision and ordered a second.', heat: 'spicy', slots: ['bridge', 'reaction'], contexts: { placeKeys: ['north park'], topics: ['Food & Drink'] } },
  // ── Sports (10) ──
  { id: 'S-01', text: 'The Padres waited 52 years for a no-hitter — the last team in baseball to get one — and a kid from El Cajon threw it. This city delivers its own punchlines, eventually.', heat: 'warm', slots: ['bridge'], contexts: { placeKeys: ['petco park'], topics: ['Sport'] } },
  { id: 'S-02', text: 'Petco Park might be the prettiest ballpark in America — the Padres like the ninth inning to have somewhere nice to happen to you.', heat: 'spicy', slots: ['bridge', 'reaction'], contexts: { placeKeys: ['petco park'] } },
  { id: 'S-03', text: 'The Chargers left for Los Angeles and a soccer stadium. San Diego kept the weather, the beaches, and custody of the grudge.', heat: 'roast', slots: ['reaction'], contexts: { topics: ['Sport'] } },
  { id: 'S-04', text: 'The most decorated team in this city\'s history plays indoor soccer — the Sockers have more titles than the rest of our trophy cases combined, and they did it on carpet.', heat: 'spicy', slots: ['bridge'], contexts: { topics: ['Sport'] } },
  { id: 'S-05', text: 'The loudest room in San Diego sports is a college arena — The Show at Viejas doesn\'t do quiet; it does choreography.', heat: 'spicy', slots: ['bridge'], contexts: { placeKeys: ['san diego state university'], topics: ['Sport'] } },
  { id: 'S-06', text: 'The Gulls play ice hockey in a city that averages 72 degrees. The ice is imported, the fans are local, and both are holding up fine.', heat: 'warm', slots: ['bridge'], contexts: { topics: ['Sport'] } },
  { id: 'S-07', text: 'Tony Gwynn hit .338 for his career in this town — still the only average every San Diegan agrees on without a meeting.', heat: 'warm', slots: ['bridge'], contexts: { placeKeys: ['petco park'], topics: ['Sport'] } },
  { id: 'S-08', text: 'Two World Series trips, zero rings. The trophy case has excellent lighting and a great deal of interpretive signage.', heat: 'roast', slots: ['reaction'], contexts: { placeKeys: ['petco park'], topics: ['Sport'] } },
  { id: 'S-09', text: 'Snapdragon rose where the old Murph stood — same patch of Mission Valley, and the new tenants report no ghosts in the locker room. Yet.', heat: 'spicy', slots: ['bridge'], contexts: { placeKeys: ['snapdragon stadium', 'mission valley'] } },
  { id: 'S-10', text: 'San Diego has hosted three Super Bowls it wasn\'t in. We throw a wonderful party for other people\'s championships.', heat: 'spicy', slots: ['reaction'], contexts: { topics: ['Sport'] } },
  // ── Drive deadpan (20) ──
  { id: 'D-01', text: 'Wheels up shortly. The marine layer has agreed to burn off by the time we reach anything worth photographing. It has not signed anything.', heat: 'warm', slots: ['preview'] },
  { id: 'D-02', text: 'San Diego International runs the whole city\'s air travel through a single runway, and somehow it works. The runway mentions this at parties.', heat: 'warm', slots: ['preview', 'bridge'], contexts: { placeKeys: ['san diego international airport'] } },
  { id: 'D-03', text: 'Somewhere between here and the destination is a taco shop with a drive-thru. There is always a taco shop with a drive-thru. It\'s practically county law.', heat: 'spicy', slots: ['bridge'], contexts: { topics: ['Food & Drink'] } },
  { id: 'D-04', text: 'Red trolley on one side, marine layer on the other — the county\'s entire color palette in a single glance.', heat: 'warm', slots: ['bridge'], contexts: { placeKeys: ['san diego trolley'] } },
  { id: 'D-05', text: 'That rumble is another jet coming into Lindbergh over the park. Downtown gets a flyover every couple of minutes; the pigeons have tenure.', heat: 'warm', slots: ['reaction'], contexts: { placeKeys: ['san diego international airport', 'balboa park'] } },
  { id: 'D-06', text: 'Beach parking math: arrive before nine, or arrive emotionally prepared to circle like a very committed shark.', heat: 'spicy', slots: ['bridge'], contexts: { regions: ['coast'] } },
  { id: 'D-07', text: 'The Coaster runs up the coast on rails from another century, past beaches that make the whole commute look like a screensaver with delays.', heat: 'warm', slots: ['bridge'], contexts: { regions: ['coast'] } },
  { id: 'D-08', text: 'Every third car in this county carries a surfboard, a paddleboard, or strong opinions about both.', heat: 'warm', slots: ['reaction'], contexts: { regions: ['coast'] } },
  { id: 'D-09', text: 'Before we roll: the forecast is 72, the traffic is alleged, and somebody on the 8 is already doing something heroic and illegal.', heat: 'roast', slots: ['preview'], contexts: { roads: ['I-8 '] } },
  { id: 'D-10', text: 'The palm trees aren\'t native — San Diego imported its skyline vegetation, planted it everywhere, and never once looked back.', heat: 'warm', slots: ['bridge'], contexts: { regions: ['coast'] } },
  { id: 'D-11', text: 'A San Diego cold snap is 57 degrees. Somewhere nearby, a visitor in shorts is learning why locals own exactly one good jacket and treat it like an heirloom.', heat: 'warm', slots: ['reaction'] },
  { id: 'D-12', text: 'We just passed the third-best taco shop within a mile. The ranking is contested. The mileage is not.', heat: 'spicy', slots: ['bridge'], contexts: { topics: ['Food & Drink'] } },
  { id: 'D-13', text: 'If traffic stops entirely, the entertainment is eucalyptus trees and license plates from states whose weather we discuss with real pity.', heat: 'warm', slots: ['bridge'], contexts: { regions: ['east'] } },
  { id: 'D-14', text: 'That concludes the driving portion of the program. The sitting-in-traffic portion, as always, was complimentary.', heat: 'warm', slots: ['wrap-up'] },
  { id: 'D-15', text: 'Rush hour here starts at 2:30, peaks at the exact moment you leave, and ends when it damn well pleases. It\'s not personal. It just feels that way.', heat: 'spicy', slots: ['reaction'] },
  { id: 'D-16', text: 'The hills east of the 15 keep their own weather and their own opinions. We\'re guests in both.', heat: 'warm', slots: ['bridge'], contexts: { roads: ['I-15'], regions: ['east'] } },
  { id: 'D-17', text: 'Somewhere behind us, a visitor is asking a local where \'the beach\' is. There are seventy miles of it. The local is being very kind.', heat: 'spicy', slots: ['reaction'], contexts: { regions: ['coast'] } },
  { id: 'D-18', text: 'Mission accomplished is too strong a phrase for any drive involving Ingraham Street, but we\'re managing.', heat: 'warm', slots: ['bridge'], contexts: { regions: ['coast'] } },
  { id: 'D-19', text: 'Today\'s drive pairs well with the marine layer\'s opening act and — if the timing holds — a clear-sky second half. The county does two shows daily.', heat: 'warm', slots: ['preview', 'bridge'] },
  { id: 'D-20', text: 'And that\'s the drive. The ocean\'s still there, the traffic\'s still the traffic, and San Diego remains undefeated at being San Diego.', heat: 'warm', slots: ['wrap-up'], contexts: { regions: ['coast'] } },
  // ── Thread & destination bits (16) ──
  { id: 'A-01', text: 'Next stop, {destination} — a place so sure of itself it doesn\'t hurry, and neither shall we.', heat: 'warm', slots: ['preview'] },
  { id: 'A-02', text: 'We\'re bound for {destination}, which means the last ten minutes of this drive are just the county showing off before the finale.', heat: 'spicy', slots: ['bridge'] },
  { id: 'A-03', text: 'Somewhere ahead is {place}, which has been minding its own business since long before the freeway asked it to stop.', heat: 'warm', slots: ['bridge'] },
  { id: 'A-04', text: '{road} again — the county\'s longest-running relationship. It\'s complicated, it\'s congested, it\'s committed.', heat: 'spicy', slots: ['reaction'], contexts: { roads: ['I-5', 'I-805', 'I-15', 'I-8 ', 'CA-163', 'SR-163', 'CA-52', 'SR-52', 'CA-78', 'SR-78', 'CA-75', 'SR-75', 'CA-125', 'SR-125', 'CA-56', 'SR-56', 'CA-94', 'SR-94', 'CA-67', 'SR-67', 'CA-905', 'SR-905', 'CA-54', 'SR-54'] } },
  { id: 'A-05', text: 'Hold on to your coffee: {place} is coming up, and it has opinions about being a footnote. It is not a footnote.', heat: 'warm', slots: ['bridge'] },
  { id: 'A-06', text: 'And here we are at {destination}. The car may now resume its second job: judging everyone else\'s parking.', heat: 'warm', slots: ['wrap-up'] },
  { id: 'A-07', text: '{destination}, achieved. If the drive felt long, tell people it was the scenic route. On this coast, it always is.', heat: 'spicy', slots: ['wrap-up'] },
  { id: 'A-08', text: 'Today\'s feature presentation ends at {destination}. The opening act is traffic; the county apologizes in advance.', heat: 'warm', slots: ['preview'] },
  { id: 'A-09', text: 'Passing {place} now — wave if you know it, wonder if you don\'t. Either way, it saves its best stories for the way back.', heat: 'warm', slots: ['bridge'] },
  { id: 'A-10', text: '{road} at this hour is less a highway than a suggestion with exits.', heat: 'spicy', slots: ['bridge'], contexts: { roads: ['I-5', 'I-805', 'I-15', 'I-8 ', 'CA-163', 'SR-163', 'CA-52', 'SR-52', 'CA-78', 'SR-78', 'CA-75', 'SR-75', 'CA-125', 'SR-125', 'CA-56', 'SR-56', 'CA-94', 'SR-94', 'CA-67', 'SR-67', 'CA-905', 'SR-905', 'CA-54', 'SR-54'] } },
  { id: 'A-11', text: 'Funny thing about {place}: the postcards undersell it, and the postcards have had a century to practice.', heat: 'warm', slots: ['reaction'] },
  { id: 'A-12', text: 'Welcome to {destination}, where we now perform the county\'s oldest ritual: circling for parking like it owes us money.', heat: 'roast', slots: ['wrap-up'] },
  { id: 'A-13', text: 'The sign says {place} is two miles ahead. The sign has never once accounted for what the traffic thinks about that.', heat: 'warm', slots: ['bridge'] },
  { id: 'A-14', text: 'Destination: {destination}. Detours: possible. Regrets: available at every exit, none recommended.', heat: 'spicy', slots: ['preview'] },
  { id: 'A-15', text: 'Every drive in this county is really just a long introduction to {destination} — the county\'s been workshopping the middle for a hundred years.', heat: 'warm', slots: ['bridge'] },
  { id: 'A-16', text: 'If {place} looks quiet right now, that\'s the marine layer\'s doing. Underneath, it\'s San Diego all the way down.', heat: 'warm', slots: ['reaction'] },
];

/**
 * The bank lint (scope §10): every line tagged, length-
 * capped, slot-valid, uniquely identified. Returns a list of
 * problems (empty = clean). The harness runs it over the
 * shipped bank (trivially clean while empty) and over
 * fixtures; the review workflow runs it before any future
 * bank lands.
 */
export function validateHumorBank(bank: readonly HumorLine[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const line of bank) {
    const at = line && typeof line.id === 'string' && line.id ? line.id : '(no id)';
    if (!line || typeof line.id !== 'string' || !line.id) problems.push(`${at}: missing id`);
    else if (seen.has(line.id)) problems.push(`${at}: duplicate id`);
    else seen.add(line.id);
    if (!line || typeof line.text !== 'string' || !line.text.trim()) problems.push(`${at}: empty text`);
    else if (line.text.length > HUMOR_MAX_CHARS) problems.push(`${at}: text ${line.text.length} chars > ${HUMOR_MAX_CHARS}`);
    if (!line || !HUMOR_HEATS.includes(line.heat)) problems.push(`${at}: invalid heat ${String(line?.heat)}`);
    if (!line || !Array.isArray(line.slots) || line.slots.length === 0) problems.push(`${at}: no slots`);
    else {
      for (const s of line.slots) if (!HUMOR_SLOTS.includes(s)) problems.push(`${at}: invalid slot ${String(s)}`);
    }
    if (line?.expires !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(line.expires)) {
      problems.push(`${at}: expires is not an ISO date`);
    }
  }
  return problems;
}
