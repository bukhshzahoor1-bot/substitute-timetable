/* =========================================================================
   ADD-ON: Admin Login + Teacher Login + Gmail/Access-Code + One-Device
   Binding + Firebase Sync + Substitute Notification.

   This file is new. It never edits STATE, never calls window.api, and
   never touches storage.js's "ssms_*" keys — it owns a completely
   separate set of localStorage keys ("ssms_ext_*") so the existing
   Timetable / Substitute Generation / Admin Panel / offline database
   keep working exactly as they did before, byte for byte.

   It runs after script.js, so it reuses (read-only) the globals script.js
   already exposes: STATE, todayISO(), showPage(), classLabel(), toast(),
   playBellTune().
   ========================================================================= */

/* ---------------------------- Local storage (separate from window.api) --- */
const EXT_PREFIX = "ssms_ext_";
const ExtStore = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(EXT_PREFIX + key);
      return raw !== null ? JSON.parse(raw) : (fallback !== undefined ? fallback : null);
    } catch (e) { return fallback !== undefined ? fallback : null; }
  },
  set(key, value) {
    try { localStorage.setItem(EXT_PREFIX + key, JSON.stringify(value)); return true; }
    catch (e) { return false; }
  },
  remove(key) { localStorage.removeItem(EXT_PREFIX + key); }
};

/* ---------------------------- Device ID ------------------------------------ */
function getDeviceId() {
  let id = ExtStore.get("deviceId");
  if (!id) {
    id = "dev_" + (window.crypto && crypto.randomUUID ? crypto.randomUUID()
      : (Date.now().toString(36) + Math.random().toString(36).slice(2)));
    ExtStore.set("deviceId", id);
  }
  return id;
}

/* ---------------------------- Crypto helper -------------------------------- */
async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* ---------------------------- Admin auth (Firebase-backed, device-bound) --
   SECURITY: mirrors Teacher Login — one Admin account per deployment,
   locked to one device via Firebase. If Firebase is not configured yet,
   this falls back to a LOCAL-ONLY admin (admin/admin123) purely so the
   Admin Panel still works out of the box while you're setting things up.
   That fallback is NOT safe once this app is deployed as a shared/public
   link (every visitor's browser gets its own separate admin/admin123) —
   configure Firebase (firebase-config.js) before selling/sharing a link. */

function genRecoveryKey() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const grp = () => Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  return `ADM-${grp()}-${grp()}-${grp()}`;
}

function getAdminSession() { return ExtStore.get("adminSession"); }
function setAdminSession(rec) { ExtStore.set("adminSession", rec); }
function clearAdminSession() { ExtStore.remove("adminSession"); }
function isAdminLoggedIn() { return !!getAdminSession(); }

/* Local-only fallback (used only while Firebase is not configured) */
async function ensureLocalAdminFallback() {
  let auth = ExtStore.get("adminAuthLocalFallback");
  if (!auth) {
    auth = { username: "admin", passwordHash: await sha256("admin123") };
    ExtStore.set("adminAuthLocalFallback", auth);
  }
  return auth;
}
async function verifyLocalFallbackLogin(username, password) {
  const auth = await ensureLocalAdminFallback();
  if (!username || username.trim().toLowerCase() !== auth.username.toLowerCase()) return false;
  return (await sha256(password || "")) === auth.passwordHash;
}
async function changeLocalFallbackPassword(oldPass, newPass) {
  const auth = await ensureLocalAdminFallback();
  if (!(await verifyLocalFallbackLogin(auth.username, oldPass))) return { ok: false, error: "Current password is incorrect." };
  if (!newPass || newPass.length < 6) return { ok: false, error: "New password must be at least 6 characters." };
  auth.passwordHash = await sha256(newPass);
  ExtStore.set("adminAuthLocalFallback", auth);
  return { ok: true };
}

/* Firebase-backed setup / login / recovery */
async function adminSetup(username, password, password2) {
  const u = (username || "").trim();
  if (!u) return { ok: false, error: "Enter a username." };
  if (!password || password.length < 6) return { ok: false, error: "Password must be at least 6 characters." };
  if (password !== password2) return { ok: false, error: "Passwords do not match." };
  const deviceId = getDeviceId();
  const recoveryKey = genRecoveryKey();
  const rec = {
    username: u, passwordHash: await sha256(password), recoveryKeyHash: await sha256(recoveryKey),
    deviceId, deviceStatus: "BOUND", boundAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  };
  const remote = await Sync.saveAdminAuthRemote(rec);
  if (!remote.ok) return { ok: false, error: remote.offline ? "You're offline — connect to the internet for this one-time Admin setup." : (remote.error || "Could not save to Firebase.") };
  ExtStore.set("adminDeviceCache", { username: u, passwordHash: rec.passwordHash, deviceId, boundAt: rec.boundAt });
  setAdminSession({ username: u, deviceId, boundAt: rec.boundAt, loggedInAt: new Date().toISOString() });
  return { ok: true, recoveryKey };
}

