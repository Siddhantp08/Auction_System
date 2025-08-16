-- Add notifications and counter_offers tables with RLS policies

-- Notifications table
create table if not exists public.notifications (
  id text primary key,
  "userId" text not null,
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  read boolean not null default false,
  "createdAt" timestamptz not null default now()
);

alter table public.notifications enable row level security;

create policy if not exists "Users can view own notifications" on public.notifications
  for select using (auth.uid()::text = "userId");

create policy if not exists "Users can mark own notifications" on public.notifications
  for update using (auth.uid()::text = "userId");

-- Inserts are performed by server with service role; no insert policy for clients

-- Counter offers table
create table if not exists public.counter_offers (
  id text primary key,
  "auctionId" text not null references public.auctions(id) on delete cascade,
  "sellerId" text not null,
  "buyerId" text not null,
  amount decimal(10,2) not null,
  status text not null default 'pending' check (status in ('pending','accepted','rejected')),
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

create or replace function update_counter_offers_updated_at()
returns trigger as $$
begin
  new."updatedAt" = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_counter_offers_updated on public.counter_offers;
create trigger trg_counter_offers_updated
  before update on public.counter_offers
  for each row execute function update_counter_offers_updated_at();

alter table public.counter_offers enable row level security;

create policy if not exists "Seller or buyer can view counter offers" on public.counter_offers
  for select using (auth.uid()::text = "sellerId" or auth.uid()::text = "buyerId");

create policy if not exists "Seller can create counter offer" on public.counter_offers
  for insert with check (auth.uid()::text = "sellerId");

create policy if not exists "Seller can update own counter offer" on public.counter_offers
  for update using (auth.uid()::text = "sellerId");

create policy if not exists "Buyer can update own counter offer" on public.counter_offers
  for update using (auth.uid()::text = "buyerId");

-- Refresh PostgREST schema (optional)
NOTIFY pgrst, 'reload schema';
