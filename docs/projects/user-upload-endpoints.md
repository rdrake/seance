# Per-user upload endpoints

_Draft, 2026-09-19. Hypothetical — not scheduled, no branch. Estimate half a
day plus one browser scenario._

## The problem

Uploads are a deploy decision. `config.json` `uploads` names one endpoint for
everyone (`docs/resources/branding.md` § Uploads), and a network's
`draft/FILEHOST` replaces it per network. A user who runs their own host
(Zipline, Chibisafe, a PASTE instance, Nextcloud) — or who uploads documents a
shipped preset refuses (`boxlabs-paste` is image/video only, `catbox-litterbox`
expires) — has no way in short of forking the deploy.

## The design

**A stored per-user `BrandingUploads` that wins over the deploy's.** Same
shape, same normaliser, so a preset name or a full custom block both work and
the wire code in `upload.ts` does not change.

Precedence, highest first:

1. The network's `draft/FILEHOST` (account-attributed, token-gated; the
   network's own service).
2. The user's `thelounge.uploads`.
3. The deploy's `config.json` `uploads`.

Non-image files need nothing new: `acceptsType()` (`upload.ts`) only filters
when a config carries `accept`, and a custom block has none; `UploadPreview.vue`
`kindOf()` shows a filename card for anything that is not image/video/audio.

The constraint no code fixes: **the user's service must answer CORS** for the
Seance origin (`Access-Control-Allow-Origin`; `OPTIONS` too for a live
percentage). The form's help text says so.

## Steps

1. **Storage + normaliser** (~45 min). Export `normalizeUploads` from
   `client/js/branding.ts`. New Vue-free `client/js/helpers/uploadConfig.ts`:
   `loadUserUploads()` / `saveUserUploads(value | null)` on `thelounge.uploads`,
   validated through the normaliser on read (a corrupt entry is `undefined`,
   never a crash). Test: `test/helpers/uploadConfig.ts` via `useStorageBackend`.
2. **Precedence** (~15 min). `storeUploadHost.uploads()` (`upload.ts` ≈ line
   721) returns `loadUserUploads() ?? store.state.branding.uploads`. `filehost()`
   untouched. `Uploader.progressBlocked` is already keyed by endpoint, so a
   changed endpoint gets its own preflight attempt.
3. **Settings form** (~2–3 h). `Settings/General.vue`, under the existing
   "File uploads" heading, above the metadata checkbox:
   - Source select: _Deploy default_ (clears the key) / a shipped preset
     (`UPLOAD_PRESETS`) / _Custom_. Default for a new entry: **Custom**, no
     `accept` list.
   - Custom fields: endpoint (`https` only, inline error otherwise), field name
     (`file`), response URL key (`url`), response error key (`error`), one
     API-key header (name + value), max size in MiB (**default 100**, not the
     code's 10 — the 10 MiB fallback is a screenshot number), progress toggle.
   - Saved as it becomes valid, like `Settings/Aliases.vue`.
   - **Send test file** button: posts a 1×1 PNG through the real `Uploader`,
     shows the returned URL or the error verbatim. The failure mode without
     this is silent.
4. **Backup** (~20 min). `settingsBackup.ts`: carry `thelounge.uploads`; strip
   `headers` unless the "include passwords" box is ticked (API keys live
   there). Test in `test/helpers/settingsBackup.ts`.
5. **Docs + browser check** (~45 min). `docs/resources/branding.md` § Uploads
   gains "Per-user override" with the precedence list and the CORS note;
   `docs/resources/settings-backup.md` lists the key.
   `tools/scenarios/upload-settings.mjs`: fill the form, drop a file, assert the
   POST target on the wire.

## Open questions

- Should a deploy be able to lock this (`features.userUploads: false`)? A
  network that removed `uploads` on purpose may not want its users adding one.
  Cheap: the form hides and `uploads()` skips step 2 when the flag is off.
- One header or a list? One covers every self-hosted uploader surveyed
  (`docs/projects/boxlabs-paste-uploads.md` § Survey); a list is a bigger form
  for no known case.
- Per-network user endpoints (a `uuid → BrandingUploads` map) were considered
  and dropped: nothing asks for it, and `FILEHOST` already covers the
  "this network has its own host" case.

## Status

Parked 2026-09-20: one user has asked for it; not worth building yet. Draft only, not started.
