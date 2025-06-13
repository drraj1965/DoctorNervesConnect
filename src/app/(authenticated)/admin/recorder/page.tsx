
"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { v4 as uuidv4 } from "uuid";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import ReactPlayer from "react-player";
import {
  uploadFileToStorage,
  getFirebaseStorageDownloadUrl,
  saveVideoMetadataToFirestore,
} from "@/lib/firebase-service"; // This will be the new client-side service

import "@/styles/video-recorder.css"; // Assuming this file will be created with basic styles

export default function WebVideoRecorderPage() {
  const { user, isAdmin, doctorProfile } = useAuth(); // Added doctorProfile
  const router = useRouter();

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const playerRef = useRef<ReactPlayer | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const [cameraOn, setCameraOn] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordedVideoUrl, setRecordedVideoUrl] = useState<string>("");
  const [mediaBlob, setMediaBlob] = useState<Blob | null>(null);
  const [error, setError] = useState<string>("");
  const [showReviewInterface, setShowReviewInterface] = useState(false);
  const [useFallbackPlayer, setUseFallbackPlayer] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [uploading, setUploading] = useState(false);
  const [showMetadataForm, setShowMetadataForm] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  // Add other metadata states from our more complete version if needed by the UI,
  // like keywords, featured, thumbnail states, etc. For now, sticking to your provided states.

  useEffect(() => {
    if (!user) {
      router.push("/login");
    } else if (!isAdmin) {
      alert("Access denied: Admins only"); // Consider using ShadCN Alert/Toast for better UX
      router.push("/dashboard");
    }
  }, [user, isAdmin, router]);

  const startCamera = async () => {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(e => console.warn("Error playing live preview:", e));
      }
      setCameraOn(true);
    } catch (err) {
      console.error("startCamera error:", err);
      setError("Unable to access camera and microphone.");
    }
  };

  const getSupportedMimeType = () => {
    const types = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
    for (const type of types) { if (MediaRecorder.isTypeSupported(type)) return type; }
    return 'video/webm'; // Fallback
  };

  const startRecording = () => {
    if (!streamRef.current || !streamRef.current.active) {
        setError("Camera stream is not active. Please start the camera first.");
        return;
    }
    setError("");
    recordedChunksRef.current = [];
    const mimeType = getSupportedMimeType();
    const recorder = new MediaRecorder(streamRef.current, { mimeType });

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        recordedChunksRef.current.push(event.data);
      }
    };

    recorder.onstop = () => {
      const blobMimeType = mediaRecorderRef.current?.mimeType || mimeType || "video/webm";
      const blob = new Blob(recordedChunksRef.current, { type: blobMimeType });
      
      if (!blob || blob.size === 0) {
        console.error("Recorded blob is empty or undefined");
        setError("Recording failed. Please try again.");
        setRecording(false); // Ensure recording state is reset
        return;
      }

      console.log("Blob created. Size:", blob.size, "Type:", blob.type);
      setMediaBlob(blob);

      const url = URL.createObjectURL(blob);
      if (typeof url === 'string' && url.startsWith('blob:')) {
        setRecordedVideoUrl(url);
        setShowReviewInterface(true);
        setShowMetadataForm(true); // Show metadata form after recording stops
      } else {
        console.error("Failed to create valid blob URL for review. Received:", url);
        setError("Failed to create playable URL for the recorded video.");
        setRecordedVideoUrl("");
        setShowReviewInterface(false);
        setShowMetadataForm(false);
      }
      setRecording(false); // Move here to ensure it's always reset
    };
    
    recorder.onerror = (event) => {
        console.error("MediaRecorder error:", event);
        setError("An error occurred during recording.");
        setRecording(false);
        if (streamRef.current) { // Attempt to stop tracks if an error occurs during recording
            streamRef.current.getTracks().forEach((track) => track.stop());
        }
        setCameraOn(false);
    };

    mediaRecorderRef.current = recorder;
    try {
        recorder.start();
        setRecording(true);
    } catch (e) {
        console.error("Failed to start recorder:", e);
        setError(`Failed to start recorder: ${e instanceof Error ? e.message : String(e)}`);
        setRecording(false);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    // Stream tracks are stopped in onstop or if startCamera is called again
    // streamRef.current?.getTracks().forEach((track) => track.stop());
    // setCameraOn(false); // Keep camera on for potential re-record unless explicitly stopped
    setRecording(false);
  };

  const handleUpload = async () => {
    if (!mediaBlob || !title.trim() || !user || !isAdmin) {
      setError("Missing video, title, or user/admin status not confirmed.");
      return;
    }
    setError("");

    const videoId = uuidv4();
    // Use a safe default for doctorProfile.uid if it's somehow null (though isAdmin check should cover this)
    const doctorUid = doctorProfile?.uid || user.uid; 
    const videoPath = `videos/${doctorUid}/${videoId}.webm`; // Assuming webm, adjust if dynamic

    try {
      setUploading(true);
      setUploadProgress(0); // Reset progress

      // Simulate progress for client-side upload
      const storagePath = await uploadFileToStorage(videoPath, mediaBlob, (snapshot) => {
        const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
        setUploadProgress(Math.round(progress));
      });
      const downloadUrl = await getFirebaseStorageDownloadUrl(storagePath);

      const metadata = {
        id: videoId,
        doctorId: doctorUid, // Use doctorUid
        doctorName: doctorProfile?.name || user.displayName || "Unknown Doctor",
        title,
        description,
        videoUrl: downloadUrl,
        storagePath: videoPath, // Use storagePath returned by upload function
        thumbnailUrl: "", // Placeholder, to be implemented if thumbnail logic is added back
        thumbnailStoragePath: "", // Placeholder
        duration: "00:00", // Placeholder, needs actual duration
        recordingDuration: 0, // Placeholder
        tags: [], // Placeholder
        createdAt: new Date().toISOString(), // Client-side timestamp
        viewCount: 0,
        likeCount: 0,
        commentCount: 0,
        featured: false,
        permalink: `/videos/${videoId}`,
        videoSize: mediaBlob.size,
        videoType: mediaBlob.type,
        comments: [],
      };

      await saveVideoMetadataToFirestore(videoId, metadata); // Pass videoId and metadata separately
      alert("Upload successful!"); // Consider ShadCN Toast

      // Reset relevant states
      setShowMetadataForm(false);
      setRecordedVideoUrl("");
      setMediaBlob(null);
      setTitle("");
      setDescription("");
      setShowReviewInterface(false);
      // Optionally stop camera or keep it on for another recording
      // stopCamera(); // Or some other reset logic
    } catch (err) {
      console.error("Upload failed:", err);
      setError(`Upload failed. ${err instanceof Error ? err.message : "Please try again."}`);
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  };

  // Function to stop camera explicitly if needed, e.g. after successful upload or reset
  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) {
        videoRef.current.srcObject = null;
    }
    setCameraOn(false);
  };

  return (
    <div className="video-recorder-container p-4 md:p-8 max-w-3xl mx-auto bg-card text-card-foreground rounded-lg shadow-xl">
      <h1 className="recorder-title text-2xl font-bold mb-6 text-center text-primary">Record Video</h1>

      {error && <div className="error-text bg-destructive text-destructive-foreground p-3 rounded-md mb-4">{error}</div>}

      <div className="mb-4">
        {!cameraOn && !recordedVideoUrl && (
          <Button onClick={startCamera} className="w-full">Start Camera</Button>
        )}
      </div>
      
      {/* Video Preview Area */}
      <div className="video-preview-area mb-4" style={{ display: cameraOn || recordedVideoUrl ? 'block' : 'none' }}>
         {/* Live Preview - visible when camera is on AND not in review interface */}
        {cameraOn && !showReviewInterface && (
             <video ref={videoRef} autoPlay muted playsInline className="video-preview w-full aspect-video bg-slate-900 rounded-md" />
        )}
         {/* Review Player Area - visible when in review interface and recordedVideoUrl exists */}
        {showReviewInterface && recordedVideoUrl && (
            <div>
            {!useFallbackPlayer ? (
                <ReactPlayer
                key={recordedVideoUrl}
                ref={playerRef}
                url={recordedVideoUrl}
                controls
                playing // Autoplay review
                width="100%"
                height="auto" // Adjust for aspect ratio
                className="aspect-video bg-slate-900 rounded-md"
                onStart={() => console.log("ReactPlayer started review")}
                onReady={() => console.log("ReactPlayer ready for review")}
                onError={(e, data) => {
                    console.error("ReactPlayer error on review:", e, data);
                    setError("ReactPlayer failed. Trying native player.");
                    setUseFallbackPlayer(true);
                }}
                />
            ) : (
                <video controls autoPlay playsInline width="100%" className="aspect-video bg-slate-900 rounded-md mt-4">
                <source src={recordedVideoUrl} type={mediaBlob?.type || "video/webm"} />
                Your browser does not support the video tag.
                </video>
            )}
            <a href={recordedVideoUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline mt-2 inline-block">
                Open Recorded Video in New Tab
            </a>
            </div>
        )}
      </div>


      {/* Recording Controls */}
      {cameraOn && !showReviewInterface && (
        <div className="controls-section mb-4 flex gap-2">
          {!recording ? (
            <Button onClick={startRecording} className="flex-1 bg-green-600 hover:bg-green-700">Start Recording</Button>
          ) : (
            <Button onClick={stopRecording} className="flex-1 bg-red-600 hover:bg-red-700">Stop Recording</Button>
          )}
        </div>
      )}
      
      {/* Metadata Form - shown after recording stops and review is active */}
      {showReviewInterface && showMetadataForm && recordedVideoUrl && (
        <div className="metadata-form mt-6 p-4 border-t border-border">
          <h2 className="text-xl font-semibold mb-4">Video Metadata</h2>
          <div className="space-y-4">
            <Input placeholder="Title (Required)" value={title} onChange={(e) => setTitle(e.target.value)} className="mb-2" required />
            <Textarea placeholder="Description" value={description} onChange={(e) => setDescription(e.target.value)} className="mb-2" rows={3} />
            {/* Add Keywords and Featured checkbox here if needed, similar to the more complete version */}
            <Button onClick={handleUpload} disabled={uploading || !title.trim()} className="w-full bg-primary hover:bg-primary/90">
              {uploading ? `Uploading... ${uploadProgress.toFixed(0)}%` : "Upload to App"}
            </Button>
            {uploading && (
              <div className="w-full bg-muted rounded-full h-2.5 mt-2">
                <div className="bg-primary h-2.5 rounded-full" style={{ width: `${uploadProgress}%` }}></div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Button to restart the process if a video has been recorded */}
      {recordedVideoUrl && (
          <Button onClick={() => {
              stopCamera(); // Turn off current camera stream
              setShowReviewInterface(false);
              setShowMetadataForm(false);
              setRecordedVideoUrl("");
              setMediaBlob(null);
              setTitle("");
              setDescription("");
              setUseFallbackPlayer(false);
              setError("");
              // startCamera(); // Optionally restart camera immediately
          }} variant="outline" className="w-full mt-4">
            Record Another Video
          </Button>
      )}

    </div>
  );
}

    