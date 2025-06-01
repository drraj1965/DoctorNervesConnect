
"use client";

import { useState, useRef, useEffect, ChangeEvent, FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useAuth } from '@/context/AuthContext';
import { uploadFileToStorage, getFirebaseStorageDownloadUrl } from '@/lib/firebase/storage';
import { addVideoMetadataToFirestore } from './actions'; // Server action
import { Video, Mic, Square, Play, Download, UploadCloud, AlertCircle, CheckCircle, Loader2, Settings2 } from 'lucide-react';
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
      setError("Failed to access camera/microphone. Please check permissions.");
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
      setRecordedChunksRef([]); // Clear previous recording chunks
      setRecordedVideoBlob(null);
      if (recordedVideoUrl) URL.revokeObjectURL(recordedVideoUrl);
      setRecordedVideoUrl(null);
      setThumbnailBlob(null);
      setDuration(0);

      // Determine MIME type
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
        setError("Could not start recording. Browser may not support chosen format.");
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
          videoPreviewRef.current.srcObject = null; // Stop live preview
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
        setError("An error occurred during recording.");
        setRecordingState('error');
         if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      };

      mediaRecorderRef.current.start();
      setRecordingState('recording');
      
      // Start timer
      let seconds = 0;
      recordingTimerRef.current = setInterval(() => {
        seconds++;
        setDuration(seconds);
        if (seconds * 1000 >= MAX_RECORDING_TIME_MS) {
          stopRecording();
           setError("Maximum recording time reached.");
        }
      }, 1000);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
      // Stream stop is handled by stopMediaStream or when component unmounts
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
    const video = document.createElement('video');
    video.src = videoUrl;
    video.onloadeddata = () => {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth / 4; // Smaller thumbnail
      canvas.height = video.videoHeight / 4;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => {
          if (blob) setThumbnailBlob(blob);
        }, 'image/jpeg', 0.8);
      }
      video.remove(); // Clean up video element
    };
  };

  const handleSaveLocally = () => {
    if (recordedVideoBlob) {
      const a = document.createElement('a');
      a.href = recordedVideoUrl!;
      a.download = `${title.replace(/\s+/g, '_') || 'recorded_video'}.webm`; // Consider actual mimeType
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  };

  const handleUpload = async (event: FormEvent) => {
    event.preventDefault();
    if (!recordedVideoBlob || !thumbnailBlob || !user || !doctorProfile) {
      setError("Missing video data, thumbnail, or user information.");
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
      const videoFileName = `${title.replace(/\s+/g, '_')}_${Date.now()}.webm`; // or based on blob.type
      const thumbnailFileName = `thumbnail_${videoFileName.split('.')[0]}.jpg`;

      const videoStoragePath = await uploadFileToStorage(
        `videos/${doctorProfile.uid}`,
        recordedVideoBlob,
        videoFileName,
        (snapshot) => {
          const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
          setUploadProgress(progress * 0.9); // Video is 90% of progress
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
          setUploadProgress(90 + (progress * 0.1)); // Thumbnail is 10%
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
      // Reset form and state for next recording
      setTitle(''); setDescription(''); setKeywords(''); setFeatured(false);
      setRecordedVideoBlob(null); setRecordedVideoUrl(null); setThumbnailBlob(null);
      setDuration(0);
      stopMediaStream(); // Stop camera after successful upload
      if (videoPreviewRef.current) {
        videoPreviewRef.current.src = ""; // Clear preview
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
  
  if (!isAdmin && typeof window !== 'undefined') {
    return <p>Access denied. You must be an admin to view this page.</p>;
  }


  return (
    <div className="space-y-6">
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {successMessage && (
        <Alert variant="default" className="bg-green-100 border-green-300 text-green-700">
          <CheckCircle className="h-4 w-4" />
          <AlertTitle>Success</AlertTitle>
          <AlertDescription>{successMessage}</AlertDescription>
        </Alert>
      )}

      <div className="aspect-video bg-muted rounded-md overflow-hidden border relative">
        <video ref={videoPreviewRef} className="w-full h-full object-cover" autoPlay muted playsInline />
        {recordingState === 'recording' && (
          <div className="absolute top-2 right-2 bg-red-500 text-white px-2 py-1 rounded text-sm font-mono">
            REC {formatTime(duration)}
          </div>
        )}
      </div>

      <div className="flex flex-col sm:flex-row gap-2 items-center justify-center">
        {!mediaStreamRef.current && recordingState === 'idle' && (
           <Button onClick={requestPermissionsAndSetup} variant="outline" className="gap-2">
             <Settings2 className="h-4 w-4" /> Setup Camera & Mic
           </Button>
        )}
        {mediaStreamRef.current && (recordingState === 'idle' || recordingState === 'stopped') && (
          <Button onClick={startRecording} className="gap-2 bg-green-600 hover:bg-green-700">
            <Video className="h-4 w-4" /> Start Recording
          </Button>
        )}
        {recordingState === 'recording' && (
          <Button onClick={stopRecording} variant="destructive" className="gap-2">
            <Square className="h-4 w-4" /> Stop Recording
          </Button>
        )}
      </div>

      {recordedVideoUrl && recordingState === 'stopped' && (
        <div className="mt-4 p-4 border rounded-md bg-secondary/30">
          <h3 className="text-lg font-semibold mb-2">Recording Complete (Duration: {formatTime(duration)})</h3>
          <p className="text-sm text-muted-foreground mb-3">Review your video below. You can save it locally or proceed to upload.</p>
          <form onSubmit={handleUpload} className="space-y-4">
            <div>
              <Label htmlFor="title">Video Title <span className="text-red-500">*</span></Label>
              <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} required placeholder="Enter a catchy title" />
            </div>
            <div>
              <Label htmlFor="description">Description</Label>
              <Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Describe your video..." />
            </div>
            <div>
              <Label htmlFor="keywords">Keywords (comma-separated)</Label>
              <Input id="keywords" value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="e.g., cardiology, heart health, exercise" />
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox id="featured" checked={featured} onCheckedChange={(checked) => setFeatured(!!checked)} />
              <Label htmlFor="featured">Feature this video on Homepage</Label>
            </div>
            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <Button type="button" onClick={handleSaveLocally} variant="outline" className="gap-2">
                <Download className="h-4 w-4" /> Save Locally
              </Button>
              <Button type="submit" disabled={recordingState === 'uploading'} className="gap-2 flex-grow">
                {recordingState === 'uploading' ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
                {recordingState === 'uploading' ? 'Uploading...' : 'Upload Video'}
              </Button>
            </div>
          </form>
        </div>
      )}
      
      {recordingState === 'uploading' && (
        <div className="mt-4">
          <Progress value={uploadProgress} className="w-full" />
          <p className="text-sm text-center mt-2 text-muted-foreground">Uploading... {Math.round(uploadProgress)}%</p>
        </div>
      )}
    </div>
  );
}

