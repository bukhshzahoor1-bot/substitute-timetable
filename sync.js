/* =========================================================================
   ADD-ON: Firebase Sync Engine.

   This file is new. It does not modify storage.js or script.js. It talks
   to Firestore for exactly the things the existing offline system cannot
   do by itself: verifying a teacher's Gmail + Access Code, enforcing the
   one-device lock, and syncing timetable/substitute data + a "new
   substitute" notification flag to teacher devices.

   The existing Admin Panel database (window.api / localStorage "ssms_*")
   is completely untouched by this file. Everything here reads STATE
   (declared in script.js, which loads before this file) but never
   writes to it directly — pushes/pulls go through Firestore and the
   separate "ssms_ext_*" local keys owned by gate.js.
   ========================================================================= */
(function () {
  let db = null;
  let fbReady = false;
  let fbInitTried = false;
  let authPromise = null;

  function isConfigured() {
    const c = window.FIREBASE_CONFIG;
    return !!(c && c.apiKey && c.projectId && !String(c.apiKey).startsWith("PASTE_"));
  }

  function ensureInit() {
    if (fbReady) return true;
    if (!isConfigured()) return false;
    if (typeof firebase === "undefined") return false; // CDN script blocked/offline on first load
    if (fbInitTried && !fbReady) return false;
    fbInitTried = true;
    try {
      if (!firebase.apps.length) firebase.initializeApp(window.FIREBASE_CONFIG);
      db = firebase.firestore();
      fbReady = true;
      return true;
    } catch (e) {
      console.error("Firebase init failed:", e);
      return false;
    }
  }

  function isOnline() {
    return typeof navigator !== "undefined" ? navigator.onLine : true;
  }

  // Firestore Security Rules (see FIRESTORE_RULES.txt) require a signed-in
  // request. We use Firebase Anonymous Auth purely so rules can check
  // request.auth != null — this is NOT the same as verifying WHICH teacher
  // is asking, since there is no backend here to issue a per-teacher token.
  // Gmail + Access Code + device binding is enforced by this app's own
  // logic (gate.js), not by Firestore rules. See the README for details.
  function ensureAuth() {
    if (!authPromise) {
      authPromise = new Promise((resolve) => {
        if (typeof firebase === "undefined" || !firebase.apps.length) { resolve(false); return; }
        if (firebase.auth().currentUser) { resolve(true); return; }
        firebase.auth().signInAnonymously().then(() => resolve(true)).catch((e) => { console.error("Anonymous sign-in failed:", e); resolve(false); });
      });
    }
    return authPromise;
  }

  async function fetchTeacherLogin(teacherId) {
    if (!ensureInit() || !isOnline()) return null;
    await ensureAuth();
    try {
      const snap = await db.collection("teacherLogins").doc(teacherId).get();
      return snap.exists ? snap.data() : null;
    } catch (e) { console.error("fetchTeacherLogin failed:", e); return null; }
  }

  async function findTeacherLoginByGmail(gmail) {
    if (!ensureInit() || !isOnline()) return null;
    await ensureAuth();
    try {
      const q = await db.collection("teacherLogins")
        .where("gmail", "==", gmail.toLowerCase().trim()).limit(1).get();
      if (q.empty) return null;
      const d = q.docs[0];
      return Object.assign({}, d.data(), { teacherId: d.id });
    } catch (e) { console.error("findTeacherLoginByGmail failed:", e); return null; }
  }

  async function saveTeacherLoginRemote(rec) {
    if (!ensureInit()) return { ok: false, offline: true };
    if (!isOnline()) return { ok: false, offline: true };
    await ensureAuth();
    try {
      await db.collection("teacherLogins").doc(rec.teacherId).set(rec, { merge: true });
      return { ok: true };
    } catch (e) { console.error("saveTeacherLoginRemote failed:", e); return { ok: false, error: e.message }; }
  }

  async function bumpSubstituteNotify(teacherId) {
    if (!ensureInit() || !isOnline()) return;
    await ensureAuth();
    try {
      const ref = db.collection("substituteNotify").doc(teacherId);
      await db.runTransaction(async (tx) => {
        const doc = await tx.get(ref);
        const cur = doc.exists ? (doc.data().flagVersion || 0) : 0;
        tx.set(ref, { teacherId, flagVersion: cur + 1, updatedAt: new Date().toISOString() });
      });
    } catch (e) { console.error("bumpSubstituteNotify failed:", e); }
  }

  async function getSubstituteNotifyVersion(teacherId) {
    if (!ensureInit() || !isOnline()) return null;
    await ensureAuth();
    try {
      const snap = await db.collection("substituteNotify").doc(teacherId).get();
      return snap.exists ? (snap.data().flagVersion || 0) : 0;
    } catch (e) { console.error("getSubstituteNotifyVersion failed:", e); return null; }
  }

  // Rolling window of dates around "today" — keeps the synced payload
  // small instead of uploading the entire substitute history every time.
  function syncDateWindow(daysBack, daysFwd) {
    const out = [];
    for (let i = -daysBack; i <= daysFwd; i++) {
      const d = new Date();
      d.setDate(d.getDate() + i);
      out.push(d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"));
    }
    return out;
  }

  async function pushSchoolData() {
    if (!ensureInit()) return { ok: false, error: "Firebase is not configured yet." };
    if (!isOnline()) return { ok: false, offline: true };
    await ensureAuth();
    try {
      const subsWindow = {};
      syncDateWindow(3, 3).forEach((dt) => {
        if (STATE.substitutes[dt]) subsWindow[dt] = STATE.substitutes[dt];
      });
      await db.collection("schoolData").doc("main").set({
        teachers: STATE.teachers.map((t) => ({ id: t.id, name: t.name, level: t.level, subject: t.subject, designation: t.designation })),
        periods: STATE.periods,
        timetables: STATE.timetables,
        substitutes: subsWindow,
        settingsBell: (STATE.settings && STATE.settings.bell) || null,
        updatedAt: new Date().toISOString()
      }, { merge: true });
      return { ok: true };
    } catch (e) { console.error("pushSchoolData failed:", e); return { ok: false, error: e.message }; }
  }

  async function pullSchoolData() {
    if (!ensureInit()) return { ok: false, error: "Firebase is not configured yet." };
    if (!isOnline()) return { ok: false, offline: true };
    await ensureAuth();
    try {
      const snap = await db.collection("schoolData").doc("main").get();
      if (!snap.exists) return { ok: false, error: "No synced school data yet — ask Admin to press Sync Now first." };
      return { ok: true, data: snap.data() };
    } catch (e) { console.error("pullSchoolData failed:", e); return { ok: false, error: e.message }; }
  }

  /* -------- Admin account (Firebase-backed, single admin per deployment,
     device-bound the same way Teacher accounts are) -------- */
  async function fetchAdminAuth() {
    if (!ensureInit() || !isOnline()) return null;
    await ensureAuth();
    try {
      const snap = await db.collection("adminLogins").doc("main").get();
      return snap.exists ? snap.data() : null;
    } catch (e) { console.error("fetchAdminAuth failed:", e); return null; }
  }

  async function saveAdminAuthRemote(rec) {
    if (!ensureInit()) return { ok: false, offline: true };
    if (!isOnline()) return { ok: false, offline: true };
    await ensureAuth();
    try {
      await db.collection("adminLogins").doc("main").set(rec, { merge: true });
      return { ok: true };
    } catch (e) { console.error("saveAdminAuthRemote failed:", e); return { ok: false, error: e.message }; }
  }

  window.Sync = {
    isConfigured, ensureInit, isOnline,
    fetchTeacherLogin, findTeacherLoginByGmail, saveTeacherLoginRemote,
    bumpSubstituteNotify, getSubstituteNotifyVersion,
    pushSchoolData, pullSchoolData,
    fetchAdminAuth, saveAdminAuthRemote
  };
})();
