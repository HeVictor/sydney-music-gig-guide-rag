# sydney-music-gig-guide-rag

A RAG application for helping the user discover local gigs in Sydney and general information about the bands that are playing these gigs through natural language conversations.

Capstone project for the [AI Accelerator course from Parsity.io](https://www.parsity.io/ai-dev). Much of the bootstrap, library decisions, starting templates, and repo structure are also taken from the course project repository [mini-rag](https://github.com/projectshft/mini-rag).

## Database agent to query Sydney gigs

The project has a script, `scrapeGigInfoAndPopulateDb.ts`, that will scrape all available gig data from https://sydneymusic.net/gig-guide and insert them into a MySQL database. Users can query this information with natural language by interacting with a database agent, powered by gpt-5.6-luna, which will extract parameters from the user query to form a SQL query to search for matching gigs for the user.

### Example queries

- "Give me up to 5 gigs that are playing anytime next weekend, 26th and 27th of September"
- "Give me the next 3 gigs happening at Oxford Art Factory"
- "I want 5 gigs that are free that are happening sometime next week, between 21st to 27th September"
- "Give me all the upcoming concerts for belle and sebastian"
- "I want 5 gigs that are free which are happening between October and December. The gigs should all start between 6pm and 9pm at either Metro Theatre or Gifts of Mercy Emporium"
