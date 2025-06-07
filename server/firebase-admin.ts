// server/firebase-admin.ts
import { initializeApp, cert, getApps, App } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import path from "path";
import { readFileSync } from "fs";

const serviceAccountPath = path.join(
  __dirname,
  "secrets",
  "serviceAccountKey.json"
);

const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, "utf8"));

const app: App =
  getApps().length === 0
    ? initializeApp({
        credential: cert(serviceAccount),
      })
    : getApps()[0];

export const db = getFirestore(app);