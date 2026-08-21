/* =========================================================================
   Government School Substitute Teacher Management System
   BROWSER STORAGE ENGINE — no Electron, no Node.js, no install.

   This file replaces the old Electron main-process/SQLite bridge
   (main.js + preload.js). It builds the exact same window.api surface
   that script.js already calls, but backed by the browser's own
   localStorage instead of a native database file. Just double-click
   index.html and everything works, saved permanently in this browser
   on this computer.

   Because data now lives in this browser's storage only, use
   "Export Backup" regularly to save a portable .json copy — that file
   is also how to move your data to another computer or browser.
   ========================================================================= */
(function () {
  const PREFIX = "ssms_";
  const DATA_KEYS = ["school", "teachers", "periods", "timetables", "attendance", "substitutes", "settings", "theme"];
  const BACKUPS_KEY = PREFIX + "backups";
  const MAX_BACKUPS = 30;

  function readKey(key) {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function writeKey(key, value) {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  }

  function loadAll() {
    const out = {};
    DATA_KEYS.forEach((k) => { out[k] = readKey(k); });
    return out;
  }

  function todayStamp() {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function readBackups() {
    try {
      const raw = localStorage.getItem(BACKUPS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function writeBackups(list) {
    try {
      localStorage.setItem(BACKUPS_KEY, JSON.stringify(list));
    } catch (e) {
      // Storage is full — drop older snapshots and try once more so a
      // save never fails just because backup history got too big.
      const trimmed = list.slice(0, Math.max(1, Math.floor(list.length / 2)));
      try { localStorage.setItem(BACKUPS_KEY, JSON.stringify(trimmed)); } catch (e2) { /* give up quietly */ }
    }
  }

  // One automatic snapshot per calendar day, same behaviour as before.
  function maybeSnapshotToday() {
    const name = "auto_" + todayStamp();
    const backups = readBackups();
    if (backups.some((b) => b.name === name)) return;
    backups.unshift({ name, timestamp: new Date().toISOString(), data: loadAll() });
    writeBackups(backups.slice(0, MAX_BACKUPS));
  }

  function saveKey(key, value) {
    writeKey(key, value);
    maybeSnapshotToday();
    return true;
  }

  function getTheme() { return readKey("theme") || "light"; }
  function setTheme(value) { writeKey("theme", value); return true; }

  function resetAll() {
    DATA_KEYS.forEach((k) => localStorage.removeItem(PREFIX + k));
    localStorage.removeItem(BACKUPS_KEY);
    return {};
  }

  function getDataDir() { return "this browser's local storage, on this computer"; }
  function getRecoveryMessage() { return null; }
  function getLocationWarning() { return null; }

  /* Export: a normal browser download — works from a plain index.html
     file with no server and no Electron involved. */
  function exportBackup(jsonString) {
    return new Promise((resolve) => {
      try {
        const blob = new Blob([jsonString], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "ssms_backup_" + todayStamp() + ".json";
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
        resolve({ ok: true, filePath: "your browser's Downloads folder as " + a.download });
      } catch (err) {
        resolve({ ok: false, error: err.message });
      }
    });
  }

  /* Import: opens the browser's native "Open File" picker via a hidden
     file input, then reads the chosen file's text. */
  function importBackup() {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "application/json";
      input.style.display = "none";
      let settled = false;

      input.addEventListener("change", () => {
        const file = input.files && input.files[0];
        input.remove();
        if (!file) { settled = true; resolve({ ok: false, canceled: true }); return; }
        const reader = new FileReader();
        reader.onload = () => { settled = true; resolve({ ok: true, content: reader.result }); };
        reader.onerror = () => { settled = true; resolve({ ok: false, error: "Could not read the selected file." }); };
        reader.readAsText(file);
      });

      // If the user closes the picker without choosing a file, most
      // browsers don't fire "change" at all — treat a window refocus
      // with nothing picked as a cancel so the button never hangs.
      // Important: input.files is already populated the instant the
      // dialog closes (before "change" fires), so we check THAT rather
      // than racing a fixed timer against "change" — a slow disk/AV
      // scan delaying "change" past a short timer was silently marking
      // real imports as "canceled" and doing nothing.
      window.addEventListener("focus", function onFocus() {
        window.removeEventListener("focus", onFocus);
        setTimeout(() => {
          if (settled) return;
          if (input.files && input.files.length > 0) return; // a file was picked — "change" is on its way
          settled = true;
          resolve({ ok: false, canceled: true });
        }, 500);
      }, { once: true });

      document.body.appendChild(input);
      input.click();
    });
  }

  function listBackups() {
    return Promise.resolve(
      readBackups().map((b) => ({
        name: b.name,
        path: b.name,
        mtime: b.timestamp,
        sizeBytes: JSON.stringify(b.data).length
      }))
    );
  }

  function restoreBackup(name) {
    return new Promise((resolve) => {
      const found = readBackups().find((b) => b.name === name);
      if (!found) { resolve({ ok: false, error: "That backup could not be found." }); return; }
      DATA_KEYS.forEach((k) => {
        if (found.data[k] !== undefined) writeKey(k, found.data[k]);
      });
      resolve({ ok: true, data: loadAll() });
    });
  }

  window.api = {
    loadAll, saveKey, getTheme, setTheme, resetAll, getDataDir,
    getRecoveryMessage, getLocationWarning,
    exportBackup, importBackup, listBackups, restoreBackup
  };
})();
