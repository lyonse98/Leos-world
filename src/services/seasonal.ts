// Seasonal topic awareness.
//
// Injects date-aware story directives into the Gemini prompt so Leo leans
// toward seasonally resonant material — haunting stories in October, holiday
// history in December, etc. The directive is a nudge, not a constraint: Leo
// should only surface seasonal material when the facts genuinely support it.

interface SeasonalDirective {
  season: string;
  hint: string;
}

function getSeasonalDirective(date = new Date()): SeasonalDirective | null {
  const month = date.getMonth() + 1;
  const day = date.getDate();

  // Late September through October 31 — haunting season.
  if (month === 9 && day >= 21) {
    return {
      season: 'autumn / haunting season',
      hint: 'It is early autumn, approaching Halloween. When a place has a genuine ghost story or dark chapter, you may lean toward that angle — but only if it is the most interesting story this place has. Do not force a Halloween angle onto places with no connection.'
    };
  }
  if (month === 10) {
    return {
      season: 'Halloween season',
      hint: 'It is October — Halloween season. When a place has a genuine ghost story or something eerie in its past, you may lean toward that angle. Do not prioritize haunting stories over more interesting local history — only surface the dark side when it is genuinely the most compelling story this place has. Do not invent supernatural elements. For places with no dark history, tell the normal story.'
    };
  }

  // November — Thanksgiving, indigenous history, harvest.
  if (month === 11) {
    return {
      season: 'November / harvest',
      hint: 'It is November, the harvest season and Thanksgiving in the US. When relevant, lean toward indigenous history of the area, the history of the land before European settlement, harvest traditions, agriculture, farming history, and stories of gratitude or its absence. For places connected to Native American history, this is an especially good time to surface that.',
    };
  }

  // December — Christmas, winter, year-end.
  if (month === 12) {
    return {
      season: 'winter / holidays',
      hint: 'It is December — the holiday season. When the facts support it, lean toward winter history, historic Christmas events, holiday traditions unique to this area, year-end disasters or celebrations, and how this place changed at year-end historically. Do not force holiday cheer onto places with no connection — but when a church, market, or public space has holiday history, surface it.',
    };
  }

  // January — new year, winter, fresh starts.
  if (month === 1) {
    return {
      season: 'winter / new year',
      hint: 'It is January, deep winter. Lean toward stories about winter hardships, blizzards, freezes, how this area handled historic winters, buildings that burned in winter, the founding dates of places (many things started in January), and stories of fresh starts or resolutions in local history.',
    };
  }

  // February — Black History Month, Valentine\'s Day.
  if (month === 2) {
    return {
      season: 'February',
      hint: 'It is February — Black History Month and Valentine\'s Day. When relevant, surface Black history connected to this area, civil rights events, historically Black neighborhoods, and love stories or scandals from local history. Prioritize these angles when the facts genuinely support them.',
    };
  }

  // March — Women\'s History Month, St. Patrick\'s Day.
  if (month === 3) {
    return {
      season: 'March',
      hint: 'It is March — Women\'s History Month and St. Patrick\'s Day. When relevant, surface stories about notable women from this area, women\'s contributions to local history, and Irish heritage, immigration, or St. Patrick\'s Day events connected to this place.',
    };
  }

  // April — spring, Easter.
  if (month === 4) {
    return {
      season: 'spring / Easter',
      hint: 'It is April — spring and Easter season. Lean toward stories of renewal, spring floods, planting, religious history of the area, churches and their founding, and how this place transformed in spring historically. For churches and places of worship, this is a good time to tell their founding story.',
    };
  }

  // May — Memorial Day, Asian Pacific Heritage, Military.
  if (month === 5) {
    return {
      season: 'May / Memorial Day',
      hint: 'It is May — Memorial Day approaches. Lean toward military history, war memorials, veterans\' stories, and Asian Pacific heritage when the facts support it. For cemeteries, monuments, and military sites, this is the time to tell their full story.',
    };
  }

  // June — Pride, Juneteenth, summer begins.
  if (month === 6) {
    return {
      season: 'June / summer',
      hint: 'It is June — Pride Month, Juneteenth, and the start of summer. Lean toward LGBTQ+ history of the area, emancipation and Black history, summer disasters or events, and the history of how this place celebrated or suffered in summer historically.',
    };
  }

  // July — Independence Day, heat of summer.
  if (month === 7) {
    return {
      season: 'July / Independence Day',
      hint: 'It is July — Independence Day and the heat of summer. Lean toward Revolutionary War history, founding of the city or area, historic July 4th celebrations, heat waves, summer riots or protests, and outdoor events that happened in this area historically.',
    };
  }

  // August — late summer, back to school.
  if (month === 8) {
    return {
      season: 'late summer',
      hint: 'It is August — late summer. Lean toward stories about schools and their history (back-to-school season), late summer events, hurricanes or storms, county fairs, and the social history of how this area spent the end of summer historically.',
    };
  }

  // Early September — Labor Day, 9/11, back to school.
  if (month === 9 && day < 21) {
    return {
      season: 'early fall',
      hint: 'It is September — Labor Day and early fall. Lean toward labor history, workers\' movements, factory history, 9/11 connections when relevant, and the transition from summer to fall in this area historically.',
    };
  }

  return null;
}

class SeasonalService {
  getDirective(date?: Date): SeasonalDirective | null {
    return getSeasonalDirective(date);
  }

  // Returns the hint text to inject into the prompt, or empty string.
  getPromptHint(date?: Date): string {
    const directive = this.getDirective(date);
    if (!directive) return '';
    return `SEASONAL AWARENESS — ${directive.season}: ${directive.hint}`;
  }
}

export const seasonal = new SeasonalService();
