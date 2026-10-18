import { USER_AGENT, createRateLimiter } from "../utils/httpUtils";

// Wikimedia asks API clients to send a descriptive User-Agent and to make
// requests serially rather than in parallel; a short fixed gap keeps this
// well within that.
const wait = createRateLimiter(300);

async function wikimediaFetchJson<T>(url: string): Promise<T> {
  await wait();
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Wikimedia request failed (${response.status}): ${url}`);
  }
  return (await response.json()) as T;
}

/** Resolves a Wikidata ID (e.g. "Q12345") to the title of its English
 *  Wikipedia article, or null if the item has no English article. */
export async function getEnglishWikipediaTitleForWikidataId(
  wikidataId: string,
): Promise<string | null> {
  const url =
    `https://www.wikidata.org/w/api.php?action=wbgetentities` +
    `&ids=${encodeURIComponent(wikidataId)}&props=sitelinks&sitefilter=enwiki&format=json`;

  const data = await wikimediaFetchJson<{
    entities?: Record<string, { sitelinks?: { enwiki?: { title: string } } }>;
  }>(url);

  return data.entities?.[wikidataId]?.sitelinks?.enwiki?.title ?? null;
}

export interface WikipediaIntro {
  title: string;
  /** Plain-text lead section of the article. */
  extract: string;
  /** Stable link to the live article. */
  canonicalUrl: string;
  /** Link to the exact revision the text was taken from, when available —
   *  useful for CC BY-SA credit, since the history shows the authors. */
  permalinkUrl: string | null;
}

/** Fetches the lead section of an English Wikipedia article as plain text,
 *  along with the URLs needed to credit it. Returns null if the page is
 *  missing or has no text. Only the lead section is fetched (not the full
 *  article) — enough for a general "about this act" summary and much
 *  smaller to store and embed. */
export async function getWikipediaIntro(
  title: string,
): Promise<WikipediaIntro | null> {
  const url =
    `https://en.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&redirects=1` +
    `&prop=extracts%7Cinfo%7Crevisions&exintro=1&explaintext=1&inprop=url&rvprop=ids` +
    `&titles=${encodeURIComponent(title)}`;

  const data = await wikimediaFetchJson<{
    query?: {
      pages?: Array<{
        title: string;
        missing?: boolean;
        extract?: string;
        canonicalurl?: string;
        revisions?: Array<{ revid: number }>;
      }>;
    };
  }>(url);

  const page = data.query?.pages?.[0];
  if (!page || page.missing || !page.extract?.trim()) return null;

  const urlTitle = encodeURIComponent(page.title.replace(/ /g, "_"));
  const revisionId = page.revisions?.[0]?.revid;

  return {
    title: page.title,
    extract: page.extract.trim(),
    canonicalUrl:
      page.canonicalurl ?? `https://en.wikipedia.org/wiki/${urlTitle}`,
    permalinkUrl: revisionId
      ? `https://en.wikipedia.org/w/index.php?title=${urlTitle}&oldid=${revisionId}`
      : null,
  };
}

/** Reads an item's "genre" (P136) statements from Wikidata and returns
 *  their English labels, e.g. ["indie rock", "alternative rock"]. Skips
 *  deprecated statements and "unknown value"/"no value" entries. Wikidata's
 *  data is CC0. Uses two requests: one for the statements, one to turn the
 *  genre item IDs into readable labels. */
export async function getWikidataGenres(wikidataId: string): Promise<string[]> {
  const claimsUrl =
    `https://www.wikidata.org/w/api.php?action=wbgetclaims` +
    `&entity=${encodeURIComponent(wikidataId)}&property=P136&format=json`;

  const claimsData = await wikimediaFetchJson<{
    claims?: {
      P136?: Array<{
        rank?: string;
        mainsnak?: {
          snaktype?: string;
          datavalue?: { value?: { id?: string } };
        };
      }>;
    };
  }>(claimsUrl);

  const genreIds = Array.from(
    new Set(
      (claimsData.claims?.P136 ?? [])
        .filter(
          (claim) =>
            claim.rank !== "deprecated" && claim.mainsnak?.snaktype === "value",
        )
        .map((claim) => claim.mainsnak?.datavalue?.value?.id)
        .filter((id): id is string => Boolean(id)),
    ),
  ).slice(0, 50); // wbgetentities accepts at most 50 IDs per request

  if (genreIds.length === 0) return [];

  const labelsUrl =
    `https://www.wikidata.org/w/api.php?action=wbgetentities` +
    `&ids=${genreIds.map(encodeURIComponent).join("%7C")}&props=labels&languages=en&format=json`;

  const labelsData = await wikimediaFetchJson<{
    entities?: Record<string, { labels?: { en?: { value: string } } }>;
  }>(labelsUrl);

  return genreIds
    .map((id) => labelsData.entities?.[id]?.labels?.en?.value)
    .filter((label): label is string => Boolean(label));
}
