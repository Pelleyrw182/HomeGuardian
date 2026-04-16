# HomeGuardian

HomeGuardian helps busy homeowners stay ahead of home maintenance with a single dashboard for account-based access, persistent task tracking, and AI maintenance guidance.

> **Value proposition:** Stop worrying about what might break next. We take care of the small fixes, routine upkeep, and surprise issues—so your home stays running smoothly without the stress or last-minute scrambling.

## MVP Features

- **Authentication**: Email/password sign-up and login (Supabase Auth)
- **Persistence**: Home profile and maintenance tasks are stored per user (Supabase Postgres)
- **Core business functionality**: AI-powered maintenance guidance based on the user’s home profile + active tasks (OpenRouter)
- **User dashboard**: Personalized stats, task manager, profile editor, and assistant panel
- **Fallback demo mode**: If Supabase env vars are missing, the app still runs locally with localStorage data so you can view the product immediately

## Tech Stack

- Frontend: React + TypeScript + Vite
- Authentication & Database: Supabase
- LLM Provider: OpenRouter
- Deployment: Netlify (with serverless function)
- Runtime: **Node 20.19.0+**

## Quick Start (Local)

1. **Use Node 20.19.0+**
2. Install dependencies:

   ```bash
   npm install
   ```

3. Create env file:

   ```bash
   cp .env.example .env
   ```

4. Fill `.env` with your Supabase/OpenRouter keys if you want full cloud-backed behavior.
   - Without keys, the app still runs in demo mode for local viewing.

5. Start the app:

   ```bash
   npm run dev
   ```

6. Open the printed local URL (usually `http://localhost:5173`).

## Supabase Setup

Create these tables in Supabase SQL editor:

```sql
create table if not exists home_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  home_type text,
  build_year int,
  household_size int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists maintenance_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  details text,
  due_date date,
  status text not null default 'open' check (status in ('open', 'done')),
  created_at timestamptz not null default now()
);

alter table home_profiles enable row level security;
alter table maintenance_tasks enable row level security;

create policy "Users can manage their own profile"
on home_profiles
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can manage their own tasks"
on maintenance_tasks
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
```

## Environment Variables

See `.env.example`.

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `OPENROUTER_API_KEY`
- `OPENROUTER_MODEL` (optional; defaults to `openai/gpt-4o-mini`)

## Netlify Deployment

1. Connect this repository to Netlify.
2. Ensure build settings are read from `netlify.toml`.
3. Add all environment variables in Netlify project settings.
4. Deploy.

The app uses a Netlify Function at `/.netlify/functions/home-assistant` (via `/api/home-assistant` redirect) to call OpenRouter securely.

## Scripts

- `npm run dev` — local dev server
- `npm run build` — production build
- `npm run lint` — ESLint
- `npm run preview` — preview production build
