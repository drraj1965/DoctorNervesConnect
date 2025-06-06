
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
  
  const recorderStepRef = useRef<RecorderStep>("initial"); 
  const [_recorderStep, _setRecorderStepInternal] = useState<RecorderStep>("initial");

  const setRecorderStep = useCallback((step: RecorderStep) => {
    if (recorderStepRef.current !== step) {
      console.log(`RecorderPage: Setting recorderStep from ${recorderStepRef.current} to ${step}`);
      recorderStepRef.current = step;
      _setRecorderStepInternal(step);
    }
  }, []);

  const mediaStreamRef = useRef<MediaStream | null>(null);
  const [_mediaStream, _setMediaStreamInternal] = useState<MediaStream | null>(null);

  const setMediaStream = useCallback((stream: MediaStream | null) => {
    // Clean up old stream if it exists and is different
    if (mediaStreamRef.current && mediaStreamRef.current !== stream && mediaStreamRef.current.active) {
      console.log("RecorderPage: Cleaning up old mediaStream in setMediaStream for stream ID:", mediaStreamRef.current.id);
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
    }
    mediaStreamRef.current = stream;
    _setMediaStreamInternal(stream); // Update React state if needed for UI reactions
    console.log(`RecorderPage: mediaStream set. New stream ID: ${stream?.id}, Active: ${stream?.active}`);
  }, []);

  const recordedChunksRef = useRef<Blob[]>([]);
  const [recordedVideoBlob, setRecordedVideoBlob] = useState<Blob | null>(null);
  const [recordedVideoUrl, setRecordedVideoUrl] = useState<string | null>(null);
  const [recordingDuration, setRecordingDuration] = useState(0); 
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
  const [isProcessing, setIsProcessing] = useState(false); // General processing like thumbnail gen or upload
  const [isLocallySaved, setIsLocallySaved] = useState(false);
  const [hasCameraPermission, setHasCameraPermission] = useState<boolean | null>(null); // null: undetermined, true: granted, false: denied

  useEffect(() => {
    if (!authLoading && !isAdmin) {
      console.log("RecorderPage: Auth loaded, user is NOT admin. Redirecting to /dashboard.");
      router.replace('/dashboard');
    }
  }, [authLoading, isAdmin, router]);

  const cleanupStream = useCallback(() => {
    if (mediaStreamRef.current && mediaStreamRef.current.active) {
      console.log("RecorderPage: cleanupStream called. Stopping tracks for stream ID:", mediaStreamRef.current.id);
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      setMediaStream(null); // This will also set mediaStreamRef.current to null
    } else {
        console.log("RecorderPage: cleanupStream called, but no active stream to clean or ref already null.");
    }
  }, [setMediaStream]);

  const cleanupRecordedVideo = useCallback(() => {
    if (recordedVideoUrl && recordedVideoUrl.startsWith('blob:')) {
      console.log("RecorderPage: cleanupRecordedVideo - Revoking recordedVideoUrl:", recordedVideoUrl);
      URL.revokeObjectURL(recordedVideoUrl);
    }
    setRecordedVideoUrl(null);
    setRecordedVideoBlob(null);
    recordedChunksRef.current = [];
    console.log("RecorderPage: cleanupRecordedVideo - Done.");
  }, [recordedVideoUrl]); // Dependency: recordedVideoUrl to react to its changes if needed, though it's mostly for explicit cleanup.


  const cleanupThumbnails = useCallback(() => {
    potentialThumbnails.forEach((url, index) => {
      if (url && url.startsWith('blob:')) { // Only revoke if it's a blob URL. Data URLs don't need revocation.
        console.log(`RecorderPage: cleanupThumbnails - Revoking potentialThumbnail blob URL ${index}:`, url);
        URL.revokeObjectURL(url); 
      }
    });
    setPotentialThumbnails(Array(NUM_THUMBNAILS_TO_GENERATE).fill(null));
    setPotentialThumbnailBlobs(Array(NUM_THUMBNAILS_TO_GENERATE).fill(null));
    setSelectedThumbnailIndex(null);
    console.log("RecorderPage: cleanupThumbnails - Done.");
  }, [potentialThumbnails]);


  const requestPermissionsAndSetup = useCallback(async () => {
    console.log(`RecorderPage: requestPermissionsAndSetup - Called. Current step: ${recorderStepRef.current}.`);
    setRecorderStep("settingUp");
    setError(null); // Clear previous errors
    setHasCameraPermission(null); // Reset permission status

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: { echoCancellation: true, noiseSuppression: true },
      });

      const videoTracks = stream.getVideoTracks();
      if (!stream.active || videoTracks.length === 0 || !videoTracks[0].enabled || videoTracks[0].muted) {
        console.error("RecorderPage: Camera stream is not active or video track is problematic.", { streamActive: stream.active, videoTracksCount: videoTracks.length, firstTrackEnabled: videoTracks[0]?.enabled, firstTrackMuted: videoTracks[0]?.muted });
        throw new Error("Camera stream is not active or video track is problematic. Please check browser permissions and ensure your camera is not in use by another application.");
      }
      
      setMediaStream(stream); // This will set mediaStreamRef.current via its callback
      setHasCameraPermission(true);

      if (videoRef.current) {
        console.log("RecorderPage: requestPermissionsAndSetup - Assigning stream to videoRef.current.srcObject");
        videoRef.current.srcObject = stream;
        // The video tag has autoPlay and muted, so it should start playing.
        // We listen to 'oncanplay' to confirm and then set the recorder step.
        videoRef.current.oncanplay = () => {
          console.log("RecorderPage: Live preview 'canplay' event fired. Video dimensions:", videoRef.current?.videoWidth, "x", videoRef.current?.videoHeight,". Setting step to readyToRecord.");
          if(videoRef.current && videoRef.current.videoWidth > 0 && videoRef.current.videoHeight > 0){
            setRecorderStep("readyToRecord");
          } else {
            console.warn("RecorderPage: 'canplay' fired but video dimensions are 0. Stream might not be fully ready or there's an issue.");
            // Optionally, add a small delay and recheck or show an error
            setError("Camera preview started but appears blank. Try refreshing or checking camera.");
            setRecorderStep("permissionDenied"); // Or a new error step
          }
        };
        videoRef.current.onerror = (e) => {
            console.error("RecorderPage: Video element error during live preview setup:", videoRef.current?.error, e);
            setError("Video element error during setup. Please refresh or check permissions.");
            setRecorderStep("permissionDenied");
        };
      } else {
        console.warn("RecorderPage: requestPermissionsAndSetup - videoRef.current is null at the time of stream assignment.");
        setError("Video element not found. Cannot setup camera.");
        setRecorderStep("permissionDenied");
      }
    } catch (err) {
      console.error("RecorderPage: Error accessing media devices in requestPermissionsAndSetup:", err);
      setError(`Failed to access camera/microphone: ${err instanceof Error ? err.message : String(err)}.`);
      setHasCameraPermission(false);
      setRecorderStep("permissionDenied");
    }
  }, [setMediaStream, setRecorderStep, setError, setHasCameraPermission]); // Dependencies are stable setters

  // Effect for initial setup and permission request
  useEffect(() => {
    console.log(`RecorderPage: Setup Effect Triggered - authLoading: ${authLoading}, isAdmin: ${isAdmin}, recorderStep: ${_recorderStep}, mediaStream active: ${mediaStreamRef.current?.active}`);
    if (!authLoading && isAdmin) {
      if (_recorderStep === "initial" || _recorderStep === "permissionDenied") {
        // If stream is already active (e.g. from hot reload) AND videoRef exists AND we are in 'initial' step,
        // try to re-attach and set to ready.
        if (mediaStreamRef.current && mediaStreamRef.current.active && videoRef.current && _recorderStep === "initial") {
            console.log("RecorderPage: Setup Effect - Active stream found on initial load. Re-attaching.");
            videoRef.current.srcObject = mediaStreamRef.current;
            // autoPlay muted should handle playing. We still need oncanplay to transition step.
            videoRef.current.oncanplay = () => {
                 console.log("RecorderPage: Re-attached stream 'canplay'. Setting to readyToRecord.");
                 setRecorderStep("readyToRecord");
            };
            videoRef.current.onerror = (e) => {
                console.error("RecorderPage: Video element error during stream re-attachment:", videoRef.current?.error, e);
                setError("Video element error during re-attachment. Attempting full permission request.");
                // Fallback to requesting permissions again if re-attachment fails
                requestPermissionsAndSetup(); // Call directly, as it handles state transitions
            };
        } else if ((!mediaStreamRef.current || !mediaStreamRef.current.active) || _recorderStep === "permissionDenied") {
            // If no active stream, or if we are in permissionDenied state (allowing retry)
            console.log(`RecorderPage: Setup Effect - No active stream or explicit permission retry. Calling requestPermissionsAndSetup for step: ${_recorderStep}`);
            requestPermissionsAndSetup();
        }
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, isAdmin, _recorderStep]); // requestPermissionsAndSetup is stable, no need to list it.

  // Unmount cleanup effect
  useEffect(() => {
    // Capture current refs and state for cleanup, as they might change before cleanup runs
    const currentMediaStream = mediaStreamRef.current;
    const currentRecordedVideoUrl = recordedVideoUrl; 
    const currentPotentialThumbnails = [...potentialThumbnails]; 
    const currentTimer = recordingTimerRef.current;

    return () => {
      console.log("RecorderPage: Component UNMOUNTING - Performing cleanup.");
      
      if (currentMediaStream && currentMediaStream.active) {
        console.log("RecorderPage: UNMOUNT cleanup - Stopping mediaStream tracks for ID:", currentMediaStream.id);
        currentMediaStream.getTracks().forEach(track => track.stop());
      }
      if (currentRecordedVideoUrl && currentRecordedVideoUrl.startsWith('blob:')) {
        console.log("RecorderPage: UNMOUNT cleanup - Revoking recordedVideoUrl:", currentRecordedVideoUrl);
        URL.revokeObjectURL(currentRecordedVideoUrl);
      }
      currentPotentialThumbnails.forEach((url, index) => {
        if (url && url.startsWith('blob:')) {
          console.log(`RecorderPage: UNMOUNT cleanup - Revoking potentialThumbnail blob URL ${index}:`, url);
          URL.revokeObjectURL(url);
        }
      });
      if (currentTimer) {
        clearInterval(currentTimer);
        console.log("RecorderPage: UNMOUNT cleanup - Cleared recording timer.");
      }
       // Ensure video element srcObject is cleared on unmount
      if (videoRef.current) {
        videoRef.current.srcObject = null;
        console.log("RecorderPage: UNMOUNT cleanup - Cleared videoRef.current.srcObject.");
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps 
  }, []); // Empty dependency array: runs only on unmount


  const getSupportedMimeType = () => {
    const types = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
    for (const type of types) { if (MediaRecorder.isTypeSupported(type)) return type; }
    console.warn("RecorderPage: No specifically preferred MIME type supported, defaulting to 'video/webm' or browser default.");
    return 'video/webm'; // Fallback, though MediaRecorder might choose its own if this isn't supported.
  };

  const startRecording = () => {
    console.log("RecorderPage: startRecording called.");
    if (!mediaStreamRef.current || !mediaStreamRef.current.active || _recorderStep !== "readyToRecord") {
      setError("Camera/mic not ready. Please grant permissions and try again.");
      // If in a weird state, try to re-init
      if (_recorderStep !== "settingUp") requestPermissionsAndSetup(); 
      return;
    }
    // Ensure live preview is visible and using the correct stream before recording
    if (videoRef.current && videoRef.current.srcObject !== mediaStreamRef.current) { 
        console.log("RecorderPage: startRecording - Live preview srcObject mismatch. Re-assigning.");
        videoRef.current.srcObject = mediaStreamRef.current;
        // Video tag has autoPlay and muted, so it should play.
    }
    cleanupRecordedVideo(); cleanupThumbnails(); setIsLocallySaved(false);
    recordedChunksRef.current = []; setRecordingDuration(0); setError(null);

    const mimeType = getSupportedMimeType();
    console.log("RecorderPage: Attempting to record with MIME type:", mimeType);
    try {
      const options: MediaRecorderOptions = {};
      if (mimeType) options.mimeType = mimeType; // Only specify if we have a supported one

      const recorder = new MediaRecorder(mediaStreamRef.current, options);
      mediaRecorderRef.current = recorder;
      recorder.onstart = () => {
        console.log("RecorderPage: MediaRecorder onstart. Actual MIME type:", recorder.mimeType);
        setRecorderStep("recording");
        if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = setInterval(() => {
          setRecordingDuration(prev => {
            if (prev + 1 >= MAX_RECORDING_MINUTES * 60) {
              console.log("RecorderPage: Max recording duration reached. Stopping.");
              stopRecording(); 
            }
            return prev + 1;
          });
        }, 1000);
      };
      recorder.ondataavailable = (event) => { 
        if (event.data.size > 0) {
            console.log("RecorderPage: MediaRecorder ondataavailable, chunk size:", event.data.size);
            recordedChunksRef.current.push(event.data); 
        }
      };
      recorder.onstop = async () => {
        console.log("RecorderPage: MediaRecorder onstop. Recorded chunks count:", recordedChunksRef.current.length);
        if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
        if (recordedChunksRef.current.length === 0) {
          console.warn("RecorderPage: No video data was recorded (0 chunks).");
          setError("No video data was recorded. Please try again. Ensure mic/camera are functioning."); 
          setRecorderStep("readyToRecord"); return;
        }
        const blob = new Blob(recordedChunksRef.current, { type: recorder.mimeType || mimeType }); // Use actual mimeType if available
        console.log("RecorderPage: Recorded video blob created. Size:", blob.size, "Type:", blob.type);

        if (blob.size === 0) {
          console.warn("RecorderPage: Recorded video blob is empty (size 0).");
          setError("Recording resulted in an empty file. Please try again.");
          setRecorderStep("readyToRecord"); return;
        }

        setRecordedVideoBlob(blob);
        const url = URL.createObjectURL(blob);
        setRecordedVideoUrl(url);
        setRecorderStep("review");

        // Configure video element for review
        if (videoRef.current) {
          videoRef.current.srcObject = null; // Important: remove live stream
          videoRef.current.src = url;
          videoRef.current.muted = false;
          videoRef.current.controls = true; 
          videoRef.current.oncanplay = null; // Remove live preview oncanplay listener
          videoRef.current.onloadedmetadata = () => { // New listener for recorded video
            if (videoRef.current && videoRef.current.duration > 0 && Number.isFinite(videoRef.current.duration)) {
                console.log("RecorderPage: Recorded video metadata loaded. Duration:", videoRef.current.duration);
                handleGenerateThumbnails(url, videoRef.current.duration);
            } else {
                const fallbackDuration = recordingDuration > 0 ? recordingDuration : 1; 
                console.warn(`RecorderPage: Recorded video metadata duration invalid or zero. Using JS timer fallback: ${fallbackDuration}s`);
                // setError("Video duration unknown, using timer. Thumbnails might be affected.");
                handleGenerateThumbnails(url, fallbackDuration); 
            }
          };
           videoRef.current.onerror = (e) => {
            console.error("RecorderPage: Error loading recorded video for preview:", e);
            setError("Failed to load recorded video for preview. File might be corrupted.");
            // Even if preview fails, if blob exists, try generating thumbnails
            if (blob.size > 0) {
              const fallbackDuration = recordingDuration > 0 ? recordingDuration : 1;
              handleGenerateThumbnails(url, fallbackDuration);
            }
          }
          videoRef.current.load(); // Ensure the new src is loaded
        }
      };
      recorder.onerror = (event) => { 
        console.error("RecorderPage: MediaRecorder onerror:", event);
        setError(`An error occurred during recording: ${ (event as any)?.error?.name || 'Unknown error'}`); 
        if (recordingTimerRef.current) clearInterval(recordingTimerRef.current); 
        setRecorderStep("readyToRecord"); 
      }
      recorder.start();
      console.log("RecorderPage: MediaRecorder.start() called.");
    } catch (e) { 
      console.error("RecorderPage: Failed to start MediaRecorder:", e);
      setError(`Failed to start recorder: ${e instanceof Error ? e.message : String(e)}.`); 
      setRecorderStep("readyToRecord"); 
    }
  };

  const stopRecording = () => {
    console.log("RecorderPage: stopRecording called.");
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      console.log("RecorderPage: MediaRecorder is recording, calling stop().");
      mediaRecorderRef.current.stop();
    } else {
      console.log("RecorderPage: MediaRecorder not recording or ref is null. State:", mediaRecorderRef.current?.state);
    }
    // Timer cleanup is handled in onstop or if stopRecording is called manually before onstop
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
        tempVideoElement.crossOrigin = "anonymous"; // Important for canvas.toDataURL if video is from different origin (not the case for blob URLs)
        let resolved = false;

        const cleanupAndResolve = (result: { dataUrl: string; blob: Blob } | null) => {
            if (resolved) return; 
            resolved = true;
            clearTimeout(timeoutId);
            tempVideoElement.removeEventListener('seeked', onSeeked);
            tempVideoElement.removeEventListener('error', onError);
            tempVideoElement.removeEventListener('loadedmetadata', onLoadedMetadata);
            // tempVideoElement.src = ""; // Not always necessary and can sometimes cause issues
            tempVideoElement.removeAttribute('src'); 
            tempVideoElement.load(); // Stop any loading
            tempVideoElement.remove(); // Remove from DOM
            resolve(result);
        };

        const timeoutId = setTimeout(() => {
          console.warn(`Thumbnail generation timed out for timestamp ${timestamp}`);
          cleanupAndResolve(null);
        }, 7000); // 7 second timeout per thumbnail

        const onSeeked = () => {
            if (resolved) return;
            console.log("ThumbnailGen: Seeked to", tempVideoElement.currentTime);
            const canvas = document.createElement('canvas');
            // Ensure videoWidth and videoHeight are available and positive
            if (tempVideoElement.videoWidth <= 0 || tempVideoElement.videoHeight <= 0) {
                console.warn("ThumbnailGen: Video dimensions are zero or invalid at draw time.", { w: tempVideoElement.videoWidth, h: tempVideoElement.videoHeight});
                cleanupAndResolve(null);
                return;
            }
            canvas.width = tempVideoElement.videoWidth; 
            canvas.height = tempVideoElement.videoHeight;
            
            const ctx = canvas.getContext('2d');
            if (!ctx) { console.error("ThumbnailGen: Failed to get 2D context."); cleanupAndResolve(null); return; }
            try {
                ctx.drawImage(tempVideoElement, 0, 0, canvas.width, canvas.height);
                const dataUrl = canvas.toDataURL('image/jpeg', 0.85); // Use JPEG for smaller size
                canvas.toBlob(blob => { 
                    if (blob && blob.size > 0) {
                        cleanupAndResolve({ dataUrl, blob });
                    } else {
                        console.warn("ThumbnailGen: Canvas toBlob resulted in null or empty blob.");
                        cleanupAndResolve(null); 
                    }
                }, 'image/jpeg', 0.85);
            } catch (drawError) { console.error("ThumbnailGen: Error drawing image or getting blob:", drawError); cleanupAndResolve(null); }
        };

        const onError = (e: Event) => { 
          console.error("ThumbnailGen: Video element error during thumbnail generation:", tempVideoElement.error, e);
          cleanupAndResolve(null); 
        };
        
        const onLoadedMetadata = () => {
            console.log("ThumbnailGen: Metadata loaded for temp video. Duration:", tempVideoElement.duration, " Seeking to:", timestamp);
            // Ensure timestamp is within valid range, slightly offset from start/end for safety
            const safeTimestamp = Math.max(0.01, Math.min(timestamp, (tempVideoElement.duration > 0 && Number.isFinite(tempVideoElement.duration)) ? tempVideoElement.duration - 0.01 : timestamp));
            tempVideoElement.currentTime = safeTimestamp;
        };

        tempVideoElement.addEventListener('loadedmetadata', onLoadedMetadata);
        tempVideoElement.addEventListener('seeked', onSeeked);
        tempVideoElement.addEventListener('error', onError);
        
        tempVideoElement.src = videoObjectUrl; // Set src to start loading
        tempVideoElement.load(); // Explicitly call load
    });
  }, []);

  const handleGenerateThumbnails = useCallback(async (videoObjectUrl: string, duration: number) => {
    console.log(`RecorderPage: handleGenerateThumbnails called. URL: ${videoObjectUrl ? 'valid' : 'invalid'}, Duration: ${duration}`);
    if (!videoObjectUrl || !duration || duration <= 0 || !Number.isFinite(duration)) {
      setError("Video not ready or duration is invalid for thumbnails. Cannot generate."); 
      setRecorderStep("review"); // Stay in review or move to a specific error state
      return;
    }
    setRecorderStep("generatingThumbnails"); setIsProcessing(true);
    cleanupThumbnails(); // Clear any old thumbnails and their object URLs
    
    const timestamps = [];
    // Define timestamps for thumbnail generation
    if (duration < 1) { // Very short video
      timestamps.push(Math.max(0.01, duration / 2)); // One at midpoint
    } else if (duration < 5) { // Short video
      timestamps.push(Math.max(0.01, duration * 0.2), Math.max(0.01, duration * 0.5), Math.max(0.01, duration * 0.8));
    } else { // Longer video, distribute NUM_THUMBNAILS_TO_GENERATE
      const interval = duration / (NUM_THUMBNAILS_TO_GENERATE + 1); // Create NUM_THUMBNAILS_TO_GENERATE points + ends
      for (let i = 0; i < NUM_THUMBNAILS_TO_GENERATE; i++) {
        timestamps.push(Math.max(0.01, Math.min(interval * (i + 1), duration - 0.1))); // Ensure not exactly at the end
      }
    }
    // Ensure unique timestamps and within bounds, limit to NUM_THUMBNAILS_TO_GENERATE
    const validTimestamps = [...new Set(timestamps.filter(t => t < duration && t >= 0.01))].slice(0, NUM_THUMBNAILS_TO_GENERATE);
    // If somehow no valid timestamps, try one near the start
    if (validTimestamps.length === 0 && duration > 0.01) {
      validTimestamps.push(Math.min(duration * 0.1, duration - 0.01));
    }


    console.log("RecorderPage: Generating thumbnails for timestamps:", validTimestamps);
    const generatedDataUrls: (string | null)[] = Array(NUM_THUMBNAILS_TO_GENERATE).fill(null);
    const generatedBlobs: (Blob | null)[] = Array(NUM_THUMBNAILS_TO_GENERATE).fill(null);

    for (let i = 0; i < validTimestamps.length; i++) {
      if (i >= NUM_THUMBNAILS_TO_GENERATE) break; // Ensure we don't exceed array bounds
      console.log(`RecorderPage: Attempting to generate thumbnail for time: ${validTimestamps[i]}`);
      const result = await generateSingleThumbnail(videoObjectUrl, validTimestamps[i]);
      if (result) { 
        generatedDataUrls[i] = result.dataUrl; 
        generatedBlobs[i] = result.blob; 
        console.log(`RecorderPage: Thumbnail ${i} generated successfully.`);
      } else {
        console.warn(`RecorderPage: Thumbnail ${i} generation failed for time ${validTimestamps[i]}.`);
      }
    }
    setPotentialThumbnails(generatedDataUrls); setPotentialThumbnailBlobs(generatedBlobs);
    const firstValidIndex = generatedBlobs.findIndex(b => b !== null);
    setSelectedThumbnailIndex(firstValidIndex !== -1 ? firstValidIndex : null);
    setIsProcessing(false); setRecorderStep("thumbnailsReady"); 
    if (firstValidIndex === -1) {
        console.warn("RecorderPage: Failed to generate any thumbnails.");
        setError("Failed to generate any thumbnails. The video might be too short or problematic for browser processing. You can still proceed to save/upload without a preview.");
    }
  }, [generateSingleThumbnail, cleanupThumbnails, setRecorderStep, setError]);

  const handleLocalSave = () => {
    if (!recordedVideoBlob) { toast({ variant: "destructive", title: "No Video to Save", description: "Please record a video first."}); return; }
    const urlToSave = recordedVideoUrl || URL.createObjectURL(recordedVideoBlob); // Should always have recordedVideoUrl if blob exists
    const a = document.createElement("a"); a.href = urlToSave;
    const safeTitle = title.replace(/[^a-z0-9_]+/gi, '_').toLowerCase() || 'recorded_video';
    const extension = recordedVideoBlob.type.split('/')[1]?.split(';')[0] || 'webm'; // Get extension from MIME
    a.download = `${safeTitle}_${Date.now()}.${extension}`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    // Don't revoke recordedVideoUrl here as it's needed for display/upload, only revoke temp ones if created
    if (urlToSave !== recordedVideoUrl && urlToSave.startsWith('blob:')) { 
        URL.revokeObjectURL(urlToSave); 
    }
    setIsLocallySaved(true);
    toast({ title: "Video Saved Locally", description: `Video saved as ${a.download}. You can now proceed to upload.` });
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
    if (!recordedVideoBlob) { setError("No recorded video to upload."); return; }
    if (selectedThumbnailIndex === null && potentialThumbnails.some(t => t)) { setError("Please select a thumbnail."); return; }
    
    const thumbnailBlobToUpload = selectedThumbnailIndex !== null ? potentialThumbnailBlobs[selectedThumbnailIndex] : null;
    if (potentialThumbnails.some(t => t) && !thumbnailBlobToUpload) { // If thumbnails were generated, one must be selected (and have a blob)
        setError("Selected thumbnail data is invalid or missing. Please reselect or try generating again."); return;
    }

    if (!title.trim()) { setError("Video title is required."); return; }
    if (!user || !doctorProfile || !isAdmin) { setError("Authentication error or insufficient permissions."); return; }

    setRecorderStep("uploading"); setIsProcessing(true); setUploadProgress(0); setError(null);
    try {
      const videoId = uuidv4();
      const videoFileExtension = recordedVideoBlob.type.split('/')[1]?.split(';')[0] || 'webm';
      const safeVideoTitle = title.replace(/[^a-zA-Z0-9_.-]/g, '_').toLowerCase();
      const videoFileName = `${safeVideoTitle}_${videoId.substring(0,8)}.${videoFileExtension}`; // Include part of videoId for uniqueness
      const thumbnailFileName = thumbnailBlobToUpload ? `thumb_${safeVideoTitle}_${videoId.substring(0,8)}.jpg` : '';

      const videoStoragePath = await uploadFileToStorage(`videos/${doctorProfile.uid}`, recordedVideoBlob, videoFileName, (s) => setUploadProgress(Math.round((s.bytesTransferred / s.totalBytes) * (thumbnailBlobToUpload ? 0.8 : 1) * 100)));
      const uploadedVideoUrl = await getFirebaseStorageDownloadUrl(videoStoragePath);
      setUploadProgress(thumbnailBlobToUpload ? 80 : 100);

      let uploadedThumbnailUrl = ''; let thumbnailStoragePath = '';
      if (thumbnailBlobToUpload) {
        thumbnailStoragePath = await uploadFileToStorage(`thumbnails/${doctorProfile.uid}`, thumbnailBlobToUpload, thumbnailFileName, (s) => setUploadProgress(Math.round(80 + (s.bytesTransferred / s.totalBytes) * 0.2 * 100)));
        uploadedThumbnailUrl = await getFirebaseStorageDownloadUrl(thumbnailStoragePath);
        setUploadProgress(100);
      } else {
        // Use a default placeholder if no thumbnail was generated/selected
        uploadedThumbnailUrl = "https://placehold.co/600x400.png?text=No+Preview"; 
      }


      const videoMetaData: VideoMeta = {
        id: videoId, title, description, doctorId: doctorProfile.uid,
        doctorName: doctorProfile.displayName || doctorProfile.email || "N/A",
        videoUrl: uploadedVideoUrl, thumbnailUrl: uploadedThumbnailUrl,
        duration: formatTime(recordingDuration), // Use the state variable `recordingDuration`
        recordingDuration: recordingDuration, // Store raw seconds
        tags: keywords.split(',').map(k => k.trim()).filter(Boolean),
        featured, storagePath: videoStoragePath, thumbnailStoragePath,
        videoSize: recordedVideoBlob.size, videoType: recordedVideoBlob.type,
        createdAt: "", // Will be set by server action using serverTimestamp
        permalink: `/videos/${videoId}`, viewCount: 0, likeCount: 0, commentCount: 0, comments: []
      };
      
      console.log("RecorderPage: Calling saveVideoMetadataAction with data:", JSON.stringify(videoMetaData, null, 2));
      const result = await saveVideoMetadataAction(videoMetaData);
      if (result.success) {
        toast({ title: "Upload Successful!", description: `Video "${title}" is now available.` });
        setRecorderStep("success");
      } else { throw new Error(result.error || "Failed to save video metadata."); }
    } catch (err) {
      console.error("RecorderPage: Upload to Firebase error:", err);
      setError(err instanceof Error ? err.message : "Upload failed. Please try again.");
      setRecorderStep("thumbnailsReady"); // Revert to a state where user can retry or save locally
    } finally { setIsProcessing(false); }
  };
  
  const resetRecorderInterface = useCallback(() => {
    console.log("RecorderPage: resetRecorderInterface called.");
    stopRecording(); // Ensure recorder is stopped
    
    // Clear video element
    if (videoRef.current) {
      videoRef.current.srcObject = null;
      videoRef.current.src = "";
      videoRef.current.removeAttribute('src'); 
      videoRef.current.removeAttribute('srcObject');
      videoRef.current.controls = false; // Back to live preview mode
      videoRef.current.muted = true;    // Back to live preview mode
      videoRef.current.oncanplay = null; // Clear event listeners
      videoRef.current.onloadedmetadata = null;
      videoRef.current.onerror = null;
      videoRef.current.load(); // Reset video element state
      console.log("RecorderPage: resetRecorderInterface - videoRef element fully reset.");
    }
    
    cleanupRecordedVideo(); 
    cleanupThumbnails();    
    cleanupStream(); // This will setMediaStream(null) which also nullifies mediaStreamRef.current

    setIsLocallySaved(false);
    setTitle(''); setDescription(''); setKeywords(''); setFeatured(false);
    setRecordingDuration(0); setError(null); setUploadProgress(0); setIsProcessing(false);
    setIsVideoPlaying(false); 
    setHasCameraPermission(null); // Re-evaluate permission on next setup
    
    setRecorderStep("initial"); // This will trigger the setup useEffect
    console.log("RecorderPage: resetRecorderInterface finished. Step set to 'initial'.");
  }, [cleanupRecordedVideo, cleanupThumbnails, cleanupStream, setRecorderStep]); // Dependencies are stable
  
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

  // Effect to manage play/pause state for review video
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
  if (!isAdmin && !authLoading) return <Alert variant="destructive"><AlertCircle className="h-4 w-4" /> <AlertTitle>Access Denied</AlertTitle><AlertDescription>You do not have permission to access this page.</AlertDescription></Alert>;

  const canSaveLocally = recordedVideoBlob && title.trim() && (_recorderStep === "thumbnailsReady" || _recorderStep === "review");
  const canUpload = recordedVideoBlob && title.trim() && isLocallySaved && (_recorderStep === "thumbnailsReady" || _recorderStep === "review") && (selectedThumbnailIndex !== null || !potentialThumbnails.some(t => t) );


  return (
    <div className="container mx-auto py-8">
    <Card className="w-full max-w-2xl mx-auto shadow-xl rounded-lg">
      <CardHeader>
        <CardTitle className="text-2xl font-headline flex items-center gap-2"><Camera size={28}/> Web Video Recorder</CardTitle>
        <CardDescription>Record, review, add details, save locally, then upload. Max {MAX_RECORDING_MINUTES} mins.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {error && <Alert variant="destructive" className="shadow-md"><AlertCircle className="h-4 w-4" /> <AlertTitle>Error</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
        {_recorderStep === "success" && <Alert variant="default" className="bg-green-100 border-green-400 text-green-700 dark:bg-green-900/30 dark:text-green-300 shadow-md"><CheckCircle className="h-4 w-4" /> <AlertTitle>Success!</AlertTitle><AlertDescription>Video uploaded. You can record another.</AlertDescription></Alert>}

        {_recorderStep === "permissionDenied" && hasCameraPermission === false && (
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
          <video ref={videoRef} playsInline autoPlay muted className="w-full h-full object-contain" />
          {/* Loading overlay logic */}
          {(_recorderStep === "initial" || _recorderStep === "settingUp") && 
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/50 text-white">
              <Loader2 className="h-10 w-10 animate-spin mb-3"/>
              <p className="text-lg">
                {_recorderStep === "initial" && "Initializing Recorder..."}
                {_recorderStep === "settingUp" && "Setting up camera..."}
              </p>
            </div>
          }
          {/* Recording indicator */}
          {_recorderStep === "recording" && 
            <div className="absolute top-3 right-3 bg-red-600 text-white px-3 py-1.5 rounded-md text-sm font-medium flex items-center gap-2 shadow-lg">
                <Mic className="animate-pulse" /> REC {formatTime(recordingDuration)}
            </div>
          }
           {/* Play/Pause for review */}
           {(_recorderStep === "review" || _recorderStep === "thumbnailsReady") && recordedVideoUrl && (
              <div className="absolute bottom-0 left-0 right-0 p-2 bg-black/50 flex items-center justify-between">
                 <Button onClick={handlePlayPause} variant="ghost" size="icon" className="text-white hover:text-primary">
                    {isVideoPlaying ? <Pause size={20} /> : <Play size={20} />}
                  </Button>
                  <span className="text-white text-xs">{formatTime(videoRef.current?.currentTime || 0)} / {formatTime(videoRef.current?.duration || recordingDuration || 0)}</span>
              </div>
            )}
        </div>
        
        {/* Action Buttons */}
        <div className="space-y-3">
          {_recorderStep === "readyToRecord" && (
            <Button onClick={startRecording} className="w-full gap-2 text-lg py-3 bg-green-600 hover:bg-green-700 shadow-md"><Mic /> Start Recording</Button>
          )}
          {_recorderStep === "recording" && (
            <Button onClick={stopRecording} variant="destructive" className="w-full gap-2 text-lg py-3 shadow-md"><Square /> Stop Recording</Button>
          )}
          {(_recorderStep === "review" || _recorderStep === "success" || _recorderStep === "uploading" || _recorderStep === "thumbnailsReady" || _recorderStep === "generatingThumbnails" || _recorderStep === "permissionDenied") && (
            <Button onClick={resetRecorderInterface} variant="outline" className="w-full gap-2 shadow-sm"><RefreshCcw /> Record Another Video</Button>
          )}
        </div>
        
        {/* Thumbnail Generation Indicator */}
        {_recorderStep === "generatingThumbnails" && isProcessing && (
             <div className="text-center py-4"><Loader2 className="h-6 w-6 animate-spin text-primary mx-auto mb-2" /><p>Generating thumbnails...</p></div>
        )}

        {/* Thumbnail Selection UI */}
        {_recorderStep === "thumbnailsReady" && !isProcessing && potentialThumbnails.some(t => t) && (
            <div className="pt-4 border-t border-border">
              <Label className="mb-2 block text-base font-medium">Select Thumbnail <span className="text-destructive">*</span></Label>
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                {potentialThumbnails.map((thumbUrl, index) => (
                  thumbUrl ? (
                    <button key={index} type="button" onClick={() => setSelectedThumbnailIndex(index)}
                      className={`relative aspect-video rounded-md overflow-hidden border-2 transition-all shadow-sm hover:opacity-80
                          ${selectedThumbnailIndex === index ? 'border-primary ring-2 ring-primary/50' : 'border-muted hover:border-primary/50'}`}>
                      <NextImage src={thumbUrl} alt={`Thumbnail ${index + 1}`} fill sizes="100px" className="object-cover" data-ai-hint="video thumbnail selection"/>
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
         {_recorderStep === "thumbnailsReady" && !isProcessing && !potentialThumbnails.some(t => t) && ( // No thumbnails generated
            <Alert variant="warning">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Thumbnail Generation Failed or Skipped</AlertTitle>
                <AlertDescription>
                    Could not generate thumbnails for this video. You can still proceed to save and upload if you wish.
                    A default placeholder will be used, or you can update it later.
                </AlertDescription>
            </Alert>
        )}
        
        {/* Metadata Form and Upload Controls */}
        {(_recorderStep === "thumbnailsReady" || _recorderStep === "review") && !isProcessing && recordedVideoBlob && ( // Show form once video is recorded (review or thumbsReady)
            <form onSubmit={handleUploadToFirebase} className="space-y-4 pt-6 border-t border-border" id="web-video-upload-form">
                <h3 className="text-xl font-semibold font-headline">Video Details</h3>
                <div className="space-y-1"><Label htmlFor="title">Title <span className="text-destructive">*</span></Label><Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} required /></div>
                <div className="space-y-1"><Label htmlFor="description">Description</Label><Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} rows={3}/></div>
                <div className="space-y-1"><Label htmlFor="keywords">Keywords (comma-separated)</Label><Input id="keywords" value={keywords} onChange={(e) => setKeywords(e.target.value)} /></div>
                <div className="flex items-center space-x-2"><Checkbox id="featured" checked={featured} onCheckedChange={(checked) => setFeatured(Boolean(checked))} /><Label htmlFor="featured" className="font-normal text-sm">Feature this video (show in Recent Activities)</Label></div>
                
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                    <Button type="button" onClick={handleLocalSave} variant="outline" className="w-full gap-2 shadow-sm" 
                            disabled={!canSaveLocally || isLocallySaved || isProcessing}>
                        <Download /> {isLocallySaved ? "Saved Locally" : "Save to Device"}
                    </Button>
                    <Button type="submit" form="web-video-upload-form" className="w-full gap-2 bg-primary hover:bg-primary/90 shadow-md" 
                            disabled={!canUpload || isProcessing }>
                        {isProcessing && _recorderStep==="uploading" ? <Loader2 className="animate-spin"/> : <UploadCloud />} Upload to Firebase
                    </Button>
                </div>
            </form>
        )}

        {/* Upload Progress Indicator */}
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
    

    