async function adminLoginSecure(username, password) {
  const u = (username || "").trim();
  const deviceId = getDeviceId();

  if (!Sync.isOnline()) {
    // Uses a persistent device cache (NOT the login session) so that a
    // logout followed by an offline re-login on the SAME registered
    // device still works — logout only ends the session, it never
    // unregisters the device.
    const cache = ExtStore.get("adminDeviceCache");
    if (cache && cache.deviceId === deviceId && cache.username.toLowerCase() === u.toLowerCase() && (await sha256(password || "")) === cache.passwordHash) {
      setAdminSession({ username: cache.username, deviceId, boundAt: cache.boundAt, loggedInAt: new Date().toISOString() });
      return { ok: true, offlineContinue: true };
    }
    return { ok: false, error: "No internet connection. The first login on a new device (or after a password change) needs internet to verify the account." };
  }

  const remote = await Sync.fetchAdminAuth();
  if (!remote) return { ok: false, error: "No Admin account exists yet.", needsSetup: true };
  if (u.toLowerCase() !== remote.username.toLowerCase()) return { ok: false, error: "Incorrect username or password." };
  if ((await sha256(password || "")) !== remote.passwordHash) return { ok: false, error: "Incorrect username or password." };

  if (remote.deviceId && remote.deviceId !== deviceId) {
    return { ok: false, blocked: true, error: "ADMIN ACCOUNT IS ALREADY REGISTERED ON ANOTHER DEVICE. Use your Recovery Key to move it to this device." };
  }
  if (!remote.deviceId) {
    remote.deviceId = deviceId; remote.deviceStatus = "BOUND"; remote.boundAt = new Date().toISOString(); remote.updatedAt = new Date().toISOString();
    await Sync.saveAdminAuthRemote(remote);
  }
  ExtStore.set("adminDeviceCache", { username: remote.username, passwordHash: remote.passwordHash, deviceId, boundAt: remote.boundAt });
  setAdminSession({ username: remote.username, deviceId, boundAt: remote.boundAt, loggedInAt: new Date().toISOString() });
  return { ok: true };
}

async function adminRecoverDevice(username, recoveryKey, newPassword) {
  if (!Sync.isOnline()) return { ok: false, error: "Connect to the internet to use your Recovery Key." };
  const remote = await Sync.fetchAdminAuth();
  if (!remote) return { ok: false, error: "No Admin account exists yet." };
  if ((username || "").trim().toLowerCase() !== remote.username.toLowerCase()) return { ok: false, error: "Incorrect username or Recovery Key." };
  if ((await sha256((recoveryKey || "").trim().toUpperCase())) !== remote.recoveryKeyHash) return { ok: false, error: "Incorrect username or Recovery Key." };
  const deviceId = getDeviceId();
  remote.deviceId = deviceId; remote.deviceStatus = "BOUND"; remote.boundAt = new Date().toISOString(); remote.updatedAt = new Date().toISOString();
  if (newPassword && newPassword.length >= 6) remote.passwordHash = await sha256(newPassword);
  const saved = await Sync.saveAdminAuthRemote(remote);
  if (!saved.ok) return { ok: false, error: saved.error || "Could not save." };
  ExtStore.set("adminDeviceCache", { username: remote.username, passwordHash: remote.passwordHash, deviceId, boundAt: remote.boundAt });
  setAdminSession({ username: remote.username, deviceId, boundAt: remote.boundAt, loggedInAt: new Date().toISOString() });
  return { ok: true };
}

async function changeAdminPassword(oldPass, newPass) {
  const session = getAdminSession();
  if (session && session.local) return changeLocalFallbackPassword(oldPass, newPass);
  if (!Sync.isOnline()) return { ok: false, error: "Connect to the internet to change the Admin password." };
  const remote = await Sync.fetchAdminAuth();
  if (!remote) return { ok: false, error: "No Admin account found." };
  if ((await sha256(oldPass || "")) !== remote.passwordHash) return { ok: false, error: "Current password is incorrect." };
  if (!newPass || newPass.length < 6) return { ok: false, error: "New password must be at least 6 characters." };
  remote.passwordHash = await sha256(newPass);
  remote.updatedAt = new Date().toISOString();
  const saved = await Sync.saveAdminAuthRemote(remote);
  if (saved.ok) {
    const cache = ExtStore.get("adminDeviceCache");
    if (cache) { cache.passwordHash = remote.passwordHash; ExtStore.set("adminDeviceCache", cache); }
    return { ok: true };
  }
  return { ok: false, error: saved.error };
}

/* ---------------------------- Teacher login records (admin-managed) ------- */
function getTeacherLogins() { return ExtStore.get("teacherLogins", []); }
function saveTeacherLogins(list) { ExtStore.set("teacherLogins", list); }
function teacherLoginFor(teacherId) { return getTeacherLogins().find((l) => l.teacherId === teacherId) || null; }
function genAccessCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I to avoid confusion
  let s = "TCH-";
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

async function createOrUpdateTeacherLogin(teacherId, gmail) {
  const teacher = STATE.teachers.find((t) => t.id === teacherId);
  if (!teacher) return { ok: false, error: "Teacher not found." };
  const gm = (gmail || "").trim().toLowerCase();
  if (!/^[^\s@]+@gmail\.com$/.test(gm)) return { ok: false, error: "Enter a valid Gmail address (must end in @gmail.com)." };

  const list = getTeacherLogins();
  const dup = list.find((l) => l.gmail === gm && l.status === "Active" && l.teacherId !== teacherId);
  if (dup) return { ok: false, error: "This Gmail is already assigned to another active teacher account." };

  let rec = list.find((l) => l.teacherId === teacherId);
  if (rec) {
    rec.gmail = gm;
    rec.accessCode = genAccessCode();
    rec.status = "Active";
    rec.deviceId = null;
    rec.deviceStatus = "UNBOUND";
    rec.boundAt = null;
    rec.teacherName = teacher.name;
    rec.updatedAt = new Date().toISOString();
  } else {
    rec = {
      teacherId, teacherName: teacher.name, gmail: gm, accessCode: genAccessCode(),
      status: "Active", deviceId: null, deviceStatus: "UNBOUND", boundAt: null,
      updatedAt: new Date().toISOString()
    };
    list.push(rec);
  }
  saveTeacherLogins(list);
  const remote = await Sync.saveTeacherLoginRemote(rec);
  return { ok: true, rec, remoteSynced: !!remote.ok, remoteOffline: !!remote.offline };
}

