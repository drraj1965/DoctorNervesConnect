
"use server";

import { db } from "@/lib/firebase/config";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import type { VideoMeta } from "@/types";
import { revalidatePath } from "next/cache";

interface VideoDataForFirestore extends Omit<VideoMeta, 'id' | 'createdAt' | 'permalink'> {
  videoId: string; // The UUID generated on client, to be used as doc ID
}

export async function addVideoMetadataToFirestore(videoData: VideoDataForFirestore): Promise<{ success: boolean; videoId?: string; error?: string }> {
  const { videoId, ...dataToSave } = videoData;
  console.log("[Action:addVideoMetadataToFirestore] Received videoId:", videoId);
  console.log("[Action:addVideoMetadataToFirestore] Received dataToSave (first level keys):", Object.keys(dataToSave).join(', '));
  // Avoid logging potentially large data like descriptions or URLs fully unless necessary for deep debug
  console.log("[Action:addVideoMetadataToFirestore] Title:", dataToSave.title);
  console.log("[Action:addVideoMetadataToFirestore] Doctor ID:", dataToSave.doctorId);


  try {
    const videoDocRef = doc(db, "videos", videoId);
    
    const finalData = {
      ...dataToSave,
      id: videoId, // ensure id field matches document id
      createdAt: serverTimestamp(),
      permalink: `/videos/${videoId}`,
    };

    console.log("[Action:addVideoMetadataToFirestore] Attempting to set document in Firestore for videoId:", videoId);
    await setDoc(videoDocRef, finalData);
    console.log("[Action:addVideoMetadataToFirestore] Successfully set document in Firestore for videoId:", videoId);

    // Revalidate paths to reflect new video
    // Moved revalidatePath calls inside the try block to ensure they only run on actual success
    console.log("[Action:addVideoMetadataToFirestore] Revalidating paths...");
    revalidatePath('/dashboard');
    revalidatePath('/admin/dashboard'); 
    revalidatePath('/videos');
    revalidatePath(`/videos/${videoId}`);
    console.log("[Action:addVideoMetadataToFirestore] Paths revalidated.");

    return { success: true, videoId: videoId };
  } catch (error) {
    console.error("[Action:addVideoMetadataToFirestore] CRITICAL ERROR saving video metadata to Firestore for videoId:", videoId, error);
    // Check the structure of the error object from Firestore
    let errorMessage = "Unknown error saving video metadata";
    if (error instanceof Error) {
        errorMessage = error.message;
    } else if (typeof error === 'object' && error !== null && 'message' in error) {
        errorMessage = String((error as {message: string}).message);
    } else if (typeof error === 'string') {
        errorMessage = error;
    }
    console.error("[Action:addVideoMetadataToFirestore] Parsed error message:", errorMessage);
    return { success: false, error: errorMessage };
  }
}

