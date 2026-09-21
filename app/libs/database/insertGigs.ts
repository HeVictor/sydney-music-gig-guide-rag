import { Gig } from "@/app/types/gigTypes";
import {
  PrismaClient,
  ActRole,
  type Gig as PrismaGig,
  type GigAct,
  Prisma,
} from "@prisma/client";
import { fromZonedTime } from "date-fns-tz";

const SYDNEY_TZ = "Australia/Sydney";

const MONTH_NAMES = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

// Combines "14 August 2026" + "6:00pm" into the true UTC instant of that
// moment in Sydney. Two things matter here:
//  1. The date/time strings are parsed explicitly (not via `new Date(...)`,
//     whose handling of non-ISO strings like "14 August 2026" is
//     implementation-defined and can vary by host timezone).
//  2. The resulting wall-clock time is interpreted as Australia/Sydney via
//     date-fns-tz's `fromZonedTime`, which correctly accounts for AEST/AEDT
//     daylight saving rather than assuming a fixed UTC+10/+11 offset.
function parseGigDateTime(dateStr: string, timeStr: string): Date {
  const dateMatch = dateStr.trim().match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (!dateMatch) {
    throw new Error(`Could not parse date: "${dateStr}"`);
  }
  const [, dayStr, monthName, yearStr] = dateMatch;
  const monthIndex = MONTH_NAMES.indexOf(monthName.toLowerCase());
  if (monthIndex === -1) {
    throw new Error(`Unrecognised month in date: "${dateStr}"`);
  }

  const timeMatch = timeStr.trim().match(/^(\d{1,2}):(\d{2})\s*(am|pm)$/i);
  if (!timeMatch) {
    throw new Error(`Could not parse time: "${timeStr}"`);
  }
  const [, hourStr, minuteStr, meridiem] = timeMatch;
  let hour = parseInt(hourStr, 10) % 12;
  if (meridiem.toLowerCase() === "pm") hour += 12;

  const year = yearStr;
  const month = String(monthIndex + 1).padStart(2, "0");
  const day = dayStr.padStart(2, "0");
  const hh = String(hour).padStart(2, "0");
  const mm = minuteStr;

  // A naive wall-clock string with no timezone info — exactly what the
  // scraped text says, e.g. "2026-08-14T18:00:00". Not yet a real instant.
  const naiveLocal = `${year}-${month}-${day}T${hh}:${mm}:00`;

  return fromZonedTime(naiveLocal, SYDNEY_TZ);
}

const prisma = new PrismaClient();

/**
 * Inserts (or updates, on a repeat scrape) a batch of gigs, along with their
 * acts in the gig_acts table. Each gig runs as its own transaction so the
 * gig row and its acts never end up out of sync.
 */
export async function saveGigs(gigs: Gig[]): Promise<void> {
  if (gigs.length === 0) return;

  for (const g of gigs) {
    const gigDatetime = parseGigDateTime(g.date, g.time);

    await prisma.$transaction(async (tx) => {
      await tx.gig.upsert({
        where: { id: g.id },
        create: {
          id: g.id,
          gigDatetime,
          venue: g.venue,
          venueUrl: g.venueUrl,
          mainAct: g.mainAct,
          eventTitle: g.eventTitle,
          eventTitleSignalScore: g.eventTitleSignalScore,
          moreInfoUrl: g.moreInfoUrl,
          isFree: g.isFree,
        },
        // Every field except `id` is treated as mutable: the incoming
        // scrape is trusted as the current source of truth for a given gig
        // id, so datetime/venue/lineup-adjacent fields can all legitimately
        // change between scrapes (postponements, retitled events, etc).
        update: {
          gigDatetime,
          venue: g.venue,
          venueUrl: g.venueUrl,
          mainAct: g.mainAct,
          eventTitle: g.eventTitle,
          eventTitleSignalScore: g.eventTitleSignalScore,
          moreInfoUrl: g.moreInfoUrl,
          isFree: g.isFree,
        },
      });

      // Rebuild this gig's acts from scratch — simplest way to keep
      // gig_acts in sync with the scraped lineup on every re-run.
      await tx.gigAct.deleteMany({ where: { gigId: g.id } });

      if (g.lineup.length > 0) {
        await tx.gigAct.createMany({
          data: g.lineup.map((actName, position) => ({
            gigId: g.id,
            actName,
            role: actName === g.mainAct ? ActRole.main : ActRole.support,
            position,
          })),
        });
      }
    });
  }
}

