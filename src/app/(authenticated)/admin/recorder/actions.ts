
"use server";

import { db } from "@/lib/firebase/config";
import { doc, setDoc, serverTimestamp, getDoc } from "firebase/firestore";
import type { VideoMeta, DoctorProfile } from "@/types";
import { revalidatePath } from "next/cache";

// This action is specifically for videos recorded via the web interface
export async function saveVideoMetadataAction(videoData: VideoMeta): Promise<{ success: boolean; videoId?: string; error?: string }> {
  const { id: videoId, ...dataToSave } = videoData;

  console.log("[WebRecordAction:saveVideoMetadata] Received videoId:", videoId);
  console.log("[WebRecordAction:saveVideoMetadata] Full data received by action:", JSON.stringify(dataToSave, null, 2));

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
         console.warn(`[WebRecordAction:saveVideoMetadata] Doctor ${dataToSave.doctorId} is NOT an admin. isAdmin: ${doctorProfile.isAdmin}`);
      } else {
        console.log(`[WebRecordAction:saveVideoMetadata] Doctor ${dataToSave.doctorId} is an admin.`);
      }
    } else {
        console.warn(`[WebRecordAction:saveVideoMetadata] Doctor profile for ${dataToSave.doctorId} not found.`);
    }
  } catch (profileError) {
    console.error(`[WebRecordAction:saveVideoMetadata] Error fetching doctor profile:`, profileError);
  }


  try {
    const videoDocRef = doc(db, "videos", videoId);

    // Ensure serverTimestamp is used for createdAt
    const finalData: VideoMeta = {
      ...dataToSave,
      id: videoId, 
      createdAt: serverTimestamp() as any, // Firestore will convert this
      permalink: `/videos/${videoId}`, // Ensure permalink is consistent
      viewCount: dataToSave.viewCount || 0,
      likeCount: dataToSave.likeCount || 0,
      commentCount: dataToSave.commentCount || 0,
      comments: dataToSave.comments || [],
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

