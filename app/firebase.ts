import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

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

// Authentication
export const auth = getAuth(app);