type GigWithActs = PrismaGig & { acts: GigAct[] };

/** Reconstructs a full Gig object (including derived date/dayOfWeek/time,
 *  and lineup/supportingActs from the acts relation) from a Prisma row.
 *  gigDatetime is stored as a UTC instant, so every derived field here is
 *  explicitly formatted in Australia/Sydney — never the server's own
 *  timezone, which could differ (e.g. a UTC-default Docker container). */
function hydrateGig(row: GigWithActs): Gig {
  const dt = row.gigDatetime;

  return {
    id: row.id,
    date: dt.toLocaleDateString("en-AU", {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: SYDNEY_TZ,
    }),
    dayOfWeek: dt.toLocaleDateString("en-AU", {
      weekday: "long",
      timeZone: SYDNEY_TZ,
    }),
    time: dt
      .toLocaleTimeString("en-AU", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
        timeZone: SYDNEY_TZ,
      })
      .toLowerCase()
      .replace(" ", ""),
    venue: row.venue,
    venueUrl: row.venueUrl,
    mainAct: row.mainAct,
    eventTitle: row.eventTitle,
    eventTitleSignalScore: row.eventTitleSignalScore,
    supportingActs: row.acts
      .filter((a) => a.role === ActRole.support)
      .map((a) => a.actName),
    lineup: row.acts.map((a) => a.actName),
    moreInfoUrl: row.moreInfoUrl,
    isFree: row.isFree,
  };
}

export async function getGigs(): Promise<Gig[]> {
  const rows = await prisma.gig.findMany({
    orderBy: { gigDatetime: "asc" },
    include: { acts: { orderBy: { position: "asc" } } },
  });
  return rows.map(hydrateGig);
}

/** Gigs strictly after the given JS Date (e.g. "what's on later tonight"). */
export async function getGigsAfter(after: Date): Promise<Gig[]> {
  const rows = await prisma.gig.findMany({
    where: { gigDatetime: { gt: after } },
    orderBy: { gigDatetime: "asc" },
    include: { acts: { orderBy: { position: "asc" } } },
  });
  return rows.map(hydrateGig);
}

/** Gigs strictly before the given JS Date. */
export async function getGigsBefore(before: Date): Promise<Gig[]> {
  const rows = await prisma.gig.findMany({
    where: { gigDatetime: { lt: before } },
    orderBy: { gigDatetime: "asc" },
    include: { acts: { orderBy: { position: "asc" } } },
  });
  return rows.map(hydrateGig);
}

/** Every gig featuring a given act, whether as headliner or support. */
export async function getGigsByAct(actName: string): Promise<Gig[]> {
  const rows = await prisma.gig.findMany({
    where: { acts: { some: { actName } } },
    orderBy: { gigDatetime: "asc" },
    include: { acts: { orderBy: { position: "asc" } } },
  });
  return rows.map(hydrateGig);
}

/** Every gig featuring at least one act whose name is in the given array. */
export async function getGigsByAnyAct(actNames: string[]): Promise<Gig[]> {
  const rows = await prisma.gig.findMany({
    where: { acts: { some: { actName: { in: actNames } } } },
    orderBy: { gigDatetime: "asc" },
    include: { acts: { orderBy: { position: "asc" } } },
  });
  return rows.map(hydrateGig);
}

export async function getGigsBySuppliedWhereClause(
  whereClause: Prisma.GigWhereInput,
  limit: number,
): Promise<Gig[]> {
  const rows = await prisma.gig.findMany({
    where: whereClause,
    orderBy: { gigDatetime: "asc" },
    include: { acts: { orderBy: { position: "asc" } } },
    take: limit,
  });
  return rows.map(hydrateGig);
}

// Call this once your script is done issuing queries (e.g. at the end of a
// one-off scraper run). Without it, Prisma's open connection keeps Node's
// event loop alive and the process will hang instead of exiting.
export async function closePool(): Promise<void> {
  await prisma.$disconnect();
}

// Example usage:
// const gigs: Gig[] = await scrapeSydneyMusic();
// await saveGigs(gigs);
// const upcoming = await getGigsAfter(new Date());
// const bandGigs = await getGigsByAct("Georgia Mulligan");
