# Classic Auction System

A clean, simple, and original auction platform built with modern web technologies.

## Features

- **Real-time Bidding**: Live updates using WebSockets
- **User Authentication**: Secure login/signup with Supabase
- **Auction Management**: Create and manage auctions
- **Responsive Design**: Works on desktop and mobile
- **Clean Architecture**: Simple, maintainable codebase

## Tech Stack

### Frontend
- React 18 with TypeScript
- Tailwind CSS for styling
- Vite for development and building
- Supabase for authentication

### Backend
- Node.js with Fastify
- WebSocket for real-time updates
- Supabase/PostgreSQL for data storage
- TypeScript for type safety

## Getting Started

### Prerequisites
- Node.js 18+
- PostgreSQL database (or Supabase account)

### Installation

1. Clone the repository
```bash
git clone <repository-url>
cd classic-auction-system
```

2. Install dependencies
```bash
npm install
```

3. Set up environment variables

Create `.env` files in both `apps/client` and `apps/server`:

**apps/client/.env**
```
VITE_API_BASE=http://localhost:8080
VITE_WS_URL=ws://localhost:8080
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

**apps/server/.env**
```
PORT=8080
SUPABASE_URL=your_supabase_url
SUPABASE_KEY=your_supabase_service_key
SUPABASE_ANON_KEY=your_supabase_anon_key
```

4. Set up the database

Run the SQL script in `apps/server/src/database.sql` in your PostgreSQL database.

5. Start the development servers
```bash
npm run dev
```

This will start:
- Frontend on http://localhost:5173
- Backend on http://localhost:8080

## Project Structure

```
├── apps/
│   ├── client/          # React frontend
│   │   ├── src/
│   │   │   ├── ui/      # React components
│   │   │   └── index.css # Styles
│   │   └── package.json
│   └── server/          # Node.js backend
│       ├── src/
│       │   ├── index.ts # Main server file
│       │   └── database.sql # Database schema
│       └── package.json
├── package.json         # Root package.json
└── README.md
```

## API Endpoints

- `GET /api/auctions` - Get all auctions
- `POST /api/auctions` - Create new auction (auth required)
- `GET /api/auctions/:id` - Get specific auction
- `POST /api/auctions/:id/bids` - Place bid (auth required)
- `GET /api/auctions/:id/bids` - Get auction bids

## WebSocket Events

- `bid:accepted` - New bid placed
- `auction:created` - New auction created
- `auction:ended` - Auction ended

## Database Schema

### Auctions Table
- `id` - Unique identifier
- `sellerId` - User who created the auction
- `title` - Auction title
- `description` - Optional description
- `startingPrice` - Starting bid amount
- `currentPrice` - Current highest bid
- `bidIncrement` - Minimum bid increment
- `goLiveAt` - When auction starts
- `endsAt` - When auction ends
- `status` - Current status (scheduled/live/ended/cancelled)

### Bids Table
- `id` - Unique identifier
- `auctionId` - Reference to auction
- `bidderId` - User who placed the bid
- `amount` - Bid amount
- `createdAt` - When bid was placed

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

This project is licensed under the MIT License.