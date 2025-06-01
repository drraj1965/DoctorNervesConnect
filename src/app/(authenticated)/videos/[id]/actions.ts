
"use server";

import { db, storage } from "@/lib/firebase/config";
import { doc, deleteDoc, getDoc } from "firebase/firestore";
import { ref, deleteObject } from "firebase/storage";
import { revalidatePath } from "next/cache";
import type { VideoMeta } from "@/types";

export async function deleteVideoAction(
  videoId: string,
  videoStoragePath: string,
  thumbnailStoragePath: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // 1. Delete Firestore document
    const videoDocRef = doc(db, "videos", videoId);
    const videoDocSnap = await getDoc(videoDocRef);

    if (!videoDocSnap.exists()) {
      return { success: false, error: "Video document not found." };
    }
    
    await deleteDoc(videoDocRef);

    // 2. Delete video file from Storage
    if (videoStoragePath) {
      const videoFileRef = ref(storage, videoStoragePath);
      try {
        await deleteObject(videoFileRef);
      } catch (storageError: any) {
        // Log error but continue to delete thumbnail and revalidate
        console.warn(`Failed to delete video file (${videoStoragePath}): ${storageError.message}. Continuing to delete Firestore record and thumbnail.`);
        if (storageError.code === 'storage/object-not-found') {
            // If object not found, it's fine, maybe already deleted.
        } else {
            // For other storage errors, you might still want to consider the operation partially failed.
        }
      }
    }

    // 3. Delete thumbnail file from Storage
    if (thumbnailStoragePath) {
      const thumbnailFileRef = ref(storage, thumbnailStoragePath);
       try {
        await deleteObject(thumbnailFileRef);
      } catch (storageError: any) {
        console.warn(`Failed to delete thumbnail file (${thumbnailStoragePath}): ${storageError.message}.`);
         if (storageError.code === 'storage/object-not-found') {
            // If object not found, it's fine.
        }
      }
    }

    // 4. Revalidate paths
    revalidatePath("/videos");
    revalidatePath(`/videos/${videoId}`);
    revalidatePath("/dashboard"); // General dashboard
    revalidatePath("/admin/dashboard"); // Admin dashboard if separate
    revalidatePath("/admin/manage-content");


    return { success: true };
  } catch (error) {
    console.error("Error deleting video:", error);
    return { success: false, error: error instanceof Error ? error.message : "An unknown error occurred during deletion." };
  }
}
