
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
import NextImage from 'next/image';
import { uploadFileToStorage, getFirebaseStorageDownloadUrl } from "@/lib/firebase/storage";
import { saveVideoMetadataAction } from "./actions";
import type { VideoMeta } from "@/types";
import { useToast } from '@/hooks/use-toast';

const MAX_RECORDING_MINUTES = 30;
const NUM_THUMBNAILS_TO_GENERATE = 5;

type RecorderStep = "initial" | "permissionDenied" | "settingUp" | "readyToRecord" | "recording" | "review" | "generatingThumbnails" | "thumbnailsReady" | "uploading" | "success";

export default function WebVideoRecorderPage() {
  const { user, doctorProfile, isAdmin, loading: authLoading } = useAuth();
  const router = useRouter();
  const { toast } = useToast();

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  
  const [_recorderStep, _setRecorderStepInternal] = useState<RecorderStep>("initial");
  const recorderStepRef = useRef<RecorderStep>("initial"); 

  const setRecorderStep = useCallback((step: RecorderStep) => {
    if (recorderStepRef.current !== step) {
      console.log(`RecorderPage: Setting recorderStep from ${recorderStepRef.current} to ${step}`);
      recorderStepRef.current = step;
      _setRecorderStepInternal(step);
    }
  }, []);

  const [_mediaStream, _setMediaStreamInternal] = useState<MediaStream | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);

  const setMediaStream = useCallback((stream: MediaStream | null) => {
    if (mediaStreamRef.current && mediaStreamRef.current !== stream) {
      console.log("RecorderPage: Cleaning up old mediaStream in setMediaStream for stream ID:", mediaStreamRef.current.id);
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
    }
    mediaStreamRef.current = stream;
    _setMediaStreamInternal(stream);
  }, []);

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

  // Auth check and redirect
  useEffect(() => {
    if (!authLoading && !isAdmin) {
      console.log("RecorderPage: Auth loaded, user is NOT admin. Redirecting to /dashboard.");
      router.replace('/dashboard');
    }
  }, [authLoading, isAdmin, router]);

  const cleanupStream = useCallback(() => {
    if (mediaStreamRef.current) {
      console.log("RecorderPage: cleanupStream called. Stopping tracks for stream ID:", mediaStreamRef.current.id);
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      setMediaStream(null); 
    }
  }, [setMediaStream]);

  const cleanupRecordedVideo = useCallback(() => {
    if (recordedVideoUrl && recordedVideoUrl.startsWith('blob:')) {
      console.log("RecorderPage: cleanupRecordedVideo - Revoking recordedVideoUrl:", recordedVideoUrl);
      URL.revokeObjectURL(recordedVideoUrl);
    }
    setRecordedVideoUrl(null); // Always set to null to clear state
    setRecordedVideoBlob(null);
    recordedChunksRef.current = [];
    console.log("RecorderPage: cleanupRecordedVideo - Done.");
  }, [recordedVideoUrl]); // Depends on recordedVideoUrl to decide if revocation is needed


  const cleanupThumbnails = useCallback(() => {
    potentialThumbnails.forEach((url, index) => {
      if (url && url.startsWith('blob:')) { 
        console.log(`RecorderPage: cleanupThumbnails - Revoking potentialThumbnail URL ${index}:`, url);
        URL.revokeObjectURL(url); 
      }
    });
    setPotentialThumbnails(Array(NUM_THUMBNAILS_TO_GENERATE).fill(null));
    setPotentialThumbnailBlobs(Array(NUM_THUMBNAILS_TO_GENERATE).fill(null));
    setSelectedThumbnailIndex(null);
    console.log("RecorderPage: cleanupThumbnails - Done.");
  }, [potentialThumbnails]);


  const requestPermissionsAndSetup = useCallback(async () => {
    console.log(`RecorderPage: requestPermissionsAndSetup - Called. Current step: ${recorderStepRef.current}. MediaStream active: ${mediaStreamRef.current?.active}`);
    if (mediaStreamRef.current && mediaStreamRef.current.active) {
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

      if (!stream.active) {
        throw new Error("Camera stream is not active after permission grant.");
      }
      
      setMediaStream(stream); 
      setHasCameraPermission(true);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.src = ""; 
        videoRef.current.muted = true;
        videoRef.current.controls = false;
        await videoRef.current.play().catch(e => console.warn("RecorderPage: Error playing live preview in requestPermissionsAndSetup:", e));
      }
      setRecorderStep("readyToRecord");
    } catch (err) {
      console.error("RecorderPage: Error accessing media devices in requestPermissionsAndSetup:", err);
      setError(`Failed to access camera/microphone: ${err instanceof Error ? err.message : String(err)}.`);
      setHasCameraPermission(false);
      setRecorderStep("permissionDenied");
    }
  }, [setMediaStream, setRecorderStep]);

  // Effect for initial setup and re-setup after reset
  useEffect(() => {
    console.log(`RecorderPage: Setup Effect Triggered - authLoading: ${authLoading}, isAdmin: ${isAdmin}, recorderStep: ${_recorderStep}`);
    if (!authLoading && isAdmin) {
      if (_recorderStep === "initial" || _recorderStep === "permissionDenied") {
        console.log(`RecorderPage: Setup Effect - Conditions met (step: ${_recorderStep}), calling requestPermissionsAndSetup.`);
        requestPermissionsAndSetup();
      }
    }
  }, [authLoading, isAdmin, _recorderStep, requestPermissionsAndSetup]);

  // Effect for unmount cleanup - THIS IS CRITICAL TO GET RIGHT
  useEffect(() => {
    // This function itself will be called on unmount
    return () => {
      console.log("RecorderPage: Component UNMOUNTING - Performing cleanup.");
      
      // Call memoized cleanup functions
      cleanupStream();
      cleanupRecordedVideo();
      cleanupThumbnails();
      
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
        console.log("RecorderPage: UNMOUNT cleanup - Cleared recording timer.");
      }
    };
    // Depend on the memoized cleanup functions themselves.
    // These functions should have stable dependencies (empty or primitive values).
  }, [cleanupStream, cleanupRecordedVideo, cleanupThumbnails]);


  const getSupportedMimeType = () => {
    const types = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
    for (const type of types) { if (MediaRecorder.isTypeSupported(type)) return type; }
    return 'video/webm'; 
  };

  const startRecording = () => {
    console.log("RecorderPage: startRecording called.");
    if (!mediaStreamRef.current || !mediaStreamRef.current.active || _recorderStep !== "readyToRecord") {
      setError("Camera/mic not ready. Please grant permissions and try again.");
      requestPermissionsAndSetup(); 
      return;
    }
    if (videoRef.current && videoRef.current.srcObject !== mediaStreamRef.current) { 
        videoRef.current.srcObject = mediaStreamRef.current;
        videoRef.current.src = "";
        videoRef.current.muted = true;
        videoRef.current.controls = false;
        videoRef.current.play().catch(e => console.warn("RecorderPage: Error re-playing live feed for recording:", e));
    }
    cleanupRecordedVideo(); cleanupThumbnails(); setIsLocallySaved(false);
    recordedChunksRef.current = []; setRecordingDuration(0); setError(null);

    const mimeType = getSupportedMimeType();
    try {
      const recorder = new MediaRecorder(mediaStreamRef.current, { mimeType });
      mediaRecorderRef.current = recorder;
      recorder.onstart = () => {
        setRecorderStep("recording");
        if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = setInterval(() => {
          setRecordingDuration(prev => {
            if (prev + 1 >= MAX_RECORDING_MINUTES * 60) {
              stopRecording();
            }
            return prev + 1;
          });
        }, 1000);
      };
      recorder.ondataavailable = (event) => { 
        if (event.data.size > 0) recordedChunksRef.current.push(event.data); 
      };
      recorder.onstop = async () => {
        console.log("RecorderPage: MediaRecorder onstop. Recorded chunks:", recordedChunksRef.current.length);
        if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
        if (recordedChunksRef.current.length === 0) {
          setError("No video data was recorded. Please try again."); 
          setRecorderStep("readyToRecord"); return;
        }
        const blob = new Blob(recordedChunksRef.current, { type: mimeType });
        setRecordedVideoBlob(blob);
        const url = URL.createObjectURL(blob);
        setRecordedVideoUrl(url);
        setRecorderStep("review");

        if (videoRef.current) {
          videoRef.current.srcObject = null; 
          videoRef.current.src = url;
          videoRef.current.muted = false;
          videoRef.current.controls = true; 
          videoRef.current.onloadedmetadata = () => {
            if (videoRef.current && videoRef.current.duration > 0 && Number.isFinite(videoRef.current.duration)) {
                handleGenerateThumbnails(url, videoRef.current.duration);
            } else {
                // Fallback if duration is still not available or invalid
                const fallbackDuration = recordingDuration > 0 ? recordingDuration : 1; // Use JS timer if metadata fails
                console.warn(`Video metadata duration invalid, using JS timer: ${fallbackDuration}s`);
                setError("Video duration unknown, using timer. Thumbnails might be affected.");
                handleGenerateThumbnails(url, fallbackDuration); 
            }
          };
           videoRef.current.onerror = (e) => {
            console.error("RecorderPage: Error loading recorded video for preview:", e);
            setError("Failed to load recorded video for preview. Please check console.");
            if (blob.size > 0) {
              const fallbackDuration = recordingDuration > 0 ? recordingDuration : 1;
              handleGenerateThumbnails(url, fallbackDuration);
            }
          }
        }
      };
      recorder.onerror = (event) => { 
        console.error("RecorderPage: MediaRecorder onerror:", event);
        setError("An error occurred during recording."); 
        if (recordingTimerRef.current) clearInterval(recordingTimerRef.current); 
        setRecorderStep("readyToRecord"); 
      }
      recorder.start();
    } catch (e) { 
      console.error("RecorderPage: Failed to start MediaRecorder:", e);
      setError(`Failed to start recorder: ${e instanceof Error ? e.message : String(e)}.`); 
      setRecorderStep("readyToRecord"); 
    }
  };

  const stopRecording = () => {
    console.log("RecorderPage: stopRecording called.");
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
  };

  const formatTime = (totalSeconds: number): string => {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = Math.floor(totalSeconds % 60);
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  };

  const generateSingleThumbnail = useCallback(async (videoObjectUrl: string, timestamp: number): Promise<{ dataUrl: string; blob: Blob } | null> => {
    return new Promise((resolve) => {
        if (!videoObjectUrl || typeof timestamp !== 'number' || timestamp < 0) {
          console.warn("generateSingleThumbnail: Invalid input", { videoObjectUrl, timestamp });
          resolve(null);
          return;
        }
        const tempVideoElement = document.createElement('video');
        tempVideoElement.muted = true; 
        tempVideoElement.crossOrigin = "anonymous";
        let resolved = false;

        const cleanupAndResolve = (result: { dataUrl: string; blob: Blob } | null) => {
            if (resolved) return; 
            resolved = true;
            clearTimeout(timeoutId);
            tempVideoElement.removeEventListener('seeked', onSeeked);
            tempVideoElement.removeEventListener('error', onError);
            tempVideoElement.removeEventListener('loadedmetadata', onLoadedMetadata);
            tempVideoElement.removeEventListener('canplay', onCanPlay);
            tempVideoElement.src = ""; 
            tempVideoElement.removeAttribute('src'); 
            tempVideoElement.load(); // Explicitly tell browser to release resources
            tempVideoElement.remove();
            resolve(result);
        };

        const timeoutId = setTimeout(() => {
          console.warn(`Thumbnail generation timed out for timestamp ${timestamp}`);
          cleanupAndResolve(null);
        }, 7000); // 7 seconds timeout

        const onSeeked = () => {
            if (resolved) return;
            console.log("ThumbnailGen: Seeked to", tempVideoElement.currentTime);
            const canvas = document.createElement('canvas');
            canvas.width = tempVideoElement.videoWidth; 
            canvas.height = tempVideoElement.videoHeight;
            if (canvas.width === 0 || canvas.height === 0) {
                console.warn("ThumbnailGen: Video dimensions are zero at draw time.");
                cleanupAndResolve(null); return;
            }
            const ctx = canvas.getContext('2d');
            if (!ctx) { console.error("ThumbnailGen: Failed to get 2D context."); cleanupAndResolve(null); return; }
            try {
                ctx.drawImage(tempVideoElement, 0, 0, canvas.width, canvas.height);
                const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
                canvas.toBlob(blob => { 
                    blob && blob.size > 0 ? cleanupAndResolve({ dataUrl, blob }) : cleanupAndResolve(null); 
                }, 'image/jpeg', 0.85);
            } catch (drawError) { console.error("ThumbnailGen: Error drawing image or getting blob:", drawError); cleanupAndResolve(null); }
        };

        const onError = (e: Event) => { 
          console.error("ThumbnailGen: Video element error during thumbnail generation:", tempVideoElement.error, e);
          cleanupAndResolve(null); 
        };
        
        const onLoadedMetadata = () => {
            console.log("ThumbnailGen: Metadata loaded. Duration:", tempVideoElement.duration);
            // Ensure seek time is valid and slightly offset from start/end
            const safeTimestamp = Math.max(0.01, Math.min(timestamp, tempVideoElement.duration > 0 ? tempVideoElement.duration - 0.01 : timestamp));
            tempVideoElement.currentTime = safeTimestamp;
        };

        const onCanPlay = () => { // Alternative trigger if seeked is unreliable on some browsers
            console.log("ThumbnailGen: CanPlay event. CurrentTime:", tempVideoElement.currentTime);
            if (!resolved && tempVideoElement.currentTime > 0 && Math.abs(tempVideoElement.currentTime - timestamp) < 0.5) { // Check if close to target
               // onSeeked(); // Manually trigger if needed, or proceed if seeked is already registered
            }
        };

        tempVideoElement.addEventListener('loadedmetadata', onLoadedMetadata);
        tempVideoElement.addEventListener('seeked', onSeeked);
        tempVideoElement.addEventListener('error', onError);
        // tempVideoElement.addEventListener('canplay', onCanPlay); // Optional: for browsers where seeked might be tricky

        tempVideoElement.src = videoObjectUrl; 
        tempVideoElement.load(); // Start loading metadata
    });
  }, []);

  const handleGenerateThumbnails = useCallback(async (videoObjectUrl: string, duration: number) => {
    console.log(`RecorderPage: handleGenerateThumbnails called. URL: ${videoObjectUrl ? 'valid' : 'invalid'}, Duration: ${duration}`);
    if (!videoObjectUrl || !duration || duration <= 0 || !Number.isFinite(duration)) {
      setError("Video not ready or duration is invalid for thumbnails."); 
      setRecorderStep("review"); // Go back to review if generation can't start
      return;
    }
    setRecorderStep("generatingThumbnails"); setIsProcessing(true);
    cleanupThumbnails(); 
    const timestamps = [];
    if (duration < 1) {
      timestamps.push(Math.max(0.01, duration / 2));
    } else if (duration < 5) {
      timestamps.push(Math.max(0.01, duration * 0.2), Math.max(0.01, duration * 0.5), Math.max(0.01, duration * 0.8));
    } else { 
      const interval = duration / (NUM_THUMBNAILS_TO_GENERATE + 1);
      for (let i = 0; i < NUM_THUMBNAILS_TO_GENERATE; i++) {
        timestamps.push(Math.max(0.01, Math.min(interval * (i + 1), duration - 0.1)));
      }
    }
    const validTimestamps = [...new Set(timestamps.filter(t => t < duration && t >= 0.01))].slice(0, NUM_THUMBNAILS_TO_GENERATE);
    if (validTimestamps.length === 0 && duration > 0.01) {
      validTimestamps.push(Math.min(duration * 0.1, duration - 0.01));
    }

    console.log("RecorderPage: Generating thumbnails for timestamps:", validTimestamps);
    const generatedDataUrls: (string | null)[] = Array(NUM_THUMBNAILS_TO_GENERATE).fill(null);
    const generatedBlobs: (Blob | null)[] = Array(NUM_THUMBNAILS_TO_GENERATE).fill(null);

    for (let i = 0; i < validTimestamps.length; i++) {
      console.log(`RecorderPage: Attempting to generate thumbnail for time: ${validTimestamps[i]}`);
      const result = await generateSingleThumbnail(videoObjectUrl, validTimestamps[i]);
      if (result) { 
        generatedDataUrls[i] = result.dataUrl; 
        generatedBlobs[i] = result.blob; 
        console.log(`RecorderPage: Thumbnail ${i} generated successfully.`);
      } else {
        console.warn(`RecorderPage: Thumbnail ${i} failed for time ${validTimestamps[i]}.`);
      }
    }
    setPotentialThumbnails(generatedDataUrls); setPotentialThumbnailBlobs(generatedBlobs);
    const firstValidIndex = generatedBlobs.findIndex(b => b !== null);
    setSelectedThumbnailIndex(firstValidIndex !== -1 ? firstValidIndex : null);
    setIsProcessing(false); setRecorderStep("thumbnailsReady"); 
    if (firstValidIndex === -1) setError("Failed to generate any thumbnails. The video might be too short or problematic for browser processing.");
  }, [generateSingleThumbnail, cleanupThumbnails, setRecorderStep, setError]);

  const handleLocalSave = () => {
    if (!recordedVideoBlob) { toast({ variant: "destructive", title: "No Video to Save"}); return; }
    const urlToSave = recordedVideoUrl || URL.createObjectURL(recordedVideoBlob);
    const a = document.createElement("a"); a.href = urlToSave;
    const safeTitle = title.replace(/[^a-z0-9_]+/gi, '_').toLowerCase() || 'recorded_video';
    const extension = recordedVideoBlob.type.split('/')[1]?.split(';')[0] || 'webm';
    a.download = `${safeTitle}_${Date.now()}.${extension}`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    if (!recordedVideoUrl || recordedVideoUrl !== urlToSave) { // If URL was created just for download
        if (urlToSave.startsWith('blob:')) URL.revokeObjectURL(urlToSave); 
    }
    setIsLocallySaved(true);
    toast({ title: "Video Saved Locally", description: `Video saved as ${a.download}.` });
  };

  const dataURLtoBlob = (dataurl: string): Blob | null => {
    try {
      const arr = dataurl.split(','); if (arr.length < 2) return null;
      const mimeMatch = arr[0].match(/:(.*?);/); if (!mimeMatch || mimeMatch.length < 2) return null;
      const mime = mimeMatch[1]; const bstr = atob(arr[1]); let n = bstr.length; const u8arr = new Uint8Array(n);
      while(n--) u8arr[n] = bstr.charCodeAt(n);
      return new Blob([u8arr], {type:mime});
    } catch (e) { console.error("dataURLtoBlob conversion error:", e); return null; }
  }

  const handleUploadToFirebase = async (e: FormEvent) => {
    e.preventDefault();
    if (!recordedVideoBlob || selectedThumbnailIndex === null ) { setError("Video or selected thumbnail is missing."); return; }
    const thumbnailDataUrl = potentialThumbnails[selectedThumbnailIndex];
    if (!thumbnailDataUrl) { setError("Selected thumbnail data URL is invalid."); return; }
    const thumbnailBlob = dataURLtoBlob(thumbnailDataUrl);
    if (!thumbnailBlob) { setError("Failed to convert thumbnail to uploadable format."); return; }
    if (!title.trim()) { setError("Video title is required."); return; }
    if (!user || !doctorProfile || !isAdmin) { setError("Authentication error or insufficient permissions."); return; }

    setRecorderStep("uploading"); setIsProcessing(true); setUploadProgress(0); setError(null);
    try {
      const videoId = uuidv4();
      const videoFileExtension = recordedVideoBlob.type.split('/')[1]?.split(';')[0] || 'webm';
      const safeVideoTitle = title.replace(/[^a-zA-Z0-9_.-]/g, '_').toLowerCase();
      const videoFileName = `${safeVideoTitle}_${videoId.substring(0,8)}.${videoFileExtension}`;
      const thumbnailFileName = `thumb_${safeVideoTitle}_${videoId.substring(0,8)}.jpg`;

      const videoStoragePath = await uploadFileToStorage(`videos/${doctorProfile.uid}`, recordedVideoBlob, videoFileName, (s) => setUploadProgress(Math.round((s.bytesTransferred / s.totalBytes) * 0.8 * 100)));
      const uploadedVideoUrl = await getFirebaseStorageDownloadUrl(videoStoragePath);
      setUploadProgress(80);

      const thumbnailStoragePath = await uploadFileToStorage(`thumbnails/${doctorProfile.uid}`, thumbnailBlob, thumbnailFileName, (s) => setUploadProgress(Math.round(80 + (s.bytesTransferred / s.totalBytes) * 0.2 * 100)));
      const uploadedThumbnailUrl = await getFirebaseStorageDownloadUrl(thumbnailStoragePath);
      setUploadProgress(100);

      const videoMetaData: VideoMeta = {
        id: videoId, title, description, doctorId: doctorProfile.uid,
        doctorName: doctorProfile.displayName || doctorProfile.email || "N/A",
        videoUrl: uploadedVideoUrl, thumbnailUrl: uploadedThumbnailUrl,
        duration: formatTime(recordingDuration), 
        recordingDuration: recordingDuration, 
        tags: keywords.split(',').map(k => k.trim()).filter(Boolean),
        featured, storagePath: videoStoragePath, thumbnailStoragePath,
        videoSize: recordedVideoBlob.size, videoType: recordedVideoBlob.type,
        createdAt: new Date().toISOString(), // Client-side, server action will use serverTimestamp
        permalink: `/videos/${videoId}`, viewCount: 0, likeCount: 0, commentCount: 0, comments: []
      };
      
      const result = await saveVideoMetadataAction(videoMetaData);
      if (result.success) {
        toast({ title: "Upload Successful!", description: `Video "${title}" is now available.` });
        setRecorderStep("success");
      } else { throw new Error(result.error || "Failed to save video metadata."); }
    } catch (err) {
      console.error("RecorderPage: Upload to Firebase error:", err);
      setError(err instanceof Error ? err.message : "Upload failed. Please try again.");
      setRecorderStep("thumbnailsReady"); // Revert to a step where user can retry or change details
    } finally { setIsProcessing(false); }
  };
  
  const resetRecorderInterface = useCallback(() => {
    console.log("RecorderPage: resetRecorderInterface called.");
    stopRecording(); 
    if (videoRef.current) {
      videoRef.current.srcObject = null;
      videoRef.current.src = "";
      videoRef.current.removeAttribute('src'); 
      videoRef.current.removeAttribute('srcObject');
      videoRef.current.load();
    }
    cleanupRecordedVideo(); 
    cleanupThumbnails();    
    cleanupStream(); // Ensure old stream is fully stopped before trying to get a new one

    setIsLocallySaved(false);
    setTitle(''); setDescription(''); setKeywords(''); setFeatured(false);
    setRecordingDuration(0); setError(null); setUploadProgress(0); setIsProcessing(false);
    setIsVideoPlaying(false); 
    setHasCameraPermission(null); 
    
    setRecorderStep("initial"); // This will trigger the setup useEffect
    console.log("RecorderPage: resetRecorderInterface finished. Step set to 'initial'.");
  }, [cleanupRecordedVideo, cleanupThumbnails, cleanupStream, setRecorderStep]);
  
  const handlePlayPause = () => {
    if(videoRef.current && (_recorderStep === "review" || _recorderStep === "thumbnailsReady")) {
      if(videoRef.current.paused || videoRef.current.ended) {
        videoRef.current.play().then(() => setIsVideoPlaying(true)).catch(e => console.error("RecorderPage: Error playing review video:", e));
      } else {
        videoRef.current.pause();
        setIsVideoPlaying(false);
      }
    }
  };

  useEffect(() => {
    const videoElement = videoRef.current;
    if (videoElement && (_recorderStep === "review" || _recorderStep === "thumbnailsReady")) {
      const handlePlay = () => setIsVideoPlaying(true);
      const handlePause = () => setIsVideoPlaying(false);
      videoElement.addEventListener('play', handlePlay);
      videoElement.addEventListener('pause', handlePause);
      return () => {
        videoElement.removeEventListener('play', handlePlay);
        videoElement.removeEventListener('pause', handlePause);
      };
    }
  }, [_recorderStep]);


  if (authLoading) return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-primary" /> <span className="ml-2">Loading Auth...</span></div>;
  if (!isAdmin && !authLoading) return <Alert variant="destructive"><AlertCircle /> <AlertTitle>Access Denied</AlertTitle><AlertDescription>You do not have permission to access this page.</AlertDescription></Alert>;

  const canSaveLocally = recordedVideoBlob && title.trim() && selectedThumbnailIndex !== null && potentialThumbnails[selectedThumbnailIndex!] !== null;
  const canUpload = recordedVideoBlob && title.trim() && selectedThumbnailIndex !== null && potentialThumbnails[selectedThumbnailIndex!] !== null && isLocallySaved;

  return (
    <div className="container mx-auto py-8">
    <Card className="w-full max-w-2xl mx-auto shadow-xl rounded-lg">
      <CardHeader>
        <CardTitle className="text-2xl font-headline flex items-center gap-2"><Camera size={28}/> Web Video Recorder</CardTitle>
        <CardDescription>Record, review, add details, save locally, then upload. Max {MAX_RECORDING_MINUTES} mins.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {error && <Alert variant="destructive" className="shadow-md"><AlertCircle /> <AlertTitle>Error</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
        {_recorderStep === "success" && <Alert variant="default" className="bg-green-100 border-green-400 text-green-700 dark:bg-green-900/30 dark:text-green-300 shadow-md"><CheckCircle /> <AlertTitle>Success!</AlertTitle><AlertDescription>Video uploaded. You can record another.</AlertDescription></Alert>}

        {_recorderStep === "permissionDenied" && (
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
          {(_recorderStep === "initial" || _recorderStep === "settingUp") && 
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/50 text-white">
              <Loader2 className="h-10 w-10 animate-spin mb-3"/>
              <p className="text-lg">{_recorderStep === "initial" ? "Initializing Recorder..." : "Setting up camera..."}</p>
            </div>
          }
          {_recorderStep === "recording" && 
            <div className="absolute top-3 right-3 bg-red-600 text-white px-3 py-1.5 rounded-md text-sm font-medium flex items-center gap-2 shadow-lg">
                <Mic className="animate-pulse" /> REC {formatTime(recordingDuration)}
            </div>
          }
           {(_recorderStep === "review" || _recorderStep === "thumbnailsReady") && recordedVideoUrl && (
              <div className="absolute bottom-0 left-0 right-0 p-2 bg-black/50 flex items-center justify-between">
                 <Button onClick={handlePlayPause} variant="ghost" size="icon" className="text-white hover:text-primary">
                    {isVideoPlaying ? <Pause size={20} /> : <Play size={20} />}
                  </Button>
                  <span className="text-white text-xs">{formatTime(videoRef.current?.currentTime || 0)} / {formatTime(videoRef.current?.duration || recordingDuration || 0)}</span>
              </div>
            )}
        </div>
        
        <div className="space-y-3">
          {_recorderStep === "readyToRecord" && (
            <Button onClick={startRecording} className="w-full gap-2 text-lg py-3 bg-green-600 hover:bg-green-700 shadow-md"><Mic /> Start Recording</Button>
          )}
          {_recorderStep === "recording" && (
            <Button onClick={stopRecording} variant="destructive" className="w-full gap-2 text-lg py-3 shadow-md"><Square /> Stop Recording</Button>
          )}
          {(_recorderStep === "review" || _recorderStep === "success" || _recorderStep === "uploading" || _recorderStep === "thumbnailsReady" || _recorderStep === "generatingThumbnails") && (
            <Button onClick={resetRecorderInterface} variant="outline" className="w-full gap-2 shadow-sm"><RefreshCcw /> Record Another Video</Button>
          )}
        </div>
        
        {(_recorderStep === "generatingThumbnails" || (isProcessing && _recorderStep === "review")) && (
             <div className="text-center py-4"><Loader2 className="h-6 w-6 animate-spin text-primary mx-auto mb-2" /><p>Generating thumbnails...</p></div>
        )}

        {_recorderStep === "thumbnailsReady" && !isProcessing && potentialThumbnails.some(t => t) && (
            <div className="pt-4 border-t border-border">
              <Label className="mb-2 block text-base font-medium">Select Thumbnail <span className="text-destructive">*</span></Label>
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                {potentialThumbnails.map((thumbUrl, index) => (
                  thumbUrl ? (
                    <button key={index} type="button" onClick={() => setSelectedThumbnailIndex(index)}
                      className={`relative aspect-video rounded-md overflow-hidden border-2 transition-all shadow-sm hover:opacity-80
                          ${selectedThumbnailIndex === index ? 'border-primary ring-2 ring-primary/50' : 'border-muted hover:border-primary/50'}`}>
                      <NextImage src={thumbUrl} alt={`Thumbnail ${index + 1}`} fill sizes="100px" className="object-cover" data-ai-hint="video thumbnail select" />
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
         {_recorderStep === "thumbnailsReady" && !isProcessing && !potentialThumbnails.some(t => t) && (
            <Alert variant="warning">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Thumbnail Generation Failed</AlertTitle>
                <AlertDescription>
                    Could not generate thumbnails for this video. You can still proceed to save and upload if you wish.
                    A default placeholder will be used, or you can update it later.
                </AlertDescription>
            </Alert>
        )}
        
        {_recorderStep === "thumbnailsReady" && !isProcessing && (
            <form onSubmit={handleUploadToFirebase} className="space-y-4 pt-6 border-t border-border" id="web-video-upload-form">
                <h3 className="text-xl font-semibold font-headline">Video Details</h3>
                <div className="space-y-1"><Label htmlFor="title">Title <span className="text-destructive">*</span></Label><Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} required /></div>
                <div className="space-y-1"><Label htmlFor="description">Description</Label><Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} rows={3}/></div>
                <div className="space-y-1"><Label htmlFor="keywords">Keywords (comma-separated)</Label><Input id="keywords" value={keywords} onChange={(e) => setKeywords(e.target.value)} /></div>
                <div className="flex items-center space-x-2"><Checkbox id="featured" checked={featured} onCheckedChange={(checked) => setFeatured(Boolean(checked))} /><Label htmlFor="featured" className="font-normal text-sm">Feature this video (show in Recent Activities)</Label></div>
                
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                    <Button type="button" onClick={handleLocalSave} variant="outline" className="w-full gap-2 shadow-sm" 
                            disabled={!recordedVideoBlob || (selectedThumbnailIndex === null && potentialThumbnails.some(t=>t)) || !title.trim() || isLocallySaved}>
                        <Download /> {isLocallySaved ? "Saved Locally" : "Save to Device"}
                    </Button>
                    <Button type="submit" form="web-video-upload-form" className="w-full gap-2 bg-primary hover:bg-primary/90 shadow-md" 
                            disabled={!canUpload || (isProcessing && _recorderStep === "uploading") || !recordedVideoBlob || (selectedThumbnailIndex === null && potentialThumbnails.some(t=>t)) || !title.trim() }>
                        {isProcessing && _recorderStep==="uploading" ? <Loader2 className="animate-spin"/> : <UploadCloud />} Upload to Firebase
                    </Button>
                </div>
            </form>
        )}

        {_recorderStep === "uploading" && isProcessing && (
            <div className="space-y-2 pt-4 border-t border-border">
                <Label>Upload Progress</Label><Progress value={uploadProgress} className="w-full h-3 shadow-inner" /><p className="text-sm text-center text-muted-foreground">{Math.round(uploadProgress)}%</p>
            </div>
        )}
      </CardContent>
    </Card>
    </div>
  );
}
    
