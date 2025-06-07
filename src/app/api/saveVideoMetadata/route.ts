import { NextResponse } from "next/server";
import { db } from "@/server/firebase-admin";
import { Timestamp } from "firebase-admin/firestore";

export async function POST(req: Request) {
  try {
    const data = await req.json();

    if (!data || !data.id || !data.doctorId) {
      return NextResponse.json({ error: "Missing required metadata fields" }, { status: 400 });
    }

    await db.collection("videos").doc(data.id).set({
      ...data,
      createdAt: Timestamp.now(),
    });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("❌ API Error saving video metadata:", err);
    return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
  }
}
