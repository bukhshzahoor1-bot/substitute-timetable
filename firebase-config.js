/* =========================================================================
   ADD-ON: Firebase configuration.

   Firebase is only used for: Teacher Gmail+Access-Code verification,
   one-device binding, and Sync Now (timetable/substitute/notification
   sync). It is NOT required for the existing offline Timetable,
   Substitute Generation or Admin Panel — those keep working exactly as
   before with no internet at all.

   HOW TO SET THIS UP (one-time, takes about 5 minutes):

   1. Go to https://console.firebase.google.com and create a new project
      (or use an existing one).
   2. In the project, click "Add app" -> the Web icon (</>) -> register
      an app (any nickname). Firebase will show you a config object that
      looks like the one below — copy your own values into it here.
   3. In the left menu open "Build -> Firestore Database" -> "Create
      database". Start in production mode (recommended) or test mode.
   4. Open the "Rules" tab of Firestore and paste the contents of
      FIRESTORE_RULES.txt (included in this folder), then "Publish".
   5. Save this file. Reload index.html. The "Firebase" badge in
      Settings -> Teacher Login Management will change from
      "not configured" to "connected".

   Until this is filled in, Admin Login / the existing app work exactly
   as before, but Teacher Login and Sync Now will show a friendly
   "Firebase is not configured yet" message instead of failing silently.
   ========================================================================= */
window.FIREBASE_CONFIG = {
  apiKey: "PASTE_YOUR_API_KEY",
  authDomain: "PASTE_YOUR_PROJECT.firebaseapp.com",
  projectId: "PASTE_YOUR_PROJECT_ID",
  storageBucket: "PASTE_YOUR_PROJECT.appspot.com",
  messagingSenderId: "PASTE_YOUR_SENDER_ID",
  appId: "PASTE_YOUR_APP_ID"
};
