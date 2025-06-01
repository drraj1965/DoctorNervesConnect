
"use server";

import { db, storage } from "@/lib/firebase/config";
import { doc, deleteDoc, getDoc, updateDoc, arrayUnion,FieldValue } from "firebase/firestore";
import { ref, deleteObject } from "firebase/storage";
import { revalidatePath } from "next/cache";
import type { VideoMeta, VideoComment } from "@/types";
import { v4 as uuidv4 } from 'uuid';

export async function deleteVideoAction(
  videoId: string,
  videoStoragePath: string,
  thumbnailStoragePath: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const videoDocRef = doc(db, "videos", videoId);
    const videoDocSnap = await getDoc(videoDocRef);

    if (!videoDocSnap.exists()) {
      return { success: false, error: "Video document not found." };
    }
    
    await deleteDoc(videoDocRef);

    if (videoStoragePath) {
      const videoFileRef = ref(storage, videoStoragePath);
      try {
        await deleteObject(videoFileRef);
      } catch (storageError: any) {
        console.warn(`Failed to delete video file (${videoStoragePath}): ${storageError.message}. Continuing deletion.`);
        if (storageError.code !== 'storage/object-not-found') {
           // Potentially log or handle more critically if not 'object-not-found'
        }
      }
    }

    if (thumbnailStoragePath) {
      const thumbnailFileRef = ref(storage, thumbnailStoragePath);
       try {
        await deleteObject(thumbnailFileRef);
      } catch (storageError: any) {
        console.warn(`Failed to delete thumbnail file (${thumbnailStoragePath}): ${storageError.message}.`);
         if (storageError.code !== 'storage/object-not-found') {
            // Potentially log or handle
        }
      }
    }

    revalidatePath("/videos");
    revalidatePath(`/videos/${videoId}`);
    revalidatePath("/dashboard");
    revalidatePath("/admin/manage-content");

    return { success: true };
  } catch (error) {
    console.error("Error deleting video:", error);
    return { success: false, error: error instanceof Error ? error.message : "An unknown error occurred during deletion." };
  }
}


export async function addCommentAction(
  videoId: string,
  commentData: {
    userId: string;
    userName: string;
    userPhotoUrl?: string;
    text: string;
  }
): Promise<{ success: boolean; error?: string; commentId?: string }> {
  if (!commentData.text.trim()) {
    return { success: false, error: "Comment text cannot be empty." };
  }

  try {
    const videoDocRef = doc(db, "videos", videoId);
    const newComment: VideoComment = {
      id: uuidv4(), // Generate a unique ID for the comment
      ...commentData,
      createdAt: new Date().toISOString(),
      parentId: null, // Top-level comment
    };

    // Atomically add a new comment to the "comments" array field.
    // Firestore's arrayUnion is good for this.
    await updateDoc(videoDocRef, {
      comments: arrayUnion(newComment) // arrayUnion might not be FieldValue type, directly pass object
    });

    revalidatePath(`/videos/${videoId}`);

    return { success: true, commentId: newComment.id };
  } catch (error) {
    console.error("Error adding comment:", error);
    return { success: false, error: error instanceof Error ? error.message : "Failed to post comment." };
  }
}
