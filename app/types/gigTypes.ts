export interface Gig {
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
