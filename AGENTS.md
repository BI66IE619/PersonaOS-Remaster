<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Project conventions

## Always end every update with the push commands

Every time an update is finished, end the message with the git commands to ship it,
formatted like:

```powershell
git add .
git status
git commit -m "<concise message for this change>"
git push
```

Vercel deploys automatically on push, so this is how work reaches production. If the
change also touched `android/`, note that the APK needs rebuilding too. The user
asked for this on every update, not just some.

<!-- END:project-conventions -->
