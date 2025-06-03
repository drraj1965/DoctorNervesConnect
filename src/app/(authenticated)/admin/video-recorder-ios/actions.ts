
"use server";

import { db } from "@/lib/firebase/config";
import { doc, setDoc, serverTimestamp, getDoc } from "firebase/firestore"; // Added getDoc
import type { VideoMeta, DoctorProfile } from "@/types"; 
import { revalidatePath } from "next/cache";

interface IOSVideoDataForFirestore {
  videoId: string;
  title: string;
  description: string;
  keywords: string[];
  videoUrl: string;
  storagePath: string;
  thumbnailUrl: string;
  thumbnailStoragePath: string;
  videoSize: number;
  videoType: string;
  recordingDuration: number;
  doctorId: string;
  doctorName: string;
  // Explicitly add missing fields from VideoMeta for initialization
  duration: string; // Formatted string duration
  viewCount: number;
  likeCount: number;
  commentCount: number;
  featured: boolean;
  comments: []; // Initialize as empty array
}

export async function addVideoMetadataFromIOSAction(videoData: IOSVideoDataForFirestore): Promise<{ success: boolean; videoId?: string; error?: string }> {
  const { videoId, ...dataToSave } = videoData;

  console.log("[iOSAction:addVideoMetadata] Received videoId:", videoId);
  console.log("[iOSAction:addVideoMetadata] Title:", dataToSave.title);
  console.log("[iOSAction:addVideoMetadata] Doctor ID from client:", dataToSave.doctorId);
  
  // Server-side check for admin status for logging - Firestore rules are the enforcer
  if (dataToSave.doctorId) {
    try {
      const doctorDocRef = doc(db, "doctors", dataToSave.doctorId);
      const doctorDocSnap = await getDoc(doctorDocRef);
      if (doctorDocSnap.exists()) {
        const doctorData = doctorDocSnap.data() as DoctorProfile; // Assuming DoctorProfile is correct type
        console.log(`[iOSAction:addVideoMetadata] Doctor profile for ${dataToSave.doctorId} found:`, JSON.stringify(doctorData));
        if (doctorData.isAdmin !== true) {
          console.warn(`[iOSAction:addVideoMetadata] DOCTOR ${dataToSave.doctorId} IS NOT ADMIN according to their Firestore document. isAdmin: ${doctorData.isAdmin}`);
        } else {
           console.log(`[iOSAction:addVideoMetadata] DOCTOR ${dataToSave.doctorId} IS ADMIN according to their Firestore document.`);
        }
      } else {
        console.warn(`[iOSAction:addVideoMetadata] No doctor document found for UID ${dataToSave.doctorId}. Firestore rules will likely deny.`);
      }
    } catch (profileError) {
      console.error(`[iOSAction:addVideoMetadata] Error fetching doctor profile for ${dataToSave.doctorId}:`, profileError);
    }
  } else {
     console.error("[iOSAction:addVideoMetadata] No doctorId provided in videoData. This will fail Firestore rules if rules depend on it for path or explicit check beyond request.auth.uid.");
  }


  if (!videoId || typeof videoId !== 'string' || videoId.trim() === '') {
    const errorMsg = "Invalid videoId received. Cannot save metadata.";
    console.error(`[iOSAction:addVideoMetadata] ${errorMsg}`);
    return { success: false, error: errorMsg };
  }

  try {
    const videoDocRef = doc(db, "videos", videoId);

    // Ensure all fields required by VideoMeta are present
    const finalData: VideoMeta = {
      id: videoId,
      title: dataToSave.title,
      description: dataToSave.description,
      doctorId: dataToSave.doctorId,
      doctorName: dataToSave.doctorName,
      videoUrl: dataToSave.videoUrl,
      thumbnailUrl: dataToSave.thumbnailUrl,
      duration: dataToSave.duration, // Already formatted string
      recordingDuration: dataToSave.recordingDuration, // Number in seconds
      tags: dataToSave.keywords, // Assuming keywords map to tags
      createdAt: serverTimestamp() as any, 
      viewCount: dataToSave.viewCount || 0,
      likeCount: dataToSave.likeCount || 0,
      commentCount: dataToSave.commentCount || 0,
      featured: dataToSave.featured || false,
      permalink: `/videos/${videoId}`,
      storagePath: dataToSave.storagePath,
      thumbnailStoragePath: dataToSave.thumbnailStoragePath,
      videoSize: dataToSave.videoSize,
      videoType: dataToSave.videoType,
      comments: dataToSave.comments || [],
    };

    console.log("[iOSAction:addVideoMetadata] Final data object being sent to Firestore:", JSON.stringify(finalData, null, 2));
    console.log("[iOSAction:addVideoMetadata] Attempting to set document in Firestore for videoId:", videoId);

    try {
      await setDoc(videoDocRef, finalData);
      console.log("[iOSAction:addVideoMetadata] Successfully set document in Firestore for videoId:", videoId);
    } catch (firestoreError: any) {
      console.error("[iOSAction:addVideoMetadata] Firestore setDoc specific error for videoId:", videoId, firestoreError);
      console.error("  - Firestore error code:", firestoreError.code);
      console.error("  - Firestore error message:", firestoreError.message);
       if (firestoreError.code === 'permission-denied') {
         return { success: false, error: `Firestore save error: 7 PERMISSION_DENIED: Missing or insufficient permissions. (Code: ${firestoreError.code})` };
       }
      return { success: false, error: `Firestore save error: ${firestoreError.message} (Code: ${firestoreError.code})` };
    }

    console.log("[iOSAction:addVideoMetadata] Revalidating paths...");
    revalidatePath('/dashboard');
    revalidatePath('/admin/dashboard');
    revalidatePath('/videos');
    revalidatePath(`/videos/${videoId}`);
    revalidatePath('/admin/manage-content');
    console.log("[iOSAction:addVideoMetadata] Paths revalidated.");

    return { success: true, videoId: videoId };
  } catch (error) {
    console.error("[iOSAction:addVideoMetadata] UNEXPECTED CRITICAL ERROR for videoId:", videoId, error);
    let errorMessage = "Unknown error saving video metadata";
    if (error instanceof Error) {
      errorMessage = error.message;
    } else if (typeof error === 'object' && error !== null && 'message' in error) {
      errorMessage = String((error as { message: string }).message);
    } else if (typeof error === 'string') {
      errorMessage = error;
    }
    return { success: false, error: errorMessage };
  }
}

// This function was in the original file, ensure it's used or remove if not needed by this specific action.
// If it's purely for display, it should be on the client. If needed for data transformation before save, it's fine here.
// Based on the current structure, this seems like a client-side utility.
// function formatDurationFromSeconds(totalSeconds: number): string {
//   const hours = Math.floor(totalSeconds / 3600);
//   const minutes = Math.floor((totalSeconds % 3600) / 60);
//   const seconds = Math.floor(totalSeconds % 60);
//   const paddedSeconds = String(seconds).padStart(2, '0');
//   const paddedMinutes = String(minutes).padStart(2, '0');
//   if (hours > 0) {
//     const paddedHours = String(hours).padStart(2, '0');
//     return `${paddedHours}:${paddedMinutes}:${paddedSeconds}`;
//   }
//   return `${paddedMinutes}:${paddedSeconds}`;
// }
