-- ==============================================================================
-- MIGRATION V6: STOCK NEEDS MODULE
-- Description: Creates the stock_needs table for tracking out-of-stock items.
-- ==============================================================================

-- 0. Create the helper function if it doesn't exist
CREATE OR REPLACE FUNCTION public.update_modified_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- 1. Create the stock_needs table
CREATE TABLE IF NOT EXISTS public.stock_needs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  item_name TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  photo_data TEXT, -- Base64 string for photo
  status TEXT NOT NULL DEFAULT 'out_of_stock' CHECK (status IN ('out_of_stock', 'order_placed', 'order_received', 'cancelled')),
  created_by UUID REFERENCES public.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Add trigger to auto-update updated_at
DROP TRIGGER IF EXISTS trigger_update_stock_needs_modtime ON public.stock_needs;
CREATE TRIGGER trigger_update_stock_needs_modtime
  BEFORE UPDATE ON public.stock_needs
  FOR EACH ROW
  EXECUTE FUNCTION public.update_modified_column();

-- 3. Row Level Security (RLS)
ALTER TABLE public.stock_needs ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read all stock_needs
DROP POLICY IF EXISTS "Allow authenticated users to read stock_needs" ON public.stock_needs;
CREATE POLICY "Allow authenticated users to read stock_needs"
ON public.stock_needs FOR SELECT
TO authenticated
USING (true);

-- Allow authenticated users to insert stock_needs
DROP POLICY IF EXISTS "Allow authenticated users to insert stock_needs" ON public.stock_needs;
CREATE POLICY "Allow authenticated users to insert stock_needs"
ON public.stock_needs FOR INSERT
TO authenticated
WITH CHECK (true);

-- Allow authenticated users to update stock_needs
DROP POLICY IF EXISTS "Allow authenticated users to update stock_needs" ON public.stock_needs;
CREATE POLICY "Allow authenticated users to update stock_needs"
ON public.stock_needs FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

-- Allow authenticated users to delete stock_needs
DROP POLICY IF EXISTS "Allow authenticated users to delete stock_needs" ON public.stock_needs;
CREATE POLICY "Allow authenticated users to delete stock_needs"
ON public.stock_needs FOR DELETE
TO authenticated
USING (true);
