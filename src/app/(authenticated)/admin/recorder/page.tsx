
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
import { Loader2, Video, Mic, Square, UploadCloud, AlertCircle, CheckCircle, Camera, RefreshCcw, Download, Image as ImageIcon, Sparkles, Scissors, CameraIcon } from "lucide-react";
import ReactPlayer from 'react-player/lazy'; 
import type { PlayerInternalState } from 'react-player/lazy';
import { v4 as uuidv4 } from 'uuid';
import NextImage from 'next/image';
import { uploadFileToStorage, getFirebaseStorageDownloadUrl } from "@/lib/firebase/storage";
import { saveVideoMetadataAction } from "./actions";
import type { VideoMeta } from "@/types";
import { useToast } from '@/hooks/use-toast';

const MAX_RECORDING_MINUTES = 30;
const NUM_THUMBNAILS_TO_GENERATE = 5;

type RecorderStep = "initial" | "permissionDenied" | "settingUp" | "readyToRecord" | "recording" | "review" | "thumbnailsReady" | "uploading" | "success";

export default function WebVideoRecorderPage() {
  const { user, doctorProfile, isAdmin, loading: authLoading } = useAuth();
  const router = useRouter();
  const { toast } = useToast();

  const videoRef = useRef<HTMLVideoElement | null>(null); 
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const playerRef = useRef<ReactPlayer | null>(null);
  
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
    if (mediaStreamRef.current && mediaStreamRef.current !== stream && mediaStreamRef.current.active) {
      console.log("RecorderPage: Cleaning up old mediaStream in setMediaStream for stream ID:", mediaStreamRef.current.id);
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
    }
    mediaStreamRef.current = stream;
    _setMediaStreamInternal(stream);
    console.log(`RecorderPage: mediaStream set. New stream ID: ${stream?.id}, Active: ${stream?.active}`);
  }, []);

  const recordedChunksRef = useRef<Blob[]>([]);
  const [recordedVideoBlob, setRecordedVideoBlob] = useState<Blob | null>(null);
  const [recordedVideoUrl, setRecordedVideoUrl] = useState<string | null>(null); 
  const [recordingDuration, setRecordingDuration] = useState(0); 
  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);
  
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [keywords, setKeywords] = useState('');
  const [featured, setFeatured] = useState(false);

  const [potentialThumbnails, setPotentialThumbnails] = useState<(string | null)[]>([]);
  const [potentialThumbnailBlobs, setPotentialThumbnailBlobs] = useState<(Blob | null)[]>([]);
  const [selectedThumbnailIndex, setSelectedThumbnailIndex] = useState<number | null>(null);
  const [isCapturingThumbnail, setIsCapturingThumbnail] = useState(false);
  
  const [error, setError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false); // General processing, not just upload
  const [isLocallySaved, setIsLocallySaved] = useState(false);
  const [hasCameraPermission, setHasCameraPermission] = useState<boolean | null>(null);

  const cleanupStream = useCallback(() => {
    if (mediaStreamRef.current && mediaStreamRef.current.active) {
      console.log("RecorderPage: cleanupStream called. Stopping tracks for stream ID:", mediaStreamRef.current.id);
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
    }
    mediaStreamRef.current = null; 
    _setMediaStreamInternal(null); 
    console.log("RecorderPage: cleanupStream - mediaStream ref and state set to null.");
  }, []);


  const cleanupRecordedVideo = useCallback(() => {
    setRecordedVideoUrl(prevUrl => {
      if (prevUrl && prevUrl.startsWith('blob:')) {
        console.log("RecorderPage: cleanupRecordedVideo - Revoking recordedVideoUrl:", prevUrl);
        URL.revokeObjectURL(prevUrl);
      }
      return null;
    });
    setRecordedVideoBlob(null);
    recordedChunksRef.current = [];
    console.log("RecorderPage: cleanupRecordedVideo - Done.");
  }, []); 

  const cleanupThumbnails = useCallback(() => {
    setPotentialThumbnails(prevUrls => {
      prevUrls.forEach((url, index) => {
        if (url && url.startsWith('blob:')) {
          console.log(`RecorderPage: cleanupThumbnails - Revoking potentialThumbnail blob URL ${index}:`, url);
          URL.revokeObjectURL(url); 
        }
      });
      return [];
    });
    setPotentialThumbnailBlobs([]);
    setSelectedThumbnailIndex(null);
    console.log("RecorderPage: cleanupThumbnails - Done.");
  }, []);

  const requestPermissionsAndSetup = useCallback(async () => {
    console.log(`RecorderPage: requestPermissionsAndSetup - Called. Current step: ${recorderStepRef.current}.`);
    if (recorderStepRef.current === "settingUp") {
        console.log(`RecorderPage: requestPermissionsAndSetup - Bailing: Already in step ${recorderStepRef.current}`);
        return;
    }
    setRecorderStep("settingUp");
    setError(null); 
    setHasCameraPermission(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: { echoCancellation: true, noiseSuppression: true },
      });

      if (!stream.active || stream.getVideoTracks().length === 0 || !stream.getVideoTracks()[0].enabled || stream.getVideoTracks()[0].muted) {
        console.error("RecorderPage: Camera stream not active or video track is problematic.", { streamActive: stream.active, videoTracksCount: stream.getVideoTracks().length, firstTrackEnabled: stream.getVideoTracks()[0]?.enabled, firstTrackMuted: stream.getVideoTracks()[0]?.muted });
        throw new Error("Camera stream not active or video track problematic. Check permissions/camera.");
      }
      
      setMediaStream(stream); 
      setHasCameraPermission(true);

      if (videoRef.current) {
        videoRef.current.oncanplay = null; videoRef.current.onerror = null; videoRef.current.onloadedmetadata = null; 

        console.log("RecorderPage: requestPermissionsAndSetup - Assigning stream to videoRef.current.srcObject for live preview.");
        videoRef.current.srcObject = stream;
        
        videoRef.current.oncanplay = () => {
          console.log("RecorderPage: Live preview 'canplay' event fired. Video dimensions:", videoRef.current?.videoWidth, "x", videoRef.current?.videoHeight,". Setting step to readyToRecord.");
          if(videoRef.current && videoRef.current.videoWidth > 0 && videoRef.current.videoHeight > 0){
            setRecorderStep("readyToRecord");
          } else {
            console.warn("RecorderPage: 'canplay' but video dimensions 0. Stream issue?");
            setError("Camera preview blank. Try refreshing or checking camera.");
            setRecorderStep("permissionDenied");
          }
        };
        videoRef.current.onerror = (e) => {
            console.error("RecorderPage: Video element error during live preview setup:", videoRef.current?.error, e);
            setError("Video element error. Please refresh or check permissions.");
            setRecorderStep("permissionDenied");
        };
        videoRef.current.play().catch(playError => {
          console.warn("RecorderPage: Live preview play() call failed/rejected. This might be due to browser autoplay policies. Stream should still be set, oncanplay will handle UI update.", playError);
        });
      } else {
        console.warn("RecorderPage: requestPermissionsAndSetup - videoRef.current is null.");
        setError("Video element not found. Cannot setup camera.");
        setRecorderStep("permissionDenied");
      }
    } catch (err) {
      console.error("RecorderPage: Error accessing media devices in requestPermissionsAndSetup:", err);
      setError(`Failed to access camera/mic: ${err instanceof Error ? err.message : String(err)}.`);
      setHasCameraPermission(false);
      setRecorderStep("permissionDenied");
    }
  }, [setRecorderStep, setMediaStream]);

  useEffect(() => {
    console.log(`RecorderPage: Setup Effect Triggered - authLoading: ${authLoading}, isAdmin: ${isAdmin}, recorderStep: ${_recorderStep}, mediaStream active: ${mediaStreamRef.current?.active}`);
    if (!authLoading && isAdmin) {
      if (_recorderStep === "initial" || _recorderStep === "permissionDenied") {
         if (mediaStreamRef.current && mediaStreamRef.current.active && videoRef.current && _recorderStep === "initial") {
            console.log("RecorderPage: Setup Effect - Attempting to reuse existing active stream for initial setup.");
            videoRef.current.oncanplay = null; videoRef.current.onerror = null; videoRef.current.onloadedmetadata = null;
            videoRef.current.srcObject = mediaStreamRef.current;
            videoRef.current.oncanplay = () => { console.log("RecorderPage: Reused stream 'canplay'. Setting to readyToRecord."); setRecorderStep("readyToRecord"); };
            videoRef.current.onerror = (e) => { console.error("RecorderPage: Error with reused stream:", e); requestPermissionsAndSetup(); };
            videoRef.current.play().catch(() => requestPermissionsAndSetup()); 
        } else {
          console.log(`RecorderPage: Setup Effect - No active stream or explicit permission retry. Calling requestPermissionsAndSetup for step: ${_recorderStep}`);
          requestPermissionsAndSetup();
        }
      }
    }
  }, [authLoading, isAdmin, _recorderStep, requestPermissionsAndSetup, setRecorderStep]); 

  useEffect(() => {
    console.log("RecorderPage: Unmount effect registered.");
    return () => {
      console.log("RecorderPage: Component UNMOUNTING - Attempting cleanup. Current step:", recorderStepRef.current);
      if (recorderStepRef.current !== "recording") {
        console.log("RecorderPage: UNMOUNT cleanup - Calling cleanupStream.");
        cleanupStream();
      } else {
        console.warn("RecorderPage: UNMOUNT cleanup - Skipped stopping mediaStream because recorderStep is 'recording'.");
      }
      cleanupRecordedVideo();
      cleanupThumbnails();
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        console.log("RecorderPage: UNMOUNT cleanup - Cleared recording timer.");
      }
      if (videoRef.current) { 
        videoRef.current.srcObject = null;
        videoRef.current.src = "";
        videoRef.current.oncanplay = null; videoRef.current.onerror = null; videoRef.current.onloadedmetadata = null;
        if (typeof videoRef.current.load === 'function') videoRef.current.load();
        console.log("RecorderPage: UNMOUNT cleanup - Cleared native videoRef element.");
      }
    };
  }, [cleanupStream, cleanupRecordedVideo, cleanupThumbnails]);

  const getSupportedMimeType = () => {
    const types = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
    for (const type of types) { if (MediaRecorder.isTypeSupported(type)) return type; }
    console.warn("RecorderPage: No specifically preferred MIME type supported, defaulting to 'video/webm' or browser default.");
    return 'video/webm';
  };

  const startRecording = () => {
    console.log("RecorderPage: startRecording called.");
    if (!mediaStreamRef.current || !mediaStreamRef.current.active || recorderStepRef.current !== "readyToRecord") {
      setError("Camera/mic not ready. Please grant permissions and try again.");
      if (recorderStepRef.current !== "settingUp" && recorderStepRef.current !== "initial") {
        console.log("RecorderPage: startRecording - Forcing permission re-request due to bad state.");
        requestPermissionsAndSetup(); 
      }
      return;
    }
    
    if (videoRef.current) { 
        console.log("RecorderPage: startRecording - Configuring videoRef for live preview during recording.");
        videoRef.current.srcObject = mediaStreamRef.current;
        videoRef.current.src = ""; 
        videoRef.current.muted = true; 
        videoRef.current.controls = false;
        videoRef.current.play().catch(e => console.warn("Error re-playing live preview for recording start:", e));
    }
    cleanupRecordedVideo(); cleanupThumbnails(); setIsLocallySaved(false);
    recordedChunksRef.current = []; setRecordingDuration(0); setError(null);

    const mimeType = getSupportedMimeType();
    console.log("RecorderPage: Attempting to record with MIME type:", mimeType);
    try {
      const options: MediaRecorderOptions = {};
      if (mimeType) options.mimeType = mimeType;

      const streamForRecorder = mediaStreamRef.current.clone();
      console.log("RecorderPage: Cloned mediaStream for recorder. Original stream ID:", mediaStreamRef.current.id, "Cloned stream ID:", streamForRecorder.id);

      const recorder = new MediaRecorder(streamForRecorder, options);
      mediaRecorderRef.current = recorder;
      recorder.onstart = () => {
        console.log("RecorderPage: MediaRecorder onstart. Actual MIME type:", recorder.mimeType);
        if (videoRef.current && videoRef.current.srcObject !== mediaStreamRef.current) {
             console.warn("RecorderPage: srcObject changed during onstart, resetting to original live stream for preview.");
             videoRef.current.srcObject = mediaStreamRef.current;
             videoRef.current.play().catch(e=>console.error("Error re-playing live preview in onstart:", e));
        } else if (videoRef.current && videoRef.current.paused) {
            videoRef.current.play().catch(e=>console.error("Error re-playing paused live preview in onstart:", e));
        }
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
            console.log("RecorderPage: MediaRecorder ondataavailable, chunk size:", event.data.size, "type:", event.data.type);
            recordedChunksRef.current.push(event.data); 
        } else {
            console.log("RecorderPage: MediaRecorder ondataavailable, CHUNK SIZE ZERO.");
        }
      };
      recorder.onstop = async () => {
        console.log("RecorderPage: MediaRecorder onstop. Chunks collected:", recordedChunksRef.current.length);
        
        streamForRecorder.getTracks().forEach(track => {
            console.log(`RecorderPage: Stopping track on cloned stream: ${track.kind} - ${track.label}`);
            track.stop();
        });
        console.log("RecorderPage: Cloned stream tracks stopped.");

        if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
        if (recordedChunksRef.current.length === 0) {
          console.warn("RecorderPage: No video data recorded.");
          setError("No video data recorded. Try again. Ensure camera is not covered and mic is working."); 
          setRecorderStep("readyToRecord"); return;
        }
        const blob = new Blob(recordedChunksRef.current, { type: recorder.mimeType || mimeType });
        console.log("RecorderPage: Recorded video blob created. Size:", blob.size, "Type:", blob.type);

        if (blob.size === 0) {
          console.warn("RecorderPage: Recorded video blob size is zero.");
          setError("Recording resulted in an empty file. Try again.");
          setRecorderStep("readyToRecord"); return;
        }

        setRecordedVideoBlob(blob);
        const url = URL.createObjectURL(blob);
        setRecordedVideoUrl(url); 
        setRecorderStep("review"); 

        if (videoRef.current) {
          videoRef.current.srcObject = null;
          videoRef.current.src = "";
          videoRef.current.controls = false; 
          videoRef.current.muted = true;
          if(typeof videoRef.current.load === 'function') videoRef.current.load(); 
        }
      };
      recorder.onerror = (event) => { 
        console.error("RecorderPage: MediaRecorder onerror:", event);
        setError(`Recording error: ${ (event as any)?.error?.name || 'Unknown error'}`); 
        if (recordingTimerRef.current) clearInterval(recordingTimerRef.current); 
        streamForRecorder.getTracks().forEach(track => track.stop());
        setRecorderStep("readyToRecord"); 
      }
      recorder.start(1000); // Request data chunks every second
      console.log("RecorderPage: MediaRecorder.start(1000) called with cloned stream.");
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
       if (recordingTimerRef.current) { 
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
      if (recorderStepRef.current === "recording") { 
        setRecorderStep("readyToRecord"); 
      }
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
          resolve(null); return;
        }
        const tempVideoElement = document.createElement('video');
        tempVideoElement.muted = true; tempVideoElement.crossOrigin = "anonymous";
        let resolved = false;

        const cleanupAndResolve = (result: { dataUrl: string; blob: Blob } | null) => {
            if (resolved) return; resolved = true; clearTimeout(timeoutId);
            tempVideoElement.removeEventListener('seeked', onSeeked); tempVideoElement.removeEventListener('error', onError);
            tempVideoElement.removeEventListener('loadedmetadata', onLoadedMetadata);
            tempVideoElement.removeAttribute('src'); tempVideoElement.load(); tempVideoElement.remove();
            resolve(result);
        };

        const timeoutId = setTimeout(() => { console.warn(`Thumbnail gen timeout for timestamp ${timestamp}`); cleanupAndResolve(null); }, 7000);

        const onSeeked = () => {
            if (resolved) return; console.log("ThumbnailGen: Seeked to", tempVideoElement.currentTime);
            if (tempVideoElement.videoWidth <= 0 || tempVideoElement.videoHeight <= 0) {
                console.warn("ThumbnailGen: Video dimensions 0 at draw time.", { w: tempVideoElement.videoWidth, h: tempVideoElement.videoHeight});
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
                    if (blob && blob.size > 0) { cleanupAndResolve({ dataUrl, blob }); } 
                    else { console.warn("ThumbnailGen: Canvas toBlob resulted in null/empty blob."); cleanupAndResolve(null); }
                }, 'image/jpeg', 0.85);
            } catch (drawError) { console.error("ThumbnailGen: Error drawing image or getting blob:", drawError); cleanupAndResolve(null); }
        };
        const onError = (e: Event) => { console.error("ThumbnailGen: Video element error:", tempVideoElement.error, e); cleanupAndResolve(null); };
        const onLoadedMetadata = () => {
            console.log("ThumbnailGen: Metadata loaded. Duration:", tempVideoElement.duration, " Seeking to:", timestamp);
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
    if (!playerRef.current || !recordedVideoUrl || potentialThumbnails.length >= NUM_THUMBNAILS_TO_GENERATE) {
      if (potentialThumbnails.length >= NUM_THUMBNAILS_TO_GENERATE) {
        toast({ variant: "default", title: "Limit Reached", description: `You can capture up to ${NUM_THUMBNAILS_TO_GENERATE} thumbnails.` });
      }
      return;
    }
    setIsCapturingThumbnail(true);
    try {
      const internalPlayer = playerRef.current.getInternalPlayer() as HTMLVideoElement;
      if(!internalPlayer || typeof internalPlayer.currentTime !== 'number'){
         toast({ variant: "destructive", title: "Error", description: "Could not get current video time." });
         setIsCapturingThumbnail(false);
         return;
      }
      const currentTime = internalPlayer.currentTime;
      const result = await generateSingleThumbnail(recordedVideoUrl, currentTime);
      if (result) {
        setPotentialThumbnails(prev => [...prev, result.dataUrl]);
        setPotentialThumbnailBlobs(prev => [...prev, result.blob]);
        if (potentialThumbnails.length === 0) { // Auto-select first captured thumbnail
          setSelectedThumbnailIndex(0);
        }
        toast({ title: "Thumbnail Captured!", description: `Captured at ${formatTime(currentTime)}.`});
      } else {
        toast({ variant: "destructive", title: "Capture Failed", description: "Could not capture thumbnail at this time." });
      }
    } catch (e) {
      console.error("Error capturing thumbnail:", e);
      toast({ variant: "destructive", title: "Capture Error", description: "An unexpected error occurred." });
    } finally {
      setIsCapturingThumbnail(false);
    }
  }, [recordedVideoUrl, generateSingleThumbnail, potentialThumbnails, toast]);


  const handleLocalSave = () => {
    if (!recordedVideoBlob) { toast({ variant: "destructive", title: "No Video to Save"}); return; }
    const urlToSave = recordedVideoUrl || URL.createObjectURL(recordedVideoBlob);
    const a = document.createElement("a"); a.href = urlToSave;
    const safeTitle = title.replace(/[^a-z0-9_]+/gi, '_').toLowerCase() || 'recorded_video';
    const extension = recordedVideoBlob.type.split('/')[1]?.split(';')[0] || 'webm';
    a.download = `${safeTitle}_${Date.now()}.${extension}`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    if (urlToSave !== recordedVideoUrl && urlToSave.startsWith('blob:')) { URL.revokeObjectURL(urlToSave); }
    setIsLocallySaved(true);
    toast({ title: "Video Saved Locally", description: `Saved as ${a.download}.` });
  };
  
  const handleUploadToFirebase = useCallback(async () => {
    console.log("RecorderPage: handleUploadToFirebase called.");
    if (!user || !isAdmin || !recordedVideoBlob || selectedThumbnailIndex === null) {
      setError("Missing required data for upload: User, admin status, video, or thumbnail selection.");
      console.error("Upload Pre-check Fail:", { user, isAdmin, recordedVideoBlobExists: !!recordedVideoBlob, selectedThumbnailIndex });
      return;
    }
    const thumbnailBlobToUpload = potentialThumbnailBlobs[selectedThumbnailIndex];
    if (!thumbnailBlobToUpload) {
      setError("Selected thumbnail data is missing.");
      console.error("Upload Pre-check Fail: Thumbnail blob missing for index", selectedThumbnailIndex);
      return;
    }
    if (!title.trim()) { setError("Video title is required."); return; }

    setRecorderStep("uploading"); setIsProcessing(true); setUploadProgress(0);

    const videoId = uuidv4(); const timestamp = Date.now();
    const safeFileTitle = title.replace(/[^a-z0-9_.\-]+/gi, '_').toLowerCase() || videoId;
    const videoFilename = `${safeFileTitle}_${timestamp}.webm`; 
    const thumbnailFilename = `thumb_${safeFileTitle}_${timestamp}.jpg`;
    const videoStoragePath = `videos/${user.uid}/${videoFilename}`;
    const thumbnailStoragePath = `thumbnails/${user.uid}/${thumbnailFilename}`;

    try {
      console.log("RecorderPage: Uploading video to:", videoStoragePath);
      await uploadFileToStorage(videoStoragePath, recordedVideoBlob, undefined, (snapshot) => {
        const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 50; 
        setUploadProgress(progress);
      });
      const videoUrl = await getFirebaseStorageDownloadUrl(videoStoragePath);
      console.log("RecorderPage: Video uploaded to", videoUrl);

      console.log("RecorderPage: Uploading thumbnail to:", thumbnailStoragePath);
      await uploadFileToStorage(thumbnailStoragePath, thumbnailBlobToUpload, undefined, (snapshot) => {
        const progress = 50 + (snapshot.bytesTransferred / snapshot.totalBytes) * 50; 
        setUploadProgress(progress);
      });
      const thumbnailUrl = await getFirebaseStorageDownloadUrl(thumbnailStoragePath);
      console.log("RecorderPage: Thumbnail uploaded to", thumbnailUrl);

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
      
      console.log("RecorderPage: Calling saveVideoMetadataAction with:", metadata);
      const result = await saveVideoMetadataAction(metadata);

      if (result.success) {
        toast({ title: "Upload Successful!", description: `Video "${title}" is now available.` });
        setRecorderStep("success");
      } else {
        throw new Error(result.error || "Failed to save video metadata.");
      }
    } catch (uploadError: any) {
      console.error("RecorderPage: Upload or metadata save failed:", uploadError);
      setError(`Upload failed: ${uploadError.message}`);
      setRecorderStep("thumbnailsReady"); 
    } finally {
      setIsProcessing(false);
    }
  }, [
    user, isAdmin, recordedVideoBlob, potentialThumbnailBlobs, 
    selectedThumbnailIndex, title, description, recordingDuration, keywords, 
    featured, doctorProfile, setRecorderStep, setError, toast,
  ]); 
  
  const resetRecorderInterface = useCallback(() => {
    console.log("RecorderPage: resetRecorderInterface called.");
    stopRecording(); 
    if (videoRef.current) {
      videoRef.current.srcObject = null; videoRef.current.src = "";
      videoRef.current.removeAttribute('src'); videoRef.current.removeAttribute('srcObject');
      videoRef.current.controls = false; videoRef.current.muted = true;
      videoRef.current.oncanplay = null; videoRef.current.onloadedmetadata = null; videoRef.current.onerror = null; 
      if(typeof videoRef.current.load === 'function') videoRef.current.load();
      console.log("RecorderPage: resetRecorderInterface - videoRef element reset.");
    }
    cleanupRecordedVideo(); cleanupThumbnails(); cleanupStream(); 
    setIsLocallySaved(false); setTitle(''); setDescription(''); setKeywords(''); setFeatured(false);
    setRecordingDuration(0); setError(null); setUploadProgress(0); setIsProcessing(false);
    setHasCameraPermission(null); 
    setRecorderStep("initial"); 
    console.log("RecorderPage: resetRecorderInterface finished. Step set to 'initial'.");
  }, [cleanupRecordedVideo, cleanupThumbnails, cleanupStream, setRecorderStep]);
  
  if (authLoading) return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-primary" /> <span className="ml-2">Loading Auth...</span></div>;
  if (!isAdmin && !authLoading) return <Alert variant="destructive"><AlertCircle className="h-4 w-4" /> <AlertTitle>Access Denied</AlertTitle><AlertDescription>You do not have permission.</AlertDescription></Alert>;

  const canSaveLocally = recordedVideoBlob && title.trim() && _recorderStep === "thumbnailsReady";
  const canUpload = recordedVideoBlob && title.trim() && isLocallySaved && _recorderStep === "thumbnailsReady" && selectedThumbnailIndex !== null;

  const showLivePreview = (_recorderStep === "initial" || _recorderStep === "settingUp" || _recorderStep === "readyToRecord" || _recorderStep === "recording");
  const showReviewPlayer = recordedVideoUrl && (_recorderStep === "review" || _recorderStep === "thumbnailsReady" || _recorderStep === "uploading" || _recorderStep === "success");

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
              Please enable camera and microphone permissions in your browser settings.
              <Button onClick={requestPermissionsAndSetup} variant="outline" size="sm" className="mt-2 ml-auto block">Retry Permissions</Button>
            </AlertDescription>
          </Alert>
        )}
        
        <div className="relative aspect-video bg-slate-900 rounded-md overflow-hidden border border-border shadow-inner">
          {showLivePreview && (
            <video ref={videoRef} playsInline autoPlay muted className="w-full h-full object-contain" />
          )}
          {showReviewPlayer && recordedVideoUrl && (
            <ReactPlayer
              ref={playerRef}
              url={recordedVideoUrl}
              controls
              width="100%"
              height="100%"
              playing={_recorderStep === "review"} 
              onError={(e: any) => { console.error("ReactPlayer error:", e); setError("Error playing recorded video."); }}
            />
          )}

          {(_recorderStep === "initial" || _recorderStep === "settingUp") && 
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/50 text-white">
              <Loader2 className="h-10 w-10 animate-spin mb-3"/>
              <p className="text-lg">
                {_recorderStep === "initial" && "Initializing..."}
                {_recorderStep === "settingUp" && "Setting up camera..."}
              </p>
            </div>
          }
           {_recorderStep === "recording" && 
            <div className="absolute top-3 right-3 bg-red-600 text-white px-3 py-1.5 rounded-md text-sm font-medium flex items-center gap-2 shadow-lg">
                <Mic className="animate-pulse" /> REC {formatTime(recordingDuration)}
            </div>
          }
        </div>
        
        <div className="space-y-3">
          {_recorderStep === "readyToRecord" && (
            <Button onClick={startRecording} className="w-full gap-2 text-lg py-3 bg-green-600 hover:bg-green-700 shadow-md"><Mic /> Start Recording</Button>
          )}
          {_recorderStep === "recording" && (
            <Button onClick={stopRecording} variant="destructive" className="w-full gap-2 text-lg py-3 shadow-md"><Square /> Stop Recording</Button>
          )}
          {(_recorderStep === "review" || _recorderStep === "success" || _recorderStep === "uploading" || _recorderStep === "thumbnailsReady" || _recorderStep === "permissionDenied") && (
            <Button onClick={resetRecorderInterface} variant="outline" className="w-full gap-2 shadow-sm"><RefreshCcw /> Record Another Video</Button>
          )}
        </div>
        
        {_recorderStep === "review" && recordedVideoUrl && (
             <div className="pt-4 border-t border-border space-y-3">
              <h3 className="text-lg font-medium">Capture Thumbnails</h3>
              <Button 
                onClick={handleCaptureThumbnail} 
                disabled={isCapturingThumbnail || potentialThumbnails.length >= NUM_THUMBNAILS_TO_GENERATE}
                variant="outline"
                className="w-full sm:w-auto gap-2"
              >
                {isCapturingThumbnail ? <Loader2 className="animate-spin"/> : <CameraIcon/>}
                Capture Thumbnail ({potentialThumbnails.length}/{NUM_THUMBNAILS_TO_GENERATE})
              </Button>
              {potentialThumbnails.length > 0 && (
                <Button onClick={() => setRecorderStep("thumbnailsReady")} variant="default" className="w-full sm:w-auto ml-0 sm:ml-2">
                    Done Capturing / View Thumbnails
                </Button>
              )}
              {potentialThumbnails.length > 0 && (
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-1 mt-2">
                    {potentialThumbnails.map((thumbUrl, index) => (
                        thumbUrl && <NextImage key={index} src={thumbUrl} alt={`Thumb ${index}`} width={100} height={56} className="object-cover rounded border" data-ai-hint="video thumbnail preview"/>
                    ))}
                </div>
              )}
            </div>
        )}

        {_recorderStep === "thumbnailsReady" && !isProcessing && (
            <div className="pt-4 border-t border-border">
              <div className="flex justify-between items-center mb-2">
                <Label className="text-base font-medium">Select Thumbnail <span className="text-destructive">*</span></Label>
                <Button variant="outline" size="sm" onClick={() => setRecorderStep("review")}>Back to Capture</Button>
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                {potentialThumbnails.map((thumbUrl, index) => (
                  thumbUrl ? (
                    <button key={index} type="button" onClick={() => setSelectedThumbnailIndex(index)}
                      className={`relative aspect-video rounded-md overflow-hidden border-2 transition-all shadow-sm hover:opacity-80
                          ${selectedThumbnailIndex === index ? 'border-primary ring-2 ring-primary/50' : 'border-muted hover:border-primary/50'}`}>
                      <NextImage src={thumbUrl} alt={`Thumbnail ${index + 1}`} fill sizes="100px" className="object-cover" data-ai-hint="video thumbnail selection"/>
                      {selectedThumbnailIndex === index && <div className="absolute inset-0 bg-primary/60 flex items-center justify-center"><CheckCircle size={24} className="text-white"/></div>}
                    </button>
                  ) : null // Don't render placeholders if not generated
                ))}
              </div>
              {potentialThumbnails.length === 0 && <p className="text-sm text-muted-foreground">No thumbnails captured yet. Go back to capture some.</p>}
              {potentialThumbnails.length > 0 && selectedThumbnailIndex === null && <p className="text-xs text-destructive mt-1">Please select a thumbnail.</p>}
            </div>
        )}
        
        {_recorderStep === "thumbnailsReady" && !isProcessing && (
            <form onSubmit={(e) => { e.preventDefault(); handleUploadToFirebase(); }} className="space-y-4 pt-6 border-t border-border" id="web-video-upload-form">
                <h3 className="text-xl font-semibold font-headline">Video Details</h3>
                <div className="space-y-1"><Label htmlFor="title">Title <span className="text-destructive">*</span></Label><Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} required /></div>
                <div className="space-y-1"><Label htmlFor="description">Description</Label><Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} rows={3}/></div>
                <div className="space-y-1"><Label htmlFor="keywords">Keywords (comma-separated)</Label><Input id="keywords" value={keywords} onChange={(e) => setKeywords(e.target.value)} /></div>
                <div className="flex items-center space-x-2"><Checkbox id="featured" checked={featured} onCheckedChange={(checked) => setFeatured(Boolean(checked))} /><Label htmlFor="featured" className="font-normal text-sm">Feature this video</Label></div>
                
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                    <Button type="button" onClick={handleLocalSave} variant="outline" className="w-full gap-2 shadow-sm" disabled={!canSaveLocally || isLocallySaved || isProcessing}>
                        <Download /> {isLocallySaved ? "Saved Locally" : "Save to Device"}
                    </Button>
                    <Button type="submit" form="web-video-upload-form" className="w-full gap-2 bg-primary hover:bg-primary/90 shadow-md" disabled={!canUpload || isProcessing }>
                        {isProcessing && _recorderStep ==="uploading" ? <Loader2 className="animate-spin"/> : <UploadCloud />} Upload to Firebase
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

