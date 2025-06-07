
// src/app/api/save-video-metadata/route.ts

import { NextResponse } from "next/server";
import { db } from "@/server/firebase-admin"; // Admin SDK
import { Timestamp } from "firebase-admin/firestore"; // For Admin SDK serverTimestamp
import type { VideoMeta } from "@/types";
// import crypto from 'crypto'; // Not needed if client sends ID

export async function POST(req: Request) {
  let requestBody;
  try {
    requestBody = await req.json();
    console.log("API Route: Received metadata:", JSON.stringify(requestBody, null, 2));

    // Use type assertion if confident, or perform more thorough validation
    const metadata = requestBody as Partial<VideoMeta>;

    if (!metadata.id || !metadata.doctorId || !metadata.videoUrl || !metadata.title) {
      console.error("API Route Error: Missing required metadata fields. Received:", metadata);
      return NextResponse.json({ error: "Missing required metadata fields: id, doctorId, videoUrl, title are mandatory." }, { status: 400 });
    }

    const videoId = metadata.id;

    // Prepare data for Firestore, ensuring all VideoMeta fields are covered
    // Default values for fields that might be optional from client but required in VideoMeta
    const dataToSave: Omit<VideoMeta, 'createdAt'> & { createdAt: Timestamp } = {
      id: videoId,
      title: metadata.title,
      description: metadata.description || "",
      doctorId: metadata.doctorId,
      doctorName: metadata.doctorName || "Unknown Doctor",
      videoUrl: metadata.videoUrl,
      thumbnailUrl: metadata.thumbnailUrl || "",
      duration: metadata.duration || "00:00", // Should be provided by client
      recordingDuration: metadata.recordingDuration || 0, // Should be provided by client
      tags: metadata.tags || [],
      viewCount: metadata.viewCount || 0,
      likeCount: metadata.likeCount || 0,
      commentCount: metadata.commentCount || 0,
      featured: metadata.featured || false,
      permalink: metadata.permalink || `/videos/${videoId}`,
      storagePath: metadata.storagePath || "", // Should be provided by client
      thumbnailStoragePath: metadata.thumbnailStoragePath || "", // Should be provided by client
      videoSize: metadata.videoSize || 0,
      videoType: metadata.videoType || "video/unknown",
      comments: metadata.comments || [],
      createdAt: Timestamp.now(), // Use Admin SDK Timestamp for server-side timestamp
    };
    
    console.log("API Route: Data to be saved to Firestore:", JSON.stringify(dataToSave, null, 2));
    await db.collection("videos").doc(videoId).set(dataToSave);

    console.log(`API Route: Successfully saved video metadata for ID: ${videoId}`);
    return NextResponse.json({ success: true, id: videoId }, { status: 200 });
  } catch (error: any) {
    console.error("API Route Error saving video metadata:", error);
    let errorMessage = "Internal Server Error";
    if (error.message) {
      errorMessage = error.message;
    } else if (typeof error === 'string') {
      errorMessage = error;
    }
    
    if (error instanceof SyntaxError && error.message.includes("JSON")) {
        errorMessage = "Invalid JSON payload received.";
        return NextResponse.json({ error: errorMessage, requestBodyAttempt: String(requestBody) }, { status: 400 });
    }

    return NextResponse.json({ error: errorMessage, detail: error.toString() }, { status: 500 });
  }
}

