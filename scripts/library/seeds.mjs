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
  { n: 32, name: 'El Cortez Hotel', area: 'Downtown San Diego', query: 'El Cortez Hotel, San Diego', angles: ['origin', 'building', 'recent'] },
  { n: 33, name: 'Villa Montezuma', area: 'Sherman Heights, San Diego', query: 'Villa Montezuma, San Diego', angles: ['origin', 'legends', 'people'] },
  { n: 34, name: 'Friendship Park', area: 'San Diego–Tijuana border', query: 'Friendship Park, San Diego', angles: ['origin', 'event', 'recent'] },
  { n: 35, name: 'Fort Rosecrans National Cemetery', area: 'Point Loma, San Diego', query: 'Fort Rosecrans National Cemetery', angles: ['origin', 'people', 'surroundings'] },
  { n: 36, name: 'Kansas City Barbeque', area: 'East Village, San Diego', query: 'Kansas City Barbeque, San Diego', angles: ['origin', 'cultural', 'event'] },
  { n: 37, name: 'Mount Helix Park', area: 'La Mesa', query: 'Mount Helix Park, La Mesa', angles: ['origin', 'event', 'surroundings'] },
  { n: 38, name: 'Mormon Battalion Historic Site', area: 'Old Town, San Diego', query: 'Mormon Battalion Historic Site, San Diego', angles: ['origin', 'event', 'people'] },
  { n: 39, name: 'Del Mar Racetrack', area: 'Del Mar', query: 'Del Mar Racetrack', angles: ['origin', 'sports', 'people'] },
  { n: 40, name: 'Self-Realization Fellowship Hermitage & Meditation Gardens', area: 'Encinitas', query: 'Self-Realization Fellowship Hermitage, Encinitas', angles: ['origin', 'people', 'sports'] },
  { n: 41, name: 'The Flower Fields', area: 'Carlsbad', query: 'The Flower Fields, Carlsbad', angles: ['origin', 'surroundings', 'recent'] },
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
  { n: 51, name: 'Liberty Station', area: 'Point Loma, San Diego', query: 'Liberty Station, San Diego', angles: ['origin', 'event', 'people'] },
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
  { n: 62, name: 'San Diego County Administration Center', area: 'Waterfront, San Diego', query: 'San Diego County Administration Center', angles: ['origin', 'building', 'event'] },
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
  { n: 90, name: 'Belly Up', area: 'Solana Beach', query: 'Belly Up Tavern, Solana Beach', angles: ['origin', 'music', 'event'] },
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
  { n: 106, name: 'Unarius Academy', area: 'El Cajon', query: 'Unarius Academy, El Cajon', angles: ['origin', 'legends', 'people'] },
  { n: 107, name: 'Cowles Mountain', area: 'Mission Trails, San Diego', query: 'Cowles Mountain, San Diego', angles: ['origin', 'sports', 'surroundings'] },
  { n: 108, name: 'Potato Chip Rock', area: 'Poway', query: 'Potato Chip Rock, Mount Woodson, Poway', angles: ['origin', 'sports', 'recent'] },
  { n: 109, name: 'Galleta Meadows', area: 'Borrego Springs', query: 'Galleta Meadows sculptures, Borrego Springs', angles: ['origin', 'building', 'legends'] },
  { n: 110, name: 'Cedar Creek Falls', area: 'Ramona', query: 'Cedar Creek Falls, Ramona, CA', angles: ['origin', 'surroundings', 'event'] },
  { n: 111, name: 'La Mesa Secret Stairs', area: 'La Mesa', query: 'La Mesa secret stairs, La Mesa, CA', angles: ['origin', 'building', 'surroundings'] },
  { n: 112, name: 'Top Gun House', area: 'Oceanside', query: 'Top Gun House, Oceanside, CA', angles: ['origin', 'building', 'event'] },
  { n: 113, name: 'Pioneer Park', area: 'Mission Hills, San Diego', query: 'Pioneer Park, Mission Hills, San Diego', angles: ['origin', 'legends', 'event'] },
  { n: 114, name: 'Munchkin Houses', area: 'La Jolla, San Diego', query: 'Munchkin Houses, Hillside Drive, La Jolla', angles: ['origin', 'legends', 'building'] },
  { n: 115, name: 'Fallen Star', area: 'UC San Diego, La Jolla', query: 'Fallen Star, UC San Diego', angles: ['origin', 'building', 'cultural'] },
];

// Run order when the live-TTS daily cap forces prioritization: the I-5
// corridor first (Erik's test commute), then North Park, then list order.
export const CORRIDOR_ORDER = [13, 12, 3, 7, 8, 9, 10, 36, 5, 6, 38, 50, 44, 14, 15, 16, 17, 18, 19, 20, 39, 40, 41, 42, 43, 22];
export const NORTH_PARK_ORDER = [31, 47, 48, 49, 45, 46];
// Test-geography anchors next: corridor gap anchors + the Rancho
// Peñasquitos starter cluster (second tester base on the I-15 run).
export const TEST_GEO_ORDER = [68, 69, 70, 71, 72, 73, 74, 75, 76, 77];
