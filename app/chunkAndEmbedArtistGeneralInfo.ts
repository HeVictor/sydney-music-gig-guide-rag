import { PrismaClient, type Prisma } from "@prisma/client";
import { openaiClient } from "./libs/openai";
import { pineconeClient } from "./libs/pinecone";
import { chunkText, type Chunk } from "./libs/chunking";

const prisma = new PrismaClient();

const EMBEDDING_MODEL = "text-embedding-3-small";
// Must match the dimension the Pinecone index was created with.
const EMBEDDING_DIMENSIONS = 512;

// Same as chunkText's defaults — pulled out here so they can be tuned in one place.
const CHUNK_SIZE = 500;
const CHUNK_OVERLAP = 50;

const EMBED_BATCH_SIZE = 100;
const UPSERT_BATCH_SIZE = 100;

const NAMESPACE = "artist-info";

// Chunks after the first rarely mention the artist's name ("The band formed
// in 2010..."), so a query like "tell me about <band>" would match them
// poorly. Prefixing the name onto the text that gets embedded (not the text
// stored in metadata) fixes that. Set to false to embed chunks as-is.
const PREFIX_ARTIST_NAME_IN_EMBEDDING = true;

type DocumentWithArtist = Prisma.ArtistDocumentGetPayload<{
  include: { artist: { select: { id: true; name: true; country: true } } };
}>;

function getTargetIndex() {
  const indexName = process.env.PINECONE_INDEX;
  if (!indexName) {
    throw new Error("PINECONE_INDEX is not set in the environment.");
  }

  return pineconeClient.index({ name: indexName }).namespace(NAMESPACE);
}

type TargetIndex = ReturnType<typeof getTargetIndex>;

async function embedTexts(texts: string[]): Promise<number[][]> {
  const embeddings: number[][] = [];

  for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
    const batch = texts.slice(i, i + EMBED_BATCH_SIZE);
    const response = await openaiClient.embeddings.create({
      model: EMBEDDING_MODEL,
      input: batch,
      dimensions: EMBEDDING_DIMENSIONS,
    });

    // Results carry an index; sort to be certain they line up with the inputs.
    const ordered = [...response.data].sort((a, b) => a.index - b.index);
    embeddings.push(...ordered.map((item) => item.embedding));
  }

  return embeddings;
}

// Deterministic IDs make re-runs idempotent: the same chunk of the same
// document always overwrites itself. The trailing colon in the prefix stops
// document 1's prefix from also matching document 10's vectors.
const vectorIdPrefix = (documentId: number) => `artistdoc:${documentId}:`;
const vectorId = (documentId: number, chunkIndex: number) =>
  `${vectorIdPrefix(documentId)}${chunkIndex}`;

function buildMetadata(doc: DocumentWithArtist, chunk: Chunk) {
  const metadata: Record<string, string | number | boolean | string[]> = {
    // From chunkText: source (set to the page URL below), chunkIndex,
    // totalChunks, startChar, endChar.
    ...chunk.metadata,
    content: chunk.content, // Pinecone doesn't store the text itself, so keep it here for retrieval

    // Filter on artistId (the MusicBrainz ID) rather than artistName so
    // same-named bands never get mixed together.
    artistId: doc.artist.id,
    artistName: doc.artist.name,
    documentId: doc.id,
    dataSource: doc.source, // "wikipedia" | "lastfm" (chunk.metadata.source is the URL)
    title: doc.title,
    license: doc.license,
    attribution: doc.attribution, // ready-to-display credit line, shown whenever this chunk is used
    contentHash: doc.contentHash,
  };

  // Pinecone rejects null metadata values, so optional fields are only
  // added when they have a value.
  if (doc.permalinkUrl) metadata.permalinkUrl = doc.permalinkUrl;
  if (doc.artist.country) metadata.artistCountry = doc.artist.country;

  return metadata;
}

/** Removes vectors left over from an earlier version of this document —
 *  e.g. when the text shrank and now produces fewer chunks. Relies on
 *  listing by ID prefix, which serverless indexes support. */
async function deleteStaleVectors(
  index: TargetIndex,
  documentId: number,
  keepIds: Set<string>,
): Promise<void> {
  const staleIds: string[] = [];
  let paginationToken: string | undefined;

  do {
    const page = await index.listPaginated({
      prefix: vectorIdPrefix(documentId),
      paginationToken,
    });
    for (const vector of page.vectors ?? []) {
      if (vector.id && !keepIds.has(vector.id)) staleIds.push(vector.id);
    }
    paginationToken = page.pagination?.next;
  } while (paginationToken);

  if (staleIds.length > 0) {
    await index.deleteMany({ ids: staleIds });
  }
}

async function processDocument(
  index: TargetIndex,
  doc: DocumentWithArtist,
): Promise<void> {
  // The page URL goes in as chunkText's `source`, so it ends up in each chunk's metadata.
  const chunks = chunkText(doc.text, CHUNK_SIZE, CHUNK_OVERLAP, doc.sourceUrl);
  const newIds = new Set(
    chunks.map((chunk) => vectorId(doc.id, chunk.metadata.chunkIndex)),
  );

  if (chunks.length > 0) {
    const embeddingInputs = chunks.map((chunk) =>
      PREFIX_ARTIST_NAME_IN_EMBEDDING
        ? `Artist: ${doc.artist.name}\n\n${chunk.content}`
        : chunk.content,
    );
    const embeddings = await embedTexts(embeddingInputs);

    const records = chunks.map((chunk, i) => ({
      id: vectorId(doc.id, chunk.metadata.chunkIndex),
      values: embeddings[i],
      metadata: buildMetadata(doc, chunk),
    }));

    for (let i = 0; i < records.length; i += UPSERT_BATCH_SIZE) {
      await index.upsert({ records: records.slice(i, i + UPSERT_BATCH_SIZE) });
    }
  }

  // Done after the upsert so there's never a moment where the document has no vectors.
  await deleteStaleVectors(index, doc.id, newIds);

  console.log(
    `${doc.artist.name} [${doc.source}]: ${chunks.length} chunk(s) upserted`,
  );
}

export async function chunkAndEmbedGeneralArtistInfo(): Promise<void> {
  const index = getTargetIndex();

  const documents = await prisma.artistDocument.findMany({
    include: { artist: { select: { id: true, name: true, country: true } } },
    orderBy: { id: "asc" },
  });
  console.log(`Chunking and embedding ${documents.length} artist document(s)`);

  let failures = 0;
  for (const doc of documents) {
    try {
      await processDocument(index, doc);
    } catch (err) {
      // One bad document shouldn't stop the rest; failed ones are retried on the next run.
      failures++;
      console.error(
        `Failed to process "${doc.artist.name}" [${doc.source}]:`,
        err,
      );
    }
  }

  if (failures > 0) {
    throw new Error(`${failures} of ${documents.length} document(s) failed`);
  }
}

chunkAndEmbedGeneralArtistInfo()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
