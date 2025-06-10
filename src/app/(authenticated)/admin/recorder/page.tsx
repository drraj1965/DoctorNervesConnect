
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
import { Loader2, Video, Mic, Square, UploadCloud, AlertCircle, CheckCircle, CameraIcon, RefreshCcw, Download, Image as ImageIcon, Sparkles } from "lucide-react";
import ReactPlayer from 'react-player/lazy';
import { v4 as uuidv4 } from 'uuid';
import NextImage from 'next/image';
import { uploadFileToStorage, getFirebaseStorageDownloadUrl } from "@/lib/firebase/storage";
import { saveVideoMetadataAction } from "./actions";
import type { VideoMeta } from "@/types";
import { useToast } from '@/hooks/use-toast';

const MAX_RECORDING_MINUTES = 30; // Example, can be adjusted
const NUM_THUMBNAILS_TO_GENERATE = 5;

export default function WebVideoRecorderPage() {
  const { user, doctorProfile, isAdmin, loading: authLoading } = useAuth();
  const router = useRouter();
  const { toast } = useToast();

  const videoRef = useRef<HTMLVideoElement | null>(null); // For live preview
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const playerRef = useRef<ReactPlayer | null>(null); // For ReactPlayer review

  const [isRecording, setIsRecording] = useState(false);
  const [recordedVideoBlob, setRecordedVideoBlob] = useState<Blob | null>(null);
  const [recordedVideoUrl, setRecordedVideoUrl] = useState<string | null>(null); // Blob URL for ReactPlayer
  const [recordingDuration, setRecordingDuration] = useState(0);
  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);
  
  const mediaStreamRef = useRef<MediaStream | null>(null); // Stores the active camera stream
  const recordedChunksRef = useRef<Blob[]>([]);

  // Metadata and Thumbnail State
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [keywords, setKeywords] = useState('');
  const [featured, setFeatured] = useState(false);
  const [potentialThumbnails, setPotentialThumbnails] = useState<(string | null)[]>([]);
  const [potentialThumbnailBlobs, setPotentialThumbnailBlobs] = useState<(Blob | null)[]>([]);
  const [selectedThumbnailIndex, setSelectedThumbnailIndex] = useState<number | null>(null);
  const [isCapturingThumbnail, setIsCapturingThumbnail] = useState(false);
  
  // UI State
  const [error, setError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [isLocallySaved, setIsLocallySaved] = useState(false);
  const [hasCameraPermission, setHasCameraPermission] = useState<boolean | null>(null);
  const [uiStep, setUiStep] = useState<"initial" | "ready" | "recording" | "review" | "uploading" | "success">("initial");


  // Effect for initial auth check and permission request
  useEffect(() => {
    console.log("RecorderPage: Auth/Mount Effect - authLoading:", authLoading, "isAdmin:", isAdmin);
    if (!authLoading) {
      if (!isAdmin) {
        toast({ variant: "destructive", title: "Access Denied", description: "You are not authorized." });
        router.replace("/dashboard");
        return;
      }
      if (uiStep === "initial" && hasCameraPermission !== false) { // Avoid re-requesting if denied explicitly
        console.log("RecorderPage: Auth/Mount Effect - Requesting permissions.");
        requestPermissionsAndSetup();
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, isAdmin, router, toast]); // uiStep removed to prevent loop on permission denial


  // Master cleanup effect for component unmount
  useEffect(() => {
    const stream = mediaStreamRef.current;
    const recUrl = recordedVideoUrl;
    const thumbs = [...potentialThumbnails];
    const timer = recordingTimerRef.current;

    return () => {
      console.log("RecorderPage: UNMOUNTING - Cleaning up resources.");
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
        mediaRecorderRef.current.stop();
        console.log("RecorderPage: UNMOUNT - Stopped active MediaRecorder.");
      }
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
        console.log("RecorderPage: UNMOUNT - Stopped MediaStream tracks.");
      }
      mediaStreamRef.current = null;
      if (recUrl && recUrl.startsWith('blob:')) URL.revokeObjectURL(recUrl);
      thumbs.forEach(tUrl => { if (tUrl && tUrl.startsWith('blob:')) URL.revokeObjectURL(tUrl); });
      if (timer) clearInterval(timer);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Runs only on unmount

  const requestPermissionsAndSetup = useCallback(async () => {
    console.log("RecorderPage: requestPermissionsAndSetup invoked.");
    setError(null);
    setHasCameraPermission(null);
    setUiStep("initial");


    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
      console.log("RecorderPage: Cleaned up previous media stream.");
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      
      mediaStreamRef.current = stream;
      setHasCameraPermission(true);
      setUiStep("ready");
      console.log("RecorderPage: Permissions granted, stream acquired. UI step: ready.");

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onerror = (e) => {
            console.error("RecorderPage: Native video element error during live preview setup:", videoRef.current?.error, e);
            setError("Live preview error. Please refresh or check camera permissions.");
            setHasCameraPermission(false);
            setUiStep("initial"); // Revert to initial if preview fails
        };
      }
    } catch (err) {
      console.error("RecorderPage: Error in requestPermissionsAndSetup:", err);
      setError(`Camera/mic access failed: ${err instanceof Error ? err.message : String(err)}.`);
      setHasCameraPermission(false);
      setUiStep("initial"); // Stay or revert to initial
    }
  }, []);

  const getSupportedMimeType = () => {
    const types = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
    for (const type of types) { if (MediaRecorder.isTypeSupported(type)) return type; }
    return 'video/webm';
  };

  const startRecording = () => {
    if (!mediaStreamRef.current || !mediaStreamRef.current.active || hasCameraPermission !== true) {
      setError("Camera not ready or permission denied. Please allow camera access.");
      requestPermissionsAndSetup(); // Attempt to re-initialize
      return;
    }
    console.log("RecorderPage: Starting recording...");
    if (videoRef.current) { // Ensure live preview is active
        videoRef.current.srcObject = mediaStreamRef.current;
        videoRef.current.play().catch(e=>console.warn("Error playing live preview on record start:",e));
    }

    recordedChunksRef.current = [];
    setRecordedVideoBlob(null);
    if (recordedVideoUrl) URL.revokeObjectURL(recordedVideoUrl); setRecordedVideoUrl(null);
    potentialThumbnails.forEach(url => { if (url) URL.revokeObjectURL(url); });
    setPotentialThumbnails([]); setPotentialThumbnailBlobs([]);
    setSelectedThumbnailIndex(null); setIsLocallySaved(false);
    setRecordingDuration(0); setError(null); setUiStep("recording");

    const mimeType = getSupportedMimeType();
    try {
      mediaRecorderRef.current = new MediaRecorder(mediaStreamRef.current, { mimeType });
      mediaRecorderRef.current.ondataavailable = (event) => {
        if (event.data.size > 0) recordedChunksRef.current.push(event.data);
      };
      mediaRecorderRef.current.onstop = () => {
        console.log("RecorderPage: MediaRecorder.onstop triggered.");
        if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
        if (recordedChunksRef.current.length === 0) {
          setError("No video data was recorded. Please try again.");
          setIsRecording(false); setUiStep("ready"); return;
        }
        const blob = new Blob(recordedChunksRef.current, { type: mimeType });
        console.log("RecorderPage: Recorded blob created. Size:", blob.size, "Type:", blob.type);
        setRecordedVideoBlob(blob);
        const url = URL.createObjectURL(blob);
        setRecordedVideoUrl(url);
        setIsRecording(false); setUiStep("review");
        if(videoRef.current) videoRef.current.srcObject = null; // Detach live stream from native player
      };
      mediaRecorderRef.current.onerror = (event) => {
        console.error("RecorderPage: MediaRecorder error:", event);
        setError(`Recording error: ${(event as any)?.error?.name || 'Unknown MediaRecorder error'}`);
        if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
        setIsRecording(false); setUiStep("ready");
      };

      mediaRecorderRef.current.start(1000); // timeslice
      setIsRecording(true); // Reflects MediaRecorder state
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = setInterval(() => setRecordingDuration(prev => prev + 1), 1000);
      console.log("RecorderPage: MediaRecorder started. UI step: recording.");
    } catch (e) {
      console.error("RecorderPage: Failed to init/start MediaRecorder:", e);
      setError(`Recorder start failed: ${e instanceof Error ? e.message : String(e)}.`);
      setIsRecording(false); setUiStep("ready");
    }
  };

  const stopRecording = () => {
    console.log("RecorderPage: stopRecording called.");
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop(); // This will trigger onstop
    } else {
      console.warn("RecorderPage: stopRecording called but MediaRecorder not in recording state.");
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      setIsRecording(false); // Ensure state consistency
      if (uiStep === "recording") setUiStep("ready");
    }
  };

  const formatTime = (totalSeconds: number): string => {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = Math.floor(totalSeconds % 60);
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  };

  const generateSingleThumbnail = useCallback(async (videoObjectUrl: string, timestamp: number): Promise<{ dataUrl: string; blob: Blob } | null> => {
    console.log(`RecorderPage: generateSingleThumbnail called for URL (first 30char): ${videoObjectUrl.substring(0,30)} at time: ${timestamp}`);
    return new Promise((resolve) => {
        const tempVideoElement = document.createElement('video');
        tempVideoElement.muted = true; tempVideoElement.crossOrigin = "anonymous";
        let resolved = false;
        const cleanupAndResolve = (result: { dataUrl: string; blob: Blob } | null) => {
            if (resolved) return; resolved = true; clearTimeout(timeoutId);
            tempVideoElement.removeEventListener('seeked', onSeeked); tempVideoElement.removeEventListener('error', onError);
            tempVideoElement.removeEventListener('loadedmetadata', onLoadedMetadata);
            tempVideoElement.removeAttribute('src'); tempVideoElement.load(); // Ensure resources are released
            tempVideoElement.remove();
            console.log(`RecorderPage: generateSingleThumbnail resolved with: ${result ? 'success' : 'failure'}`);
            resolve(result);
        };
        const timeoutId = setTimeout(() => {console.warn("Thumbnail gen timeout"); cleanupAndResolve(null);}, 8000); // Increased timeout
        
        const onSeeked = () => {
            if (resolved) return;
            console.log("ThumbnailGen: Video seeked to", tempVideoElement.currentTime);
            if (tempVideoElement.videoWidth <= 0 || tempVideoElement.videoHeight <= 0) {
                console.warn("ThumbnailGen: Video dimensions 0 at draw time.");
                cleanupAndResolve(null); return;
            }
            const canvas = document.createElement('canvas');
            canvas.width = tempVideoElement.videoWidth; canvas.height = tempVideoElement.videoHeight;
            const ctx = canvas.getContext('2d');
            if (!ctx) { console.error("ThumbnailGen: Failed to get 2D context."); cleanupAndResolve(null); return; }
            try {
                ctx.drawImage(tempVideoElement, 0, 0, canvas.width, canvas.height);
                const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
                canvas.toBlob(blob => { 
                    if (blob && blob.size > 0) { console.log("ThumbnailGen: Blob created, size:", blob.size); cleanupAndResolve({ dataUrl, blob }); } 
                    else { console.warn("ThumbnailGen: Canvas toBlob resulted in null/empty blob."); cleanupAndResolve(null); }
                }, 'image/jpeg', 0.85);
            } catch (drawError) { console.error("ThumbnailGen: Error drawing image or getting blob:", drawError); cleanupAndResolve(null); }
        };
        const onError = (e: Event) => { console.error("ThumbnailGen: Video element error:", tempVideoElement.error, e); cleanupAndResolve(null); };
        const onLoadedMetadata = () => {
            console.log("ThumbnailGen: Metadata loaded. Duration:", tempVideoElement.duration, "Seeking to:", timestamp);
            const safeTimestamp = Math.max(0.01, Math.min(timestamp, (tempVideoElement.duration > 0 && Number.isFinite(tempVideoElement.duration)) ? tempVideoElement.duration - 0.01 : timestamp));
            tempVideoElement.currentTime = safeTimestamp;
        };
        
        tempVideoElement.addEventListener('loadedmetadata', onLoadedMetadata);
        tempVideoElement.addEventListener('seeked', onSeeked);
        tempVideoElement.addEventListener('error', onError);
        tempVideoElement.src = videoObjectUrl; 
        console.log("ThumbnailGen: Setting src and calling load on temp video element.");
        tempVideoElement.load(); // Important for some browsers
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
      console.log(`RecorderPage: Capturing thumbnail at ${currentTime}s from ${recordedVideoUrl.substring(0,30)}...`);
      const result = await generateSingleThumbnail(recordedVideoUrl, currentTime);
      if (result) {
        setPotentialThumbnails(prev => [...prev, result.dataUrl]);
        setPotentialThumbnailBlobs(prev => [...prev, result.blob]);
        if (selectedThumbnailIndex === null) setSelectedThumbnailIndex(potentialThumbnails.length); 
        toast({ title: "Thumbnail Captured!", description: `At ${formatTime(currentTime)}.`});
      } else {
        toast({ variant: "destructive", title: "Capture Failed", description: "Could not capture thumbnail at this time." });
      }
    } catch (e) { 
      console.error("Error during handleCaptureThumbnail:", e);
      toast({ variant: "destructive", title: "Capture Error", description: "An unexpected error occurred while capturing." });
    } finally { setIsCapturingThumbnail(false); }
  }, [recordedVideoUrl, generateSingleThumbnail, potentialThumbnails.length, selectedThumbnailIndex, toast]);

  const handleLocalSave = () => {
    if (!recordedVideoBlob) { toast({ variant: "destructive", title: "No Video to Save"}); return; }
    const urlToDownload = recordedVideoUrl || URL.createObjectURL(recordedVideoBlob); // Fallback, should not be needed
    const a = document.createElement("a"); 
    a.href = urlToDownload;
    const safeTitle = title.replace(/[^a-z0-9_]+/gi, '_').toLowerCase() || 'recorded_video';
    const extension = getSupportedMimeType().split('/')[1]?.split(';')[0] || 'webm';
    a.download = `${safeTitle}_${Date.now()}.${extension}`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    // If recordedVideoUrl was used and it's a blob URL, we don't revoke it here as ReactPlayer might still be using it.
    // The main unmount cleanup or resetEntirePage will handle revocation.
    setIsLocallySaved(true);
    toast({ title: "Video Saved Locally", description: `Saved as ${a.download}.` });
  };
  
  const handleUploadToFirebase = useCallback(async () => {
    if (!user || !isAdmin || !recordedVideoBlob || selectedThumbnailIndex === null) {
      setError("Missing required data: User, admin status, video, or thumbnail selection."); return;
    }
    const thumbnailBlobToUpload = potentialThumbnailBlobs[selectedThumbnailIndex];
    if (!thumbnailBlobToUpload) { setError("Selected thumbnail data is missing."); return; }
    if (!title.trim()) { setError("Video title is required."); return; }

    setUiStep("uploading"); setIsUploading(true); setUploadProgress(0);

    const videoId = uuidv4(); const timestamp = Date.now();
    const safeFileTitle = title.replace(/[^a-z0-9_.\-]+/gi, '_').toLowerCase() || videoId;
    const videoExtension = getSupportedMimeType().split('/')[1]?.split(';')[0] || 'webm';
    const videoFilename = `${safeFileTitle}_${timestamp}.${videoExtension}`;
    const thumbnailFilename = `thumb_${safeFileTitle}_${timestamp}.jpg`;
    const videoStoragePath = `videos/${user.uid}/${videoFilename}`;
    const thumbnailStoragePath = `thumbnails/${user.uid}/${thumbnailFilename}`;

    try {
      console.log("RecorderPage: Uploading video to:", videoStoragePath);
      await uploadFileToStorage(videoStoragePath, recordedVideoBlob, undefined, (snapshot) => {
        setUploadProgress(Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 50));
      });
      const videoUrl = await getFirebaseStorageDownloadUrl(videoStoragePath);

      console.log("RecorderPage: Uploading thumbnail to:", thumbnailStoragePath);
      await uploadFileToStorage(thumbnailStoragePath, thumbnailBlobToUpload, undefined, (snapshot) => {
        setUploadProgress(Math.round(50 + (snapshot.bytesTransferred / snapshot.totalBytes) * 50));
      });
      const thumbnailUrl = await getFirebaseStorageDownloadUrl(thumbnailStoragePath);

      const metadata: VideoMeta = {
        id: videoId, doctorId: user.uid,
        doctorName: doctorProfile?.name || user.displayName || "Unknown Doctor",
        title, description, videoUrl, thumbnailUrl,
        duration: formatTime(recordingDuration), recordingDuration,
        tags: keywords.split(',').map(k => k.trim()).filter(Boolean),
        createdAt: new Date().toISOString(), 
        viewCount: 0, likeCount: 0, commentCount: 0, featured: featured,
        permalink: `/videos/${videoId}`, storagePath: videoStoragePath, thumbnailStoragePath: thumbnailStoragePath,
        videoSize: recordedVideoBlob.size, videoType: recordedVideoBlob.type, comments: [],
      };
      
      const result = await saveVideoMetadataAction(metadata);

      if (result.success && result.videoId) {
        toast({ title: "Upload Successful!", description: `Video "${title}" is now available.` });
        setUiStep("success");
      } else { throw new Error(result.error || "Failed to save video metadata."); }
    } catch (uploadError: any) {
      console.error("RecorderPage: Upload or metadata save failed:", uploadError);
      setError(`Upload failed: ${uploadError.message}`);
      setUiStep("review"); // Revert to review step on upload failure
    } finally { setIsUploading(false); }
  }, [
    user, isAdmin, recordedVideoBlob, potentialThumbnailBlobs, selectedThumbnailIndex, title, description, 
    recordingDuration, keywords, featured, doctorProfile, toast
  ]); 
  
  const resetEntirePage = () => {
    console.log("RecorderPage: resetEntirePage called.");
    stopRecording(); // Ensure recorder is stopped
    
    if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach(track => track.stop());
        mediaStreamRef.current = null;
        console.log("RecorderPage: Media stream tracks stopped and ref cleared.");
    }
    if (videoRef.current) { // Clear native video player
      videoRef.current.srcObject = null;
      videoRef.current.src = "";
      videoRef.current.load(); // Important to release resources
    }
    
    // Revoke existing blob URLs
    if (recordedVideoUrl && recordedVideoUrl.startsWith('blob:')) {
        URL.revokeObjectURL(recordedVideoUrl);
        console.log("RecorderPage: Revoked recordedVideoUrl.");
    }
    potentialThumbnails.forEach(url => {
        if (url && url.startsWith('blob:')) URL.revokeObjectURL(url);
    });
    console.log("RecorderPage: Revoked potential thumbnail URLs.");

    setRecordedVideoUrl(null); setRecordedVideoBlob(null);
    setPotentialThumbnails([]); setPotentialThumbnailBlobs([]);
    setSelectedThumbnailIndex(null); setTitle(''); setDescription(''); setKeywords('');
    setFeatured(false); setRecordingDuration(0); setError(null); setUploadProgress(0);
    setIsRecording(false); setIsUploading(false); setIsLocallySaved(false);
    setHasCameraPermission(null); // This will trigger permission request on next effect run if needed
    setUiStep("initial");
    console.log("RecorderPage: Reset complete. Requesting permissions for next session.");
    requestPermissionsAndSetup(); // Re-initialize camera for a new session
  };
  
  if (authLoading && uiStep === "initial") { // Show loader only during initial auth check
    return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-primary" /> <span className="ml-2">Loading Auth...</span></div>;
  }
  // Admin check performed in useEffect, redirects if not admin

  // Determine UI visibility based on simplified state
  const showLiveFeed = uiStep === "ready" || uiStep === "recording";
  const showReviewInterface = uiStep === "review" && recordedVideoUrl;
  const showUploadForm = uiStep === "review" && recordedVideoUrl && selectedThumbnailIndex !== null;


  return (
    <div className="container mx-auto py-8">
    <Card className="w-full max-w-2xl mx-auto shadow-xl rounded-lg">
      <CardHeader>
        <CardTitle className="text-2xl font-headline flex items-center gap-2"><CameraIcon size={28}/> Web Video Recorder</CardTitle>
        <CardDescription>Record, review, capture thumbnails, add details, and upload. Max {MAX_RECORDING_MINUTES} mins.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {error && <Alert variant="destructive"><AlertCircle className="h-4 w-4" /> <AlertTitle>Error</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
        {uiStep === "success" && <Alert variant="default" className="bg-green-100 border-green-400 text-green-700 dark:bg-green-900/30 dark:text-green-300"><CheckCircle className="h-4 w-4" /> <AlertTitle>Success!</AlertTitle><AlertDescription>Video uploaded. You can record another.</AlertDescription></Alert>}

        {hasCameraPermission === false && uiStep === "initial" && (
           <Alert variant="destructive" className="shadow-md">
            <AlertCircle className="h-4 w-4" /> <AlertTitle>Camera/Microphone Access Denied</AlertTitle>
            <AlertDescription> Please enable permissions in your browser. <Button onClick={requestPermissionsAndSetup} variant="link" size="sm" className="p-0 h-auto text-destructive-foreground underline">Retry Permissions</Button></AlertDescription>
          </Alert>
        )}
        
        <div className="relative aspect-video bg-slate-900 rounded-md overflow-hidden border border-border shadow-inner">
          {/* Native video for live preview */}
          <video ref={videoRef} playsInline autoPlay muted className={`w-full h-full object-contain ${showLiveFeed ? 'block' : 'hidden'}`} />
          
          {/* ReactPlayer for review */}
          {showReviewInterface && (
            <ReactPlayer
              ref={playerRef}
              url={recordedVideoUrl!} // Should be non-null here
              controls
              width="100%"
              height="100%"
              playing={true} // Autoplay review
              onError={(e: any) => { console.error("ReactPlayer error:", e); setError("Error playing recorded video."); }}
            />
          )}

          {uiStep === "initial" && hasCameraPermission === null && 
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/50 text-white">
              <Loader2 className="h-10 w-10 animate-spin mb-3"/> <p>Initializing Camera...</p>
            </div>
          }
           {isRecording && 
            <div className="absolute top-3 right-3 bg-red-600 text-white px-3 py-1.5 rounded-md text-sm font-medium flex items-center gap-2 shadow-lg">
                <Mic className="animate-pulse" /> REC {formatTime(recordingDuration)}
            </div>
          }
        </div>
        
        <div className="space-y-3">
          {uiStep === "ready" && hasCameraPermission && !isRecording && (
            <Button onClick={startRecording} className="w-full gap-2 text-lg py-3 bg-green-600 hover:bg-green-700 shadow-md"><Mic /> Start Recording</Button>
          )}
          {isRecording && (
            <Button onClick={stopRecording} variant="destructive" className="w-full gap-2 text-lg py-3 shadow-md"><Square /> Stop Recording</Button>
          )}
          {uiStep === "success" && (
            <Button onClick={resetEntirePage} variant="outline" className="w-full gap-2 shadow-sm"><RefreshCcw /> Record Another Video</Button>
          )}
        </div>
        
        {showReviewInterface && (
             <div className="pt-4 border-t border-border space-y-3">
              <h3 className="text-lg font-medium">Capture Thumbnails</h3>
              <Button onClick={handleCaptureThumbnail} disabled={isCapturingThumbnail || potentialThumbnails.length >= NUM_THUMBNAILS_TO_GENERATE || isUploading} variant="outline" className="w-full sm:w-auto gap-2">
                {isCapturingThumbnail ? <Loader2 className="animate-spin"/> : <CameraIcon/>} Capture ({potentialThumbnails.length}/{NUM_THUMBNAILS_TO_GENERATE})
              </Button>
              
              {potentialThumbnails.length > 0 && (
                <div className="pt-2">
                    <Label className="text-sm font-medium">Select Thumbnail <span className="text-destructive">*</span></Label>
                    <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 mt-1">
                        {potentialThumbnails.map((thumbUrl, index) => (
                        thumbUrl ? (
                            <button key={index} type="button" onClick={() => setSelectedThumbnailIndex(index)}
                            className={`relative aspect-video rounded-md overflow-hidden border-2 transition-all shadow-sm hover:opacity-80
                                ${selectedThumbnailIndex === index ? 'border-primary ring-2 ring-primary/50' : 'border-muted hover:border-primary/50'}`}>
                            <NextImage src={thumbUrl} alt={`Thumbnail ${index + 1}`} fill sizes="100px" className="object-cover" data-ai-hint="video thumbnail preview" />
                            {selectedThumbnailIndex === index && <div className="absolute inset-0 bg-primary/60 flex items-center justify-center"><CheckCircle size={24} className="text-white"/></div>}
                            </button>
                        ) : null
                        ))}
                    </div>
                    {selectedThumbnailIndex === null && <p className="text-xs text-destructive mt-1">Please select a thumbnail.</p>}
                </div>
              )}
            </div>
        )}

        {showUploadForm && !isUploading && (
            <form onSubmit={(e) => { e.preventDefault(); handleUploadToFirebase(); }} className="space-y-4 pt-6 border-t border-border" id="web-video-upload-form">
                <h3 className="text-xl font-semibold font-headline">Video Details</h3>
                <div className="space-y-1"><Label htmlFor="title">Title <span className="text-destructive">*</span></Label><Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} required /></div>
                <div className="space-y-1"><Label htmlFor="description">Description</Label><Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} rows={3}/></div>
                <div className="space-y-1"><Label htmlFor="keywords">Keywords (comma-separated)</Label><Input id="keywords" value={keywords} onChange={(e) => setKeywords(e.target.value)} /></div>
                <div className="flex items-center space-x-2"><Checkbox id="featured" checked={featured} onCheckedChange={(checked) => setFeatured(Boolean(checked))} /><Label htmlFor="featured" className="font-normal text-sm">Feature this video</Label></div>
                
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                    <Button type="button" onClick={handleLocalSave} variant="outline" className="w-full gap-2 shadow-sm" 
                        disabled={isLocallySaved || isUploading || !recordedVideoBlob || !title.trim() || selectedThumbnailIndex === null}>
                        <Download /> {isLocallySaved ? "Saved Locally" : "Save to Device"}
                    </Button>
                    <Button type="submit" form="web-video-upload-form" className="w-full gap-2 bg-primary hover:bg-primary/90 shadow-md" 
                        disabled={!isLocallySaved || isUploading || !recordedVideoBlob || !title.trim() || selectedThumbnailIndex === null}>
                        {isUploading ? <Loader2 className="animate-spin"/> : <UploadCloud />} Upload to Firebase
                    </Button>
                </div>
            </form>
        )}

        {uiStep === "uploading" && isUploading && (
            <div className="space-y-2 pt-4 border-t border-border">
                <Label>Upload Progress</Label><Progress value={uploadProgress} className="w-full h-3 shadow-inner" /><p className="text-sm text-center text-muted-foreground">{Math.round(uploadProgress)}%</p>
            </div>
        )}
      </CardContent>
      {(uiStep === "ready" || uiStep === "review" || uiStep === "initial" && hasCameraPermission === false ) && !isUploading && (
      <CardFooter className="pt-4 border-t">
         <Button onClick={resetEntirePage} variant="outline" className="w-full gap-2 shadow-sm"><RefreshCcw /> Reset Recorder & Camera</Button>
      </CardFooter>
      )}
    </Card>
    </div>
  );
}

