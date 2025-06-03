
"use server";

import { db } from "@/lib/firebase/config";
import { doc, setDoc, serverTimestamp, getDoc } from "firebase/firestore";
import type { VideoMeta, DoctorProfile } from "@/types";
import { revalidatePath } from "next/cache";

// This action is specifically for videos uploaded from a local file
export async function saveUploadedVideoMetadataAction(videoData: Omit<VideoMeta, 'createdAt'> & { createdAt?: any }): Promise<{ success: boolean; videoId?: string; error?: string }> {
  const { id: videoId, ...dataToSave } = videoData;

  console.log("[UploadVideoAction:saveUploadedVideoMetadata] Received videoId:", videoId);
  console.log("[UploadVideoAction:saveUploadedVideoMetadata] Full data received by action (dataToSave):", JSON.stringify(dataToSave, null, 2));
  console.log("[UploadVideoAction:saveUploadedVideoMetadata] Client-provided createdAt:", dataToSave.createdAt);
  console.log("[UploadVideoAction:saveUploadedVideoMetadata] Doctor ID from dataToSave:", dataToSave.doctorId);


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
      console.log(`[UploadVideoAction:saveUploadedVideoMetadata] Doctor profile for ${dataToSave.doctorId} (used for isAdmin check):`, JSON.stringify(doctorProfileData));
      if (doctorProfileData.isAdmin !== true) {
        console.warn(`[UploadVideoAction:saveUploadedVideoMetadata] DOCTOR ${dataToSave.doctorId} IS NOT ADMIN. isAdmin: ${doctorProfileData.isAdmin}`);
      } else {
        console.log(`[UploadVideoAction:saveUploadedVideoMetadata] DOCTOR ${dataToSave.doctorId} IS ADMIN.`);
      }
    } else {
      console.warn(`[UploadVideoAction:saveUploadedVideoMetadata] No doctor document found for UID ${dataToSave.doctorId}. Firestore rules will deny if they depend on this specific doctorId being an admin.`);
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

    // Ensure all fields align with VideoMeta and Firestore rules
    const finalData: VideoMeta = {
      id: videoId, // Explicitly set, also part of videoData
      title: dataToSave.title,
      description: dataToSave.description,
      doctorId: dataToSave.doctorId,
      doctorName: dataToSave.doctorName,
      videoUrl: dataToSave.videoUrl,
      thumbnailUrl: dataToSave.thumbnailUrl,
      duration: dataToSave.duration, // String like "01:23"
      recordingDuration: dataToSave.recordingDuration, // Number of seconds
      tags: dataToSave.tags || [], // Ensure it's an array
      createdAt: serverTimestamp() as any, // Firestore will set this to a server-side timestamp
      viewCount: dataToSave.viewCount || 0,
      likeCount: dataToSave.likeCount || 0,
      commentCount: dataToSave.commentCount || 0,
      featured: dataToSave.featured || false,
      permalink: dataToSave.permalink || `/videos/${videoId}`,
      storagePath: dataToSave.storagePath,
      thumbnailStoragePath: dataToSave.thumbnailStoragePath,
      videoSize: dataToSave.videoSize || 0,
      videoType: dataToSave.videoType || 'video/webm', // Default if not provided
      comments: dataToSave.comments || [], // Ensure it's an array
    };
    
    console.log("[UploadVideoAction:saveUploadedVideoMetadata] FINAL data object for Firestore setDoc:", JSON.stringify(finalData, null, 2));

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
    console.error("[UploadVideoAction:saveUploadedVideoMetadata] Error Code:", error.code);
    console.error("[UploadVideoAction:saveUploadedVideoMetadata] Error Message:", error.message);
    console.error("[UploadVideoAction:saveUploadedVideoMetadata] Error Stack:", error.stack);


    let errorMessage = "Unknown error saving video metadata";
    if (error.code === 'permission-denied' || (error.message && error.message.includes("PERMISSION_DENIED"))) {
      errorMessage = `Firestore save error: PERMISSION_DENIED: Missing or insufficient permissions. (Code: ${error.code || 'permission-denied'})`;
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
