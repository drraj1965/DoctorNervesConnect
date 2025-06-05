
"use client";

import { useEffect, useRef, useState, ChangeEvent } from "react";
import { getStorage, ref as firebaseStorageRef, uploadBytes, getDownloadURL } from "firebase/storage"; // Renamed ref to avoid conflict
import { getFirestore, doc, setDoc, serverTimestamp } from "firebase/firestore"; // Added serverTimestamp
import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Loader2, Video, Mic, Square, Download, UploadCloud, AlertCircle, CheckCircle, Image as ImageIcon, RotateCw, Camera, RefreshCcw, Film, PlaySquare, Sparkles } from "lucide-react";
import NextImage from 'next/image'; // For displaying thumbnails
import { v4 as uuidv4 } from 'uuid';
import { db, storage as fbStorage } from "@/lib/firebase/config"; // Use fbStorage for clarity
import { addVideoMetadataToFirestore } from "./actions";
import type { VideoDataForCreation } from "@/types";
import { useToast } from '@/hooks/use-toast';


// Helper to parse "hh:mm:ss.mmm" or "mm:ss.mmm" or "ss.mmm" to seconds
const parseTimestampToSeconds = (ts: string): number | null => {
  const parts = ts.split(/[:.]/);
  let hours = 0, minutes = 0, seconds = 0, milliseconds = 0;

  if (parts.length === 1) { // ss or ss.mmm
    const val = parseFloat(parts[0]);
    if (isNaN(val)) return null;
    return val;
  } else if (parts.length === 2) { // mm:ss or ss.mmm (already handled by length 1 if no colon)
     if (ts.includes(':')) { // mm:ss
        minutes = parseInt(parts[0], 10);
        seconds = parseInt(parts[1], 10);
     } else { // ss.mmm
        seconds = parseInt(parts[0], 10);
        milliseconds = parseInt(parts[1], 10);
     }
  } else if (parts.length === 3) { // hh:mm:ss or mm:ss.mmm
    if (ts.split(':').length === 3) { // hh:mm:ss
        hours = parseInt(parts[0], 10);
        minutes = parseInt(parts[1], 10);
        seconds = parseInt(parts[2], 10);
    } else { // mm:ss.mmm
        minutes = parseInt(parts[0], 10);
        seconds = parseInt(parts[1], 10);
        milliseconds = parseInt(parts[2], 10);
    }
  } else if (parts.length === 4) { // hh:mm:ss.mmm
    hours = parseInt(parts[0], 10);
    minutes = parseInt(parts[1], 10);
    seconds = parseInt(parts[2], 10);
    milliseconds = parseInt(parts[3], 10);
  } else {
    return null;
  }

  if (isNaN(hours) || isNaN(minutes) || isNaN(seconds) || isNaN(milliseconds)) {
    return null;
  }
  return hours * 3600 + minutes * 60 + seconds + milliseconds / 1000;
};


// Helper function to convert data URL to Blob
function dataURLtoBlob(dataurl: string): Blob | null {
  try {
    const arr = dataurl.split(',');
    if (arr.length < 2) return null;
    const mimeMatch = arr[0].match(/:(.*?);/);
    if (!mimeMatch || mimeMatch.length < 2) return null;
    const mime = mimeMatch[1];
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    return new Blob([u8arr], { type: mime });
  } catch (e) {
    console.error("Error converting data URL to blob:", e);
    return null;
  }
}


