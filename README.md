# Multi-Provider Travel Search

Multi-provider flight and hotel search with async jobs, provider failover, and booking helpers (Amadeus / RapidAPI).

## Included
- Flights: async search, poll results, failover, price validate, order helpers
- Hotels: search/offers with provider failover
- Travel bookings persistence helpers
- Frontend travel search + flight/hotel booking flows

## Setup
1. Copy `.env.example` to `.env`
2. `npm install`
3. `npx prisma generate`
4. `npm run start:dev`

Extracted from production marketplace work under NDA. Branding removed from package metadata.
