// studio/server/actions/saveVideoMetadataAction.ts

import { getDb } from "@/server/firebase-admin";
const db = getDb();
import { Timestamp } from "firebase-admin/firestore";
import { VideoMeta } from "@/types/video"; // Adjust path as needed

export async function saveVideoMetadataAction(video: VideoMeta): Promise<{ success: boolean; error?: string }> {
  try {
    const docRef = db.collection("videos").doc(video.id);
    const payload = {
      ...video,
      createdAt: Timestamp.now(),
    };
    await docRef.set(payload);
    return { success: true };
  } catch (error: any) {
    console.error("🔥 Firestore save failed:", error);
    return { success: false, error: error.message || "Unknown Firestore error" };
  }
}