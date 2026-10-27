import { createHash } from "crypto";
import { PrismaClient, ArtistDataSource } from "@prisma/client";
import {
  getArtistExternalLinks,
  type MusicBrainzArtistLinks,
} from "./libs/retrievers/clients/musicBrainzClient";
import {
  getEnglishWikipediaTitleForWikidataId,
  getWikidataGenres,
  getWikipediaIntro,
} from "./libs/retrievers/clients/wikiClient";
import {
  assertLastFmApiKey,
  getLastFmArtistInfo,
  getLastFmSimilarArtists,
} from "./libs/retrievers/clients/lastFMClient";
import {
  buildLastFmAttribution,
  buildWikipediaAttribution,
  LASTFM_LICENSE,
  WIKIPEDIA_LICENSE,
} from "./libs/retrievers/utils/attribution";

const prisma = new PrismaClient();

// An artist already enriched within this window is skipped, so a scheduled
// run only re-fetches data that's plausibly changed (and stays polite to
// the APIs involved).
const REFRESH_AFTER_DAYS = 30;

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

async function upsertDocument(doc: {
  artistId: string;
  source: ArtistDataSource;
  title: string;
  text: string;
  sourceUrl: string;
  permalinkUrl: string | null;
  license: string;
  attribution: string;
}): Promise<void> {
  const data = {
    title: doc.title,
    text: doc.text,
    sourceUrl: doc.sourceUrl,
    permalinkUrl: doc.permalinkUrl,
    license: doc.license,
    attribution: doc.attribution,
    contentHash: sha256(doc.text),
    fetchedAt: new Date(),
  };

  await prisma.artistDocument.upsert({
    where: { artistId_source: { artistId: doc.artistId, source: doc.source } },
    create: { artistId: doc.artistId, source: doc.source, ...data },
    update: data,
  });
}

/** Wikipedia: Wikidata ID (or a direct link) from MusicBrainz -> English
 *  Wikipedia lead section. Going through MusicBrainz's own link for this
 *  exact artist (by MBID) means no name-based guessing, so a same-named
 *  band can't be mixed in. */
async function enrichFromWikipedia(
  artist: { id: string; name: string },
  links: MusicBrainzArtistLinks,
): Promise<void> {
  let title = links.wikipediaTitle;
  if (!title && links.wikidataId) {
    title = await getEnglishWikipediaTitleForWikidataId(links.wikidataId);
  }
  if (!title) return; // No Wikipedia article — expected for most small acts.

  const intro = await getWikipediaIntro(title);
  if (!intro) return;

  await upsertDocument({
    artistId: artist.id,
    source: ArtistDataSource.wikipedia,
    title: intro.title,
    text: intro.extract,
    sourceUrl: intro.canonicalUrl,
    permalinkUrl: intro.permalinkUrl,
    license: WIKIPEDIA_LICENSE,
    attribution: buildWikipediaAttribution(intro.title, intro.canonicalUrl),
  });
  console.log(`  Wikipedia: stored "${intro.title}"`);
}

/** Wikidata genres (P136) as tags. Uses the Wikidata item MusicBrainz
 *  links for this exact artist, and works even when the artist has no
 *  English Wikipedia article. Tags are replaced on every run (including
 *  cleared when there's no Wikidata link any more), so removed genres don't
 *  linger. */
async function enrichFromWikidataGenres(
  artist: { id: string; name: string },
  wikidataId: string | null,
): Promise<void> {
  const genres = wikidataId ? await getWikidataGenres(wikidataId) : [];

  // Dedupe case-insensitively — the column's collation treats "Indie rock"
  // and "indie rock" as the same key, which would otherwise error.
  const uniqueGenres = Array.from(
    new Map(genres.map((g) => [g.toLowerCase(), g.slice(0, 100)])).values(),
  );

  await prisma.$transaction([
    prisma.artistTag.deleteMany({
      where: { artistId: artist.id, source: ArtistDataSource.wikidata },
    }),
    prisma.artistTag.createMany({
      data: uniqueGenres.map((name) => ({
        artistId: artist.id,
        source: ArtistDataSource.wikidata,
        name,
      })),
      skipDuplicates: true,
    }),
  ]);

  if (uniqueGenres.length > 0) {
    console.log(`  Wikidata: ${uniqueGenres.length} genre tag(s)`);
  }
}

/** Last.fm: bio (when there's one worth keeping), tags and similar artists,
 *  all looked up by MBID. */
