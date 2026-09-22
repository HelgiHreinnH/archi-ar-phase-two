# Archi AR

WebAR presentation platform for architects and interior designers. Upload a 3D
model from Rhino, print a marker, share an AR experience with a client over a QR
code — no native app required.

Three modes: **Tabletop** (QR flat, model on the table), **Wall** (QR mounted
vertically), **Spatial** (multi-marker triangulation at 1:1 in the real space).

## Stack
Vite · React 18 · TypeScript · Tailwind · shadcn/Radix · MindAR.js 1.2.5 ·
Three.js · Google Model Viewer · Supabase · Netlify.

## Local development

Requires Node 20 (matching CI and Netlify — `nvm use 20`).

```sh
git clone https://github.com/HelgiHreinnH/archi-ar-phase-two.git
cd archi-ar-phase-two
cp .env.example .env.local   # fill in the Supabase values
npm install
npm run dev
```

`.npmrc` carries the install flags this project needs (`legacy-peer-deps` for the
three/model-viewer peer conflict, `ignore-scripts` for jsdom's optional `canvas`
dep). Don't override them ad hoc.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server on :8080 |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run test` | Vitest, single run |
| `npm run lint` | ESLint |
| `npm run build` | Production build to `dist/` |

## Deployment
`main` deploys to [designingforusers.com](https://designingforusers.com) via
Netlify. Pull requests get deploy previews. Build settings live in `netlify.toml`.

See `CLAUDE.md` for the working rules and `MIGRATION.md` for the Supabase
migration runbook.
