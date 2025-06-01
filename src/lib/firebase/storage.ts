import { storage } from "./config";
import { ref, uploadBytesResumable, getDownloadURL, UploadTaskSnapshot } from "firebase/storage";
import { v4 as uuidv4 } from 'uuid';

export const uploadFileToStorage = async (
  path: string, // e.g. "videos/userId" or "thumbnails/userId"
  file: File | Blob,
  fileName?: string, // Optional: if not provided, a UUID will be generated
  onProgress?: (snapshot: UploadTaskSnapshot) => void
): Promise<string> => { // Returns storage path
  try {
    const uniqueFileName = fileName || `${uuidv4()}_${file instanceof File ? file.name : 'blob_file'}`;
    const storagePath = `${path}/${uniqueFileName}`;
    const storageRef = ref(storage, storagePath);
    
    const uploadTask = uploadBytesResumable(storageRef, file);

    if (onProgress) {
      uploadTask.on('state_changed', onProgress);
    }

    await uploadTask;
    return storagePath;
  } catch (error) {
    console.error("Error uploading file: ", error);
    throw error;
  }
};

export const getFirebaseStorageDownloadUrl = async (storagePath: string): Promise<string> => {
  try {
    const fileRef = ref(storage, storagePath);
    const downloadURL = await getDownloadURL(fileRef);
    return downloadURL;
  } catch (error) {
    console.error("Error getting download URL: ", error);
    throw error;
  }
};
