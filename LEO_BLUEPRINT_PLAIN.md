# Leo's World — Plain-Language Blueprint & Pitch

## The One-Sentence Pitch
Leo's World is an AI audio tour guide that rides shotgun with you — open it while walking or driving, and "Leo," a witty local-history-obsessed character, narrates the hidden stories of whatever you're passing in real time, hands-free.

## What It Feels Like to Use
You open the app, tap "Start Tour," and a voice introduces itself. As you walk down a street or drive through a neighborhood, Leo starts talking — pointing out the building with a wild backstory, the corner where a duel happened, the unmarked spot that changed the city's history. It's like having a podcast host in your pocket who knows exactly where you are and what's worth knowing about it.

If you pass something interesting, Leo tells you about it. If you stop moving, he digs deeper into the area — neighborhood history, architecture, notable people, local legends. If you're on a long highway stretch with nothing around, he shifts to road-trip mode and tells you about the highway itself, the county, the landscape, what's coming up.

You can also hold a microphone button and ask a question out loud — "who lived in that house?" or "what happened here in the 1960s?" — and Leo answers conversationally, using what he can see around you and what he was just talking about as context.

## The Experience in Detail

### Leo's Character
Leo is a guy in his early 40s who has spent 20 years going down local-history rabbit holes. He has opinions — he thinks certain building demolitions were crimes, he finds some eras overrated, and he says so lightly. He's self-deprecating about his obsession. His humor is dry and observational: "This building predates the concept of weekends." He never sounds like a narrator reading a script — he sounds like a real, slightly-too-into-it friend.

Every story follows a shape: a hook (something odd that pulls you in), a twist (the scandal, the irony, the coincidence), and a landing (a punchy closer that sticks). Think "Mysteries at the Museum" meets a road-trip buddy.

### How Stories Are Chosen
Leo always hunts for the freshest, most interesting story about what's right in front of you — new landmarks, new people, new angles. He does NOT just repeat variations of the first story over and over. Each story stands on its own. The "connect the dots" magic lives in how he transitions between stories: if there's a genuine thread between two stories (the same era, a shared person, cause-and-effect), he'll call it out in a one-line transition. If the best story is completely unrelated to anything before, he pivots freely — "completely different vibe, but equally wild." Variety is the goal; the dots connect in hindsight, not by force.

### Adapting to How You're Moving
- **Walking:** Stories are a little longer, more relaxed. Leo pauses for 45-60 seconds of silence between stories so you can take in the surroundings.
- **City driving:** Stories stay punchy — 2-3 sentences, under 20 seconds. He never anchors to a small storefront you'll blow past. He frames everything as a flowing corridor: "as this stretch opens up...". He never gives turn-by-turn directions or tells you to look away from the road.
- **Highway driving:** With long gaps between points of interest, Leo tells longer, deeper stories — 5-8 sentences, like a mini podcast episode.
- **Rural/road-trip mode:** No landmarks, no neighborhood? Leo talks about the highway, the county, the geography, the wildlife, what's ahead.
- **Standing still:** If you've stopped (say, at a red light or a scenic overlook), Leo cycles through 12 different "depth" angles — the landmark itself, neighborhood history, regional history, notable people, culture, street names, architecture, natural features, transportation, demographics, geology, folklore — so the same spot doesn't get repetitive.

### Voice Interaction
- **Hold-to-talk mic:** Hold the button, ask a question out loud, release. Leo stops talking immediately (never talks over you), listens, and answers using your location and what he was just discussing as context.
- **Skip button:** Jump past the current story.
- **10-minute mute:** Silence Leo for a stretch.
- **End tour:** Fully stops Leo, drops queued stories, turns off GPS.

### Working Offline
Driving through a dead zone? Leo keeps playing from a cache of stories he fetched ahead of time (prefetching). If he can't tell a story because there's no signal, he queues the location and catches you up when you're back online — "Got some stories I couldn't share earlier while we lost signal." There's a filler line for extended outages so you never get dead silence.

### Quality-of-Life Touches
- **Pocket mode:** Black screen to save battery while the tour runs in your pocket.
- **Resume session:** If you close the app and reopen within 30 minutes, it offers to pick up where you left off.
- **Wake lock:** The screen stays awake so the tour doesn't get interrupted by your phone sleeping.
- **Diagnostics panel:** A small toggle shows GPS status, position accuracy, network status, stories told, cache count, and the last story source.
- **Pronunciation care:** Hard proper nouns are spelled phonetically so the text-to-speech voice says them right.

## The Business Scaffolding (Built In, Not Yet Active)
The app has the plumbing for monetization already wired in:
- **Subscription tiers:** Free, Premium, and Pro — Premium and Pro are ad-free.
- **Ad campaigns:** A database table exists where advertisers can add spoken-word ads. The app is coded to insert one ad every 4 stories (for free users only), targeting by region and by whether you're driving or walking. No ads are live yet — when campaigns are added to the database, they'll start playing automatically.
- **Analytics:** Every story play, session start, and ad play is tracked with location and movement mode, batched and sent to the database every 15 seconds.

None of this is turned on for users yet. It's scaffolding so the business side can be switched on without rebuilding the app.

## What Makes This Different
- **It's not a list of Wikipedia facts.** It's a character telling you stories with hooks, twists, and landings.
- **It's location-aware and movement-aware.** It changes what it talks about and how long it talks based on whether you're walking, driving, on a highway, or standing still.
- **It works offline.** Prefetching and catch-up mean you don't lose the tour when you lose signal.
- **It's conversational.** You can ask it questions mid-tour and it answers in character, grounded in where you are.
- **Stories don't get repetitive.** The depth-cycling system and the "fresh story first" philosophy mean Leo keeps finding new angles, not looping back to the same one.

## What You'd Need to Make It Real for Users
- A Google Maps API key (for landmark detection and area info).
- A Google Gemini API key (for the AI that generates the stories and answers questions).
- The Supabase database is already set up (story caching, analytics, ad campaigns all live there).

## Where It Could Go Next
- User accounts and saved tours.
- Turn on ads and subscriptions for revenue.
- Multi-language support.
- Custom tour routes (e.g., "give me the ghost stories of this city").
- Community-contributed stories vetted by Leo's AI.
- Partner with tourism boards or cities for sponsored content.
