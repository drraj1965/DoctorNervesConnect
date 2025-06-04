
"use server";

import { db } from "@/lib/firebase/config";
import { doc, setDoc, serverTimestamp, getDoc } from "firebase/firestore";
import type { VideoMeta, DoctorProfile, VideoDataForCreation } from "@/types"; // Import VideoDataForCreation
import { revalidatePath } from "next/cache";

export async function addVideoMetadataToFirestore(videoData: VideoDataForCreation): Promise<{ success: boolean; id?: string; error?: string }> {
  const id = videoData.id; // Use videoData.id as the document ID

  console.log("[Action:addVideoMetadataToFirestore] Received id:", id);
  console.log("[Action:addVideoMetadataToFirestore] Full videoData from client:", JSON.stringify(videoData, null, 2));

  if (!id || typeof id !== 'string' || id.trim() === '') {
    const errorMsg = "Invalid video ID (id field) received. Cannot save metadata.";
    console.error(`[Action:addVideoMetadataToFirestore] ${errorMsg}`);
    return { success: false, error: errorMsg };
  }

  // Log doctor admin status check (for debugging, rules are the source of truth)
  if (videoData.doctorId) {
    try {
      const doctorDocRef = doc(db, "doctors", videoData.doctorId);
      const doctorDocSnap = await getDoc(doctorDocRef);
      if (doctorDocSnap.exists()) {
        const doctorProfileData = doctorDocSnap.data() as DoctorProfile;
        console.log(`[Action:addVideoMetadataToFirestore] Doctor profile for ${videoData.doctorId} (used for isAdmin check):`, JSON.stringify(doctorProfileData));
        if (doctorProfileData.isAdmin !== true) {
          console.warn(`[Action:addVideoMetadataToFirestore] DOCTOR ${videoData.doctorId} IS NOT ADMIN based on Firestore doc. isAdmin: ${doctorProfileData.isAdmin}. Auth UID for rule check is request.auth.uid.`);
        } else {
          console.log(`[Action:addVideoMetadataToFirestore] DOCTOR ${videoData.doctorId} IS ADMIN based on Firestore doc.`);
        }
      } else {
        console.warn(`[Action:addVideoMetadataToFirestore] No doctor document found for UID ${videoData.doctorId}. Firestore rules (isAdmin check) will likely deny.`);
      }
    } catch (profileError) {
      console.error(`[Action:addVideoMetadataToFirestore] Error fetching doctor profile for ${videoData.doctorId}:`, profileError);
    }
  } else {
    console.error("[Action:addVideoMetadataToFirestore] No doctorId provided in videoData. Firestore rules might deny if dependent on this for doctorId == request.auth.uid or isAdmin check.");
  }

  try {
    const videoDocRef = doc(db, "videos", id);

    // Construct finalData ensuring all VideoMeta fields and rule requirements are met.
    // VideoDataForCreation type ensures client sends most required fields.
    // Provide defaults for fields optional in VideoMeta but whose types are checked by rules.
    const finalData: VideoMeta = {
      // Fields from videoData (client)
      id: id, // Rule: request.resource.data.id == videoId
      title: videoData.title, // Rule: is string, size > 0
      description: videoData.description || "", // Rule: is string. Default to "" if client sends null/undefined.
      doctorId: videoData.doctorId, // Rule: doctorId == request.auth.uid
      doctorName: videoData.doctorName, // Rule: is string
      videoUrl: videoData.videoUrl, // Rule: is string, size > 0
      thumbnailUrl: videoData.thumbnailUrl, // Rule: is string, size > 0
      duration: videoData.duration, // Rule: is string
      tags: Array.isArray(videoData.tags) ? videoData.tags : [], // Rule: is list. Default to [].
      featured: typeof videoData.featured === 'boolean' ? videoData.featured : false, // Rule: is bool. Default to false.
      storagePath: videoData.storagePath, // Rule: is string
      thumbnailStoragePath: videoData.thumbnailStoragePath, // Rule: is string

      // Optional fields in VideoMeta that are checked by rules. Ensure they have valid types.
      videoSize: typeof videoData.videoSize === 'number' ? videoData.videoSize : 0, // Rule: is number. Default to 0.
      videoType: videoData.videoType || 'application/octet-stream', // Rule: is string. Default.
      
      // Optional field in VideoMeta, not directly checked by rules' type constraints.
      recordingDuration: typeof videoData.recordingDuration === 'number' ? videoData.recordingDuration : undefined,

      // Fields initialized/set by the server action
      createdAt: serverTimestamp() as any, // Not in request.resource.data for create rule check
      permalink: `/videos/${id}`, // Rule: is string
      viewCount: 0, // Rule: is number
      likeCount: 0, // Rule: is number
      commentCount: 0, // Rule: is number
      comments: [], // Rule: is list
    };
    
    console.log("[Action:addVideoMetadataToFirestore] FINAL data object for Firestore setDoc:", JSON.stringify(finalData, null, 2));

    await setDoc(videoDocRef, finalData);
    console.log("[Action:addVideoMetadataToFirestore] Successfully set document in Firestore for id:", id);

    revalidatePath('/dashboard');
    revalidatePath('/admin/dashboard');
    revalidatePath('/videos');
    revalidatePath(`/videos/${id}`);
    revalidatePath('/admin/manage-content');

    return { success: true, id: id };
  } catch (error: any) {
    console.error("[Action:addVideoMetadataToFirestore] CRITICAL ERROR saving video metadata for id:", id, error);
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
    return { success: false, error: errorMessage, id: id };
  }
}
