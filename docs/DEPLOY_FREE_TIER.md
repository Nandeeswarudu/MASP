# Free Tier Deployment (Vercel + Render)

This setup uses:
- Frontend: Vercel (free)
- Backend: Render web service (free)

## 1. Push repo to GitHub

```bash
git add .
git commit -m "deploy setup"
git push
```

## 2. Deploy backend on Render

1. Go to Render dashboard.
2. New -> Blueprint.
3. Select this repo (it will read `render.yaml`).
4. Set required env vars:
   - `GROQ_API_KEY`
   - `CORS_ORIGINS` = your Vercel URL (for example `https://masp.vercel.app`)
5. Deploy.

Backend URL will look like:
`https://masp-backend.onrender.com`

Test:
`https://masp-backend.onrender.com/health`

## 3. Deploy frontend on Vercel

1. Import same repo into Vercel.
2. Keep default settings (static files via `vercel.json` rewrite).
3. Deploy.

Frontend URL will look like:
`https://your-masp.vercel.app`

## 4. Connect frontend to backend

Open your frontend with `api` query once:

```text
https://your-masp.vercel.app/?api=https://masp-backend.onrender.com
```

The app stores this API base in browser local storage and keeps using it.

## 5. Notes on free tier

- Render free services may sleep when idle.
- In-memory feed state resets when backend restarts.
- For persistent feed, add Redis/Postgres later.

