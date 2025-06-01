
"use server";

import { db } from "@/lib/firebase/config";
import { collection, addDoc, serverTimestamp, doc, setDoc } from "firebase/firestore";
import type { VideoMeta } from "@/types";
import { revalidatePath } from "next/cache";

interface VideoDataForFirestore extends Omit<VideoMeta, 'id' | 'createdAt' | 'permalink'> {
  videoId: string; // The UUID generated on client, to be used as doc ID
}

export async function addVideoMetadataToFirestore(videoData: VideoDataForFirestore): Promise<{ success: boolean; videoId?: string; error?: string }> {
  const { videoId, ...dataToSave } = videoData;
  try {
    const videoDocRef = doc(db, "videos", videoId);
    
    const finalData = {
      ...dataToSave,
      id: videoId, // ensure id field matches document id
      createdAt: serverTimestamp(),
      permalink: `/videos/${videoId}`,
    };

    await setDoc(videoDocRef, finalData);

    // Revalidate paths to reflect new video
    revalidatePath('/dashboard');
    revalidatePath('/admin/dashboard'); // If exists separately
    revalidatePath('/videos');
    revalidatePath(`/videos/${videoId}`);

    return { success: true, videoId: videoId };
  } catch (error) {
    console.error("Error adding video metadata to Firestore: ", error);
    return { success: false, error: error instanceof Error ? error.message : "Unknown error saving video metadata" };
  }
}
