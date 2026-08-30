import { closePool, saveGigs } from "./libs/database/insertGigs";
import { scrapeSydneyMusicNetGigGuidePage } from "./libs/scrapers/sydneyMusicNetScraper";

async function scrapeGigInfoAndPopulateDb() {
  const scrapedGigs = await scrapeSydneyMusicNetGigGuidePage();

  if (!scrapedGigs) {
    console.warn("No gigs were able to be scraped, cannot save to DB");
    return;
  }

  await saveGigs(scrapedGigs);
}

scrapeGigInfoAndPopulateDb().finally(closePool);
