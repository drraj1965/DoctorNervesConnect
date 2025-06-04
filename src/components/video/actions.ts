
"use server";

import { db } from "@/lib/firebase/config";
import { doc, setDoc, serverTimestamp, getDoc } from "firebase/firestore";
import type { VideoMeta, DoctorProfile } from "@/types";
import { revalidatePath } from "next/cache";

// The data coming from VideoRecorder.tsx's handleUpload
// This type should match what the client is sending, ensuring all necessary fields are present
// and correctly typed before they even reach this action.
interface VideoDataForCreation extends Omit<VideoMeta, 'createdAt' | 'permalink' | 'viewCount' | 'likeCount' | 'commentCount' | 'comments'> {
  // 'id' is already part of VideoMeta and will be provided by the client.
}

export async function addVideoMetadataToFirestore(videoData: VideoDataForCreation): Promise<{ success: boolean; id?: string; error?: string }> {
  const videoId = videoData.id; // Use videoData.id directly as the document ID

  console.log("[Action:addVideoMetadataToFirestore] Received videoId from videoData.id:", videoId);
  console.log("[Action:addVideoMetadataToFirestore] Full videoData from client:", JSON.stringify(videoData, null, 2));

  if (!videoId || typeof videoId !== 'string' || videoId.trim() === '') {
    const errorMsg = "Invalid videoId (from videoData.id) received. Cannot save metadata.";
    console.error(`[Action:addVideoMetadataToFirestore] ${errorMsg}`);
    return { success: false, error: errorMsg };
  }

  // Doctor admin check logging (already present, seems okay)
  if (videoData.doctorId) {
    try {
      const doctorDocRef = doc(db, "doctors", videoData.doctorId);
      const doctorDocSnap = await getDoc(doctorDocRef);
      if (doctorDocSnap.exists()) {
        const doctorProfileData = doctorDocSnap.data() as DoctorProfile;
        console.log(`[Action:addVideoMetadataToFirestore] Doctor profile for ${videoData.doctorId} (used for isAdmin check):`, JSON.stringify(doctorProfileData));
        if (doctorProfileData.isAdmin !== true) {
          console.warn(`[Action:addVideoMetadataToFirestore] DOCTOR ${videoData.doctorId} IS NOT ADMIN. isAdmin: ${doctorProfileData.isAdmin}`);
        } else {
          console.log(`[Action:addVideoMetadataToFirestore] DOCTOR ${videoData.doctorId} IS ADMIN.`);
        }
      } else {
        console.warn(`[Action:addVideoMetadataToFirestore] No doctor document found for UID ${videoData.doctorId}. Firestore rules will deny if they depend on this specific doctorId being an admin.`);
      }
    } catch (profileError) {
      console.error(`[Action:addVideoMetadataToFirestore] Error fetching doctor profile for ${videoData.doctorId}:`, profileError);
    }
  } else {
    console.error("[Action:addVideoMetadataToFirestore] No doctorId provided in videoData. Firestore rules might deny if dependent on this.");
  }

  try {
    const videoDocRef = doc(db, "videos", videoId);

    // Construct finalData explicitly, ensuring all VideoMeta fields are covered
    const finalData: VideoMeta = {
      id: videoId,
      title: videoData.title,
      description: videoData.description,
      doctorId: videoData.doctorId,
      doctorName: videoData.doctorName,
      videoUrl: videoData.videoUrl,
      thumbnailUrl: videoData.thumbnailUrl,
      duration: videoData.duration, // String like "01:23"
      tags: videoData.tags || [],
      featured: videoData.featured || false,
      storagePath: videoData.storagePath,
      thumbnailStoragePath: videoData.thumbnailStoragePath,
      
      // Fields that might be optional on input but required on VideoMeta
      recordingDuration: typeof videoData.recordingDuration === 'number' ? videoData.recordingDuration : undefined,
      videoSize: typeof videoData.videoSize === 'number' ? videoData.videoSize : undefined,
      videoType: videoData.videoType || 'video/webm', // Default if not provided

      // Fields initialized/set by the server action
      createdAt: serverTimestamp() as any, // Firestore will convert this
      permalink: `/videos/${videoId}`,
      viewCount: 0,
      likeCount: 0,
      commentCount: 0,
      comments: [], // Initialize as empty array
    };
    
    console.log("[Action:addVideoMetadataToFirestore] FINAL data object for Firestore setDoc:", JSON.stringify(finalData, null, 2));

    await setDoc(videoDocRef, finalData);
    console.log("[Action:addVideoMetadataToFirestore] Successfully set document in Firestore for videoId:", videoId);

    revalidatePath('/dashboard');
    revalidatePath('/admin/dashboard');
    revalidatePath('/videos');
    revalidatePath(`/videos/${videoId}`);
    revalidatePath('/admin/manage-content');

    return { success: true, id: videoId };
  } catch (error: any) {
    console.error("[Action:addVideoMetadataToFirestore] CRITICAL ERROR saving video metadata for videoId:", videoId, error);
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
    console.error("[Action:addVideoMetadataToFirestore] Error message being returned to client:", errorMessage);
    return { success: false, error: errorMessage, id: videoId }; // Return id even on failure for debugging
  }
}

    