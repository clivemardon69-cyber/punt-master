# Punt Master — deployment guide

A free, private, odds-weighted Premier League predictor. This guide assumes
no coding experience — just follow the steps in order.

## What you're setting up

- **Supabase** — a free database that stores your leagues, members, fixtures and picks
- **Vercel** — free hosting that puts your app on a real web address
- **GitHub** — where the code lives so Vercel can deploy it (also free)

Total cost: £0, until you outgrow the free tiers (which, for a friends-and-family
league, won't happen).

---

## Step 1 — Create your Supabase project

1. Go to supabase.com and sign up (free, no card needed)
2. Click "New project" — pick any name (e.g. "punt-master"), set a database
   password (save it somewhere), pick the region closest to you
3. Wait ~2 minutes for it to spin up
4. In the left sidebar, go to **SQL Editor** → **New query**
5. Open `supabase-schema.sql` from this project, copy all of it, paste it into
   the editor, click **Run**
6. Go to **Project Settings** (gear icon) → **API**. You'll need two values
   from this page in Step 3:
   - **Project URL**
   - **anon public** key

## Step 2 — Put the code on GitHub

1. Go to github.com and sign up if you don't have an account
2. Click "New repository", name it `punt-master`, keep it **private**,
   click "Create repository"
3. Upload all the files from this project folder using the "uploading an
   existing file" link on the new repo's page (drag the whole folder in)

## Step 3 — Deploy on Vercel

1. Go to vercel.com, sign up using your GitHub account
2. Click "Add New" → "Project", select your `punt-master` repo
3. Before clicking Deploy, expand **Environment Variables** and add:
   - `VITE_SUPABASE_URL` → paste your Project URL from Step 1
   - `VITE_SUPABASE_ANON_KEY` → paste your anon public key from Step 1
4. Click **Deploy**. After ~1 minute you'll get a live link like
   `punt-master.vercel.app` — that's your app, live and free

## Step 4 — Test it

Open the link, create a league, open it again on your phone, join with the
code, make a pick. If picks and standings show up on both devices, you're done.

---

## Notes

- **Privacy**: nobody can find a league without its code — enforced by the
  database itself, not just the app's screens (data can only be reached by
  already knowing a real code, or an ID chained from one). Anyone with the
  code can join, so treat the code like an invite link.
- **No accounts/emails**: players set a name + password per league (no email,
  ever) — the password just lets them get back into their own picks on a
  different device by re-entering name/password/code. Nothing here needs
  registering with the ICO.
- **Existing Supabase project?** If it predates this password/read-lockdown/
  archiving/admin-tools/lockout setup, run `supabase-migration-6.sql`
  through `supabase-migration-10.sql`, in order, once each in the SQL
  Editor. New projects get all of this automatically from
  `supabase-schema.sql`.
- **Brute-force lockout**: 5 wrong password or PIN attempts locks that name
  (or that league's admin PIN) out for 15 minutes — resets automatically on
  the next correct attempt, no action needed from you.
- **Inactive players**: after 8 gameweeks without a submitted prediction, a
  player is flagged "inactive" in standings — nothing is deleted, their
  history and points stay exactly as they were.
- **Custom domain**: once you're happy with it, Vercel lets you attach a real
  domain (e.g. puntmaster.co.uk) for free — you'd just pay for the domain
  itself (~£10/year from a registrar).
- **Scaling**: Supabase's free tier covers up to 50,000 monthly active users
  and 500MB of data — far beyond what you'll need to start.

If you get stuck on any step, come back with the error message and I'll help
you through it.
