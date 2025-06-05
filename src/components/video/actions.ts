
"use server";

import { db } from "@/lib/firebase/config";
import { doc, setDoc, serverTimestamp, getDoc } from "firebase/firestore";
import type { VideoMeta, DoctorProfile, VideoDataForCreation } from "@/types";
import { revalidatePath } from "next/cache";

// This action is designed to be called from client components, typically after video and thumbnail are uploaded.
// It takes 'VideoDataForCreation' which should align with what the client-side recording/upload components prepare.
export async function addVideoMetadataToFirestore(videoData: VideoDataForCreation): Promise<{ success: boolean; id?: string; error?: string }> {
  const documentId = videoData.id; // This ID should be generated client-side (e.g., uuidv4) and passed in.

  console.log("[Action:addVideoMetadataToFirestore] Received videoData from client:", JSON.stringify(videoData, null, 2));
  console.log("[Action:addVideoMetadataToFirestore] Using documentId for path and data.id:", documentId);

  if (!documentId || typeof documentId !== 'string' || documentId.trim() === '') {
    const errorMsg = "Invalid video ID (id field from client is missing or invalid). Cannot save metadata.";
    console.error(`[Action:addVideoMetadataToFirestore] ${errorMsg}`);
    return { success: false, error: errorMsg, id: typeof documentId === 'string' ? documentId : undefined };
  }

  if (!videoData.doctorId) {
    console.error("[Action:addVideoMetadataToFirestore] Doctor ID is missing in videoData. This is required.");
    return { success: false, error: "Doctor ID is missing.", id: documentId };
  }
  
  // Log doctor admin status check (for debugging, rules are the source of truth)
  // This check here is for logging/info, actual permission enforcement is via Firestore rules.
  try {
    const doctorDocRef = doc(db, "doctors", videoData.doctorId);
    const doctorDocSnap = await getDoc(doctorDocRef);
    if (doctorDocSnap.exists()) {
      const doctorProfileData = doctorDocSnap.data() as DoctorProfile;
      if (doctorProfileData.isAdmin !== true) {
        console.warn(`[Action:addVideoMetadataToFirestore] INFO: User ${videoData.doctorId} submitting video is NOT marked as admin in 'doctors' collection. isAdmin: ${doctorProfileData.isAdmin}.`);
      } else {
        console.log(`[Action:addVideoMetadataToFirestore] INFO: User ${videoData.doctorId} submitting video IS marked as admin.`);
      }
    } else {
      console.warn(`[Action:addVideoMetadataToFirestore] INFO: No 'doctors' document found for UID ${videoData.doctorId}. Firestore 'isAdmin' check will likely fail if rules require it for 'videos' creation.`);
    }
  } catch (profileError) {
    console.error(`[Action:addVideoMetadataToFirestore] Error fetching doctor profile for ${videoData.doctorId}:`, profileError);
  }


  const videoDocRef = doc(db, "videos", documentId);

  try {
    // Construct finalData ensuring all VideoMeta fields are present and conform to rules.
    const finalData: VideoMeta = {
      id: documentId, // Must match the document ID
      title: videoData.title,
      description: videoData.description || "",
      doctorId: videoData.doctorId,
      doctorName: videoData.doctorName,
      videoUrl: videoData.videoUrl,
      thumbnailUrl: videoData.thumbnailUrl,
      duration: videoData.duration, // Expected to be pre-formatted string like "01:23"
      recordingDuration: typeof videoData.recordingDuration === 'number' ? videoData.recordingDuration : undefined,
      tags: Array.isArray(videoData.tags) ? videoData.tags : [],
      featured: typeof videoData.featured === 'boolean' ? videoData.featured : false,
      storagePath: videoData.storagePath,
      thumbnailStoragePath: videoData.thumbnailStoragePath,
      videoSize: typeof videoData.videoSize === 'number' ? videoData.videoSize : 0,
      videoType: videoData.videoType || 'application/octet-stream',

      // Fields initialized/set by the server action
      createdAt: serverTimestamp() as any, // Firestore will convert this to a Timestamp
      permalink: `/videos/${documentId}`,
      viewCount: 0,
      likeCount: 0,
      commentCount: 0,
      comments: [], // Initialize with empty array
    };
    
    console.log("[Action:addVideoMetadataToFirestore] FINAL data object for Firestore setDoc:", JSON.stringify(finalData, null, 2));
    
    await setDoc(videoDocRef, finalData);
    console.log("[Action:addVideoMetadataToFirestore] Successfully set document in Firestore for id:", documentId);

    // Revalidate paths that might display this new video
    revalidatePath('/dashboard');
    revalidatePath('/admin/dashboard'); // If admins have a different dashboard
    revalidatePath('/videos'); // Main videos listing page
    revalidatePath(`/videos/${documentId}`); // The specific video page
    revalidatePath('/admin/manage-content'); // If there's a content management page

    return { success: true, id: documentId };
  } catch (error: any) {
    console.error("[Action:addVideoMetadataToFirestore] CRITICAL ERROR saving video metadata for id:", documentId, error);
    let errorMessage = "Unknown error saving video metadata";
    if (error.code === 'permission-denied' || (error.message && error.message.includes("PERMISSION_DENIED"))) {
      errorMessage = `Firestore save error: PERMISSION_DENIED. Check Firestore rules. (Code: ${error.code || 'permission-denied'})`;
    } else if (error instanceof Error) {
      errorMessage = error.message;
    } else if (typeof error === 'object' && error !== null && 'message' in error) {
      errorMessage = String((error as { message: string }).message);
    } else if (typeof error === 'string') {
      errorMessage = error;
    }
    console.error("[Action:addVideoMetadataToFirestore] Error message being returned to client:", errorMessage);
    return { success: false, error: errorMessage, id: documentId };
  }
}
