# Ailoom

Ailoom is an English-first, Persian-capable, invite-only AI workspace. The current build runs a Next.js web process and a separate SQLite media worker. Both processes must use the same database and media directory. Supercomputer and billing are outside this release.

## Current capabilities

- Chat is the first screen, supports English and Persian direction, remembers the selected OpenRouter model, and stores private conversations. Messages can include uploaded images, PDF documents, generated images, and cited web-search results. A PDF attached to chat is sent to OpenRouter for parsing with its Cloudflare AI parser and model response; chat limits each attachment to 10 MB.
- Image Studio can create with Kie Nano Banana 2, WaveSpeed Z Image Turbo or fal FLUX.2 Pro, edit a reference image with fal Qwen Image Edit, and upscale a private reference image 2× or 4× with Topaz Precision through fal. Topaz's final price depends on output dimensions and provider account terms.
- Video Studio can create with fal Veo 3.1 Fast or Seedance 2.5, animate a reference image, guide Veo with opening and ending images, and queue a short temporal repair. Repair preserves the untouched video intervals and original audio after the provider returns its edited interval. A public HTTPS origin is required for provider access to private references; paid reference workflows have not yet been validated on the final host.
- Audio Studio generates speech through the fal Eleven v3 endpoint and music through fal ElevenLabs Music v2 or Stable Audio 3 Small. Its authenticated transcription endpoint accepts MP3, WAV, OGG, MP4 and WebM uploads up to 50 MB and returns Scribe v2 text, detected language and word timings. Voice cloning, dubbing and live voice remain future work.
- Explore seeds five private, editable starter workflows per invited account. A workflow runs its chat, image, video and audio steps in order while the Explore page is open, passes private assets to later steps, and resumes saved jobs after a return to the page. Owners can publish or return templates to private. Three editable specialist profiles cover general health, skin and hair, and mental well-being.
- Administrators can create and revoke one-time user or admin invitations in the `/admin` page; invitation links appear only once when created.
- Signed-in users can download a private JSON export of their own profile, projects, conversations, messages, media metadata, generation history and Explore templates from the header. The export lists an authenticated download path for each media file; binary media files are downloaded individually.

Provider availability, price, account entitlement and output rights can change. The model registry exposes only request schemas we have mapped; additional models can be added without changing the stored job format. `docs/SEEDANCE_2_5.md` records that provider's current controls and estimate limits.

## Local development

Install Node.js 24. Copy `.env.example` to `.env`, then set `BETTER_AUTH_SECRET` to a random value of at least 32 characters, `ADMIN_EMAIL` to your email, and `PUBLIC_BASE_URL` / `BETTER_AUTH_URL` to `http://localhost:3000`. Add provider keys only to `.env`. Never commit or paste live values into issues, chats, or build logs.

Run from the repository root:

~~~sh
npm ci
node --env-file=.env --import tsx scripts/migrate.ts
node --env-file=.env --import tsx scripts/seed-specialists.ts
node --env-file=.env --import tsx scripts/bootstrap-admin.ts
npm run dev
~~~

The bootstrap command creates a one-time admin invitation and prints its URL. Open it yourself to set the admin password. Keep the URL private; it grants account creation for `ADMIN_EMAIL` and expires after seven days. Run bootstrap only before the first account exists. If the terminal scrollback or logs are shared, clear them after using the link.

For media jobs, start a second terminal with `npm run worker:local`. That script loads `.env` for the separate process. `npm run worker` expects environment variables to be supplied externally, as Docker Compose does. Web and worker must share `DATABASE_PATH` and `MEDIA_DIR`; their defaults are under ignored `data/`.

Local chat and text-to-media generation can use their provider keys. Provider access to private input files and temporal video repair require a reachable public HTTPS `PUBLIC_BASE_URL`; the app returns a clear error for these routes on localhost. Keep `.env` out of Git and keep generated files and SQLite under `data/`.

Verification:

~~~sh
npm test
npm run typecheck
npm run build
node --import tsx scripts/smoke-auth.ts
~~~

## Coolify deployment

1. Connect the GitHub repository to Coolify through its GitHub App for push-triggered deployments. A public repository added only by HTTPS URL needs a separate GitHub webhook for automatic deployment.
2. Create a Git-based Docker Compose application using `compose.yaml` on one Coolify server. Assign the final HTTPS domain only to the `web` service on its internal port 3000. Do not expose or assign a domain to `worker`.
3. Set `PUBLIC_BASE_URL` to the final HTTPS origin, `BETTER_AUTH_SECRET` to a high-entropy secret of at least 32 characters, and `ADMIN_EMAIL` to the founder's email in Coolify environment variables. Add `OPENROUTER_API_KEY`, `KIE_API_KEY`, `FAL_KEY`, `WAVESPEED_API_KEY`, and `ELEVENLABS_API_KEY` when available. Leave absent providers disabled or expect their jobs to fail cleanly. Never place live values in the repository or Docker image.
4. Deploy and wait for `web` to become healthy and `worker` to run. The web startup applies migrations and seeds the three specialist profiles. The worker also applies migrations on startup. Both services mount the same `ailoom_data` volume.
5. Open a one-time terminal in the running `web` container in Coolify and run `node --import tsx scripts/bootstrap-admin.ts`. If operating from the server's Compose project directory, the equivalent is `docker compose exec web node --import tsx scripts/bootstrap-admin.ts`. The command prints the admin invitation URL only to that terminal. Treat it as a credential: do not include it in deployment logs, support tickets, screenshots, or chat messages. Visit the link personally and create the admin account. Re-running after an account exists is rejected.
6. Test sign-in, one chat message, a queued media job and its saved private result, and a signed private reference on the final domain before relying on automatic deployment. Back up `ailoom_data` consistently; it contains the SQLite database and private media.

SQLite write-ahead logging requires web and worker to share a local volume on one host. The supplied Compose file is for a single server. Move to a server database and object storage before horizontal scaling. The Docker Compose deployment has been validated on the final HTTPS host; signed private-reference and temporal repair workflows still need live provider validation.


