// components/video/VideoRecorder.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { getStorage, ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { getFirestore, doc, setDoc } from "firebase/firestore";
import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";

export default function VideoRecorder() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const previewRef = useRef<HTMLVideoElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const [recording, setRecording] = useState(false);
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string>("");
  const [stream, setStream] = useState<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const [thumbnailBlobs, setThumbnailBlobs] = useState<string[]>([]);
  const [selectedThumbnail, setSelectedThumbnail] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [keywords, setKeywords] = useState("");
  const [timer, setTimer] = useState(0);
  const [intervalId, setIntervalId] = useState<NodeJS.Timeout | null>(null);
  const { currentUser } = useAuth();
  const router = useRouter();
  const [customTimestamp, setCustomTimestamp] = useState("00:00:01.000");

  useEffect(() => {
    const initStream = async () => {
      try {
        const mediaStream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: { echoCancellation: true },
        });
        setStream(mediaStream);
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
        }
      } catch (err) {
        console.error("Error accessing media devices:", err);
      }
    };
    if (typeof window !== "undefined") initStream();
  }, []);

  const getSupportedMimeType = () => {
    const types = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
    return types.find((type) => MediaRecorder.isTypeSupported(type)) || "";
  };

  const startRecording = () => {
    if (!stream) return;
    const mimeType = getSupportedMimeType();
    const recorder = new MediaRecorder(stream, { mimeType });
    mediaRecorderRef.current = recorder;
    chunksRef.current = [];

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunksRef.current.push(event.data);
      }
    };

    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mimeType });
      const videoURL = URL.createObjectURL(blob);
      setPreviewBlob(blob);
      setPreviewUrl(videoURL);
    };

    recorder.start();
    setRecording(true);
    setPreviewBlob(null);
    setPreviewUrl("");
    const id = setInterval(() => setTimer((t) => t + 1), 1000);
    setIntervalId(id);
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    setRecording(false);
    if (intervalId) clearInterval(intervalId);
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      setStream(null);
    }
  };

  const saveLocally = () => {
    if (!previewBlob) return;
    const url = URL.createObjectURL(previewBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title || "recording"}.webm`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const generateThumbnailsFromFFmpeg = async () => {
    if (!previewBlob) return;
    try {
      const { createFFmpeg, fetchFile } = await import("@ffmpeg/ffmpeg");
      const ffmpeg = createFFmpeg({
        log: true,
        corePath: "/ffmpeg/ffmpeg-core.js",
      });

      if (!ffmpeg.isLoaded()) {
        await ffmpeg.load();
      }

      ffmpeg.FS("writeFile", "input.webm", await fetchFile(previewBlob));

      const timestamps = ["00:00:01.000", "00:00:02.000", "00:00:03.000", customTimestamp];
      const generatedThumbs: string[] = [];

      for (let i = 0; i < timestamps.length; i++) {
        const outFile = `thumbnail${i + 1}.jpg`;
        await ffmpeg.run("-i", "input.webm", "-ss", timestamps[i], "-vframes", "1", outFile);
        const data = ffmpeg.FS("readFile", outFile);
        const blob = new Blob([data.buffer], { type: "image/jpeg" });
        const url = URL.createObjectURL(blob);
        generatedThumbs.push(url);
      }

      setThumbnailBlobs(generatedThumbs);
    } catch (err) {
      console.error("Thumbnail generation failed:", err);
    }
  };

  return (
    <div className="p-4">
      <h2 className="text-xl font-bold mb-2">Video Recorder</h2>

      {!previewBlob && <video ref={videoRef} autoPlay muted className="w-full max-w-lg" />}

      {previewBlob && previewUrl && (
        <video ref={previewRef} src={previewUrl} controls className="w-full max-w-lg" />
      )}

      <div className="my-2">Timer: {timer} sec</div>

      <div className="flex gap-2 my-2">
        {recording ? (
          <button onClick={stopRecording} className="px-4 py-2 bg-red-600 text-white rounded">
            Stop Recording
          </button>
        ) : !previewBlob ? (
          <button onClick={startRecording} className="px-4 py-2 bg-green-600 text-white rounded">
            Start Recording
          </button>
        ) : (
          <button onClick={() => window.location.reload()} className="px-4 py-2 bg-gray-600 text-white rounded">
            Reset
          </button>
        )}
      </div>

      {previewBlob && (
        <div className="my-4">
          <input
            type="text"
            placeholder="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="block w-full mb-2 p-2 border"
          />
          <textarea
            placeholder="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="block w-full mb-2 p-2 border"
          />
          <input
            type="text"
            placeholder="Keywords (comma-separated)"
            value={keywords}
            onChange={(e) => setKeywords(e.target.value)}
            className="block w-full mb-2 p-2 border"
          />

          <button
            onClick={saveLocally}
            className="px-4 py-2 bg-gray-700 text-white rounded mb-2"
          >
            Save Locally
          </button>

          <div className="my-2">
            <label htmlFor="customTimestamp" className="block mb-1">Custom Thumbnail Timestamp (hh:mm:ss.mmm):</label>
            <input
              id="customTimestamp"
              type="text"
              value={customTimestamp}
              onChange={(e) => setCustomTimestamp(e.target.value)}
              className="w-full p-2 border mb-2"
            />
          </div>

          <button
            onClick={generateThumbnailsFromFFmpeg}
            className="px-4 py-2 bg-yellow-600 text-white rounded mb-2"
          >
            Generate Thumbnails (FFmpeg)
          </button>

          <div className="my-2">
            {thumbnailBlobs.map((thumb, idx) => (
              <img
                key={idx}
                src={thumb}
                alt={`Thumbnail ${idx + 1}`}
                className={`w-20 h-14 inline-block mr-2 border ${
                  selectedThumbnail === thumb ? "border-blue-500" : ""
                }`}
                onClick={() => setSelectedThumbnail(thumb)}
              />
            ))}
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => alert("🔐 Upload logic here")}
              disabled={!selectedThumbnail}
              className={`px-4 py-2 text-white rounded ${
                selectedThumbnail ? "bg-blue-600" : "bg-blue-300 cursor-not-allowed"
              }`}
            >
              Upload to Firebase
            </button>
          </div>
        </div>
      )}
    </div>
  );
}