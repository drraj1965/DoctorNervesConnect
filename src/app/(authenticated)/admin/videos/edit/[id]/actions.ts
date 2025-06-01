
"use server";

import { db, storage } from "@/lib/firebase/config";
import { doc, updateDoc, getDoc } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
import { revalidatePath } from "next/cache";
import type { VideoMeta } from "@/types";

export async function updateVideoThumbnailAction(
  videoId: string,
  newThumbnailFile: Blob,
  currentThumbnailPath?: string | null 
): Promise<{ success: boolean; error?: string; newThumbnailUrl?: string }> {
  try {
    const videoDocRef = doc(db, "videos", videoId);
    const videoDocSnap = await getDoc(videoDocRef);

    if (!videoDocSnap.exists()) {
      return { success: false, error: "Video document not found." };
    }
    const videoData = videoDocSnap.data() as VideoMeta;

    // 1. Delete old thumbnail from Storage (if it exists and is different)
    if (currentThumbnailPath && currentThumbnailPath !== videoData.thumbnailStoragePath) {
        //This condition should ideally not be met if currentThumbnailPath is from videoData.thumbnailStoragePath
        //But as a safeguard:
        try {
            const oldThumbRef = ref(storage, currentThumbnailPath);
            await deleteObject(oldThumbRef);
        } catch (error: any) {
            if (error.code !== 'storage/object-not-found') {
                console.warn("Could not delete old thumbnail (path mismatch):", error);
            }
        }
    } else if (videoData.thumbnailStoragePath) {
         try {
            const oldThumbRef = ref(storage, videoData.thumbnailStoragePath);
            await deleteObject(oldThumbRef);
        } catch (error: any) {
            if (error.code !== 'storage/object-not-found') {
                console.warn("Could not delete current thumbnail:", error);
                // Continue, as replacing is the main goal
            }
        }
    }


    // 2. Upload new thumbnail to Storage
    const newThumbnailFileName = `thumbnail_${videoId}_${Date.now()}.jpg`; // Ensure unique name
    // Assuming doctorId is available on videoData, or use a generic path
    const doctorId = videoData.doctorId || "unknown_doctor"; 
    const newThumbnailStoragePath = `thumbnails/${doctorId}/${newThumbnailFileName}`;
    const newThumbRef = ref(storage, newThumbnailStoragePath);
    
    await uploadBytes(newThumbRef, newThumbnailFile);
    const newThumbnailUrl = await getDownloadURL(newThumbRef);

    // 3. Update Firestore document
    await updateDoc(videoDocRef, {
      thumbnailUrl: newThumbnailUrl,
      thumbnailStoragePath: newThumbnailStoragePath,
    });

    // 4. Revalidate paths
    revalidatePath("/videos");
    revalidatePath(`/videos/${videoId}`);
    revalidatePath(`/admin/videos/edit/${videoId}`);
    revalidatePath("/admin/manage-content");
    revalidatePath("/dashboard");


    return { success: true, newThumbnailUrl };
  } catch (error) {
    console.error("Error updating video thumbnail:", error);
    return { success: false, error: error instanceof Error ? error.message : "An unknown error occurred." };
  }
}
