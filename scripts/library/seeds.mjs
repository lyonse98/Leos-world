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
  { n: 9, name: 'Santa Fe Depot', area: 'Downtown San Diego', query: 'Santa Fe Depot, San Diego', angles: ['origin', 'building', 'event'] },
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
];

// Run order when the live-TTS daily cap forces prioritization: the I-5
// corridor first (Erik's test commute), then North Park, then list order.
export const CORRIDOR_ORDER = [13, 12, 3, 7, 8, 9, 10, 36, 5, 6, 38, 50, 44, 14, 15, 16, 17, 18, 19, 20, 39, 40, 41, 42, 43, 22];
export const NORTH_PARK_ORDER = [31, 47, 48, 49, 45, 46];
