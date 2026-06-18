-- ============================================================
-- DEVICE SALES TRACKER — SUPABASE SCHEMA
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

-- 1. USERS TABLE (for app login — separate from Supabase Auth)
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. SALES TABLE
CREATE TABLE IF NOT EXISTS sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Customer Info
  customer_name TEXT NOT NULL,
  mobile_number VARCHAR(15) NOT NULL,
  customer_address TEXT,

  -- Device Info
  device_type TEXT NOT NULL,          -- laptop / desktop / cpu+monitor / other / custom
  model TEXT,                         -- nullable: not mandatory for "Other" device type
  processor TEXT,                     -- nullable: not mandatory for "Other" device type
  generation TEXT,                    -- e.g. "11th Gen", "5000 Series"
  ram TEXT,                           -- nullable: not mandatory for "Other" device type
  ram_type TEXT,                      -- DDR2 / DDR3 / DDR4 / DDR5 / custom
  hdd TEXT DEFAULT 'none',            -- none / 320gb / 500gb / 1tb / custom
  ssd TEXT DEFAULT 'none',            -- none / 128gb / 256gb / 512gb / 1tb / custom
  ssd_interface TEXT,                 -- SATA / M.2 / NVMe
  ssd_gen TEXT,                       -- Gen2 / Gen3 / Gen4 / Gen5 (only when ssd_interface = NVMe)
  monitor TEXT,                       -- size/model, nullable

  -- Accessories (stored as comma-separated or JSON)
  accessories TEXT[],                 -- ['keyboard', 'mouse', 'speaker']

  -- Shop / Store
  store TEXT DEFAULT 'Store No 122/123',  -- which shop made the sale

  -- Pricing
  price NUMERIC(10,2) NOT NULL,
  discount NUMERIC(10,2) DEFAULT 0,
  payment_mode TEXT NOT NULL CHECK (payment_mode IN ('cash', 'online', 'credit', 'split')),
  cash_amount NUMERIC(10,2) DEFAULT 0,    -- used when payment_mode = 'split'
  online_amount NUMERIC(10,2) DEFAULT 0,  -- used when payment_mode = 'split'

  -- Date & Meta
  sale_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. AUTO-UPDATE updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER sales_updated_at
  BEFORE UPDATE ON sales
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 4. INDEXES for common filter queries
CREATE INDEX IF NOT EXISTS idx_sales_sale_date ON sales(sale_date);
CREATE INDEX IF NOT EXISTS idx_sales_mobile ON sales(mobile_number);
CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales(customer_name);
CREATE INDEX IF NOT EXISTS idx_sales_month_year ON sales(EXTRACT(MONTH FROM sale_date), EXTRACT(YEAR FROM sale_date));

-- ============================================================
-- SAMPLE USERS — Run AFTER setting up the app
-- (passwords are set via the app's seed script or manually)
-- ============================================================
-- You will create users via the /api/auth/seed endpoint
-- or insert them below with bcrypt hashed passwords.

-- ============================================================
-- DISABLE Row Level Security (RLS) for simplicity
-- (we handle auth via JWT in Express — not Supabase RLS)
-- ============================================================
ALTER TABLE users DISABLE ROW LEVEL SECURITY;
ALTER TABLE sales DISABLE ROW LEVEL SECURITY;
