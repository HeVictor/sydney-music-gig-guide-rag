# Current challenges and limitations of the application

## Categories

### Inaccurate matching for artist info based strictly on name

The app is currently centered around scraping `sydneymusic.net` for gigs happening in Sydney and the artists playing them, and then based on the artists that
were scraped we attempt to fetch music release and general information from MusicBrainz, and then extend it to fetching data from last.fm based on the ID returned from MusicBrainz. The issue is we are doing a match with artists based mostly on name alone (and country when it is provided), thus if there are more than one artist that has the same name there is the possibility that we are getting the wrong artist from MusicBrainz (and subsequently other sources) compared to the one that is actually playing a gig in Sydney.

## Possible future improvements

Where there are multiple artists with the same name from MusicBrainz, try to prioritise fetching the artist from Australia first if one exists, because it is more likely that an artist that is playing a gig in Sydney will be from Australia instead of overseas. International acts will usually have the country's abbrieviation appended as part of their act name on `sydneymusic.net`, so this is a pattern we can possibly use to try and pin down whether a band is Australian or international to improve the accuracy when we are populating the database.

At the end of the day we can only try and reduce the amount of inaccuracies from the fetching and scraping process for getting data about artists, because only a best-effort attempt is made to match a gig artist to a profile that may belong to them from another information source, with these sources being largely crowdsourced information. The only guaranteed way for quality assurance is manual verification which can be time-consuming, but there should be methods to extend the app so that it is easier for a person to check newly updated data for the application on a weekly basis so that it is manageable.
