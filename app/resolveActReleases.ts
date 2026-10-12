import { PrismaClient, ArtistMatchStatus } from "@prisma/client";
import {
  searchArtistByNameAndCountry,
  getReleaseGroupsForArtist,
} from "./libs/retrievers/musicBrainzClient";

const prisma = new PrismaClient();

// Below this MusicBrainz search relevance score (0-100), a result isn't
// treated as a confident match — better to record "unmatched" and skip it
// than to link a gig act to the wrong artist. This matters more now than
// when matching was AU-only: without a country hint to disambiguate,
// same-named artists from different countries are a real risk.
const MIN_MATCH_SCORE = 90;

// If the top two candidates' scores are within this many points of each
// other and no country hint was available to disambiguate, the match is
// logged as ambiguous (but the top-scoring candidate is still used — fully
// resolving name collisions automatically isn't feasible here).
const AMBIGUITY_SCORE_GAP = 5;

// Common country names/abbreviations as they tend to appear in scraped
// "(Country)" qualifiers, mapped to ISO 3166-1 alpha-2 codes. Not
// exhaustive — extend as new patterns show up in scraped data. Keys are
// matched case-insensitively.
const COUNTRY_HINT_TO_ISO: Record<string, string> = {
  usa: "US",
  us: "US",
  "united states": "US",
  "united states of america": "US",
  uk: "GB",
  "united kingdom": "GB",
  england: "GB",
  scotland: "GB",
  wales: "GB",
  "northern ireland": "GB",
  australia: "AU",
  aus: "AU",
  "new zealand": "NZ",
  nz: "NZ",
  canada: "CA",
  ireland: "IE",
  france: "FR",
  germany: "DE",
  sweden: "SE",
  norway: "NO",
  denmark: "DK",
  finland: "FI",
  netherlands: "NL",
  holland: "NL",
  belgium: "BE",
  spain: "ES",
  italy: "IT",
  japan: "JP",
  "south korea": "KR",
  korea: "KR",
  brazil: "BR",
  mexico: "MX",
  "south africa": "ZA",
  switzerland: "CH",
  austria: "AT",
  portugal: "PT",
  iceland: "IS",
  poland: "PL",
  india: "IN",
  china: "CN",
};

/** Strips trailing qualifiers scrapers commonly add that aren't part of the
 *  artist's actual name — e.g. "Ben Folds (USA)" or "Ben Folds (USA) [with
 *  the Sydney Symphony Orchestra]" both clean to "Ben Folds", which is what
 *  MusicBrainz's canonical name will actually match against. */
function cleanActNameForLookup(rawActName: string): string {
  return rawActName
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\s*\[[^\]]*\]\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Extracts a country hint from a raw scraped act name's first parenthetical
 *  group, e.g. "Ben Folds (USA)" -> { raw: "USA", isoCode: "US" }. Only
 *  returns a hint when the parenthetical text actually maps to a known
 *  country in COUNTRY_HINT_TO_ISO — a parenthetical like "(Live)" or
 *  "(Acoustic Set)" isn't a country, so it's correctly treated as no hint
 *  rather than stored as garbage. */
function extractCountryHint(
  rawActName: string,
): { raw: string; isoCode: string } | null {
  const match = rawActName.match(/\(([^)]+)\)/);
  if (!match) return null;

  const raw = match[1].trim();
  const isoCode = COUNTRY_HINT_TO_ISO[raw.toLowerCase()];
  return isoCode ? { raw, isoCode } : null;
}

/** Resolves one cleaned act name against MusicBrainz, storing the result
 *  (matched, unmatched, or left pending on error) in act_artist_links, and
 *  — on a confident match — upserting the artist and their release-groups.
 *  countryHint, when available, narrows the MusicBrainz search to that
 *  country — important since the same act name can belong to entirely
 *  different artists in different countries. */
async function resolveOneActName(
  cleanedActName: string,
  countryHint: { raw: string; isoCode: string } | null,
): Promise<void> {
  const candidates = await searchArtistByNameAndCountry(
    cleanedActName,
    countryHint?.isoCode ?? null,
  );
  const best = candidates[0];
  const runnerUp = candidates[1];

  if (
    !countryHint &&
    best &&
    runnerUp &&
    Math.abs(best.score - runnerUp.score) <= AMBIGUITY_SCORE_GAP
  ) {
    console.warn(
      `Ambiguous match for "${cleanedActName}" — no country hint, and top candidates are close in score: ` +
        `${best.name} (${best.country ?? "unknown"}, score ${best.score}) vs ` +
        `${runnerUp.name} (${runnerUp.country ?? "unknown"}, score ${runnerUp.score}). Using the top-scoring one.`,
    );
  }

  const countryHintFields = {
    countryHint: countryHint?.raw ?? null,
    countryHintCode: countryHint?.isoCode ?? null,
  };

  if (!best || best.score < MIN_MATCH_SCORE) {
    await prisma.actArtistLink.upsert({
      where: { cleanedActName },
      create: {
        cleanedActName,
        status: ArtistMatchStatus.unmatched,
        matchScore: best?.score ?? null,
        lastCheckedAt: new Date(),
        ...countryHintFields,
      },
      update: {
        status: ArtistMatchStatus.unmatched,
        matchScore: best?.score ?? null,
        lastCheckedAt: new Date(),
        ...countryHintFields,
      },
    });
    console.log(
      `No confident MusicBrainz match for "${cleanedActName}" (best score: ${best?.score ?? "n/a"})`,
    );
    return;
  }

  await prisma.musicArtist.upsert({
    where: { id: best.id },
    create: {
      id: best.id,
      name: best.name,
      country: best.country,
      disambiguation: best.disambiguation,
    },
    update: {
      name: best.name,
      country: best.country,
      disambiguation: best.disambiguation,
    },
  });

  await prisma.actArtistLink.upsert({
    where: { cleanedActName },
    create: {
      cleanedActName,
      artistId: best.id,
      status: ArtistMatchStatus.matched,
      matchScore: best.score,
      lastCheckedAt: new Date(),
      ...countryHintFields,
    },
    update: {
      artistId: best.id,
      status: ArtistMatchStatus.matched,
      matchScore: best.score,
      lastCheckedAt: new Date(),
      ...countryHintFields,
    },
  });

  const releaseGroups = await getReleaseGroupsForArtist(best.id);
  for (const rg of releaseGroups) {
    await prisma.musicRelease.upsert({
      where: { id: rg.id },
      create: {
        id: rg.id,
        artistId: best.id,
        title: rg.title,
        primaryType: rg.primaryType,
        firstReleaseDate: rg.firstReleaseDate,
      },
      update: {
        title: rg.title,
        primaryType: rg.primaryType,
        firstReleaseDate: rg.firstReleaseDate,
      },
    });
  }

  console.log(
    `Matched "${cleanedActName}" -> ${best.name} (${best.id}), ${releaseGroups.length} release(s)`,
  );
}