async function regenerateAccessCode(teacherId) {
  const list = getTeacherLogins();
  const rec = list.find((l) => l.teacherId === teacherId);
  if (!rec) return { ok: false, error: "No login found for this teacher yet." };
  rec.accessCode = genAccessCode();
  rec.updatedAt = new Date().toISOString();
  // Per spec: regenerating the code does NOT touch the device binding.
  saveTeacherLogins(list);
  const remote = await Sync.saveTeacherLoginRemote(rec);
  return { ok: true, rec, remoteSynced: !!remote.ok };
}

async function resetTeacherDevice(teacherId) {
  const list = getTeacherLogins();
  const rec = list.find((l) => l.teacherId === teacherId);
  if (!rec) return { ok: false, error: "No login found for this teacher yet." };
  rec.deviceId = null;
  rec.deviceStatus = "UNBOUND";
  rec.boundAt = null;
  rec.updatedAt = new Date().toISOString();
  saveTeacherLogins(list);
  const remote = await Sync.saveTeacherLoginRemote(rec);
  return { ok: true, rec, remoteSynced: !!remote.ok };
}

async function toggleTeacherLoginStatus(teacherId) {
  const list = getTeacherLogins();
  const rec = list.find((l) => l.teacherId === teacherId);
  if (!rec) return { ok: false, error: "No login found for this teacher yet." };
  rec.status = rec.status === "Active" ? "Inactive" : "Active";
  rec.updatedAt = new Date().toISOString();
  saveTeacherLogins(list);
  const remote = await Sync.saveTeacherLoginRemote(rec);
  return { ok: true, rec, remoteSynced: !!remote.ok };
}

/* ---------------------------- Teacher login / device binding -------------- */
function getTeacherSession() { return ExtStore.get("teacherSession"); }
function teacherLogout() { ExtStore.remove("teacherSession"); }

async function teacherLogin(gmail, accessCode) {
  const gm = (gmail || "").trim().toLowerCase();
  const code = (accessCode || "").trim().toUpperCase();
  if (!gm || !code) return { ok: false, error: "Enter both Gmail and Access Code." };
  const deviceId = getDeviceId();

  if (!Sync.isOnline()) {
    // Uses a persistent per-teacher device cache (NOT the login session)
    // so a logout followed by an offline re-login on the SAME registered
    // device still works — logout only ends the session, it never
    // unregisters the device.
    const cache = ExtStore.get("teacherDeviceCache:" + gm);
    if (cache && cache.accessCode === code && cache.deviceId === deviceId) {
      ExtStore.set("teacherSession", { teacherId: cache.teacherId, gmail: gm, accessCode: code, deviceId, boundAt: cache.boundAt });
      return { ok: true, offlineContinue: true, teacherId: cache.teacherId };
    }
    return { ok: false, error: "No internet connection. The first login on a device needs internet so Admin's server can verify your account." };
  }

  if (!Sync.isConfigured()) {
    return { ok: false, error: "Firebase is not configured yet. Ask your Admin to finish setup (see firebase-config.js)." };
  }

  const remote = await Sync.findTeacherLoginByGmail(gm);
  if (!remote || remote.accessCode !== code || remote.status !== "Active") {
    return { ok: false, error: "Incorrect Gmail or Access Code, or this account is inactive." };
  }

  if (remote.deviceId && remote.deviceId !== deviceId) {
    return { ok: false, blocked: true, error: "THIS ACCOUNT IS ALREADY REGISTERED ON ANOTHER DEVICE. Contact Admin to reset the device." };
  }

  if (!remote.deviceId) {
    remote.deviceId = deviceId;
    remote.deviceStatus = "BOUND";
    remote.boundAt = new Date().toISOString();
    remote.updatedAt = new Date().toISOString();
    await Sync.saveTeacherLoginRemote(remote);
  }

  // Mirror into the admin's local copy too (so Teacher Login Management
  // shows BOUND immediately even before the admin's next Sync Now).
  const list = getTeacherLogins();
  const idx = list.findIndex((l) => l.teacherId === remote.teacherId);
  if (idx >= 0) list[idx] = Object.assign({}, list[idx], remote); else list.push(remote);
  saveTeacherLogins(list);

  ExtStore.set("teacherDeviceCache:" + gm, { teacherId: remote.teacherId, accessCode: code, deviceId, boundAt: remote.boundAt });
  ExtStore.set("teacherSession", { teacherId: remote.teacherId, gmail: gm, accessCode: code, deviceId, boundAt: remote.boundAt });
  return { ok: true, teacherId: remote.teacherId };
}

/* ---------------------------- Teacher data source (offline-capable) ------- */
function getTeacherDataSource() {
  const cached = ExtStore.get("teacherCachedData");
  if (cached) return cached;
  return {
    teachers: STATE.teachers, periods: STATE.periods, timetables: STATE.timetables,
    substitutes: STATE.substitutes, settingsBell: (STATE.settings && STATE.settings.bell) || null,
    updatedAt: null
  };
}

