// src/server/firebase-admin.ts

import { initializeApp, cert, getApps, App } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

let app: App | undefined;
let db: FirebaseFirestore.Firestore | undefined;

function getServiceAccount() {
  const keyBase64 = process.env.FIREBASE_ADMIN_KEY;

  if (!keyBase64) {
    throw new Error("❌ Missing FIREBASE_ADMIN_KEY environment variable.");
  }

  try {
    const decoded = Buffer.from(keyBase64, "base64").toString("utf-8");
    const serviceAccount = JSON.parse(decoded);
    return serviceAccount;
  } catch (error) {
    throw new Error("❌ Failed to parse FIREBASE_ADMIN_KEY. Ensure it is base64-encoded.");
  }
}

export function getDb(): FirebaseFirestore.Firestore {
  if (!app || !db) {
    const serviceAccount = getServiceAccount();
    app =
      getApps().length === 0
        ? initializeApp({
            credential: cert(serviceAccount),
          })
        : getApps()[0];
    db = getFirestore(app);
  }

  return db;
}
