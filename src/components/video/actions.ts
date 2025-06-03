
"use server";

import { db } from "@/lib/firebase/config";
import { doc, setDoc, serverTimestamp, getDoc } from "firebase/firestore"; // Added getDoc
import type { VideoMeta, DoctorProfile } from "@/types";
import { revalidatePath } from "next/cache";
import { headers } from 'next/headers'; // To potentially get auth info if needed, though rules handle it

interface VideoDataForFirestore extends Omit<VideoMeta, 'id' | 'createdAt' | 'permalink'> {
  videoId: string;
}

export async function addVideoMetadataToFirestore(videoData: VideoDataForFirestore): Promise<{ success: boolean; videoId?: string; error?: string }> {
  const { videoId, ...dataToSave } = videoData;

  console.log("[Action:addVideoMetadataToFirestore] Received videoId:", videoId);
  console.log("[Action:addVideoMetadataToFirestore] Title:", dataToSave.title);
  console.log("[Action:addVideoMetadataToFirestore] Doctor ID from client:", dataToSave.doctorId);

  // Attempt to verify admin status based on passed doctorId from client
  // This is mostly for logging, as Firestore rules are the enforcer.
  if (dataToSave.doctorId) {
    try {
      const doctorDocRef = doc(db, "doctors", dataToSave.doctorId);
      const doctorDocSnap = await getDoc(doctorDocRef);
      if (doctorDocSnap.exists()) {
        const doctorData = doctorDocSnap.data() as DoctorProfile;
        console.log(`[Action:addVideoMetadataToFirestore] Doctor profile for ${dataToSave.doctorId} found:`, JSON.stringify(doctorData));
        if (doctorData.isAdmin !== true) {
          console.warn(`[Action:addVideoMetadataToFirestore] DOCTOR ${dataToSave.doctorId} IS NOT ADMIN according to their Firestore document. isAdmin: ${doctorData.isAdmin}`);
          // Not returning error here, let Firestore rules do it.
        } else {
           console.log(`[Action:addVideoMetadataToFirestore] DOCTOR ${dataToSave.doctorId} IS ADMIN according to their Firestore document.`);
        }
      } else {
        console.warn(`[Action:addVideoMetadataToFirestore] No doctor document found for UID ${dataToSave.doctorId}. Firestore rules will likely deny.`);
      }
    } catch (profileError) {
      console.error(`[Action:addVideoMetadataToFirestore] Error fetching doctor profile for ${dataToSave.doctorId}:`, profileError);
    }
  } else {
     console.error("[Action:addVideoMetadataToFirestore] No doctorId provided in videoData. This will fail Firestore rules.");
     // return { success: false, error: "No doctorId provided with video metadata." }; // Could return early
  }


  if (!videoId || typeof videoId !== 'string' || videoId.trim() === '') {
    const errorMsg = "Invalid videoId received. Cannot save metadata.";
    console.error(`[Action:addVideoMetadataToFirestore] ${errorMsg}`);
    return { success: false, error: errorMsg };
  }

  try {
    const videoDocRef = doc(db, "videos", videoId);

    const finalData: VideoMeta = {
      ...dataToSave,
      id: videoId,
      createdAt: serverTimestamp() as any, 
      permalink: `/videos/${videoId}`,
      viewCount: dataToSave.viewCount || 0,
      likeCount: dataToSave.likeCount || 0, // Ensure initialized
      commentCount: dataToSave.commentCount || 0, // Ensure initialized
      featured: dataToSave.featured || false,
      comments: dataToSave.comments || [],
      // Ensure all fields from your example data structure are present
      recordingDuration: dataToSave.recordingDuration || 0, // Number
      duration: dataToSave.duration || "00:00", // String
      videoSize: dataToSave.videoSize || 0,
      videoType: dataToSave.videoType || "video/webm",
    };

    console.log("[Action:addVideoMetadataToFirestore] Final data object being sent to Firestore:", JSON.stringify(finalData, null, 2));
    console.log("[Action:addVideoMetadataToFirestore] Attempting to set document in Firestore for videoId:", videoId);

    try {
      await setDoc(videoDocRef, finalData);
      console.log("[Action:addVideoMetadataToFirestore] Successfully set document in Firestore for videoId:", videoId);
    } catch (firestoreError: any) {
      console.error("[Action:addVideoMetadataToFirestore] Firestore setDoc specific error for videoId:", videoId, firestoreError);
      console.error("  - Firestore error code:", firestoreError.code);
      console.error("  - Firestore error message:", firestoreError.message);
      // Construct a more specific error message if it's a permission issue
      if (firestoreError.code === 'permission-denied') {
        return { success: false, error: `Firestore save error: 7 PERMISSION_DENIED: Missing or insufficient permissions. (Code: ${firestoreError.code})` };
      }
      return { success: false, error: `Firestore save error: ${firestoreError.message} (Code: ${firestoreError.code})` };
    }

    console.log("[Action:addVideoMetadataToFirestore] Revalidating paths...");
    revalidatePath('/dashboard');
    revalidatePath('/admin/dashboard');
    revalidatePath('/videos');
    revalidatePath(`/videos/${videoId}`);
    revalidatePath('/admin/manage-content');
    console.log("[Action:addVideoMetadataToFirestore] Paths revalidated.");

    return { success: true, videoId: videoId };
  } catch (error) {
    console.error("[Action:addVideoMetadataToFirestore] UNEXPECTED CRITICAL ERROR for videoId:", videoId, error);
    let errorMessage = "Unknown error saving video metadata";
    if (error instanceof Error) {
      errorMessage = error.message;
    } else if (typeof error === 'object' && error !== null && 'message' in error) {
      errorMessage = String((error as { message: string }).message);
    } else if (typeof error === 'string') {
      errorMessage = error;
    }
    console.error("[Action:addVideoMetadataToFirestore] Parsed unexpected error message:", errorMessage);
    return { success: false, error: errorMessage };
  }
}
