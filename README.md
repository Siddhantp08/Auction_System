# Classic Auction System (Monorepo)

Real-time auctions with scheduled go-live, live bidding, seller decisions, and notifications. Built with React + Vite, Fastify, and Supabase. Docker-ready and wired for CI/CD via GitHub Actions and Render.

> Status: Production-ready for basic auctions. Optional extras (Redis, ORM, SMS) degrade gracefully when not configured.

## Highlights

- Real-time bidding via WebSockets (bid updates, auction start/end/close)
- Scheduled auctions (go live at selected date/time)
- Seller workflow: highest bid review, accept/reject, counter offers
- In-app notifications (outbid, accepted/rejected, auction closed)
- Supabase Auth (RLS-aware per-request client) and REST storage
- Dockerized multi-stage build; simple Render deploy
- CI/CD: build/test on push; auto-deploy main via Deploy Hook

## Architecture

- apps/client: React 18 + TypeScript + Vite UI; pulls runtime config from `/config` and listens on WebSocket
- apps/server: Fastify API + WebSocket broadcaster; background job promotes scheduled→live and ends expired auctions
- packages/shared: shared types
- supabase/migrations: SQL migrations for schema (auctions/bids earlier, notifications/counter_offers here)

## Project Structure

```text
apps/
	client/                # React + Vite app
	server/                # Fastify API server
packages/
	shared/                # Shared types (TS project)
supabase/
	migrations/            # SQL migrations (run in Supabase SQL Editor/CLI)
Dockerfile               # Multi-stage build
render.yaml              # Render blueprint (Docker)
.github/workflows/ci-cd.yml # GitHub Actions CI/CD
```

## Requirements

- Node.js 20+
- Supabase project (Postgres + Auth)
- Optional: Upstash Redis, Twilio

## Environment Variables

Server (apps/server/.env):

- PORT=8080
- SUPABASE_URL, SUPABASE_ANON_KEY (client auth + per-request RLS)
- SUPABASE_KEY (service key; enables admin lookups and reliable writes on decisions)
- PUBLIC_ORIGIN=<https://your-domain>
- Optional: DATABASE_URL (Postgres for optional ORM), UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN, TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN/TWILIO_FROM

Client (apps/client/.env):

- VITE_API_BASE=<http://localhost:8080>
- VITE_WS_URL=<ws://localhost:8080>
- Optional: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY (client fetches from `/config` at runtime; these are fallback)

## Setup (Local Dev)

### 1. Install

- `npm ci` at repo root (uses npm workspaces)

### 2. Supabase schema

Run migrations in Supabase SQL Editor:

- notifications + counter_offers: `supabase/migrations/20250816_notifications_counter_offers.sql`
- add 'closed' status to auctions: `supabase/migrations/20250816_fix_status_closed.sql`
- Apply your base auctions/bids schema if not already present

Notes:

- The counter_offers table uses quoted camelCase columns ("auctionId","sellerId","buyerId"). Ensure your table columns match exactly, or adjust server code to snake_case.
- After DDL changes, PostgREST schema reload is triggered via `NOTIFY pgrst, 'reload schema';` in the migration.

### 3. Run

- `npm run dev` (starts client and server)
- Client: <http://localhost:5173>
- Server: <http://localhost:8080>

## Docker

- Build: `docker build -t auction-system .`
- Run: `docker run -p 8080:8080 --env-file apps/server/.env auction-system`

The server serves static client assets from `/apps/client-dist` when present.

## Deploy (Render)

1) Push repo to GitHub
2) Render > New > Blueprint > select repo (uses `render.yaml` and Dockerfile)
3) Set env vars (see above) in Render service settings
4) Deploy; health check at `/health`

Background tasks: the server cron (setInterval) runs in-process to activate scheduled auctions and end expired ones.

## CI/CD (GitHub Actions)

- Workflow: `.github/workflows/ci-cd.yml`
- On every push/PR: install → typecheck → lint → build → docker build
- On push to main: triggers Render via Deploy Hook

Setup:

- In GitHub repo settings → Secrets and variables → Actions, add:
	- `RENDER_DEPLOY_HOOK` = your Render service Deploy Hook URL

Verify:

- Push a commit → Actions should show “Build & Validate” green
- Merge to main → “Deploy to Render” step posts to the hook; Render shows a new deploy

## API (Summary)

- GET `/health` → server status
- GET `/config` → public Supabase config for client
- Auctions:
	- GET `/api/auctions` → list
	- GET `/api/auctions/:id` → detail
	- POST `/api/auctions` (auth) → create with { title, startingPrice, bidIncrement, goLiveAt, durationMinutes }
- Bids:
	- POST `/api/auctions/:id/bids` (auth) → place bid; rejects if seller bids, before goLiveAt, or after endsAt
	- GET `/api/auctions/:id/bids` (auth, seller only) → list bids for seller decision view
- Seller decisions:
	- POST `/api/auctions/:id/decision` (auth, seller only) → { decision: 'accept' | 'reject' }; allowed when status=ended; closes auction
	- POST `/api/auctions/:id/counter-offers` (auth, seller only) → { amount }; sends to highest bidder
	- POST `/api/counter-offers/:counterId/respond` (auth) → { decision }; buyer accepts/rejects; closes auction
- Notifications:
	- GET `/api/notifications` (auth) → list for current user
	- POST `/api/notifications/:id/read` (auth) → mark read

## WebSocket Events

- `connected` → initial handshake
- `auction:created` → a new auction was created
- `auction:live` → scheduled auction became live
- `bid:accepted` → a bid was accepted and is now top
- `auction:ended` → auction reached endsAt
- `auction:closed` → seller decision or counter resolution closed the auction
- `notification` → user-scoped event payload (outbid, bid_accepted, bid_rejected, auction_closed, counter_* …)

## Data Model (Key Fields)

- auctions: id, sellerId, title, description, startingPrice, currentPrice, bidIncrement, goLiveAt, endsAt, status ('scheduled'|'live'|'ended'|'closed'), createdAt, updatedAt
- bids: id, auctionId, bidderId, amount, createdAt
- notifications: id, userId, type, payload, read, createdAt (RLS: users see own)
- counter_offers: id, auctionId, sellerId, buyerId, amount, status ('pending'|'accepted'|'rejected'), createdAt, updatedAt (RLS: buyer/seller can view; seller/buyer update own)

Constraint note: ensure `auctions_status_check` allows 'closed' (migration: `20250816_fix_status_closed.sql`).

## Behavior Rules

- Sellers cannot bid on their own auctions (server-enforced; UI hidden)
- Bids only accepted while status=live and now ≤ endsAt
- Highest bid is determined by amount (not insertion time)
- Seller decisions allowed only when status=ended; decision closes the auction
- Counter-offer accept/reject also closes the auction

## Troubleshooting

- PGRST205 (table not found): apply the migration in `supabase/migrations` in SQL Editor
- PGRST204 (column not found): ensure quoted camelCase columns exist ("auctionId","sellerId","buyerId"); rename if needed
- 23514 (auctions_status_check): run `20250816_fix_status_closed.sql`
- Render module errors for optional deps (sequelize/redis/twilio): integrations are optional; server will degrade gracefully

## Contributing

PRs welcome. For larger changes, open an issue first to discuss scope.

## License

MIT