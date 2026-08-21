# School Substitute Teacher Management System — Browser Edition

## How to open this app

**Just double-click `index.html`.** It opens in your normal web browser
(Chrome/Edge). No installation, no Node.js, no Electron, nothing else
needed.

**bas `index.html` per double-click karein** — yeh aapke normal browser
mein khul jaye gi. Koi install ki zaroorat nahi, Node.js ya Electron ki
bhi zaroorat nahi.

That's it. All four files (`index.html`, `style.css`, `script.js`,
`storage.js`) must stay together in the same folder — don't move or
rename them individually.

---

## Where your data lives

All data (school profile, teachers, timetables, attendance, substitute
records, settings) is saved in **this browser's local storage, on this
computer** — every change is saved automatically and instantly, there is
no separate "save" step needed.

Important things to know about this:

- Data is tied to **this specific browser** on **this specific computer**.
  Opening `index.html` in a different browser (or a different computer)
  starts empty — it will not automatically see data saved elsewhere.
- Clearing your browser's cache/site data, or using Incognito/Private
  mode, can erase this data.
- **Because of this, export a backup regularly** (see below) — the backup
  file is the only way to move your data between browsers/computers, and
  the only way to keep it safe long-term.

## Backup — Export / Import

Go to **Settings → Data Management**:

- **⬇ Export Backup (JSON)** — downloads a `.json` file with everything
  in it. Save this somewhere safe (a USB drive, cloud storage, email to
  yourself). Do this often, especially before clearing your browser data
  or switching computers.
- **⬆ Import Backup (JSON)** — pick a previously exported `.json` file
  to restore all its data into this browser.

The app also keeps up to 30 automatic daily snapshots inside this
browser's storage, shown under **Settings → Restore From an Older
Backup**, in case something recent needs undoing. These automatic
snapshots are *not* a substitute for exporting a file, since they live in
the same browser storage that can be cleared.

---

This is the same app — same pages, same look, same workflow, same Print
Sheet, same substitute-duty engine — running entirely as a webpage in
your browser, with no server and no install.

---

## NEW: Admin Login, Teacher Login & Cloud Sync (add-on)

This update adds an optional layer on top of everything above. **Nothing
above this line changed** — the Timetable, Substitute Generation, Admin
Panel and offline database work exactly as before.

### What's new

- **Public Dashboard** — still the first thing anyone sees, no login needed.
- **Admin Login** button (top right) — gates the rest of the Admin Panel
  (Teachers, Timetable, Attendance, Substitute Duty, Print Sheet, Reports,
  Search, Settings). **Once Firebase is configured** (see below), the
  first person to click Admin Login sets up a username + password, gets a
  one-time **Recovery Key** to save, and that Admin account is then
  **locked to that one device** — exactly like Teacher accounts. Anyone
  who opens the shared/deployed link on a different device cannot log in
  with the same username + password; they'd need the Recovery Key, which
  only the real Admin has.
  ⚠️ **Until Firebase is configured**, Admin Login falls back to a
  **local, unsecured** `admin` / `admin123` login that works separately
  in every visitor's browser — fine for local testing, **not safe to
  share as a public link**. The login screen shows a warning while this
  fallback is active.
- **Teacher Login** button (top right) — a teacher signs in with their
  **Gmail + Access Code** (given to them by Admin) and sees their own
  **Teacher Dashboard**: today's periods, live period, REGULAR/SUBSTITUTE
  tags, and a Sync Now button. Nothing else in the Admin Panel is visible
  to a teacher.
- **Settings → Teacher Login Management** (Admin only) — create a login
  for any teacher (enter their Gmail, an Access Code is generated for
  you), reset a lost/broken device, deactivate a login, or regenerate a
  code.
- **One device per teacher account.** The first successful login on a
  device binds that account to it. The same Gmail + Access Code on a
  second device is blocked with *"ACCOUNT ALREADY LOCKED TO ANOTHER
  DEVICE"* until Admin presses **Reset Device**.
- **Sync Now** (Admin Dashboard and Teacher Dashboard) — uploads/downloads
  the latest timetable + today's substitute duties and clears the 🔔 **NEW
  SUBSTITUTE AVAILABLE** flag on a teacher's device.
- Once a teacher's device has synced at least once, their dashboard, live
  period and bell keep working **completely offline** on that device —
  exactly like the rest of this app.

### One-time setup Admin needs to do

**If you're going to share a deployed link (Netlify, etc.) with real
users — including to sell this — Firebase setup is required**, otherwise
Admin Login is not secure (see the warning above). Only local
testing/demo use can skip it.

1. Open `firebase-config.js` in this folder and follow the instructions
   at the top of that file (create a Firebase project, add a Web app,
   paste the config it gives you).
2. In the Firebase Console, enable **Firestore Database** and **paste the
   rules from `FIRESTORE_RULES.txt`** into Firestore → Rules → Publish.
   That file also explains, honestly, what these rules do and don't
   protect against for a no-backend, static-hosted app like this one.
3. Reload `index.html`. Settings → Teacher Login Management will show
   **Firebase: connected** once it's set up correctly.

Until step 1–2 are done, Admin Login and the whole existing app work
completely normally; Teacher Login and Sync Now will just show a plain
"Firebase is not configured yet" message instead of doing anything
unexpected.

### New files in this folder

`firebase-config.js`, `sync.js`, `gate.js`, `FIRESTORE_RULES.txt` — all
new. `index.html` and `style.css` got small additions (new buttons/cards/
overlays); `script.js` and `storage.js` were **not modified**.

---

## NEW: Android App Wrapper (PWA + Bubblewrap/TWA)

This build is now a proper installable PWA:

- `manifest.json` + `icons/` — app name, theme color, home-screen icon.
- `service-worker.js` — caches the app shell so it opens and works fully
  offline once installed (Firebase calls still need internet, same as
  before — only login/sync/notifications need connectivity).
- `dot-well-known/assetlinks.json` (template) + `ANDROID_APP_SETUP.md` —
  full step-by-step to host this on Netlify (or any HTTPS host) and wrap
  it into a real Android APK via Google's Bubblewrap tool, no browser
  address bar, installable/shareable as a normal app. Read
  `ANDROID_APP_SETUP.md` for the exact commands.

