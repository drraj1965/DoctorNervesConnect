
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
import { Loader2, Video, Mic, Square, UploadCloud, AlertCircle, CheckCircle, CameraIcon as CameraIconLucide, RefreshCcw, Download, Image as ImageIconLucide, Sparkles, Play } from "lucide-react";
import { v4 as uuidv4 } from 'uuid';
import NextImage from 'next/image';
import { uploadFileToStorage, getFirebaseStorageDownloadUrl } from "@/lib/firebase/storage";
import { saveVideoMetadataAction } from "./actions";
import type { VideoMeta } from "@/types";
import { useToast } from '@/hooks/use-toast';
import ReactPlayer from "react-player";

const MAX_RECORDING_MINUTES = 30;
const NUM_THUMBNAILS_TO_GENERATE = 5;

export default function WebVideoRecorderPage() {
  const { user, doctorProfile, isAdmin, loading: authLoading } = useAuth();
  const router = useRouter();
  const { toast } = useToast();

  const videoRef = useRef<HTMLVideoElement | null>(null); // For live camera preview
  const playerRef = useRef<ReactPlayer | null>(null); // For ReactPlayer instance
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const clonedStreamForRecorderRef = useRef<MediaStream | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);

  const [isRecording, setIsRecording] = useState(false);
  const [recordedVideoBlob, setRecordedVideoBlob] = useState<Blob | null>(null);
  const [recordedVideoUrl, setRecordedVideoUrl] = useState<string | null>(null);

  const [recordingDuration, setRecordingDuration] = useState(0);
  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [hasCameraPermission, setHasCameraPermission] = useState<boolean | null>(null);

  const [potentialThumbnails, setPotentialThumbnails] = useState<(string | null)[]>([]);
  const [potentialThumbnailBlobs, setPotentialThumbnailBlobs] = useState<(Blob | null)[]>([]);
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

  const [showMetadataAndUploadSection, setShowMetadataAndUploadSection] = useState(false);


  // Initial setup effect
  useEffect(() => {
    console.log(`RecorderPage: Initial Mount Effect - authLoading: ${authLoading}, isAdmin: ${isAdmin}`);
    if (!authLoading && isAdmin) {
      if (hasCameraPermission === null) { // Only request if not already determined or explicitly denied
        console.log("RecorderPage: Initial Mount Effect - Calling requestPermissionsAndSetup.");
        requestPermissionsAndSetup();
      }
    } else if (!authLoading && !isAdmin) {
      toast({ variant: "destructive", title: "Access Denied", description: "You are not authorized to view this page." });
      router.replace("/dashboard");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, isAdmin, router]); // Removed requestPermissionsAndSetup to prevent loops

  // Cleanup effect
  useEffect(() => {
    console.log("RecorderPage: Unmount effect registered.");
    return () => {
      console.log("RecorderPage: UNMOUNTING - Cleaning up resources.");
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
        console.log("RecorderPage: UNMOUNT cleanup - Stopping active MediaRecorder.");
        mediaRecorderRef.current.stop();
      }
      mediaStreamRef.current?.getTracks().forEach(track => {
        console.log(`RecorderPage: UNMOUNT cleanup - Stopping original mediaStream track: ${track.kind} - ${track.label}`);
        track.stop();
      });
      clonedStreamForRecorderRef.current?.getTracks().forEach(track => {
        console.log(`RecorderPage: UNMOUNT cleanup - Stopping cloned mediaStream track: ${track.kind} - ${track.label}`);
        track.stop();
      });
      if (recordingTimerRef.current) {
        console.log("RecorderPage: UNMOUNT cleanup - Clearing recording timer.");
        clearInterval(recordingTimerRef.current);
      }
      if (recordedVideoUrl && recordedVideoUrl.startsWith('blob:')) {
        console.log("RecorderPage: UNMOUNT cleanup - Revoking recordedVideoUrl:", recordedVideoUrl.substring(0,40));
        URL.revokeObjectURL(recordedVideoUrl);
      }
      potentialThumbnails.forEach((url, index) => {
        if (url && url.startsWith('blob:')) {
          console.log(`RecorderPage: UNMOUNT cleanup - Revoking potentialThumbnail URL ${index}:`, url.substring(0,40));
          URL.revokeObjectURL(url);
        }
      });
      if(videoRef.current) {
          videoRef.current.srcObject = null;
          videoRef.current.src = "";
          console.log("RecorderPage: UNMOUNT cleanup - Cleared videoRef element.");
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Empty dependency array ensures this runs only on unmount

  const requestPermissionsAndSetup = useCallback(async () => {
    console.log("RecorderPage: requestPermissionsAndSetup called.");
    setError(null);
    setHasCameraPermission(null);

    // Stop any existing stream first
    mediaStreamRef.current?.getTracks().forEach(track => track.stop());
    mediaStreamRef.current = null;
    clonedStreamForRecorderRef.current?.getTracks().forEach(track => track.stop());
    clonedStreamForRecorderRef.current = null;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: { echoCancellation: true, noiseSuppression: true },
      });

      mediaStreamRef.current = stream; // Store the original stream
      setHasCameraPermission(true);
      console.log("RecorderPage: Permissions granted, stream acquired:", stream.id);

      if (videoRef.current) {
        videoRef.current.srcObject = stream; // Use original stream for live preview
        videoRef.current.onloadedmetadata = () => { // More reliable than oncanplay for dimensions
            console.log("RecorderPage: Live preview 'loadedmetadata'. Video dimensions:", videoRef.current?.videoWidth, "x", videoRef.current?.videoHeight);
        }
        videoRef.current.onerror = (e) => {
            console.error("RecorderPage: Video element error during live preview setup:", videoRef.current?.error, e);
            setError("Video element error. Please refresh or check permissions.");
            setHasCameraPermission(false);
        };
        // Autoplay is handled by the video tag's autoPlay prop
        await videoRef.current.play().catch(e => console.warn("Live preview play error on setup:", e));
      }
    } catch (err) {
      console.error("RecorderPage: Error in requestPermissionsAndSetup:", err);
      setError(`Camera/mic access failed: ${err instanceof Error ? err.message : String(err)}.`);
      setHasCameraPermission(false);
    }
  }, []);

  const getSupportedMimeType = () => {
    const types = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
    for (const type of types) { if (MediaRecorder.isTypeSupported(type)) return type; }
    return 'video/webm';
  };

  const startRecording = () => {
    console.log("RecorderPage: startRecording called.");
    if (!mediaStreamRef.current || !mediaStreamRef.current.active || !hasCameraPermission) {
      setError("Camera not ready or permission denied. Please refresh or re-enable permissions.");
      requestPermissionsAndSetup(); // Attempt to re-setup if not ready
      return;
    }

    if (videoRef.current && videoRef.current.srcObject !== mediaStreamRef.current) {
        console.log("RecorderPage: startRecording - Re-assigning live stream to videoRef for preview consistency.");
        videoRef.current.srcObject = mediaStreamRef.current;
        videoRef.current.play().catch(e=>console.warn("Error re-playing live preview for recording start:",e));
    }

    if (recordedVideoUrl) URL.revokeObjectURL(recordedVideoUrl);
    setRecordedVideoUrl(null); setRecordedVideoBlob(null);
    potentialThumbnails.forEach(url => { if (url && url.startsWith('blob:')) URL.revokeObjectURL(url); });
    setPotentialThumbnails([]); setPotentialThumbnailBlobs([]); setSelectedThumbnailIndex(null);
    recordedChunksRef.current = [];
    setIsLocallySaved(false); setShowMetadataAndUploadSection(false);
    setRecordingDuration(0); setError(null); setUploadSuccess(false);

    const mimeType = getSupportedMimeType();
    try {
      // Clone the stream for the recorder to allow the original to continue for preview
      // and to stop recorder tracks independently without affecting live preview.
      clonedStreamForRecorderRef.current = mediaStreamRef.current.clone();
      console.log("RecorderPage: Cloned mediaStream for recorder. Original stream ID:", mediaStreamRef.current.id, "Cloned stream ID:", clonedStreamForRecorderRef.current.id);

      mediaRecorderRef.current = new MediaRecorder(clonedStreamForRecorderRef.current, { mimeType });

      mediaRecorderRef.current.onstart = () => {
        console.log("RecorderPage: MediaRecorder onstart. Actual MIME type:", mediaRecorderRef.current?.mimeType);
        setIsRecording(true);
        if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
        setRecordingDuration(0);
        recordingTimerRef.current = setInterval(() => {
          setRecordingDuration(prev => prev + 1);
        }, 1000);
      };

      mediaRecorderRef.current.ondataavailable = (event) => {
        if (event.data.size > 0) {
          console.log("RecorderPage: MediaRecorder ondataavailable, chunk size:", event.data.size, "type:", event.data.type);
          recordedChunksRef.current.push(event.data);
        }
      };

      mediaRecorderRef.current.onstop = () => {
        console.log("RecorderPage: MediaRecorder onstop. Chunks collected:", recordedChunksRef.current.length);
        setIsRecording(false);
        if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);

        // Stop tracks on the CLONED stream now that recording is done.
        // The original mediaStreamRef (for live preview) remains untouched until a full reset or unmount.
        clonedStreamForRecorderRef.current?.getTracks().forEach(track => {
          console.log(`RecorderPage: Stopping track on cloned stream: ${track.kind} - ${track.label}`);
          track.stop();
        });
        clonedStreamForRecorderRef.current = null; // Release the cloned stream ref

        if (recordedChunksRef.current.length === 0) {
          setError("No video data recorded. Please try again."); return;
        }
        const blob = new Blob(recordedChunksRef.current, { type: mimeType });
        setRecordedVideoBlob(blob);
        const url = URL.createObjectURL(blob);
        setRecordedVideoUrl(url);
        console.log("RecorderPage: Recorded video blob created. Size:", blob.size, "Type:", blob.type, "URL:", url.substring(0,40));
        if (videoRef.current) videoRef.current.srcObject = null; // Detach live stream from native player for review
      };

      mediaRecorderRef.current.onerror = (event) => {
        const mediaRecorderError = (event as any)?.error;
        console.error("RecorderPage: MediaRecorder error:", mediaRecorderError);
        setError(`Recording error: ${mediaRecorderError?.name || 'Unknown MediaRecorder error'}. Message: ${mediaRecorderError?.message}`);
        setIsRecording(false);
        if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      };

      mediaRecorderRef.current.start(1000); // Collect data in 1-second chunks
      console.log("RecorderPage: MediaRecorder.start(1000) called with cloned stream.");
    } catch (e) {
      console.error("RecorderPage: Recorder start failed:", e);
      setError(`Recorder start failed: ${e instanceof Error ? e.message : String(e)}.`);
      setIsRecording(false);
    }
  };

  const stopRecording = () => {
    console.log("RecorderPage: stopRecording called.");
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      console.log("RecorderPage: MediaRecorder is recording, calling stop().");
      mediaRecorderRef.current.stop();
    } else {
      console.warn("RecorderPage: stopRecording called but MediaRecorder not in 'recording' state. Current state:", mediaRecorderRef.current?.state);
      // If it's not recording, ensure timer is cleared and state is consistent
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      setIsRecording(false); // Force recording state off
    }
  };

  const formatTime = (totalSeconds: number): string => {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = Math.floor(totalSeconds % 60);
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  };

  const generateSingleThumbnail = useCallback(async (videoObjectUrl: string, timestamp: number): Promise<{ dataUrl: string; blob: Blob } | null> => {
    console.log(`RecorderPage: generateSingleThumbnail called for URL: ${videoObjectUrl.substring(0,40)} at ${timestamp}s`);
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
            try { tempVideoElement.load(); } catch (e) { /* ignore load error on cleanup */ }
            tempVideoElement.remove();
            console.log(`RecorderPage: generateSingleThumbnail - resolving with: ${result ? 'success' : 'null'}`);
            resolve(result);
        };

        const timeoutId = setTimeout(() => {
            console.warn("RecorderPage: generateSingleThumbnail - Timed out after 8 seconds.");
            cleanupAndResolve(null);
        }, 8000);

        const onSeeked = () => {
            if (resolved) return;
            console.log("RecorderPage: generateSingleThumbnail - 'seeked' event. Video dimensions:", tempVideoElement.videoWidth, "x", tempVideoElement.videoHeight);
            if (tempVideoElement.videoWidth <= 0 || tempVideoElement.videoHeight <= 0) {
                console.warn("RecorderPage: generateSingleThumbnail - Video dimensions are zero after seek. Cannot capture.");
                cleanupAndResolve(null); return;
            }
            const canvas = document.createElement('canvas');
            canvas.width = tempVideoElement.videoWidth; canvas.height = tempVideoElement.videoHeight;
            const ctx = canvas.getContext('2d');
            if (!ctx) { console.error("RecorderPage: generateSingleThumbnail - Failed to get 2D context."); cleanupAndResolve(null); return; }
            try {
                ctx.drawImage(tempVideoElement, 0, 0, canvas.width, canvas.height);
                const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
                canvas.toBlob(blob => {
                    if (blob && blob.size > 0) {
                        cleanupAndResolve({ dataUrl, blob });
                    } else {
                        console.warn("RecorderPage: generateSingleThumbnail - Canvas toBlob resulted in null or empty blob.");
                        cleanupAndResolve(null);
                    }
                }, 'image/jpeg', 0.85);
            } catch (drawError) { console.error("RecorderPage: generateSingleThumbnail - Error drawing to canvas:", drawError); cleanupAndResolve(null); }
        };

        const onError = (e: Event) => {
            console.error("RecorderPage: generateSingleThumbnail - Error loading video for thumbnail:", tempVideoElement.error, e);
            cleanupAndResolve(null);
        };

        const onLoadedMetadata = () => {
            if (resolved) return;
            console.log("RecorderPage: generateSingleThumbnail - 'loadedmetadata' event. Video duration:", tempVideoElement.duration);
            const safeTimestamp = Math.max(0.01, Math.min(timestamp, (tempVideoElement.duration > 0 && Number.isFinite(tempVideoElement.duration)) ? tempVideoElement.duration - 0.01 : timestamp));
            console.log("RecorderPage: generateSingleThumbnail - Seeking to safe timestamp:", safeTimestamp);
            tempVideoElement.currentTime = safeTimestamp;
        };

        tempVideoElement.addEventListener('loadedmetadata', onLoadedMetadata);
        tempVideoElement.addEventListener('seeked', onSeeked);
        tempVideoElement.addEventListener('error', onError);
        tempVideoElement.src = videoObjectUrl;
        tempVideoElement.load(); // Start loading the video
    });
  }, []);

  const handleCaptureThumbnail = useCallback(async () => {
    if (!playerRef.current || !recordedVideoUrl || potentialThumbnails.length >= NUM_THUMBNAILS_TO_GENERATE) {
      if (potentialThumbnails.length >= NUM_THUMBNAILS_TO_GENERATE) {
        toast({ variant: "default", title: "Limit Reached", description: `Max ${NUM_THUMBNAILS_TO_GENERATE} thumbnails.` });
      }
      return;
    }
    setIsCapturingThumbnail(true);
    try {
      const currentTime = playerRef.current.getCurrentTime();
      if (typeof currentTime !== 'number') {
         toast({ variant: "destructive", title: "Error", description: "Could not get video current time." });
         setIsCapturingThumbnail(false); return;
      }
      const result = await generateSingleThumbnail(recordedVideoUrl, currentTime);
      if (result) {
        setPotentialThumbnails(prev => [...prev, result.dataUrl]);
        setPotentialThumbnailBlobs(prev => [...prev, result.blob]);
        if (selectedThumbnailIndex === null) setSelectedThumbnailIndex(potentialThumbnails.length); // potentialThumbnails.length is before adding new one
        toast({ title: "Thumbnail Captured!", description: `At ${formatTime(currentTime)}.`});
      } else {
        toast({ variant: "destructive", title: "Capture Failed", description: "Could not capture thumbnail at this time." });
      }
    } catch (e) {
      toast({ variant: "destructive", title: "Capture Error", description: "An unexpected error occurred while capturing." });
    } finally { setIsCapturingThumbnail(false); }
  }, [recordedVideoUrl, generateSingleThumbnail, potentialThumbnails.length, selectedThumbnailIndex, toast]);


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
    console.log("RecorderPage: handleUploadToFirebase initiated.");
    if (!user || !isAdmin || !recordedVideoBlob || selectedThumbnailIndex === null) {
      setError("Missing required data: User, admin status, video, or thumbnail selection.");
      console.error("RecorderPage: Upload validation failed. User:", !!user, "Admin:", isAdmin, "Blob:", !!recordedVideoBlob, "Thumb Index:", selectedThumbnailIndex);
      return;
    }
    const thumbnailBlobToUpload = potentialThumbnailBlobs[selectedThumbnailIndex];
    if (!thumbnailBlobToUpload) { setError("Selected thumbnail data is missing."); console.error("RecorderPage: Selected thumbnail blob is missing."); return; }
    if (!title.trim()) { setError("Video title is required."); console.error("RecorderPage: Video title is missing."); return; }

    setIsUploading(true); setUploadProgress(0); setUploadSuccess(false);

    const videoId = uuidv4(); const timestamp = Date.now();
    const safeFileTitle = title.replace(/[^a-z0-9_.\-]+/gi, '_').toLowerCase() || videoId;
    const videoExtension = getSupportedMimeType().split('/')[1]?.split(';')[0] || 'webm';
    const videoFilename = `${safeFileTitle}_${timestamp}.${videoExtension}`;
    const thumbnailFilename = `thumb_${safeFileTitle}_${timestamp}.jpg`;

    const videoDirectoryPath = `videos/${user.uid}`;
    const thumbnailDirectoryPath = `thumbnails/${user.uid}`;

    console.log(`RecorderPage: Preparing to upload video. Dir: ${videoDirectoryPath}, File: ${videoFilename}`);
    console.log(`RecorderPage: Preparing to upload thumbnail. Dir: ${thumbnailDirectoryPath}, File: ${thumbnailFilename}`);

    try {
      const uploadedVideoStoragePath = await uploadFileToStorage(videoDirectoryPath, recordedVideoBlob, videoFilename, (snapshot) => {
        setUploadProgress(Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 50));
      });
      const videoFirebaseUrl = await getFirebaseStorageDownloadUrl(uploadedVideoStoragePath);
      console.log("RecorderPage: Video uploaded successfully. Path:", uploadedVideoStoragePath, "URL:", videoFirebaseUrl.substring(0,50) + "...");

      const uploadedThumbnailStoragePath = await uploadFileToStorage(thumbnailDirectoryPath, thumbnailBlobToUpload, thumbnailFilename, (snapshot) => {
        setUploadProgress(Math.round(50 + (snapshot.bytesTransferred / snapshot.totalBytes) * 50));
      });
      const thumbnailFirebaseUrl = await getFirebaseStorageDownloadUrl(uploadedThumbnailStoragePath);
      console.log("RecorderPage: Thumbnail uploaded successfully. Path:", uploadedThumbnailStoragePath, "URL:", thumbnailFirebaseUrl.substring(0,50) + "...");

      const metadata: VideoMeta = {
        id: videoId, doctorId: user.uid,
        doctorName: doctorProfile?.name || user.displayName || "Unknown Doctor",
        title, description, videoUrl: videoFirebaseUrl, thumbnailUrl: thumbnailFirebaseUrl,
        duration: formatTime(recordingDuration), recordingDuration,
        tags: keywords.split(',').map(k => k.trim()).filter(Boolean),
        // createdAt will be set by server action
        viewCount: 0, likeCount: 0, commentCount: 0, featured: featured,
        permalink: `/videos/${videoId}`,
        storagePath: uploadedVideoStoragePath,
        thumbnailStoragePath: uploadedThumbnailStoragePath,
        videoSize: recordedVideoBlob.size, videoType: recordedVideoBlob.type || getSupportedMimeType(), comments: [],
      };
      console.log("RecorderPage: Metadata object for server action:", JSON.stringify(metadata, null, 2));

      const result = await saveVideoMetadataAction(metadata);
      console.log("RecorderPage: saveVideoMetadataAction result:", result);


      if (result.success) { // Only check for success
        toast({ title: "Upload Successful!", description: `Video "${title}" is now available.` });
        setUploadSuccess(true);
      } else {
        throw new Error(result.error || "Failed to save video metadata.");
      }
    } catch (uploadError: any) {
      console.error("RecorderPage: Upload or metadata save failed:", uploadError);
      setError(`Upload failed: ${uploadError.message}`);
    } finally {
      setIsUploading(false);
      console.log("RecorderPage: handleUploadToFirebase finished.");
    }
  }, [
    user, isAdmin, recordedVideoBlob, potentialThumbnailBlobs, selectedThumbnailIndex, title, description,
    recordingDuration, keywords, featured, doctorProfile, toast, getSupportedMimeType
  ]);

  const proceedToMetadataAndUpload = () => {
    if (potentialThumbnails.filter(Boolean).length === 0) {
      toast({variant: "destructive", title: "No Thumbnails", description: "Please capture at least one thumbnail before proceeding."});
      return;
    }
    // Ensure a thumbnail is selected if some are available
    if (selectedThumbnailIndex === null && potentialThumbnails.filter(Boolean).length > 0) {
      setSelectedThumbnailIndex(potentialThumbnails.findIndex(t => t !== null));
    }
    setShowMetadataAndUploadSection(true);
  };

  const resetEntirePage = () => {
    console.log("RecorderPage: resetEntirePage called.");
    stopRecording(); // Ensure recorder is stopped

    mediaStreamRef.current?.getTracks().forEach(track => track.stop());
    mediaStreamRef.current = null;
    clonedStreamForRecorderRef.current?.getTracks().forEach(track => track.stop());
    clonedStreamForRecorderRef.current = null;

    if (videoRef.current) {
      videoRef.current.srcObject = null; videoRef.current.src = "";
    }
    if (recordedVideoUrl && recordedVideoUrl.startsWith('blob:')) URL.revokeObjectURL(recordedVideoUrl);
    setRecordedVideoUrl(null); setRecordedVideoBlob(null);

    potentialThumbnails.forEach(url => { if (url && url.startsWith('blob:')) URL.revokeObjectURL(url); });
    setPotentialThumbnails([]); setPotentialThumbnailBlobs([]); setSelectedThumbnailIndex(null);

    setTitle(''); setDescription(''); setKeywords('');
    setFeatured(false); setRecordingDuration(0); setError(null); setUploadProgress(0);
    setIsUploading(false); setIsLocallySaved(false);
    setHasCameraPermission(null); // This will trigger re-request in useEffect
    setUploadSuccess(false);
    setShowMetadataAndUploadSection(false);
    setIsRecording(false); // Ensure this is reset

    // Let the useEffect for initial setup handle re-requesting permissions
    // requestPermissionsAndSetup(); -- not needed due to useEffect watching hasCameraPermission
    console.log("RecorderPage: resetEntirePage completed.");
  };

  // UI Rendering Flags
  const showLiveFeedArea = !isRecording && !recordedVideoUrl && hasCameraPermission;
  const showRecordingInterface = isRecording;
  const showReviewInterface = !isRecording && recordedVideoUrl;

  if (authLoading && hasCameraPermission === null) {
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

        {hasCameraPermission === false && (
           <Alert variant="destructive" className="shadow-md">
            <AlertCircle className="h-4 w-4" /> <AlertTitle>Camera/Mic Access Denied</AlertTitle>
            <AlertDescription>Please enable permissions. <Button onClick={requestPermissionsAndSetup} variant="link" size="sm" className="p-0 h-auto text-destructive-foreground underline">Retry</Button></AlertDescription>
          </Alert>
        )}

        {/* Video Display Area */}
        <div className="relative aspect-video bg-slate-900 rounded-md overflow-hidden border border-border shadow-inner">
          {/* Native video element for live preview */}
          <video ref={videoRef} playsInline autoPlay muted className={`w-full h-full object-contain ${(showLiveFeedArea || showRecordingInterface) ? 'block' : 'hidden'}`} />

          {/* ReactPlayer for recorded video review */}
          {showReviewInterface && recordedVideoUrl && (
            <ReactPlayer
              ref={playerRef}
              url={recordedVideoUrl}
              controls
              width="100%"
              height="100%"
              playing={true} // Autoplay review
              onError={(e: any) => {
                console.error("RecorderPage: ReactPlayer error during review:", e);
                setError(`Error playing recorded video for review. Type: ${e?.type}. Details: ${e?.message || JSON.stringify(e?.target?.error) || 'Unknown ReactPlayer error'}.`);
              }}
            />
          )}
          {hasCameraPermission === null && !error && !authLoading &&
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/50 text-white"><Loader2 className="h-10 w-10 animate-spin mb-3"/> <p>Setting up camera...</p></div>
          }
        </div>

        {/* Controls Area */}
        <div className="space-y-3">
          {hasCameraPermission && !isRecording && !recordedVideoUrl && (
            <Button onClick={startRecording} className="w-full gap-2 text-lg py-3 bg-green-600 hover:bg-green-700">
              <Mic size={20} /> Start Recording
            </Button>
          )}

          {isRecording && (
            <div className="flex items-center justify-between p-3 bg-slate-800/80 rounded-lg text-white shadow-md">
              <div className="flex items-center gap-2"><Mic className="text-red-500 animate-pulse" /><span className="font-mono text-lg">{formatTime(recordingDuration)}</span></div>
              <Button onClick={stopRecording} variant="destructive" size="sm" className="gap-2"><Square size={16} /> Stop</Button>
            </div>
          )}
          {uploadSuccess && (
            <Button onClick={resetEntirePage} variant="outline" className="w-full gap-2"><RefreshCcw /> Record Another</Button>
          )}
        </div>

        {/* Thumbnail Capture Section - visible when reviewing, before final metadata form */}
        {showReviewInterface && !showMetadataAndUploadSection && (
             <div className="pt-4 border-t space-y-3">
              <h3 className="text-lg font-medium">Capture Thumbnails ({potentialThumbnails.filter(Boolean).length}/{NUM_THUMBNAILS_TO_GENERATE})</h3>
              <div className="flex flex-wrap gap-2">
                <Button onClick={handleCaptureThumbnail} disabled={isCapturingThumbnail || potentialThumbnails.filter(Boolean).length >= NUM_THUMBNAILS_TO_GENERATE || isUploading} variant="outline" className="gap-2">
                  {isCapturingThumbnail ? <Loader2 className="animate-spin"/> : <CameraIconLucide/>} Capture
                </Button>
                <Button onClick={proceedToMetadataAndUpload} variant="default" disabled={isUploading || potentialThumbnails.filter(Boolean).length === 0}>
                     Done Capturing / Enter Details <Play size={16} className="ml-1"/>
                </Button>
              </div>

              {potentialThumbnails.filter(Boolean).length > 0 && (
                <div className="pt-2">
                    <Label className="text-sm font-medium">Captured Previews</Label>
                    <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 mt-1">
                        {potentialThumbnails.map((thumbUrl, index) => (
                        thumbUrl ? (
                            <div key={index} className="relative aspect-video rounded-md overflow-hidden border-2 border-muted">
                                <NextImage src={thumbUrl} alt={`Thumbnail ${index + 1}`} fill sizes="100px" className="object-cover" data-ai-hint="video preview"/>
                            </div>
                        ) : null
                        ))}
                    </div>
                </div>
              )}
            </div>
        )}

        {/* Metadata and Upload Section - visible after "Done Capturing" or directly if review skipped by logic */}
        {showReviewInterface && showMetadataAndUploadSection && !isUploading && !uploadSuccess && (
            <form onSubmit={(e) => { e.preventDefault(); handleUploadToFirebase(); }} className="space-y-4 pt-6 border-t" id="web-video-upload-form">
                <h3 className="text-xl font-semibold font-headline">Video Details & Final Upload</h3>
                {potentialThumbnails.filter(Boolean).length > 0 && (
                    <div className="pt-2">
                        <Label className="text-sm font-medium">Select Final Thumbnail <span className="text-destructive">*</span></Label>
                        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 mt-1">
                            {potentialThumbnails.map((thumbUrl, index) => (
                            thumbUrl ? (
                                <button key={index} type="button" onClick={() => setSelectedThumbnailIndex(index)}
                                className={`relative aspect-video rounded-md overflow-hidden border-2 transition-all hover:opacity-80
                                    ${selectedThumbnailIndex === index ? 'border-primary ring-2 ring-primary/50' : 'border-muted hover:border-primary/50'}`}>
                                <NextImage src={thumbUrl} alt={`Thumbnail ${index + 1}`} fill sizes="100px" className="object-cover" data-ai-hint="video thumbnail"/>
                                {selectedThumbnailIndex === index && <div className="absolute inset-0 bg-primary/60 flex items-center justify-center"><CheckCircle size={24} className="text-white"/></div>}
                                </button>
                            ) : null
                            ))}
                        </div>
                        {selectedThumbnailIndex === null && <p className="text-xs text-destructive mt-1">Please select a final thumbnail.</p>}
                    </div>
                )}
                <div className="space-y-1"><Label htmlFor="title">Title <span className="text-destructive">*</span></Label><Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} required /></div>
                <div className="space-y-1"><Label htmlFor="description">Description</Label><Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} rows={3}/></div>
                <div className="space-y-1"><Label htmlFor="keywords">Keywords (comma-separated)</Label><Input id="keywords" value={keywords} onChange={(e) => setKeywords(e.target.value)} /></div>
                <div className="flex items-center space-x-2"><Checkbox id="featured" checked={featured} onCheckedChange={(checked) => setFeatured(Boolean(checked))} /><Label htmlFor="featured" className="font-normal text-sm">Feature this video</Label></div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                    <Button type="button" onClick={() => setShowMetadataAndUploadSection(false)} variant="outline" className="w-full gap-2" disabled={isUploading}>
                        Back to Capture More
                    </Button>
                    <Button type="button" onClick={handleLocalSave} variant="outline" className="w-full gap-2"
                        disabled={isLocallySaved || isUploading || !recordedVideoBlob || !title.trim() || selectedThumbnailIndex === null}>
                        <Download /> {isLocallySaved ? "Saved Locally" : "Save to Device"}
                    </Button>
                    <Button type="submit" form="web-video-upload-form" className="w-full sm:col-span-2 gap-2 bg-primary hover:bg-primary/90"
                        disabled={isUploading || !recordedVideoBlob || !title.trim() || selectedThumbnailIndex === null || !potentialThumbnailBlobs[selectedThumbnailIndex!]}>
                        {isUploading ? <Loader2 className="animate-spin"/> : <UploadCloud />} Upload to App
                    </Button>
                </div>
            </form>
        )}

        {isUploading && (
            <div className="space-y-2 pt-4 border-t">
                <Label>Upload Progress</Label><Progress value={uploadProgress} className="w-full h-3" /><p className="text-sm text-center text-muted-foreground">{Math.round(uploadProgress)}%</p>
            </div>
        )}
      </CardContent>
      {((showReviewInterface && !isUploading) || uploadSuccess) && (
      <CardFooter className="pt-4 border-t">
         <Button onClick={resetEntirePage} variant="outline" className="w-full gap-2"><RefreshCcw /> Reset Recorder & Camera</Button>
      </CardFooter>
      )}
    </Card>
    </div>
  );
}
