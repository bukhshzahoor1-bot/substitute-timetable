/* =========================================================================
   ADD-ON: Firebase configuration.

   Firebase is only used for: Teacher Gmail+Access-Code verification,
   one-device binding, and Sync Now (timetable/substitute/notification
   sync). It is NOT required for the existing offline Timetable,
   Substitute Generation or Admin Panel — those keep working exactly as
   before with no internet at all.
   ========================================================================= */
window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyDlw49nX85DtNKPnvjZpJ_a1G_qADEpst4",
  authDomain: "pectaaexamspaper.firebaseapp.com",
  projectId: "pectaaexamspaper",
  storageBucket: "pectaaexamspaper.firebasestorage.app",
  messagingSenderId: "785885436663",
  appId: "1:785885436663:web:89c1d164959a75836551f2"
};
