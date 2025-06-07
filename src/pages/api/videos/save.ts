// studio/src/pages/api/videos/save.ts

import type { NextApiRequest, NextApiResponse } from "next";
import { saveVideoMetadataAction } from "@/server/actions/saveVideoMetadataAction";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method Not Allowed" });
  }

  try {
    const video = req.body;
    const result = await saveVideoMetadataAction(video);
    if (result.success) {
      return res.status(200).json({ success: true });
    } else {
      return res.status(500).json({ success: false, error: result.error });
    }
  } catch (err: any) {
    console.error("🔥 API error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
}