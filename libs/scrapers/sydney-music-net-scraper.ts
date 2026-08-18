import axios from "axios";
import type { AxiosResponse } from "axios";
import * as cheerio from "cheerio";

export interface Gig {
  id: string | null;
  date: string; // e.g. "14 August 2026"
  dayOfWeek: string; // e.g. "Friday"
  time: string; // e.g. "6:00pm"
  venue: string; // e.g. "Heaps Normal Health Club"
  venueUrl: string | null;
  /** Headliner name, e.g. "Joe Visser". Null when an override has determined
   *  this gig has no single headliner - see eventTitle. */
  mainAct: string | null;
  /** Populated (via an override rule) when the gig is a themed night/show
   *  rather than a single headline act - e.g. "Icon Series #2". When set,
   *  mainAct is null and every performer lives in supportingActs/lineup with
   *  no headliner distinction. Null for ordinary headliner+support gigs. */
  eventTitle: string | null;
  supportingActs: string[]; // e.g. ["Georgia Mulligan"]
  /** All acts combined, in listed order: [mainAct, ...supportingActs] when
   *  there's a headliner, or just supportingActs when eventTitle is set.
   *  Use this when you don't want to rely on the headliner/support split. */
  lineup: string[];
  moreInfoUrl: string | null;
  isFree: boolean;
}

/**
 * An override rule lets you manually correct gigs the heuristic gets wrong,
 * or that you've identified by eye (e.g. a recurring series where the site
 * always drops the actual lineup under "supports").
 *
 * `test` matches against the *parsed* gig, after the automatic looksLikeEventTitle
 * heuristic has already run - so mainAct may already be null here.
 * `resolve` returns the fields to overwrite - only include what you want changed.
 *
 * Rules are cheap to write against recurring titles since those repeat week
 * to week, e.g.:
 *
 *   {
 *     test: (g) => /^Inner West Jazz Fest/i.test(g.eventTitle ?? g.mainAct ?? ""),
 *     resolve: (g) => ({ mainAct: null, eventTitle: g.eventTitle ?? g.mainAct }),
 *   }
 */
export interface GigOverrideRule {
  test: (gig: Gig) => boolean;
  resolve: (
    gig: Gig,
  ) => Partial<Pick<Gig, "mainAct" | "eventTitle" | "supportingActs">>;
}

/**
 * Heuristic-only signal for whether a headliner string looks like a show/event
 * title rather than an artist name. This is NOT reliable on its own - the
 * source HTML gives no explicit marker either way, so it's not part of the
 * parsed Gig shape. Use it to scan parsed gigs for candidates that need an
 * override rule (see knownSeriesOverrides below), not as ground truth. Known
 * false positive: names containing "w/" as a genuine collaboration credit
 * (e.g. "Dee Dee Bridgewater w/ Helen Sung").
 */
export function looksLikeEventTitle(
  mainAct: string,
  supportingActs: string[],
): boolean {
  const titleKeywords =
    /\b(festival|fest|series|takeover|launch|showcase|vol\.?\s?\d|week\s+(one|two|three|four|\d)|ep\.?\s?\d|presents?|night|edition)\b/i;
  const hasSeparator = /[:–—]/.test(mainAct); // colon, en dash, em dash
  const hasKeyword = titleKeywords.test(mainAct);
  const largeLineup = supportingActs.length >= 5;

  // Require at least two independent signals to reduce false positives like
  // "Dee Dee Bridgewater w/ Helen Sung" (matches nothing here) or a two-word
  // band name that happens to contain a dash.
  const signals = [hasSeparator, hasKeyword, largeLineup].filter(
    Boolean,
  ).length;

  return signals >= 2;
}

/**
 * Parses the SydneyMusic.net gig guide HTML into a structured list of gigs.
 *
 * Structure relied on:
 * - Each day's gigs are preceded by an <h3> containing
 *   `<span class="text-ruby">DayName</span> D Month YYYY`
 * - Gigs for that day live in the following `<div class="day">`
 * - Each gig is a `.eventcardhost` containing:
 *     .headliner        -> main act (or event title, see looksLikeEventTitle)
 *     .supports         -> "W/ Support One, Support Two" (optional)
 *     .time             -> e.g. "6:00pm"
 *     .venue            -> venue name + link (optional href)
 *
 * .headliner text is checked against looksLikeEventTitle automatically: when
 * it fires, mainAct is set to null, the original text moves to eventTitle,
 * and every performer (originally under "supports") lives in supportingActs
 * and lineup with equal billing. This is heuristic, not certain - manually
 * spot-check gigs with mainAct === null, and add override rules below for
 * anything misclassified either way.
 *
 * @param response Axios response from Sydney Music Net gigs page
 * @param overrides optional manual correction rules, applied in order after
 *   the automatic heuristic has already run on every gig
 */
