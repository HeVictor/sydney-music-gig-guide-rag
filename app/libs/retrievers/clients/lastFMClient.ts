import { USER_AGENT, createRateLimiter } from "../utils/httpUtils";

// Last.fm's API is free for non-commercial use with an API key (get one at
// https://www.last.fm/api/account/create). Set it as LASTFM_API_KEY.
// Last.fm's published guidance is roughly 5 requests/second; this paces
// well under that.
const API_ROOT = "https://ws.audioscrobbler.com/2.0/";
const wait = createRateLimiter(250);

export function assertLastFmApiKey(): string {
  const apiKey = process.env.LASTFM_API_KEY;
  if (!apiKey) {
    throw new Error(
      "LASTFM_API_KEY is not set. Create a free API account at https://www.last.fm/api/account/create",
    );
  }
  return apiKey;
}

/** Last.fm's JSON collapses single-item lists into a bare object instead of
 *  a one-element array — normalize both shapes to an array. */
function toArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

async function lastFmRequest<T>(
  params: Record<string, string>,
): Promise<T | null> {
  await wait();

  const search = new URLSearchParams({
    ...params,
    api_key: assertLastFmApiKey(),
    format: "json",
  });
  const response = await fetch(`${API_ROOT}?${search.toString()}`, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
  });

  // Last.fm reports errors as a JSON body (sometimes with a non-200 status),
  // so parse the body before deciding anything from the status code.
  const body = (await response.json().catch(() => null)) as {
    error?: number;
    message?: string;
  } | null;

  if (body && typeof body === "object" && body.error !== undefined) {
    if (body.error === 6) return null; // "The artist you supplied could not be found"
    throw new Error(
      `Last.fm error ${body.error}: ${body.message ?? "unknown error"}`,
    );
  }
  if (!response.ok) {
    throw new Error(
      `Last.fm request failed (${response.status}): ${params.method}`,
    );
  }

  return body as T;
}

// Last.fm bios arrive as HTML ending in a "Read more on Last.fm" link and a
// licence sentence. Both are stripped from the stored text — the credit and
// licence are recorded separately as attribution instead.
const LASTFM_LICENSE_SENTENCE =
  /User-contributed text is available under the Creative Commons By-SA License;?\s*additional terms may apply\.?/gi;

function cleanLastFmBio(raw: string): string | null {
  const text = raw
    .replace(/<a\b[^>]*>\s*Read more on Last\.fm\s*<\/a>\.?/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(LASTFM_LICENSE_SENTENCE, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();

  // Many small acts have an empty or one-line placeholder bio — not worth storing or embedding.
  return text.length >= 40 ? text : null;
}

export interface LastFmArtistInfo {
  name: string;
  url: string;
  /** Cleaned plain-text bio, or null when Last.fm has none worth keeping. */
  bio: string | null;
  tags: string[];
}

/** Looks up an artist on Last.fm by MusicBrainz ID. Deliberately MBID-only,
 *  with no fall-back to a name search: a name search can land on a
 *  different, same-named band, which is exactly the mix-up MBID matching
 *  exists to avoid. Returns null if Last.fm doesn't know that MBID. */
export async function getLastFmArtistInfo(
  mbid: string,
): Promise<LastFmArtistInfo | null> {
  const data = await lastFmRequest<{
    artist?: {
      name: string;
      url: string;
      bio?: { content?: string; summary?: string };
      tags?: { tag?: { name: string } | { name: string }[] };
    };
  }>({ method: "artist.getinfo", mbid, autocorrect: "0" });

  const artist = data?.artist;
  if (!artist) return null;

  const rawBio =
    artist.bio?.content?.trim() || artist.bio?.summary?.trim() || "";

  return {
    name: artist.name,
    url: artist.url,
    bio: rawBio ? cleanLastFmBio(rawBio) : null,
    tags: toArray(artist.tags?.tag).map((t) => t.name),
  };
}

export interface LastFmSimilarArtist {
  name: string;
  mbid: string | null;
  /** Similarity to the source artist, 0 to 1. */
  match: number;
}

export async function getLastFmSimilarArtists(
  mbid: string,
  limit = 10,
): Promise<LastFmSimilarArtist[]> {
  const data = await lastFmRequest<{
    similarartists?: {
      artist?:
        | { name: string; mbid?: string; match?: string }
        | { name: string; mbid?: string; match?: string }[];
    };
  }>({
    method: "artist.getsimilar",
    mbid,
    limit: String(limit),
    autocorrect: "0",
  });

  return toArray(data?.similarartists?.artist).map((a) => ({
    name: a.name,
    mbid: a.mbid || null,
    match: Number(a.match) || 0,
  }));
}
