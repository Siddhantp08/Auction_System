-- Clean, simple database schema for the auction system
-- This replaces the complex existing schema with a minimal, focused design

-- Drop existing tables if they exist (be careful in production!)
DROP TABLE IF EXISTS public.counter_offers CASCADE;
DROP TABLE IF EXISTS public.notifications CASCADE;
DROP TABLE IF EXISTS public.bids CASCADE;
DROP TABLE IF EXISTS public.auctions CASCADE;

-- Create auctions table with simple, clear structure
CREATE TABLE public.auctions (
  id TEXT PRIMARY KEY,
  "sellerId" TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  "startingPrice" DECIMAL(10,2) NOT NULL,
  "currentPrice" DECIMAL(10,2) NOT NULL,
  "bidIncrement" DECIMAL(10,2) NOT NULL DEFAULT 1.00,
  "goLiveAt" TIMESTAMPTZ NOT NULL,
  "endsAt" TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'live', 'ended', 'cancelled')),
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create bids table
CREATE TABLE public.bids (
  id TEXT PRIMARY KEY,
  "auctionId" TEXT NOT NULL REFERENCES public.auctions(id) ON DELETE CASCADE,
  "bidderId" TEXT NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX idx_auctions_status ON public.auctions(status);
CREATE INDEX idx_auctions_ends_at ON public.auctions("endsAt");
CREATE INDEX idx_auctions_seller ON public.auctions("sellerId");
CREATE INDEX idx_bids_auction ON public.bids("auctionId");
CREATE INDEX idx_bids_bidder ON public.bids("bidderId");
CREATE INDEX idx_bids_created_at ON public.bids("createdAt" DESC);

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW."updatedAt" = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger for auctions table
CREATE TRIGGER update_auctions_updated_at 
    BEFORE UPDATE ON public.auctions 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Enable Row Level Security (optional - can be disabled for simplicity)
ALTER TABLE public.auctions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bids ENABLE ROW LEVEL SECURITY;

-- Create policies (optional - for authenticated access)
CREATE POLICY "Anyone can view auctions" ON public.auctions
    FOR SELECT USING (true);

CREATE POLICY "Authenticated users can create auctions" ON public.auctions
    FOR INSERT WITH CHECK (auth.uid()::text = "sellerId");

CREATE POLICY "Sellers can update their auctions" ON public.auctions
    FOR UPDATE USING (auth.uid()::text = "sellerId");

CREATE POLICY "Anyone can view bids" ON public.bids
    FOR SELECT USING (true);

CREATE POLICY "Authenticated users can place bids" ON public.bids
    FOR INSERT WITH CHECK (auth.uid()::text = "bidderId");

-- Insert sample data for testing (optional)
INSERT INTO public.auctions (
  id, "sellerId", title, description, "startingPrice", "currentPrice", 
  "bidIncrement", "goLiveAt", "endsAt", status
) VALUES 
(
  'sample-auction-1',
  'sample-seller-1',
  'Vintage Camera',
  'A beautiful vintage camera in excellent condition',
  50.00,
  50.00,
  5.00,
  NOW(),
  NOW() + INTERVAL '1 hour',
  'live'
),
(
  'sample-auction-2',
  'sample-seller-2',
  'Antique Book Collection',
  'Rare books from the 19th century',
  100.00,
  100.00,
  10.00,
  NOW() + INTERVAL '30 minutes',
  NOW() + INTERVAL '2 hours',
  'scheduled'
);