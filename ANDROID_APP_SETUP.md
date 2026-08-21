# Wrapping this into an Android App (APK) — Bubblewrap / TWA

This app is now a proper PWA (`manifest.json` + `service-worker.js` +
icons were added — everything else is unchanged). A **TWA (Trusted Web
Activity)** wraps that PWA into a real installable Android app with no
browser address bar, using Google's official `Bubblewrap` tool.

## Requirement: the app must be hosted at a real HTTPS URL first

A TWA cannot wrap local files — it loads your live site (e.g. GitHub
Pages) inside the Android app, then caches it offline via the service
worker already added. So:

1. **Deploy this whole folder to GitHub Pages.**
2. Everything below uses that URL — replace `YOUR-DOMAIN` with it
   wherever you see it.

### Already have ELDS at `USERNAME.github.io` (root)? Read this first.

Since your ELDS repo already owns the root user-page
(`USERNAME.github.io`), **do not** create a second `USERNAME.github.io`
repo for this app — GitHub only allows one per account. Instead:

1. Put this Substitute Timetable app in its **own separate repo** —
   any name, e.g. `substitute-timetable`. Enable GitHub Pages for that
   repo too (Settings → Pages → main / root). It will be served at:
   ```
   https://USERNAME.github.io/substitute-timetable/
   ```
   This works fine alongside your ELDS user-page site — GitHub Pages
   supports one root user-page repo + any number of project repos, all
   under the same `USERNAME.github.io` domain.

2. **`.well-known/assetlinks.json` still must live in ONE place: the
   root, which is your existing ELDS repo** — not in this new
   `substitute-timetable` repo (a `.well-known` folder there would only
   be reachable at `/substitute-timetable/.well-known/...`, which
   Android ignores; it always checks the true root).

3. Since both apps share the same root, **one `assetlinks.json` file
   lists both of them** as separate entries in the same JSON array — it
   is *not* one-file-per-app. Open the `assetlinks.json` already
   published in your ELDS repo, and add this app's entry alongside
   ELDS's existing one (the template in this folder,
   `.well-known/assetlinks.json`, already shows the two-entry shape —
   copy the second entry into your ELDS repo's file, fill in this app's
   package name + fingerprint from Steps 2–3 below, and re-publish it
   from the ELDS repo). Confirm `https://USERNAME.github.io/.well-known/assetlinks.json`
   still loads and now shows both entries.

4. Everything else below is unchanged — `bubblewrap init` still points
   at *this app's* manifest URL
   (`https://USERNAME.github.io/substitute-timetable/manifest.json`),
   producing a completely separate APK/package name from ELDS.

---



**A. `.well-known/assetlinks.json` must sit at the ROOT of your domain**
(`https://USERNAME.github.io/.well-known/assetlinks.json`), not under a
repo subfolder — Android always checks the root, no matter where the
app itself lives.

- If `USERNAME.github.io` is free (no other site there yet): name your
  repo exactly `USERNAME.github.io` and push everything straight into
  it — the whole app AND `.well-known/assetlinks.json` serve from the
  root automatically.
- **If you already have another app at `USERNAME.github.io`** (e.g.
  ELDS) — see the "Already have ELDS..." section above; use a separate
  project repo for this app's files, but keep `.well-known/assetlinks.json`
  in the existing root repo, with both apps listed in it.

**B. Add the included `.nojekyll` file to the repo root(s) that serve
`.well-known/`.** GitHub Pages runs Jekyll by default, which
**ignores dotfiles/dotfolders** — meaning `.well-known/` would silently
not get published without this file. It's already included in this
folder; just make sure it ends up committed in whichever repo needs it
(some Git clients hide dotfiles — use `git add -A` or enable "show
hidden files"). Your existing ELDS repo needs its own `.nojekyll` too if
it doesn't already have one.

Then in the repo: **Settings → Pages → Source → Deploy from branch →
main / root** and wait a minute for it to publish.


## Step 1 — Install Bubblewrap

You need Node.js 18+ and a JDK installed, then:

```bash
npm install -g @bubblewrap/cli
```

## Step 2 — Initialize the Android project

```bash
bubblewrap init --manifest=https://YOUR-DOMAIN/manifest.json
```

It will ask a few questions — sensible defaults:
- **Application ID (package name)**: e.g. `pk.edu.yourschool.substitutett`
  (reverse-domain style; this becomes your unique Android package name —
  needed again in Step 3)
- **App name / Launcher name**: "Substitute TT" or your school's name
- **Display mode**: `standalone`
- It will offer to **generate a signing keystore** for you — do that
  (keep `android.keystore` and its password safe; you need the *same*
  keystore for every future update of this app).

## Step 3 — Get your APK's SHA256 fingerprint

```bash
keytool -list -v -keystore android.keystore -alias android -storepass <your-keystore-password>
```

Copy the **SHA256** fingerprint it prints (looks like
`14:6D:E9:...`) — remove the colons or keep them, Google accepts both,
but be consistent.

## Step 4 — Host the Digital Asset Links file

Take `dot-well-known/assetlinks.json` from this project, fill in:
- `package_name` → the Application ID from Step 2
- `sha256_cert_fingerprints` → the fingerprint from Step 3

Then **upload it to your host so it's reachable at exactly**:
```
https://YOUR-DOMAIN/.well-known/assetlinks.json
```
(On GitHub Pages, see the "Hosting on GitHub Pages" section above — the
file must be at your domain's root, and you need the included
`.nojekyll` file or GitHub will hide it. On Netlify: just put it at
`.well-known/assetlinks.json` in the folder you deploy.)

Verify it's correct: open that URL in a browser and confirm it returns
the JSON (not a 404). This is what removes the browser address bar and
makes the app feel fully native.

## Step 5 — Build the APK

```bash
bubblewrap build
```

This produces `app-release-signed.apk`. Install it on an Android phone
(`adb install app-release-signed.apk`) or upload it to the Google Play
Console to publish it properly.

## Updating the app later

- Change your app files → redeploy to your host → **bump `CACHE_NAME`**
  in `service-worker.js` (e.g. `v1` → `v2`) so installed devices pick up
  the new version instead of serving the old cached copy.
- The Android wrapper itself (the APK) rarely needs rebuilding — it just
  loads your live URL, so most updates only need a redeploy + cache
  bump, not a new APK. Rebuild the APK only if you change the app
  name/icon/manifest, or need a new signed release for the Play Store.

## Offline behavior

Once a device has opened the app once (inside the APK or a normal
browser) while online, `service-worker.js` caches the app shell
(HTML/CSS/JS/icons) so the Timetable, Admin Panel, and — for a
previously-synced teacher — the Teacher Dashboard keep working with no
internet, exactly as designed. Firebase calls (login, Sync Now,
notifications) still need internet, same as before.

---

*Tell me your GitHub username / repo name once Pages is live and I'll
fill in the exact `bubblewrap init` command and package name for you.*