function computeCurrentPeriodNumber(periods) {
  const now = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  for (let i = 0; i < (periods || []).length; i++) {
    const p = periods[i];
    if (p.isBreak) continue;
    const [sh, sm] = p.start.split(":").map(Number);
    const [eh, em] = p.end.split(":").map(Number);
    const s = sh * 60 + sm, e = eh * 60 + em;
    if (mins >= s && mins < e) return i + 1;
  }
  return null;
}

function computeTeacherTodayRows(dataSrc, teacherId) {
  const rows = [];
  ["Primary", "Middle", "High"].forEach((level) => {
    const tt = dataSrc.timetables && dataSrc.timetables[level];
    if (!tt || !tt.classes) return;
    tt.classes.forEach((cls) => {
      (dataSrc.periods || []).forEach((p, idx) => {
        if (p.isBreak) return;
        const pn = idx + 1;
        const cell = tt.grid && tt.grid[cls.id] && tt.grid[cls.id][pn];
        if (cell && cell.teacherId === teacherId) {
          rows.push({
            period: pn, periodTiming: p.start + " - " + p.end, level,
            className: cls.group ? (cls.name + " " + cls.group) : cls.name,
            subject: cell.subject, type: "REGULAR"
          });
        }
      });
    });
  });
  const today = todayISO();
  ((dataSrc.substitutes && dataSrc.substitutes[today]) || []).forEach((r) => {
    if (r.substituteTeacherId === teacherId) {
      rows.push({ period: r.period, periodTiming: r.periodTiming, level: r.level, className: r.className, subject: r.subject, type: "SUBSTITUTE" });
    }
  });
  rows.sort((a, b) => a.period - b.period);
  return rows;
}

/* ---------------------------- Sync actions --------------------------------- */

// Shared core used by both the manual "Sync Now" button and the silent
// background auto-sync loop below. opts.silent=true suppresses toasts/
// button text changes (used by auto-sync so it doesn't nag the admin).
async function performAdminSync(opts) {
  opts = opts || {};
  if (!Sync.isConfigured()) {
    if (!opts.silent) toast("Firebase is not configured yet — see firebase-config.js.", 6000);
    renderCloudSyncCard(); return { ok: false };
  }
  if (!Sync.isOnline()) {
    ExtStore.set("adminPendingSync", true);
    if (!opts.silent) toast("You're offline — connect to the internet to Sync Now.", 5000);
    renderCloudSyncCard(); return { ok: false, offline: true };
  }

  const today = todayISO();
  const prevSnapshot = ExtStore.get("lastPushedSubsForNotify", {});
  const todays = STATE.substitutes[today] || [];
  const currentByTeacher = {};
  todays.forEach((r) => {
    if (r.substituteTeacherId) {
      (currentByTeacher[r.substituteTeacherId] = currentByTeacher[r.substituteTeacherId] || []).push(r.id + ":" + r.period);
    }
  });
  const changedTeacherIds = Object.keys(currentByTeacher).filter((tid) => {
    const prev = (prevSnapshot[tid] || []).slice().sort().join(",");
    const cur = currentByTeacher[tid].slice().sort().join(",");
    return prev !== cur;
  });

  const push = await Sync.pushSchoolData();
  if (!push.ok) {
    if (!opts.silent) toast("Sync failed: " + (push.error || "unknown error"), 6000);
    return { ok: false, error: push.error };
  }
  for (const tid of changedTeacherIds) await Sync.bumpSubstituteNotify(tid);
  ExtStore.set("lastPushedSubsForNotify", currentByTeacher);

  // Push any teacher-login records the admin edited locally while offline.
  const logins = getTeacherLogins();
  for (const rec of logins) await Sync.saveTeacherLoginRemote(rec);

  ExtStore.set("lastAdminSync", new Date().toISOString());
  ExtStore.set("adminPendingSync", false);
  _lastAdminAutoSyncSnapshot = computeAdminSyncSnapshotKey();

  if (opts.silent) flashAutoSyncedBadge(); else toast("✓ SYNC SUCCESSFUL");
  renderCloudSyncCard();
  if (document.body.classList.contains("admin-mode")) renderTeacherLoginMgmt();
  return { ok: true };
}

async function adminSyncNow() {
  const btn = document.getElementById("adminSyncNowBtn");
  if (btn) { btn.disabled = true; btn.textContent = "Syncing…"; }
  try {
    await performAdminSync({ silent: false });
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "⟳ Sync Now"; }
  }
}

function flashAutoSyncedBadge() {
  const el = document.getElementById("cloudSyncStatusText");
  if (!el) return;
  el.textContent = "✓ auto synced";
  setTimeout(renderCloudSyncCard, 2500);
}