export function parseGigs(
  response: AxiosResponse,
  overrides: GigOverrideRule[] = [],
): Gig[] {
  const $ = cheerio.load(response.data);
  const gigs: Gig[] = [];

  const dateHeaderSelector =
    "h3.font-serif.text-xl.lg\\:text-2xl.stretch.font-normal.mb-8.mt-8.uppercase.border-b.border-black";

  $(dateHeaderSelector).each((_, headerEl) => {
    const $header = $(headerEl);

    const dayOfWeek = $header.find("span.text-ruby").first().text().trim();
    // Full header text is "Friday 21 August 2026" - strip the day name off the front
    const fullHeaderText = $header.text().trim().replace(/\s+/g, " ");
    const date = fullHeaderText.replace(dayOfWeek, "").trim();

    // The gigs for this date live in the very next .day sibling
    const $dayContainer = $header.nextAll("div.day").first();
    if ($dayContainer.length === 0) return;

    $dayContainer.find(".eventcardhost").each((_, cardEl) => {
      const $card = $(cardEl);

      const id = $card.find("[data-gigid]").first().attr("data-gigid") ?? null;

      const mainActOrEventTitle = $card
        .find(".headliner")
        .first()
        .text()
        .trim();

      const supportsText = $card.find(".supports").first().text().trim();
      const supportingActs = supportsText
        ? supportsText
            .replace(/^W\/\s*/i, "")
            .split(",")
            .map((s) => s.trim().replace(/\s+/g, " "))
            .filter(Boolean)
        : [];

      const time = $card.find(".time").first().text().trim();

      const $venue = $card.find(".venue").first();
      const venue = $venue.text().trim();
      const venueUrl = $venue.attr("href") ?? null;

      const moreInfoUrl = $card.find(".moreinfo").first().attr("href") ?? null;

      const isFree =
        $card.find(".bg-pill").text().trim().toUpperCase() === "FREE";

      if (!mainActOrEventTitle || !venue) return; // skip anything malformed

      // Auto-detect themed nights/shows via heuristic: when it fires, there's
      // no real headliner, so null out mainAct and keep every act in
      // supportingActs/lineup, with the original text preserved as eventTitle.
      // This is a heuristic, not certain - manually inspect any gig with
      // mainAct === null later to confirm it was classified correctly, and
      // add an override rule below for anything it gets wrong either way.
      const isEventTitle = looksLikeEventTitle(
        mainActOrEventTitle,
        supportingActs,
      );

      let gig: Gig = {
        id,
        date,
        dayOfWeek,
        time,
        venue,
        venueUrl,
        mainAct: isEventTitle ? null : mainActOrEventTitle,
        eventTitle: isEventTitle ? mainActOrEventTitle : null,
        supportingActs,
        lineup: isEventTitle
          ? [...supportingActs]
          : [mainActOrEventTitle, ...supportingActs],
        moreInfoUrl,
        isFree,
      };

      for (const rule of overrides) {
        if (rule.test(gig)) {
          const patch = rule.resolve(gig);
          // `mainAct`/`eventTitle` may be explicitly patched to null, which is
          // different from "not touched" (undefined) - check for the key
          // rather than falsy-coalescing, so a deliberate null sticks.
          const patchedMainAct: string | null =
            "mainAct" in patch ? (patch.mainAct ?? null) : gig.mainAct;
          const patchedSupports = patch.supportingActs ?? gig.supportingActs;
          gig = {
            ...gig,
            ...patch,
            mainAct: patchedMainAct,
            supportingActs: patchedSupports,
            lineup: patchedMainAct
              ? [patchedMainAct, ...patchedSupports]
              : [...patchedSupports],
          };
        }
      }

      gigs.push(gig);
    });
  });

  return gigs;
}

// --- Example overrides for cases the automatic heuristic gets wrong.
// "Icon Series #2" etc. are already caught automatically (keyword + large
// lineup), so no rule is needed for those. These rules cover genuine misses -
// e.g. plain hyphens are deliberately excluded from the heuristic's separator
// check (too many real band names contain one, like "T-Rex Autopsy"), so
// titles that rely on a hyphen instead of a colon/en-dash slip through.
// Extend this list as you spot more - matching on the title prefix means a
// fix made once keeps applying to future weeks of the same series.
export const knownSeriesOverrides: GigOverrideRule[] = [
  {
    // "Inner West Jazz Fest - Night 1/2/3" - multi-night festival, no single headliner
    test: (g) => /^Inner West Jazz Fest/i.test(g.mainAct ?? ""),
    resolve: (g) => ({ mainAct: null, eventTitle: g.mainAct }),
  },
  {
    // "Steel Assassins 2026 Day 1/2" - same pattern, different series
    test: (g) => /^Steel Assassins \d{4}/i.test(g.mainAct ?? ""),
    resolve: (g) => ({ mainAct: null, eventTitle: g.mainAct }),
  },
];

export async function scrapeSydneyMusicNetGigGigGuidePage(): Promise<
  Gig[] | null
> {
  const url = "https://sydneymusic.net/gig-guide";

  try {
    const response = await axios.get(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; Sydney-Music-Gig-Guide-RAG-Bot/1.0)",
      },
    });

    return parseGigs(response);
  } catch (error) {
    console.error(`Error scraping ${url}:`, error);
    return null;
  }
}

scrapeSydneyMusicNetGigGigGuidePage();
