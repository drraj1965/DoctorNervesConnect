
import { storage } from "./config";
import { ref, uploadBytesResumable, getDownloadURL, UploadTaskSnapshot } from "firebase/storage";
import { v4 as uuidv4 } from 'uuid';

export const uploadFileToStorage = async (
  directoryPath: string, // e.g. "videos/userId" or "thumbnails/userId"
  file: File | Blob,
  fileName: string, // Now required: specific filename, e.g., "my_video.webm"
  onProgress?: (snapshot: UploadTaskSnapshot) => void
): Promise<string> => { // Returns storage path
  try {
    // Construct the full storage path using the directory and the provided filename
    const fullStoragePath = `${directoryPath}/${fileName}`;
    console.log(`[uploadFileToStorage] Attempting to upload to: ${fullStoragePath}`);
    
    const storageRefInstance = ref(storage, fullStoragePath);
    
    const uploadTask = uploadBytesResumable(storageRefInstance, file);

    if (onProgress) {
      uploadTask.on('state_changed', 
        onProgress,
        (error) => {
          // A full list of error codes is available at
          // https://firebase.google.com/docs/storage/web/handle-errors
          console.error(`[uploadFileToStorage] Upload failed for ${fullStoragePath}:`, error);
        }
      );
    }

    await uploadTask;
    console.log(`[uploadFileToStorage] Successfully uploaded to: ${fullStoragePath}`);
    return fullStoragePath; // Return the exact path used for uploading
  } catch (error) {
    console.error(`[uploadFileToStorage] Error uploading file to ${directoryPath}/${fileName}:`, error);
    throw error;
  }
};

export const getFirebaseStorageDownloadUrl = async (storagePath: string): Promise<string> => {
  try {
    const fileRef = ref(storage, storagePath);
    const downloadURL = await getDownloadURL(fileRef);
    return downloadURL;
  } catch (error) {
    console.error(`[getFirebaseStorageDownloadUrl] Error getting download URL for ${storagePath}:`, error);
    throw error;
  }
};

