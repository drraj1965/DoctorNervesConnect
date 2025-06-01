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
  Timestamp, // Import Timestamp
  where,
  getCountFromServer,
  serverTimestamp,
  setDoc,
  deleteDoc,
} from "firebase/firestore";
import type { VideoMeta, DoctorProfile } from "@/types";

// Helper function to safely convert createdAt to ISO string
const getSafeCreatedAtISO = (createdAtValue: any): string => {
  if (createdAtValue instanceof Timestamp) {
    return createdAtValue.toDate().toISOString();
  }
  if (typeof createdAtValue === 'string') {
    // Potentially validate if it's a valid ISO string, but for now, assume it is
    return createdAtValue;
  }
  if (createdAtValue && typeof createdAtValue === 'object' && 'seconds' in createdAtValue && 'nanoseconds' in createdAtValue) {
    // Handle plain object representation of Timestamp
    return new Timestamp(createdAtValue.seconds, createdAtValue.nanoseconds).toDate().toISOString();
  }
  // Fallback or if it's an older structure that might just be a Date object (less likely from serverTimestamp)
  if (createdAtValue instanceof Date) {
    return createdAtValue.toISOString();
  }
  return new Date().toISOString(); // Default fallback
};


export const addVideoMetadata = async (videoData: Omit<VideoMeta, 'id' | 'createdAt' | 'permalink'>): Promise<string> => {
  try {
    const docRef = await addDoc(collection(db, "videos"), {
      ...videoData,
      createdAt: serverTimestamp(),
    });
    // Update permalink after getting ID
    const permalink = `/videos/${docRef.id}`;
    await setDoc(doc(db, "videos", docRef.id), { permalink }, { merge: true });
    return docRef.id;
  } catch (error) {
    console.error("Error adding video metadata: ", error);
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
    querySnapshot.forEach((doc) => {
      const data = doc.data();
      videos.push({ 
        id: doc.id,
        ...data,
        createdAt: getSafeCreatedAtISO(data.createdAt),
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
    querySnapshot.forEach((doc) => {
      const data = doc.data();
      videos.push({ 
        id: doc.id,
        ...data,
        createdAt: getSafeCreatedAtISO(data.createdAt),
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
