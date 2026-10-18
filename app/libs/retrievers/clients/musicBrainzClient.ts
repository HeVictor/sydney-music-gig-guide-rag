// A thin, rate-limited client for the MusicBrainz API (https://musicbrainz.org/doc/MusicBrainz_API).
//
// MusicBrainz's terms require:
//   - No more than ~1 request/second per IP (see musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting).
//   - A meaningful User-Agent identifying the app and a contact point, so
//     they can reach out if something misbehaves — an "anonymous" UA gets
//     throttled harder. The UA lives in httpUtils.ts (edit it there).
import { USER_AGENT } from "../utils/httpUtils";

const API_ROOT = "https://musicbrainz.org/ws/2";
const MIN_REQUEST_INTERVAL_MS = 1100; // slightly over 1s, to stay safely under the limit

let lastRequestAt = 0;

async function rateLimitedFetch(url: string): Promise<Response> {
  const now = Date.now();
  const elapsed = now - lastRequestAt;
  if (elapsed < MIN_REQUEST_INTERVAL_MS) {
    await new Promise((resolve) =>
      setTimeout(resolve, MIN_REQUEST_INTERVAL_MS - elapsed),
    );
  }
  lastRequestAt = Date.now();

  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
  });

  if (response.status === 503) {
    // Rate-limited despite our pacing (e.g. shared IP, or a burst). Honour
    // Retry-After if present, otherwise back off a fixed amount, then retry
    // once — MusicBrainz's own docs note 503 carries no detail beyond the
    // header, so a single bounded retry is the pragmatic approach.
    const retryAfterSeconds = Number(response.headers.get("retry-after")) || 2;
    await new Promise((resolve) =>
      setTimeout(resolve, retryAfterSeconds * 1000),
    );
    return rateLimitedFetch(url);
  }

  return response;
}

export interface MusicBrainzArtistSearchResult {
  id: string; // MBID
  name: string;
  country: string | null;
  disambiguation: string | null;
  score: number; // 0-100 relevance score from MusicBrainz's search ranking
}

/** Searches for an artist by name, optionally restricted to a given country
 *  (ISO 3166-1 alpha-2, e.g. "US"). When countryCode is null, searches by
 *  name alone — useful when no country hint could be extracted, though this
 *  is inherently riskier when multiple same-named artists exist across
 *  countries. Returns candidates ordered by MusicBrainz's own relevance
 *  score, most likely match first. */
export async function searchArtistByNameAndCountry(
  name: string,
  countryCode: string | null,
): Promise<MusicBrainzArtistSearchResult[]> {
  // Lucene query syntax: exact-ish name match, optionally restricted to the country field.
  const escapedName = name.replace(/"/g, '\\"');
  const query = countryCode
    ? `artist:"${escapedName}" AND country:${countryCode}`
    : `artist:"${escapedName}"`;
  const url = `${API_ROOT}/artist/?query=${encodeURIComponent(query)}&fmt=json&limit=5`;

  const response = await rateLimitedFetch(url);
  if (!response.ok) {
    throw new Error(
      `MusicBrainz artist search failed (${response.status}): ${name}`,
    );
  }

  const data = (await response.json()) as {
    artists: Array<{
      id: string;
      name: string;
      country?: string;
      disambiguation?: string;
      score: number;
    }>;
  };

  return data.artists.map((a) => ({
    id: a.id,
    name: a.name,
    country: a.country ?? null,
    disambiguation: a.disambiguation || null,
    score: a.score,
  }));
}

export interface MusicBrainzReleaseGroup {
  id: string; // MBID
  title: string;
  primaryType: string | null;
  firstReleaseDate: string | null;
}

/** Fetches every release-group (album/EP/single/etc.) for a given artist
 *  MBID, paginating through MusicBrainz's 100-per-page limit. */
export async function getReleaseGroupsForArtist(
  artistMbid: string,
): Promise<MusicBrainzReleaseGroup[]> {
  const releaseGroups: MusicBrainzReleaseGroup[] = [];
  let offset = 0;
  const pageSize = 100;

  while (true) {
    const url = `${API_ROOT}/release-group/?artist=${artistMbid}&fmt=json&limit=${pageSize}&offset=${offset}`;
    const response = await rateLimitedFetch(url);
    if (!response.ok) {
      throw new Error(
        `MusicBrainz release-group lookup failed (${response.status}): ${artistMbid}`,
      );
    }

    const data = (await response.json()) as {
      "release-group-count": number;
      "release-groups": Array<{
        id: string;
        title: string;
        "primary-type"?: string;
        "first-release-date"?: string;
      }>;
    };

    for (const rg of data["release-groups"]) {
      releaseGroups.push({
        id: rg.id,
        title: rg.title,
        primaryType: rg["primary-type"] ?? null,
        firstReleaseDate: rg["first-release-date"] || null,
      });
    }

    offset += pageSize;
    if (offset >= data["release-group-count"]) break;
  }

  return releaseGroups;
}

export interface MusicBrainzArtistLinks {
  wikidataId: string | null; // e.g. "Q12345"
  wikipediaTitle: string | null; // English Wikipedia title, only when MusicBrainz has a direct (older-style) Wikipedia link
  officialWebsite: string | null;
}

/** Looks up an artist's external links (url relationships) by MBID. Most
 *  artists with a Wikipedia page are linked via Wikidata rather than a
 *  direct Wikipedia link, so wikidataId is the primary path; wikipediaTitle
 *  is a fallback for older entries that still carry a direct link. */
export async function getArtistExternalLinks(
  artistMbid: string,
): Promise<MusicBrainzArtistLinks> {
  const url = `${API_ROOT}/artist/${artistMbid}?inc=url-rels&fmt=json`;

  const response = await rateLimitedFetch(url);
  if (!response.ok) {
    throw new Error(
      `MusicBrainz artist link lookup failed (${response.status}): ${artistMbid}`,
    );
  }

  const data = (await response.json()) as {
    relations?: Array<{ type: string; url?: { resource: string } }>;
  };

  let wikidataId: string | null = null;
  let wikipediaTitle: string | null = null;
  let officialWebsite: string | null = null;

  for (const relation of data.relations ?? []) {
    const resource = relation.url?.resource;
    if (!resource) continue;

    if (relation.type === "wikidata") {
      const match = resource.match(/\/(Q\d+)\/?$/);
      if (match) wikidataId = match[1];
    } else if (relation.type === "wikipedia") {
      const match = resource.match(
        /^https?:\/\/en\.wikipedia\.org\/wiki\/(.+)$/,
      );
      if (match) {
        try {
          wikipediaTitle = decodeURIComponent(match[1]).replace(/_/g, " ");
        } catch {
          // Malformed percent-encoding in the stored link — skip it rather than fail the whole lookup.
        }
      }
    } else if (relation.type === "official homepage" && !officialWebsite) {
      officialWebsite = resource;
    }
  }

  return { wikidataId, wikipediaTitle, officialWebsite };
}