export default function VideoRecorder() {
  const videoRef = useRef<HTMLVideoElement | null>(null); // For live preview
  const previewRef = useRef<HTMLVideoElement | null>(null); // For recorded preview
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);

  const [isRecording, setIsRecording] = useState(false);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordedUrl, setRecordedUrl] = useState<string>("");
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  
  const [thumbnailDataUrls, setThumbnailDataUrls] = useState<string[]>([]); // Stores data URLs from canvas
  const [selectedThumbnailDataUrl, setSelectedThumbnailDataUrl] = useState<string | null>(null);
  
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [keywords, setKeywords] = useState("");
  const [duration, setDuration] = useState(0); // Store duration in seconds
  const [timer, setTimer] = useState(0);
  const recordingTimerIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  const { user: currentUser, doctorProfile, isAdmin, loading: authLoading } = useAuth(); // Renamed user to currentUser
  const router = useRouter();
  const { toast } = useToast();

  const [customTimestamp, setCustomTimestamp] = useState("00:00:02.000"); // Default to 2s
  const [isGeneratingThumbnails, setIsGeneratingThumbnails] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [previewRotation, setPreviewRotation] = useState(0);
  const actualMimeTypeRef = useRef<string>('');

  useEffect(() => {
    if (!authLoading && !isAdmin) {
      toast({ title: "Access Denied", description: "You must be an admin to access this page.", variant: "destructive" });
      router.replace('/dashboard');
    }
  }, [authLoading, isAdmin, router, toast]);

  const setupMediaStream = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: { echoCancellation: true },
      });
      setMediaStream(stream);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      console.error("Error accessing media devices:", err);
      setErrorMessage(`Failed to access camera/microphone: ${err instanceof Error ? err.message : String(err)}.`);
      toast({ variant: "destructive", title: "Media Error", description: `Failed to access camera/microphone: ${err instanceof Error ? err.message : String(err)}.` });
    }
  };

  useEffect(() => {
    if (isAdmin && !authLoading) {
      setupMediaStream();
    }
    return () => {
      mediaStream?.getTracks().forEach(track => track.stop());
      if (recordedUrl && recordedUrl.startsWith('blob:')) {
        URL.revokeObjectURL(recordedUrl);
      }
      // Data URLs (thumbnailDataUrls) do not need to be revoked.
      // Only revoke if you were creating blob URLs for thumbnails previously.
      thumbnailDataUrls.forEach(url => { 
        if (url && url.startsWith('blob:')) { // Check if it's a blob URL before revoking
          URL.revokeObjectURL(url); 
        }
      });
      if (recordingTimerIntervalRef.current) clearInterval(recordingTimerIntervalRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, authLoading]);


  const getSupportedMimeType = () => {
    const types = [
      'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm',
      'video/mp4;codecs=avc1.4D401E', 'video/mp4;codecs=avc1.42E01E', 'video/mp4;codecs=h264',
      'video/mp4', 'video/quicktime',
    ];
    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) return type;
    }
    console.warn("No strongly preferred MIME type supported. Falling back to default.");
    return 'video/webm'; // Fallback
  };

  const startRecording = () => {
    if (!mediaStream || !mediaStream.active) {
      setErrorMessage("Camera/mic stream is not active. Please ensure permissions are granted.");
      toast({ variant: "destructive", title: "Stream Error", description: "Camera/mic stream not active." });
      setupMediaStream(); // Attempt to re-setup
      return;
    }

    // Reset states for new recording
    setRecordedBlob(null);
    if (recordedUrl && recordedUrl.startsWith('blob:')) URL.revokeObjectURL(recordedUrl);
    setRecordedUrl("");
    // Data URLs (from canvas) don't need explicit revocation for array reset
    setThumbnailDataUrls([]); 
    setSelectedThumbnailDataUrl(null);
    recordedChunksRef.current = [];
    setTimer(0);
    setDuration(0);
    setErrorMessage(null);
    setSuccessMessage(null);


    const mimeType = getSupportedMimeType();
    actualMimeTypeRef.current = mimeType;
    const options: MediaRecorderOptions = { mimeType };

    try {
      const recorder = new MediaRecorder(mediaStream, options);
      mediaRecorderRef.current = recorder;

      recorder.onstart = () => {
        if (recorder.mimeType) actualMimeTypeRef.current = recorder.mimeType;
        setIsRecording(true);
        setTimer(0); // Reset timer on actual start
        if (recordingTimerIntervalRef.current) clearInterval(recordingTimerIntervalRef.current);
        recordingTimerIntervalRef.current = setInterval(() => setTimer(t => t + 1), 1000);
      };

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        setIsRecording(false);
        if (recordingTimerIntervalRef.current) clearInterval(recordingTimerIntervalRef.current);
        
        if (recordedChunksRef.current.length === 0) {
            setErrorMessage("No video data was recorded. The recording might have been too short or an issue occurred.");
            toast({variant: "destructive", title: "Recording Failed", description: "No video data."});
            return;
        }

        const blob = new Blob(recordedChunksRef.current, { type: actualMimeTypeRef.current || mimeType });
        
        if (blob.size === 0) {
             setErrorMessage("Recording resulted in an empty file. Please try again.");
             toast({variant: "destructive", title: "Recording Failed", description: "Empty file."});
             return;
        }
        
        setRecordedBlob(blob);
        const videoURL = URL.createObjectURL(blob);
        setRecordedUrl(videoURL);

        if (previewRef.current) {
          previewRef.current.srcObject = null; // Clear live stream
          previewRef.current.src = videoURL;
          previewRef.current.muted = false;
          previewRef.current.controls = true;
          previewRef.current.onloadedmetadata = () => {
            if (previewRef.current) {
              setDuration(previewRef.current.duration);
            }
          };
          previewRef.current.load(); // Important for some browsers to update
        }
      };
      recorder.onerror = (event) => {
        console.error("MediaRecorder error:", event);
        setErrorMessage(`Recording error: ${ (event as any)?.error?.name || 'Unknown error'}`);
        toast({variant: "destructive", title: "Recording Error", description: (event as any)?.error?.name});
        setIsRecording(false);
        if (recordingTimerIntervalRef.current) clearInterval(recordingTimerIntervalRef.current);
      };
      recorder.start();
    } catch (e) {
      console.error("Failed to start MediaRecorder:", e);
      setErrorMessage(`Failed to start recorder: ${e instanceof Error ? e.message : String(e)}`);
      toast({variant: "destructive", title: "Recorder Start Failed", description: e instanceof Error ? e.message : String(e)});
      setIsRecording(false);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    if (isRecording) setIsRecording(false);
    if (recordingTimerIntervalRef.current) clearInterval(recordingTimerIntervalRef.current);
  };

  const generateThumbnailFromCanvas = async (timestamp: number): Promise<string | null> => {
    if (!previewRef.current || !previewRef.current.src || !previewRef.current.videoWidth || !previewRef.current.videoHeight) {
        console.warn("Preview element not ready or has no dimensions for thumbnail generation at", timestamp);
        return null;
    }
    
    const videoElement = previewRef.current;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    if (!ctx) return null;

    canvas.width = videoElement.videoWidth;
    canvas.height = videoElement.videoHeight;

    const originalCurrentTime = videoElement.currentTime;
    const originalPausedState = videoElement.paused;

    if (!originalPausedState && !videoElement.ended) { // Only pause if playing and not ended
       try {
        await videoElement.pause();
       } catch(e) {
        console.warn("Error pausing video for thumbnail:", e);
        // Continue, drawing might still work if seeked correctly
       }
    }
    
    videoElement.currentTime = timestamp;

    return new Promise((resolve, reject) => {
        const onSeeked = () => {
            videoElement.removeEventListener('seeked', onSeeked);
            videoElement.removeEventListener('error', onError);
            try {
                ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
                const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
                if (!originalPausedState && !videoElement.ended) videoElement.play().catch(e => console.warn("Error re-playing video after thumbnail",e));
                else videoElement.currentTime = originalCurrentTime;
                resolve(dataUrl);
            } catch (e) {
                console.error("Canvas drawImage error:", e);
                if (!originalPausedState && !videoElement.ended) videoElement.play().catch(e => console.warn("Error re-playing video after thumbnail error",e));
                else videoElement.currentTime = originalCurrentTime;
                reject(e);
            }
        };
        const onError = (e: Event) => {
            videoElement.removeEventListener('seeked', onSeeked);
            videoElement.removeEventListener('error', onError);
            console.error("Video seeking error for thumbnail:", e);
            if (!originalPausedState && !videoElement.ended) videoElement.play().catch(playErr => console.warn("Error re-playing video after seek error",playErr));
            else videoElement.currentTime = originalCurrentTime;
            reject(new Error("Video seeking error for thumbnail"));
        };

        videoElement.addEventListener('seeked', onSeeked);
        videoElement.addEventListener('error', onError);

        setTimeout(() => {
            videoElement.removeEventListener('seeked', onSeeked);
            videoElement.removeEventListener('error', onError);
            if (!originalPausedState && !videoElement.ended) videoElement.play().catch(e => console.warn("Error re-playing video after timeout",e));
            else videoElement.currentTime = originalCurrentTime;
            reject(new Error("Thumbnail generation timeout for time: " + timestamp));
        }, 5000);
    });
  };
  
  const handleGenerateThumbnailsWithCanvas = async () => {
    if (!previewRef.current || !recordedBlob || recordedBlob.size === 0 || !previewRef.current.duration || previewRef.current.duration === Infinity) {
      setErrorMessage("Video preview or duration is not available for thumbnail generation.");
      toast({variant: "destructive", title: "Thumbnail Error", description: "Video not ready for thumbnails."});
      return;
    }
    setIsGeneratingThumbnails(true);
    setErrorMessage(null);
    setThumbnailDataUrls([]); // Clear previous data URLs

    const videoElement = previewRef.current;
    const videoDuration = videoElement.duration;
    
    const timestamps: number[] = [];
    if (videoDuration > 1) timestamps.push(Math.min(1, videoDuration - 0.01));
    if (videoDuration > 3) timestamps.push(Math.min(3, videoDuration - 0.01));
    if (videoDuration > 5) timestamps.push(Math.min(5, videoDuration - 0.01));
    
    const parsedCustomTimestamp = parseTimestampToSeconds(customTimestamp);
    if (parsedCustomTimestamp !== null && parsedCustomTimestamp > 0 && parsedCustomTimestamp < videoDuration) {
      if (!timestamps.includes(parsedCustomTimestamp)) {
        timestamps.push(parsedCustomTimestamp);
      }
    }
    if (timestamps.length === 0 && videoDuration > 0.1) {
        timestamps.push(Math.max(0.01, Math.min(0.1, videoDuration - 0.01)));
        if (videoDuration > 0.5) timestamps.push(Math.max(0.01, Math.min(0.5, videoDuration - 0.01)));
    }

    const uniqueTimestamps = [...new Set(timestamps)].sort((a, b) => a - b).slice(0, 4);

    const generatedThumbs: string[] = [];
    for (const ts of uniqueTimestamps) {
      try {
        const dataUrl = await generateThumbnailFromCanvas(ts); // Pass timestamp directly
        if (dataUrl) {
          generatedThumbs.push(dataUrl);
        }
      } catch (e) {
        console.error(`Failed to generate thumbnail at ${ts}s:`, e);
      }
    }

    setThumbnailDataUrls(generatedThumbs);
    if (generatedThumbs.length > 0) {
      setSelectedThumbnailDataUrl(generatedThumbs[0]);
    } else {
      setSelectedThumbnailDataUrl(null);
      setErrorMessage("Could not generate any thumbnails. Try a different custom timestamp or re-record.");
      toast({variant: "destructive", title: "Thumbnail Generation Failed", description: "No thumbnails could be created."});
    }
    setIsGeneratingThumbnails(false);
  };

  const saveLocally = () => {
    if (!recordedBlob) {
      toast({ variant: "destructive", title: "No Video", description: "No recorded video to save." });
      return;
    }
    const urlToSave = recordedUrl || URL.createObjectURL(recordedBlob); // Use existing recordedUrl if available
    const a = document.createElement("a");
    a.href = urlToSave;
    const safeTitle = title.replace(/[^a-z0-9_]+/gi, '_').toLowerCase() || 'recorded_video';
    const extension = actualMimeTypeRef.current.split('/')[1]?.split(';')[0] || 'webm';
    a.download = `${safeTitle}_${Date.now()}.${extension}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Only revoke if we created a new object URL specifically for download
    if (!recordedUrl) URL.revokeObjectURL(urlToSave); 
    toast({ title: "Video Saved Locally", description: `Video saved as ${a.download}` });
  };


  const handleUpload = async () => {
    if (!recordedBlob || !selectedThumbnailDataUrl || !title.trim() || !currentUser || !doctorProfile) {
      setErrorMessage("Missing video, thumbnail, title, or user information.");
      toast({variant: "destructive", title: "Upload Error", description: "Missing required fields."});
      return;
    }
    setIsUploading(true);
    setUploadProgress(0);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const thumbnailBlob = dataURLtoBlob(selectedThumbnailDataUrl);
      if (!thumbnailBlob) {
        throw new Error("Failed to convert selected thumbnail to Blob.");
      }

      const videoId = uuidv4();
      const safeTitle = title.replace(/[^a-z0-9_]+/gi, '_').toLowerCase();
      const timestampSuffix = Date.now();
      const videoFileExtension = actualMimeTypeRef.current.split('/')[1]?.split(';')[0] || 'webm';
      
      const videoFileName = `${safeTitle}_${timestampSuffix}.${videoFileExtension}`;
      const videoStoragePath = `videos/${currentUser.uid}/${videoFileName}`;
      const videoFileRef = firebaseStorageRef(fbStorage, videoStoragePath);
      
      await uploadBytes(videoFileRef, recordedBlob);
      const videoUrl = await getDownloadURL(videoFileRef);
      setUploadProgress(50);

      const thumbnailFileName = `thumbnail_${safeTitle}_${timestampSuffix}.jpg`;
      const thumbnailStoragePath = `thumbnails/${currentUser.uid}/${thumbnailFileName}`;
      const thumbnailFileRef = firebaseStorageRef(fbStorage, thumbnailStoragePath);
      await uploadBytes(thumbnailFileRef, thumbnailBlob);
      const thumbnailUrl = await getDownloadURL(thumbnailFileRef);
      setUploadProgress(100);

      const videoData: VideoDataForCreation = {
        id: videoId,
        title,
        description,
        doctorId: currentUser.uid,
        doctorName: doctorProfile.displayName || doctorProfile.email || "Unknown Doctor",
        videoUrl,
        thumbnailUrl,
        duration: formatDuration(duration),
        recordingDuration: Math.round(duration),
        tags: keywords.split(',').map(k => k.trim()).filter(Boolean),
        featured: false,
        storagePath: videoStoragePath,
        thumbnailStoragePath,
        videoSize: recordedBlob.size,
        videoType: recordedBlob.type,
      };

      const result = await addVideoMetadataToFirestore(videoData);

      if (result.success) {
        setSuccessMessage(`Video "${title}" uploaded successfully!`);
        toast({title: "Upload Successful", description: `Video "${title}" is now available.`});
        setTitle(""); setDescription(""); setKeywords(""); setCustomTimestamp("00:00:02.000");
        setRecordedBlob(null); 
        if(recordedUrl && recordedUrl.startsWith('blob:')) URL.revokeObjectURL(recordedUrl);
        setRecordedUrl(""); 
        setThumbnailDataUrls([]); 
        setSelectedThumbnailDataUrl(null);
        setDuration(0); setTimer(0);
        await setupMediaStream(); 
      } else {
        throw new Error(result.error || "Failed to save video metadata.");
      }
    } catch (err) {
      console.error("Upload failed:", err);
      setErrorMessage(err instanceof Error ? err.message : "An unknown error occurred during upload.");
      toast({variant: "destructive", title: "Upload Failed", description: err instanceof Error ? err.message : "Unknown error."});
    } finally {
      setIsUploading(false);
    }
  };

  const formatDuration = (totalSeconds: number): string => {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = Math.floor(totalSeconds % 60);
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  };
  
  const handleRotatePreview = () => {
    setPreviewRotation(current => (current + 90) % 360);
  };

  const resetRecorderInterface = async () => {
    stopRecording(); 
    if (mediaStream) {
        mediaStream.getTracks().forEach(track => track.stop());
        setMediaStream(null);
    }
    setRecordedBlob(null);
    if (recordedUrl && recordedUrl.startsWith('blob:')) URL.revokeObjectURL(recordedUrl);
    setRecordedUrl("");
    setThumbnailDataUrls([]); 
    setSelectedThumbnailDataUrl(null);
    setTitle("");
    setDescription("");
    setKeywords("");
    setCustomTimestamp("00:00:02.000");
    setTimer(0);
    setDuration(0);
    setErrorMessage(null);
    setSuccessMessage(null);
    setIsUploading(false);
    setUploadProgress(0);
    setPreviewRotation(0);
    if (videoRef.current) videoRef.current.srcObject = null;
    if (previewRef.current) {
        previewRef.current.src = "";
        previewRef.current.removeAttribute('src'); // Ensure src is fully cleared
        previewRef.current.load(); // Reset media element state
    }
    
    await setupMediaStream();
    toast({title: "Recorder Reset", description: "Camera re-initialized."});
  };


  if (authLoading) {
    return <div className="flex items-center justify-center h-screen"><Loader2 className="h-12 w-12 animate-spin text-primary" /></div>;
  }

  if (!isAdmin && !authLoading) { // Ensure not to show access denied while auth is still loading
    return <div className="p-4 text-center text-destructive">Access Denied. You must be an admin to use this feature.</div>;
  }

  const canRecord = !!mediaStream && !isRecording && !recordedBlob;
  const canStop = isRecording;
  const showRecordedPreview = !!recordedUrl && !!recordedBlob;
  const canGenerateThumbnails = showRecordedPreview && duration > 0;
  const canUpload = showRecordedPreview && selectedThumbnailDataUrl && title.trim() && !isUploading;

  return (
    <Card className="max-w-2xl mx-auto shadow-xl">
      <CardHeader>
        <CardTitle className="text-2xl font-headline flex items-center gap-2">
          <Camera size={28} className="text-primary" /> Web Video Recorder
        </CardTitle>
        <CardDescription>
          Record video using your browser. Thumbnails are generated using the Canvas API.
          Ensure you grant camera and microphone permissions.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {errorMessage && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        )}
        {successMessage && (
           <Alert variant="default" className="bg-green-100 border-green-400 text-green-700 dark:bg-green-900/30 dark:border-green-600 dark:text-green-300">
            <CheckCircle className="h-4 w-4" />
            <AlertTitle>Success!</AlertTitle>
            <AlertDescription>{successMessage}</AlertDescription>
          </Alert>
        )}

        <div className="relative group w-full aspect-video bg-slate-900 rounded-md overflow-hidden border">
          {!showRecordedPreview && (
            <video ref={videoRef} autoPlay muted playsInline className="w-full h-full object-contain" style={{ transform: `rotate(${previewRotation}deg)` }}/>
          )}
          {showRecordedPreview && (
            <video ref={previewRef} key={recordedUrl} controls playsInline className="w-full h-full object-contain" style={{ transform: `rotate(${previewRotation}deg)` }} >
                 <source src={recordedUrl} type={recordedBlob?.type || 'video/webm'} />
            </video>
          )}
           <Button
              onClick={handleRotatePreview}
              variant="outline"
              size="icon"
              className="absolute top-2 left-2 z-10 bg-black/40 text-white hover:bg-black/60 border-white/30 opacity-0 group-hover:opacity-100 transition-opacity"
              title="Rotate Preview"
            >
              <RotateCw size={18} />
            </Button>
          {isRecording && (
            <div className="absolute top-2 right-2 bg-red-600 text-white px-2 py-1 rounded-md text-xs animate-pulse">
              REC {formatDuration(timer)}
            </div>
          )}
        </div>
        
        {!mediaStream && !authLoading && isAdmin && ( // Only show if admin and not loading auth
            <Button onClick={setupMediaStream} className="w-full gap-2" variant="outline">
                <Camera size={18}/> Setup Camera & Mic
            </Button>
        )}

        <div className="flex flex-col sm:flex-row gap-2">
          {canRecord && (
            <Button onClick={startRecording} className="flex-1 gap-2 bg-green-600 hover:bg-green-700">
              <Mic size={18} /> Start Recording
            </Button>
          )}
          {canStop && (
            <Button onClick={stopRecording} className="flex-1 gap-2 bg-red-600 hover:bg-red-700">
              <Square size={18} /> Stop Recording
            </Button>
          )}
        </div>

        {showRecordedPreview && (
          <div className="space-y-4 pt-4 border-t">
            <div className="flex flex-col sm:flex-row gap-2">
                <Button onClick={handleGenerateThumbnailsWithCanvas} disabled={isGeneratingThumbnails || !canGenerateThumbnails} className="flex-1 gap-2" variant="secondary">
                {isGeneratingThumbnails ? <Loader2 className="animate-spin" /> : <Sparkles size={18} />}
                Generate Thumbnails
                </Button>
                <Button onClick={saveLocally} variant="outline" className="flex-1 gap-2">
                    <Download size={18} /> Save to Device
                </Button>
            </div>

            {isGeneratingThumbnails && <p className="text-sm text-center text-muted-foreground">Generating thumbnails...</p>}
            
            {thumbnailDataUrls.length > 0 && (
              <div className="space-y-2">
                <Label>Select Thumbnail</Label>
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                  {thumbnailDataUrls.map((thumbUrl, idx) => (
                    thumbUrl ? ( // Ensure thumbUrl is not null before rendering
                      <button
                        key={idx}
                        type="button"
                        onClick={() => setSelectedThumbnailDataUrl(thumbUrl)}
                        className={`relative aspect-video rounded-md overflow-hidden border-2 transition-all
                          ${selectedThumbnailDataUrl === thumbUrl ? 'border-primary ring-2 ring-primary/50' : 'border-muted hover:border-primary/50'}`}
                      >
                        <NextImage src={thumbUrl} alt={`Thumbnail ${idx + 1}`} fill sizes="(max-width: 768px) 30vw, 15vw" className="object-cover" data-ai-hint="video thumbnail preview"/>
                        {selectedThumbnailDataUrl === thumbUrl && (
                          <div className="absolute inset-0 bg-primary/50 flex items-center justify-center">
                            <CheckCircle size={24} className="text-white opacity-90" />
                          </div>
                        )}
                      </button>
                    ) : null // Do not render if thumbUrl is null
                  ))}
                </div>
              </div>
            )}


            <div className="space-y-1">
              <Label htmlFor="customTimestamp" className="text-xs">Custom Thumbnail Time (e.g., 5 or 01:10.500)</Label>
              <Input
                id="customTimestamp"
                type="text"
                value={customTimestamp}
                onChange={(e) => setCustomTimestamp(e.target.value)}
                placeholder="E.g., 5 or 00:00:05.000"
                className="text-sm"
              />
            </div>
            
            <div className="space-y-1">
              <Label htmlFor="title">Title <span className="text-destructive">*</span></Label>
              <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Enter video title" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="description">Description</Label>
              <Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Describe your video" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="keywords">Keywords (comma-separated)</Label>
              <Input id="keywords" value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="e.g., health, tutorial, nerves" />
            </div>

            <Button onClick={handleUpload} disabled={!canUpload} className="w-full gap-2">
              {isUploading ? <Loader2 className="animate-spin" /> : <UploadCloud size={18} />}
              {isUploading ? `Uploading... ${uploadProgress.toFixed(0)}%` : 'Upload Video'}
            </Button>
            {isUploading && <Progress value={uploadProgress} className="w-full h-2" />}
          </div>
        )}
      </CardContent>
      <CardFooter>
         <Button onClick={resetRecorderInterface} variant="outline" className="w-full gap-2">
            <RefreshCcw size={18}/> Reset Recorder & Camera
        </Button>
      </CardFooter>
    </Card>
  );
}

