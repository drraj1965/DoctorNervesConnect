
"use server";

import { db } from "@/lib/firebase/config";
import { doc, setDoc, serverTimestamp, getDoc } from "firebase/firestore";
import type { VideoMeta, DoctorProfile } from "@/types";
import { revalidatePath } from "next/cache";

// This action is specifically for videos recorded via the web interface
export async function saveVideoMetadataAction(videoData: VideoMeta): Promise<{ success: boolean; videoId?: string; error?: string }> {
  const { id: videoId, ...dataToSave } = videoData;

  console.log("[WebRecordAction:saveVideoMetadata] Received videoId:", videoId);
  console.log("[WebRecordAction:saveVideoMetadata] Raw dataToSave from client:", JSON.stringify(dataToSave, null, 2));


  if (!videoId || typeof videoId !== 'string' || videoId.trim() === '') {
    const errorMsg = "Invalid videoId received. Cannot save metadata.";
    console.error(`[WebRecordAction:saveVideoMetadata] ${errorMsg}`);
    return { success: false, error: errorMsg };
  }
  if (!dataToSave.doctorId) {
    console.error("[WebRecordAction:saveVideoMetadata] No doctorId provided in videoData.");
    return { success: false, error: "Doctor ID is missing. Cannot save metadata." };
  }
  
  try {
    const doctorDocRef = doc(db, "doctors", dataToSave.doctorId);
    const doctorDocSnap = await getDoc(doctorDocRef);
    if (doctorDocSnap.exists()) {
      const doctorProfile = doctorDocSnap.data() as DoctorProfile;
      if (!doctorProfile.isAdmin) {
         console.warn(`[WebRecordAction:saveVideoMetadata] Doctor ${dataToSave.doctorId} is NOT an admin based on Firestore doc. isAdmin: ${doctorProfile.isAdmin}`);
      } else {
        console.log(`[WebRecordAction:saveVideoMetadata] Doctor ${dataToSave.doctorId} is an admin based on Firestore doc.`);
      }
    } else {
        console.warn(`[WebRecordAction:saveVideoMetadata] Doctor profile for ${dataToSave.doctorId} not found in 'doctors' collection.`);
    }
  } catch (profileError) {
    console.error(`[WebRecordAction:saveVideoMetadata] Error fetching doctor profile:`, profileError);
  }


  try {
    const videoDocRef = doc(db, "videos", videoId);

    // Ensure all fields required by Firestore rules (isValidVideo) are present and correctly typed.
    const finalData: VideoMeta = {
      id: videoId,
      title: typeof dataToSave.title === 'string' ? dataToSave.title : "Untitled Video",
      description: typeof dataToSave.description === 'string' ? dataToSave.description : "",
      doctorId: dataToSave.doctorId, // This MUST match request.auth.uid for the rule
      doctorName: typeof dataToSave.doctorName === 'string' ? dataToSave.doctorName : "Unknown Doctor",
      videoUrl: typeof dataToSave.videoUrl === 'string' ? dataToSave.videoUrl : "",
      thumbnailUrl: typeof dataToSave.thumbnailUrl === 'string' ? dataToSave.thumbnailUrl : "",
      duration: typeof dataToSave.duration === 'string' ? dataToSave.duration : "00:00",
      tags: Array.isArray(dataToSave.tags) ? dataToSave.tags : [],
      createdAt: serverTimestamp() as any, // Firestore will convert this
      viewCount: typeof dataToSave.viewCount === 'number' ? dataToSave.viewCount : 0,
      likeCount: typeof dataToSave.likeCount === 'number' ? dataToSave.likeCount : 0,
      commentCount: typeof dataToSave.commentCount === 'number' ? dataToSave.commentCount : 0,
      featured: typeof dataToSave.featured === 'boolean' ? dataToSave.featured : false,
      permalink: `/videos/${videoId}`, // Server-generated based on videoId
      storagePath: typeof dataToSave.storagePath === 'string' ? dataToSave.storagePath : "",
      thumbnailStoragePath: typeof dataToSave.thumbnailStoragePath === 'string' ? dataToSave.thumbnailStoragePath : "",
      videoSize: typeof dataToSave.videoSize === 'number' ? dataToSave.videoSize : 0,
      videoType: typeof dataToSave.videoType === 'string' && dataToSave.videoType.trim() !== '' ? dataToSave.videoType : "video/unknown",
      comments: Array.isArray(dataToSave.comments) ? dataToSave.comments : [],
      // recordingDuration is optional in VideoMeta type and not checked by isValidVideo,
      // but include it if provided and valid.
      ...(typeof dataToSave.recordingDuration === 'number' && { recordingDuration: dataToSave.recordingDuration }),
    };

    console.log("[WebRecordAction:saveVideoMetadata] FINAL data object for Firestore setDoc:", JSON.stringify(finalData, null, 2));

    await setDoc(videoDocRef, finalData);
    console.log("[WebRecordAction:saveVideoMetadata] Successfully set document in Firestore for videoId:", videoId);

    revalidatePath('/dashboard');
    revalidatePath('/admin/dashboard');
    revalidatePath('/videos');
    revalidatePath(`/videos/${videoId}`);
    revalidatePath('/admin/manage-content');
    revalidatePath('/admin/recorder');

    return { success: true, videoId: videoId };
  } catch (error: any) {
    console.error("[WebRecordAction:saveVideoMetadata] CRITICAL ERROR saving video metadata for videoId:", videoId, error);
    let errorMessage = "Unknown error saving video metadata";
     if (error.code === 'permission-denied' || (error.message && error.message.includes("PERMISSION_DENIED"))) {
      errorMessage = `Firestore save error: PERMISSION_DENIED. Check Firestore rules. (Code: ${error.code || 'permission-denied'})`;
    } else if (error instanceof Error) {
      errorMessage = error.message;
    }
    return { success: false, error: errorMessage };
  }
}
