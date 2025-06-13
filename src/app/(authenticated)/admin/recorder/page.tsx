
"use client";

import React, { useEffect, useRef, useState, useCallback, FormEvent } from "react";
import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { Loader2, Video as VideoIconLucide, Mic, Square, UploadCloud, AlertCircle, CheckCircle, CameraIcon as CameraIconLucide, RefreshCcw, Download, Image as ImageIconLucide, Play, Pause } from "lucide-react";
import { v4 as uuidv4 } from 'uuid';
import NextImage from 'next/image';
import { uploadFileToStorage, getFirebaseStorageDownloadUrl } from "@/lib/firebase/storage";
import { saveVideoMetadataAction } from "./actions";
import type { VideoMeta } from "@/types";
import { useToast } from '@/hooks/use-toast';
import ReactPlayer from "react-player";
// import "@/styles/video-recorder.css"; // Assuming this file might be created or styles handled by Tailwind

const MAX_RECORDING_MINUTES = 30;
const NUM_THUMBNAILS_TO_GENERATE = 5;

type RecorderStep = "initial" | "settingUp" | "permissionDenied" | "readyToRecord" | "recording" | "review" | "thumbnailsReady" | "metadata" | "uploading" | "success" | "error";


export default function WebVideoRecorderPage() {
  const { user, doctorProfile, isAdmin, loading: authLoading } = useAuth();
  const router = useRouter();
  const { toast } = useToast();

  const liveVideoPreviewRef = useRef<HTMLVideoElement | null>(null);
  const playerRef = useRef<ReactPlayer | null>(null);
  const fallbackPlayerRef = useRef<HTMLVideoElement | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const clonedMediaStreamRef = useRef<MediaStream | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);

  const [_recorderStep, _setRecorderStep] = useState<RecorderStep>("initial");
  const recorderStepRef = useRef<RecorderStep>("initial");

  const setRecorderStep = (step: RecorderStep) => {
    console.log(`RecorderPage: Setting recorderStep from ${recorderStepRef.current} to ${step}`);
    recorderStepRef.current = step;
    _setRecorderStep(step);
  };


  const [recordedVideoBlob, setRecordedVideoBlob] = useState<Blob | null>(null);
  const [recordedVideoUrl, setRecordedVideoUrl] = useState<string | null>(null);

  const [recordingDuration, setRecordingDuration] = useState(0);
  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [hasCameraPermission, setHasCameraPermission] = useState<boolean | null>(null);

  const [potentialThumbnails, setPotentialThumbnails] = useState<string[]>([]);
  const [potentialThumbnailBlobs, setPotentialThumbnailBlobs] = useState<Blob[]>([]);
  const [selectedThumbnailIndex, setSelectedThumbnailIndex] = useState<number | null>(null);
  const [isCapturingThumbnail, setIsCapturingThumbnail] = useState(false);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [keywords, setKeywords] = useState('');
  const [featured, setFeatured] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [isLocallySaved, setIsLocallySaved] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);

  const [useFallbackPlayer, setUseFallbackPlayer] = useState(false);

  // Authorization and Initial Setup Effect
  useEffect(() => {
    console.log(`RecorderPage: Auth/Setup Effect - authLoading: ${authLoading}, isAdmin: ${isAdmin}, currentStep: ${recorderStepRef.current}`);
    if (!authLoading) {
      if (!user || !isAdmin) {
        toast({ variant: "destructive", title: "Access Denied", description: "You are not authorized for this page." });
        router.replace("/dashboard");
      } else if (recorderStepRef.current === "initial" || recorderStepRef.current === "permissionDenied") {
        console.log(`RecorderPage: Auth/Setup Effect - Calling requestPermissionsAndSetup.`);
        requestPermissionsAndSetup();
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user, isAdmin, router]); // Removed toast, requestPermissionsAndSetup to avoid loops if they change identity often

  // Cleanup effect for streams and blob URLs
  useEffect(() => {
    return () => {
      console.log("RecorderPage: UNMOUNTING - Cleaning up resources.");
      mediaStreamRef.current?.getTracks().forEach(track => track.stop());
      clonedMediaStreamRef.current?.getTracks().forEach(track => track.stop());

      if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
        mediaRecorderRef.current.stop();
      }
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
      }
      if (recordedVideoUrl && recordedVideoUrl.startsWith('blob:')) {
        console.log("RecorderPage: UNMOUNT - Revoking recordedVideoUrl:", recordedVideoUrl.substring(0,40));
        URL.revokeObjectURL(recordedVideoUrl);
      }
      potentialThumbnails.forEach((url, index) => {
        if (url && url.startsWith('blob:')) {
          console.log(`RecorderPage: UNMOUNT - Revoking potentialThumbnail URL ${index}:`, url.substring(0,40));
          URL.revokeObjectURL(url);
        }
      });
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const requestPermissionsAndSetup = useCallback(async () => {
    console.log("RecorderPage: requestPermissionsAndSetup called.");
    setRecorderStep("settingUp");
    setError(null); setHasCameraPermission(null);

    mediaStreamRef.current?.getTracks().forEach(track => track.stop());
    mediaStreamRef.current = null;
    clonedMediaStreamRef.current?.getTracks().forEach(track => track.stop());
    clonedMediaStreamRef.current = null;
    if (liveVideoPreviewRef.current) liveVideoPreviewRef.current.srcObject = null;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      mediaStreamRef.current = stream;
      setHasCameraPermission(true);
      console.log("RecorderPage: Permissions granted, stream acquired:", stream.id);

      if (liveVideoPreviewRef.current) {
        liveVideoPreviewRef.current.srcObject = stream;
        liveVideoPreviewRef.current.oncanplay = () => {
            console.log("RecorderPage: Live preview 'canplay' event fired. Video dimensions:", liveVideoPreviewRef.current?.videoWidth, "x", liveVideoPreviewRef.current?.videoHeight);
            setRecorderStep("readyToRecord");
        };
        liveVideoPreviewRef.current.onerror = (e) => {
            console.error("RecorderPage: Video element error during live preview setup:", liveVideoPreviewRef.current?.error, e);
            setError("Video element error. Please refresh or check permissions.");
            setRecorderStep("permissionDenied"); setHasCameraPermission(false);
        };
        await liveVideoPreviewRef.current.play().catch(e => console.warn("Live preview play error on setup:", e));
      } else {
        setRecorderStep("error"); // Fallback if ref is null
        setError("Video preview element not available.");
      }
    } catch (err) {
      console.error("RecorderPage: Error in requestPermissionsAndSetup:", err);
      const errorMsg = err instanceof Error ? err.message : String(err);
      setError(`Camera/mic access failed: ${errorMsg}.`);
      if (errorMsg.toLowerCase().includes("notfounderror") || errorMsg.toLowerCase().includes("devicesnotfound")) {
        setError("Camera/mic access failed: No devices found. Please ensure a camera and microphone are connected and enabled.");
      }
      setRecorderStep("permissionDenied"); setHasCameraPermission(false);
    }
  }, []); // Removed setRecorderStep from deps as it uses ref now

  const getSupportedMimeType = useCallback(() => {
    const types = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
    for (const type of types) { if (MediaRecorder.isTypeSupported(type)) return type; }
    return 'video/webm';
  }, []);

  const startRecording = () => {
    console.log("RecorderPage: startRecording called.");
    if (!mediaStreamRef.current || !mediaStreamRef.current.active || recorderStepRef.current !== "readyToRecord") {
      setError("Camera not ready or permission denied. Please refresh or re-enable permissions.");
      requestPermissionsAndSetup(); return;
    }

    if (recordedVideoUrl && recordedVideoUrl.startsWith('blob:')) URL.revokeObjectURL(recordedVideoUrl);
    setRecordedVideoUrl(null); setRecordedVideoBlob(null);
    potentialThumbnails.forEach((url) => { if (url && url.startsWith('blob:')) URL.revokeObjectURL(url); });
    setPotentialThumbnails([]); setPotentialThumbnailBlobs([]); setSelectedThumbnailIndex(null);
    recordedChunksRef.current = [];
    setIsLocallySaved(false); setUploadSuccess(false);
    setRecordingDuration(0); setError(null); setUseFallbackPlayer(false);

    if (liveVideoPreviewRef.current && liveVideoPreviewRef.current.srcObject !== mediaStreamRef.current) {
        liveVideoPreviewRef.current.srcObject = mediaStreamRef.current;
        liveVideoPreviewRef.current.play().catch(e => console.warn("Error re-playing live preview for recording start:", e));
    }

    if (clonedMediaStreamRef.current) clonedMediaStreamRef.current.getTracks().forEach(track => track.stop());
    clonedMediaStreamRef.current = mediaStreamRef.current.clone();
    console.log("RecorderPage: Cloned mediaStream for recorder. Cloned stream ID:", clonedMediaStreamRef.current.id);

    const mimeType = getSupportedMimeType();
    try {
      mediaRecorderRef.current = new MediaRecorder(clonedMediaStreamRef.current, { mimeType });
      mediaRecorderRef.current.onstart = () => {
        console.log("RecorderPage: MediaRecorder onstart. Actual MIME type:", mediaRecorderRef.current?.mimeType);
        setRecorderStep("recording");
        if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
        setRecordingDuration(0);
        recordingTimerRef.current = setInterval(() => setRecordingDuration(prev => prev + 1), 1000);
      };
      mediaRecorderRef.current.ondataavailable = (event) => {
        if (event.data.size > 0) {
          console.log("RecorderPage: MediaRecorder ondataavailable, chunk size:", event.data.size);
          recordedChunksRef.current.push(event.data);
        }
      };
      mediaRecorderRef.current.onstop = () => {
        console.log("RecorderPage: MediaRecorder onstop. Chunks collected:", recordedChunksRef.current.length);
        if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
        clonedMediaStreamRef.current?.getTracks().forEach(track => track.stop());
        
        // Important: Stop live preview tracks as well to free up camera for review if needed by some browsers
        // or to prevent it from showing underneath.
        if (liveVideoPreviewRef.current) {
             liveVideoPreviewRef.current.pause();
             liveVideoPreviewRef.current.srcObject = null; // Detach camera stream
        }

        if (recordedChunksRef.current.length === 0) { setError("No video data recorded."); setRecorderStep("readyToRecord"); return; }
        const blob = new Blob(recordedChunksRef.current, { type: mediaRecorderRef.current?.mimeType || mimeType });
        if (blob.size === 0) { setError("Recorded blob is empty."); setRecorderStep("readyToRecord"); return; }

        const url = URL.createObjectURL(blob);
        console.log("RecorderPage: Created blob URL for review. URL valid:", typeof url === 'string' && url.startsWith('blob:'), "Size:", blob.size);

        if (typeof url === 'string' && url.startsWith('blob:')) {
            setRecordedVideoBlob(blob);
            setRecordedVideoUrl(url);
            setRecorderStep("review");
        } else {
            console.error("RecorderPage: CRITICAL - URL.createObjectURL did not return a valid blob string for review. Got:", url);
            setError("Failed to create a playable URL for the recorded video.");
            setRecordedVideoUrl(null); setRecordedVideoBlob(null);
            setRecorderStep("readyToRecord"); // Go back to a state where user can try again
        }
      };
      mediaRecorderRef.current.onerror = (event) => {
        const mediaRecorderError = (event as any)?.error;
        console.error("RecorderPage: MediaRecorder error:", mediaRecorderError);
        setError(`Recording error: ${mediaRecorderError?.name || 'Unknown MediaRecorder error'}.`);
        setRecorderStep("error");
        if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      };
      mediaRecorderRef.current.start(1000);
      console.log("RecorderPage: MediaRecorder.start(1000) called.");
    } catch (e) {
      console.error("RecorderPage: Recorder start failed:", e);
      setError(`Recorder start failed: ${e instanceof Error ? e.message : String(e)}.`);
      setRecorderStep("error");
    }
  };

  const stopRecording = () => {
    console.log("RecorderPage: stopRecording called.");
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop();
    } else {
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      clonedMediaStreamRef.current?.getTracks().forEach(track => track.stop());
      setRecorderStep("review"); // Or readyToRecord if no recording was made
    }
  };

  const formatTime = (totalSeconds: number): string => {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = Math.floor(totalSeconds % 60);
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  };

  const generateSingleThumbnail = useCallback(async (videoObjectUrl: string, timestamp: number): Promise<{ dataUrl: string; blob: Blob } | null> => {
    console.log(`RecorderPage: generateSingleThumbnail called for URL (first 40): ${videoObjectUrl.substring(0,40)} at ${timestamp}s`);
    return new Promise((resolve) => {
        const tempVideoElement = document.createElement('video');
        tempVideoElement.muted = true; tempVideoElement.crossOrigin = "anonymous";
        let resolved = false;
        const cleanupAndResolve = (result: { dataUrl: string; blob: Blob } | null) => {
            if (resolved) return; resolved = true; clearTimeout(timeoutId);
            tempVideoElement.removeEventListener('seeked', onSeeked);
            tempVideoElement.removeEventListener('error', onError);
            tempVideoElement.removeEventListener('loadedmetadata', onLoadedMetadata);
            tempVideoElement.src = ""; tempVideoElement.removeAttribute('src');
            try { tempVideoElement.load(); } catch (e) { /* ignore */ }
            tempVideoElement.remove();
            resolve(result);
        };
        const timeoutId = setTimeout(() => { console.warn("RecorderPage: generateSingleThumbnail - Timed out."); cleanupAndResolve(null); }, 8000);
        const onSeeked = () => {
            if (resolved) return;
            if (tempVideoElement.videoWidth <= 0 || tempVideoElement.videoHeight <= 0) { cleanupAndResolve(null); return; }
            const canvas = document.createElement('canvas');
            canvas.width = tempVideoElement.videoWidth; canvas.height = tempVideoElement.videoHeight;
            const ctx = canvas.getContext('2d');
            if (!ctx) { cleanupAndResolve(null); return; }
            try {
                ctx.drawImage(tempVideoElement, 0, 0, canvas.width, canvas.height);
                const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
                canvas.toBlob(blob => { (blob && blob.size > 0) ? cleanupAndResolve({ dataUrl, blob }) : cleanupAndResolve(null); }, 'image/jpeg', 0.85);
            } catch (drawError) { console.error("RecorderPage: DrawImage error:", drawError); cleanupAndResolve(null); }
        };
        const onError = (e: Event | string) => { console.error("RecorderPage: tempVideoElement error:", e); cleanupAndResolve(null); };
        const onLoadedMetadata = () => {
            if (resolved) return;
            const safeTimestamp = Math.max(0.01, Math.min(timestamp, (tempVideoElement.duration > 0 && Number.isFinite(tempVideoElement.duration)) ? tempVideoElement.duration - 0.01 : timestamp));
            tempVideoElement.currentTime = safeTimestamp;
        };
        tempVideoElement.addEventListener('loadedmetadata', onLoadedMetadata);
        tempVideoElement.addEventListener('seeked', onSeeked);
        tempVideoElement.addEventListener('error', onError);
        tempVideoElement.src = videoObjectUrl;
        tempVideoElement.load();
    });
  }, []);

  const handleCaptureThumbnail = useCallback(async () => {
    let currentTime = 0;
    if (playerRef.current && !useFallbackPlayer) {
      currentTime = playerRef.current.getCurrentTime();
    } else if (fallbackPlayerRef.current && useFallbackPlayer) {
      currentTime = fallbackPlayerRef.current.currentTime;
    } else if (!recordedVideoUrl){
      toast({ variant: "destructive", title: "Error", description: "No video available to capture thumbnail from."});
      return;
    }

    if (potentialThumbnails.length >= NUM_THUMBNAILS_TO_GENERATE) {
      toast({ variant: "default", title: "Limit Reached", description: `Max ${NUM_THUMBNAILS_TO_GENERATE} thumbnails.` });
      return;
    }
    setIsCapturingThumbnail(true);
    try {
      if (typeof currentTime !== 'number') {
         toast({ variant: "destructive", title: "Error", description: "Could not get video current time." });
         setIsCapturingThumbnail(false); return;
      }
      const result = await generateSingleThumbnail(recordedVideoUrl!, currentTime); // Non-null assertion as it's checked above
      if (result) {
        setPotentialThumbnails(prev => [...prev, result.dataUrl]);
        setPotentialThumbnailBlobs(prev => [...prev, result.blob]);
        if (selectedThumbnailIndex === null) setSelectedThumbnailIndex(potentialThumbnails.length);
        toast({ title: "Thumbnail Captured!", description: `At ${formatTime(currentTime)}.`});
      } else {
        toast({ variant: "destructive", title: "Capture Failed", description: "Could not capture thumbnail at this time." });
      }
    } catch (e) {
      toast({ variant: "destructive", title: "Capture Error", description: "An unexpected error occurred while capturing." });
    } finally { setIsCapturingThumbnail(false); }
  }, [recordedVideoUrl, generateSingleThumbnail, potentialThumbnails.length, selectedThumbnailIndex, toast, useFallbackPlayer]);

  const handleLocalSave = () => {
    if (!recordedVideoBlob) { toast({ variant: "destructive", title: "No Video to Save"}); return; }
    const urlToDownload = recordedVideoUrl || URL.createObjectURL(recordedVideoBlob);
    const a = document.createElement("a");
    a.href = urlToDownload;
    const safeTitle = title.replace(/[^a-z0-9_]+/gi, '_').toLowerCase() || 'recorded_video';
    const extension = getSupportedMimeType().split('/')[1]?.split(';')[0] || 'webm';
    a.download = `${safeTitle}_${Date.now()}.${extension}`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setIsLocallySaved(true);
    toast({ title: "Video Saved Locally", description: `Saved as ${a.download}.` });
  };

  const handleUploadToFirebase = useCallback(async () => {
    if (!user || !isAdmin || !recordedVideoBlob || selectedThumbnailIndex === null) {
      setError("Missing required data for upload."); return;
    }
    const thumbnailBlobToUpload = potentialThumbnailBlobs[selectedThumbnailIndex];
    if (!thumbnailBlobToUpload) { setError("Selected thumbnail data is missing."); return; }
    if (!title.trim()) { setError("Video title is required."); return; }

    setRecorderStep("uploading"); setUploadProgress(0); setUploadSuccess(false); setError(null);

    const videoId = uuidv4(); const timestamp = Date.now();
    const safeFileTitle = title.replace(/[^a-z0-9_.\-]+/gi, '_').toLowerCase() || videoId;
    const videoExtension = getSupportedMimeType().split('/')[1]?.split(';')[0] || 'webm';
    const videoFilename = `${safeFileTitle}_${timestamp}.${videoExtension}`;
    const thumbnailFilename = `thumb_${safeFileTitle}_${timestamp}.jpg`;
    const videoDirectoryPath = `videos/${user.uid}`;
    const thumbnailDirectoryPath = `thumbnails/${user.uid}`;

    try {
      console.log("[WebRecordAction:handleUploadToFirebase] Uploading video to Firebase Storage:", videoDirectoryPath, videoFilename);
      const uploadedVideoStoragePath = await uploadFileToStorage(videoDirectoryPath, recordedVideoBlob, videoFilename, (snapshot) => {
        setUploadProgress(Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 50));
      });
      const videoFirebaseUrl = await getFirebaseStorageDownloadUrl(uploadedVideoStoragePath);

      console.log("[WebRecordAction:handleUploadToFirebase] Uploading thumbnail to Firebase Storage:", thumbnailDirectoryPath, thumbnailFilename);
      const uploadedThumbnailStoragePath = await uploadFileToStorage(thumbnailDirectoryPath, thumbnailBlobToUpload, thumbnailFilename, (snapshot) => {
        setUploadProgress(Math.round(50 + (snapshot.bytesTransferred / snapshot.totalBytes) * 50));
      });
      const thumbnailFirebaseUrl = await getFirebaseStorageDownloadUrl(uploadedThumbnailStoragePath);

      const metadata: Omit<VideoMeta, 'createdAt' | 'comments'> & { comments?: VideoMeta['comments'] } = {
        id: videoId, doctorId: user.uid,
        doctorName: doctorProfile?.name || user.displayName || "Unknown Doctor",
        title, description, videoUrl: videoFirebaseUrl, thumbnailUrl: thumbnailFirebaseUrl,
        duration: formatTime(recordingDuration), recordingDuration,
        tags: keywords.split(',').map(k => k.trim()).filter(Boolean),
        viewCount: 0, likeCount: 0, commentCount: 0, featured: featured,
        permalink: `/videos/${videoId}`,
        storagePath: uploadedVideoStoragePath,
        thumbnailStoragePath: uploadedThumbnailStoragePath,
        videoSize: recordedVideoBlob.size, videoType: recordedVideoBlob.type || getSupportedMimeType(),
      };
      
      const result = await saveVideoMetadataAction(metadata as VideoMeta); // Cast as server action expects full VideoMeta potentially

      if (result.success) {
        toast({ title: "Upload Successful!", description: `Video "${title}" is now available.` });
        setUploadSuccess(true); setRecorderStep("success");
      } else { throw new Error(result.error || "Failed to save video metadata."); }
    } catch (uploadError: any) {
      console.error("RecorderPage: Upload or metadata save failed:", uploadError);
      setError(`Upload failed: ${uploadError.message}`);
      setRecorderStep("error");
    }
  }, [
    user, isAdmin, recordedVideoBlob, potentialThumbnailBlobs, selectedThumbnailIndex, title, description,
    recordingDuration, keywords, featured, doctorProfile, toast, getSupportedMimeType
  ]); // Removed setRecorderStep, was causing issues

  const proceedToMetadataAndUpload = () => {
    if (potentialThumbnails.filter(Boolean).length === 0) {
      toast({variant: "destructive", title: "No Thumbnails", description: "Please capture at least one thumbnail."});
      return;
    }
    if (selectedThumbnailIndex === null && potentialThumbnails.filter(Boolean).length > 0) {
      const firstValidIndex = potentialThumbnails.findIndex(t => t !== null);
      setSelectedThumbnailIndex(firstValidIndex);
    }
    setRecorderStep("metadata");
  };

  const resetEntirePage = () => {
    console.log("RecorderPage: resetEntirePage called");
    stopRecording(); // Ensures recorder and cloned streams are stopped

    mediaStreamRef.current?.getTracks().forEach(track => track.stop()); // Stop original camera stream
    mediaStreamRef.current = null;

    if (liveVideoPreviewRef.current) {
      liveVideoPreviewRef.current.srcObject = null; liveVideoPreviewRef.current.src = "";
    }
    if (recordedVideoUrl && recordedVideoUrl.startsWith('blob:')) URL.revokeObjectURL(recordedVideoUrl);
    setRecordedVideoUrl(null); setRecordedVideoBlob(null);
    potentialThumbnails.forEach((url) => { if (url && url.startsWith('blob:')) URL.revokeObjectURL(url); });
    setPotentialThumbnails([]); setPotentialThumbnailBlobs([]); setSelectedThumbnailIndex(null);
    setTitle(''); setDescription(''); setKeywords(''); setFeatured(false);
    setRecordingDuration(0); setError(null); setUploadProgress(0);
    setIsUploading(false); setIsLocallySaved(false);
    setHasCameraPermission(null); setUploadSuccess(false);
    setUseFallbackPlayer(false);
    setRecorderStep("initial"); // This will trigger re-request in main useEffect
  };

  // Derived states for UI rendering logic
  const isInitial = _recorderStep === "initial";
  const isSettingUp = _recorderStep === "settingUp";
  const hasPermissionDenied = _recorderStep === "permissionDenied";
  const isReadyToRecord = _recorderStep === "readyToRecord";
  const isCurrentlyRecording = _recorderStep === "recording";
  const isInReview = _recorderStep === "review";
  const isThumbnailsReady = _recorderStep === "thumbnailsReady";
  const isMetadataStep = _recorderStep === "metadata";
  const isCurrentlyUploading = _recorderStep === "uploading";
  const isSuccessStep = _recorderStep === "success";
  const isErrorStep = _recorderStep === "error";

  // Combined show conditions for clarity
  const showLiveFeedArea = isReadyToRecord || isCurrentlyRecording;
  const showReviewInterface = (isInReview || isThumbnailsReady || isMetadataStep) && !!recordedVideoUrl;
  const showThumbnailCaptureControls = isInReview && !!recordedVideoUrl;
  const showMetadataAndUploadSection = isMetadataStep && !!recordedVideoUrl;


  if (authLoading || (isInitial && !hasCameraPermission)) {
    return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-primary" /> <span className="ml-2">Initializing Recorder...</span></div>;
  }

  return (
    <div className="container mx-auto py-8">
    <Card className="w-full max-w-2xl mx-auto shadow-xl rounded-lg">
      <CardHeader>
        <CardTitle className="text-2xl font-headline flex items-center gap-2"><CameraIconLucide size={28}/> Web Video Recorder</CardTitle>
        <CardDescription>Record, review, capture thumbnails, add details, and upload.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {error && <Alert variant="destructive"><AlertCircle className="h-4 w-4" /> <AlertTitle>Error</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
        {uploadSuccess && <Alert variant="default" className="bg-green-100 border-green-400 text-green-700 dark:bg-green-900/30 dark:text-green-300"><CheckCircle className="h-4 w-4" /> <AlertTitle>Success!</AlertTitle><AlertDescription>Video uploaded. Record another or manage content.</AlertDescription></Alert>}

        {hasPermissionDenied && (
           <Alert variant="destructive" className="shadow-md">
            <AlertCircle className="h-4 w-4" /> <AlertTitle>Camera/Mic Access Denied</AlertTitle>
            <AlertDescription>Please enable permissions. <Button onClick={requestPermissionsAndSetup} variant="link" size="sm" className="p-0 h-auto text-destructive-foreground underline">Retry Permissions</Button></AlertDescription>
          </Alert>
        )}

        {/* Video Display Area */}
        <div className="relative aspect-video bg-slate-900 rounded-md overflow-hidden border border-border shadow-inner">
          {/* Native video element for live preview */}
          <video ref={liveVideoPreviewRef} playsInline autoPlay muted className={`w-full h-full object-contain ${showReviewInterface ? 'hidden' : 'block'}`} />

          {/* ReactPlayer for recorded video review (primary) */}
          {showReviewInterface && recordedVideoUrl && typeof recordedVideoUrl === 'string' && recordedVideoUrl.startsWith('blob:') && !useFallbackPlayer && (
            <ReactPlayer
              key={recordedVideoUrl} 
              ref={playerRef}
              url={recordedVideoUrl}
              controls
              width="100%"
              height="100%"
              playing={true}
              onError={(e: any, data?: any, hlsInstance?: any, hlsGlobal?: any) => {
                console.error("RecorderPage: ReactPlayer error during review:", e, data);
                const errorDetails = e?.type || (typeof e === 'string' ? e : 'Unknown ReactPlayer error');
                setError(`Error playing video with ReactPlayer: ${errorDetails}. Trying native player.`);
                setUseFallbackPlayer(true);
              }}
            />
          )}
          {/* Native HTML5 video element as fallback for review */}
          {showReviewInterface && recordedVideoUrl && typeof recordedVideoUrl === 'string' && recordedVideoUrl.startsWith('blob:') && useFallbackPlayer && (
             <video ref={fallbackPlayerRef} controls autoPlay playsInline width="100%" height="100%" className="object-contain">
                <source src={recordedVideoUrl} type={recordedVideoBlob?.type || getSupportedMimeType()} />
                Your browser does not support the video tag.
            </video>
          )}

          {isSettingUp &&
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/50 text-white"><Loader2 className="h-10 w-10 animate-spin mb-3"/> <p>Setting up camera...</p></div>
          }
        </div>

        {/* Controls Area */}
        <div className="space-y-3">
          {isReadyToRecord && !isCurrentlyRecording && !recordedVideoUrl && (
            <Button onClick={startRecording} className="w-full gap-2 text-lg py-3 bg-green-600 hover:bg-green-700">
              <Mic size={20} /> Start Recording
            </Button>
          )}

          {isCurrentlyRecording && (
            <div className="flex items-center justify-between p-3 bg-slate-800/80 rounded-lg text-white shadow-md">
              <div className="flex items-center gap-2"><Mic className="text-red-500 animate-pulse" /><span className="font-mono text-lg">{formatTime(recordingDuration)}</span></div>
              <Button onClick={stopRecording} variant="destructive" size="sm" className="gap-2"><Square size={16} /> Stop</Button>
            </div>
          )}
          {isSuccessStep && (
            <Button onClick={resetEntirePage} variant="outline" className="w-full gap-2"><RefreshCcw /> Record Another</Button>
          )}
        </div>

        {/* Thumbnail Capture Section */}
        {showThumbnailCaptureControls && (
             <div className="pt-4 border-t space-y-3">
              <h3 className="text-lg font-medium">Capture Thumbnails ({potentialThumbnails.length}/{NUM_THUMBNAILS_TO_GENERATE})</h3>
              <div className="flex flex-wrap gap-2">
                <Button onClick={handleCaptureThumbnail} disabled={isCapturingThumbnail || potentialThumbnails.length >= NUM_THUMBNAILS_TO_GENERATE || isCurrentlyUploading} variant="outline" className="gap-2">
                  {isCapturingThumbnail ? <Loader2 className="animate-spin"/> : <CameraIconLucide/>} Capture
                </Button>
                <Button onClick={proceedToMetadataAndUpload} variant="default" disabled={isCurrentlyUploading || potentialThumbnails.length === 0}>
                     Done Capturing / Enter Details <Play size={16} className="ml-1"/>
                </Button>
              </div>

              {potentialThumbnails.length > 0 && (
                <div className="pt-2">
                    <Label className="text-sm font-medium">Captured Previews (Click to select final)</Label>
                    <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 mt-1">
                        {potentialThumbnails.map((thumbUrl, index) => (
                           thumbUrl &&
                           <button key={index} type="button" onClick={() => setSelectedThumbnailIndex(index)}
                                className={`relative aspect-video rounded-md overflow-hidden border-2 transition-all hover:opacity-80
                                    ${selectedThumbnailIndex === index ? 'border-primary ring-2 ring-primary/50' : 'border-muted hover:border-primary/50'}`}>
                                <NextImage src={thumbUrl} alt={`Thumbnail ${index + 1}`} fill sizes="100px" className="object-cover" data-ai-hint="select thumbnail"/>
                                {selectedThumbnailIndex === index && <div className="absolute inset-0 bg-primary/60 flex items-center justify-center"><CheckCircle size={24} className="text-white"/></div>}
                            </button>
                        ))}
                    </div>
                </div>
              )}
            </div>
        )}

        {/* Metadata and Upload Section */}
        {showMetadataAndUploadSection && !isCurrentlyUploading && !isSuccessStep && (
            <form onSubmit={(e) => { e.preventDefault(); handleUploadToFirebase(); }} className="space-y-4 pt-6 border-t" id="web-video-upload-form">
                <h3 className="text-xl font-semibold font-headline">Video Details & Final Upload</h3>
                {selectedThumbnailIndex !== null && potentialThumbnails[selectedThumbnailIndex] ? (
                    <div>
                        <Label className="text-sm font-medium">Final Thumbnail</Label>
                        <div className="relative aspect-video w-48 rounded-md overflow-hidden border-2 border-primary mt-1">
                            <NextImage src={potentialThumbnails[selectedThumbnailIndex]!} alt="Selected Thumbnail" fill sizes="192px" className="object-cover" data-ai-hint="selected thumbnail"/>
                        </div>
                    </div>
                ) : ( <p className="text-sm text-destructive">Please select a thumbnail from the captured previews.</p> )}
                 {potentialThumbnails.length > 0 && selectedThumbnailIndex === null && ( <p className="text-xs text-destructive mt-1">No final thumbnail selected. Please click one above.</p> )}

                <div className="space-y-1"><Label htmlFor="title">Title <span className="text-destructive">*</span></Label><Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} required /></div>
                <div className="space-y-1"><Label htmlFor="description">Description</Label><Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} rows={3}/></div>
                <div className="space-y-1"><Label htmlFor="keywords">Keywords (comma-separated)</Label><Input id="keywords" value={keywords} onChange={(e) => setKeywords(e.target.value)} /></div>
                <div className="flex items-center space-x-2"><Checkbox id="featured" checked={featured} onCheckedChange={(checked) => setFeatured(Boolean(checked))} /><Label htmlFor="featured" className="font-normal text-sm">Feature this video</Label></div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                    <Button type="button" onClick={() => setRecorderStep("review")} variant="outline" className="w-full gap-2" disabled={isCurrentlyUploading}>
                        Back to Capture More
                    </Button>
                    <Button type="button" onClick={handleLocalSave} variant="outline" className="w-full gap-2"
                        disabled={isLocallySaved || isCurrentlyUploading || !recordedVideoBlob || !title.trim() || selectedThumbnailIndex === null || !potentialThumbnailBlobs[selectedThumbnailIndex!]}>
                        <Download /> {isLocallySaved ? "Saved Locally" : "Save to Device"}
                    </Button>
                    <Button type="submit" form="web-video-upload-form" className="w-full sm:col-span-2 gap-2 bg-primary hover:bg-primary/90"
                        disabled={isCurrentlyUploading || !recordedVideoBlob || !title.trim() || selectedThumbnailIndex === null || !potentialThumbnailBlobs[selectedThumbnailIndex!]}>
                        {isCurrentlyUploading ? <Loader2 className="animate-spin"/> : <UploadCloud />} Upload to App
                    </Button>
                </div>
            </form>
        )}

        {isCurrentlyUploading && (
            <div className="space-y-2 pt-4 border-t">
                <Label>Upload Progress</Label><Progress value={uploadProgress} className="w-full h-3" /><p className="text-sm text-center text-muted-foreground">{Math.round(uploadProgress)}%</p>
            </div>
        )}
      </CardContent>
      {(showReviewInterface || isSuccessStep || isErrorStep) && (
      <CardFooter className="pt-4 border-t">
         <Button onClick={resetEntirePage} variant="outline" className="w-full gap-2"><RefreshCcw /> Reset & Record New Video</Button>
      </CardFooter>
      )}
    </Card>
    </div>
  );
}

    