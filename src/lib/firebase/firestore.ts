
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
  updateDoc,
} from "firebase/firestore";
import type { VideoMeta, DoctorProfile } from "@/types";

const getSafeCreatedAtISO = (createdAtValue: any): string => {
  if (!createdAtValue) {
    return new Date().toISOString(); 
  }
  if (createdAtValue instanceof Timestamp) {
    return createdAtValue.toDate().toISOString();
  }
  if (typeof createdAtValue === 'string') {
    try {
      return new Date(createdAtValue).toISOString();
    } catch (e) {
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
      comments: videoData.comments || [], 
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
    const { createdAt, ...restOfData } = dataToUpdate;
    let updatePayload: any = restOfData;
    
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

// Updated to fetch featured videos for RecentActivityFeed
export const getRecentVideos = async (days: number = 7, countLimit: number = 5, featuredOnly: boolean = false): Promise<VideoMeta[]> => {
  try {
    const videosCollection = collection(db, "videos");
    const referenceDate = new Date();
    referenceDate.setDate(referenceDate.getDate() - days);
    const referenceTimestamp = Timestamp.fromDate(referenceDate);

    let q;
    if (featuredOnly) {
      q = query(
        videosCollection,
        where("featured", "==", true),
        where("createdAt", ">=", referenceTimestamp), // Ensure it's also recent if days constraint applies
        orderBy("createdAt", "desc"),
        limit(countLimit)
      );
    } else {
       q = query(
        videosCollection,
        where("createdAt", ">=", referenceTimestamp),
        orderBy("createdAt", "desc"),
        limit(countLimit)
      );
    }

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
