
"use server";

import { db } from "@/lib/firebase/config";
import { doc, setDoc, serverTimestamp, getDoc } from "firebase/firestore";
import type { VideoMeta, DoctorProfile } from "@/types";
import { revalidatePath } from "next/cache";

// The data coming from VideoRecorder.tsx's handleUpload will now directly include 'id'
// and other fields matching VideoMeta, excluding server-set ones.
interface VideoDataForCreation extends Omit<VideoMeta, 'createdAt' | 'permalink' | 'viewCount' | 'likeCount' | 'commentCount' | 'comments'> {
  // id is already part of VideoMeta and will be provided
}

export async function addVideoMetadataToFirestore(videoData: VideoDataForCreation): Promise<{ success: boolean; id?: string; error?: string }> {
  const { id, ...dataToSave } = videoData; // dataToSave now contains title, description, doctorId, etc.

  console.log("[Action:addVideoMetadataToFirestore] Received id:", id);
  console.log("[Action:addVideoMetadataToFirestore] Title:", dataToSave.title);
  console.log("[Action:addVideoMetadataToFirestore] Doctor ID from client:", dataToSave.doctorId);

  if (!id || typeof id !== 'string' || id.trim() === '') {
    const errorMsg = "Invalid video ID (id field) received. Cannot save metadata.";
    console.error(`[Action:addVideoMetadataToFirestore] ${errorMsg}`);
    return { success: false, error: errorMsg };
  }

  if (dataToSave.doctorId) {
    try {
      const doctorDocRef = doc(db, "doctors", dataToSave.doctorId);
      const doctorDocSnap = await getDoc(doctorDocRef);
      if (doctorDocSnap.exists()) {
        const doctorData = doctorDocSnap.data() as DoctorProfile;
        console.log(`[Action:addVideoMetadataToFirestore] Doctor profile for ${dataToSave.doctorId} found:`, JSON.stringify(doctorData));
        if (doctorData.isAdmin !== true) {
          console.warn(`[Action:addVideoMetadataToFirestore] DOCTOR ${dataToSave.doctorId} IS NOT ADMIN. isAdmin: ${doctorData.isAdmin}`);
        } else {
           console.log(`[Action:addVideoMetadataToFirestore] DOCTOR ${dataToSave.doctorId} IS ADMIN.`);
        }
      } else {
        console.warn(`[Action:addVideoMetadataToFirestore] No doctor document found for UID ${dataToSave.doctorId}.`);
      }
    } catch (profileError) {
      console.error(`[Action:addVideoMetadataToFirestore] Error fetching doctor profile for ${dataToSave.doctorId}:`, profileError);
    }
  } else {
     console.error("[Action:addVideoMetadataToFirestore] No doctorId provided in videoData.");
  }

  try {
    const videoDocRef = doc(db, "videos", id);

    const finalData: VideoMeta = {
      ...dataToSave, // contains title, description, doctorId, doctorName, videoUrl, thumbnailUrl, duration, recordingDuration, tags, featured, storagePath, thumbnailStoragePath, videoSize, videoType
      id: id, // ensure id is part of the final object
      createdAt: serverTimestamp() as any, 
      permalink: `/videos/${id}`,
      viewCount: 0, // Initialize
      likeCount: 0, // Initialize
      commentCount: 0, // Initialize
      comments: [], // Initialize
    };

    console.log("[Action:addVideoMetadataToFirestore] Final data object for Firestore:", JSON.stringify(finalData, null, 2));

    await setDoc(videoDocRef, finalData);
    console.log("[Action:addVideoMetadataToFirestore] Successfully set document for id:", id);

    revalidatePath('/dashboard');
    revalidatePath('/admin/dashboard');
    revalidatePath('/videos');
    revalidatePath(`/videos/${id}`);
    revalidatePath('/admin/manage-content');

    return { success: true, id: id };
  } catch (error: any) {
    console.error("[Action:addVideoMetadataToFirestore] CRITICAL ERROR for id:", id, error);
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
    console.error("[Action:addVideoMetadataToFirestore] Parsed error message:", errorMessage);
    return { success: false, error: errorMessage };
  }
}
