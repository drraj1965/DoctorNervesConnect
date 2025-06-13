
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
import { Loader2, Video as VideoIconLucide, Mic, Square, UploadCloud, AlertCircle, CheckCircle, CameraIcon as CameraIconLucide, RefreshCcw, Download, Image as ImageIconLucide, Play, Pause, Settings, Film } from "lucide-react";
import { v4 as uuidv4 } from 'uuid';
import NextImage from 'next/image';
import { uploadFileToStorage, getFirebaseStorageDownloadUrl } from "@/lib/firebase/storage"; // Using the client SDK storage helpers
import { saveVideoMetadataAction } from "./actions"; // Using the server action
import type { VideoMeta } from "@/types";
import { useToast } from '@/hooks/use-toast';
import ReactPlayer from "react-player";

// import "@/styles/video-recorder.css"; // Keep if specific non-Tailwind styles are needed

const MAX_RECORDING_MINUTES = 30;
const NUM_THUMBNAILS_TO_GENERATE = 5;

export default function WebVideoRecorderPage() {
  const { user, doctorProfile, isAdmin, loading: authLoading } = useAuth();
  const router = useRouter();
  const { toast } = useToast();

  const liveVideoPreviewRef = useRef<HTMLVideoElement | null>(null);
  const playerRef = useRef<ReactPlayer | null>(null);
  const fallbackPlayerRef = useRef<HTMLVideoElement>(null); // For native player
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);

  // Core states
  const [isCameraOn, setIsCameraOn] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordedVideoBlob, setRecordedVideoBlob] = useState<Blob | null>(null);
  const [recordedVideoUrl, setRecordedVideoUrl] = useState<string | null>(null); 
  const [useFallbackPlayer, setUseFallbackPlayer] = useState(false);

  // UI Flow states
  const [showReviewAndThumbnailSection, setShowReviewAndThumbnailSection] = useState(false);
  const [showMetadataAndUploadSection, setShowMetadataAndUploadSection] = useState(false);
  
  // Recording specific states
  const [recordingDuration, setRecordingDuration] = useState(0);
  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);
  
  // Thumbnail states
  const [potentialThumbnails, setPotentialThumbnails] = useState<string[]>([]);
  const [potentialThumbnailBlobs, setPotentialThumbnailBlobs] = useState<Blob[]>([]);
  const [selectedThumbnailIndex, setSelectedThumbnailIndex] = useState<number | null>(null);
  const [isCapturingThumbnail, setIsCapturingThumbnail] = useState(false);

  // Metadata states
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [keywords, setKeywords] = useState('');
  const [featured, setFeatured] = useState(false);
  
  // Upload states
  const [error, setError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [isLocallySaved, setIsLocallySaved] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [uploadedVideoId, setUploadedVideoId] = useState<string | null>(null);

  // Initial Auth Check
  useEffect(() => {
    if (!authLoading) {
      if (!user) router.push("/login?redirectedFrom=/admin/recorder");
      else if (!isAdmin) {
        toast({ variant: "destructive", title: "Access Denied", description: "You are not authorized for this page." });
        router.replace("/dashboard");
      }
    }
  }, [authLoading, user, isAdmin, router, toast]);

  // Cleanup effect
  useEffect(() => {
    return () => {
      mediaStreamRef.current?.getTracks().forEach(track => track.stop());
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
        mediaRecorderRef.current.stop();
      }
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      if (recordedVideoUrl && recordedVideoUrl.startsWith('blob:')) URL.revokeObjectURL(recordedVideoUrl);
      potentialThumbnails.forEach(url => { if (url && url.startsWith('blob:')) URL.revokeObjectURL(url); });
    };
  }, [recordedVideoUrl, potentialThumbnails]);


  const getSupportedMimeType = useCallback(() => {
    const types = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
    for (const type of types) { if (MediaRecorder.isTypeSupported(type)) return type; }
    return 'video/webm'; // Fallback
  }, []);

  const startCamera = async () => {
    setError(null); setUploadSuccess(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      mediaStreamRef.current = stream;
      if (liveVideoPreviewRef.current) {
        liveVideoPreviewRef.current.srcObject = stream;
        await liveVideoPreviewRef.current.play().catch(e => console.warn("Live preview play error on setup:", e));
      }
      setIsCameraOn(true);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      setError(`Camera/mic access failed: ${errorMsg}.`);
      setIsCameraOn(false);
    }
  };

  const startRecording = () => {
    if (!mediaStreamRef.current || !mediaStreamRef.current.active) {
      setError("Camera not ready or permission denied.");
      startCamera(); return;
    }
    resetRecordingStates(); // Clear any previous recording data

    const mimeType = getSupportedMimeType();
    try {
      mediaRecorderRef.current = new MediaRecorder(mediaStreamRef.current, { mimeType });
      recordedChunksRef.current = [];

      mediaRecorderRef.current.onstart = () => {
        setIsRecording(true);
        setRecordingDuration(0);
        if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = setInterval(() => setRecordingDuration(prev => prev + 1), 1000);
      };

      mediaRecorderRef.current.ondataavailable = (event) => {
        if (event.data.size > 0) recordedChunksRef.current.push(event.data);
      };

      mediaRecorderRef.current.onstop = () => {
        setIsRecording(false);
        if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
        mediaStreamRef.current?.getTracks().forEach(track => track.stop()); // Stop camera stream
        setIsCameraOn(false); // Turn off camera preview
        if (liveVideoPreviewRef.current) liveVideoPreviewRef.current.srcObject = null;


        if (recordedChunksRef.current.length === 0) {
          setError("No video data recorded."); return;
        }
        const blob = new Blob(recordedChunksRef.current, { type: mediaRecorderRef.current?.mimeType || mimeType });
        
        if (blob.size === 0) {
            setError("Recorded blob is empty."); return;
        }
        setRecordedVideoBlob(blob);
        const url = URL.createObjectURL(blob);
        if (typeof url === 'string' && url.startsWith('blob:')) {
            setRecordedVideoUrl(url);
            setShowReviewAndThumbnailSection(true);
        } else {
            setError("Failed to create a playable URL for the recorded video.");
            setRecordedVideoUrl(null);
        }
      };
      mediaRecorderRef.current.start(1000);
    } catch (e) {
      setError(`Recorder start failed: ${e instanceof Error ? e.message : String(e)}.`);
      setIsRecording(false);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop(); // This triggers onstop
    } else { // Fallback if state is inconsistent
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      setIsRecording(false);
      mediaStreamRef.current?.getTracks().forEach(track => track.stop());
      setIsCameraOn(false);
      if (liveVideoPreviewRef.current) liveVideoPreviewRef.current.srcObject = null;
    }
  };

  const formatTime = (totalSeconds: number): string => {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = Math.floor(totalSeconds % 60);
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  };

  const generateSingleThumbnail = useCallback(async (videoObjectUrl: string, timestamp: number): Promise<{ dataUrl: string; blob: Blob } | null> => {
    return new Promise((resolve) => {
        const tempVideoElement = document.createElement('video');
        tempVideoElement.muted = true; tempVideoElement.crossOrigin = "anonymous";
        let resolved = false;
        const cleanupAndResolve = (result: { dataUrl: string; blob: Blob } | null) => {
            if (resolved) return; resolved = true; clearTimeout(timeoutId);
            tempVideoElement.removeEventListener('seeked', onSeeked); tempVideoElement.removeEventListener('error', onError);
            tempVideoElement.removeEventListener('loadedmetadata', onLoadedMetadata);
            tempVideoElement.src = ""; tempVideoElement.removeAttribute('src');
            try { tempVideoElement.load(); } catch (e) { /* ignore */ }
            tempVideoElement.remove(); resolve(result);
        };
        const timeoutId = setTimeout(() => cleanupAndResolve(null), 8000);
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
                canvas.toBlob(blob => { blob && blob.size > 0 ? cleanupAndResolve({ dataUrl, blob }) : cleanupAndResolve(null); }, 'image/jpeg', 0.85);
            } catch (drawError) { cleanupAndResolve(null); }
        };
        const onError = () => cleanupAndResolve(null);
        const onLoadedMetadata = () => {
            if (resolved) return;
            const safeTimestamp = Math.max(0.01, Math.min(timestamp, (tempVideoElement.duration > 0 && Number.isFinite(tempVideoElement.duration)) ? tempVideoElement.duration - 0.01 : timestamp));
            tempVideoElement.currentTime = safeTimestamp;
        };
        tempVideoElement.addEventListener('loadedmetadata', onLoadedMetadata);
        tempVideoElement.addEventListener('seeked', onSeeked);
        tempVideoElement.addEventListener('error', onError);
        tempVideoElement.src = videoObjectUrl; tempVideoElement.load();
    });
  }, []);

  const handleCaptureThumbnail = useCallback(async () => {
    const player = playerRef.current || (useFallbackPlayer ? fallbackPlayerRef.current : null);
    if (!player || !recordedVideoUrl || potentialThumbnails.length >= NUM_THUMBNAILS_TO_GENERATE) return;
    
    setIsCapturingThumbnail(true);
    try {
      let currentTime;
      if (playerRef.current && !useFallbackPlayer) currentTime = playerRef.current.getCurrentTime();
      else if (fallbackPlayerRef.current && useFallbackPlayer) currentTime = fallbackPlayerRef.current.currentTime;
      
      if (typeof currentTime !== 'number') {
         toast({ variant: "destructive", title: "Error", description: "Could not get video current time." });
         setIsCapturingThumbnail(false); return;
      }
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
      toast({ variant: "destructive", title: "Capture Error", description: "An unexpected error occurred while capturing." });
    } finally { setIsCapturingThumbnail(false); }
  }, [recordedVideoUrl, generateSingleThumbnail, potentialThumbnails.length, selectedThumbnailIndex, toast, useFallbackPlayer]);

  const proceedToMetadata = () => {
    if (potentialThumbnails.filter(Boolean).length === 0) {
      toast({variant: "destructive", title: "No Thumbnails", description: "Please capture at least one thumbnail."}); return;
    }
    if (selectedThumbnailIndex === null && potentialThumbnails.filter(Boolean).length > 0) {
      setSelectedThumbnailIndex(potentialThumbnails.findIndex(t => t !== null));
    }
    setShowReviewAndThumbnailSection(false);
    setShowMetadataAndUploadSection(true);
  };
  
  const handleLocalSave = () => {
    if (!recordedVideoBlob) { toast({ variant: "destructive", title: "No Video to Save"}); return; }
    const urlToDownload = recordedVideoUrl || URL.createObjectURL(recordedVideoBlob); 
    const a = document.createElement("a"); a.href = urlToDownload;
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

    setIsUploading(true); setUploadProgress(0); setUploadSuccess(false); setError(null);

    const videoId = uuidv4(); const timestamp = Date.now();
    const safeFileTitle = title.replace(/[^a-z0-9_.\-]+/gi, '_').toLowerCase() || videoId;
    const videoExtension = getSupportedMimeType().split('/')[1]?.split(';')[0] || 'webm';
    const videoFilename = `${safeFileTitle}_${timestamp}.${videoExtension}`;
    const thumbnailFilename = `thumb_${safeFileTitle}_${timestamp}.jpg`;
    const videoDirectoryPath = `videos/${user.uid}`;
    const thumbnailDirectoryPath = `thumbnails/${user.uid}`;

    try {
      const uploadedVideoStoragePath = await uploadFileToStorage(videoDirectoryPath, recordedVideoBlob, videoFilename, (s) => setUploadProgress(Math.round((s.bytesTransferred / s.totalBytes) * 50)));
      const videoFirebaseUrl = await getFirebaseStorageDownloadUrl(uploadedVideoStoragePath);
      setUploadProgress(50);
      const uploadedThumbnailStoragePath = await uploadFileToStorage(thumbnailDirectoryPath, thumbnailBlobToUpload, thumbnailFilename, (s) => setUploadProgress(Math.round(50 + (s.bytesTransferred / s.totalBytes) * 50)));
      const thumbnailFirebaseUrl = await getFirebaseStorageDownloadUrl(uploadedThumbnailStoragePath);
      setUploadProgress(100);

      const metadata: VideoMeta = { 
        id: videoId, doctorId: user.uid,
        doctorName: doctorProfile?.name || user.displayName || "Unknown Doctor",
        title, description, videoUrl: videoFirebaseUrl, thumbnailUrl: thumbnailFirebaseUrl,
        duration: formatTime(recordingDuration), recordingDuration,
        tags: keywords.split(',').map(k => k.trim()).filter(Boolean),
        // createdAt will be set by server action
        createdAt: new Date().toISOString(), // Placeholder, server action will overwrite
        viewCount: 0, likeCount: 0, commentCount: 0, featured: featured,
        permalink: `/videos/${videoId}`, storagePath: uploadedVideoStoragePath,
        thumbnailStoragePath: uploadedThumbnailStoragePath,
        videoSize: recordedVideoBlob.size, videoType: recordedVideoBlob.type || getSupportedMimeType(), comments: [],
      };
      
      const result = await saveVideoMetadataAction(metadata);
      if (result.success && result.videoId) { 
        toast({ title: "Upload Successful!", description: `Video "${title}" is now available.` });
        setUploadSuccess(true); setUploadedVideoId(result.videoId);
      } else { throw new Error(result.error || "Failed to save video metadata."); }
    } catch (uploadError: any) {
      setError(`Upload failed: ${uploadError.message}`);
    } finally { setIsUploading(false); }
  }, [
    user, isAdmin, recordedVideoBlob, potentialThumbnailBlobs, selectedThumbnailIndex, title, description,
    recordingDuration, keywords, featured, doctorProfile, toast, getSupportedMimeType
  ]);

  const resetRecordingStates = () => {
    if (recordedVideoUrl && recordedVideoUrl.startsWith('blob:')) URL.revokeObjectURL(recordedVideoUrl);
    setRecordedVideoUrl(null); setRecordedVideoBlob(null);
    potentialThumbnails.forEach(url => { if (url && url.startsWith('blob:')) URL.revokeObjectURL(url); });
    setPotentialThumbnails([]); setPotentialThumbnailBlobs([]); setSelectedThumbnailIndex(null);
    setIsLocallySaved(false); setShowReviewAndThumbnailSection(false); setShowMetadataAndUploadSection(false);
    setRecordingDuration(0); setError(null); setUploadSuccess(false); setUploadedVideoId(null);
    setTitle(''); setDescription(''); setKeywords(''); setFeatured(false);
    setUseFallbackPlayer(false);
  };
  
  const resetEntirePage = () => {
    stopRecording(); // Stops recorder & stream tracks
    resetRecordingStates();
    // setIsCameraOn(false); // Will be reset by startCamera if called again
    // if (liveVideoPreviewRef.current) liveVideoPreviewRef.current.srcObject = null;
    // No need to call startCamera() here, user will click "Start Camera"
  };

  const showLiveFeedArea = isCameraOn && !isRecording && !recordedVideoUrl && !showReviewAndThumbnailSection && !showMetadataAndUploadSection;
  const showInitialStartButton = !isCameraOn && !isRecording && !recordedVideoUrl && !showReviewAndThumbnailSection && !showMetadataAndUploadSection;

  if (authLoading) {
    return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-primary" /> <span className="ml-2">Initializing...</span></div>;
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
        {uploadSuccess && uploadedVideoId && (
            <Alert variant="default" className="bg-green-100 border-green-400 text-green-700 dark:bg-green-900/30 dark:text-green-300">
                <CheckCircle className="h-4 w-4" /> <AlertTitle>Success!</AlertTitle>
                <AlertDescription>
                    Video uploaded. 
                    <Button variant="link" asChild className="p-0 ml-1 h-auto text-green-700 dark:text-green-300 underline">
                        <a href={`/videos/${uploadedVideoId}`} target="_blank" rel="noopener noreferrer">View Video</a>
                    </Button>
                </AlertDescription>
            </Alert>
        )}

        {/* Video Display Area */}
        <div className="relative aspect-video bg-slate-900 rounded-md overflow-hidden border border-border shadow-inner">
          {/* Native video element for live preview */}
          <video ref={liveVideoPreviewRef} playsInline autoPlay muted 
            className={`w-full h-full object-contain ${showLiveFeedArea ? 'block' : 'hidden'}`} />

          {/* Player for recorded video review */}
          {showReviewAndThumbnailSection && recordedVideoUrl && !useFallbackPlayer && (
            <ReactPlayer
              key={recordedVideoUrl} 
              ref={playerRef}
              url={recordedVideoUrl} 
              controls playing width="100%" height="100%"
              onError={(e: any) => {
                setError(`ReactPlayer Error. Switching to fallback. Details: ${JSON.stringify(e)}`);
                setUseFallbackPlayer(true);
              }}
            />
          )}
          {showReviewAndThumbnailSection && recordedVideoUrl && useFallbackPlayer && (
             <video ref={fallbackPlayerRef} src={recordedVideoUrl} controls autoPlay
                className="w-full h-full object-contain"
                onError={() => setError("Fallback player also failed to load the video.")}>
                Your browser does not support the video tag.
             </video>
          )}
           {!(showLiveFeedArea || (showReviewAndThumbnailSection && recordedVideoUrl)) && !isRecording && (
             <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/50 text-white">
               <Film size={48} className="mb-3 text-slate-400"/> 
               <p className="text-slate-300">Preview will appear here</p>
             </div>
           )}
        </div>

        {/* Controls Area */}
        <div className="space-y-3">
          {showInitialStartButton && !uploadSuccess && (
            <Button onClick={startCamera} className="w-full gap-2 text-lg py-3 bg-blue-600 hover:bg-blue-700">
              <CameraIconLucide size={20} /> Start Camera & Mic
            </Button>
          )}

          {isCameraOn && !isRecording && !recordedVideoUrl && !uploadSuccess && (
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
        </div>

        {/* Thumbnail Capture Section */}
        {showReviewAndThumbnailSection && !showMetadataAndUploadSection && (
             <div className="pt-4 border-t space-y-3">
              <h3 className="text-lg font-medium">Capture Thumbnails ({potentialThumbnails.length}/{NUM_THUMBNAILS_TO_GENERATE})</h3>
              <div className="flex flex-wrap gap-2">
                <Button onClick={handleCaptureThumbnail} disabled={isCapturingThumbnail || potentialThumbnails.length >= NUM_THUMBNAILS_TO_GENERATE || isUploading} variant="outline" className="gap-2">
                  {isCapturingThumbnail ? <Loader2 className="animate-spin"/> : <CameraIconLucide/>} Capture
                </Button>
                <Button onClick={proceedToMetadata} variant="default" disabled={isUploading || potentialThumbnails.length === 0}>
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
                     {selectedThumbnailIndex === null && potentialThumbnails.some(t => t) && (
                        <p className="text-xs text-destructive mt-1">Please select a final thumbnail.</p>
                    )}
                </div>
              )}
            </div>
        )}

        {/* Metadata and Upload Section */}
        {showMetadataAndUploadSection && !isUploading && !uploadSuccess && (
            <form onSubmit={(e) => { e.preventDefault(); handleUploadToFirebase(); }} className="space-y-4 pt-6 border-t" id="web-video-upload-form">
                <h3 className="text-xl font-semibold font-headline">Video Details & Final Upload</h3>
                {selectedThumbnailIndex !== null && potentialThumbnails[selectedThumbnailIndex] ? (
                    <div>
                        <Label className="text-sm font-medium">Final Thumbnail</Label>
                        <div className="relative aspect-video w-48 rounded-md overflow-hidden border-2 border-primary mt-1">
                            <NextImage src={potentialThumbnails[selectedThumbnailIndex]!} alt="Selected Thumbnail" fill sizes="192px" className="object-cover" data-ai-hint="video thumbnail"/>
                        </div>
                    </div>
                ) : <p className="text-sm text-destructive">Please go back and select a thumbnail.</p>}

                <div className="space-y-1"><Label htmlFor="title">Title <span className="text-destructive">*</span></Label><Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} required /></div>
                <div className="space-y-1"><Label htmlFor="description">Description</Label><Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} rows={3}/></div>
                <div className="space-y-1"><Label htmlFor="keywords">Keywords (comma-separated)</Label><Input id="keywords" value={keywords} onChange={(e) => setKeywords(e.target.value)} /></div>
                <div className="flex items-center space-x-2"><Checkbox id="featured" checked={featured} onCheckedChange={(checked) => setFeatured(Boolean(checked))} /><Label htmlFor="featured" className="font-normal text-sm">Feature this video</Label></div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                    <Button type="button" onClick={() => { setShowMetadataAndUploadSection(false); setShowReviewAndThumbnailSection(true); }} variant="outline" className="w-full gap-2" disabled={isUploading}>
                        Back to Thumbnails
                    </Button>
                    <Button type="button" onClick={handleLocalSave} variant="outline" className="w-full gap-2"
                        disabled={isLocallySaved || isUploading || !recordedVideoBlob || !title.trim() || selectedThumbnailIndex === null || !potentialThumbnailBlobs[selectedThumbnailIndex!]}>
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
      {(showReviewAndThumbnailSection || showMetadataAndUploadSection || uploadSuccess) && ( 
      <CardFooter className="pt-4 border-t">
         <Button onClick={resetEntirePage} variant="outline" className="w-full gap-2"><RefreshCcw /> Start New Recording</Button>
      </CardFooter>
      )}
    </Card>
    </div>
  );
}

    