
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
import { Loader2, Video, Mic, Square, UploadCloud, AlertCircle, CheckCircle, Camera, RefreshCcw, Download, Image as ImageIcon, Sparkles, Play, Pause } from "lucide-react";
import { v4 as uuidv4 } from 'uuid';
import NextImage from 'next/image'; // Renamed to avoid conflict with ImageIcon
import { uploadFileToStorage, getFirebaseStorageDownloadUrl } from "@/lib/firebase/storage";
import { saveVideoMetadataAction } from "./actions";
import type { VideoMeta } from "@/types";
import { useToast } from "@/hooks/use-toast";

const MAX_RECORDING_MINUTES = 30;
const NUM_THUMBNAILS_TO_GENERATE = 5;

type RecorderStep = "initial" | "permissionDenied" | "settingUp" | "readyToRecord" | "recording" | "review" | "generatingThumbnails" | "uploading" | "success";

export default function WebVideoRecorderPage() {
  const { user, doctorProfile, isAdmin, loading: authLoading } = useAuth();
  const router = useRouter();
  const { toast } = useToast();

  const videoRef = useRef<HTMLVideoElement | null>(null); // Used for both live preview and review
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  
  const [recorderStep, setRecorderStep] = useState<RecorderStep>("initial");
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const [recordedVideoBlob, setRecordedVideoBlob] = useState<Blob | null>(null);
  const [recordedVideoUrl, setRecordedVideoUrl] = useState<string | null>(null);
  const [recordingDuration, setRecordingDuration] = useState(0); // in seconds
  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);
  
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [keywords, setKeywords] = useState('');
  const [featured, setFeatured] = useState(false);

  const [potentialThumbnails, setPotentialThumbnails] = useState<(string | null)[]>(Array(NUM_THUMBNAILS_TO_GENERATE).fill(null));
  const [potentialThumbnailBlobs, setPotentialThumbnailBlobs] = useState<(Blob | null)[]>(Array(NUM_THUMBNAILS_TO_GENERATE).fill(null));
  const [selectedThumbnailIndex, setSelectedThumbnailIndex] = useState<number | null>(null);
  
  const [error, setError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isLocallySaved, setIsLocallySaved] = useState(false);
  const [hasCameraPermission, setHasCameraPermission] = useState<boolean | null>(null);

  useEffect(() => {
    if (!authLoading && !isAdmin) {
      router.replace('/dashboard');
    }
  }, [authLoading, isAdmin, router]);

  const cleanupStream = useCallback(() => {
    if (mediaStream) {
      mediaStream.getTracks().forEach(track => track.stop());
      setMediaStream(null);
    }
  }, [mediaStream]);

  const cleanupRecordedVideo = useCallback(() => {
    if (recordedVideoUrl) {
      URL.revokeObjectURL(recordedVideoUrl);
      setRecordedVideoUrl(null);
    }
    setRecordedVideoBlob(null);
    recordedChunksRef.current = [];
  }, [recordedVideoUrl]);

  const cleanupThumbnails = useCallback(() => {
    potentialThumbnails.forEach(url => {
      if (url && url.startsWith('blob:')) { URL.revokeObjectURL(url); }
    });
    setPotentialThumbnails(Array(NUM_THUMBNAILS_TO_GENERATE).fill(null));
    setPotentialThumbnailBlobs(Array(NUM_THUMBNAILS_TO_GENERATE).fill(null));
    setSelectedThumbnailIndex(null);
  }, [potentialThumbnails]);

  const requestPermissionsAndSetup = useCallback(async () => {
    if (mediaStream && mediaStream.active) {
      setRecorderStep("readyToRecord");
      return;
    }
    setRecorderStep("settingUp");
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      if (!stream.active) throw new Error("Camera stream is not active.");
      
      setMediaStream(stream);
      setHasCameraPermission(true);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.muted = true;
        videoRef.current.controls = false;
        await videoRef.current.play().catch(e => console.warn("Error playing live preview:", e));
      }
      setRecorderStep("readyToRecord");
    } catch (err) {
      console.error("Error accessing media devices:", err);
      setError(`Failed to access camera/microphone: ${err instanceof Error ? err.message : String(err)}.`);
      setHasCameraPermission(false);
      setRecorderStep("permissionDenied");
    }
  }, [mediaStream]);

  useEffect(() => {
    if (!authLoading && isAdmin && recorderStep === "initial") {
      requestPermissionsAndSetup();
    }
    return () => {
      cleanupStream();
      cleanupRecordedVideo();
      cleanupThumbnails();
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    };
  }, [authLoading, isAdmin, recorderStep, requestPermissionsAndSetup, cleanupStream, cleanupRecordedVideo, cleanupThumbnails]);

  const getSupportedMimeType = () => {
    const types = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
    for (const type of types) { if (MediaRecorder.isTypeSupported(type)) return type; }
    return 'video/webm';
  };

  const startRecording = () => {
    if (!mediaStream || !mediaStream.active || recorderStep !== "readyToRecord") {
      setError("Camera/mic not ready. Please grant permissions and try again.");
      requestPermissionsAndSetup();
      return;
    }
    if (videoRef.current && videoRef.current.srcObject !== mediaStream) { // Ensure live feed is showing
        videoRef.current.srcObject = mediaStream;
        videoRef.current.muted = true;
        videoRef.current.controls = false;
        videoRef.current.play().catch(e => console.warn("Error re-playing live feed for recording:", e));
    }
    cleanupRecordedVideo(); cleanupThumbnails(); setIsLocallySaved(false);
    recordedChunksRef.current = []; setRecordingDuration(0); setError(null);

    const mimeType = getSupportedMimeType();
    try {
      const recorder = new MediaRecorder(mediaStream, { mimeType });
      mediaRecorderRef.current = recorder;
      recorder.onstart = () => {
        setRecorderStep("recording");
        if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = setInterval(() => {
          setRecordingDuration(prev => {
            if (prev + 1 >= MAX_RECORDING_MINUTES * 60) stopRecording();
            return prev + 1;
          });
        }, 1000);
      };
      recorder.ondataavailable = (event) => { if (event.data.size > 0) recordedChunksRef.current.push(event.data); };
      recorder.onstop = async () => {
        if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
        if (recordedChunksRef.current.length === 0) {
          setError("No video data recorded."); setRecorderStep("readyToRecord"); return;
        }
        const blob = new Blob(recordedChunksRef.current, { type: mimeType });
        setRecordedVideoBlob(blob);
        const url = URL.createObjectURL(blob);
        setRecordedVideoUrl(url);
        setRecorderStep("review");
        if (videoRef.current) {
          videoRef.current.srcObject = null; // Stop live preview
          videoRef.current.src = url;
          videoRef.current.muted = false;
          videoRef.current.controls = true; // Show controls for review
          videoRef.current.onloadedmetadata = () => {
            // Automatically generate thumbnails once review video is ready
            if (videoRef.current) {
                handleGenerateThumbnails(url, videoRef.current.duration);
            }
          };
        }
      };
      recorder.onerror = (event) => { setError("Recording error."); if (recordingTimerRef.current) clearInterval(recordingTimerRef.current); setRecorderStep("readyToRecord"); }
      recorder.start();
    } catch (e) { setError(`Failed to start recorder: ${e instanceof Error ? e.message : String(e)}.`); setRecorderStep("readyToRecord"); }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop();
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
        tempVideoElement.muted = true;
        tempVideoElement.crossOrigin = "anonymous"; // Important for canvas if source is cross-origin (though not for blob URLs)
        
        const onSeeked = () => {
            const canvas = document.createElement('canvas');
            canvas.width = tempVideoElement.videoWidth;
            canvas.height = tempVideoElement.videoHeight;
            if (canvas.width === 0 || canvas.height === 0) {
                console.warn("generateSingleThumbnail: Canvas dimensions are zero at timestamp", timestamp);
                cleanupAndResolve(null); return;
            }
            const ctx = canvas.getContext('2d');
            if (!ctx) { cleanupAndResolve(null); return; }
            ctx.drawImage(tempVideoElement, 0, 0, canvas.width, canvas.height);
            const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
            canvas.toBlob(blob => {
                if (blob) {
                    cleanupAndResolve({ dataUrl, blob });
                } else {
                    cleanupAndResolve(null);
                }
            }, 'image/jpeg', 0.85);
        };

        const onError = () => { cleanupAndResolve(null); };
        const onLoadedMetadata = () => {
            tempVideoElement.currentTime = Math.max(0.01, Math.min(timestamp, tempVideoElement.duration - 0.01));
        };

        const cleanupAndResolve = (result: { dataUrl: string; blob: Blob } | null) => {
            tempVideoElement.removeEventListener('seeked', onSeeked);
            tempVideoElement.removeEventListener('error', onError);
            tempVideoElement.removeEventListener('loadedmetadata', onLoadedMetadata);
            tempVideoElement.src = ""; // Release resources
            tempVideoElement.remove();
            resolve(result);
        };

        tempVideoElement.addEventListener('loadedmetadata', onLoadedMetadata);
        tempVideoElement.addEventListener('seeked', onSeeked);
        tempVideoElement.addEventListener('error', onError);
        tempVideoElement.src = videoObjectUrl;
    });
  }, []);

  const handleGenerateThumbnails = useCallback(async (videoObjectUrl: string, duration: number) => {
    if (!videoObjectUrl || !duration || duration <= 0) {
      setError("Video not ready for thumbnails."); return;
    }
    setRecorderStep("generatingThumbnails"); setIsProcessing(true);
    cleanupThumbnails(); // Clear any old thumbnails

    const timestamps = [];
    if (duration < 1) timestamps.push(duration / 2);
    else if (duration < 5) timestamps.push(duration * 0.25, duration * 0.75);
    else { for (let i = 0; i < NUM_THUMBNAILS_TO_GENERATE; i++) timestamps.push((duration / (NUM_THUMBNAILS_TO_GENERATE + 1)) * (i + 1)); }
    
    const validTimestamps = timestamps.filter(t => t > 0 && t < duration).slice(0, NUM_THUMBNAILS_TO_GENERATE);
    if (validTimestamps.length === 0 && duration > 0) validTimestamps.push(Math.min(duration * 0.1, duration - 0.01));

    const generatedDataUrls: (string | null)[] = Array(NUM_THUMBNAILS_TO_GENERATE).fill(null);
    const generatedBlobs: (Blob | null)[] = Array(NUM_THUMBNAILS_TO_GENERATE).fill(null);

    for (let i = 0; i < validTimestamps.length; i++) {
      const result = await generateSingleThumbnail(videoObjectUrl, validTimestamps[i]);
      if (result) {
        generatedDataUrls[i] = result.dataUrl;
        generatedBlobs[i] = result.blob;
      }
    }
    setPotentialThumbnails(generatedDataUrls);
    setPotentialThumbnailBlobs(generatedBlobs);
    const firstValidIndex = generatedBlobs.findIndex(b => b !== null);
    setSelectedThumbnailIndex(firstValidIndex !== -1 ? firstValidIndex : null);
    setIsProcessing(false);
    setRecorderStep("review"); // Stay in review, thumbnails are now available
    if (firstValidIndex === -1) setError("Failed to generate thumbnails.");
  }, [generateSingleThumbnail, cleanupThumbnails]);

  const handleLocalSave = () => {
    if (!recordedVideoBlob) { toast({ variant: "destructive", title: "No Video", description: "No recorded video to save." }); return; }
    const urlToSave = recordedVideoUrl || URL.createObjectURL(recordedVideoBlob);
    const a = document.createElement("a"); a.href = urlToSave;
    const safeTitle = title.replace(/[^a-z0-9_]+/gi, '_').toLowerCase() || 'recorded_video';
    const extension = recordedVideoBlob.type.split('/')[1] || 'webm';
    a.download = `${safeTitle}_${Date.now()}.${extension}`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    if (!recordedVideoUrl) URL.revokeObjectURL(urlToSave); // Only if we created it just for this download
    setIsLocallySaved(true);
    toast({ title: "Video Saved Locally", description: `Video saved as ${a.download}.` });
  };

  const handleUploadToFirebase = async (e: FormEvent) => {
    e.preventDefault();
    if (!recordedVideoBlob || selectedThumbnailIndex === null || !potentialThumbnailBlobs[selectedThumbnailIndex]) {
      setError("Video or selected thumbnail is missing."); return;
    }
    const thumbnailBlob = potentialThumbnailBlobs[selectedThumbnailIndex!];
    if (!thumbnailBlob) { setError("Selected thumbnail data invalid."); return; }
    if (!title.trim()) { setError("Video title is required."); return; }
    if (!user || !doctorProfile || !isAdmin) { setError("Authentication error or insufficient permissions."); return; }

    setRecorderStep("uploading"); setIsProcessing(true); setUploadProgress(0); setError(null);
    try {
      const videoId = uuidv4();
      const videoFileExtension = recordedVideoBlob.type.split('/')[1] || 'webm';
      const safeVideoTitle = title.replace(/[^a-zA-Z0-9_.-]/g, '_').toLowerCase();
      const videoFileName = `${safeVideoTitle}_${videoId.substring(0,8)}.${videoFileExtension}`;
      const thumbnailFileName = `thumb_${safeVideoTitle}_${videoId.substring(0,8)}.jpg`;

      const videoStoragePath = `videos/${doctorProfile.uid}/${videoFileName}`;
      const uploadedVideoUrl = await uploadFileToStorage(videoStoragePath, recordedVideoBlob, undefined, 
        (s) => setUploadProgress(Math.round((s.bytesTransferred / s.totalBytes) * 0.8 * 100))
      );
      setUploadProgress(80);

      const thumbnailStoragePath = `thumbnails/${doctorProfile.uid}/${thumbnailFileName}`;
      const uploadedThumbnailUrl = await uploadFileToStorage(thumbnailStoragePath, thumbnailBlob, undefined,
        (s) => setUploadProgress(Math.round(80 + (s.bytesTransferred / s.totalBytes) * 0.2 * 100))
      );
      setUploadProgress(100);

      const videoMetaData: VideoMeta = {
        id: videoId, title, description, doctorId: doctorProfile.uid,
        doctorName: doctorProfile.displayName || doctorProfile.email || "N/A",
        videoUrl: uploadedVideoUrl, thumbnailUrl: uploadedThumbnailUrl,
        duration: formatTime(recordingDuration), recordingDuration,
        tags: keywords.split(',').map(k => k.trim()).filter(Boolean),
        featured, storagePath: videoStoragePath, thumbnailStoragePath,
        videoSize: recordedVideoBlob.size, videoType: recordedVideoBlob.type,
        createdAt: new Date().toISOString(), // Will be replaced by serverTimestamp
        permalink: `/videos/${videoId}`, viewCount: 0, likeCount: 0, commentCount: 0, comments: []
      };
      
      const result = await saveVideoMetadataAction(videoMetaData);
      if (result.success) {
        toast({ title: "Upload Successful!", description: `Video "${title}" is now available.` });
        setRecorderStep("success");
      } else { throw new Error(result.error || "Failed to save video metadata."); }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
      setRecorderStep("review"); // Revert to review on error
    } finally { setIsProcessing(false); }
  };
  
  const resetRecorderInterface = async () => {
    stopRecording();
    cleanupRecordedVideo();
    cleanupThumbnails();
    setIsLocallySaved(false);
    setTitle(''); setDescription(''); setKeywords(''); setFeatured(false);
    setRecordingDuration(0); setError(null); setUploadProgress(0);
    if (videoRef.current) videoRef.current.src = ""; // Clear src if it was used for review
    setRecorderStep("initial"); // This will trigger requestPermissionsAndSetup via useEffect
    await requestPermissionsAndSetup();
  };
  
  const handlePlayPause = () => {
    if(videoRef.current && recorderStep === "review") {
      if(videoRef.current.paused || videoRef.current.ended) {
        videoRef.current.play().then(() => setIsVideoPlaying(true)).catch(e => console.error("Error playing review video:", e));
      } else {
        videoRef.current.pause();
        setIsVideoPlaying(false);
      }
    }
  };

  useEffect(() => {
    const videoElement = videoRef.current;
    if (videoElement && recorderStep === "review") {
      const handlePlay = () => setIsVideoPlaying(true);
      const handlePause = () => setIsVideoPlaying(false);
      videoElement.addEventListener('play', handlePlay);
      videoElement.addEventListener('pause', handlePause);
      return () => {
        videoElement.removeEventListener('play', handlePlay);
        videoElement.removeEventListener('pause', handlePause);
      };
    }
  }, [recorderStep]);


  if (authLoading) return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  if (!isAdmin) return <Alert variant="destructive"><AlertCircle /> <AlertTitle>Access Denied</AlertTitle></Alert>;

  const canSaveLocally = recordedVideoBlob && title.trim() && selectedThumbnailIndex !== null;
  const canUpload = recordedVideoBlob && title.trim() && selectedThumbnailIndex !== null && isLocallySaved;

  return (
    <div className="container mx-auto py-8">
    <Card className="w-full max-w-2xl mx-auto shadow-xl rounded-lg">
      <CardHeader>
        <CardTitle className="text-2xl font-headline flex items-center gap-2"><Camera size={28}/> Web Video Recorder</CardTitle>
        <CardDescription>Record, review, add details, save locally, then upload. Max {MAX_RECORDING_MINUTES} mins.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {error && <Alert variant="destructive" className="shadow-md"><AlertCircle /> <AlertTitle>Error</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
        {recorderStep === "success" && <Alert variant="default" className="bg-green-100 border-green-400 text-green-700 dark:bg-green-900/30 dark:text-green-300 shadow-md"><CheckCircle /> <AlertTitle>Success!</AlertTitle><AlertDescription>Video uploaded. You can record another.</AlertDescription></Alert>}

        {recorderStep === "permissionDenied" && (
           <Alert variant="destructive" className="shadow-md">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Camera/Microphone Access Denied</AlertTitle>
            <AlertDescription>
              Please enable camera and microphone permissions in your browser settings to use the recorder.
              <Button onClick={requestPermissionsAndSetup} variant="outline" size="sm" className="mt-2 ml-auto block">Retry Permissions</Button>
            </AlertDescription>
          </Alert>
        )}
        
        <div className="relative aspect-video bg-slate-900 rounded-md overflow-hidden border border-border shadow-inner">
          <video ref={videoRef} playsInline className="w-full h-full object-contain" />
          {(recorderStep === "initial" || recorderStep === "settingUp") && 
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/50 text-white">
              <Loader2 className="h-10 w-10 animate-spin mb-3"/>
              <p className="text-lg">{recorderStep === "initial" ? "Initializing Recorder..." : "Setting up camera..."}</p>
            </div>
          }
          {recorderStep === "recording" && 
            <div className="absolute top-3 right-3 bg-red-600 text-white px-3 py-1.5 rounded-md text-sm font-medium flex items-center gap-2 shadow-lg">
                <Mic className="animate-pulse" /> REC {formatTime(recordingDuration)}
            </div>
          }
           {recorderStep === "review" && recordedVideoUrl && (
              <div className="absolute bottom-0 left-0 right-0 p-2 bg-black/50 flex items-center justify-between">
                 <Button onClick={handlePlayPause} variant="ghost" size="icon" className="text-white hover:text-primary">
                    {isVideoPlaying ? <Pause size={20} /> : <Play size={20} />}
                  </Button>
                  <span className="text-white text-xs">{formatTime(videoRef.current?.currentTime || 0)} / {formatTime(videoRef.current?.duration || 0)}</span>
              </div>
            )}
        </div>
        
        {/* Action Buttons based on step */}
        <div className="space-y-3">
          {recorderStep === "readyToRecord" && (
            <Button onClick={startRecording} className="w-full gap-2 text-lg py-3 bg-green-600 hover:bg-green-700 shadow-md"><Mic /> Start Recording</Button>
          )}
          {recorderStep === "recording" && (
            <Button onClick={stopRecording} variant="destructive" className="w-full gap-2 text-lg py-3 shadow-md"><Square /> Stop Recording</Button>
          )}
          {(recorderStep === "review" || recorderStep === "success" || recorderStep === "uploading") && ( // Allow reset from uploading if stuck
            <Button onClick={resetRecorderInterface} variant="outline" className="w-full gap-2 shadow-sm"><RefreshCcw /> Record Another Video</Button>
          )}
        </div>
        
        {recorderStep === "generatingThumbnails" && (
             <div className="text-center py-4"><Loader2 className="h-6 w-6 animate-spin text-primary mx-auto mb-2" /><p>Generating thumbnails...</p></div>
        )}

        {recorderStep === "review" && !isProcessing && potentialThumbnails.some(t => t) && (
            <div className="pt-4 border-t border-border">
              <Label className="mb-2 block text-base font-medium">Select Thumbnail <span className="text-destructive">*</span></Label>
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                {potentialThumbnails.map((thumbUrl, index) => (
                  thumbUrl ? (
                    <button key={index} type="button" onClick={() => setSelectedThumbnailIndex(index)}
                      className={`relative aspect-video rounded-md overflow-hidden border-2 transition-all shadow-sm hover:opacity-80
                          ${selectedThumbnailIndex === index ? 'border-primary ring-2 ring-primary/50' : 'border-muted hover:border-primary/50'}`}>
                      <NextImage src={thumbUrl} alt={`Thumbnail ${index + 1}`} fill sizes="100px" className="object-cover" data-ai-hint="video thumbnail" />
                      {selectedThumbnailIndex === index && <div className="absolute inset-0 bg-primary/60 flex items-center justify-center"><CheckCircle size={24} className="text-white"/></div>}
                    </button>
                  ) : (
                    <div key={index} className="aspect-video bg-muted/50 rounded-md flex items-center justify-center border border-dashed border-border"><ImageIcon size={24} className="text-muted-foreground"/></div>
                  )
                ))}
              </div>
              {selectedThumbnailIndex === null && <p className="text-xs text-destructive mt-1">Please select a thumbnail.</p>}
            </div>
        )}
        
        {recorderStep === "review" && !isProcessing && (
            <form onSubmit={handleUploadToFirebase} className="space-y-4 pt-6 border-t border-border" id="web-video-upload-form">
                <h3 className="text-xl font-semibold font-headline">Video Details</h3>
                <div className="space-y-1"><Label htmlFor="title">Title <span className="text-destructive">*</span></Label><Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} required /></div>
                <div className="space-y-1"><Label htmlFor="description">Description</Label><Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} rows={3}/></div>
                <div className="space-y-1"><Label htmlFor="keywords">Keywords (comma-separated)</Label><Input id="keywords" value={keywords} onChange={(e) => setKeywords(e.target.value)} /></div>
                <div className="flex items-center space-x-2"><Checkbox id="featured" checked={featured} onCheckedChange={(checked) => setFeatured(Boolean(checked))} /><Label htmlFor="featured" className="font-normal text-sm">Feature this video (show in Recent Activities)</Label></div>
                
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                    <Button type="button" onClick={handleLocalSave} variant="outline" className="w-full gap-2 shadow-sm" disabled={!canSaveLocally || isLocallySaved}>
                        <Download /> {isLocallySaved ? "Saved Locally" : "Save to Device"}
                    </Button>
                    <Button type="submit" form="web-video-upload-form" className="w-full gap-2 bg-primary hover:bg-primary/90 shadow-md" disabled={!canUpload || isProcessing}>
                        {isProcessing && recorderStep==="uploading" ? <Loader2 className="animate-spin"/> : <UploadCloud />} Upload to Firebase
                    </Button>
                </div>
            </form>
        )}

        {recorderStep === "uploading" && (
            <div className="space-y-2 pt-4 border-t border-border">
                <Label>Upload Progress</Label><Progress value={uploadProgress} className="w-full h-3 shadow-inner" /><p className="text-sm text-center text-muted-foreground">{Math.round(uploadProgress)}%</p>
            </div>
        )}
      </CardContent>
    </Card>
    </div>
  );
}
