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
} from "firebase/firestore";
import type { VideoMeta, DoctorProfile } from "@/types";

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
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - days);
    const sevenDaysAgoTimestamp = Timestamp.fromDate(sevenDaysAgo);

    const q = query(
      videosCollection,
      where("createdAt", ">=", sevenDaysAgoTimestamp),
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
        createdAt: (data.createdAt as Timestamp)?.toDate().toISOString() || new Date().toISOString(),
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
        createdAt: (data.createdAt as Timestamp)?.toDate().toISOString() || new Date().toISOString(),
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
        createdAt: (data.createdAt as Timestamp)?.toDate().toISOString() || new Date().toISOString(),
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
