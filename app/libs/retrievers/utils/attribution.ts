// Credit lines for each data source, built in one place so the text stored at
// ingestion time and the footer shown with RAG answers always agree.
//
// Notes on what each source asks for:
//  - Wikipedia text is CC BY-SA 4.0: credit the source, link to it, name the
//    licence, and (via the revision permalink / page history) let readers
//    find the authors. Share-alike means adaptations of the text, including
//    excerpts shown in answers, should stay under the same licence, so keep
//    the credit attached to anything derived from it.
//  - Last.fm asks for a credit/link where its data is shown, and its bio
//    text is user-contributed under CC BY-SA.
//  - MusicBrainz core data (artists, releases) is CC0, so no credit is
//    required, but a courtesy line is cheap and keeps the source visible.
//  - Wikidata (used for genre tags) is CC0 — likewise no credit required,
//    but a courtesy line is included whenever its genres were used.

export const MUSICBRAINZ_CREDIT =
  "Artist and release data from MusicBrainz (https://musicbrainz.org), released under CC0.";

export const WIKIPEDIA_LICENSE = "CC BY-SA 4.0";
export const LASTFM_LICENSE =
  "CC BY-SA (user-contributed text; additional terms may apply)";

export function buildWikipediaAttribution(
  title: string,
  canonicalUrl: string,
): string {
  return `Text from the Wikipedia article "${title}" (${canonicalUrl}), available under ${WIKIPEDIA_LICENSE}. See the page history for authors.`;
}

export function buildLastFmAttribution(artistUrl: string): string {
  return `Bio, tags and similar artists from Last.fm (${artistUrl}). Bio text is user-contributed and available under CC BY-SA; additional terms may apply.`;
}

export function buildWikidataAttribution(wikidataId: string): string {
  return `Genre data from Wikidata (https://www.wikidata.org/wiki/${wikidataId}), released under CC0.`;
}

/** Builds the "Sources" footer to append to a RAG answer that drew on an
 *  artist's stored data. Pass the artist's documents plus their lastFmUrl
 *  (set whenever Last.fm tags/similar artists were used, even if no Last.fm
 *  bio was stored). Pass wikidataId only when Wikidata genre tags were
 *  actually used in the answer — the artist's stored wikidataId alone
 *  doesn't mean any genres were found. Duplicate credits are collapsed. */
export function buildCreditsFooter(input: {
  documents: { attribution: string }[];
  lastFmUrl?: string | null;
  wikidataId?: string | null;
  includeMusicBrainz?: boolean;
}): string {
  const credits = new Set<string>(input.documents.map((d) => d.attribution));

  if (input.lastFmUrl) {
    credits.add(buildLastFmAttribution(input.lastFmUrl));
  }
  if (input.wikidataId) {
    credits.add(buildWikidataAttribution(input.wikidataId));
  }
  if (input.includeMusicBrainz ?? true) {
    credits.add(MUSICBRAINZ_CREDIT);
  }

  return [
    "Sources:",
    ...Array.from(credits).map((credit) => `- ${credit}`),
  ].join("\n");
}