// Watches STATE (teachers/periods/timetables/today's substitutes) plus
// locally-edited teacher logins for changes and pushes them to Firebase
// automatically when online — Admin never has to remember to press
// Sync Now. Falls back to "PENDING SYNC" while offline and catches up
// automatically the moment connectivity returns.
function computeAdminSyncSnapshotKey() {
  const today = todayISO();
  try {
    return JSON.stringify({
      teachers: STATE.teachers, periods: STATE.periods, timetables: STATE.timetables,
      substitutesToday: STATE.substitutes[today] || [], teacherLogins: getTeacherLogins()
    });
  } catch (e) { return String(Date.now()); }
}
let _lastAdminAutoSyncSnapshot = null;
let _adminAutoSyncTimer = null;
function startAdminAutoSync() {
  if (_adminAutoSyncTimer) return;
  _lastAdminAutoSyncSnapshot = computeAdminSyncSnapshotKey();
  _adminAutoSyncTimer = setInterval(async () => {
    if (!document.body.classList.contains("admin-mode")) return;
    const snap = computeAdminSyncSnapshotKey();
    const changed = snap !== _lastAdminAutoSyncSnapshot;
    const owesPending = ExtStore.get("adminPendingSync");
    if (!changed && !owesPending) return;
    _lastAdminAutoSyncSnapshot = snap;
    if (Sync.isOnline() && Sync.isConfigured()) {
      await performAdminSync({ silent: true });
    } else {
      ExtStore.set("adminPendingSync", true);
      renderCloudSyncCard();
    }
  }, 20000);
}
function stopAdminAutoSync() { clearInterval(_adminAutoSyncTimer); _adminAutoSyncTimer = null; }

async function teacherSyncNow() {
  const session = getTeacherSession();
  if (!session) return;
  const btn = document.getElementById("teacherSyncNowBtn");
  if (!Sync.isConfigured()) { setTeacherStatusText("SYNC REQUIRED — Firebase not configured"); return; }
  if (!Sync.isOnline()) { setTeacherStatusText("OFFLINE — USING SAVED DATA"); return; }
  if (btn) { btn.disabled = true; btn.textContent = "Syncing…"; }
  try {
    const remote = await Sync.fetchTeacherLogin(session.teacherId);
    if (remote && remote.deviceId && remote.deviceId !== session.deviceId) {
      teacherLogout();
      exitTeacherMode();
      openAuthOverlay("teacher", "Your device access was reset by Admin. Please log in again.");
      return;
    }
    const pull = await Sync.pullSchoolData();
    if (!pull.ok) { toast("Sync failed: " + (pull.error || "unknown error"), 6000); return; }
    ExtStore.set("teacherCachedData", pull.data);
    ExtStore.set("lastTeacherSync", new Date().toISOString());
    const remoteVer = await Sync.getSubstituteNotifyVersion(session.teacherId);
    if (remoteVer !== null) ExtStore.set("teacherSeenNotifyVersion:" + session.teacherId, remoteVer);
    document.getElementById("tdNotifyBanner").style.display = "none";
    renderTeacherDashboard();
    toast("✓ SYNC COMPLETE");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "⟳ Sync Now"; }
  }
}

async function checkTeacherNotification() {
  const session = getTeacherSession();
  if (!session || !Sync.isOnline() || !Sync.isConfigured()) return;
  const remoteVer = await Sync.getSubstituteNotifyVersion(session.teacherId);
  const seen = ExtStore.get("teacherSeenNotifyVersion:" + session.teacherId, 0);
  if (remoteVer !== null && remoteVer > seen) {
    document.getElementById("tdNotifyBanner").style.display = "flex";
  }
}

let _teacherLastPeriodSeen = null;
function teacherBellTick() {
  const session = getTeacherSession();
  if (!session) return;
  const dataSrc = getTeacherDataSource();
  const cur = computeCurrentPeriodNumber(dataSrc.periods);
  if (cur !== _teacherLastPeriodSeen) {
    _teacherLastPeriodSeen = cur;
    if (cur) {
      const rows = computeTeacherTodayRows(dataSrc, session.teacherId);
      const hasPeriod = rows.some((r) => r.period === cur);
      const bell = dataSrc.settingsBell || { enabled: true, tune: "classic", volume: 0.7 };
      if (hasPeriod && bell.enabled && typeof playBellTune === "function") {
        playBellTune(bell.tune, bell.volume);
      }
    }
  }
}

/* ---------------------------- UI: overlays / mode switching ---------------- */
function renderCloudSyncCard() {
  const statusEl = document.getElementById("cloudSyncStatusText");
  if (!statusEl) return;
  const pending = ExtStore.get("adminPendingSync");
  statusEl.textContent = !Sync.isConfigured() ? "not configured"
    : (!Sync.isOnline() ? (pending ? "offline — PENDING SYNC" : "offline")
      : (pending ? "syncing…" : "online"));
  const last = ExtStore.get("lastAdminSync");
  document.getElementById("adminLastSyncText").textContent = "Last Synced: " + (last ? new Date(last).toLocaleString() : "never");
  const badge = document.getElementById("fbStatusBadge");
  if (badge) badge.textContent = Sync.isConfigured() ? "connected" : "not configured";
}

function renderTeacherLoginMgmt() {
  const tbody = document.querySelector("#teacherLoginTable tbody");
  if (!tbody) return;
  const logins = getTeacherLogins();
  tbody.innerHTML = STATE.teachers.map((t) => {
    const rec = logins.find((l) => l.teacherId === t.id);
    const gmailVal = rec ? rec.gmail : "";
    const codeCell = rec
      ? `<code class="access-code">${rec.accessCode}</code> <button class="btn tiny" data-act="regen" data-id="${t.id}">Regenerate</button>`
      : `<span class="muted">—</span>`;
    const statusBadge = rec
      ? `<span class="badge ${rec.status === "Active" ? "badge-ok" : "badge-warn"}">${rec.status}</span>`
      : `<span class="muted">No login</span>`;
    const deviceBadge = rec
      ? `<span class="badge ${rec.deviceStatus === "BOUND" ? "badge-ok" : "badge-warn"}">${rec.deviceStatus}</span>`
      : `<span class="muted">—</span>`;
    const actions = rec
      ? `<button class="btn tiny" data-act="reset" data-id="${t.id}" ${rec.deviceStatus !== "BOUND" ? "disabled" : ""}>Reset Device</button>
         <button class="btn tiny" data-act="toggle" data-id="${t.id}">${rec.status === "Active" ? "Deactivate" : "Activate"}</button>`
      : `<button class="btn tiny primary" data-act="create" data-id="${t.id}">Create Login</button>`;
    return `<tr>
      <td>${t.name}</td>
      <td><input type="email" class="tlm-gmail" data-id="${t.id}" value="${gmailVal}" placeholder="teacher@gmail.com" style="min-width:180px;"></td>
      <td>${codeCell}</td>
      <td>${statusBadge}</td>
      <td>${deviceBadge}</td>
      <td class="tlm-actions">${actions}</td>
    </tr>`;
  }).join("") || `<tr><td colspan="6" class="muted">No teachers yet — add teachers first.</td></tr>`;
}

