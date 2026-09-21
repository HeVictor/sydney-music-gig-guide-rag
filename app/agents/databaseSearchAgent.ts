import { z } from "zod";
import { Prisma } from "@prisma/client";
import { zodResponseFormat } from "openai/helpers/zod";
import { add } from "date-fns";
import { AgentAction } from "./agentTypes";
import { openaiClient } from "../libs/openai";
import { Gig } from "../types/gigTypes";
import { getGigsBySuppliedWhereClause } from "../libs/database/insertGigs";

const futureBoundSchema = z.object({
  amount: z.number(),
  unit: z.enum(["hours", "days", "weeks", "months", "years"]),
});

type FutureBound = z.infer<typeof futureBoundSchema>;

const DEFAULT_FUTURE_BOUND: FutureBound = {
  amount: 3,
  unit: "months",
};

const DEFAULT_LIMIT = 10;

// This schema describes exactly what the LLM must output — no Dates, no
// .transform(), no .default() acting as an effect. Zod v4's JSON Schema
// generation (used internally by zodResponseFormat) throws on any of those,
// since they change the output type in a way a static JSON Schema can't
// express. All normalization into the shape the rest of the app wants
// happens afterward, in normalizeSqlProps below — not in this schema.
const sqlSchema = z.object({
  gigDateTimeFrom: z.iso
    .datetime()
    .optional()
    .nullable()
    .describe("Earliest time when a gig can start, as a UTC ISO 8601 string"),
  gigDateTimeTo: z.iso
    .datetime()
    .optional()
    .nullable()
    .describe("Latest time a gig can start, as a UTC ISO 8601 string"),
  venues: z
    .array(z.string())
    .nullable()
    .describe(
      "Names of venues for the gig — matches a gig at any of the supplied venues",
    ),
  acts: z
    .array(z.string())
    .nullable()
    .describe("Names for acts as part of the gig"),
  isFree: z.boolean().optional().nullable().describe("Whether the gig is free"),
  limit: z
    .number()
    .optional()
    .nullable()
    .describe("The number of gigs to fetch matching the criteria"),
  futureBound: futureBoundSchema
    .optional()
    .nullable()
    .describe(
      "The period of time added to gigDateTimeFrom to form a range when a gig can start - only applicable when gigDateTimeFrom is set but gigDateTimeTo is not set",
    ),
});

// Raw shape as returned directly by OpenAI — dates are still strings,
// nothing has been defaulted yet.
type RawSqlProps = z.infer<typeof sqlSchema>;

// Normalized shape the rest of the app actually works with — real Dates,
// all optional fields resolved to a concrete value. This is built by hand
// in normalizeSqlProps rather than via Zod transforms/defaults, precisely
// so sqlSchema itself stays JSON-Schema-representable for the LLM call.
type SqlProps = {
  gigDateTimeFrom: Date | null;
  gigDateTimeTo: Date | null;
  venues: string[] | null;
  acts: string[] | null;
  isFree: boolean | null;
  limit: number;
  futureBound: FutureBound;
};

function normalizeSqlProps(raw: RawSqlProps): SqlProps {
  return {
    gigDateTimeFrom: raw.gigDateTimeFrom ? new Date(raw.gigDateTimeFrom) : null,
    gigDateTimeTo: raw.gigDateTimeTo ? new Date(raw.gigDateTimeTo) : null,
    venues: raw.venues ?? null,
    acts: raw.acts ?? null,
    isFree: raw.isFree ?? null,
    limit: raw.limit ?? DEFAULT_LIMIT,
    futureBound: raw.futureBound ?? DEFAULT_FUTURE_BOUND,
  };
}

const resolveParsedFutureBound = (futureBound: FutureBound): Date => {
  const now = new Date();
  return add(now, { [futureBound.unit]: futureBound.amount });
};

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Equivalence groups of interchangeable tokens for act-name matching, e.g.
 *  "Boyz II Men" / "Boyz 2 Men" / "Boyz to Men" / "Boyz two Men" all being
 *  the same band. Add more groups here if other ambiguous spellings come up
 *  later (each group only needs one direction — every member is treated as
 *  interchangeable with every other member). */
const ACT_NAME_EQUIVALENCE_GROUPS: string[][] = [["ii", "2", "to", "two"]];

/** Given a string and a group of interchangeable tokens, finds the first
 *  occurrence of any token from the group (whole-word, case-insensitive)
 *  and returns one variant of the input per alternative in the group. If no
 *  token from the group appears, returns the input unchanged as the only
 *  "variant". Only the first match is substituted — sufficient for the
 *  single-token-per-name cases this is built for. */
