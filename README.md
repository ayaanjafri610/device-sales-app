# 📦 Device Sales Tracker

Full-stack device sales management app — Node.js + Express + Supabase + vanilla JS frontend.

## 🗂 Project Structure

```
device-sales-app/
├── backend/
│   ├── server.js              ← Express server entry point
│   ├── supabase.js            ← Supabase client
│   ├── middleware/auth.js     ← JWT auth middleware
│   └── routes/
│       ├── auth.js            ← Login / seed users
│       └── sales.js           ← All sales CRUD + summary
├── frontend/
│   └── index.html             ← Single page UI (self-contained: HTML+CSS+JS)
├── database/
│   └── schema.sql             ← Run this in Supabase SQL Editor first
├── .env                       ← Already has your Project URL — add your SECRET key
├── package.json
└── README.md
```

## 🚀 Setup — Quick Start

### 1. Install dependencies
```bash
npm install
```

### 2. Run the database schema (if not done already)
Open Supabase Dashboard → **SQL Editor** → New Query → paste the entire contents of
`database/schema.sql` → Run.

**Already have data in your `sales` table from before?**
Run `database/migration_v2.sql` instead — it safely adds the new columns
(generation, store, split-payment amounts) without touching your existing rows.

**Already have data from v1 or v2?**
Run `database/migration_v2.sql` — it now includes both the v2 (generation/store/split-payment)
and v3 (RAM type, SSD interface/generation) columns in one file. Safe to run on existing data.

## ✨ What's New (v4)

- **Branding** — rebranded from generic "SalesTrack" to Benefit Computer, with a custom
  power-icon logo mark (orange ring + line, matching your shop banner) in the login screen
  and topbar, plus an orange/cyan color theme pulled from your actual shop signage
  (replacing the previous generic purple)
- **Monthly sales trend chart** (admin only) — a line chart showing net revenue and sales
  count per month for a selected year, plotted on dual scales. A compact preview sits on
  the dashboard with a year label; clicking "Expand" opens a larger dialogue version with
  a year dropdown and a legend. Hover any point for the exact revenue/count for that month.
  New API endpoint: `GET /api/sales/monthly-trend?year=2026` (admin only)

## ✨ What's New (v3)

- **Fixed:** store filter (Store No 122/123 / Store No 67) wasn't working — caused by a duplicate
  HTML element ID shared between the filter dropdown and the form's store field. Now fixed with
  unique IDs for each.
- **RAM Type** — new dropdown (DDR2 / DDR3 / DDR4 / DDR5 / custom), shown merged into the RAM
  column in the table (e.g. "8 GB DDR4")
- **SSD Interface & Generation** — two-step dropdown: pick interface (SATA / M.2 / NVMe) first;
  if NVMe is selected, a second dropdown appears for generation (Gen2–Gen5). Shown merged into
  the SSD column (e.g. "512 GB NVMe Gen4")

## ✨ What's New (v2)

- **Generation field** — dropdown for processor generation (11th Gen, Ryzen 5000 Series, etc.)
- **Store/Shop field** — track which shop made the sale (Store No 122/123 or Store No 67), filterable
- **"Other" device type** — when selected, Model/Processor/RAM become optional
- **Split payment** — Cash + Online combined payment with separate amount entry, plus a payment breakdown (cash/online/credit totals) for admins
- **Role-based visibility** — only `admin` role users can see total sales figures, the payment breakdown, and the Edit/Delete buttons. Regular `user` role employees only see the raw entries table
- **Created By column** — shows which user logged each entry
- **Reordered table columns** to match your requested layout, with HDD/Monitor columns auto-hiding when no entry has that data
- **Mobile/tablet responsive layout** — summary cards stack on small screens, table scrolls horizontally
- **Edit/Delete as icon buttons** (admin only)
- **Loads current month's data automatically** on every login

### 3. Add your Secret Key to `.env`
Open the `.env` file in this folder. The `SUPABASE_URL` is already filled in for you.
You just need to replace `PASTE_YOUR_SECRET_KEY_HERE` with your real secret key:

- Go to: Supabase Dashboard → Settings → **API Keys**
- Under **Secret keys**, click the eye icon to reveal it, then copy it
- It looks like: `sb_secret_xxxxxxxxxxxxxxxxxxxx`
- Paste it into `.env` replacing the placeholder

⚠️ Do NOT use the `sb_publishable_...` key here — that one is for browsers only.
This app's backend needs the **secret** key since it does all security via JWT.

### 4. Start the server
```bash
npm start
```
App runs at: **http://localhost:3000**

### 5. Create your users (one-time)
With the server running, in a new terminal:
```bash
curl -X POST http://localhost:3000/api/auth/seed
```

Default users created:

| Name        | Email             | Password   | Role  |
|-------------|-------------------|------------|-------|
| Admin User  | admin@store.com   | Admin@123  | admin |
| Sales User1 | sales1@store.com  | Sales@123  | user  |
| Sales User2 | sales2@store.com  | Sales2@123 | user  |

> Change these passwords (edit `backend/routes/auth.js`) and consider
> removing the `/seed` route after first use.

### 6. Login & use
Open http://localhost:3000 and log in with any of the above accounts.

## 🔌 API Reference

| Method | Endpoint             | Description                      | Auth |
|--------|----------------------|-----------------------------------|------|
| POST   | /api/auth/login       | Login, returns JWT                | ❌   |
| GET    | /api/auth/me          | Current user info                 | ✅   |
| POST   | /api/auth/seed        | Create default users (run once)   | ❌   |
| GET    | /api/sales            | List sales (supports filters)     | ✅   |
| POST   | /api/sales            | Create new sale                   | ✅   |
| GET    | /api/sales/summary     | Totals & count for a period       | ✅   |
| GET    | /api/sales/:id         | Get single sale                   | ✅   |
| PUT    | /api/sales/:id         | Update a sale                     | ✅   |
| DELETE | /api/sales/:id         | Delete a sale                     | ✅   |

Filters (on `/api/sales` and `/api/sales/summary`):
`?month=6&year=2025&customer_name=John&mobile=9876`

## 🔒 Security Notes
- Never commit `.env` to Git (it already has your real project URL in it)
- Disable/remove the `/api/auth/seed` route after creating your users
- Use a long random `JWT_SECRET` in production
