-- ============================================================
-- MIGRATION v4 — REPLACEMENT & ADVANCE ORDER MODULE
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- Safe to run alongside existing sales/users tables — creates
-- brand new tables only, touches nothing in the sales schema.
-- ============================================================

-- 1. SEQUENCES for auto-numbering (REP0001, ORD0001, ...)
CREATE SEQUENCE IF NOT EXISTS req_replacement_seq START 1;
CREATE SEQUENCE IF NOT EXISTS req_order_seq START 1;

-- 1b. RPC function so the backend can atomically increment a named sequence
--     (prevents two simultaneous saves from getting the same request number)
CREATE OR REPLACE FUNCTION nextval_seq(seq_name TEXT)
RETURNS BIGINT AS $$
BEGIN
  RETURN nextval(seq_name);
END;
$$ LANGUAGE plpgsql;

-- 2. CUSTOMERS (fully separate from sales customers, per decision)
CREATE TABLE IF NOT EXISTS req_customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  mobile_number VARCHAR(15) NOT NULL,
  alternate_number VARCHAR(15),
  address TEXT,
  remarks TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_req_customers_mobile ON req_customers(mobile_number);
CREATE INDEX IF NOT EXISTS idx_req_customers_name ON req_customers(name);

-- 3. REQUESTS (parent record — one per visit/transaction)
CREATE TABLE IF NOT EXISTS requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_number TEXT UNIQUE NOT NULL,        -- REP0001 / ORD0001
  request_type TEXT NOT NULL CHECK (request_type IN ('replacement', 'order')),

  customer_id UUID NOT NULL REFERENCES req_customers(id),

  current_status TEXT NOT NULL,               -- see status lists below

  -- Order-only pricing (NULL for replacement)
  item_price NUMERIC(10,2),
  advance_amount NUMERIC(10,2) DEFAULT 0,
  remaining_amount NUMERIC(10,2),              -- computed = item_price - advance_amount

  -- Free-text for now (formalize service centre / supplier lists later)
  service_centre_or_supplier TEXT,
  tracking_number TEXT,

  request_date DATE NOT NULL DEFAULT CURRENT_DATE,
  expected_date DATE,
  delivered_date DATE,
  closed_date DATE,

  created_by UUID REFERENCES users(id),
  assigned_to UUID REFERENCES users(id),

  internal_notes TEXT,
  customer_notes TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_requests_number ON requests(request_number);
CREATE INDEX IF NOT EXISTS idx_requests_type ON requests(request_type);
CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(current_status);
CREATE INDEX IF NOT EXISTS idx_requests_date ON requests(request_date);
CREATE INDEX IF NOT EXISTS idx_requests_customer ON requests(customer_id);

-- 4. REQUEST ITEMS (child table — multiple items per request)
CREATE TABLE IF NOT EXISTS request_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES requests(id) ON DELETE CASCADE,

  item_type TEXT NOT NULL,   -- battery / charger / keyboard / ssd / ram / motherboard / body_part / speaker / smps / cabinet / mouse / other

  -- Battery / Motherboard: which device it belongs to
  device_model TEXT,         -- e.g. "Dell Inspiron 15" (the laptop/desktop model)

  -- The actual replacement part's own model
  part_model TEXT,

  -- Keyboard-specific
  keyboard_kind TEXT,        -- internal / external / combo

  -- SSD-specific
  ssd_interface TEXT,        -- SATA / M.2 / NVMe
  ssd_size TEXT,             -- 128GB / 256GB / 512GB / 1TB

  -- RAM-specific
  ram_size TEXT,
  ram_type TEXT,             -- DDR2/3/4/5

  -- Body part specific (touchpad, base, panel, hinge)
  body_part_name TEXT,
  device_kind TEXT,          -- laptop / desktop (for motherboard, body parts)

  serial_number TEXT,
  remarks TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_request_items_request ON request_items(request_id);
CREATE INDEX IF NOT EXISTS idx_request_items_type ON request_items(item_type);

-- 5. STATUS TIMELINE (full history, never edited/deleted)
CREATE TABLE IF NOT EXISTS request_status_timeline (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  updated_by UUID REFERENCES users(id),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_timeline_request ON request_status_timeline(request_id);

-- 6. Auto-update updated_at trigger (reuse existing function if present)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at') THEN
    CREATE FUNCTION update_updated_at() RETURNS TRIGGER AS $func$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $func$ LANGUAGE plpgsql;
  END IF;
END $$;

DROP TRIGGER IF EXISTS req_customers_updated_at ON req_customers;
CREATE TRIGGER req_customers_updated_at BEFORE UPDATE ON req_customers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS requests_updated_at ON requests;
CREATE TRIGGER requests_updated_at BEFORE UPDATE ON requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 7. Disable RLS (auth handled via JWT in Express, same as sales tables)
ALTER TABLE req_customers DISABLE ROW LEVEL SECURITY;
ALTER TABLE requests DISABLE ROW LEVEL SECURITY;
ALTER TABLE request_items DISABLE ROW LEVEL SECURITY;
ALTER TABLE request_status_timeline DISABLE ROW LEVEL SECURITY;

-- ============================================================
-- STATUS VALUES REFERENCE (enforced in application code, not DB constraint,
-- so new statuses can be added without a migration)
--
-- REPLACEMENT statuses:
--   received_from_customer
--   sent_for_replacement
--   replacement_received
--   delivered_to_customer
--   closed
--
-- ORDER statuses:
--   order_received
--   order_placed_with_supplier
--   product_reached_office
--   delivered_to_customer
--   closed
-- ============================================================
