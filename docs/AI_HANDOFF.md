# AI Handoff

> Historical reference only. The current handoff source of truth is `docs/HANDOFF.md`.

## Project Goal

This project is a workflow console for overseas influencer marketing operations.
It helps the operator manage YouTube creator discovery, Gmail outreach, negotiation follow-up, Feishu base records, product information, and AI-assisted decisions in one web app.
The core user is a cross-border e-commerce influencer marketing specialist who wants to reduce repetitive email and record-keeping work.
The product should keep the human in control: AI can analyze, draft, preview updates, and prepare writes, but destructive or external writes require user confirmation.
Current priority is practical desktop productivity, not a marketing landing page.
The UI direction is a clean, dense, light Glassmorphism workbench.

## Tech Stack

- Next.js 16 App Router, React 19, TypeScript 5.
- Tailwind CSS 4 plus shadcn/ui and Radix UI primitives.
- `lucide-react` for icons; `@dnd-kit` for kanban drag/drop.
- Supabase is used for login, cloud settings, and user secret storage through `src/lib/supabase/client.ts`, `src/lib/supabase/server.ts`, and RPC helpers in `src/lib/user-private-storage.ts`.
- Gmail, Feishu, YouTube, AI, translation, secrets, and agent actions are exposed through `src/app/api/**` routes.
- Local state still exists through `localStorage` helpers in `src/lib/data.ts`; cloud sync is incremental, not a full database migration.

## Current Status

- Dashboard shell has been refactored into a glass-style workspace with grouped left navigation.
- Gmail OAuth, inbox, unread/starred/sent/draft views, pagination, read/unread toggles, delayed send, draft save, direct send, forwarding, attachment support, rich reply editor, translation, and AI-assisted reply flows exist.
- Gmail list/detail layout supports full-width list before opening a thread, then split list/detail view after selection.
- Feishu OAuth connection, table inspection, field mapping, and record writeback preview/confirmation are implemented.
- AI Agent floating assistant can read context, create pending writeback previews, and execute only after user confirmation.
- Product database, brand info, prompt manager, YouTube API settings, and creator prospecting desk exist.
- Creator prospecting desk accepts YouTube links, resolves channel data, shows avatars and recent videos, generates outreach drafts, and can write selected leads to Feishu or Gmail drafts.

## Recently Changed Files

- `src/components/ui/button.tsx`: shared button interaction states, hover shadow, pressed feedback, disabled behavior.
- `src/components/ui/select.tsx`: shared select trigger hover/click affordance.
- `src/app/globals.css`: global cursor rules and glass/workbench styling.
- `src/app/page.tsx`: main shell, top bar, sidebar navigation, and view routing.
- `src/components/gmail-inbox.tsx`: Gmail list, category tabs, unread behavior, pagination, list/detail transition.
- `src/components/email-detail.tsx`: email thread display, translation, reply action area, creator profile strip.
- `src/components/creator-prospecting-page.tsx`: YouTube lead import, channel cards, recent video display, Feishu/Gmail actions.
- `src/components/settings-panel.tsx`: integration settings container for Gmail, Feishu, YouTube, AI model, brand, products, and send delay.
- `src/components/record-assistant-provider.tsx`: event capture and AI-assisted record sync UI.
- `src/lib/feishu-mapping.ts`: Feishu field target definitions and auto-mapping rules.
- `src/lib/record-assistant.ts`: event/rule/update model for AI-assisted record writes.
- `src/lib/data.ts`: local/cloud settings, app settings shape, products, Gmail and prompt settings.

## Data Model / Business Logic Notes

- Kanban influencer statuses in `src/lib/types.ts`: `talent_pool`, `pending`, `contacted`, `interested`, `negotiating`, `confirmed`, `sampling`, `filming`, `published`, `archived`.
- Business flow: manual/YouTube discovery -> creator profile -> pending contact -> outreach -> contacted -> interested -> price/format negotiation -> confirmed -> sample sent -> filming -> published -> review/archive.
- `Influencer` stores channel name, URL, email, country, followers, category, rating, notes, and kanban status.
- `Product` supports multiple `ProductMarketProfile` entries for different markets/sites; fields are intentionally natural-language friendly.
- Feishu mapping is the bridge between internal semantic keys and real Feishu field names. Do not assume Chinese field names are fixed; always use saved mapping when writing.
- `description` / channel intro was intentionally removed from Feishu write previews after the user decided not to store it in the main Feishu base.
- AI-assisted record system currently recognizes events such as `email_sent`, `status_changed`, and `draft_saved`; it builds pending updates from rules and only writes after confirmation.
- Gmail unread logic should respect Gmail labels. Opening an unread thread can mark it read; if the user manually marks it unread again, it must stay treated as normal unread.
- YouTube API can return public channel data and recent videos, but not hidden emails. Emails are only extracted from public channel description text.

## Known Issues / Risks

- Some source files still contain mojibake-looking Chinese strings in code output; many render correctly due escaped strings, but text quality should be audited gradually.
- Supabase stores user settings and secrets for convenience; encryption was deferred by user request. Treat this as acceptable for MVP, not final security posture.
- Feishu permissions and user re-authorization are fragile: missing scopes can make table inspection/writeback fail even when the account appears connected.
- Gmail freshness, unread filters, and thread ordering have been improved repeatedly; regressions are likely if query logic is changed without comparing against official Gmail behavior.
- YouTube API quota is limited. Avoid excessive batch enrichment and keep recent video fetches modest.
- Gmail creator channel avatars currently use browser `localStorage` caching only; the Gmail list prefetches current-page matched creator avatars with limited concurrency and reuses the same cache in thread detail. Future upgrade can add a Supabase server cache such as `youtube_channel_cache` with `channel_key`, `channel_id`, `channel_url`, `title`, `avatar_url`, `fetched_at`, `expires_at`, and `last_error`; this requires explicit user confirmation because it changes database structure.
- Creator prospecting custom URL/handle resolution can fail for unusual YouTube URLs; keep error messages actionable.
- Do not auto-send outreach or auto-write Feishu records without explicit user confirmation.

## Next Recommended Tasks

1. Stabilize Gmail correctness: compare inbox/unread/primary sorting against official Gmail, especially manual unread and replied-thread cases.
2. Finish creator prospecting v1 polish: robust YouTube URL parsing, clearer failed-resolution reasons, recent-video cards, batch preview, and duplicate detection against Feishu.
3. Expand Feishu multi-table support for four bases: main creator library, outreach log, collaboration records, and video publishing/performance records.
4. Improve AI Agent action model: richer read-only reports first, then confirmed writes with durable success/failure logs.
5. Consider upgrading Gmail creator avatars from browser-only cache to a shared Supabase server cache to further reduce YouTube API quota usage across devices.
6. Audit UI text and interaction quality after functional stabilization: remove mojibake, align copy, and keep dense glass workbench consistency.

## Do Not Repeat These Mistakes

- Do not hard-code Feishu field names. Always go through field mapping and gracefully handle missing mappings.
- Do not write channel description to Feishu unless the user explicitly adds that field back.
- Do not treat "replied by me" as equivalent to "read"; manual Gmail unread state must remain valid.
- Do not assume YouTube API exposes creator email. Only public description parsing is available.
- Do not present DeepSeek as built-in. The user supplies model API credentials through settings or environment-backed secrets.
- Do not run broad repository scans when a focused file read is enough; this project has many large UI files.
- Do not use destructive git or filesystem commands. The user often has local uncommitted work and commits through GitHub Desktop.
- Do not prioritize visual flourish over dense operational clarity. This is a B2B workbench, not a landing page.
