
"use server";

import { db } from "@/lib/firebase/config";
import { doc, setDoc, serverTimestamp, getDoc } from "firebase/firestore";
import type { VideoMeta, DoctorProfile } from "@/types";
import { revalidatePath } from "next/cache";

// This action is specifically for videos uploaded from a local file
export async function saveUploadedVideoMetadataAction(videoData: Omit<VideoMeta, 'createdAt'> & { createdAt?: any }): Promise<{ success: boolean; videoId?: string; error?: string }> {
  const { id: videoId, ...dataToSave } = videoData;

  console.log("[UploadVideoAction:saveUploadedVideoMetadata] Received videoId:", videoId);
  console.log("[UploadVideoAction:saveUploadedVideoMetadata] Title:", dataToSave.title);
  console.log("[UploadVideoAction:saveUploadedVideoMetadata] Doctor ID:", dataToSave.doctorId);

  if (!dataToSave.doctorId) {
    console.error("[UploadVideoAction:saveUploadedVideoMetadata] No doctorId provided in videoData.");
    return { success: false, error: "Doctor ID is missing. Cannot save metadata." };
  }
  
  // Server-side check for admin status for logging - Firestore rules are the enforcer
  try {
    const doctorDocRef = doc(db, "doctors", dataToSave.doctorId);
    const doctorDocSnap = await getDoc(doctorDocRef);
    if (doctorDocSnap.exists()) {
      const doctorProfileData = doctorDocSnap.data() as DoctorProfile;
      if (doctorProfileData.isAdmin !== true) {
        console.warn(`[UploadVideoAction:saveUploadedVideoMetadata] DOCTOR ${dataToSave.doctorId} IS NOT ADMIN. isAdmin: ${doctorProfileData.isAdmin}`);
        // Firestore rules will ultimately block this if configured correctly.
      } else {
        console.log(`[UploadVideoAction:saveUploadedVideoMetadata] DOCTOR ${dataToSave.doctorId} IS ADMIN.`);
      }
    } else {
      console.warn(`[UploadVideoAction:saveUploadedVideoMetadata] No doctor document found for UID ${dataToSave.doctorId}. Firestore rules will deny.`);
    }
  } catch (profileError) {
    console.error(`[UploadVideoAction:saveUploadedVideoMetadata] Error fetching doctor profile for ${dataToSave.doctorId}:`, profileError);
  }

  if (!videoId || typeof videoId !== 'string' || videoId.trim() === '') {
    const errorMsg = "Invalid videoId received. Cannot save metadata.";
    console.error(`[UploadVideoAction:saveUploadedVideoMetadata] ${errorMsg}`);
    return { success: false, error: errorMsg };
  }

  try {
    const videoDocRef = doc(db, "videos", videoId);

    const finalData: VideoMeta = {
      ...dataToSave,
      id: videoId, // Ensure id is part of the final data
      createdAt: serverTimestamp() as any, // Firestore will set this
      // Ensure all fields are correctly mapped and present
      viewCount: dataToSave.viewCount || 0,
      likeCount: dataToSave.likeCount || 0,
      commentCount: dataToSave.commentCount || 0,
      comments: dataToSave.comments || [],
    };
    
    console.log("[UploadVideoAction:saveUploadedVideoMetadata] Final data for Firestore:", JSON.stringify(finalData, null, 2));

    await setDoc(videoDocRef, finalData);
    console.log("[UploadVideoAction:saveUploadedVideoMetadata] Successfully set document in Firestore for videoId:", videoId);

    revalidatePath('/dashboard');
    revalidatePath('/admin/dashboard');
    revalidatePath('/videos');
    revalidatePath(`/videos/${videoId}`);
    revalidatePath('/admin/manage-content');
    revalidatePath('/admin/upload-video');

    return { success: true, videoId: videoId };
  } catch (error: any) {
    console.error("[UploadVideoAction:saveUploadedVideoMetadata] CRITICAL ERROR saving video metadata for videoId:", videoId, error);
    let errorMessage = "Unknown error saving video metadata";
    if (error.code === 'permission-denied') {
      errorMessage = `Firestore save error: PERMISSION_DENIED: Missing or insufficient permissions. (Code: ${error.code})`;
    } else if (error instanceof Error) {
      errorMessage = error.message;
    } else if (typeof error === 'object' && error !== null && 'message' in error) {
      errorMessage = String((error as { message: string }).message);
    } else if (typeof error === 'string') {
      errorMessage = error;
    }
    return { success: false, error: errorMessage };
  }
}
