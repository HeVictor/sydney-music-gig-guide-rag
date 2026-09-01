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
  /** Raw score (0-3) from eventTitleSignalCount, kept on every gig so you can
   *  query at whatever threshold suits you later - not just the >=2 cutoff
   *  parseGigs already auto-resolves. 0 for ordinary confident headliners;
   *  score is frozen from the mainAct text at parse time, so it stays
   *  meaningful even after mainAct/eventTitle are later changed by an
   *  override (e.g. still 1 for a low-signal title an override resolved). */
  eventTitleSignalScore: number;
  supportingActs: string[];
  lineup: string[];
  moreInfoUrl: string | null;
  isFree: boolean;
}
