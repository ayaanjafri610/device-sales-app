-- ============================================================
-- MIGRATION v5 — PHOTO ATTACHMENT FOR REQUESTS
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- Adds photo_data column to store compressed base64 images of the device/part
-- ============================================================

ALTER TABLE requests ADD COLUMN IF NOT EXISTS photo_data TEXT;
