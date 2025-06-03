
"use client";

import { useState, useRef, useEffect, FormEvent, useCallback } from 'react';
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
import { addVideoMetadataToFirestore } from './actions';
import { Video, Mic, Square, Download, UploadCloud, AlertCircle, CheckCircle, Loader2, Settings2, Camera, Film, RefreshCcw, RotateCw, Image as ImageIcon } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import type { VideoMeta } from '@/types';
import { useRouter } from 'next/navigation';
import NextImage from 'next/image'; // Renamed to avoid conflict

type RecordingState = 'idle' | 'permission' | 'recording' | 'paused' | 'stopped' | 'uploading' | 'success' | 'error';

const MAX_RECORDING_TIME_MS = 30 * 60 * 1000; 
const NUM_THUMBNAILS_TO_GENERATE = 5;
const RECORDING_TIMESLICE_MS = 1000;

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

  const [potentialThumbnails, setPotentialThumbnails] = useState<(string | null)[]>(Array(NUM_THUMBNAILS_TO_GENERATE).fill(null));
  const [potentialThumbnailBlobs, setPotentialThumbnailBlobs] = useState<(Blob | null)[]>(Array(NUM_THUMBNAILS_TO_GENERATE).fill(null));
  const [selectedThumbnailIndex, setSelectedThumbnailIndex] = useState<number | null>(null);
  const [isGeneratingThumbnails, setIsGeneratingThumbnails] = useState(false);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [keywords, setKeywords] = useState('');
  const [featured, setFeatured] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isLocallySaved, setIsLocallySaved] = useState(false);

  const timerSecondsRef = useRef(0);
  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const actualMimeTypeRef = useRef<string>('');
  const [previewRotation, setPreviewRotation] = useState(0);


  useEffect(() => {
    if (!isAdmin && user) {
      router.replace('/dashboard');
    }
    return () => {
      stopMediaStream();
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      if (recordedVideoUrl) URL.revokeObjectURL(recordedVideoUrl);
      potentialThumbnails.forEach(url => { if (url) URL.revokeObjectURL(url); });
    };
  }, [isAdmin, user, router, recordedVideoUrl, potentialThumbnails]);

  const formatTime = (totalSeconds: number): string => {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  };

  const stopMediaStream = useCallback(() => {
    if (mediaStreamRef.current) {
      console.log("VideoRecorder: Stopping media stream tracks.");
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }
    if (videoPreviewRef.current) {
      videoPreviewRef.current.srcObject = null;
      videoPreviewRef.current.src = "";
    }
  }, []);

  const isStreamValid = useCallback((stream: MediaStream | null): boolean => {
    console.log("VideoRecorder (isStreamValid): Validating stream object:", stream);
    if (!stream) { console.warn("VideoRecorder (isStreamValid): Stream is null or undefined."); return false; }
    if (!(stream instanceof MediaStream)) { console.warn("VideoRecorder (isStreamValid): Provided object is not an instance of MediaStream."); return false; }
    if (!stream.active) { console.warn("VideoRecorder (isStreamValid): Stream is not active."); return false; }
    if (stream.getTracks().length === 0) { console.warn("VideoRecorder (isStreamValid): Stream has no tracks."); return false; }
    const videoTrack = stream.getVideoTracks()[0];
    if (!videoTrack) { console.warn("VideoRecorder (isStreamValid): Stream has no video tracks."); return false; }
    if (videoTrack.readyState !== 'live') { console.warn(`VideoRecorder (isStreamValid): Video track is not live. State: ${videoTrack.readyState}`); return false; }
    console.log("VideoRecorder (isStreamValid): Stream appears to be valid and active.");
    return true;
  }, []);


  const requestPermissionsAndSetup = useCallback(async () => {
    console.log("VideoRecorder: Requesting media permissions...");
    setError(null);
    setRecordingState('permission');
    
    stopMediaStream(); // Ensure any old stream is stopped first

    try {
      const constraints: MediaStreamConstraints = {
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: { ideal: 'user' } },
        audio: true
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      if (!isStreamValid(stream)) {
        stream?.getTracks().forEach(track => track.stop());
        throw new Error("Camera stream acquired but is not active or valid.");
      }
      mediaStreamRef.current = stream;
      if (videoPreviewRef.current) {
        videoPreviewRef.current.srcObject = stream;
        videoPreviewRef.current.muted = true;
        videoPreviewRef.current.controls = false;
        videoPreviewRef.current.setAttribute('playsinline', 'true');
        videoPreviewRef.current.setAttribute('autoplay', 'true');
        await videoPreviewRef.current.play().catch(e => console.warn("VideoRecorder: Error playing live preview on setup:", e));
      }
      setRecordingState('idle');
      setPreviewRotation(0);
      console.log("VideoRecorder: Media permissions granted and stream set up successfully.");
    } catch (err) {
      console.error("VideoRecorder: Error accessing media devices:", err);
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError(`Failed to access camera/microphone: ${errorMessage}.`);
      setRecordingState('error');
    }
  }, [stopMediaStream, isStreamValid]);

  const startRecording = async () => {
    console.log("VideoRecorder: Attempting to start recording...");
    setError(null); setSuccessMessage(null); setIsLocallySaved(false);

    let streamToUse = mediaStreamRef.current;
    if (!isStreamValid(streamToUse)) {
      console.log("VideoRecorder: Current mediaStreamRef.current is invalid. Attempting re-setup.");
      await requestPermissionsAndSetup();
      streamToUse = mediaStreamRef.current; 
    }

    if (!isStreamValid(streamToUse)) {
      setError("Failed to initialize recording: Camera stream could not be established or is invalid.");
      setRecordingState('error'); return;
    }
    console.log("VideoRecorder: Stream validation passed.");
    console.log("  - Stream object being passed to MediaRecorder:", streamToUse);
    console.log(`  - Stream active: ${streamToUse!.active}`);
    streamToUse!.getTracks().forEach((track, index) => {
      console.log(`  - Track ${index}: kind=${track.kind}, id=${track.id}, label='${track.label}', readyState=${track.readyState}, muted=${track.muted}, enabled=${track.enabled}`);
    });
    
    recordedChunksRef.current = [];
    setRecordedVideoBlob(null);
    if (recordedVideoUrl) URL.revokeObjectURL(recordedVideoUrl);
    setRecordedVideoUrl(null);
    potentialThumbnails.forEach(url => { if (url) URL.revokeObjectURL(url); });
    setPotentialThumbnails(Array(NUM_THUMBNAILS_TO_GENERATE).fill(null));
    setPotentialThumbnailBlobs(Array(NUM_THUMBNAILS_TO_GENERATE).fill(null));
    setSelectedThumbnailIndex(null);
    timerSecondsRef.current = 0;
    actualMimeTypeRef.current = '';

    if (videoPreviewRef.current) {
      if (videoPreviewRef.current.srcObject !== streamToUse) videoPreviewRef.current.srcObject = streamToUse;
      videoPreviewRef.current.src = ""; 
      videoPreviewRef.current.controls = false;
      videoPreviewRef.current.muted = true;
      await videoPreviewRef.current.play().catch(e => console.warn("Error replaying live preview for recording:", e));
    }

    let chosenMimeType = '';
    const mimeTypesToCheck = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4;codecs=avc1.42E01E', 'video/mp4'];
    for (const type of mimeTypesToCheck) { if (MediaRecorder.isTypeSupported(type)) { chosenMimeType = type; break; } }
    const options: MediaRecorderOptions = {};
    if (chosenMimeType) options.mimeType = chosenMimeType;
    console.log("VideoRecorder: MediaRecorder options:", options);

    try {
      mediaRecorderRef.current = new MediaRecorder(streamToUse!, options);
    } catch (e) {
      console.error("VideoRecorder: Error creating MediaRecorder instance:", e);
      setError(`Failed to initialize recorder: ${e instanceof Error ? e.message : String(e)}.`);
      setRecordingState('error'); return;
    }

    mediaRecorderRef.current.onstart = () => {
      if (mediaRecorderRef.current) actualMimeTypeRef.current = mediaRecorderRef.current.mimeType || chosenMimeType || '';
      console.log(`VideoRecorder: MediaRecorder.onstart. Actual MIME: ${actualMimeTypeRef.current}. State: ${mediaRecorderRef.current?.state}`);
      setRecordingState('recording');
      timerSecondsRef.current = 0;
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = setInterval(() => {
        timerSecondsRef.current++;
        if (timerSecondsRef.current * 1000 >= MAX_RECORDING_TIME_MS) { stopRecording(); setError("Max recording time."); }
      }, 1000);
    };

    mediaRecorderRef.current.ondataavailable = (event) => {
      if (event.data.size > 0) recordedChunksRef.current.push(event.data);
    };

    mediaRecorderRef.current.onstop = async () => {
      const finalRecordedDuration = timerSecondsRef.current;
      console.log(`VideoRecorder: MediaRecorder.onstop. Chunks: ${recordedChunksRef.current.length}. Timer Duration: ${finalRecordedDuration}s`);
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);

      const currentMimeType = actualMimeTypeRef.current || mediaRecorderRef.current?.mimeType || 'video/webm';
      const blob = new Blob(recordedChunksRef.current, { type: currentMimeType });
      console.log(`VideoRecorder: Blob created. Size: ${blob.size}, Type: ${blob.type}`);

      if (blob.size === 0) {
        setError("Recorded video is empty.");
        setRecordingState(mediaStreamRef.current && isStreamValid(mediaStreamRef.current) ? 'idle' : 'error');
        return;
      }
      setRecordedVideoBlob(blob);
      const url = URL.createObjectURL(blob);
      setRecordedVideoUrl(url);

      let previewSetupSuccess = false;
      if (videoPreviewRef.current) {
        videoPreviewRef.current.srcObject = null;
        videoPreviewRef.current.src = ""; // Clear old src
        videoPreviewRef.current.src = url;
        videoPreviewRef.current.muted = false;
        videoPreviewRef.current.controls = true;
        videoPreviewRef.current.load();

        videoPreviewRef.current.onloadedmetadata = () => {
          console.log(`VideoRecorder: Preview metadata loaded. Element duration: ${videoPreviewRef.current?.duration}s, Timer duration: ${finalRecordedDuration}s.`);
          previewSetupSuccess = true;
          videoPreviewRef.current?.play().catch(e => console.warn("Error playing recorded preview:", e));
        };
        videoPreviewRef.current.onerror = (e) => {
          const videoError = videoPreviewRef.current?.error;
          console.error("VideoRecorder: Error loading recorded video in preview. Event:", e, "VideoError:", videoError);
          setError(`Preview Error: ${videoError?.message || 'Media error'}. Code: ${videoError?.code}. Try local save.`);
        };
      }
      
      console.log(`VideoRecorder: onstop - Blob valid. Preview success: ${previewSetupSuccess}. Proceeding to thumbnails with timer duration: ${finalRecordedDuration}s.`);
      await generatePotentialThumbnails(url, finalRecordedDuration);
      setRecordingState('stopped');
    };

    mediaRecorderRef.current.onerror = (event: Event) => {
      console.error("VideoRecorder: MediaRecorder.onerror:", event);
      setError("Recording error occurred.");
      setRecordingState('error');
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    };

    try {
      console.log("VideoRecorder: Calling mediaRecorderRef.current.start() with timeslice:", RECORDING_TIMESLICE_MS);
      mediaRecorderRef.current.start(RECORDING_TIMESLICE_MS);
    } catch (startError: any) {
      console.error("VideoRecorder: Error calling mediaRecorder.start():", startError);
      setError(`Failed to start MediaRecorder: ${startError.message}.`);
      setRecordingState('error');
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && (mediaRecorderRef.current.state === 'recording' || mediaRecorderRef.current.state === 'paused')) {
      mediaRecorderRef.current.stop();
      console.log(`VideoRecorder: stopRecording() called. State: ${mediaRecorderRef.current.state}. Timer: ${timerSecondsRef.current}s.`);
    } else {
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      if (recordingState === 'recording') setRecordingState('stopped');
    }
  };

  const generateSpecificThumbnail = useCallback((videoObjectUrl: string, time: number, index: number): Promise<{ blob: Blob; blobUrl: string } | null> => {
    return new Promise((resolve) => {
      console.log(`VideoRecorder: generateSpecificThumbnail - Idx ${index}, Time ${time}s`);
      const videoElement = document.createElement('video');
      videoElement.preload = 'metadata';
      videoElement.muted = true;
      videoElement.src = videoObjectUrl;
      videoElement.crossOrigin = "anonymous";

      let seekedFired = false;
      let metadataLoaded = false;

      const cleanupAndResolve = (value: { blob: Blob; blobUrl: string } | null) => {
          videoElement.remove();
          resolve(value);
      };

      const captureFrame = () => {
        if (videoElement.videoWidth === 0 || videoElement.videoHeight === 0) {
            console.warn(`VideoRecorder: Thumbnail[${index}] - Video dimensions 0x0 at capture.`);
            cleanupAndResolve(null); return;
        }
        const canvas = document.createElement('canvas');
        const targetWidth = Math.min(videoElement.videoWidth || 320, 320);
        const scaleFactor = videoElement.videoWidth > 0 ? targetWidth / videoElement.videoWidth : 1;
        canvas.width = targetWidth;
        canvas.height = (videoElement.videoHeight || 180) * scaleFactor;
        if (canvas.width === 0 || canvas.height === 0) { cleanupAndResolve(null); return; }

        const ctx = canvas.getContext('2d');
        if (ctx) {
            try {
                ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
                canvas.toBlob(blob => {
                    if (blob && blob.size > 0) {
                        cleanupAndResolve({ blob, blobUrl: URL.createObjectURL(blob) });
                    } else { cleanupAndResolve(null); }
                }, 'image/jpeg', 0.85);
            } catch (drawError) { console.error(`VideoRecorder: Draw error for thumb ${index}`, drawError); cleanupAndResolve(null); }
        } else { cleanupAndResolve(null); }
      };
      
      videoElement.onloadedmetadata = async () => {
          metadataLoaded = true;
          console.log(`VideoRecorder: Thumb[${index}] metadata. Duration: ${videoElement.duration}s. Dims: ${videoElement.videoWidth}x${videoElement.videoHeight}. Seeking to ${time}s.`);
          const seekTime = Math.max(0.01, Math.min(time, (videoElement.duration > 0 && Number.isFinite(videoElement.duration)) ? videoElement.duration - 0.01 : time));
          videoElement.currentTime = seekTime;
          await new Promise(r => setTimeout(r, 50));
          if (videoElement.readyState >= 2 && !seekedFired) captureFrame();
      };
      videoElement.onseeked = () => {
          if (seekedFired) return;
          if (!metadataLoaded) { console.warn(`VideoRecorder: Thumb[${index}] seeked before metadata.`); return; }
          seekedFired = true;
          captureFrame();
      };
      videoElement.onerror = (e) => { console.error(`VideoRecorder: Thumb[${index}] video error:`, videoElement.error, e); cleanupAndResolve(null); };
      
      const timeout = setTimeout(() => { if (!seekedFired && !metadataLoaded) cleanupAndResolve(null); }, 5000);
      videoElement.onseeked = () => { clearTimeout(timeout); if (seekedFired) return; if (!metadataLoaded) return; seekedFired = true; captureFrame(); };
      videoElement.load();
    });
  }, []);

  const generatePotentialThumbnails = useCallback(async (videoObjectUrl: string, duration: number) => {
    if (!videoObjectUrl || !(duration > 0 && Number.isFinite(duration))) {
      setError("Cannot generate thumbnails: video duration is invalid or URL missing.");
      setIsGeneratingThumbnails(false); return;
    }
    console.log(`VideoRecorder: Generating thumbnails. Duration: ${duration}s`);
    setIsGeneratingThumbnails(true);
    const oldUrls = [...potentialThumbnails]; // Keep a reference to old URLs for cleanup
    setPotentialThumbnails(Array(NUM_THUMBNAILS_TO_GENERATE).fill(null));
    setPotentialThumbnailBlobs(Array(NUM_THUMBNAILS_TO_GENERATE).fill(null));

    let timePoints: number[];
     if (duration < 1) {
        timePoints = [duration / 2, Math.min(duration * 0.9, duration - 0.01)].filter(t => t > 0.01).slice(0, NUM_THUMBNAILS_TO_GENERATE);
        if(timePoints.length === 0 && duration > 0.01) timePoints = [duration * 0.5];

    } else {
        timePoints = Array(NUM_THUMBNAILS_TO_GENERATE).fill(null).map((_, i) => {
            const point = (duration / (NUM_THUMBNAILS_TO_GENERATE + 1)) * (i + 1);
            return Math.max(0.01, Math.min(point, duration - 0.01));
        });
    }
    const uniqueTimes = [...new Set(timePoints)].filter(t => Number.isFinite(t) && t > 0).slice(0, NUM_THUMBNAILS_TO_GENERATE);
    
    const settledResults = await Promise.allSettled(
      uniqueTimes.map((time, index) => generateSpecificThumbnail(videoObjectUrl, time, index))
    );

    const newUrls: (string | null)[] = [];
    const newBlobs: (Blob | null)[] = [];
    settledResults.forEach((result) => {
      if (result.status === 'fulfilled' && result.value) {
        newUrls.push(result.value.blobUrl);
        newBlobs.push(result.value.blob);
      }
    });
    
    oldUrls.forEach(url => { if (url) URL.revokeObjectURL(url); }); // Cleanup old URLs
    
    while (newUrls.length < NUM_THUMBNAILS_TO_GENERATE) newUrls.push(null);
    while (newBlobs.length < NUM_THUMBNAILS_TO_GENERATE) newBlobs.push(null);

    setPotentialThumbnails(newUrls);
    setPotentialThumbnailBlobs(newBlobs);
    const firstValidIdx = newBlobs.findIndex(b => b !== null);
    setSelectedThumbnailIndex(firstValidIdx !== -1 ? firstValidIdx : null);
    setIsGeneratingThumbnails(false);
    console.log(`VideoRecorder: Thumbnail generation completed. ${newBlobs.filter(b=>b).length} successful.`);
  }, [generateSpecificThumbnail]);


  const getFileExtensionFromMimeType = (mimeType: string | undefined): string => {
    if (!mimeType) return 'bin';
    const simpleMimeType = mimeType.split(';')[0];
    const parts = simpleMimeType.split('/');
    const subType = parts[1];
    if (subType) {
      if (subType.includes('mp4')) return 'mp4';
      if (subType.includes('webm')) return 'webm';
      if (subType.includes('quicktime')) return 'mov';
      if (subType.includes('x-matroska')) return 'mkv';
      return subType.replace(/[^a-z0-9]/gi, '');
    }
    return 'bin';
  };

  const handleSaveLocally = () => {
    if (recordedVideoBlob && recordedVideoUrl) {
      const a = document.createElement('a');
      a.href = recordedVideoUrl;
      const safeTitle = title.replace(/[^a-z0-9_]+/gi, '_').toLowerCase() || 'recorded_video';
      const extension = getFileExtensionFromMimeType(recordedVideoBlob.type || actualMimeTypeRef.current);
      a.download = `${safeTitle}.${extension}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setIsLocallySaved(true);
      setSuccessMessage("Video saved locally! You can now proceed to upload.");
    }
  };

  const resetRecorderState = (setupNewStream = true) => {
    setTitle(''); setDescription(''); setKeywords(''); setFeatured(false);
    setRecordedVideoBlob(null);
    if (recordedVideoUrl) URL.revokeObjectURL(recordedVideoUrl);
    setRecordedVideoUrl(null);
    potentialThumbnails.forEach(url => { if (url) URL.revokeObjectURL(url); });
    setPotentialThumbnails(Array(NUM_THUMBNAILS_TO_GENERATE).fill(null));
    setPotentialThumbnailBlobs(Array(NUM_THUMBNAILS_TO_GENERATE).fill(null));
    setSelectedThumbnailIndex(null);
    timerSecondsRef.current = 0;
    actualMimeTypeRef.current = '';
    recordedChunksRef.current = [];
    setIsLocallySaved(false);
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try { mediaRecorderRef.current.stop(); } catch (e) { console.warn("Error stopping mediarecorder during reset:", e) }
    }
    mediaRecorderRef.current = null;
    if (videoPreviewRef.current) {
      videoPreviewRef.current.src = "";
      videoPreviewRef.current.srcObject = null;
      videoPreviewRef.current.controls = false;
      videoPreviewRef.current.muted = true;
    }
    setRecordingState('idle');
    setError(null);
    setSuccessMessage(null);
    setPreviewRotation(0);
    if (setupNewStream) {
      requestPermissionsAndSetup();
    }
  };

  const handleUpload = async (event: FormEvent) => {
    event.preventDefault();
    if (selectedThumbnailIndex === null || !potentialThumbnailBlobs[selectedThumbnailIndex]) {
      setError("Please select a valid thumbnail before uploading."); return;
    }
    const selectedThumbnailBlob = potentialThumbnailBlobs[selectedThumbnailIndex!];
    if (!recordedVideoBlob || !selectedThumbnailBlob || !user || !doctorProfile) {
      setError("Missing video data, thumbnail, or user info."); return;
    }
    if (!title.trim()) { setError("Video title is required."); return; }

    setRecordingState('uploading');
    setError(null); setSuccessMessage(null); setUploadProgress(0);

    try {
      const safeTitle = title.replace(/[^a-z0-9_]+/gi, '_').toLowerCase() || uuidv4();
      const timestamp = Date.now();
      const videoExtension = getFileExtensionFromMimeType(recordedVideoBlob.type || actualMimeTypeRef.current);
      const videoFileName = `${safeTitle}_${timestamp}.${videoExtension}`;
      const thumbnailFileName = `thumbnail_${safeTitle}_${timestamp}.jpg`;

      const videoStoragePath = await uploadFileToStorage(
        `videos/${doctorProfile.uid}`, recordedVideoBlob, videoFileName,
        (s) => setUploadProgress(Math.round((s.bytesTransferred / s.totalBytes) * 0.9 * 100))
      );
      const videoUrl = await getFirebaseStorageDownloadUrl(videoStoragePath);
      setUploadProgress(90);

      const thumbnailStoragePath = await uploadFileToStorage(
        `thumbnails/${doctorProfile.uid}`, selectedThumbnailBlob, thumbnailFileName,
        (s) => setUploadProgress(Math.round(90 + (s.bytesTransferred / s.totalBytes) * 0.1 * 100))
      );
      const thumbnailUrl = await getFirebaseStorageDownloadUrl(thumbnailStoragePath);
      setUploadProgress(100);

      const videoId = uuidv4();
      const videoDataForAction = {
        videoId, title, description,
        doctorId: doctorProfile.uid,
        doctorName: doctorProfile.displayName || doctorProfile.email || 'Unknown Doctor',
        videoUrl, thumbnailUrl,
        duration: formatTime(timerSecondsRef.current),
        recordingDuration: timerSecondsRef.current,
        tags: keywords.split(',').map(k => k.trim()).filter(Boolean),
        viewCount: 0, likeCount: 0, commentCount: 0, featured,
        storagePath: videoStoragePath, thumbnailStoragePath,
        videoSize: recordedVideoBlob.size,
        videoType: recordedVideoBlob.type || actualMimeTypeRef.current,
        comments: [],
      };

      const result = await addVideoMetadataToFirestore(videoDataForAction);
      if (result.success) {
        setSuccessMessage("Video uploaded successfully and metadata saved!");
        setRecordingState('success');
        if (videoPreviewRef.current && recordedVideoUrl) videoPreviewRef.current.src = recordedVideoUrl; 
      } else {
        console.error("[VideoRecorder:handleUpload] Error from addVideoMetadataToFirestore:", result.error);
        setError(`Failed to save video metadata: ${result.error}`);
        setRecordingState('error');
      }
    } catch (err) {
      console.error("[VideoRecorder:handleUpload] Overall upload error:", err);
      setError(`Upload failed: ${err instanceof Error ? err.message : String(err)}`);
      setRecordingState('error');
    }
  };

  const handleRotatePreview = () => {
    setPreviewRotation(current => (current + 90) % 360);
  };

  if (!isAdmin && typeof window !== 'undefined' && !user) {
    return <div className="flex items-center justify-center h-full"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  }
  if (!isAdmin && typeof window !== 'undefined' && user) {
    return (<Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertTitle>Access Denied</AlertTitle><AlertDescription>You must be an administrator to access the video recorder.</AlertDescription></Alert>);
  }

  const canSaveLocally = recordedVideoBlob && title.trim() && selectedThumbnailIndex !== null && potentialThumbnailBlobs[selectedThumbnailIndex] !== null;
  const canUpload = isLocallySaved && canSaveLocally;

  const showSetupCamera = recordingState === 'idle' && !mediaStreamRef.current && !successMessage;
  const showLiveRecordControls = (recordingState === 'idle' || recordingState === 'permission') && mediaStreamRef.current && !recordedVideoUrl && !successMessage;
  const showRecordingInProgress = recordingState === 'recording' || recordingState === 'paused';
  const showReviewAndUpload = (recordingState === 'stopped' || (recordingState === 'error' && recordedVideoBlob)) && recordedVideoUrl && !successMessage;
  const showUploadingProgress = recordingState === 'uploading';
  const showSuccessMessageState = recordingState === 'success' && successMessage;

  return (
    <div className="space-y-6">
      {error && recordingState !== 'uploading' && !successMessage && (
        <Alert variant="destructive" className="w-full">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {showSuccessMessageState && (
        <Alert variant="default" className="w-full bg-green-100 border-green-400 text-green-700 dark:bg-green-900/30 dark:border-green-600 dark:text-green-300">
          <CheckCircle className="h-4 w-4" />
          <AlertTitle>Success</AlertTitle>
          <AlertDescription>{successMessage}</AlertDescription>
        </Alert>
      )}

      <Card className="overflow-hidden shadow-lg rounded-xl">
        <CardContent className="p-0">
          <div className="aspect-video bg-slate-900 rounded-t-lg overflow-hidden border-b border-slate-700 shadow-inner relative group">
            <video
              ref={videoPreviewRef}
              className="w-full h-full object-contain bg-black transition-transform duration-300 ease-in-out"
              style={{ transform: `rotate(${previewRotation}deg)` }}
              playsInline
              muted={!recordedVideoUrl} 
              autoPlay={!recordedVideoUrl} 
              controls={!!recordedVideoUrl} 
              key={recordedVideoUrl || 'live_preview_main_recorder'}
            />
            {(showLiveRecordControls || showReviewAndUpload || showRecordingInProgress) && (
              <Button onClick={handleRotatePreview} variant="outline" size="icon" className="absolute top-4 left-4 z-10 bg-black/50 text-white hover:bg-black/70 border-white/50 opacity-0 group-hover:opacity-100 transition-opacity" title="Rotate Preview">
                <RotateCw size={20} />
              </Button>
            )}
            {showRecordingInProgress && (
              <div className="absolute top-4 right-4 bg-red-600 text-white px-3 py-1.5 rounded-lg text-sm font-mono shadow-lg flex items-center gap-2">
                <Mic size={18} className="animate-pulse" /> REC {formatTime(timerSecondsRef.current)}
              </div>
            )}
            {showReviewAndUpload && recordedVideoUrl && (
              <div className="absolute top-4 right-4 bg-blue-600 text-white px-3 py-1.5 rounded-lg text-sm font-mono shadow-lg">
                REVIEWING - {formatTime(timerSecondsRef.current)}
              </div>
            )}
            {showSetupCamera && (
              <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center bg-black/50">
                <Camera size={56} className="text-slate-300 mb-4" />
                <p className="text-slate-200 mb-6 text-lg">Camera and microphone access needed.</p>
                <Button onClick={() => requestPermissionsAndSetup()} variant="default" size="lg" className="gap-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg text-base px-6 py-3">
                  <Settings2 className="h-5 w-5" /> Setup Camera & Mic
                </Button>
              </div>
            )}
          </div>
        </CardContent>
        <CardFooter className="pt-6 pb-6 bg-slate-50 dark:bg-slate-800/50 border-t dark:border-slate-700 flex flex-col sm:flex-row gap-4 items-center justify-center">
          {showLiveRecordControls && mediaStreamRef.current && (
            <Button onClick={startRecording} className="gap-2 bg-green-500 hover:bg-green-600 text-white w-full sm:w-auto rounded-lg px-6 py-3 text-base" size="lg">
              <Video className="h-5 w-5" /> Start Recording
            </Button>
          )}
          {showRecordingInProgress && (
            <Button onClick={stopRecording} variant="destructive" className="gap-2 w-full sm:w-auto rounded-lg px-6 py-3 text-base" size="lg">
              <Square className="h-5 w-5" /> Stop Recording
            </Button>
          )}
          {showSuccessMessageState && (
            <Button onClick={() => resetRecorderState(true)} className="gap-2 bg-blue-500 hover:bg-blue-600 text-white w-full sm:w-auto rounded-lg px-6 py-3 text-base" size="lg">
              <RefreshCcw className="h-5 w-5" /> Record Another Video
            </Button>
          )}
        </CardFooter>
      </Card>

      {showReviewAndUpload && (
        <Card className="shadow-xl mt-8 rounded-xl">
          <CardHeader className="border-b dark:border-slate-700">
            <CardTitle className="text-2xl font-headline">Review & Process Video</CardTitle>
            <CardDescription>Timer Duration: {formatTime(timerSecondsRef.current)}. Review, add details, save locally, then upload. MimeType: {recordedVideoBlob?.type || actualMimeTypeRef.current || 'N/A'}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-8 pt-6">
            {isGeneratingThumbnails && (
                 <div className="text-center py-4">
                  <Loader2 className="h-6 w-6 animate-spin text-primary mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">Generating thumbnails...</p>
                </div>
            )}
            {!isGeneratingThumbnails && potentialThumbnails.some(t => t) && (
                <div>
                  <Label className="mb-3 block text-base font-medium text-foreground">Select Thumbnail <span className="text-destructive">*</span></Label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
                    {potentialThumbnails.map((thumbUrl, index) => (
                      thumbUrl ? (
                        <button
                          key={index}
                          type="button"
                          onClick={() => setSelectedThumbnailIndex(index)}
                          className={`relative aspect-video rounded-lg overflow-hidden border-4 transition-all duration-200 ease-in-out hover:opacity-70 focus:outline-none
                            ${selectedThumbnailIndex === index ? 'border-primary ring-4 ring-primary/50 ring-offset-2 ring-offset-background' : 'border-slate-300 dark:border-slate-600'}`}
                        >
                          <NextImage src={thumbUrl} alt={`Thumbnail ${index + 1}`} fill sizes="(max-width: 640px) 50vw, (max-width: 768px) 33vw, 20vw" className="object-cover transition-transform group-hover:scale-105" data-ai-hint="video thumbnail selection" />
                          {selectedThumbnailIndex === index && (
                            <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                              <CheckCircle size={40} className="text-white opacity-90" />
                            </div>
                          )}
                        </button>
                      ) : (
                        <div key={index} className="aspect-video bg-muted rounded-lg flex items-center justify-center border border-dashed border-slate-300 dark:border-slate-700">
                          <ImageIcon size={32} className="text-muted-foreground" />
                        </div>
                      )
                    ))}
                  </div>
                  {selectedThumbnailIndex === null && <p className="text-xs text-destructive mt-1">Please select a thumbnail.</p>}
                </div>
            )}
             {!isGeneratingThumbnails && !potentialThumbnails.some(t => t) && (
                <Alert variant="default">
                    <Film className="h-4 w-4"/>
                    <AlertTitle>Thumbnails Unavailable</AlertTitle>
                    <AlertDescription>
                        Could not generate thumbnails. You can still proceed to save and upload.
                        A default thumbnail might be used or you can update it later.
                    </AlertDescription>
                </Alert>
            )}


            <form onSubmit={handleUpload} className="space-y-6" id="upload-form-video-recorder">
              <div className="space-y-2">
                <Label htmlFor="title" className="text-base">Video Title <span className="text-destructive">*</span></Label>
                <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} required placeholder="e.g., Understanding Blood Pressure" className="text-base p-3 rounded-lg" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="description" className="text-base">Description</Label>
                <Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Summarize the video content..." rows={4} className="text-base p-3 rounded-lg" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="keywords" className="text-base">Keywords (comma-separated)</Label>
                <Input id="keywords" value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="e.g., cardiology, hypertension" className="text-base p-3 rounded-lg" />
              </div>
              <div className="flex items-center space-x-3 pt-2">
                <Checkbox id="featured" checked={featured} onCheckedChange={(checked) => setFeatured(!!checked)} className="h-5 w-5" />
                <Label htmlFor="featured" className="font-normal text-base">Feature this video</Label>
              </div>
            </form>
          </CardContent>
          <CardFooter className="flex flex-col sm:flex-row gap-4 pt-6 border-t dark:border-slate-700">
            <Button type="button" onClick={handleSaveLocally} variant="outline" className="gap-2 w-full sm:w-auto rounded-lg text-base px-5 py-2.5" disabled={!canSaveLocally || isLocallySaved}>
              <Download className="h-5 w-5" /> {isLocallySaved ? "Saved Locally" : "Save Locally" }
            </Button>
            <Button onClick={() => resetRecorderState(true)} variant="ghost" className="gap-2 w-full sm:w-auto rounded-lg text-base px-5 py-2.5">
              <RefreshCcw className="h-5 w-5" /> Record Again
            </Button>
            <Button
              type="submit"
              form="upload-form-video-recorder"
              disabled={!canUpload || recordingState === 'uploading'}
              className="gap-2 flex-grow w-full sm:w-auto bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg text-base px-5 py-2.5"
            >
              {recordingState === 'uploading' ? <Loader2 className="h-5 w-5 animate-spin" /> : <UploadCloud className="h-5 w-5" />}
              {recordingState === 'uploading' ? 'Uploading...' : 'Upload Video'}
            </Button>
          </CardFooter>
        </Card>
      )}

      {showUploadingProgress && (
        <Card className="mt-8 rounded-xl">
          <CardHeader> <CardTitle>Upload Progress</CardTitle> </CardHeader>
          <CardContent className="p-6">
            {error && (<Alert variant="destructive" className="w-full mb-4"><AlertCircle className="h-4 w-4" /><AlertTitle>Upload Failed</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>)}
            <Progress value={uploadProgress} className="w-full h-3 rounded-full" />
            <p className="text-base text-center mt-3 text-muted-foreground">Uploading video... {Math.round(uploadProgress)}%</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
