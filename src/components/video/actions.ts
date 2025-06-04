
"use server";

import { db } from "@/lib/firebase/config";
import { doc, setDoc, serverTimestamp, getDoc } from "firebase/firestore";
import type { VideoMeta, DoctorProfile, VideoDataForCreation } from "@/types"; // Ensure VideoDataForCreation is imported
import { revalidatePath } from "next/cache";

export async function addVideoMetadataToFirestore(videoData: VideoDataForCreation): Promise<{ success: boolean; id?: string; error?: string }> {
  // Explicitly use videoData.id as the document ID for the path AND for the 'id' field in the data.
  const documentId = videoData.id;

  console.log("[Action:addVideoMetadataToFirestore] Received videoData from client:", JSON.stringify(videoData, null, 2));
  console.log("[Action:addVideoMetadataToFirestore] Using documentId for path and data.id:", documentId);

  if (!documentId || typeof documentId !== 'string' || documentId.trim() === '') {
    const errorMsg = "Invalid video ID (id field from client is missing or invalid). Cannot save metadata.";
    console.error(`[Action:addVideoMetadataToFirestore] ${errorMsg}`);
    // Return the problematic id if available for debugging, even if it's invalid.
    return { success: false, error: errorMsg, id: typeof documentId === 'string' ? documentId : undefined };
  }

  // Log doctor admin status check (for debugging, rules are the source of truth)
  if (videoData.doctorId) {
    try {
      const doctorDocRef = doc(db, "doctors", videoData.doctorId);
      const doctorDocSnap = await getDoc(doctorDocRef);
      if (doctorDocSnap.exists()) {
        const doctorProfileData = doctorDocSnap.data() as DoctorProfile;
        if (doctorProfileData.isAdmin !== true) {
          console.warn(`[Action:addVideoMetadataToFirestore] RULE CHECK INFO: DOCTOR ${videoData.doctorId} IS NOT ADMIN based on Firestore doc. isAdmin: ${doctorProfileData.isAdmin}.`);
        } else {
          console.log(`[Action:addVideoMetadataToFirestore] RULE CHECK INFO: DOCTOR ${videoData.doctorId} IS ADMIN based on Firestore doc.`);
        }
      } else {
        console.warn(`[Action:addVideoMetadataToFirestore] RULE CHECK INFO: No doctor document found for UID ${videoData.doctorId}. Firestore 'isAdmin' check will fail.`);
      }
    } catch (profileError) {
      console.error(`[Action:addVideoMetadataToFirestore] Error fetching doctor profile for ${videoData.doctorId}:`, profileError);
    }
  } else {
    console.error("[Action:addVideoMetadataToFirestore] RULE CHECK INFO: No doctorId provided in videoData. Rule 'request.resource.data.doctorId == request.auth.uid' will fail.");
  }
  if(videoData.doctorId !== videoData.doctorId) {
    console.error("[Action:addVideoMetadataToFirestore] RULE CHECK INFO: videoData.doctorId from client does not match authenticated user UID (request.auth.uid). This will cause rule 'request.resource.data.doctorId == request.auth.uid' to fail.");
    // Note: This is a placeholder log. The actual check request.auth.uid happens in Firestore rules.
  }


  const videoDocRef = doc(db, "videos", documentId); // Use the extracted ID for the document path

  try {
    // Construct finalData ensuring all VideoMeta fields and rule requirements are met.
    // It's crucial that finalData.id matches documentId for the rule: request.resource.data.id == videoId
    const finalData: VideoMeta = {
      // Explicitly set all fields from videoData.
      // Crucially, set 'id' to be the same as the document path ID.
      id: documentId,
      title: videoData.title, // Rule: string, size > 0
      description: videoData.description || "", // Rule: string
      doctorId: videoData.doctorId, // Rule: doctorId == request.auth.uid
      doctorName: videoData.doctorName, // Rule: string
      videoUrl: videoData.videoUrl, // Rule: string, size > 0
      thumbnailUrl: videoData.thumbnailUrl, // Rule: string, size > 0
      duration: videoData.duration, // Rule: string
      recordingDuration: typeof videoData.recordingDuration === 'number' ? videoData.recordingDuration : undefined, // Optional in VideoMeta, not directly in create rule checks
      tags: Array.isArray(videoData.tags) ? videoData.tags : [], // Rule: list
      featured: typeof videoData.featured === 'boolean' ? videoData.featured : false, // Rule: bool
      storagePath: videoData.storagePath, // Rule: string
      thumbnailStoragePath: videoData.thumbnailStoragePath, // Rule: string
      videoSize: typeof videoData.videoSize === 'number' ? videoData.videoSize : 0, // Rule: number
      videoType: videoData.videoType || 'application/octet-stream', // Rule: string

      // Fields initialized/set by the server action, matching rule expectations
      createdAt: serverTimestamp() as any, // Not in request.resource.data for create rule
      permalink: `/videos/${documentId}`, // Rule: string
      viewCount: 0, // Rule: number
      likeCount: 0, // Rule: number
      commentCount: 0, // Rule: number
      comments: [], // Rule: list
    };
    
    console.log("[Action:addVideoMetadataToFirestore] FINAL data object for Firestore setDoc:", JSON.stringify(finalData, null, 2));
    console.log(`[Action:addVideoMetadataToFirestore] Path 'videoId' for setDoc: '${documentId}'`);
    console.log(`[Action:addVideoMetadataToFirestore] Data 'id' field for setDoc: '${finalData.id}'`);
    console.log(`[Action:addVideoMetadataToFirestore] Rule check: (documentId === finalData.id) is ${documentId === finalData.id}`);


    await setDoc(videoDocRef, finalData);
    console.log("[Action:addVideoMetadataToFirestore] Successfully set document in Firestore for id:", documentId);

    revalidatePath('/dashboard');
    revalidatePath('/admin/dashboard');
    revalidatePath('/videos');
    revalidatePath(`/videos/${documentId}`);
    revalidatePath('/admin/manage-content');

    return { success: true, id: documentId };
  } catch (error: any) {
    console.error("[Action:addVideoMetadataToFirestore] CRITICAL ERROR saving video metadata for id:", documentId, error);
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
    return { success: false, error: errorMessage, id: documentId };
  }
}
