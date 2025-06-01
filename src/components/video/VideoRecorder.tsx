
"use client";

import { useState, useRef, useEffect, ChangeEvent, FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/context/AuthContext';
import { uploadFileToStorage, getFirebaseStorageDownloadUrl } from '@/lib/firebase/storage';
import { addVideoMetadataToFirestore } from './actions'; // Server action
import { Video, Mic, Square, Play, Download, UploadCloud, AlertCircle, CheckCircle, Loader2, Settings2, Camera } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import type { VideoMeta } from '@/types';
import { useRouter } from 'next/navigation';

type RecordingState = 'idle' | 'permission' | 'recording' | 'paused' | 'stopped' | 'uploading' | 'success' | 'error';

const MAX_RECORDING_TIME_MS = 30 * 60 * 1000; // 30 minutes

export default function VideoRecorder() {
  const { user, doctorProfile, isAdmin } = useAuth();
  const router = useRouter();

  const [recordingState, setRecordingState] = useState<RecordingState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const videoPreviewRef = useRef<HTMLVideoElement | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const [recordedVideoBlob, setRecordedVideoBlob] = useState<Blob | null>(null);
  const [recordedVideoUrl, setRecordedVideoUrl] = useState<string | null>(null);
  const [thumbnailBlob, setThumbnailBlob] = useState<Blob | null>(null);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [keywords, setKeywords] = useState('');
  const [featured, setFeatured] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [duration, setDuration] = useState(0); // in seconds
  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!isAdmin) {
      router.replace('/dashboard'); // Redirect if not admin
    }
    return () => { // Cleanup
      stopMediaStream();
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      if (recordedVideoUrl) URL.revokeObjectURL(recordedVideoUrl);
    };
  }, [isAdmin, router, recordedVideoUrl]);


  const formatTime = (totalSeconds: number): string => {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  };

  const requestPermissionsAndSetup = async () => {
    setError(null);
    setRecordingState('permission');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      mediaStreamRef.current = stream;
      if (videoPreviewRef.current) {
        videoPreviewRef.current.srcObject = stream;
      }
      setRecordingState('idle'); // Ready to record
    } catch (err) {
      console.error("Error accessing media devices:", err);
      setError("Failed to access camera/microphone. Please check permissions and ensure your browser supports media recording.");
      setRecordingState('error');
    }
  };
  
  const startRecording = async () => {
    if (!mediaStreamRef.current) {
      await requestPermissionsAndSetup();
      if (!mediaStreamRef.current) return; // If permission still not granted
    }
    
    if (mediaStreamRef.current && mediaRecorderRef.current?.state !== 'recording') {
      setError(null);
      recordedChunksRef.current = []; // Correctly clear previous recording chunks
      setRecordedVideoBlob(null);
      if (recordedVideoUrl) URL.revokeObjectURL(recordedVideoUrl);
      setRecordedVideoUrl(null);
      setThumbnailBlob(null);
      setDuration(0);

      const options = { mimeType: 'video/webm; codecs=vp9,opus' };
      if (!MediaRecorder.isTypeSupported(options.mimeType)) {
        console.warn(`${options.mimeType} is not supported, trying default.`);
        // @ts-ignore
        delete options.mimeType; 
      }

      try {
        mediaRecorderRef.current = new MediaRecorder(mediaStreamRef.current, options);
      } catch (e) {
        console.error("Error creating MediaRecorder:", e);
        setError("Could not start recording. Browser may not support chosen format or camera/mic is already in use.");
        setRecordingState('error');
        return;
      }

      mediaRecorderRef.current.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };

      mediaRecorderRef.current.onstop = () => {
        const blob = new Blob(recordedChunksRef.current, { type: mediaRecorderRef.current?.mimeType || 'video/webm' });
        setRecordedVideoBlob(blob);
        const url = URL.createObjectURL(blob);
        setRecordedVideoUrl(url);
        setRecordingState('stopped');
        if (videoPreviewRef.current) {
          videoPreviewRef.current.srcObject = null; 
          videoPreviewRef.current.src = url;
          videoPreviewRef.current.controls = true;
          videoPreviewRef.current.onloadedmetadata = () => {
             if(videoPreviewRef.current) setDuration(Math.round(videoPreviewRef.current.duration));
          }
        }
        generateThumbnail(url);
        if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      };
      
      mediaRecorderRef.current.onerror = (event) => {
        console.error("MediaRecorder error:", event);
        setError("An error occurred during recording. Please try again.");
        setRecordingState('error');
         if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      };

      mediaRecorderRef.current.start();
      setRecordingState('recording');
      
      let seconds = 0;
      recordingTimerRef.current = setInterval(() => {
        seconds++;
        setDuration(seconds);
        if (seconds * 1000 >= MAX_RECORDING_TIME_MS) {
          stopRecording();
           setError("Maximum recording time reached (30 minutes).");
        }
      }, 1000);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
  };
  
  const stopMediaStream = () => {
     if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }
     if (videoPreviewRef.current) {
        videoPreviewRef.current.srcObject = null;
     }
  }

  const generateThumbnail = (videoUrl: string) => {
    const videoElement = document.createElement('video');
    videoElement.src = videoUrl;
    videoElement.currentTime = 1; // Seek to 1 second to ensure a frame is loaded
    videoElement.onloadeddata = () => {
      const canvas = document.createElement('canvas');
      // Create a slightly higher resolution thumbnail, then scale down if needed for display
      const targetWidth = Math.min(videoElement.videoWidth, 640); 
      const scaleFactor = targetWidth / videoElement.videoWidth;
      canvas.width = targetWidth;
      canvas.height = videoElement.videoHeight * scaleFactor;

      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => {
          if (blob) setThumbnailBlob(blob);
        }, 'image/jpeg', 0.85); // Slightly higher quality for thumbnail
      }
      videoElement.remove(); 
    };
    videoElement.onerror = () => {
        console.error("Error loading video for thumbnail generation.");
        videoElement.remove();
    }
  };

  const handleSaveLocally = () => {
    if (recordedVideoBlob && recordedVideoUrl) {
      const a = document.createElement('a');
      a.href = recordedVideoUrl;
      const safeTitle = title.replace(/[^a-z0-9_]+/gi, '_').toLowerCase() || 'recorded_video';
      const extension = recordedVideoBlob.type.split('/')[1] || 'webm';
      a.download = `${safeTitle}.${extension}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  };

  const handleUpload = async (event: FormEvent) => {
    event.preventDefault();
    if (!recordedVideoBlob || !thumbnailBlob || !user || !doctorProfile) {
      setError("Missing video data, thumbnail, or user information. Please ensure recording is complete.");
      return;
    }
    if (!title.trim()) {
      setError("Video title is required.");
      return;
    }

    setRecordingState('uploading');
    setError(null);
    setSuccessMessage(null);
    setUploadProgress(0);

    try {
      const safeTitle = title.replace(/[^a-z0-9_]+/gi, '_').toLowerCase();
      const timestamp = Date.now();
      const videoExtension = recordedVideoBlob.type.split('/')[1] || 'webm';
      const videoFileName = `${safeTitle}_${timestamp}.${videoExtension}`;
      const thumbnailFileName = `thumbnail_${safeTitle}_${timestamp}.jpg`;

      const videoStoragePath = await uploadFileToStorage(
        `videos/${doctorProfile.uid}`,
        recordedVideoBlob,
        videoFileName,
        (snapshot) => {
          const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
          setUploadProgress(progress * 0.9); 
        }
      );
      const videoUrl = await getFirebaseStorageDownloadUrl(videoStoragePath);
      
      setUploadProgress(90);

      const thumbnailStoragePath = await uploadFileToStorage(
        `thumbnails/${doctorProfile.uid}`,
        thumbnailBlob,
        thumbnailFileName,
         (snapshot) => {
          const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
          setUploadProgress(90 + (progress * 0.1)); 
        }
      );
      const thumbnailUrl = await getFirebaseStorageDownloadUrl(thumbnailStoragePath);
      setUploadProgress(100);

      const videoId = uuidv4();
      const videoData: Omit<VideoMeta, 'id' | 'createdAt' | 'permalink'> = {
        title,
        description,
        doctorId: doctorProfile.uid,
        doctorName: doctorProfile.displayName || doctorProfile.email || 'Unknown Doctor',
        videoUrl,
        thumbnailUrl,
        duration: formatTime(duration),
        recordingDuration: duration,
        tags: keywords.split(',').map(k => k.trim()).filter(Boolean),
        viewCount: 0,
        featured,
        storagePath: videoStoragePath,
        thumbnailStoragePath: thumbnailStoragePath,
        videoSize: recordedVideoBlob.size,
        videoType: recordedVideoBlob.type,
      };
      
      await addVideoMetadataToFirestore({ ...videoData, videoId });

      setSuccessMessage("Video uploaded and metadata saved successfully!");
      setRecordingState('success');
      setTitle(''); setDescription(''); setKeywords(''); setFeatured(false);
      setRecordedVideoBlob(null); setRecordedVideoUrl(null); setThumbnailBlob(null);
      setDuration(0);
      stopMediaStream(); 
      if (videoPreviewRef.current) {
        videoPreviewRef.current.src = ""; 
        videoPreviewRef.current.srcObject = null;
        videoPreviewRef.current.controls = false;
      }
      
    } catch (err) {
      console.error("Upload failed:", err);
      setError(`Upload failed: ${err instanceof Error ? err.message : String(err)}`);
      setRecordingState('error');
    } finally {
      setUploadProgress(0);
    }
  };
  
  if (!isAdmin && typeof window !== 'undefined' && !user) { // Check for user as well to avoid flicker
    return <p>Loading...</p>; // Or a loader component
  }
  if (!isAdmin && typeof window !== 'undefined' && user) {
     return <p>Access denied. You must be an admin to view this page.</p>;
  }


  return (
    <div className="space-y-6">
      {error && (
        <Alert variant="destructive" className="w-full">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {successMessage && (
        <Alert variant="default" className="w-full bg-green-50 border-green-300 text-green-700 dark:bg-green-900/30 dark:border-green-700 dark:text-green-300">
          <CheckCircle className="h-4 w-4" />
          <AlertTitle>Success</AlertTitle>
          <AlertDescription>{successMessage}</AlertDescription>
        </Alert>
      )}

      <div className="aspect-video bg-muted rounded-lg overflow-hidden border shadow-inner relative">
        <video ref={videoPreviewRef} className="w-full h-full object-contain bg-black" autoPlay muted playsInline />
        {recordingState === 'recording' && (
          <div className="absolute top-3 right-3 bg-red-600 text-white px-3 py-1.5 rounded-md text-sm font-mono shadow-md flex items-center gap-1.5">
            <Mic size={16} /> REC {formatTime(duration)}
          </div>
        )}
         {recordingState === 'idle' && !mediaStreamRef.current && (
           <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center">
             <Camera size={48} className="text-muted-foreground mb-4" />
             <p className="text-muted-foreground mb-4">Camera and microphone access needed to record.</p>
             <Button onClick={requestPermissionsAndSetup} variant="default" size="lg" className="gap-2">
               <Settings2 className="h-5 w-5" /> Setup Camera & Mic
             </Button>
           </div>
         )}
      </div>

      <div className="flex flex-col sm:flex-row gap-3 items-center justify-center">
        {mediaStreamRef.current && (recordingState === 'idle' || recordingState === 'stopped') && (
          <Button onClick={startRecording} className="gap-2 bg-green-600 hover:bg-green-700 text-white w-full sm:w-auto" size="lg">
            <Video className="h-5 w-5" /> Start Recording
          </Button>
        )}
        {recordingState === 'recording' && (
          <Button onClick={stopRecording} variant="destructive" className="gap-2 w-full sm:w-auto" size="lg">
            <Square className="h-5 w-5" /> Stop Recording
          </Button>
        )}
      </div>

      {recordedVideoUrl && recordingState === 'stopped' && (
        <Card className="shadow-xl">
          <CardHeader>
            <CardTitle className="text-xl font-headline">Recording Complete</CardTitle>
            <CardDescription>Duration: {formatTime(duration)}. Review your video and provide details before uploading.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleUpload} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="title">Video Title <span className="text-destructive">*</span></Label>
                <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} required placeholder="e.g., Understanding Blood Pressure" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="description">Description</Label>
                <Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Summarize the video content, key topics covered..." rows={4} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="keywords">Keywords (comma-separated)</Label>
                <Input id="keywords" value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="e.g., cardiology, hypertension, lifestyle" />
              </div>
              <div className="flex items-center space-x-2 pt-2">
                <Checkbox id="featured" checked={featured} onCheckedChange={(checked) => setFeatured(!!checked)} />
                <Label htmlFor="featured" className="font-normal text-sm">Feature this video on Homepage</Label>
              </div>
            </form>
          </CardContent>
          <CardFooter className="flex flex-col sm:flex-row gap-3 pt-4 border-t">
            <Button type="button" onClick={handleSaveLocally} variant="outline" className="gap-2 w-full sm:w-auto">
              <Download className="h-4 w-4" /> Save Locally
            </Button>
            <Button type="submit" form="upload-form" onClick={handleUpload} disabled={recordingState === 'uploading'} className="gap-2 flex-grow w-full sm:w-auto">
              {recordingState === 'uploading' ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
              {recordingState === 'uploading' ? 'Uploading...' : 'Upload Video'}
            </Button>
          </CardFooter>
        </Card>
      )}
      
      {recordingState === 'uploading' && (
        <div className="mt-4 p-4 border rounded-lg bg-card">
          <Progress value={uploadProgress} className="w-full h-2.5" />
          <p className="text-sm text-center mt-2.5 text-muted-foreground">Uploading video... {Math.round(uploadProgress)}%</p>
        </div>
      )}
    </div>
  );
}

    