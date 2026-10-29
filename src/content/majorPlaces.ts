// Curated major places — DATA ONLY.
//
// Hand-verified majors that generic sources structurally miss or
// under-rank. Every coordinate is copied from a verified historic
// registry record (provenance in `source`); no pin here was invented
// or geocoded for this list. The shell's discovery layer consumes
// this table as candidates; `tier1` entries earn Tier-1 treatment
// (spec Q4) when they fold into a serve.

export interface MajorPlace {
  name: string;
  lat: number;
  lng: number;
  types: string[];
  historicalScore: number;
  tier1: boolean;
  source: string;
}

export const MAJOR_PLACES: MajorPlace[] = [
  {
    name: 'Museum of Us',
    lat: 32.731769,
    lng: -117.152257,
    types: ['museum', 'tourist_attraction'],
    historicalScore: 165,
    tier1: true,
    source: 'registry — California Quadrangle (national, verified)',
  },
  {
    name: 'San Diego Air & Space Museum',
    lat: 32.726122,
    lng: -117.154539,
    types: ['museum', 'tourist_attraction'],
    historicalScore: 160,
    tier1: true,
    source: 'registry — Ford Building (national+local, verified), 2001 Pan American Pl',
  },
  {
    name: 'Pilot Boat',
    lat: 32.7209,
    lng: -117.17348,
    types: ['museum', 'tourist_attraction'],
    historicalScore: 130,
    tier1: false,
    source: 'registry — PILOT (Pilot Boat) (national, verified)',
  },
  {
    name: 'Cabrillo Ferry',
    lat: 32.71546,
    lng: -117.17306,
    types: ['museum', 'tourist_attraction'],
    historicalScore: 130,
    tier1: false,
    source: 'registry — CABRILLO (Ferry) (national, verified), Broadway Pier',
  },
  {
    name: 'PCF 816 Swift Boat',
    lat: 32.722778,
    lng: -117.178333,
    types: ['museum', 'tourist_attraction'],
    historicalScore: 120,
    tier1: false,
    source: 'registry — PCF 816 (patrol craft fast) (national, verified)',
  },
  {
    name: 'Junipero Serra Museum',
    lat: 32.759609,
    lng: -117.193429,
    types: ['museum', 'tourist_attraction'],
    historicalScore: 135,
    tier1: false,
    source: 'registry — Junipero Serra Museum (local, verified), 2727 Presidio Dr',
  },
  {
    name: 'The Lodge at Torrey Pines',
    lat: 32.92081,
    lng: -117.251775,
    types: ['lodging', 'tourist_attraction'],
    historicalScore: 140,
    tier1: false,
    source: 'registry — Torrey Pines Lodge (national, verified), 12201 Torrey Pines Park Rd',
  },
];
