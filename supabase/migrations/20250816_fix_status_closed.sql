-- Allow 'closed' status for auctions to persist seller decisions
-- Fixes: new row violates check constraint "auctions_status_check" [23514]

-- Drop existing check constraint if present
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.constraint_column_usage ccu
    WHERE ccu.constraint_name = 'auctions_status_check'
      AND ccu.table_name = 'auctions'
  ) THEN
    EXECUTE 'ALTER TABLE auctions DROP CONSTRAINT auctions_status_check';
  END IF;
END $$;

-- Recreate the check constraint to include 'closed'
ALTER TABLE auctions
  ADD CONSTRAINT auctions_status_check
  CHECK (status IN ('scheduled','live','ended','closed'));

-- Optional: backfill any invalid statuses to a safe value (none expected)
-- UPDATE auctions SET status = 'ended' WHERE status NOT IN ('scheduled','live','ended','closed');
