
"use client";

import React, { useEffect, useRef, useState, useCallback, FormEvent } from "react";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { Loader2, Video, Mic, Square, UploadCloud, AlertCircle, CheckCircle, RotateCw, Camera, RefreshCcw, Film, Download, Image as ImageIcon, Sparkles } from "lucide-react";
import { v4 as uuidv4 } from 'uuid';
import Image from 'next/image';
import { uploadFileToStorage, getFirebaseStorageDownloadUrl } from "@/lib/firebase/storage";
import { addVideoMetadataToFirestore } from "@/components/video/actions"; 
import type { VideoDataForCreation, VideoMeta } from "@/types";
import { useToast } from "@/hooks/use-toast";

const NUM_THUMBNAILS_TO_GENERATE = 3;

type RecorderStep = "initial" | "settingUp" | "readyToRecord" | "recording" | "previewReady" | "generatingThumbnails" | "thumbnailsReady" | "uploading" | "success";

export default function VideoRecorder() {
  const { user, doctorProfile, isAdmin, loading: authLoading } = useAuth();
  const { toast } = useToast();

  const liveVideoRef = useRef<HTMLVideoElement | null>(null);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  
  const [recorderStep, setRecorderStep] = useState<RecorderStep>("initial");
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const [recordedVideoBlob, setRecordedVideoBlob] = useState<Blob | null>(null);
  const [recordedVideoUrl, setRecordedVideoUrl] = useState<string | null>(null); // Object URL for recorded video
  const [recordingDuration, setRecordingDuration] = useState(0); // in seconds
  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);
  
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [keywords, setKeywords] = useState('');
  const [featured, setFeatured] = useState(false);

  const [potentialThumbnails, setPotentialThumbnails] = useState<(string | null)[]>(Array(NUM_THUMBNAILS_TO_GENERATE).fill(null)); // data URLs
  const [potentialThumbnailBlobs, setPotentialThumbnailBlobs] = useState<(Blob | null)[]>(Array(NUM_THUMBNAILS_TO_GENERATE).fill(null));
  const [selectedThumbnailIndex, setSelectedThumbnailIndex] = useState<number | null>(null);
  
  const [error, setError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false); // General processing state

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
  }, [recordedVideoUrl]);

  const cleanupThumbnails = useCallback(() => {
    potentialThumbnails.forEach(url => {
      if (url && url.startsWith('blob:')) { // Only revoke if it was a blob URL, data URLs don't need it
        URL.revokeObjectURL(url);
      }
    });
    setPotentialThumbnails(Array(NUM_THUMBNAILS_TO_GENERATE).fill(null));
    setPotentialThumbnailBlobs(Array(NUM_THUMBNAILS_TO_GENERATE).fill(null));
    setSelectedThumbnailIndex(null);
  }, [potentialThumbnails]);


  const requestPermissionsAndSetup = useCallback(async () => {
    if (mediaStream && mediaStream.active) return; // Already setup
    setRecorderStep("settingUp");
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: { echoCancellation: true },
      });
      if (!stream.active || stream.getVideoTracks().length === 0 || stream.getVideoTracks()[0].readyState !== 'live') {
        throw new Error("Camera stream is not active or missing tracks.");
      }
      setMediaStream(stream);
      if (liveVideoRef.current) {
        liveVideoRef.current.srcObject = stream;
        liveVideoRef.current.muted = true;
        await liveVideoRef.current.play().catch(e => console.warn("Error playing live preview:", e));
      }
      setRecorderStep("readyToRecord");
    } catch (err) {
      console.error("VideoRecorder: Error accessing media devices:", err);
      setError(`Failed to access camera/microphone: ${err instanceof Error ? err.message : String(err)}.`);
      setRecorderStep("initial"); // Back to initial if setup fails
    }
  }, [mediaStream]);

  useEffect(() => {
    if (!authLoading && isAdmin) {
      requestPermissionsAndSetup();
    }
    return () => {
      cleanupStream();
      cleanupRecordedVideo();
      cleanupThumbnails();
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, isAdmin]); // requestPermissionsAndSetup is memoized


  const getSupportedMimeType = () => {
    const types = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) return type;
    }
    return 'video/webm'; // Fallback
  };

  const startRecording = () => {
    if (!mediaStream || !mediaStream.active || recorderStep !== "readyToRecord") {
      setError("Media stream not ready or not in correct state. Please ensure camera/mic permissions are granted and try re-initializing.");
      requestPermissionsAndSetup(); // Attempt to re-setup
      return;
    }
    cleanupRecordedVideo();
    cleanupThumbnails();
    recordedChunksRef.current = [];
    setRecordingDuration(0);
    setError(null);

    const mimeType = getSupportedMimeType();
    try {
      const recorder = new MediaRecorder(mediaStream, { mimeType });
      mediaRecorderRef.current = recorder;

      recorder.onstart = () => {
        setRecorderStep("recording");
        if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = setInterval(() => {
          setRecordingDuration(prev => prev + 1);
        }, 1000);
      };

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) recordedChunksRef.current.push(event.data);
      };

      recorder.onstop = () => {
        if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
        if (recordedChunksRef.current.length === 0) {
          setError("No video data was recorded. The recording might have been too short or an issue occurred.");
          setRecorderStep("readyToRecord");
          return;
        }
        const blob = new Blob(recordedChunksRef.current, { type: mimeType });
        setRecordedVideoBlob(blob);
        const url = URL.createObjectURL(blob);
        setRecordedVideoUrl(url);
        setRecorderStep("previewReady");
        if (liveVideoRef.current) liveVideoRef.current.srcObject = null; // Stop live preview
      };
      
      recorder.onerror = (event) => {
        console.error("MediaRecorder error:", event);
        setError("A recording error occurred.");
        if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
        setRecorderStep("readyToRecord");
      }

      recorder.start();
    } catch (e) {
      console.error("Failed to start MediaRecorder:", e);
      setError(`Failed to start recorder: ${e instanceof Error ? e.message : String(e)}.`);
      setRecorderStep("readyToRecord");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    // onstop handler will set the step
  };
  
  const formatTime = (totalSeconds: number): string => {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = Math.floor(totalSeconds % 60);
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  };

  const generateSingleThumbnail = useCallback(async (videoElement: HTMLVideoElement, timestamp: number): Promise<string | null> => {
    return new Promise((resolve) => {
      if (!videoElement.HAVE_METADATA) { // Ensure metadata is loaded for duration check
        console.warn("generateSingleThumbnail: Video metadata not loaded for thumbnail generation at", timestamp);
        resolve(null);
        return;
      }
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) { resolve(null); return; }

      const actualTimestamp = Math.min(timestamp, videoElement.duration - 0.01); // Ensure not beyond duration
      videoElement.currentTime = Math.max(0.01, actualTimestamp);

      videoElement.onseeked = () => {
        canvas.width = videoElement.videoWidth;
        canvas.height = videoElement.videoHeight;
        if(canvas.width === 0 || canvas.height === 0) {
          console.warn("generateSingleThumbnail: Canvas dimensions are zero at timestamp", timestamp);
          resolve(null);
          return;
        }
        ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.85)); // Quality 0.85
        videoElement.onseeked = null; // Clean up listener
      };
      videoElement.onerror = () => {
        console.error("generateSingleThumbnail: Error during video seek/draw for thumbnail at", timestamp);
        resolve(null);
        videoElement.onseeked = null;
        videoElement.onerror = null;
      }
    });
  }, []);


  const handleGenerateThumbnails = useCallback(async () => {
    if (!previewVideoRef.current || !recordedVideoBlob || !recordedVideoUrl) {
      setError("Recorded video not available for thumbnail generation.");
      return;
    }
    setRecorderStep("generatingThumbnails");
    setIsProcessing(true);
    const videoElement = previewVideoRef.current;

    // Ensure video metadata is loaded (needed for duration)
    if (videoElement.readyState < videoElement.HAVE_METADATA) {
      await new Promise(resolve => { videoElement.onloadedmetadata = resolve; });
    }
    
    const duration = videoElement.duration;
    if (!duration || !Number.isFinite(duration) || duration <= 0) {
      setError("Video duration is invalid or zero. Cannot generate thumbnails effectively.");
      setIsProcessing(false);
      setRecorderStep("previewReady");
      return;
    }

    const timestamps = [];
    if (duration < 1) {
        timestamps.push(duration / 2);
    } else if (duration < 5) {
        timestamps.push(duration * 0.25, duration * 0.75);
    } else {
        for (let i = 0; i < NUM_THUMBNAILS_TO_GENERATE; i++) {
            timestamps.push((duration / (NUM_THUMBNAILS_TO_GENERATE + 1)) * (i + 1));
        }
    }
    
    const validTimestamps = timestamps.filter(t => t > 0 && t < duration).slice(0, NUM_THUMBNAILS_TO_GENERATE);
    if(validTimestamps.length === 0 && duration > 0) validTimestamps.push(duration * 0.1); // At least one thumbnail if possible


    const generatedDataUrls: (string | null)[] = [];
    const generatedBlobs: (Blob | null)[] = [];

    for (const ts of validTimestamps) {
      const dataUrl = await generateSingleThumbnail(videoElement, ts);
      generatedDataUrls.push(dataUrl);
      if (dataUrl) {
        const blob = await (await fetch(dataUrl)).blob();
        generatedBlobs.push(blob);
      } else {
        generatedBlobs.push(null);
      }
    }
    // Pad if fewer than NUM_THUMBNAILS_TO_GENERATE were created
    while (generatedDataUrls.length < NUM_THUMBNAILS_TO_GENERATE) generatedDataUrls.push(null);
    while (generatedBlobs.length < NUM_THUMBNAILS_TO_GENERATE) generatedBlobs.push(null);

    setPotentialThumbnails(generatedDataUrls);
    setPotentialThumbnailBlobs(generatedBlobs);
    const firstValidIndex = generatedBlobs.findIndex(b => b !== null);
    setSelectedThumbnailIndex(firstValidIndex !== -1 ? firstValidIndex : null);
    setIsProcessing(false);
    setRecorderStep("thumbnailsReady");
    if (firstValidIndex === -1) {
        setError("Failed to generate any thumbnails. You can still try to upload.");
    }
  }, [recordedVideoBlob, recordedVideoUrl, generateSingleThumbnail]);
  
  const dataURLtoBlob = async (dataurl: string): Promise<Blob> => {
    const res = await fetch(dataurl);
    const blob = await res.blob();
    return blob;
  };

  const handleUpload = async (e: FormEvent) => {
    e.preventDefault();
    if (!recordedVideoBlob || selectedThumbnailIndex === null || !potentialThumbnailBlobs[selectedThumbnailIndex]) {
      setError("Video or selected thumbnail is missing.");
      return;
    }
    if (!title.trim()) {
      setError("Video title is required.");
      return;
    }
    if (!user || !doctorProfile || !isAdmin) { // Assuming only admins can upload this way
      setError("Authentication error or insufficient permissions.");
      return;
    }
    
    setRecorderStep("uploading");
    setIsProcessing(true);
    setUploadProgress(0);
    setError(null);

    try {
      const videoId = uuidv4();
      const videoFileExtension = recordedVideoBlob.type.split('/')[1] || 'webm';
      const videoFileName = `${videoId}_${title.replace(/[^a-zA-Z0-9]/g, '_') || 'video'}.${videoFileExtension}`;
      const thumbnailFileName = `${videoId}_thumbnail.jpg`;

      const videoStoragePath = await uploadFileToStorage(`videos/${doctorProfile.uid}`, recordedVideoBlob, videoFileName, 
        (snapshot) => setUploadProgress(Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 0.8 * 100)) // 80% for video
      );
      const videoUrl = await getFirebaseStorageDownloadUrl(videoStoragePath);
      setUploadProgress(80);

      const thumbnailBlobToUpload = potentialThumbnailBlobs[selectedThumbnailIndex!];
      if (!thumbnailBlobToUpload) throw new Error("Selected thumbnail blob is invalid");

      const thumbnailStoragePath = await uploadFileToStorage(`thumbnails/${doctorProfile.uid}`, thumbnailBlobToUpload, thumbnailFileName,
        (snapshot) => setUploadProgress(Math.round(80 + (snapshot.bytesTransferred / snapshot.totalBytes) * 0.2 * 100)) // 20% for thumbnail
      );
      const thumbnailUrl = await getFirebaseStorageDownloadUrl(thumbnailStoragePath);
      setUploadProgress(100);

      const videoMetaData: VideoDataForCreation = {
        id: videoId,
        title,
        description,
        doctorId: doctorProfile.uid,
        doctorName: doctorProfile.displayName || doctorProfile.email || "N/A",
        videoUrl,
        thumbnailUrl,
        duration: formatTime(recordingDuration),
        recordingDuration: recordingDuration,
        tags: keywords.split(',').map(k => k.trim()).filter(Boolean),
        featured,
        storagePath: videoStoragePath,
        thumbnailStoragePath: thumbnailStoragePath,
        videoSize: recordedVideoBlob.size,
        videoType: recordedVideoBlob.type,
      };
      
      const result = await addVideoMetadataToFirestore(videoMetaData);

      if (result.success) {
        toast({ title: "Upload Successful!", description: `Video "${title}" is now available.` });
        setRecorderStep("success");
      } else {
        throw new Error(result.error || "Failed to save video metadata.");
      }
    } catch (err) {
      console.error("Upload failed:", err);
      setError(err instanceof Error ? err.message : "An unknown error occurred during upload.");
      setRecorderStep("thumbnailsReady"); // Revert to a state where user can retry if needed
    } finally {
      setIsProcessing(false);
    }
  };
  
  const resetForNewRecording = () => {
    cleanupRecordedVideo();
    cleanupThumbnails();
    setTitle('');
    setDescription('');
    setKeywords('');
    setFeatured(false);
    setRecordingDuration(0);
    setError(null);
    setUploadProgress(0);
    // Re-initialize stream if it was stopped or ensure it's active for liveVideoRef
    if (liveVideoRef.current && mediaStream) {
        liveVideoRef.current.srcObject = mediaStream; // Re-assign if it was cleared
    } else {
        requestPermissionsAndSetup(); // Full setup if stream is gone
    }
    setRecorderStep("readyToRecord");
  };

  // Main render logic
  if (authLoading) {
    return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }
  if (!isAdmin) {
    return <Alert variant="destructive"><AlertCircle /> <AlertTitle>Access Denied</AlertTitle><AlertDescription>You do not have permission to access this feature.</AlertDescription></Alert>;
  }

  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Camera size={24}/> Video Recorder</CardTitle>
        <CardDescription>Record, review, and upload your medical videos.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <Alert variant="destructive"><AlertCircle /> <AlertTitle>Error</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
        {recorderStep === "success" && <Alert variant="default" className="bg-green-100 border-green-400"><CheckCircle /><AlertTitle>Success!</AlertTitle><AlertDescription>Video uploaded successfully.</AlertDescription></Alert>}

        <div className="relative aspect-video bg-muted rounded-md overflow-hidden border">
          {recorderStep !== "previewReady" && recorderStep !== "generatingThumbnails" && recorderStep !== "thumbnailsReady" && recorderStep !== "uploading" && recorderStep !== "success" && (
            <video ref={liveVideoRef} playsInline autoPlay muted className="w-full h-full object-cover" />
          )}
          {(recorderStep === "previewReady" || recorderStep === "generatingThumbnails" || recorderStep === "thumbnailsReady" || recorderStep === "uploading") && recordedVideoUrl && (
            <video ref={previewVideoRef} src={recordedVideoUrl} controls className="w-full h-full object-contain" />
          )}
          {(recorderStep === "initial" || recorderStep === "settingUp") && 
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/30">
              <Loader2 className="h-8 w-8 animate-spin text-white mb-2"/>
              <p className="text-white text-sm">{recorderStep === "initial" ? "Initializing..." : "Setting up camera..."}</p>
            </div>
          }
        </div>
        
        {recorderStep === "recording" && (
            <div className="text-center text-destructive font-medium flex items-center justify-center gap-2">
                <Mic className="animate-pulse" /> Recording... {formatTime(recordingDuration)}
            </div>
        )}


        {/* Controls */}
        <div className="space-y-2">
          {recorderStep === "readyToRecord" && (
            <Button onClick={startRecording} className="w-full gap-2"><Mic /> Start Recording</Button>
          )}
          {recorderStep === "recording" && (
            <Button onClick={stopRecording} variant="destructive" className="w-full gap-2"><Square /> Stop Recording</Button>
          )}
          {(recorderStep === "previewReady" || recorderStep === "thumbnailsReady" || recorderStep === "success") && (
            <Button onClick={resetForNewRecording} variant="outline" className="w-full gap-2"><RefreshCcw /> Record Another</Button>
          )}
        </div>
        
        {recorderStep === "previewReady" && (
            <Button onClick={handleGenerateThumbnails} disabled={isProcessing} className="w-full gap-2">
                {isProcessing ? <Loader2 className="animate-spin" /> : <Sparkles />} Generate Thumbnails
            </Button>
        )}

        {recorderStep === "generatingThumbnails" && (
             <div className="text-center py-4">
              <Loader2 className="h-6 w-6 animate-spin text-primary mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">Generating thumbnails...</p>
            </div>
        )}

        {recorderStep === "thumbnailsReady" && potentialThumbnails.some(t => t) && (
             <div>
              <Label className="mb-2 block text-sm font-medium text-foreground">Select Thumbnail <span className="text-destructive">*</span></Label>
              <div className="grid grid-cols-3 gap-2">
                {potentialThumbnails.map((thumbUrl, index) => (
                  thumbUrl ? (
                    <button
                      key={index} type="button" onClick={() => setSelectedThumbnailIndex(index)}
                      className={`relative aspect-video rounded-md overflow-hidden border-2 transition-all 
                          ${selectedThumbnailIndex === index ? 'border-primary ring-2 ring-primary/50' : 'border-muted hover:border-primary/50'}`}
                    >
                      <Image src={thumbUrl} alt={`Thumbnail ${index + 1}`} fill sizes="100px" className="object-cover" data-ai-hint="video thumbnail" />
                      {selectedThumbnailIndex === index && (
                        <div className="absolute inset-0 bg-primary/50 flex items-center justify-center">
                          <CheckCircle size={20} className="text-white opacity-90" />
                        </div>
                      )}
                    </button>
                  ) : (
                    <div key={index} className="aspect-video bg-muted rounded-md flex items-center justify-center border border-dashed">
                      <ImageIcon size={20} className="text-muted-foreground" />
                    </div>
                  )
                ))}
              </div>
              {selectedThumbnailIndex === null && <p className="text-xs text-destructive mt-1">Please select a thumbnail.</p>}
            </div>
        )}
        
        {recorderStep === "thumbnailsReady" && (
            <form onSubmit={handleUpload} className="space-y-4 pt-4 border-t">
                <div className="space-y-1">
                    <Label htmlFor="videoTitle">Title <span className="text-destructive">*</span></Label>
                    <Input id="videoTitle" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Video Title" required />
                </div>
                <div className="space-y-1">
                    <Label htmlFor="videoDescription">Description</Label>
                    <Textarea id="videoDescription" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Video Description" rows={3} />
                </div>
                <div className="space-y-1">
                    <Label htmlFor="videoKeywords">Keywords (comma-separated)</Label>
                    <Input id="videoKeywords" value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="e.g., neurology, patient education" />
                </div>
                 <div className="flex items-center space-x-2">
                  <input type="checkbox" id="featured" checked={featured} onChange={(e) => setFeatured(e.target.checked)} className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary" />
                  <Label htmlFor="featured" className="font-normal text-sm">Feature this video</Label>
              </div>
                <Button type="submit" disabled={isProcessing || selectedThumbnailIndex === null || !title.trim()} className="w-full gap-2">
                    {isProcessing ? <Loader2 className="animate-spin" /> : <UploadCloud />} Upload Video
                </Button>
            </form>
        )}

        {recorderStep === "uploading" && (
            <div className="space-y-2 pt-4 border-t">
                <Label>Upload Progress</Label>
                <Progress value={uploadProgress} className="w-full h-2.5" />
                <p className="text-sm text-muted-foreground text-center">{Math.round(uploadProgress)}%</p>
            </div>
        )}

      </CardContent>
      {(recorderStep === "previewReady" || recorderStep === "thumbnailsReady" || recorderStep === "success") && (
        <CardFooter className="border-t pt-4">
          <Button onClick={resetForNewRecording} variant="outline" className="w-full gap-2"><RefreshCcw /> Start Over / Record New</Button>
        </CardFooter>
      )}
    </Card>
  );
}
