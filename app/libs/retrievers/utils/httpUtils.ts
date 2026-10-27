// MusicBrainz, Wikimedia and Last.fm all ask API clients to identify
// themselves with a meaningful User-Agent that includes a way to contact
// you.
export const USER_AGENT =
  "SydneyMusicGigGuideRAG/1.0 (https://github.com/HeVictor/sydney-music-gig-guide-rag)";

/** Returns a `wait()` function that resolves once at least `minIntervalMs`
 *  has passed since the previous call returned. Await it immediately before
 *  each request to a given host to keep a steady, polite pace. Assumes
 *  requests to that host are made sequentially (as the enrichment script
 *  does), not concurrently. */
export function createRateLimiter(minIntervalMs: number): () => Promise<void> {
  let lastRequestAt = 0;

  return async function wait(): Promise<void> {
    const elapsed = Date.now() - lastRequestAt;
    if (elapsed < minIntervalMs) {
      await new Promise((resolve) =>
        setTimeout(resolve, minIntervalMs - elapsed),
      );
    }
    lastRequestAt = Date.now();
  };
}
