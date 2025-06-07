
import type { NextApiRequest, NextApiResponse } from "next";
import { db } from "@/server/firebase-admin"; // This uses the Admin SDK
import { Timestamp } from "firebase-admin/firestore"; // For Admin SDK serverTimestamp
import type { VideoMeta } from "@/types"; // Ensure this type is consistent
import crypto from 'crypto'; // For randomUUID in Node.js environments < 15.6.0 or for consistency

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const metadata: Partial<VideoMeta> = req.body; // Expecting partial data, API will fill some

    if (!metadata.doctorId || !metadata.videoUrl || !metadata.title || !metadata.id) {
      console.error("API Error: Missing required metadata fields. Received:", metadata);
      return res.status(400).json({ error: "Missing required metadata fields: doctorId, id, videoUrl, title are mandatory." });
    }

    const videoId = metadata.id; // Client should generate and send the ID

    // Prepare data for Firestore, ensuring all VideoMeta fields are covered
    // The client sends most fields, API enriches/overwrites critical ones like createdAt
    const dataToSave: Omit<VideoMeta, 'createdAt'> & { createdAt: Timestamp } = {
      id: videoId,
      title: metadata.title,
      description: metadata.description || "",
      doctorId: metadata.doctorId,
      doctorName: metadata.doctorName || "Unknown Doctor",
      videoUrl: metadata.videoUrl,
      thumbnailUrl: metadata.thumbnailUrl || "",
      duration: metadata.duration || "00:00",
      recordingDuration: metadata.recordingDuration || 0,
      tags: metadata.tags || [],
      viewCount: metadata.viewCount || 0,
      likeCount: metadata.likeCount || 0,
      commentCount: metadata.commentCount || 0,
      featured: metadata.featured || false,
      permalink: metadata.permalink || `/videos/${videoId}`, // Client might pre-fill, or API can generate
      storagePath: metadata.storagePath || "",
      thumbnailStoragePath: metadata.thumbnailStoragePath || "",
      videoSize: metadata.videoSize || 0,
      videoType: metadata.videoType || "video/unknown",
      comments: metadata.comments || [],
      createdAt: Timestamp.now(), // Use Admin SDK Timestamp for server-side timestamp
    };
    
    await db.collection("videos").doc(videoId).set(dataToSave);

    console.log(`API: Successfully saved video metadata for ID: ${videoId}`);
    return res.status(200).json({ success: true, id: videoId });
  } catch (error: any) {
    console.error("API Error saving video metadata:", error);
    const errorMessage = error.message || "Internal Server Error";
    const errorCode = error.code || "UNKNOWN_ERROR";
    return res.status(500).json({ error: errorMessage, errorCode: errorCode });
  }
}
