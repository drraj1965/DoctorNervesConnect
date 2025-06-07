// src/server/firebase-admin.ts

import { initializeApp, cert, getApps, App } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import path from "path";
import fs from "fs";

let app: App | undefined;
let db: FirebaseFirestore.Firestore | undefined;

function getServiceAccount() {
  const serviceAccountPath = path.resolve(
    process.cwd(),
    "server",
    "secrets",
    "serviceAccountKey.json"
  );

  if (!fs.existsSync(serviceAccountPath)) {
    throw new Error(
      `❌ Firebase service account key not found at ${serviceAccountPath}`
    );
  }

  const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, "utf8"));
  return serviceAccount;
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