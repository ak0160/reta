import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import {
  browserLocalPersistence,
  browserSessionPersistence,
  getAuth,
  indexedDBLocalPersistence,
  initializeAuth,
} from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyD2JQYtC1bMPo0PYuHOfcf6q7cvmRpuwNM",
  authDomain: "reta-development.firebaseapp.com",
  projectId: "reta-development",
  storageBucket: "reta-development.firebasestorage.app",
  messagingSenderId: "947892961766",
  appId: "1:947892961766:web:f53dbc256cc7f74782d627",
};

const app = initializeApp(firebaseConfig);

// Firestore
export const db = getFirestore(app);

// ReTA uses email/password sign-in only. Avoid the unused redirect resolver,
// which proactively waits for an external auth iframe on Safari/iOS.
// Keep getAuth's persistence order so existing sessions remain available.
function initializeReadingAuth() {
  try {
    return initializeAuth(app, {
      persistence: [
        indexedDBLocalPersistence,
        browserLocalPersistence,
        browserSessionPersistence,
      ],
    });
  } catch (error) {
    // Fast Refresh can retain an Auth instance created before this module reloads.
    if ((error as { code?: string }).code === "auth/already-initialized") {
      return getAuth(app);
    }
    throw error;
  }
}

export const auth = initializeReadingAuth();