function applyGroupVariants(input: string, group: string[]): string[] {
  const pattern = new RegExp(
    `\\b(${group.map(escapeRegExp).join("|")})\\b`,
    "i",
  );
  const match = input.match(pattern);
  if (!match) return [input];

  const matchedToken = match[0];
  const index = match.index ?? 0;
  const before = input.slice(0, index);
  const after = input.slice(index + matchedToken.length);

  return group.map((alternative) => `${before}${alternative}${after}`);
}

/** Generates alternate spellings of a user-supplied act name to search for,
 *  beyond the literal string:
 *   - "&" <-> "and" normalization, since a user typing one form has no way
 *     to know which form the source site happens to use (e.g. "Belle and
 *     Sebastian" vs stored "Belle & Sebastian").
 *   - Numeral/word equivalence groups (see ACT_NAME_EQUIVALENCE_GROUPS),
 *     e.g. "Boyz II Men" / "Boyz 2 Men" / "Boyz to Men".
 *  Each variant is later matched via `contains`, so this doesn't need to
 *  handle case or partial-name matching itself — those are already covered
 *  by `contains` + MySQL's default case-insensitive collation. Returns
 *  deduplicated variants, always including the original (trimmed/
 *  whitespace-collapsed) input. */
function buildActNameSearchVariants(rawActName: string): string[] {
  const trimmed = rawActName.trim().replace(/\s+/g, " ");
  if (!trimmed) return [];

  let variants = new Set<string>([trimmed]);

  const ampersandToAnd = trimmed
    .replace(/\s*&\s*/g, " and ")
    .replace(/\s+/g, " ")
    .trim();
  const andToAmpersand = trimmed
    .replace(/\band\b/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
  variants.add(ampersandToAnd);
  variants.add(andToAmpersand);

  for (const group of ACT_NAME_EQUIVALENCE_GROUPS) {
    const expanded = new Set<string>();
    for (const variant of variants) {
      for (const withGroupVariant of applyGroupVariants(variant, group)) {
        expanded.add(withGroupVariant);
      }
    }
    variants = expanded;
  }

  return Array.from(variants);
}

const constructWhereClause = (sqlProps: SqlProps): Prisma.GigWhereInput => {
  const whereClause: Prisma.GigWhereInput = {};

  if (sqlProps.gigDateTimeFrom || sqlProps.gigDateTimeTo) {
    const now = new Date();

    const from = sqlProps.gigDateTimeFrom ?? now;
    const to =
      sqlProps.gigDateTimeTo ?? resolveParsedFutureBound(sqlProps.futureBound);

    whereClause.gigDatetime = { gte: from, lte: to };
  }

  if (sqlProps.venues && sqlProps.venues.length) {
    // Partial match per venue name, and matches if the gig is at any of the
    // supplied venues — same "any of N, substring not exact" approach as
    // acts below. This adds a top-level OR to the where clause; if another
    // top-level OR condition is ever needed alongside this, they'll need to
    // be merged into one OR array rather than each overwriting the other.
    whereClause.OR = sqlProps.venues.map((venueName) => ({
      venue: { contains: venueName.trim() },
    }));
  }

  if (sqlProps.acts && sqlProps.acts.length) {
    // Partial match per act name (and per &/and spelling variant), rather
    // than requiring an exact string match — e.g. a user-supplied "Georgia"
    // should match a stored actName of "Georgia Mulligan", and "Belle and
    // Sebastian" should match a stored "Belle & Sebastian". MySQL's default
    // collation is already case-insensitive, so no explicit `mode` is
    // needed (and Prisma's `mode: "insensitive"` filter isn't supported on
    // the mysql connector anyway — it only works on Postgres/MongoDB).
    whereClause.acts = {
      some: {
        OR: sqlProps.acts.flatMap((actName) =>
          buildActNameSearchVariants(actName).map((variant) => ({
            actName: { contains: variant },
          })),
        ),
      },
    };
  }

  if (sqlProps.isFree !== null && sqlProps.isFree !== undefined) {
    whereClause.isFree = sqlProps.isFree;
  }

  return whereClause;
};

/** Builds the "who's playing" portion of a gig's entry — the one piece that
 *  branches depending on whether the gig has a single headliner or is a
 *  themed night with no headliner distinction. Returns null for a gig whose
 *  eventTitle/mainAct combination doesn't match either expected shape, so
 *  the caller can skip it from the output rather than guess. */
function formatActs(gig: Gig): string | null {
  if (gig.eventTitle === null && gig.mainAct !== null) {
    // Ordinary headliner + support gig.
    return gig.supportingActs.length > 0
      ? `${gig.mainAct}, with support from ${gig.supportingActs.join(", ")}`
      : gig.mainAct;
  }

  if (gig.eventTitle !== null && gig.mainAct === null) {
    // Themed night — no headliner distinction, every act listed together.
    return gig.lineup.length > 0
      ? `${gig.eventTitle}: ${gig.lineup.join(", ")}`
      : gig.eventTitle;
  }

  // Neither expected shape — both null or both set. This shouldn't happen
  // given how eventTitle/mainAct are set upstream, so log it as a data bug
  // rather than silently guessing at how to display it.
  console.error(
    `Gig ${gig.id} has an unexpected eventTitle/mainAct combination — eventTitle: ${gig.eventTitle}, mainAct: ${gig.mainAct}`,
  );
  return null;
}

/** Formats a single Gig as one top-level bullet with indented detail lines
 *  underneath, e.g.:
 *
 *  - **Friday 14 August 2026, 6:00pm — Heaps Normal Health Club**
 *    - Joe Visser, with support from Georgia Mulligan
 *    - Free entry
 *    - More info: https://example.com
 *
 *  Returns null (and logs, via formatActs) for a gig with an unexpected
 *  eventTitle/mainAct combination, so it can be skipped from the output.
 */
function formatGig(gig: Gig): string | null {
  const actsLine = formatActs(gig);
  if (actsLine === null) {
    return null;
  }

  const heading = `**${gig.dayOfWeek} ${gig.date}, ${gig.time} — ${gig.venue}**`;

  const details: string[] = [actsLine];

  if (gig.isFree) {
    details.push("Free entry");
  }
  if (gig.moreInfoUrl) {
    details.push(`More info: ${gig.moreInfoUrl}`);
  }

  const detailLines = details.map((line) => `  - ${line}`).join("\n");
  return `- ${heading}\n${detailLines}`;
}

/** Formats an array of Gig objects into a single string ready to drop
 *  straight into a bullet list (e.g. a Markdown-rendered message), one
 *  top-level bullet per gig with its details as nested bullets underneath.
 *  Gigs with an unexpected eventTitle/mainAct combination are skipped
 *  (and logged as errors via formatActs) rather than shown malformed. */
function formatGigsAsBulletList(gigs: Gig[]): string {
  return gigs
    .map(formatGig)
    .filter((line): line is string => line !== null)
    .join("\n");
}

export const databaseSearchAgent = async (agentAction: AgentAction) => {
  const prompt = `
You specialise in extracting search parameters for looking up gigs in Sydney from the user query according to the structure output.

Unless the user specifically mentions a timezone or location in their query, ALWAYS assume that dates and times mentioned in their queries to be in the Sydney timezone.

For extracting the "gigDateTimeFrom" and "gigDateTimeTo" range from the query, output ISO 8601 datetime strings in UTC (ending in "Z"), correctly converted from the Sydney/AEST or AEDT time the user means — remember Sydney observes daylight saving, so the UTC offset is +10:00 in AEST (winter) and +11:00 in AEDT (summer).
Leave either as null if the query does not specify a date or time range.

If the user is asking for gigs on a certain date without specifying an upper bound on the start time, ensure "gigDateTimeTo" is set to no later than 11:59PM in AEST/AEDT.

For acts, add any acts mentioned in the query into the output array.

For venues, add any venue names mentioned into the output array — a query can mention more than one venue.
  `;

  const completion = await openaiClient.chat.completions.parse({
    model: "gpt-5.6-luna",
    messages: [
      {
        role: "system",
        content: prompt,
      },
      { role: "user", content: agentAction.originalQuery },
    ],
    response_format: zodResponseFormat(sqlSchema, "sqlSchema"),
  });

  const rawSqlProps = completion.choices[0].message.parsed;

  if (rawSqlProps === null) {
    return `Could not parse user query to SQL props. Refusal message: ${completion.choices[0].message.refusal}`;
  }

  const sqlProps = normalizeSqlProps(rawSqlProps);

  const whereClause = constructWhereClause(sqlProps);

  const gigs = await getGigsBySuppliedWhereClause(whereClause, sqlProps.limit);

  if (gigs.length === 0) {
    return "No gigs found matching your criteria.";
  }

  return formatGigsAsBulletList(gigs);
};
