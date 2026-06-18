# episodic (web)
TV episode tracking web app — Next.js 15, Clerk auth, Neon DB.

> Next.js 15 has breaking changes. Check `node_modules/next/dist/docs/` before assuming APIs match training data.

## Stack
- Next.js 15 App Router, React 19, TypeScript, Turbopack
- Clerk (auth)
- Neon (Postgres)

## Verify
`npm run build` — run after every edit.

## Danger Zones
- **Clerk auth config**: never touch without explicit approval
- **DB schema**: confirm migrations before applying

## Subagents
Spawn an Explore subagent for any file search, grep, or broad codebase exploration — keeps the main context window clean.

## Notes
- Dev uses infisical for secrets: `npm run dev` requires infisical CLI
- For local dev without infisical: `npm run dev:local`
- iOS companion app in `episodic-ios/`