async function enrichFromLastFm(artist: {
  id: string;
  name: string;
}): Promise<void> {
  const info = await getLastFmArtistInfo(artist.id);
  if (!info) return; // Last.fm doesn't know this MBID.

  await prisma.musicArtist.update({
    where: { id: artist.id },
    data: { lastFmUrl: info.url },
  });

  if (info.bio) {
    await upsertDocument({
      artistId: artist.id,
      source: ArtistDataSource.lastfm,
      title: `${info.name} on Last.fm`,
      text: info.bio,
      sourceUrl: info.url,
      permalinkUrl: null,
      license: LASTFM_LICENSE,
      attribution: buildLastFmAttribution(info.url),
    });
  }

  const similar = await getLastFmSimilarArtists(artist.id);

  // Replace rather than merge, so tags/similar artists Last.fm has since
  // dropped don't linger.
  await prisma.$transaction([
    prisma.artistTag.deleteMany({
      where: { artistId: artist.id, source: ArtistDataSource.lastfm },
    }),
    prisma.artistTag.createMany({
      data: Array.from(new Set(info.tags)).map((name) => ({
        artistId: artist.id,
        source: ArtistDataSource.lastfm,
        name,
      })),
      skipDuplicates: true,
    }),
    prisma.similarArtist.deleteMany({
      where: { artistId: artist.id, source: ArtistDataSource.lastfm },
    }),
    prisma.similarArtist.createMany({
      data: similar.map((s) => ({
        artistId: artist.id,
        source: ArtistDataSource.lastfm,
        similarName: s.name,
        similarMbid: s.mbid,
        matchScore: s.match,
      })),
      skipDuplicates: true,
    }),
  ]);

  console.log(
    `  Last.fm: ${info.tags.length} tag(s), ${similar.length} similar artist(s), bio ${info.bio ? "stored" : "none"}`,
  );
}

/** Enriches one artist from each source independently, so a failure in one
 *  doesn't skip the other. Returns true only if nothing errored — an artist
 *  with simply no data online still counts as success, so it isn't
 *  re-queried on every run. */
async function enrichOneArtist(artist: {
  id: string;
  name: string;
}): Promise<boolean> {
  console.log(`Enriching ${artist.name} (${artist.id})`);
  let hadError = false;

  // MusicBrainz links are the shared starting point for both Wikipedia text
  // and Wikidata genres, so fetch (and store) them once up front.
  let links: MusicBrainzArtistLinks | null = null;
  try {
    links = await getArtistExternalLinks(artist.id);
    await prisma.musicArtist.update({
      where: { id: artist.id },
      data: {
        wikidataId: links.wikidataId,
        officialWebsite: links.officialWebsite,
      },
    });
  } catch (err) {
    hadError = true;
    console.error(
      `  MusicBrainz link lookup failed for "${artist.name}":`,
      err,
    );
  }

  if (links) {
    try {
      await enrichFromWikipedia(artist, links);
    } catch (err) {
      hadError = true;
      console.error(`  Wikipedia step failed for "${artist.name}":`, err);
    }

    try {
      await enrichFromWikidataGenres(artist, links.wikidataId);
    } catch (err) {
      hadError = true;
      console.error(`  Wikidata genre step failed for "${artist.name}":`, err);
    }
  }

  try {
    await enrichFromLastFm(artist);
  } catch (err) {
    hadError = true;
    console.error(`  Last.fm step failed for "${artist.name}":`, err);
  }

  if (!hadError) {
    await prisma.musicArtist.update({
      where: { id: artist.id },
      data: { lastEnrichedAt: new Date() },
    });
  }
  return !hadError;
}

export async function enrichAllArtists(): Promise<void> {
  assertLastFmApiKey(); // Fail fast rather than erroring on every artist.

  const cutoff = new Date(
    Date.now() - REFRESH_AFTER_DAYS * 24 * 60 * 60 * 1000,
  );
  const artists = await prisma.musicArtist.findMany({
    where: {
      OR: [{ lastEnrichedAt: null }, { lastEnrichedAt: { lt: cutoff } }],
    },
    select: { id: true, name: true },
  });

  console.log(
    `Enriching ${artists.length} artist(s) not enriched in the last ${REFRESH_AFTER_DAYS} days`,
  );

  for (const artist of artists) {
    await enrichOneArtist(artist);
  }
}

enrichAllArtists()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
