# Ailoom

Ailoom is an English-first, Persian-capable, invite-only AI workspace. The current build runs a Next.js web process and dedicated workers for media jobs, storyboard rendering, LoRA training/inference and dubbing. All processes must use the same database and media directory. Supercomputer and billing are outside this release.

## Current capabilities

- Chat is the first screen, supports English and Persian direction, remembers the selected OpenRouter model, and stores private conversations. Conversations can be organized into private projects, moved between them, and filtered by project. For text chats within a project, the project note and short excerpts from recent conversations in that same project are included in the OpenRouter request as memory. Messages can include uploaded images, PDF documents, generated images, and cited web-search results. A PDF attached to chat is sent to OpenRouter for parsing with its Cloudflare AI parser and model response; chat limits each attachment to 10 MB. Signed-in users can record up to one minute of voice in the chat composer; the recording is sent to ElevenLabs transcription and its text is placed into the editable draft for review before sending. Text and image chat requests and media submissions keep request IDs across uncertain responses to avoid repeating paid provider calls automatically.
- Image Studio can create with Kie Nano Banana 2, WaveSpeed Z Image Turbo or fal FLUX.2 Pro, edit a reference image with fal Qwen Image Edit, paint a region mask for WaveSpeed Z Image Turbo Inpaint, keep a private character reference for fal Ideogram Character, and upscale a private reference image 2× or 4× with Topaz Precision through fal. `/image/editor` adds editable text, shape and image layers, ordering, undo/redo, and flattened PNG export or private save. Its editable project autosaves on this device for the signed-in account and can be exported/imported as JSON; the PNG itself has no editable layers. `/lora` accepts a private image ZIP, trains a WaveSpeed FLUX Dev LoRA and creates images with the owned weights. Training and inference have separate queues and do not automatically repeat an uncertain paid submission. Topaz's final price depends on output dimensions and provider account terms.
- Video Studio can create with fal Veo 3.1 Fast or Seedance 2.5, animate a reference image, guide Veo with opening and ending images, and queue a short temporal repair. Repair preserves the untouched video intervals and original audio after the provider returns its edited interval. `/storyboards` saves private shot plans, references and selected clips, then assembles up to 64 completed clips or ten minutes into a private 720p H.264/AAC film. `/video/captions` burns English or Persian SRT/VTT captions into a private MP4 on the local server. A public HTTPS origin is required for provider access to private references; signed reference links are renewed by the worker immediately before submission. Paid reference workflows have not yet been validated on the final host.
- Audio Studio generates speech through the fal Eleven v3 endpoint and music through fal ElevenLabs Music v2 or Stable Audio 3 Small. `/audio/effects` creates private sound effects with fal Stable Audio 3 Small SFX. Its authenticated transcription endpoint accepts MP3, WAV, OGG, MP4 and WebM uploads up to 50 MB and returns Scribe v2 text, detected language and word timings. `/audio/voices` creates an ElevenLabs instant clone from a consented MP3/WAV/OGG sample up to 20 MB and synthesizes private speech with an owned clone. Provider verification may be required before use. `/audio/dubbing` accepts private audio or video, sends a signed source link to ElevenLabs Dubbing v2 and imports its private lossless audio track; the provider returns audio only even when the source is video. Live voice conversation remains future work.
- Explore seeds five private, editable starter workflows per invited account. A workflow runs its chat, image, video and audio steps in order while the Explore page is open, passes private assets to later steps, and resumes saved jobs after a return to the page. Owners can publish or return templates to private. Three editable specialist profiles cover general health, skin and hair, and mental well-being. Specialist chat searches reviewed notes from MedlinePlus, CDC, AAD, WHO and NIMH plus an attributed offline index of 1,017 English MedlinePlus health topics, then displays only the matched reference links cited in its answer. Private questions are not sent to MedlinePlus. The offline snapshot does not cover every medical question or provide clinical-grade advice; unsupported or unverified answers fall back to a clear limitation.
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

For media jobs, start another terminal with `npm run worker:local`. Start separate terminals with `npm run renderer:local`, `npm run worker:lora:local` and `npm run worker:dubbing:local` for storyboard assembly, LoRA and dubbing. These local scripts load `.env`; their production counterparts expect environment variables to be supplied externally, as Docker Compose does. All processes must share `DATABASE_PATH` and `MEDIA_DIR`; their defaults are under ignored `data/`.

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
2. Create a Git-based Docker Compose application using `compose.yaml` on one Coolify server. Assign the final HTTPS domain only to the `web` service on its internal port 3000. Do not expose or assign a domain to any worker.
3. Set `PUBLIC_BASE_URL` to the final HTTPS origin, `BETTER_AUTH_SECRET` to a high-entropy secret of at least 32 characters, and `ADMIN_EMAIL` to the founder's email in Coolify environment variables. Add `OPENROUTER_API_KEY`, `KIE_API_KEY`, `FAL_KEY`, `WAVESPEED_API_KEY`, and `ELEVENLABS_API_KEY` when available. Leave absent providers disabled or expect their jobs to fail cleanly. Never place live values in the repository or Docker image.
4. Deploy and wait for `web` to become healthy and `worker`, `renderer`, `lora_worker` and `dubbing_worker` to run. The web startup applies migrations and seeds the three specialist profiles. Workers also apply migrations on startup. All five services mount the same `ailoom_data` volume.
5. Open a one-time terminal in the running `web` container in Coolify and run `node --import tsx scripts/bootstrap-admin.ts`. If operating from the server's Compose project directory, the equivalent is `docker compose exec web node --import tsx scripts/bootstrap-admin.ts`. The command prints the admin invitation URL only to that terminal. Treat it as a credential: do not include it in deployment logs, support tickets, screenshots, or chat messages. Visit the link personally and create the admin account. Re-running after an account exists is rejected.
6. Test sign-in, one chat message, a queued media job and its saved private result, and a signed private reference on the final domain before relying on automatic deployment. Back up `ailoom_data` consistently; it contains the SQLite database and private media.

SQLite write-ahead logging requires web and worker to share a local volume on one host. The supplied Compose file is for a single server. Move to a server database and object storage before horizontal scaling. The Docker Compose deployment has been validated on the final HTTPS host; signed private-reference and temporal repair workflows still need live provider validation.


