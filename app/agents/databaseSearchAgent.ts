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

const sqlSchema = z.object({
  gigDateTimeFrom: z.coerce
    .date()
    .optional()
    .nullable()
    .describe("Earliest time when a gig can start"),
  gigDateTimeTo: z.coerce
    .date()
    .optional()
    .nullable()
    .describe("Latset time a gig can start"),
  venue: z
    .string()
    .optional()
    .nullable()
    .describe("Name of the venue for the gig"),
  acts: z
    .array(z.string())
    .nullable()
    .describe("Names for acts as part of the gig"),
  isFree: z.boolean().optional().nullable().describe("Whether the gig is free"),
  limit: z
    .number()
    .optional()
    .nullable()
    .default(10)
    .transform((v) => v ?? 10)
    .describe("The number of gigs to fetch matching the criteria"),
  futureBound: futureBoundSchema
    .optional()
    .nullable()
    .default(DEFAULT_FUTURE_BOUND)
    .transform((v) => v ?? DEFAULT_FUTURE_BOUND)
    .describe(
      "The period of time added to gigDateTimeFrom to form a range when a gig can start - only applicable when gigDateTimeFrom is set but gigDateTimeTo is not set",
    ),
});

type SqlProps = z.infer<typeof sqlSchema>;

const resolveParsedFutureBound = (
  futureBound: FutureBound | undefined | null,
): Date => {
  const now = new Date();

  if (!futureBound) return add(now, { months: 3 });
  return add(now, { [futureBound.unit]: futureBound.amount });
};

const constructWhereClause = (sqlProps: SqlProps): Prisma.GigWhereInput => {
  const whereClause: Prisma.GigWhereInput = {};

  if (sqlProps.gigDateTimeFrom || sqlProps.gigDateTimeTo) {
    const now = new Date();

    const from = sqlProps.gigDateTimeFrom ?? now;
    const to = resolveParsedFutureBound(sqlProps.futureBound);

    whereClause.gigDatetime = { gte: from, lte: to };
  }

  if (sqlProps.venue) {
    whereClause.venue = sqlProps.venue;
  }

  if (sqlProps.acts && sqlProps.acts.length) {
    whereClause.acts = {
      some: {
        actName: { in: sqlProps.acts },
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
 *  top-level bullet per gig with its details as nested bullets underneath. */
function formatGigsAsBulletList(gigs: Gig[]): string {
  return gigs.map(formatGig).join("\n");
}

export const databaseSearchAgent = async (agentAction: AgentAction) => {
  const prompt = `
You specialise in extracting search parameters for looking up gigs in Sydney from the user query according to the structure output.

For extracting the "gigDateTimeFrom" and "gigDateTimeTo" range from the query, convert the input into the AEST timezone equivalent for the Date objects.
Leave either as null if the query does not specify a date or time range.

For acts, add any acts mentioned in the query into the output array.
  `;

  const completion = await openaiClient.chat.completions.parse({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: prompt,
      },
      { role: "user", content: agentAction.originalQuery },
    ],
    response_format: zodResponseFormat(sqlSchema, "sqlSchema"),
  });

  const parsedSqlProps = completion.choices[0].message.parsed;

  if (parsedSqlProps === null) {
    return `Could not parse user query to SQL props. Refusal message: ${completion.choices[0].message.refusal}`;
  }

  const whereClause = constructWhereClause(parsedSqlProps);

  const gigs = await getGigsBySuppliedWhereClause(
    whereClause,
    parsedSqlProps.limit,
  );

  if (gigs.length === 0) {
    return "No gigs found matching your criteria.";
  }

  return formatGigsAsBulletList(gigs);
};
