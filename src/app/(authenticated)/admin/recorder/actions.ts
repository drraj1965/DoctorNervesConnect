
"use server";

// This file previously contained direct Firestore writes.
// Now, it will call the backend API route.
// Note: The name saveVideoMetadataAction matches the function in the prompt.
// The VideoMeta type should be imported if not already.
import type { VideoMeta } from "@/types";
import { revalidatePath } from "next/cache";

// This action is specifically for videos recorded via the web interface
// It now calls the backend API.
export async function saveVideoMetadataAction(metadata: VideoMeta): Promise<{ success: boolean; videoId?: string; error?: string }> {
  console.log("[WebRecordAction:saveVideoMetadata API Call] Attempting to save metadata for ID:", metadata.id);
  try {
    // The API route expects the client to generate the videoId (UUID)
    // and include it in the metadata payload.
    if (!metadata.id) {
      console.error("[WebRecordAction:saveVideoMetadata API Call] Error: Video ID is missing in metadata payload.");
      return { success: false, error: "Video ID is missing." };
    }
    
    // Ensure permalink is set if not already (API might also do this, but good practice)
    if (!metadata.permalink) {
      metadata.permalink = `/videos/${metadata.id}`;
    }
    
    // The API route will handle setting its own server-side `createdAt` timestamp.
    // We can remove it from the client-sent payload or the API will overwrite it.
    // For simplicity, let's assume the API overwrites `createdAt`.

    console.log("[WebRecordAction:saveVideoMetadata API Call] Sending metadata to API:", JSON.stringify(metadata, null, 2));

    const response = await fetch("/api/save-video-metadata", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(metadata), // Send the full VideoMeta object
    });

    const responseData = await response.json();

    if (!response.ok) {
      console.error("[WebRecordAction:saveVideoMetadata API Call] API Error Response:", responseData);
      throw new Error(responseData.error || `API request failed with status ${response.status}`);
    }
    
    console.log("[WebRecordAction:saveVideoMetadata API Call] Successfully saved via API for videoId:", responseData.id);

    revalidatePath('/dashboard');
    revalidatePath('/admin/dashboard');
    revalidatePath('/videos');
    revalidatePath(`/videos/${metadata.id}`); // Use ID from original metadata for revalidation path
    revalidatePath('/admin/manage-content');
    revalidatePath('/admin/recorder');


    return { success: true, videoId: responseData.id };
  } catch (error: any) {
    console.error("[WebRecordAction:saveVideoMetadata API Call] Client Error saving metadata:", error);
    return { success: false, error: error.message || "Unknown error saving video metadata via API." };
  }
}