/** Re-fetches release-groups for every already-matched artist and upserts
 *  them — this is what actually keeps "latest releases" up to date over
 *  time, since resolveAllActReleases only ever processes a given act name
 *  once. Run this on its own periodic cadence (e.g. weekly/monthly),
 *  separately from resolving newly-scraped act names. */
export async function refreshReleasesForMatchedArtists(): Promise<void> {
  const artists = await prisma.musicArtist.findMany({
    select: { id: true, name: true },
  });
  console.log(`Refreshing releases for ${artists.length} known artist(s)`);

  for (const artist of artists) {
    try {
      const releaseGroups = await getReleaseGroupsForArtist(artist.id);
      for (const rg of releaseGroups) {
        await prisma.musicRelease.upsert({
          where: { id: rg.id },
          create: {
            id: rg.id,
            artistId: artist.id,
            title: rg.title,
            primaryType: rg.primaryType,
            firstReleaseDate: rg.firstReleaseDate,
          },
          update: {
            title: rg.title,
            primaryType: rg.primaryType,
            firstReleaseDate: rg.firstReleaseDate,
          },
        });
      }
      console.log(
        `Refreshed ${artist.name}: ${releaseGroups.length} release(s)`,
      );
    } catch (err) {
      // Leave this artist for the next scheduled refresh rather than
      // letting one API/network hiccup abort the whole run.
      console.error(`Error refreshing releases for "${artist.name}":`, err);
    }
  }
}

/** Resolves every distinct act name in gig_acts that hasn't already been
 *  checked against MusicBrainz — no longer restricted to any single
 *  country, since gig_acts now includes acts from anywhere. Safe to re-run
 *  — already-resolved (or already-checked-and-unmatched) names are skipped
 *  via act_artist_links. This only handles *new* act names; it does not
 *  refresh release lists for artists already matched on a previous run —
 *  see refreshReleasesForMatchedArtists for that. */
export async function resolveAllActReleases(): Promise<void> {
  const allGigActs = await prisma.gigAct.findMany({
    select: { actName: true, role: true },
  });

  // Group raw (actName, role) pairs by cleaned name, so a country hint can
  // be pulled from a main-role raw name even though the cleaned name is
  // what act_artist_links is keyed on.
  const rawEntriesByCleanedName = new Map<
    string,
    { rawActName: string; role: string }[]
  >();
  for (const gigAct of allGigActs) {
    const cleaned = cleanActNameForLookup(gigAct.actName);
    const entries = rawEntriesByCleanedName.get(cleaned) ?? [];
    entries.push({ rawActName: gigAct.actName, role: gigAct.role });
    rawEntriesByCleanedName.set(cleaned, entries);
  }

  const cleanedNames = Array.from(rawEntriesByCleanedName.keys());

  const alreadyChecked = await prisma.actArtistLink.findMany({
    where: { cleanedActName: { in: cleanedNames } },
    select: { cleanedActName: true },
  });
  const alreadyCheckedSet = new Set(
    alreadyChecked.map((a) => a.cleanedActName),
  );

  const toResolve = cleanedNames.filter((name) => !alreadyCheckedSet.has(name));
  console.log(
    `Resolving ${toResolve.length} of ${cleanedNames.length} distinct act names (rest already checked)`,
  );

  for (const cleanedActName of toResolve) {
    // Country hints (scraped as e.g. "(USA)") show up specifically on
    // headliner text in practice, so only main-role raw names are checked.
    const mainRoleRawNames = rawEntriesByCleanedName
      .get(cleanedActName)!
      .filter((entry) => entry.role === "main")
      .map((entry) => entry.rawActName);

    let countryHint: { raw: string; isoCode: string } | null = null;
    for (const rawName of mainRoleRawNames) {
      countryHint = extractCountryHint(rawName);
      if (countryHint) break;
    }

    try {
      await resolveOneActName(cleanedActName, countryHint);
    } catch (err) {
      // Leave unresolved names for a future run rather than recording a
      // false "unmatched" — a network/API error isn't the same as
      // MusicBrainz genuinely having no match.
      console.error(`Error resolving "${cleanedActName}":`, err);
    }
  }
}

// Run both passes: pick up any newly-scraped act names first, then refresh
// release lists for everything already matched (including acts just
// resolved above) so this script alone is a complete "get me the latest
// data" entry point for a scheduled/periodic run.
async function runFullSync(): Promise<void> {
  await resolveAllActReleases();
  await refreshReleasesForMatchedArtists();
}

runFullSync()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
