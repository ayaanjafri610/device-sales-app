-- ============================================================
-- DEVICE SALES TRACKER — MIGRATION v2
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- Safe to run on your EXISTING data — only adds new columns,
-- does not delete or modify any existing rows.
-- ============================================================

-- 1. Add "generation" column (e.g. "11th Gen", "5000 Series")
ALTER TABLE sales ADD COLUMN IF NOT EXISTS generation TEXT;

-- 2. Add "store" column (which shop location made the sale)
ALTER TABLE sales ADD COLUMN IF NOT EXISTS store TEXT DEFAULT 'Store No 122/123';

-- 3. Add split-payment amount columns
--    (cash_amount + online_amount should add up to price - discount,
--     but we don't enforce that in DB — handled in app logic)
ALTER TABLE sales ADD COLUMN IF NOT EXISTS cash_amount NUMERIC(10,2) DEFAULT 0;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS online_amount NUMERIC(10,2) DEFAULT 0;

-- 4. Update payment_mode check constraint to include 'split'
ALTER TABLE sales DROP CONSTRAINT IF EXISTS sales_payment_mode_check;
ALTER TABLE sales ADD CONSTRAINT sales_payment_mode_check
  CHECK (payment_mode IN ('cash', 'online', 'credit', 'split'));

-- 5. Make processor and ram nullable (needed for "Other" device type)
ALTER TABLE sales ALTER COLUMN processor DROP NOT NULL;
ALTER TABLE sales ALTER COLUMN ram DROP NOT NULL;
ALTER TABLE sales ALTER COLUMN model DROP NOT NULL;

-- 6. Index for store-based filtering (useful for future shop-wise revenue reports)
CREATE INDEX IF NOT EXISTS idx_sales_store ON sales(store);

-- ============================================================
-- Done! Verify with:
-- SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'sales';
-- ============================================================

-- ============================================================
-- MIGRATION v3 — RAM Type & SSD Type/Interface
-- Safe to run after v2. Adds new columns, no data loss.
-- ============================================================

-- RAM type: DDR2, DDR3, DDR4, DDR5, or custom
ALTER TABLE sales ADD COLUMN IF NOT EXISTS ram_type TEXT;

-- SSD interface: SATA, M.2, NVMe
ALTER TABLE sales ADD COLUMN IF NOT EXISTS ssd_interface TEXT;

-- SSD NVMe generation (only relevant when ssd_interface = 'NVMe')
ALTER TABLE sales ADD COLUMN IF NOT EXISTS ssd_gen TEXT;
