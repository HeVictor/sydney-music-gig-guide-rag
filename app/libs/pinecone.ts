import {
  Pinecone,
  RecordMetadata,
  ScoredPineconeRecord,
} from "@pinecone-database/pinecone";
import { openaiClient } from "../libs/openai";

export const pineconeClient = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY as string,
});

/**
 * Searches for semantically similar documents in the vector database
 *
 * @param query - The search query (will be converted to embeddings)
 * @param topK - Number of most similar results to return (try 3-10)
 * @returns Array of matching documents with similarity scores
 */
export const searchDocuments = async (
  query: string,
  topK: number = 3,
  options: { namespace?: string; filter?: Record<string, unknown> } = {},
): Promise<ScoredPineconeRecord<RecordMetadata>[]> => {
  // Connect to the index
  const base = pineconeClient.index({ name: process.env.PINECONE_INDEX! });
  const index = options.namespace ? base.namespace(options.namespace) : base;

  // Convert the search query into a vector embedding
  const queryEmbedding = await openaiClient.embeddings.create({
    model: "text-embedding-3-small",
    dimensions: 512,
    input: query,
  });

  // Extract the actual embedding array from the API response
  const embedding = queryEmbedding.data[0].embedding;

  // Search the vector database for similar embeddings
  const docs = await index.query({
    vector: embedding,
    topK,
    includeMetadata: true, // Include the original text content with results
  });

  return docs.matches;
};
