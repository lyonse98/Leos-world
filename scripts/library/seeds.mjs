// The 50 library seeds (library-seed-list.md v2, Erik Oct 25, 2026).
//
// `name` is the canonical place name — the subject name the app itself
// would choose — because the library key is normalizePlaceKey(name) and
// the serve path looks entries up by the subject it picked. Angles are
// short keys resolved against the app's LANDMARK_ANGLES at build time
// ('origin' → 'landmark_origin', etc.); three per place, chosen by fit.

export const SEEDS = [
  { n: 1, name: 'Balboa Park', area: 'Balboa Park, San Diego', query: 'El Prado, Balboa Park, San Diego', angles: ['origin', 'building', 'people'] },
  { n: 2, name: 'Hotel del Coronado', area: 'Coronado', query: 'Hotel del Coronado, Coronado, CA', angles: ['origin', 'legends', 'people'] },
  { n: 3, name: 'USS Midway Museum', area: 'Embarcadero, San Diego', query: 'USS Midway Museum, San Diego', angles: ['origin', 'event', 'people'] },
  { n: 4, name: 'Cabrillo National Monument', area: 'Point Loma, San Diego', query: 'Cabrillo National Monument, San Diego', angles: ['origin', 'event', 'surroundings'] },
  { n: 5, name: 'Old Town San Diego State Historic Park', area: 'Old Town, San Diego', query: 'Old Town San Diego State Historic Park', angles: ['origin', 'event', 'legends'] },
  { n: 6, name: 'Whaley House Museum', area: 'Old Town, San Diego', query: 'Whaley House, San Diego', angles: ['origin', 'legends', 'people'] },
  { n: 7, name: 'Gaslamp Quarter', area: 'Downtown San Diego', query: 'Gaslamp Quarter, San Diego', angles: ['origin', 'scandal', 'event'] },
  { n: 8, name: 'Star of India', area: 'Embarcadero, San Diego', query: 'Star of India ship, San Diego', angles: ['origin', 'event', 'people'] },
  { n: 9, name: 'Santa Fe Depot', area: 'Downtown San Diego', query: 'Santa Fe Depot, San Diego', angles: ['origin', 'building', 'event'], coords: { lat: 32.7169, lng: -117.1696, source: 'manual pin — downtown depot, 1050 Kettner Blvd (registry name-match resolves to the VISTA depot at 33.1596,-117.3496; wrong by ~50 km)' } },
  { n: 10, name: 'U.S. Grant Hotel', area: 'Downtown San Diego', query: 'U.S. Grant Hotel, San Diego', angles: ['origin', 'scandal', 'people'] },
  { n: 11, name: 'San Diego–Coronado Bridge', area: 'San Diego Bay', query: 'San Diego–Coronado Bridge', angles: ['origin', 'building', 'event'] },
  { n: 12, name: 'Chicano Park', area: 'Barrio Logan, San Diego', query: 'Chicano Park, San Diego', angles: ['origin', 'event', 'cultural'] },
  { n: 13, name: 'San Ysidro Port of Entry', area: 'San Ysidro, San Diego', query: 'San Ysidro Port of Entry', angles: ['origin', 'recent', 'people'] },
  { n: 14, name: 'La Jolla Cove', area: 'La Jolla, San Diego', query: 'La Jolla Cove', angles: ['origin', 'surroundings', 'recent'] },
  { n: 15, name: 'Torrey Pines State Natural Reserve', area: 'Torrey Pines, San Diego', query: 'Torrey Pines State Natural Reserve', angles: ['origin', 'surroundings', 'sports'] },
  { n: 16, name: 'Salk Institute for Biological Studies', area: 'La Jolla, San Diego', query: 'Salk Institute, La Jolla', angles: ['origin', 'building', 'people'] },
  { n: 17, name: 'Birch Aquarium at Scripps', area: 'La Jolla Shores, San Diego', query: 'Birch Aquarium at Scripps, La Jolla', angles: ['origin', 'people', 'role'] },
  { n: 18, name: 'Geisel Library', area: 'UC San Diego, La Jolla', query: 'Geisel Library, UC San Diego', angles: ['origin', 'building', 'people'] },
  { n: 19, name: 'Windansea Surf Shack', area: 'Windansea, La Jolla', query: 'Windansea Surf Shack, La Jolla', angles: ['origin', 'sports', 'legends'] },
  { n: 20, name: 'Mount Soledad National Veterans Memorial', area: 'La Jolla, San Diego', query: 'Mount Soledad National Veterans Memorial', angles: ['origin', 'scandal', 'event'] },
  { n: 21, name: 'Mission San Diego de Alcalá', area: 'Mission Valley, San Diego', query: 'Mission San Diego de Alcalá', angles: ['origin', 'event', 'people'] },
  { n: 22, name: 'Mission San Luis Rey de Francia', area: 'Oceanside', query: 'Mission San Luis Rey, Oceanside', angles: ['origin', 'building', 'people'] },
  { n: 23, name: 'San Diego Zoo', area: 'Balboa Park, San Diego', query: 'San Diego Zoo', angles: ['origin', 'people', 'event'] },
  { n: 24, name: 'Spreckels Organ Pavilion', area: 'Balboa Park, San Diego', query: 'Spreckels Organ Pavilion, Balboa Park', angles: ['origin', 'music', 'building'] },
  { n: 25, name: 'Kate Sessions Park', area: 'Pacific Beach, San Diego', query: 'Kate Sessions Park, San Diego', angles: ['origin', 'people', 'surroundings'] },
  { n: 26, name: 'Naval Air Station North Island', area: 'Coronado', query: 'Naval Air Station North Island, Coronado', angles: ['origin', 'event', 'role'] },
  { n: 27, name: 'San Diego International Airport', area: 'San Diego', query: 'San Diego International Airport', angles: ['origin', 'event', 'people'] },
  { n: 28, name: 'Sunset Cliffs Natural Park', area: 'Ocean Beach, San Diego', query: 'Sunset Cliffs Natural Park, San Diego', angles: ['origin', 'legends', 'surroundings'] },
  { n: 29, name: 'Julian', area: 'Julian, California', query: 'Julian, California', angles: ['origin', 'event', 'cultural'] },
  { n: 30, name: 'Palomar Observatory', area: 'Palomar Mountain', query: 'Palomar Observatory', angles: ['origin', 'people', 'role'] },
  { n: 31, name: 'Lafayette Hotel', area: 'North Park, San Diego', query: 'Lafayette Hotel, San Diego', angles: ['origin', 'recent', 'people'] },
  { n: 32, name: 'El Cortez Hotel', area: 'Downtown San Diego', query: 'El Cortez Hotel, San Diego', angles: ['origin', 'building', 'recent'], coords: { lat: 32.72057, lng: -117.157944, source: 'registry — El Cortez Apartment Hotel (national+local, verified). AREA F re-pin R-1: the v13 corpus geocoded this seed to Sydney, Australia; the served rows need the same re-pin (see major-coverage-audit.md §2D-D1)' } },
  { n: 33, name: 'Villa Montezuma', area: 'Sherman Heights, San Diego', query: 'Villa Montezuma, San Diego', angles: ['origin', 'legends', 'people'] },
  { n: 34, name: 'Friendship Park', area: 'San Diego–Tijuana border', query: 'Friendship Park, San Diego', angles: ['origin', 'event', 'recent'] },
  { n: 35, name: 'Fort Rosecrans National Cemetery', area: 'Point Loma, San Diego', query: 'Fort Rosecrans National Cemetery', angles: ['origin', 'people', 'surroundings'] },
  { n: 36, name: 'Kansas City Barbeque', area: 'East Village, San Diego', query: 'Kansas City Barbeque, San Diego', angles: ['origin', 'cultural', 'event'] },
  { n: 37, name: 'Mount Helix Park', area: 'La Mesa', query: 'Mount Helix Park, La Mesa', angles: ['origin', 'event', 'surroundings'] },
  { n: 38, name: 'Mormon Battalion Historic Site', area: 'Old Town, San Diego', query: 'Mormon Battalion Historic Site, San Diego', angles: ['origin', 'event', 'people'] },
  { n: 39, name: 'Del Mar Racetrack', area: 'Del Mar', query: 'Del Mar Racetrack', angles: ['origin', 'sports', 'people'] },
  { n: 40, name: 'Self-Realization Fellowship Hermitage & Meditation Gardens', area: 'Encinitas', query: 'Self-Realization Fellowship Hermitage, Encinitas', angles: ['origin', 'people', 'sports'] },
  { n: 41, name: 'The Flower Fields', area: 'Carlsbad', query: 'The Flower Fields, Carlsbad', angles: ['origin', 'surroundings', 'recent'], coords: { lat: 33.1231, lng: -117.3176, source: 'manual pin — 5704 Paseo Del Norte, Carlsbad (Wikipedia coords, inside the OSM garden polygon; the v13 build geocoded it to 52.416,-1.971 in the UK)' } },
  { n: 42, name: 'Leo Carrillo Ranch Historic Park', area: 'Carlsbad', query: 'Leo Carrillo Ranch Historic Park, Carlsbad', angles: ['origin', 'people', 'building'] },
  { n: 43, name: 'Oceanside Pier', area: 'Oceanside', query: 'Oceanside Pier', angles: ['origin', 'building', 'event'] },
  { n: 44, name: 'Mission Bay Park', area: 'Mission Bay, San Diego', query: 'Mission Bay Park, San Diego', angles: ['origin', 'event', 'role'] },
  { n: 45, name: 'Belmont Park', area: 'Mission Beach, San Diego', query: 'Belmont Park, San Diego', angles: ['origin', 'building', 'event'] },
  { n: 46, name: 'Crystal Pier', area: 'Pacific Beach, San Diego', query: 'Crystal Pier, San Diego', angles: ['origin', 'building', 'recent'] },
  { n: 47, name: 'Georgia Street Bridge', area: 'North Park, San Diego', query: 'Georgia Street Bridge, San Diego', angles: ['origin', 'building', 'event'] },
  { n: 48, name: 'The Observatory North Park', area: 'North Park, San Diego', query: 'North Park Theatre, San Diego', angles: ['origin', 'music', 'building'] },
  { n: 49, name: 'Morley Field Sports Complex', area: 'North Park, San Diego', query: 'Morley Field, San Diego', angles: ['origin', 'sports', 'people'] },
  { n: 50, name: 'Presidio Park', area: 'Presidio, San Diego', query: 'Presidio Park, San Diego', angles: ['origin', 'event', 'building'] },
  // Round 2 / first addition (Oct 25, 2026): added the same night the
  // field test exposed the miss — Erik drove the length of it and Leo
  // told its tenants instead. THE place itself: the former Naval
  // Training Center, NRHP-listed as "Naval Training Station".
  { n: 51, name: 'Liberty Station', area: 'Point Loma, San Diego', query: 'Liberty Station, San Diego', angles: ['origin', 'event', 'people'], coords: { lat: 32.7393, lng: -117.2135, source: 'manual pin — 2640 Historic Decatur Rd (geocoders failed it under parallel load in the v13 build; it was skipped once — never again)' } },
  // Round 2 additions (coverage audit, Erik approved Oct 25, 2026).
  { n: 52, name: 'Petco Park', area: 'East Village, San Diego', query: 'Petco Park, San Diego', angles: ['origin', 'event', 'people'] },
  { n: 53, name: 'Marine Corps Recruit Depot San Diego', area: 'Midway, San Diego', query: 'Marine Corps Recruit Depot San Diego', angles: ['origin', 'event', 'people'] },
  { n: 54, name: 'SeaWorld San Diego', area: 'Mission Bay, San Diego', query: 'SeaWorld San Diego', angles: ['origin', 'event', 'recent'] },
  { n: 55, name: 'San Diego Zoo Safari Park', area: 'San Pasqual Valley, Escondido', query: 'San Diego Zoo Safari Park', angles: ['origin', 'people', 'surroundings'] },
  { n: 56, name: 'San Diego Convention Center', area: 'Downtown San Diego', query: 'San Diego Convention Center', angles: ['origin', 'event', 'cultural'] },
  { n: 57, name: 'Balboa Theatre', area: 'Downtown San Diego', query: 'Balboa Theatre, San Diego', angles: ['origin', 'building', 'music'] },
  { n: 58, name: 'Spreckels Theatre', area: 'Downtown San Diego', query: 'Spreckels Theatre, San Diego', angles: ['origin', 'building', 'people'] },
  { n: 59, name: 'San Diego State University', area: 'College Area, San Diego', query: 'San Diego State University', angles: ['origin', 'event', 'sports'] },
  { n: 60, name: 'LEGOLAND California', area: 'Carlsbad', query: 'LEGOLAND California, Carlsbad', angles: ['origin', 'event', 'recent'] },
  { n: 61, name: 'Berkeley Ferryboat', area: 'Embarcadero, San Diego', query: 'Berkeley ferryboat, Maritime Museum of San Diego', angles: ['origin', 'building', 'event'] },
  { n: 62, name: 'San Diego County Administration Center', area: 'Waterfront, San Diego', query: 'San Diego County Administration Center', angles: ['origin', 'building', 'event'], coords: { lat: 32.722161, lng: -117.172042, source: 'registry — County Administration Bldg. (local, verified), 1600 Pacific Hwy. AREA F re-pin R-2: the v13 corpus pin sits ~18 km south near the border; the served rows need the same re-pin (see major-coverage-audit.md §2D-D2)' } },
  { n: 63, name: 'Encinitas Boathouses', area: 'Encinitas', query: 'Encinitas Boathouses, Encinitas, CA', angles: ['origin', 'building', 'legends'] },
  { n: 64, name: 'Old Mission Dam', area: 'Mission Trails, San Diego', query: 'Old Mission Dam, San Diego', angles: ['origin', 'building', 'surroundings'] },
  { n: 65, name: 'Rancho Guajome Adobe', area: 'Vista', query: 'Rancho Guajome Adobe, Vista, CA', angles: ['origin', 'people', 'building'] },
  { n: 66, name: "Warner's Ranch", area: 'Warner Springs', query: "Warner's Ranch, Warner Springs, CA", angles: ['origin', 'event', 'people'] },
  { n: 67, name: 'Oak Grove Butterfield Stage Station', area: 'Oak Grove, California', query: 'Oak Grove Butterfield Stage Station, California', angles: ['origin', 'event', 'building'] },
  // Priority density anchors (coverage-density.md) — coordinates pinned
  // from that report so geocoding cannot resolve them elsewhere.
  { n: 68, name: 'University City', area: 'University City, San Diego', query: 'University City, San Diego', angles: ['origin', 'people', 'surroundings'], coords: { lat: 32.857, lng: -117.219, source: 'density-report anchor (University City / Rose Canyon)' } },
  { n: 69, name: 'Tecolote Canyon', area: 'Clairemont, San Diego', query: 'Tecolote Canyon, San Diego', angles: ['origin', 'surroundings', 'legends'], coords: { lat: 32.827, lng: -117.200, source: 'density-report anchor (Clairemont / Tecolote Canyon)' } },
  { n: 70, name: 'National City Santa Fe Depot', area: 'National City', query: 'National City Santa Fe Depot', angles: ['origin', 'building', 'event'], coords: { lat: 32.679, lng: -117.105, source: 'density-report anchor (National City depot / Brick Row) — distinct from the downtown Santa Fe Depot (#9)' } },
  // Rancho Peñasquitos starter cluster (second tester base, I-15 corridor).
  { n: 71, name: 'Los Peñasquitos Canyon Preserve', area: 'Rancho Peñasquitos, San Diego', query: 'Los Peñasquitos Canyon Preserve, San Diego', angles: ['origin', 'surroundings', 'people'], coords: { lat: 32.942, lng: -117.133, source: 'density-report anchor (east/Canyonside trailhead, Nominatim)' } },
  { n: 72, name: 'Rancho Santa María de los Peñasquitos', area: 'Rancho Peñasquitos, San Diego', query: 'Rancho Santa Maria de los Penasquitos adobe, San Diego', angles: ['origin', 'building', 'people'], coords: { lat: 32.940, lng: -117.184, source: 'density-report anchor (ranch house, preserve west end; approximate)' } },
  { n: 73, name: 'Black Mountain Open Space Park', area: 'Rancho Peñasquitos, San Diego', query: 'Black Mountain Open Space Park, San Diego', angles: ['origin', 'surroundings', 'legends'], coords: { lat: 32.982, lng: -117.106, source: 'density-report anchor (summit; approximate)' } },
  { n: 74, name: 'Bernardo Winery', area: 'Rancho Bernardo, San Diego', query: 'Bernardo Winery, Rancho Bernardo', angles: ['origin', 'people', 'cultural'], coords: { lat: 33.033, lng: -117.047, source: 'density-report anchor (Nominatim)' } },
  { n: 75, name: 'Lake Hodges', area: 'Escondido', query: 'Lake Hodges, Escondido', angles: ['origin', 'building', 'surroundings'], coords: { lat: 33.045, lng: -117.129, source: 'density-report anchor (Wikipedia)' } },
  { n: 76, name: 'Lake Miramar', area: 'Scripps Ranch, San Diego', query: 'Lake Miramar, San Diego', angles: ['origin', 'event', 'surroundings'], coords: { lat: 32.915, lng: -117.099, source: 'density-report anchor (Wikipedia)' } },
  { n: 77, name: 'Rancho Bernardo Inn', area: 'Rancho Bernardo, San Diego', query: 'Rancho Bernardo Inn, San Diego', angles: ['origin', 'people', 'recent'], coords: { lat: 33.031, lng: -117.067, source: 'density-report anchor (Nominatim)' } },
  // Locals' layer (locals-layer-candidates.md — Erik's curiosity class:
  // locally significant, registries miss them). Names use the subject
  // form the app itself would pick today where the living place differs
  // from the remembered one (Snapdragon Stadium, Pechanga Arena).
  { n: 78, name: 'Lane Field', area: 'Downtown San Diego', query: 'Lane Field, San Diego', angles: ['origin', 'sports', 'legends'] },
  { n: 79, name: 'Snapdragon Stadium', area: 'Mission Valley, San Diego', query: 'Snapdragon Stadium, San Diego', angles: ['origin', 'event', 'people'] },
  { n: 80, name: 'Horton Plaza', area: 'Downtown San Diego', query: 'Horton Plaza, San Diego', angles: ['origin', 'building', 'recent'] },
  { n: 81, name: 'SS Monte Carlo', area: 'Coronado', query: 'SS Monte Carlo shipwreck, Coronado', angles: ['origin', 'event', 'legends'] },
  { n: 82, name: 'The Mushroom House', area: "Black's Beach, La Jolla", query: 'Mushroom House, Blacks Beach, La Jolla', angles: ['origin', 'building', 'legends'] },
  { n: 83, name: 'Sunny Jim Cave', area: 'La Jolla, San Diego', query: 'Sunny Jim Cave, La Jolla', angles: ['origin', 'legends', 'people'] },
  { n: 84, name: "Hodad's", area: 'Ocean Beach, San Diego', query: "Hodad's, Ocean Beach, San Diego", angles: ['origin', 'cultural', 'people'] },
  { n: 85, name: 'El Indio', area: 'Mission Hills, San Diego', query: 'El Indio restaurant, San Diego', angles: ['origin', 'people', 'cultural'] },
  { n: 86, name: "Filippi's Pizza Grotto", area: 'Little Italy, San Diego', query: "Filippi's Pizza Grotto, San Diego", angles: ['origin', 'people', 'cultural'] },
  { n: 87, name: 'The Marine Room', area: 'La Jolla, San Diego', query: 'The Marine Room, La Jolla', angles: ['origin', 'building', 'recent'] },
  { n: 88, name: 'Waterfront Bar & Grill', area: 'Little Italy, San Diego', query: 'Waterfront Bar and Grill, San Diego', angles: ['origin', 'people', 'legends'] },
  { n: 89, name: 'The Casbah', area: 'Middletown, San Diego', query: 'The Casbah, San Diego', angles: ['origin', 'music', 'people'] },
  { n: 90, name: 'Belly Up', area: 'Solana Beach', query: 'Belly Up Tavern, Solana Beach, CA', angles: ['origin', 'music', 'event'], coords: { lat: 32.9898, lng: -117.2698, source: 'manual pin — 143 S Cedros Ave, Solana Beach (bare Nominatim resolves to Belly Up Aspen, Colorado)' } },
  { n: 91, name: 'Pechanga Arena', area: 'Midway District, San Diego', query: 'Pechanga Arena, San Diego', angles: ['origin', 'music', 'sports'] },
  { n: 92, name: 'Humphreys Concerts by the Bay', area: 'Shelter Island, San Diego', query: 'Humphreys Concerts by the Bay, San Diego', angles: ['origin', 'music', 'event'] },
  { n: 93, name: "Black's Beach", area: 'La Jolla, San Diego', query: "Black's Beach, San Diego", angles: ['origin', 'sports', 'legends'] },
  { n: 94, name: 'Tourmaline Surfing Park', area: 'Pacific Beach, San Diego', query: 'Tourmaline Surfing Park, San Diego', angles: ['origin', 'sports', 'cultural'] },
  { n: 95, name: 'Washington Street Skatepark', area: 'Hillcrest, San Diego', query: 'Washington Street Skatepark, San Diego', angles: ['origin', 'sports', 'legends'] },
  { n: 96, name: 'Linda Vista Skatepark', area: 'Linda Vista, San Diego', query: 'Linda Vista Skatepark, San Diego', angles: ['origin', 'sports', 'recent'] },
  { n: 97, name: 'Spruce Street Suspension Bridge', area: 'Bankers Hill, San Diego', query: 'Spruce Street Suspension Bridge, San Diego', angles: ['origin', 'building', 'legends'] },
  { n: 98, name: 'San Diego River', area: 'Mission Valley, San Diego', query: 'San Diego River, San Diego', angles: ['origin', 'event', 'surroundings'] },
  { n: 99, name: 'Vermont Street Bridge', area: 'Hillcrest, San Diego', query: 'Vermont Street Bridge, San Diego', angles: ['origin', 'building', 'event'] },
  { n: 100, name: 'Marine Corps Air Station Miramar', area: 'Miramar, San Diego', query: 'Marine Corps Air Station Miramar', angles: ['origin', 'event', 'role'] },
  { n: 101, name: 'San Pasqual Battlefield', area: 'San Pasqual Valley, Escondido', query: 'San Pasqual Battlefield State Historic Park', angles: ['origin', 'event', 'people'] },
  { n: 102, name: 'Ocean Beach', area: 'Ocean Beach, San Diego', query: 'Ocean Beach, San Diego', angles: ['origin', 'cultural', 'legends'] },
  { n: 103, name: 'Cardiff Kook', area: 'Cardiff-by-the-Sea', query: 'Cardiff Kook statue, Cardiff-by-the-Sea', angles: ['origin', 'legends', 'cultural'] },
  { n: 104, name: 'Hillcrest Sign', area: 'Hillcrest, San Diego', query: 'Hillcrest sign, San Diego', angles: ['origin', 'building', 'cultural'] },
  { n: 105, name: 'Fiesta Island', area: 'Mission Bay, San Diego', query: 'Fiesta Island, San Diego', angles: ['origin', 'sports', 'cultural'] },
  { n: 106, name: 'Unarius Academy', area: 'El Cajon', query: 'Unarius Academy, El Cajon', angles: ['origin', 'legends', 'people'], coords: { lat: 32.7956, lng: -116.9623, source: 'manual pin — 145 S Magnolia Ave, El Cajon (geocoders returned nothing in the v13 build)' } },
  { n: 107, name: 'Cowles Mountain', area: 'Mission Trails, San Diego', query: 'Cowles Mountain, San Diego', angles: ['origin', 'sports', 'surroundings'] },
  { n: 108, name: 'Potato Chip Rock', area: 'Poway', query: 'Potato Chip Rock, Mount Woodson, Poway', angles: ['origin', 'sports', 'recent'] },
  { n: 109, name: 'Galleta Meadows', area: 'Borrego Springs', query: 'Galleta Meadows sculptures, Borrego Springs', angles: ['origin', 'building', 'legends'] },
  { n: 110, name: 'Cedar Creek Falls', area: 'Ramona', query: 'Cedar Creek Falls, Ramona, CA', angles: ['origin', 'surroundings', 'event'] },
  { n: 111, name: 'La Mesa Secret Stairs', area: 'La Mesa', query: 'La Mesa secret stairs, La Mesa, CA', angles: ['origin', 'building', 'surroundings'] },
  { n: 112, name: 'Top Gun House', area: 'Oceanside', query: 'Top Gun House, Oceanside, CA', angles: ['origin', 'building', 'event'] },
  { n: 113, name: 'Pioneer Park', area: 'Mission Hills, San Diego', query: 'Pioneer Park, Mission Hills, San Diego', angles: ['origin', 'legends', 'event'] },
  { n: 114, name: 'Munchkin Houses', area: 'La Jolla, San Diego', query: 'Munchkin Houses, Hillside Drive, La Jolla', angles: ['origin', 'legends', 'building'] },
  { n: 115, name: 'Fallen Star', area: 'UC San Diego, La Jolla', query: 'Fallen Star, UC San Diego', angles: ['origin', 'building', 'cultural'] },
  // AREA F — major-coverage wiring (audit Oct 26, 2026;
  // ~/workspace/leos-world/major-coverage-audit.md §2E). Entries WITH a
  // coords block are pinned from the cited local source. Entries
  // WITHOUT one are UNVERIFIED-pin by design: the builder geocodes the
  // query and the pin gets an owner review before ingest — the §2D
  // defects (seven library places served on other continents) are what
  // unreviewed geocodes produce. NO corpus generation runs in the
  // Area F batch; these seeds activate at the next library build.
  { n: 116, name: 'Naval Base Point Loma', area: 'Point Loma, San Diego', query: 'Naval Base Point Loma, San Diego', angles: ['origin', 'event', 'role'] },
  { n: 117, name: 'Naval Base San Diego', area: 'San Diego Bay', query: 'Naval Base San Diego, 32nd Street', angles: ['origin', 'event', 'role'] },
  { n: 118, name: 'Fort Rosecrans', area: 'Point Loma, San Diego', query: 'Fort Rosecrans, Point Loma, San Diego', angles: ['origin', 'event', 'building'] },
  { n: 119, name: 'Seaport Village', area: 'Embarcadero, San Diego', query: 'Seaport Village, San Diego', angles: ['origin', 'event', 'recent'] },
  { n: 120, name: 'Unconditional Surrender Statue', area: 'Embarcadero, San Diego', query: 'Unconditional Surrender statue, Tuna Harbor Park, San Diego', angles: ['origin', 'event', 'people'] },
  { n: 121, name: 'Little Italy', area: 'Little Italy, San Diego', query: 'Little Italy, San Diego', angles: ['origin', 'event', 'cultural'] },
  { n: 122, name: 'University of San Diego', area: 'Linda Vista, San Diego', query: 'University of San Diego, Alcala Park', angles: ['origin', 'building', 'people'] },
  { n: 123, name: 'The Rady Shell at Jacobs Park', area: 'Embarcadero, San Diego', query: 'Rady Shell at Jacobs Park, San Diego', angles: ['origin', 'building', 'music'] },
  { n: 124, name: 'San Diego Central Library', area: 'East Village, San Diego', query: 'San Diego Central Library', angles: ['origin', 'building', 'recent'] },
  { n: 125, name: 'San Diego Museum of Art', area: 'Balboa Park, San Diego', query: 'San Diego Museum of Art, Balboa Park', angles: ['origin', 'building', 'people'] },
  { n: 126, name: 'San Diego Natural History Museum', area: 'Balboa Park, San Diego', query: 'San Diego Natural History Museum, Balboa Park', angles: ['origin', 'people', 'role'] },
  { n: 127, name: 'Fleet Science Center', area: 'Balboa Park, San Diego', query: 'Fleet Science Center, Balboa Park, San Diego', angles: ['origin', 'building', 'role'] },
  { n: 128, name: 'Old Globe Theatre', area: 'Balboa Park, San Diego', query: 'Old Globe Theatre, Balboa Park, San Diego', angles: ['origin', 'building', 'music'] },
  { n: 129, name: 'Camp Pendleton', area: 'Camp Pendleton, Oceanside', query: 'Marine Corps Base Camp Pendleton main gate', angles: ['origin', 'event', 'role'] },
  { n: 130, name: "Children's Pool", area: 'La Jolla, San Diego', query: "Children's Pool, La Jolla, San Diego", angles: ['origin', 'event', 'recent'] },
  { n: 131, name: 'Museum of Us', area: 'Balboa Park, San Diego', query: 'Museum of Us, California Tower, Balboa Park', angles: ['origin', 'building', 'people'], coords: { lat: 32.731769, lng: -117.152257, source: 'registry — California Quadrangle (national, verified), Balboa Park-El Prado Area' } },
  { n: 132, name: 'San Diego Air & Space Museum', area: 'Balboa Park, San Diego', query: 'San Diego Air & Space Museum, Ford Building, Balboa Park', angles: ['origin', 'building', 'event'], coords: { lat: 32.726122, lng: -117.154539, source: 'registry — Ford Building (national+local, verified), 2001 Pan American Pl' } },
  { n: 133, name: 'Pilot Boat', area: 'Embarcadero, San Diego', query: 'Pilot boat, Maritime Museum of San Diego', angles: ['origin', 'event', 'role'], coords: { lat: 32.7209, lng: -117.17348, source: 'registry — PILOT (Pilot Boat) (national, verified)' } },
  { n: 134, name: 'Cabrillo Ferry', area: 'Embarcadero, San Diego', query: 'Cabrillo ferry, Broadway Pier, San Diego', angles: ['origin', 'event', 'recent'], coords: { lat: 32.71546, lng: -117.17306, source: 'registry — CABRILLO (Ferry) (national, verified), Broadway Pier' } },
  { n: 135, name: 'PCF 816 Swift Boat', area: 'Embarcadero, San Diego', query: 'PCF 816 Swift boat, Maritime Museum of San Diego', angles: ['origin', 'event', 'people'], coords: { lat: 32.722778, lng: -117.178333, source: 'registry — PCF 816 (patrol craft fast) (national, verified)' } },
  { n: 136, name: 'Junipero Serra Museum', area: 'Presidio, San Diego', query: 'Junipero Serra Museum, Presidio Park, San Diego', angles: ['origin', 'building', 'people'], coords: { lat: 32.759609, lng: -117.193429, source: 'registry — Junipero Serra Museum (local, verified), 2727 Presidio Dr' } },
  { n: 137, name: 'The Lodge at Torrey Pines', area: 'Torrey Pines, La Jolla', query: 'The Lodge at Torrey Pines', angles: ['origin', 'building', 'sports'], coords: { lat: 32.92081, lng: -117.251775, source: 'registry — Torrey Pines Lodge (national, verified), 12201 Torrey Pines Park Rd' } },
  { n: 138, name: 'Torrey Pines Gliderport', area: 'Torrey Pines, La Jolla', query: 'Torrey Pines Gliderport, La Jolla', angles: ['origin', 'sports', 'surroundings'], coords: { lat: 32.88994, lng: -117.247084, source: 'registry — Torrey Pines Gliderport (national, APPROXIMATE grade — owner confirmation required, see audit §2C)' } },
  { n: 139, name: 'Scripps Institution of Oceanography', area: 'La Jolla Shores, San Diego', query: 'Scripps Institution of Oceanography, La Jolla', angles: ['origin', 'people', 'role'], coords: { lat: 32.852962, lng: -117.253837, source: 'registry — Scripps Memorial Marine Biological Laboratory (national, APPROXIMATE grade — owner confirmation required, see audit §2C)' } },

  // ---------------------------------------------------------------
  // Generation Batch 1 (Erik-approved Oct 27, 2026; manifest:
  // ~/workspace/leos-world/generation-batch-1.md — entry text there
  // governs). 20 places, 3 standard angles each, +2 people angles
  // (204 Peck LEADS, 203 Mickelson lead beat) = 62 stories, leo-v14.
  // `brief` rides every angle's prompt (portal line + flags verbatim);
  // `angleBriefs` rides one angle only. GROUND-SIZED marks the 8
  // sparse/remote places (sparseness-map bands): size the telling to
  // the crossing, up to ~4 min of speech, never padded.
  { n: 201, name: 'Naval Base Point Loma', area: 'Point Loma, San Diego', query: 'Ballast Point, Naval Base Point Loma, San Diego', angles: ['origin', 'event', 'surroundings'], coords: { lat: 32.68633, lng: -117.23278, source: 'generation-batch-1 A-1 — OSM Ballast Point Light node; historic-point serve anchor' },
    brief: "This place is a door into Exploration & the Founding: the whaling/fort point at the harbor mouth is where the bay's European story physically begins. Ground context: Cabrillo's 1542 landing ashore at La Playa/Ballast Point is core material here. ⚠ Sensitivity: ACTIVE BASE. Public history of the ground only — no current operations, no tenant detail beyond what Navy public affairs itself publishes, no security posture. The story ends at the fence line. GROUND-SIZED (thin country at the peninsula's end): this telling may run longer than standard, up to about four minutes of speech (~550 words), sized by the ground the listener is crossing; completeness over brevity, but never pad — every added sentence must carry sourced fact." },
  { n: 202, name: 'Naval Amphibious Base Coronado', area: 'Coronado, San Diego', query: 'Naval Amphibious Base Coronado history', angles: ['origin', 'event', 'role'], coords: { lat: 32.67547, lng: -117.16065, source: 'generation-batch-1 A-2 — Wikipedia; corroborated AroundUs + The Military Standard' },
    brief: "Ground context: this ground also belongs to the Navy's Century story of the bay. ⚠ Sensitivity: ACTIVE BASE. Public history only. BUD/S is a matter of extensive public record, but no training schedules, no course detail, nothing operational." },
  { n: 203, name: 'Torrey Pines Golf Course', area: 'Torrey Pines, La Jolla', query: 'Torrey Pines Golf Course, San Diego', angles: ['origin', 'sports', 'event', 'people'], coords: { lat: 32.9045, lng: -117.2454, source: 'generation-batch-1 A-3 — Wikipedia club point' },
    brief: "This place is a door into WWII's Transformation: the fairways are Camp Callan's parade ground; carry the camp the way sister entries carry their ghosts.",
    angleBriefs: { people: "Phil Mickelson is this angle's LEAD BEAT, not the lead: the courses are the subject, he is their most famous local — his hometown chapter (junior golf here, the hometown Opens) woven through the courses' own story. Living person — public-record career facts only." } },
  { n: 204, name: 'La Jolla Playhouse', area: 'La Jolla, San Diego', query: 'La Jolla Playhouse, UC San Diego', angles: ['origin', 'building', 'event', 'people'], wikiTitle: 'La Jolla Playhouse', coords: { lat: 32.87148, lng: -117.24107, source: 'generation-batch-1 A-4 — OSM theatre complex' },
    angleBriefs: { people: "This angle LEADS with the founders, Gregory Peck first: Peck is the lead of this story — the hometown boy who co-founded a theatre in 1947 and kept coming back to its stage — with Dorothy McGuire and Mel Ferrer folded in as supporting names. Public-record facts only." } },
  { n: 205, name: 'Cross Border Xpress', area: 'Otay Mesa, San Diego', query: 'Cross Border Xpress, San Diego Tijuana airport bridge', angles: ['origin', 'building', 'recent'], coords: { lat: 32.54832, lng: -116.97416, source: 'generation-batch-1 A-5 — OSM terminal' },
    brief: "This place is a door into The Border as a Living System: a bridge you walk from one country's check-in desk to another's runway — the metropolis thesis in one building. Treat Tijuana as a place with a story, not a backdrop. ⚠ Sensitivity: Border infrastructure — public, published facts only; nothing about enforcement operations, crossing procedures beyond the public passenger process, or wait-time specifics. GROUND-SIZED (thin country): this telling may run longer than standard, up to about four minutes of speech (~550 words), sized by the ground the listener is crossing; completeness over brevity, but never pad." },
  { n: 206, name: 'NASSCO', area: 'Barrio Logan, San Diego', query: 'NASSCO General Dynamics shipyard San Diego history', angles: ['origin', 'building', 'event'], wikiTitle: 'General Dynamics NASSCO', coords: { lat: 32.69093, lng: -117.13387, source: 'generation-batch-1 A-6 — OSM street-address point, 2798 E Harbor Dr' },
    brief: "Ground context: the working waterfront today, in the long harbor race with Los Angeles. ⚠ Sensitivity: Active industrial/defense site — public, published history only; nothing about current contracts or schedules." },
  { n: 207, name: 'San Diego Trolley', area: 'Downtown San Diego', query: 'San Diego Trolley history MTS', angles: ['origin', 'event', 'recent'], coords: { lat: 32.71648, lng: -117.16883, source: 'generation-batch-1 A-7 — OSM America Plaza station; system subject, downtown serve anchor' },
    brief: "System subject: this is the trolley as a whole — its lines, its 1981 bet, its border run — told from the downtown anchor outward. The anchor is where the telling starts, not the subject's extent." },
  { n: 208, name: "Font's Point", area: 'Anza-Borrego Desert State Park', query: "Font's Point, Anza-Borrego Desert State Park", angles: ['origin', 'surroundings', 'event'], wikiTitle: 'Anza-Borrego Desert State Park', coords: { lat: 33.30344, lng: -116.23908, source: 'generation-batch-1 A-8 — S-22 / Fonts Point Wash junction, triple-sourced serve anchor' },
    brief: "The serve anchor is the S-22 / Fonts Point Wash junction — where the driver actually is; the telling opens onto the point and the Borrego Badlands view from there. ⚠ Archaeological sites in the park are excluded entirely — no site locations, no site detail. GROUND-SIZED (remote desert): this telling may run longer than standard, up to about four minutes of speech (~550 words), sized by the ground the listener is crossing; completeness over brevity, but never pad." },
  { n: 209, name: 'Mission San Antonio de Pala', area: 'Pala, California', query: 'Mission San Antonio de Pala asistencia', angles: ['origin', 'building', 'people'], coords: { lat: 33.36549, lng: -117.07427, source: 'generation-batch-1 A-9 — OSM; mission published address' },
    brief: "This place is a door into The Mission System: the asistencia that never closed opens onto secularization and survival — the system told from its Indigenous end. Secularization is connective material for this telling. ⚠ Sensitivity: A LIVING tribal community and active church, not a ruin. Public, published history only; tell it as a guest. No ceremonial detail, no photography/recording norms invented, nothing from non-public tribal sources. GROUND-SIZED (thin country): this telling may run longer than standard, up to about four minutes of speech (~550 words), sized by the ground the listener is crossing; completeness over brevity, but never pad." },
  { n: 210, name: 'Balboa Stadium', area: 'Balboa Park, San Diego', query: 'Balboa Stadium, San Diego history', angles: ['origin', 'sports', 'event'], coords: { lat: 32.72071, lng: -117.15042, source: 'generation-batch-1 A-10 — OSM; 1405 Park Blvd' },
    brief: "Ground context: the fairs' venues still standing, and the city's stadium century — the in-between decades: AFL Chargers championships, the Beatles — between Lane Field and Petco Park. Sensitivity: Active school campus — the story is history; no event-day claims." },
  { n: 211, name: 'Kumeyaay-Ipai Interpretive Center', area: 'Poway, California', query: 'Kumeyaay-Ipai Interpretive Center, Pauwai, Poway', angles: ['origin', 'cultural', 'surroundings'], coords: { lat: 32.95404, lng: -117.05491, source: 'generation-batch-1 B-1 — OSM museum way; City of Poway listing agrees to the meter' },
    brief: "This place is a door into The Kumeyaay World: a village interpreted by its own partners opens onto the whole homeland; every later story in the county happens on its ground. Sensitivity: Public interpreted site, tribe-partnered — tell the site's own interpretation, from public materials only (City of Poway + the partnership's published materials are the spine); no ceremonial content exists in the public materials and none should be sought. GROUND-SIZED (thin inventory country): this telling may run longer than standard, up to about four minutes of speech (~550 words), sized by the ground the listener is crossing; completeness over brevity, but never pad." },
  { n: 212, name: "Roberto's Taco Shop", area: 'Morena, San Diego', query: "Roberto's Taco Shop, San Diego history California burrito", angles: ['origin', 'cultural', 'recent'], coords: { lat: 32.77476, lng: -117.20561, source: "generation-batch-1 B-2 — OSM way, Roberto's Taco Shop, Morena Blvd; system subject serve anchor" },
    brief: "System subject: the chain as a whole, told from one verified standing shop; the origin ground (the 1964 San Ysidro tortilleria, the first National City restaurant) is told, not pinned. Fact discipline: the California-burrito credit stays labeled as LORE — the claim is contested, with rival claims in print; tell it as lore, not fact. Ground context: the border system's food layer, both directions." },
  { n: 213, name: 'Kuchamaa', area: 'Tecate, San Diego County', query: 'Kuchamaa Tecate Peak sacred mountain Kumeyaay', angles: ['origin', 'surroundings', 'event'], coords: { lat: 32.57951, lng: -116.68881, source: 'generation-batch-1 B-3 — GNIS-imported OSM summit node for Tecate Peak (registry approximate district point deliberately NOT used)' },
    brief: "⚠⚠ The strongest flag in this batch. A living sacred place of a living people, currently being damaged in public view. Rules: public record only (the NRHP designation record, BLM's published description, 2026 preservation reporting); no ceremony detail beyond what federal and tribal-adjacent public statements themselves publish; no ritual instruction, no speculation about practice; the mountain presented as the Kumeyaay present it in public — a sacred, living landscape. GROUND-SIZED (remote border highlands): this telling may run longer than standard, up to about four minutes of speech (~550 words), sized by the ground the listener is crossing; completeness over brevity, but never pad." },
  { n: 214, name: 'Cerutti Mastodon Site', area: 'Otay Mesa, San Diego', query: 'Cerutti Mastodon site San Diego discovery', angles: ['origin', 'event', 'recent'], coords: { lat: 32.665944, lng: -117.053167, source: "generation-batch-1 B-4 — Wikipedia's published pair; corridor-approximate by the source's own disclosure" },
    brief: "Controversy framing is MANDATORY: the mastodon is fact; the date is published; the human claim is CONTESTED — bones and dates as published fact, the hominin interpretation attributed to the Deméré team, the skepticism attributed to the field. The argument itself is the story. The serve is the SR-54 corridor itself; sub-kilometer precision does not change the telling. GROUND-SIZED (thin country): this telling may run longer than standard, up to about four minutes of speech (~550 words), sized by the ground the listener is crossing; completeness over brevity, but never pad." },
  { n: 215, name: "Warwick's", area: 'La Jolla, San Diego', query: "Warwick's bookstore La Jolla history", angles: ['origin', 'people', 'recent'], coords: { lat: 32.84543, lng: -117.27432, source: 'generation-batch-1 B-5 — OSM bookshop node, 7812 Girard Ave' },
    brief: "Operating business — celebratory public history only." },
  { n: 216, name: 'SILVERGATE', area: 'San Diego Bay', query: 'Silvergate ferry San Diego historic vessel', angles: ['origin', 'building', 'event'], coords: { lat: 32.715172, lng: -117.173805, source: 'generation-batch-1 B-6 — NPS nomination form lat/lng, verbatim; registry pin identical' },
    brief: "Moving-subject disclosure: she alternates between two moorings (Fifth Avenue Landing and Broadway Pier, ~600 m apart) — the anchor is the nomination point, and the telling should present her as what she is, a vessel under way." },
  { n: 217, name: 'Silver Strand', area: 'Coronado, San Diego', query: 'Silver Strand Coronado Spanish Bight history', angles: ['origin', 'surroundings', 'event'], coords: { lat: 32.63417, lng: -117.17015, source: 'generation-batch-1 B-7 — OSM relation centroid, Silver Strand State Beach' },
    brief: "This place is a door into TWO arcs: The Navy's Century — the 1943 Spanish Bight fill is the arc as pure geography: the Navy didn't just use the land, it made some; and The Engineered Coast — the tombolo and the fill carry the arc's second act onto the bay proper. A corridor-shaped subject: the telling runs the strand, not a point. GROUND-SIZED (thin country along the strand): this telling may run longer than standard, up to about four minutes of speech (~550 words), sized by the ground the listener is crossing; completeness over brevity, but never pad." },
  { n: 218, name: 'Tivoli Bar & Grill', area: 'Gaslamp Quarter, San Diego', query: 'Tivoli Bar San Diego 1885 history Wyatt Earp', angles: ['origin', 'scandal', 'people'], coords: { lat: 32.71057, lng: -117.15892, source: 'generation-batch-1 B-8 — OSM bar way; 505 Sixth Ave' },
    brief: "Operating business — celebratory public history only. Wyatt Earp belongs inside this place's stories as a beat (he was a regular, holding court here) — he is woven through the angles, not a separate subject." },
  { n: 219, name: 'Downtown Mammoth', area: 'East Village, San Diego', query: 'Columbian mammoth excavation Thomas Jefferson School of Law San Diego 2009', angles: ['origin', 'event', 'surroundings'], coords: { lat: 32.71017, lng: -117.15421, source: 'generation-batch-1 B-9 — OSM way, Thomas Jefferson School of Law' },
    brief: "Fact discipline: the mammoth's age is told as a RANGE — 'hundreds of thousands of years' (published estimates run to ~500,000); never a single precise date." },
  { n: 220, name: 'Karl Strauss Brewing Company', area: 'Downtown San Diego', query: 'Karl Strauss Brewing Company 1989 first brewpub San Diego', angles: ['origin', 'recent', 'cultural'], coords: { lat: 32.7173, lng: -117.16728, source: 'generation-batch-1 B-10 — OSM address point, 1157 Columbia St' },
    brief: "The Columbia Street original — the 1989 'first brewpub since Prohibition' chapter of the city's beer story, told from this room." },
];

// Run order when the live-TTS daily cap forces prioritization: the I-5
// corridor first (Erik's test commute), then North Park, then list order.
export const CORRIDOR_ORDER = [13, 12, 3, 7, 8, 9, 10, 36, 5, 6, 38, 50, 44, 14, 15, 16, 17, 18, 19, 20, 39, 40, 41, 42, 43, 22];
export const NORTH_PARK_ORDER = [31, 47, 48, 49, 45, 46];
// Test-geography anchors next: corridor gap anchors + the Rancho
// Peñasquitos starter cluster (second tester base on the I-15 run).
export const TEST_GEO_ORDER = [68, 69, 70, 71, 72, 73, 74, 75, 76, 77];
