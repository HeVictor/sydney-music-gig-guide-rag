# Project proposal

The purpose of this RAG application will be to provide general information on local Australian music artists such as their genre, their members, their releases, and fun facts. It will also provide a guide to help users easily find live music gigs that they could be interested in within Sydney.

use the information available from the website `sydneymusic.net` to populate both a vector and a SQL database to help me easily find live music gigs that I would be interested in within Sydney.

todo: maybe I do implement an agent routing architecture. One that provides information about bands and venues which is stored in vector databases, the other is specific time-based gig based info stored in SQL.

## Project scope

**Problem statement**: For many smaller local Australian artists, it can be hard to find much information about them in the same space as bigger artists do (for example, not all of them are on Spotify). It can be convenient to have an application that has collected information for these smaller acts across a number of sources into a database so that a user may find out more about these artists through natural language interaction in a RAG application.

For gig discovery in Sydney, `sydneymusic.net` is a website that provides an up-to-date guide for gigs happening every month in Sydney, with a focus on local artists. While browsing the guide manually is fun, a RAG application can make it much faster and lower effort for me to quickly find artists and shows that I might be interested in and available for without looking through every gig available.

I will use the artists found from `sydneymusic.net` as a basis to build the list of music acts to get general information for. This way, the application will be guaranteed to have information for all acts that are playing shows in Sydney and can provide more extensive responses and recommendations.

I will be building this RAG application from scratch using this repository.

## Data source

For fetching information about Australian music acts, I will be focusing on sites and platforms that have a focus on covering or hosting Australian artists that are not big mainstream acts. I will start with two soruces:

- **_Bandcamp_**: a popular music hosting platform for smaller indie artists. This site will contain music releases for the artist. Their _robots.txt_ file allow scraping of their tag and artists pages which allow me to filter and get more info for Australian acts.
- **_Triple J Unearthed_**: this is explicitly made to promote emerging Australian acts. This site will contain general information for artists from interviews and articles. They are hosted under the `abc.net.au/triplejunearthed` and the _robots.txt_ file from the root domain of `abc.net.au` has no restrictions against scraping the `/triplejunearthed` subdomain.

For fetching gig data for Sydney, I will be scraping them from `https://sydneymusic.net/gig-guide` as it is a highly-curated, comprehensive, and up-to-date site containing a wide range of live music gig happening across Sydney that is maintained by a passionate community. Their _robots.txt_ file permit scraping across all their pages.

## Technical choices

I am choosing React and TypeScript as the stack choice of my implementation. I will use Pinecone for my vector database for storing the artist information as I am most familiar with it from the coursework and it provides sufficient performance and storage capabilities for the application on the free tier. For the Sydney gig part of the applicaiton, I will use Prisma and a MySQL database so I can store and search gig data that has known fields like dates, venues, and genres etc. I will use OpenAI for my LLM providers as I've used it throughout the course and I am happy with their performance so far.

Additional considerations:

- A possible additional feature is to hook up the app with Spotify API to have it anaylyse my music tastes recently and have it recommend local artists and Sydney gigs based on the genres and bands I listen to.
- Music releases are highly structured data so info fetched from Bandcamp may be more suitable for being stored in a different table in MySQL.

## Chunking strategy

The chunking will only apply to the general band information fetched from the articles and interviews of acts on **_Triple J Unearthed_**. As the information will be expected to be relatively concise, chunking will be done as necessary if sections exceed a chunk size threshold (e.g. 100 characters as a starting point):

- For chunking article content, I will utilise the "chunking with overlap" strategy by splitting texts by sentences and iteratively adding sentences to the current chunk until the set chunk size, by which then the last portion of the previous chunks will be used as the start of the next chunks.
- For chunking interview content, I will chunk it so that a question and answer combination are kept in the same chunk, and if responses are longer than the chunk size then I will use the overlap strategy while still retaining the original question in the new chunk.

## Architecture

At a high level, scraped information from Bandcamp and `sydneymusic.net` will go into separate tables in MySQL, while scraped information from Triple J Unearthed will be embedded into vectors using an LLM model to be inserted into a Pinecone database.

As a foundation, I will have two functional agents and a routing agent for my application:

- One functional agent is responsible for answering general information about Australian music acts based on information retrieved from Pinecone and MySQL, the other will answer questions about live gigs in Sydney based on information retrieved from MySQL.
- When users input a query, it will first be handled by the routing agent to determine which of the functional agents to hand the request to.

Stretch goal:

- Implement a third functional agent that invokes Spotify API for my listening data and works with the live gig agent to give gig recommendations based on my tastes.
