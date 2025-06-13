
import { db, storage as clientStorage } from "./firebase/config"; // Use client-side Firebase config
import {
  doc,
  setDoc,
  serverTimestamp, // For server-side timestamping if used here, but client-side usually sends ISO string or Date object
  Timestamp,
} from "firebase/firestore";
import {
  ref as storageRef,
  uploadBytesResumable,
  getDownloadURL,
  UploadTaskSnapshot,
} from "firebase/storage";
import type { VideoMeta } from "@/types"; // Ensure this path is correct

// Type for metadata sent from client
// This can be a subset of VideoMeta if not all fields are provided by client initially
interface ClientVideoMetadata extends Omit<VideoMeta, 'createdAt' | 'comments' | 'viewCount' | 'likeCount' | 'commentCount'> {
  createdAt: string; // Client sends ISO string
  comments?: VideoMeta['comments'];
  viewCount?: number;
  likeCount?: number;
  commentCount?: number;
}


export const uploadFileToStorage = async (
  fullPath: string, // e.g., "videos/userId/filename.webm"
  file: Blob,
  onProgress?: (snapshot: UploadTaskSnapshot) => void
): Promise<string> => { // Returns the full storage path of the uploaded file
  const fileRef = storageRef(clientStorage, fullPath);
  const uploadTask = uploadBytesResumable(fileRef, file);

  return new Promise((resolve, reject) => {
    uploadTask.on(
      "state_changed",
      (snapshot) => {
        if (onProgress) {
          onProgress(snapshot);
        }
      },
      (error) => {
        console.error("Upload failed:", error);
        reject(error);
      },
      async () => {
        console.log("File uploaded successfully to:", fullPath);
        resolve(fullPath); // Resolve with the path
      }
    );
  });
};

export const getFirebaseStorageDownloadUrl = async (
  storagePath: string
): Promise<string> => {
  const fileRef = storageRef(clientStorage, storagePath);
  try {
    const downloadURL = await getDownloadURL(fileRef);
    return downloadURL;
  } catch (error) {
    console.error("Error getting download URL:", error);
    throw error;
  }
};

export const saveVideoMetadataToFirestore = async (
  videoId: string,
  metadata: ClientVideoMetadata 
): Promise<void> => {
  try {
    const videoDocRef = doc(db, "videos", videoId);
    
    // Prepare the data for Firestore, converting client-side ISO string to Firestore Timestamp
    const firestoreData: VideoMeta = {
        ...metadata,
        id: videoId, // Ensure ID is part of the spreadable metadata
        createdAt: Timestamp.fromDate(new Date(metadata.createdAt)), // Convert ISO string to Firestore Timestamp
        // Ensure all non-optional VideoMeta fields have defaults if not in client metadata
        viewCount: metadata.viewCount || 0,
        likeCount: metadata.likeCount || 0,
        commentCount: metadata.commentCount || 0,
        comments: metadata.comments || [],
        tags: metadata.tags || [],
        featured: metadata.featured || false,
        // Ensure other potentially missing fields from a simpler client metadata have defaults
        duration: metadata.duration || "00:00",
        recordingDuration: metadata.recordingDuration || 0,
        videoSize: metadata.videoSize || 0,
        videoType: metadata.videoType || "video/webm",
        permalink: metadata.permalink || `/videos/${videoId}`,
    };

    await setDoc(videoDocRef, firestoreData);
    console.log("Video metadata saved to Firestore for ID:", videoId);
  } catch (error) {
    console.error("Error saving video metadata to Firestore:", error);
    throw error;
  }
};

    