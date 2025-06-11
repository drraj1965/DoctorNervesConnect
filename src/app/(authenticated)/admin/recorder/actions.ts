
"use server";

import { db } from "@/lib/firebase/config"; // Assuming client-side config for db if actions run there, or use admin SDK if fully server
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import type { VideoMeta } from "@/types";
import { revalidatePath } from "next/cache";

// This action is specifically for videos recorded via the web interface
// It now calls the backend API.
export async function saveVideoMetadataAction(metadata: Omit<VideoMeta, 'createdAt'>): Promise<{ success: boolean; videoId?: string; error?: string }> {
  console.log("[WebRecordAction:saveVideoMetadataAction] Received metadata for ID:", metadata.id);
  console.log("[WebRecordAction:saveVideoMetadataAction] Full metadata:", JSON.stringify(metadata, null, 2));

  try {
    if (!metadata.id) {
      console.error("[WebRecordAction:saveVideoMetadataAction] Error: Video ID is missing in metadata payload.");
      return { success: false, error: "Video ID is missing." };
    }
    if (!metadata.doctorId) {
        console.error("[WebRecordAction:saveVideoMetadataAction] Error: Doctor ID is missing in metadata payload.");
        return { success: false, error: "Doctor ID is missing." };
    }

    const videoDocRef = doc(db, "videos", metadata.id);
    
    const finalData: VideoMeta = {
        ...metadata,
        createdAt: serverTimestamp() as any, // Firestore will convert this to a server timestamp
        // Ensure all VideoMeta fields are present, providing defaults if necessary
        viewCount: metadata.viewCount || 0,
        likeCount: metadata.likeCount || 0,
        commentCount: metadata.commentCount || 0,
        comments: metadata.comments || [],
        featured: typeof metadata.featured === 'boolean' ? metadata.featured : false,
    };
    
    console.log("[WebRecordAction:saveVideoMetadataAction] Attempting to set document in Firestore with data:", JSON.stringify(finalData, null, 2));
    await setDoc(videoDocRef, finalData);
    console.log("[WebRecordAction:saveVideoMetadataAction] Successfully saved metadata to Firestore for videoId:", metadata.id);

    revalidatePath('/dashboard');
    revalidatePath('/admin/dashboard');
    revalidatePath('/videos');
    revalidatePath(`/videos/${metadata.id}`);
    revalidatePath('/admin/manage-content');
    revalidatePath('/admin/recorder');

    return { success: true, videoId: metadata.id }; // Return videoId on success
  } catch (error: any) {
    console.error("[WebRecordAction:saveVideoMetadataAction] Firestore Error saving metadata for videoId:", metadata.id, error);
    return { success: false, error: error.message || "Unknown error saving video metadata to Firestore." };
  }
}