async function handleTeacherLoginMgmtClick(e) {
  const btn = e.target.closest("button[data-act]");
  if (!btn) return;
  const act = btn.dataset.act;
  const id = btn.dataset.id;
  let res;
  if (act === "create") {
    const gmailInput = document.querySelector(`.tlm-gmail[data-id="${id}"]`);
    res = await createOrUpdateTeacherLogin(id, gmailInput ? gmailInput.value : "");
  } else if (act === "regen") {
    res = await regenerateAccessCode(id);
  } else if (act === "reset") {
    if (!confirm("Are you sure you want to remove the current device binding?")) return;
    res = await resetTeacherDevice(id);
  } else if (act === "toggle") {
    res = await toggleTeacherLoginStatus(id);
  }
  if (res && res.ok) {
    toast(res.remoteSynced ? "Saved and synced to Firebase." : "Saved locally (will sync to Firebase on Sync Now).");
    renderTeacherLoginMgmt();
  } else if (res) {
    toast(res.error || "Something went wrong.", 5000);
  }
}

function setTeacherStatusText(text) {
  const el = document.getElementById("tdSyncStatus");
  if (el) el.textContent = text;
}

function renderTeacherDashboard() {
  const session = getTeacherSession();
  if (!session) return;
  const dataSrc = getTeacherDataSource();
  const teacher = (dataSrc.teachers || []).find((t) => t.id === session.teacherId)
    || STATE.teachers.find((t) => t.id === session.teacherId) || { name: "Teacher" };
  document.getElementById("tdTeacherName").textContent = teacher.name;
  document.getElementById("tdTodayDate").textContent = new Date().toDateString();

  const cur = computeCurrentPeriodNumber(dataSrc.periods);
  const rows = computeTeacherTodayRows(dataSrc, session.teacherId);
  document.getElementById("tdCurrentPeriod").textContent = cur ? ("Period " + cur) : "No period running";

  const tbody = document.querySelector("#tdPeriodsTable tbody");
  tbody.innerHTML = rows.length ? rows.map((r) => `<tr class="${r.period === cur ? "live-row" : ""}">
      <td>${r.period}</td><td>${r.periodTiming}</td><td>${r.className} (${r.level})</td><td>${r.subject}</td>
      <td><span class="badge ${r.type === "SUBSTITUTE" ? "badge-warn" : "badge-ok"}">${r.type}</span></td>
    </tr>`).join("") : `<tr><td colspan="5" class="muted">No periods today.</td></tr>`;

  const lastSync = ExtStore.get("lastTeacherSync");
  document.getElementById("tdLastSync").textContent = "Last Synced: " + (lastSync ? new Date(lastSync).toLocaleString() : "never");
  setTeacherStatusText(!Sync.isConfigured() ? "SYNC REQUIRED" : (Sync.isOnline() ? "ONLINE — SYNC AVAILABLE" : "OFFLINE — USING SAVED DATA"));
}

let _teacherRefreshTimer = null, _teacherBellTimer = null, _teacherNotifyTimer = null;
function startTeacherDashboard() {
  document.getElementById("teacherDashboardOverlay").classList.add("show");
  renderTeacherDashboard();
  checkTeacherNotification();
  _teacherRefreshTimer = setInterval(renderTeacherDashboard, 30000);
  _teacherBellTimer = setInterval(teacherBellTick, 10000);
  _teacherNotifyTimer = setInterval(checkTeacherNotification, 60000);
}
function stopTeacherIntervals() {
  clearInterval(_teacherRefreshTimer); clearInterval(_teacherBellTimer); clearInterval(_teacherNotifyTimer);
  document.getElementById("teacherDashboardOverlay").classList.remove("show");
}

