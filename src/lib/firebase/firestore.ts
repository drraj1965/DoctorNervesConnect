
import { db } from "./config";
import {
  collection,
  addDoc,
  getDocs,
  doc,
  getDoc,
  query,
  orderBy,
  limit,
  Timestamp, 
  where,
  getCountFromServer,
  serverTimestamp,
  setDoc,
  deleteDoc,
  updateDoc, // Added updateDoc
} from "firebase/firestore";
import type { VideoMeta, DoctorProfile } from "@/types";

const getSafeCreatedAtISO = (createdAtValue: any): string => {
  if (!createdAtValue) {
    return new Date().toISOString(); // Fallback if createdAt is null/undefined
  }
  if (createdAtValue instanceof Timestamp) {
    return createdAtValue.toDate().toISOString();
  }
  if (typeof createdAtValue === 'string') {
    // Attempt to parse and re-format to ensure it's a valid ISO string
    try {
      return new Date(createdAtValue).toISOString();
    } catch (e) {
      // If parsing fails, return current date as fallback
      return new Date().toISOString();
    }
  }
  if (createdAtValue && typeof createdAtValue === 'object' && 'seconds' in createdAtValue && 'nanoseconds' in createdAtValue) {
    return new Timestamp(createdAtValue.seconds, createdAtValue.nanoseconds).toDate().toISOString();
  }
  if (createdAtValue instanceof Date) {
    return createdAtValue.toISOString();
  }
  return new Date().toISOString(); 
};


export const addVideoMetadata = async (videoData: Omit<VideoMeta, 'id' | 'createdAt' | 'permalink'>): Promise<string> => {
  try {
    const docRef = await addDoc(collection(db, "videos"), {
      ...videoData,
      createdAt: serverTimestamp(),
      comments: videoData.comments || [], // Ensure comments is an array
    });
    const permalink = `/videos/${docRef.id}`;
    await setDoc(doc(db, "videos", docRef.id), { permalink, id: docRef.id }, { merge: true });
    return docRef.id;
  } catch (error) {
    console.error("Error adding video metadata: ", error);
    throw error;
  }
};

export const updateVideoMetadata = async (videoId: string, dataToUpdate: Partial<VideoMeta>): Promise<void> => {
  try {
    const videoDocRef = doc(db, "videos", videoId);
    // Ensure createdAt is not overwritten if not explicitly provided or is a serverTimestamp
    const { createdAt, ...restOfData } = dataToUpdate;
    let updatePayload: any = restOfData;
    if (createdAt && typeof createdAt === 'object' && 'toDate' in createdAt) { // Check if it's a Timestamp-like object
        // If we want to allow updating createdAt (usually not recommended unless specific reason)
        // updatePayload.createdAt = createdAt; 
    } else if (typeof createdAt === 'string') {
        // updatePayload.createdAt = Timestamp.fromDate(new Date(createdAt));
    }
    // Generally, avoid updating createdAt directly after creation unless for specific migration tasks.
    // For most updates, createdAt should remain as is.

    await updateDoc(videoDocRef, updatePayload);
  } catch (error) {
    console.error("Error updating video metadata: ", error);
    throw error;
  }
};


export const getVideosCount = async (): Promise<number> => {
  try {
    const videosCollection = collection(db, "videos");
    const snapshot = await getCountFromServer(videosCollection);
    return snapshot.data().count;
  } catch (error) {
    console.error("Error getting videos count: ", error);
    return 0;
  }
};

export const getRecentVideos = async (days: number, countLimit: number = 5): Promise<VideoMeta[]> => {
  try {
    const videosCollection = collection(db, "videos");
    const referenceDate = new Date();
    referenceDate.setDate(referenceDate.getDate() - days);
    const referenceTimestamp = Timestamp.fromDate(referenceDate);

    const q = query(
      videosCollection,
      where("createdAt", ">=", referenceTimestamp),
      orderBy("createdAt", "desc"),
      limit(countLimit)
    );
    const querySnapshot = await getDocs(q);
    const videos: VideoMeta[] = [];
    querySnapshot.forEach((docSnap) => {
      const data = docSnap.data();
      videos.push({ 
        id: docSnap.id,
        ...data,
        createdAt: getSafeCreatedAtISO(data.createdAt),
        comments: data.comments || [],
       } as VideoMeta);
    });
    return videos;
  } catch (error) {
    console.error("Error getting recent videos: ", error);
    return [];
  }
};

export const getAllVideos = async (): Promise<VideoMeta[]> => {
  try {
    const videosCollection = collection(db, "videos");
    const q = query(videosCollection, orderBy("createdAt", "desc"));
    const querySnapshot = await getDocs(q);
    const videos: VideoMeta[] = [];
    querySnapshot.forEach((docSnap) => {
      const data = docSnap.data();
      videos.push({ 
        id: docSnap.id,
        ...data,
        createdAt: getSafeCreatedAtISO(data.createdAt),
        comments: data.comments || [],
       } as VideoMeta);
    });
    return videos;
  } catch (error) {
    console.error("Error getting all videos: ", error);
    return [];
  }
}

export const getVideoById = async (id: string): Promise<VideoMeta | null> => {
  try {
    const videoDocRef = doc(db, "videos", id);
    const docSnap = await getDoc(videoDocRef);
    if (docSnap.exists()) {
      const data = docSnap.data();
      return { 
        id: docSnap.id, 
        ...data,
        createdAt: getSafeCreatedAtISO(data.createdAt),
        comments: data.comments || [],
      } as VideoMeta;
    }
    return null;
  } catch (error) {
    console.error("Error getting video by ID: ", error);
    return null;
  }
}


export const getDoctorProfileByUid = async (uid: string): Promise<DoctorProfile | null> => {
  try {
    const doctorDocRef = doc(db, "doctors", uid);
    const docSnap = await getDoc(doctorDocRef);
    if (docSnap.exists()) {
      return { uid, ...(docSnap.data() as Omit<DoctorProfile, 'uid'>) };
    }
    return null;
  } catch (error) {
    console.error("Error getting doctor profile: ", error);
    return null;
  }
};

export const deleteVideoDocument = async (videoId: string): Promise<void> => {
  const videoDocRef = doc(db, "videos", videoId);
  await deleteDoc(videoDocRef);
};
