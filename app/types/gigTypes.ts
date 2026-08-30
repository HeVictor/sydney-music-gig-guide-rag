export interface Gig {
  /** From the source site. Sole identity key for a gig — never null, no
   *  generated fallback. A re-scrape with the same id is always treated as
   *  an update to that exact gig, however much else about it has changed. */
  id: string;
  date: string; // e.g. "14 August 2026"
  dayOfWeek: string; // e.g. "Friday"
  time: string; // e.g. "6:00pm"
  venue: string; // e.g. "Heaps Normal Health Club"
  venueUrl: string | null;
  mainAct: string | null;
  eventTitle: string | null;
  supportingActs: string[];
  lineup: string[];
  moreInfoUrl: string | null;
  isFree: boolean;
}