function enterAdminMode() {
  document.body.classList.add("admin-mode");
  document.body.classList.remove("teacher-mode");
  document.getElementById("adminLoginBtn").style.display = "none";
  document.getElementById("teacherLoginBtn").style.display = "none";
  document.getElementById("adminLogoutBtn").style.display = "inline-block";
  const session = getAdminSession();
  const badge = document.getElementById("roleBadge");
  badge.style.display = "inline-block";
  badge.textContent = "Admin" + (session && session.local ? " ⚠ unsecured" : "");
  closeAuthOverlay();
  renderCloudSyncCard();
  renderTeacherLoginMgmt();
  startAdminAutoSync();
}
function exitAdminMode() {
  // Logout only ends the session — it does NOT remove the device
  // binding (adminDeviceCache / the Firestore deviceId stay untouched),
  // so logging back in on this same device works instantly, online or off.
  clearAdminSession();
  stopAdminAutoSync();
  document.body.classList.remove("admin-mode");
  document.getElementById("adminLoginBtn").style.display = "inline-block";
  document.getElementById("teacherLoginBtn").style.display = "inline-block";
  document.getElementById("adminLogoutBtn").style.display = "none";
  document.getElementById("roleBadge").style.display = "none";
  showPage("dashboard");
}
function enterTeacherMode(teacherId) {
  document.body.classList.add("teacher-mode");
  document.body.classList.remove("admin-mode");
  document.getElementById("adminLoginBtn").style.display = "none";
  document.getElementById("teacherLoginBtn").style.display = "none";
  const t = STATE.teachers.find((x) => x.id === teacherId);
  const badge = document.getElementById("roleBadge");
  badge.style.display = "inline-block"; badge.textContent = "Teacher" + (t ? " — " + t.name : "");
  closeAuthOverlay();
  startTeacherDashboard();
}
function exitTeacherMode() {
  teacherLogout();
  stopTeacherIntervals();
  document.body.classList.remove("teacher-mode");
  document.getElementById("adminLoginBtn").style.display = "inline-block";
  document.getElementById("teacherLoginBtn").style.display = "inline-block";
  document.getElementById("roleBadge").style.display = "none";
}

/* ---------------------------- Event wiring --------------------------------- */
function showAuthAdminSubPanel(name) {
  ["authAdminLoadingPanel", "authAdminOfflinePanel", "authAdminSetupPanel", "authAdminPanel", "authAdminRecoveryPanel"].forEach((id) => {
    document.getElementById(id).style.display = id === name ? "block" : "none";
  });
  document.getElementById("authTeacherPanel").style.display = "none";
  document.getElementById("authOverlay").classList.add("show");
}

async function openAdminLoginFlow() {
  showAuthAdminSubPanel("authAdminLoadingPanel");
  if (!Sync.isConfigured()) {
    document.getElementById("adminFallbackHint").style.display = "block";
    document.getElementById("adminUseRecoveryBtn").style.display = "none";
    showAuthAdminSubPanel("authAdminPanel");
    return;
  }
  if (!Sync.isOnline()) { showAuthAdminSubPanel("authAdminOfflinePanel"); return; }
  const remote = await Sync.fetchAdminAuth();
  if (!remote) {
    showAuthAdminSubPanel("authAdminSetupPanel");
  } else {
    document.getElementById("adminFallbackHint").style.display = "none";
    document.getElementById("adminUseRecoveryBtn").style.display = "inline-block";
    showAuthAdminSubPanel("authAdminPanel");
  }
}

function openAuthOverlay(mode, message) {
  if (mode === "admin") { openAdminLoginFlow(); return; }
  document.getElementById("authAdminLoadingPanel").style.display = "none";
  document.getElementById("authAdminOfflinePanel").style.display = "none";
  document.getElementById("authAdminSetupPanel").style.display = "none";
  document.getElementById("authAdminPanel").style.display = "none";
  document.getElementById("authAdminRecoveryPanel").style.display = "none";
  document.getElementById("authTeacherPanel").style.display = mode === "teacher" ? "block" : "none";
  document.getElementById("teacherLoginError").textContent = mode === "teacher" ? (message || "") : "";
  document.getElementById("authOverlay").classList.add("show");
}
function closeAuthOverlay() { document.getElementById("authOverlay").classList.remove("show"); }

