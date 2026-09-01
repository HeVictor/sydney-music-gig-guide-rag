import { Gig } from "@/app/types/gigTypes";
import mysql from "mysql2/promise";

// Combines "14 August 2026" + "6:00pm" into a MySQL DATETIME string
// "2026-08-14 18:00:00".
function toMysqlDateTime(dateStr: string, timeStr: string): string {
  const datePart = new Date(dateStr);
  if (Number.isNaN(datePart.getTime())) {
    throw new Error(`Could not parse date: "${dateStr}"`);
  }

  const match = timeStr.trim().match(/^(\d{1,2}):(\d{2})\s*(am|pm)$/i);
  if (!match) {
    throw new Error(`Could not parse time: "${timeStr}"`);
  }
  let [, hourStr, minuteStr, meridiem] = match;
  let hour = parseInt(hourStr, 10) % 12;
  if (meridiem.toLowerCase() === "pm") hour += 12;
  const minute = parseInt(minuteStr, 10);

  const y = datePart.getFullYear();
  const m = String(datePart.getMonth() + 1).padStart(2, "0");
  const d = String(datePart.getDate()).padStart(2, "0");
  const hh = String(hour).padStart(2, "0");
  const mm = String(minute).padStart(2, "0");

  return `${y}-${m}-${d} ${hh}:${mm}:00`;
}

const pool = mysql.createPool({
  host: process.env.DB_HOST ?? "localhost",
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
});

/**
 * Inserts (or updates, on a repeat scrape) a batch of gigs, along with their
 * acts in the gig_acts join table. Runs as a transaction per gig so the gig
 * row and its acts never end up out of sync.
 */
export async function saveGigs(gigs: Gig[]): Promise<void> {
  if (gigs.length === 0) return;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    for (const g of gigs) {
      // Type says `id` is always a string, but this data comes from a
      // scrape, not a compiler-checked source — fail loudly rather than
      // silently generating a throwaway id that would orphan this gig
      // from any future re-scrape matching on the real one.
      if (!g.id) {
        throw new Error(`Gig is missing an id: ${g.venue} on ${g.date}`);
      }
      const id = g.id;
      const gigDatetime = toMysqlDateTime(g.date, g.time);

      // Every field except `id` is treated as mutable: the incoming scrape
      // is trusted as the current source of truth for a given gig id, so
      // datetime/venue/event_title/etc can all legitimately change between
      // scrapes (postponements, retitled events, venue changes, etc).
      // Because `id` alone is the identity key now, there's no risk of an
      // update colliding with a *different* gig's row.
      await conn.query(
        `INSERT INTO gigs
           (id, gig_datetime, venue, venue_url, main_act, event_title, event_title_signal_score, more_info_url, is_free)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           gig_datetime             = VALUES(gig_datetime),
           venue                    = VALUES(venue),
           venue_url                = VALUES(venue_url),
           main_act                 = VALUES(main_act),
           event_title              = VALUES(event_title),
           event_title_signal_score = VALUES(event_title_signal_score),
           more_info_url            = VALUES(more_info_url),
           is_free                  = VALUES(is_free)`,
        [
          id,
          gigDatetime,
          g.venue,
          g.venueUrl,
          g.mainAct,
          g.eventTitle,
          g.eventTitleSignalScore,
          g.moreInfoUrl,
          g.isFree,
        ],
      );

      // Rebuild this gig's acts from scratch — simplest way to keep
      // gig_acts in sync with the scraped lineup on every re-run.
      await conn.query(`DELETE FROM gig_acts WHERE gig_id = ?`, [id]);

      if (g.lineup.length > 0) {
        const actRows = g.lineup.map((actName, position) => [
          id,
          actName,
          actName === g.mainAct ? "main" : "support",
          position,
        ]);

        await conn.query(
          `INSERT INTO gig_acts (gig_id, act_name, role, position) VALUES ?`,
          [actRows],
        );
      }
    }

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/** Reconstructs full Gig objects (including derived date/dayOfWeek/time,
 *  and lineup/supportingActs pulled from gig_acts) for a set of gig rows. */
async function hydrateGigs(gigRows: mysql.RowDataPacket[]): Promise<Gig[]> {
  if (gigRows.length === 0) return [];

  const gigIds = gigRows.map((r) => r.id);
  const [actRows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT gig_id, act_name, role FROM gig_acts WHERE gig_id IN (?) ORDER BY gig_id, position`,
    [gigIds],
  );

  const actsByGig = new Map<string, mysql.RowDataPacket[]>();
  for (const row of actRows) {
    const list = actsByGig.get(row.gig_id) ?? [];
    list.push(row);
    actsByGig.set(row.gig_id, list);
  }

  return gigRows.map((r) => {
    const acts = actsByGig.get(r.id) ?? [];
    const dt: Date = r.gig_datetime;

    return {
      id: r.id,
      date: dt.toLocaleDateString("en-AU", {
        day: "numeric",
        month: "long",
        year: "numeric",
      }),
      dayOfWeek: dt.toLocaleDateString("en-AU", { weekday: "long" }),
      time: dt
        .toLocaleTimeString("en-AU", {
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
        })
        .toLowerCase()
        .replace(" ", ""),
      venue: r.venue,
      venueUrl: r.venue_url,
      mainAct: r.main_act,
      eventTitle: r.event_title,
      eventTitleSignalScore: r.event_title_signal_score,
      supportingActs: acts
        .filter((a) => a.role === "support")
        .map((a) => a.act_name),
      lineup: acts.map((a) => a.act_name),
      moreInfoUrl: r.more_info_url,
      isFree: !!r.is_free,
    };
  });
}

export async function getGigs(): Promise<Gig[]> {
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT * FROM gigs ORDER BY gig_datetime ASC`,
  );
  return hydrateGigs(rows);
}

/** Gigs strictly after the given JS Date (e.g. "what's on later tonight"). */
export async function getGigsAfter(after: Date): Promise<Gig[]> {
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT * FROM gigs WHERE gig_datetime > ? ORDER BY gig_datetime ASC`,
    [after],
  );
  return hydrateGigs(rows);
}

/** Gigs strictly before the given JS Date. */
export async function getGigsBefore(before: Date): Promise<Gig[]> {
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT * FROM gigs WHERE gig_datetime < ? ORDER BY gig_datetime ASC`,
    [before],
  );
  return hydrateGigs(rows);
}

/** Every gig featuring a given act, whether as headliner or support. */
export async function getGigsByAct(actName: string): Promise<Gig[]> {
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT g.*
     FROM gigs g
     JOIN gig_acts ga ON ga.gig_id = g.id
     WHERE ga.act_name = ?
     ORDER BY g.gig_datetime ASC`,
    [actName],
  );
  return hydrateGigs(rows);
}

// Call this once your script is done issuing queries (e.g. at the end of a
// one-off scraper run). Without it, the pool's open/idle connections keep
// Node's event loop alive and the process will hang instead of exiting.
export async function closePool(): Promise<void> {
  await pool.end();
}

// Example usage:
// const gigs: Gig[] = await scrapeSydneyMusic();
// await saveGigs(gigs);
// const upcoming = await getGigsAfter(new Date());
// const bandGigs = await getGigsByAct("Georgia Mulligan");
