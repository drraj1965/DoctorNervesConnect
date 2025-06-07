// src/app/api/save-video-metadata/route.ts

import { NextResponse } from "next/server";
import { db } from "@/server/firebase-admin"; // Admin SDK
import { Timestamp } from "firebase-admin/firestore"; // For Admin SDK serverTimestamp
import type { VideoMeta } from "@/types";
import crypto from 'crypto'; // For randomUUID if needed, though client should send ID

export async function POST(req: Request) {
  try {
    const metadata: Partial<VideoMeta> = await req.json();

    if (!metadata.doctorId || !metadata.videoUrl || !metadata.title || !metadata.id) {
      console.error("API Error: Missing required metadata fields from client. Received:", metadata);
      return NextResponse.json({ error: "Missing required metadata fields: doctorId, id, videoUrl, title are mandatory." }, { status: 400 });
    }

    const videoId = metadata.id; // Client MUST send the ID

    // Prepare data for Firestore, ensuring all VideoMeta fields are covered
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
      permalink: metadata.permalink || `/videos/${videoId}`,
      storagePath: metadata.storagePath || "",
      thumbnailStoragePath: metadata.thumbnailStoragePath || "",
      videoSize: metadata.videoSize || 0,
      videoType: metadata.videoType || "video/unknown",
      comments: metadata.comments || [],
      createdAt: Timestamp.now(), // Use Admin SDK Timestamp for server-side timestamp
    };
    
    await db.collection("videos").doc(videoId).set(dataToSave);

    console.log(`API Route: Successfully saved video metadata for ID: ${videoId}`);
    return NextResponse.json({ success: true, id: videoId }, { status: 200 });
  } catch (error: any) {
    console.error("API Route Error saving video metadata:", error);
    const errorMessage = error.message || "Internal Server Error";
    const errorCode = error.code || "UNKNOWN_ERROR_CODE";
    return NextResponse.json({ error: errorMessage, errorCode: errorCode }, { status: 500 });
  }
}