function wireGateEvents() {
  document.getElementById("adminLoginBtn").addEventListener("click", () => openAuthOverlay("admin"));
  document.getElementById("teacherLoginBtn").addEventListener("click", () => openAuthOverlay("teacher"));
  document.getElementById("authCloseBtn").addEventListener("click", closeAuthOverlay);
  document.getElementById("adminLogoutBtn").addEventListener("click", exitAdminMode);
  document.getElementById("teacherLogoutBtn").addEventListener("click", exitTeacherMode);
  document.getElementById("teacherSyncNowBtn").addEventListener("click", teacherSyncNow);
  document.getElementById("tdNotifySyncBtn").addEventListener("click", teacherSyncNow);
  document.getElementById("adminSyncNowBtn").addEventListener("click", adminSyncNow);

  document.getElementById("adminSetupSubmitBtn").addEventListener("click", async () => {
    const btn = document.getElementById("adminSetupSubmitBtn");
    btn.disabled = true; btn.textContent = "Creating…";
    const res = await adminSetup(
      document.getElementById("setupUsernameInput").value,
      document.getElementById("setupPasswordInput").value,
      document.getElementById("setupPassword2Input").value
    );
    btn.disabled = false; btn.textContent = "Create Admin Account";
    if (res.ok) {
      document.getElementById("recoveryKeyDisplay").textContent = res.recoveryKey;
      document.getElementById("recoveryKeySavedCheck").checked = false;
      document.getElementById("recoveryKeyContinueBtn").disabled = true;
      closeAuthOverlay();
      document.getElementById("recoveryKeyOverlay").classList.add("show");
    } else {
      document.getElementById("adminSetupError").textContent = res.error || "Could not create account.";
    }
  });

  document.getElementById("recoveryKeySavedCheck").addEventListener("change", (e) => {
    document.getElementById("recoveryKeyContinueBtn").disabled = !e.target.checked;
  });
  document.getElementById("recoveryKeyContinueBtn").addEventListener("click", () => {
    document.getElementById("recoveryKeyOverlay").classList.remove("show");
    enterAdminMode();
  });

  document.getElementById("adminLoginSubmitBtn").addEventListener("click", async () => {
    const btn = document.getElementById("adminLoginSubmitBtn");
    btn.disabled = true; btn.textContent = "Checking…";
    const u = document.getElementById("adminUsernameInput").value;
    const p = document.getElementById("adminPasswordInput").value;
    let res;
    if (!Sync.isConfigured()) {
      const ok = await verifyLocalFallbackLogin(u, p);
      res = ok ? { ok: true } : { ok: false, error: "Incorrect username or password." };
      if (ok) setAdminSession({ username: u.trim() || "admin", deviceId: getDeviceId(), local: true, loggedInAt: new Date().toISOString() });
    } else {
      res = await adminLoginSecure(u, p);
    }
    btn.disabled = false; btn.textContent = "Login";
    if (res.ok) enterAdminMode();
    else if (res.needsSetup) openAdminLoginFlow();
    else document.getElementById("adminLoginError").textContent = res.error || "Login failed.";
  });
  document.getElementById("adminPasswordInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") document.getElementById("adminLoginSubmitBtn").click();
  });

  document.getElementById("adminUseRecoveryBtn").addEventListener("click", () => showAuthAdminSubPanel("authAdminRecoveryPanel"));
  document.getElementById("adminBackToLoginBtn").addEventListener("click", () => showAuthAdminSubPanel("authAdminPanel"));
  document.getElementById("adminRecoverySubmitBtn").addEventListener("click", async () => {
    const btn = document.getElementById("adminRecoverySubmitBtn");
    btn.disabled = true; btn.textContent = "Recovering…";
    const res = await adminRecoverDevice(
      document.getElementById("recUsernameInput").value,
      document.getElementById("recKeyInput").value,
      document.getElementById("recNewPasswordInput").value
    );
    btn.disabled = false; btn.textContent = "Recover This Device";
    if (res.ok) enterAdminMode();
    else document.getElementById("adminRecoveryError").textContent = res.error || "Recovery failed.";
  });

  document.getElementById("teacherLoginSubmitBtn").addEventListener("click", async () => {
    const btn = document.getElementById("teacherLoginSubmitBtn");
    btn.disabled = true; btn.textContent = "Checking…";
    const gm = document.getElementById("teacherGmailInput").value;
    const code = document.getElementById("teacherCodeInput").value;
    const res = await teacherLogin(gm, code);
    btn.disabled = false; btn.textContent = "Login";
    if (res.ok) {
      enterTeacherMode(res.teacherId);
      if (!res.offlineContinue) await teacherSyncNow();
    } else {
      document.getElementById("teacherLoginError").textContent = res.error || "Login failed.";
    }
  });
  document.getElementById("teacherCodeInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") document.getElementById("teacherLoginSubmitBtn").click();
  });

  // Teacher Login Management table (delegated — the table body is re-rendered often)
  document.getElementById("teacherLoginTable").addEventListener("click", handleTeacherLoginMgmtClick);

  // Re-render Teacher Login Management whenever the Settings tab is opened
  // (additive listener — does not replace script.js's own showPage() binding).
  document.querySelector('.navbtn[data-page="settings"]').addEventListener("click", renderTeacherLoginMgmt);
  document.querySelector('.navbtn[data-page="dashboard"]').addEventListener("click", renderCloudSyncCard);

  document.getElementById("adminChangePassBtn").addEventListener("click", async () => {
    const oldP = document.getElementById("adm_oldpass").value;
    const newP = document.getElementById("adm_newpass").value;
    const newP2 = document.getElementById("adm_newpass2").value;
    const msg = document.getElementById("adminPassMsg");
    if (newP !== newP2) { msg.textContent = "New passwords do not match."; return; }
    const res = await changeAdminPassword(oldP, newP);
    msg.textContent = res.ok ? "Password changed." : res.error;
    if (res.ok) { document.getElementById("adm_oldpass").value = ""; document.getElementById("adm_newpass").value = ""; document.getElementById("adm_newpass2").value = ""; }
  });

  window.addEventListener("online", () => {
    renderCloudSyncCard();
    if (getTeacherSession()) setTeacherStatusText("ONLINE — SYNC AVAILABLE");
    // Catch up immediately instead of waiting for the next 20s tick.
    if (document.body.classList.contains("admin-mode") && ExtStore.get("adminPendingSync")) {
      performAdminSync({ silent: true });
    }
  });
  window.addEventListener("offline", () => { renderCloudSyncCard(); if (getTeacherSession()) setTeacherStatusText("OFFLINE — USING SAVED DATA"); });
}

/* ---------------------------- Boot ------------------------------------------ */
function bootGate() {
  wireGateEvents();
  renderCloudSyncCard();

  const badge = document.getElementById("fbStatusBadge");
  if (badge) badge.textContent = Sync.isConfigured() ? "connected" : "not configured";

  const teacherSession = getTeacherSession();
  const adminSession = getAdminSession();
  if (teacherSession) {
    enterTeacherMode(teacherSession.teacherId);
  } else if (adminSession) {
    // Resume silently only if this session matches the current device
    // (Firebase-backed sessions) or if we're still on the local fallback.
    if (adminSession.local || adminSession.deviceId === getDeviceId()) {
      enterAdminMode();
    } else {
      clearAdminSession();
    }
  }
  // else: stays on the public dashboard, exactly as before.
}

// script.js already ran init() synchronously above this script tag, so
// STATE/DOM are ready — boot immediately.
bootGate();
