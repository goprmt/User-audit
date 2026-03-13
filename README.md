# PRMT User Audit

Multi-tenant SaaS backend for auditing user accounts pulled from third-party software integrations. Built for PRMT staff to manage client organizations and their external app connections (starting with JumpCloud).

## Tech Stack

- **Runtime:** Next.js 15 App Router (API routes only)
- **Hosting:** Vercel Serverless Functions
- **Database:** Supabase (PostgreSQL with Row Level Security)
- **Auth:** Supabase Auth (email + password, JWT)
- **Encryption:** AES-256-GCM for API keys at rest
- **Validation:** Zod on all inputs
- **Scheduling:** Vercel Cron Jobs (monthly sync)

## Setup

### 1. Create a Supabase Project

1. Go to [supabase.com](https://supabase.com) and create a new project
2. Note your **Project URL**, **anon key**, and **service role key** from Settings → API

### 2. Run the Database Migration

Open the Supabase SQL Editor (Dashboard → SQL Editor) and paste the contents of:

```
supabase/migrations/001_initial.sql
```

This creates all tables (`tenants`, `integrations`, `users`, `sync_logs`), indexes, RLS policies, and triggers.

### 3. Create an Auth User

In the Supabase dashboard, go to Authentication → Users and create a user with email + password. This will be your API login account.

### 4. Set Up Environment Variables

Copy `.env.example` to `.env.local`:

```bash
cp .env.example .env.local
```

Fill in the values:

| Variable | Where to find it |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Settings → API → anon public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API → service_role key |
| `ENCRYPTION_KEY` | Generate with: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `CRON_SECRET` | Any random string (must match Vercel settings) |

### 5. Run Locally

```bash
npm install
npm run dev
```

The API is available at `http://localhost:3000/api/...`

### 6. Deploy to Vercel

1. Push the project to a GitHub repo
2. Go to [vercel.com](https://vercel.com) → Import Project → select the repo
3. Add all environment variables in Settings → Environment Variables
4. Vercel auto-detects Next.js and deploys on every push
5. The cron job (`vercel.json`) runs automatically on the 1st of each month

## API Reference

All responses use the shape `{ data, error }`. All endpoints (except auth/login and the cron job) require `Authorization: Bearer <access_token>`.

### Auth

| Method | Path | Description |
|---|---|---|
| POST | `/api/auth/login` | Sign in → returns access token |
| POST | `/api/auth/logout` | Sign out current session |

**Login:**
```json
POST /api/auth/login
{ "email": "admin@prmt.io", "password": "your-password" }
```

### Tenants

| Method | Path | Description |
|---|---|---|
| GET | `/api/clients` | List all clients |
| POST | `/api/clients` | Create a client |
| GET | `/api/clients/:tenantId` | Get client details + counts |

**Create:**
```json
POST /api/clients
{ "name": "Acme Corp", "slug": "acme-corp" }
```

### Integrations

| Method | Path | Description |
|---|---|---|
| GET | `/api/clients/:tenantId/integrations` | List integrations |
| POST | `/api/clients/:tenantId/integrations` | Add integration |
| PUT | `/api/clients/:tenantId/integrations/:integId` | Update integration |
| DELETE | `/api/clients/:tenantId/integrations/:integId` | Remove integration |
| POST | `/api/clients/:tenantId/integrations/:integId/sync` | Manual sync (rate limited) |
| GET | `/api/clients/:tenantId/integrations/:integId/logs` | Sync history |

**Add JumpCloud:**
```json
POST /api/clients/:tenantId/integrations
{
  "appName": "JumpCloud",
  "apiKey": "your-jumpcloud-api-key",
  "baseUrl": "https://console.jumpcloud.com",
  "syncFrequency": "monthly"
}
```

Manual sync is rate limited to **5 requests per 15 minutes** per integration.

### Users

| Method | Path | Description |
|---|---|---|
| GET | `/api/clients/:tenantId/users` | List users (paginated, filterable) |
| GET | `/api/clients/:tenantId/users/summary` | Aggregate counts |

**Query filters** (all optional): `integrationId`, `licenseType`, `isActive` (true/false), `page`, `limit` (max 200).

### Cron

| Method | Path | Description |
|---|---|---|
| GET | `/api/cron/sync` | Monthly sync (Vercel Cron only) |

Secured by `CRON_SECRET` — Vercel sends `Authorization: Bearer <CRON_SECRET>` automatically.

## Project Structure

```
app/
  api/
    auth/login/route.ts          # Sign in
    auth/logout/route.ts         # Sign out
    clients/route.ts             # List / create clients
    clients/[tenantId]/
      route.ts                   # Get tenant details
      users/route.ts             # List users (filtered)
      users/summary/route.ts     # User count aggregates
      integrations/route.ts      # List / create integrations
      integrations/[integId]/
        route.ts                 # Update / delete integration
        sync/route.ts            # Manual sync trigger
        logs/route.ts            # Sync log history
    cron/sync/route.ts           # Vercel cron endpoint
src/
  lib/
    supabase.ts                  # Supabase client (anon + admin + user-scoped)
    auth.ts                      # Session extraction helper
    crypto.ts                    # AES-256-GCM encrypt/decrypt
    validation.ts                # Zod schemas
    ratelimit.ts                 # In-memory rate limiter
    sync.ts                      # Sync orchestration logic
  integrations/
    jumpcloud.ts                 # JumpCloud API adapter
    index.ts                     # Adapter registry
  types/
    index.ts                     # Shared interfaces
supabase/
  migrations/001_initial.sql     # Full schema + RLS policies
vercel.json                      # Cron schedule config
```

## Adding a New Integration

1. Create `src/integrations/<appname>.ts` implementing the `IntegrationAdapter` interface
2. Register it in `src/integrations/index.ts`
3. That's it — the sync service, cron job, and manual sync endpoint all pick it up automatically

## Security

- **API keys encrypted at rest** with AES-256-GCM (authenticated encryption)
- **Supabase Auth** for JWT-based authentication on every route
- **Row Level Security** enabled on all tables
- **Multi-tenant isolation** — every query scoped by `tenant_id`
- **Rate limiting** on the manual sync endpoint
- **Cron endpoint** secured by `CRON_SECRET` header
- **Zod validation** on all request bodies and query parameters
