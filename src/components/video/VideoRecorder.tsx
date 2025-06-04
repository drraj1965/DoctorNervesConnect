
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
import { Video, Mic, Square, Download, UploadCloud, AlertCircle, CheckCircle, Loader2, Settings2, Camera, Film, RefreshCcw, RotateCw, Image as ImageIcon, Play } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import type { VideoMeta } from '@/types';
import { useRouter } from 'next/navigation';
import NextImage from 'next/image';
import { useToast } from '@/hooks/use-toast';


type RecordingState = 'initial' | 'permission' | 'ready' | 'recording' | 'stopped' | 'uploading' | 'success' | 'error';

const MAX_RECORDING_TIME_MS = 30 * 60 * 1000; 
const NUM_THUMBNAILS_TO_GENERATE = 5;
const RECORDING_TIMESLICE_MS = 1000; 
const PREVIEW_LOAD_TIMEOUT_MS = 15000; // 15 seconds for recorded preview to load

export default function VideoRecorder() {
  const { user, doctorProfile, isAdmin } = useAuth();
  const router = useRouter();
  const { toast } = useToast();

  const [recordingState, setRecordingState] = useState<RecordingState>('initial');
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  
  const videoPreviewRef = useRef<HTMLVideoElement | null>(null); 
  
  const recordedChunksRef = useRef<Blob[]>([]);
  const [recordedVideoBlob, setRecordedVideoBlob] = useState<Blob | null>(null);
  const [recordedVideoUrl, setRecordedVideoUrl] = useState<string | null>(null);
  const recordedVideoUrlRef_forCleanup = useRef<string | null>(null);
  const thumbnailGenerationVideoUrl_cleanupRef = useRef<string | null>(null);
  
  const [potentialThumbnails, setPotentialThumbnails] = useState<(string | null)[]>(Array(NUM_THUMBNAILS_TO_GENERATE).fill(null));
  const potentialThumbnailsRef_forCleanup = useRef<(string | null)[]>([]);
  const [potentialThumbnailBlobs, setPotentialThumbnailBlobs] = useState<(Blob | null)[]>(Array(NUM_THUMBNAILS_TO_GENERATE).fill(null));
  const [selectedThumbnailIndex, setSelectedThumbnailIndex] = useState<number | null>(null);
  
  const [isGeneratingThumbnails, setIsGeneratingThumbnails] = useState(false);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false); // For recorded video preview

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [keywords, setKeywords] = useState('');
  const [featured, setFeatured] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isLocallySaved, setIsLocallySaved] = useState(false);

  const timerSecondsRef = useRef(0);
  const [displayTime, setDisplayTime] = useState(0);
  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const actualMimeTypeRef = useRef<string>('');
  const [previewRotation, setPreviewRotation] = useState(0);
  const [videoElementKey, setVideoElementKey] = useState('initial-key');


  const isStreamValid = useCallback((stream: MediaStream | null): stream is MediaStream => {
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

  const stopMediaStream = useCallback(() => {
    if (mediaStreamRef.current) {
      console.log("VideoRecorder: Stopping media stream tracks.");
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }
    if (videoPreviewRef.current && videoPreviewRef.current.srcObject) {
      videoPreviewRef.current.srcObject = null;
    }
  }, []);
  
  useEffect(() => {
    if (!isAdmin && user) { router.replace('/dashboard'); }
    return () => {
      console.log("VideoRecorder: Main useEffect cleanup (unmount or core dep change) -> stopping media stream.");
      stopMediaStream();
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    };
  }, [isAdmin, user, router, stopMediaStream]);

  useEffect(() => {
    const urlToRevoke = recordedVideoUrlRef_forCleanup.current;
    return () => {
      if (urlToRevoke) {
        console.log("VideoRecorder: useEffect[recordedVideoUrl] cleanup - revoking old main recordedVideoUrl:", urlToRevoke.substring(0,50));
        URL.revokeObjectURL(urlToRevoke);
        recordedVideoUrlRef_forCleanup.current = null;
      }
    };
  }, [recordedVideoUrl]); // Depends on recordedVideoUrl state to manage its own URL

  useEffect(() => {
    const urlToRevoke = thumbnailGenerationVideoUrl_cleanupRef.current;
    if (recordedVideoBlob === null && urlToRevoke) { 
        console.log("VideoRecorder: useEffect[recordedVideoBlob related] cleanup - revoking old thumbnailGenerationVideoUrl:", urlToRevoke.substring(0,50));
        URL.revokeObjectURL(urlToRevoke);
        thumbnailGenerationVideoUrl_cleanupRef.current = null;
    }
    return () => { // Ensure cleanup if component unmounts while thumbGenUrl exists
        if (thumbnailGenerationVideoUrl_cleanupRef.current) {
            URL.revokeObjectURL(thumbnailGenerationVideoUrl_cleanupRef.current);
            thumbnailGenerationVideoUrl_cleanupRef.current = null;
        }
    }
  }, [recordedVideoBlob]);

  useEffect(() => {
    const oldThumbs = [...potentialThumbnailsRef_forCleanup.current];
    potentialThumbnailsRef_forCleanup.current = [...potentialThumbnails]; 
    return () => {
      oldThumbs.forEach((url, index) => {
        if (url) {
          console.log(`VideoRecorder: useEffect[potentialThumbnails related] cleanup - revoking old thumb ${index}:`, url.substring(0,50));
          URL.revokeObjectURL(url);
        }
      });
    };
  }, [potentialThumbnails]);

  // Effect to handle recorded video preview and thumbnail generation
  useEffect(() => {
    if (!recordedVideoBlob || !videoPreviewRef.current) {
      setRecordedVideoUrl(null); // Ensure URL is cleared if blob is gone
      return;
    }

    const videoElement = videoPreviewRef.current;
    const objectUrl = URL.createObjectURL(recordedVideoBlob);
    setRecordedVideoUrl(objectUrl); // Store for UI state, triggers URL cleanup effect for previous
    recordedVideoUrlRef_forCleanup.current = objectUrl; // Keep track for direct cleanup

    setVideoElementKey('recorded-' + Date.now()); // Change key to force re-mount for recorded view

    console.log("VideoRecorder: Setting up recorded video preview element.");
    videoElement.srcObject = null;
    videoElement.src = objectUrl;
    videoElement.muted = false;
    videoElement.controls = true;
    videoElement.load();

    setIsPreviewLoading(true);
    let previewTimeoutId: NodeJS.Timeout | null = null;

    const onMetadataLoaded = async () => {
      if (previewTimeoutId) clearTimeout(previewTimeoutId);
      setIsPreviewLoading(false);
      console.log(`VideoRecorder: Recorded preview metadata loaded. Element duration: ${videoElement.duration}, Timer duration: ${timerSecondsRef.current}s.`);
      
      videoElement.play().catch(err => {
        console.error("VideoRecorder: Error playing recorded preview:", err.name, err.message);
        setError(`Preview Error: Could not play recorded video. (${err.name || 'MediaError'}). Try local save to verify.`);
      });

      // Generate thumbnails after metadata is loaded, using the reliable timerSecondsRef.current
      if (timerSecondsRef.current > 0) {
        const thumbGenBlob = recordedVideoBlob.slice();
        const thumbGenUrl = URL.createObjectURL(thumbGenBlob);
        if (thumbnailGenerationVideoUrl_cleanupRef.current) {
            URL.revokeObjectURL(thumbnailGenerationVideoUrl_cleanupRef.current);
        }
        thumbnailGenerationVideoUrl_cleanupRef.current = thumbGenUrl;
        await generatePotentialThumbnails(thumbGenUrl, timerSecondsRef.current);
      } else {
        setError("Recording was too short to generate thumbnails for preview.");
        setPotentialThumbnails(Array(NUM_THUMBNAILS_TO_GENERATE).fill(null));
        setPotentialThumbnailBlobs(Array(NUM_THUMBNAILS_TO_GENERATE).fill(null));
      }
    };

    const onPreviewError = (e: Event) => {
      if (previewTimeoutId) clearTimeout(previewTimeoutId);
      setIsPreviewLoading(false);
      const videoError = videoElement.error;
      console.error("VideoRecorder: Error loading recorded video in preview. Event:", e, "VideoError:", videoError);
      setError(`Preview Error: ${videoError?.message || 'Media error'}. Code: ${videoError?.code}. Try local save.`);
      
      // Attempt to generate thumbnails even if preview fails
      if (timerSecondsRef.current > 0 && recordedVideoBlob) {
        const thumbGenBlob = recordedVideoBlob.slice();
        const thumbGenUrl = URL.createObjectURL(thumbGenBlob);
        if (thumbnailGenerationVideoUrl_cleanupRef.current) {
            URL.revokeObjectURL(thumbnailGenerationVideoUrl_cleanupRef.current);
        }
        thumbnailGenerationVideoUrl_cleanupRef.current = thumbGenUrl;
        generatePotentialThumbnails(thumbGenUrl, timerSecondsRef.current)
          .catch(thumbErr => console.error("Error generating thumbnails after preview error:", thumbErr));
      }
    };
    
    videoElement.addEventListener('loadedmetadata', onMetadataLoaded);
    videoElement.addEventListener('error', onPreviewError);

    previewTimeoutId = setTimeout(() => {
      if (videoElement.readyState < HTMLMediaElement.HAVE_METADATA) {
        setIsPreviewLoading(false);
        console.warn("VideoRecorder: Preview loading timed out.");
        setError("Preview Error: Timed out waiting for video to load. Please try saving locally to verify.");
        // Attempt to generate thumbnails even if preview times out
        if (timerSecondsRef.current > 0 && recordedVideoBlob) {
            const thumbGenBlob = recordedVideoBlob.slice();
            const thumbGenUrl = URL.createObjectURL(thumbGenBlob);
            if (thumbnailGenerationVideoUrl_cleanupRef.current) {
                URL.revokeObjectURL(thumbnailGenerationVideoUrl_cleanupRef.current);
            }
            thumbnailGenerationVideoUrl_cleanupRef.current = thumbGenUrl;
            generatePotentialThumbnails(thumbGenUrl, timerSecondsRef.current)
                .catch(thumbErr => console.error("Error generating thumbnails after preview timeout:", thumbErr));
        }
      }
      // Clean up listeners if timeout occurs and they haven't fired
      videoElement.removeEventListener('loadedmetadata', onMetadataLoaded);
      videoElement.removeEventListener('error', onPreviewError);
    }, PREVIEW_LOAD_TIMEOUT_MS);

    return () => {
      if (previewTimeoutId) clearTimeout(previewTimeoutId);
      videoElement.removeEventListener('loadedmetadata', onMetadataLoaded);
      videoElement.removeEventListener('error', onPreviewError);
      // URL is revoked by the primary useEffect for recordedVideoUrl when it changes or component unmounts
    };
  }, [recordedVideoBlob, generatePotentialThumbnails]);


  const requestPermissionsAndSetup = useCallback(async () => {
    console.log("VideoRecorder: Requesting media permissions...");
    setError(null); setSuccessMessage(null); 
    setRecordingState('permission');
    stopMediaStream(); 

    try {
      const constraints: MediaStreamConstraints = {
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: { ideal: 'user' } },
        audio: true
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      
      if (!isStreamValid(stream)) {
        stream?.getTracks().forEach(track => track.stop());
        throw new Error("Acquired camera stream is not active or valid.");
      }
      mediaStreamRef.current = stream;

      if (videoPreviewRef.current) {
        videoPreviewRef.current.src = ""; 
        videoPreviewRef.current.srcObject = stream;
        videoPreviewRef.current.muted = true;
        videoPreviewRef.current.controls = false;
        videoPreviewRef.current.setAttribute('playsinline', 'true');
        
        try {
            await videoPreviewRef.current.play();
            console.log("VideoRecorder: Live preview playing after permission grant.");
            // Check stream validity again AFTER play attempt, as play can sometimes fail and invalidate it
            if (isStreamValid(mediaStreamRef.current)) {
                setRecordingState('ready');
                setVideoElementKey('live-' + Date.now()); // Key change after successful play and stream setup
            } else {
                throw new Error("Stream became invalid after play() attempt during setup.");
            }
        } catch (playError: any) {
            console.error("VideoRecorder: Error playing live preview in requestPermissionsAndSetup:", playError.name, playError.message);
            setError(`Failed to start camera preview: ${playError.message}. Please ensure permissions are granted and no other app is using the camera.`);
            stopMediaStream();
            setRecordingState('initial');
        }
      } else {
        console.error("VideoRecorder: videoPreviewRef.current is null when trying to set up live stream.");
        setError("Video preview element not found. Please refresh the page.");
        stopMediaStream(); // Clean up the acquired stream
        setRecordingState('initial');
      }
      setPreviewRotation(0);
    } catch (err) {
      console.error("VideoRecorder: Error accessing media devices:", err);
      setError(`Failed to access camera/microphone: ${err instanceof Error ? err.message : String(err)}.`);
      stopMediaStream();
      setRecordingState('initial'); 
    }
  }, [stopMediaStream, isStreamValid]);


  const formatTime = (totalSeconds: number): string => {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(Math.floor(seconds)).padStart(2, '0')}`;
  };

  const getSupportedMimeType = () => {
    const types = [
      'video/webm;codecs=vp8,opus', 
      'video/webm;codecs=vp9,opus', 
      'video/webm',
      'video/mp4;codecs=avc1.42E01E', 
      'video/mp4',
    ];
    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) {
        console.log("VideoRecorder: Using MIME type:", type);
        return type;
      }
    }
    console.warn("VideoRecorder: No preferred MIME type supported, returning empty string.");
    return '';
  };

  const startRecording = async () => {
    console.log("VideoRecorder: Attempting to start recording...");
    if (recordingState !== 'ready') {
      setError("Camera not ready. Please set up the camera first using the 'Setup Camera & Mic' button.");
      return;
    }
    if (!isStreamValid(mediaStreamRef.current) || (mediaStreamRef.current.getTracks().some(t => t.readyState !== 'live'))) {
      setError("Camera stream is invalid or tracks are not live. Please try setting up the camera again.");
      await requestPermissionsAndSetup(); 
      if (!isStreamValid(mediaStreamRef.current) || recordingState !== 'ready') { 
        setRecordingState('initial'); 
        return; 
      }
    }
    console.log("VideoRecorder: Stream validation passed for startRecording.");
    console.log("  - Stream object being passed to MediaRecorder:", mediaStreamRef.current);
    console.log("  - Stream active:", mediaStreamRef.current?.active);
    mediaStreamRef.current?.getTracks().forEach((track, index) => {
        console.log(`  - Track ${index}: kind=${track.kind}, id=${track.id}, label='${track.label}', readyState=${track.readyState}, muted=${track.muted}, enabled=${track.enabled}`);
    });

    setError(null); setSuccessMessage(null); setIsLocallySaved(false);
    recordedChunksRef.current = []; setRecordedVideoBlob(null); setRecordedVideoUrl(null);
    
    timerSecondsRef.current = 0; 
    setDisplayTime(0); 
    actualMimeTypeRef.current = '';

    if (videoPreviewRef.current) {
        console.log("VideoRecorder: Ensuring video preview is showing live stream for recording.");
        if (videoPreviewRef.current.srcObject !== mediaStreamRef.current || videoPreviewRef.current.src) {
          videoPreviewRef.current.srcObject = mediaStreamRef.current;
          videoPreviewRef.current.src = ""; 
        }
        videoPreviewRef.current.muted = true;
        videoPreviewRef.current.controls = false;
        // No need to change videoElementKey here, it should be stable for live view
        // No need to call play() here if requestPermissionsAndSetup already did and it's still live
    }

    const chosenMimeType = getSupportedMimeType();
    const options: MediaRecorderOptions = {};
    if (chosenMimeType) options.mimeType = chosenMimeType;
    console.log("VideoRecorder: MediaRecorder options:", options);

    try {
      console.log("VideoRecorder: Instantiating MediaRecorder. Stream active:", mediaStreamRef.current?.active, "Tracks:", mediaStreamRef.current?.getVideoTracks()[0]?.readyState, mediaStreamRef.current?.getAudioTracks()[0]?.readyState);
      mediaRecorderRef.current = new MediaRecorder(mediaStreamRef.current, options);
    } catch (e: any) {
      setError(`Failed to initialize recorder: ${e.message || String(e)}. Try resetting camera.`);
      setRecordingState('ready'); return;
    }

    mediaRecorderRef.current.onstart = () => {
      if (mediaRecorderRef.current) actualMimeTypeRef.current = mediaRecorderRef.current.mimeType || chosenMimeType || '';
      console.log(`VideoRecorder: MediaRecorder.onstart. Actual MIME: ${actualMimeTypeRef.current}. State: ${mediaRecorderRef.current?.state}`);
      setRecordingState('recording');
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = setInterval(() => {
        timerSecondsRef.current++;
        setDisplayTime(prev => prev + 1); 
        if (timerSecondsRef.current * 1000 >= MAX_RECORDING_TIME_MS) { 
          stopRecording(); setError("Max recording time reached."); 
        }
      }, 1000);
    };

    mediaRecorderRef.current.ondataavailable = (event) => { if (event.data.size > 0) recordedChunksRef.current.push(event.data); };

    mediaRecorderRef.current.onstop = async () => {
      const finalRecordedDuration = timerSecondsRef.current; // Use the accurate timer
      console.log(`VideoRecorder: MediaRecorder.onstop. Chunks: ${recordedChunksRef.current.length}. Timer Duration: ${finalRecordedDuration}s`);
      if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
      
      const currentMimeType = actualMimeTypeRef.current || mediaRecorderRef.current?.mimeType || 'video/webm';
      const blob = new Blob(recordedChunksRef.current, { type: currentMimeType });
      console.log(`VideoRecorder: Blob created. Size: ${blob.size}, Type: ${blob.type}`);

      if (blob.size === 0) {
        setError("Recorded video is empty. Please try recording again.");
        setRecordingState('ready'); return;
      }
      
      setRecordedVideoBlob(blob); // This triggers the useEffect for preview and thumbnails
      setRecordingState('stopped');
      // videoElementKey will be updated by the useEffect watching recordedVideoBlob
    };

    mediaRecorderRef.current.onerror = (event: Event) => {
      const mrError = event as any; 
      let errorMsg = "Recording error occurred.";
      if (mrError.error?.message) errorMsg += ` Details: ${mrError.error.message}`;
      else if (mrError.error?.name) errorMsg += ` Name: ${mrError.error.name}`;
      else if (mrError.type) errorMsg += ` Type: ${mrError.type}`;
      console.error("VideoRecorder: MediaRecorder.onerror:", event, errorMsg);
      setError(errorMsg);
      setRecordingState('ready');
      if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
    };

    try {
      console.log("VideoRecorder: Calling mediaRecorderRef.current.start() with timeslice:", RECORDING_TIMESLICE_MS);
      mediaRecorderRef.current.start(RECORDING_TIMESLICE_MS);
    } catch (startError: any) {
      console.error("VideoRecorder: Error calling mediaRecorder.start():", startError);
      setError(`Failed to start MediaRecorder: ${startError.message}. State: ${mediaRecorderRef.current?.state}. Try resetting camera.`);
      setRecordingState('ready');
      if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
    }
  };

  const stopRecording = () => {
    console.log(`VideoRecorder: stopRecording() called. Current MediaRecorder state: ${mediaRecorderRef.current?.state}. Timer ref: ${timerSecondsRef.current}s.`);
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    } else {
      console.warn(`VideoRecorder: stopRecording called but recorder not in 'recording' state. Current state: ${mediaRecorderRef.current?.state}`);
      if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
      if(recordingState === 'recording') setRecordingState('stopped'); 
    }
  };

  const generateSpecificThumbnail = useCallback((videoObjectUrlForThumbs: string, time: number, index: number): Promise<{ blob: Blob; blobUrl: string } | null> => {
    return new Promise((resolve) => {
      console.log(`VideoRecorder: generateSpecificThumbnail - Idx ${index}, Time ${time}s`);
      const videoElement = document.createElement('video');
      videoElement.preload = 'metadata'; videoElement.muted = true; videoElement.src = videoObjectUrlForThumbs; videoElement.crossOrigin = "anonymous";
      let seekedFired = false; let metadataLoaded = false; let resolved = false;

      const cleanupAndResolve = (value: { blob: Blob; blobUrl: string } | null) => {
          if (resolved) return; resolved = true; clearTimeout(timeoutId);
          videoElement.removeEventListener('loadedmetadata', onMetadata); videoElement.removeEventListener('seeked', onSeeked); videoElement.removeEventListener('error', onErrorHandler);
          videoElement.src = ""; videoElement.removeAttribute('src'); videoElement.remove(); resolve(value);
      };
      const timeoutId = setTimeout(() => { console.warn(`Thumb[${index}] timed out.`); cleanupAndResolve(null); }, 7000);
      
      const captureFrame = () => {
        if (videoElement.videoWidth === 0 || videoElement.videoHeight === 0) { console.warn(`Thumb[${index}] - Video dimensions 0x0 at capture.`); cleanupAndResolve(null); return; }
        const canvas = document.createElement('canvas'); const targetWidth = Math.min(videoElement.videoWidth || 320, 320);
        const scaleFactor = videoElement.videoWidth > 0 ? targetWidth / videoElement.videoWidth : 1;
        canvas.width = targetWidth; canvas.height = (videoElement.videoHeight || 180) * scaleFactor;
        if (canvas.width === 0 || canvas.height === 0) { console.warn(`Thumb[${index}] - Canvas dimensions zero.`); cleanupAndResolve(null); return; }
        const ctx = canvas.getContext('2d');
        if (ctx) {
          try {
            ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
            canvas.toBlob(blob => { blob && blob.size > 0 ? cleanupAndResolve({ blob, blobUrl: URL.createObjectURL(blob) }) : cleanupAndResolve(null); }, 'image/jpeg', 0.85);
          } catch (drawError) { console.error(`Draw error thumb ${index}`, drawError); cleanupAndResolve(null); }
        } else { console.error(`Thumb[${index}] - Could not get 2D context.`); cleanupAndResolve(null); }
      };

      const onMetadata = async () => {
          metadataLoaded = true;
          console.log(`VideoRecorder: Thumb[${index}] metadata. Duration: ${videoElement.duration}s. Dims: ${videoElement.videoWidth}x${videoElement.videoHeight}. Seeking to ${time}s.`);
          const seekTime = Math.max(0.01, Math.min(time, (videoElement.duration > 0 && Number.isFinite(videoElement.duration)) ? videoElement.duration - 0.01 : time));
          videoElement.currentTime = seekTime; 
          if (videoElement.readyState >= 2 && !seekedFired) { 
             await new Promise(r => setTimeout(r, 100)); 
             if (videoElement.readyState >= 2) captureFrame(); else console.log(`Thumb[${index}] readyState < 2 after delay, deferring to seeked.`);
          } else if (!seekedFired) {
            console.log(`VideoRecorder: Thumb[${index}] readyState < 2 (${videoElement.readyState}) after seek attempt, waiting for 'seeked'.`);
          }
      };
      const onSeeked = () => {
          if (resolved || seekedFired || !metadataLoaded) return; seekedFired = true;
          console.log(`VideoRecorder: Thumb[${index}] seeked to ${videoElement.currentTime}s. Capturing frame.`); captureFrame();
      };
      const onErrorHandler = (e: Event | string) => { console.error(`VideoRecorder: Thumb[${index}] video error:`, videoElement.error, e); cleanupAndResolve(null); };
      
      videoElement.addEventListener('loadedmetadata', onMetadata);
      videoElement.addEventListener('seeked', onSeeked);
      videoElement.addEventListener('error', onErrorHandler);
      videoElement.load();
    });
  }, []);

  const generatePotentialThumbnails = useCallback(async (videoObjectUrlForThumbs: string, durationToUse: number) => {
    if (!videoObjectUrlForThumbs) { setError("Cannot generate thumbnails: video URL for thumbs missing."); setIsGeneratingThumbnails(false); return; }
    if (!(durationToUse > 0 && Number.isFinite(durationToUse))) {
      console.warn("VideoRecorder: Thumbnail generation skipped, duration invalid or zero:", durationToUse);
      setError("Recording was too short or duration invalid. Thumbnails cannot be generated for preview.");
      setIsGeneratingThumbnails(false); setPotentialThumbnails(Array(NUM_THUMBNAILS_TO_GENERATE).fill(null)); setPotentialThumbnailBlobs(Array(NUM_THUMBNAILS_TO_GENERATE).fill(null)); return;
    }
    console.log(`VideoRecorder: Generating thumbnails. Duration: ${durationToUse}s`);
    setIsGeneratingThumbnails(true);
    
    const oldThumbsToRevoke = [...potentialThumbnailsRef_forCleanup.current];
    setPotentialThumbnails(Array(NUM_THUMBNAILS_TO_GENERATE).fill(null)); setPotentialThumbnailBlobs(Array(NUM_THUMBNAILS_TO_GENERATE).fill(null));

    let timePoints: number[];
     if (durationToUse < 1) {
        timePoints = [durationToUse / 2, Math.min(durationToUse * 0.9, durationToUse - 0.01)].filter(t => t > 0.01).slice(0, NUM_THUMBNAILS_TO_GENERATE);
        if(timePoints.length === 0 && durationToUse > 0.01) timePoints = [durationToUse * 0.5];
    } else {
        timePoints = Array(NUM_THUMBNAILS_TO_GENERATE).fill(null).map((_, i) => {
            const point = (durationToUse / (NUM_THUMBNAILS_TO_GENERATE + 1)) * (i + 1);
            return Math.max(0.01, Math.min(point, durationToUse - 0.01));
        });
    }
    const uniqueTimes = [...new Set(timePoints)].filter(t => Number.isFinite(t) && t > 0).slice(0, NUM_THUMBNAILS_TO_GENERATE);

    if (uniqueTimes.length === 0) {
        setError("Could not determine valid points for thumbnails. Video might be too short.");
        setIsGeneratingThumbnails(false); 
        oldThumbsToRevoke.forEach(url => { if (url) URL.revokeObjectURL(url); });
        potentialThumbnailsRef_forCleanup.current = []; 
        return;
    }
    const settledResults = await Promise.allSettled(uniqueTimes.map((time, index) => generateSpecificThumbnail(videoObjectUrlForThumbs, time, index)));
    const newUrls: (string | null)[] = []; const newBlobs: (Blob | null)[] = [];
    let successfulGenerations = 0;
    settledResults.forEach((result, idx) => {
      if (result.status === 'fulfilled' && result.value) {
        console.log(`VideoRecorder: Thumbnail generation success for point ${uniqueTimes[idx]}s`);
        newUrls.push(result.value.blobUrl); newBlobs.push(result.value.blob);
        successfulGenerations++;
      } else { console.error(`VideoRecorder: Thumbnail generation FAILED for point ${uniqueTimes[idx]}s:`, result.status === 'rejected' ? result.reason : 'null result'); }
    });
    
    oldThumbsToRevoke.forEach(url => { if (url) URL.revokeObjectURL(url); });
    potentialThumbnailsRef_forCleanup.current = [...newUrls]; 

    while (newUrls.length < NUM_THUMBNAILS_TO_GENERATE) newUrls.push(null); while (newBlobs.length < NUM_THUMBNAILS_TO_GENERATE) newBlobs.push(null);
    setPotentialThumbnails(newUrls); setPotentialThumbnailBlobs(newBlobs);
    const firstValidIdx = newBlobs.findIndex(b => b !== null); setSelectedThumbnailIndex(firstValidIdx !== -1 ? firstValidIdx : null);
    setIsGeneratingThumbnails(false);
    console.log(`VideoRecorder: Thumbnail generation completed. ${successfulGenerations} successful.`);
    if (successfulGenerations === 0 && !error) { setError("Failed to generate any thumbnails. The video might be too short or incompatible."); }
  }, [generateSpecificThumbnail, error]);


  const getFileExtensionFromMimeType = (mimeType: string | undefined): string => {
    if (!mimeType) return 'bin'; const simpleMimeType = mimeType.split(';')[0];
    const parts = simpleMimeType.split('/'); const subType = parts[1];
    if (subType) {
      if (subType.includes('mp4')) return 'mp4'; if (subType.includes('webm')) return 'webm';
      if (subType.includes('quicktime')) return 'mov'; if (subType.includes('x-matroska')) return 'mkv';
      return subType.replace(/[^a-z0-9]/gi, '');
    } return 'bin';
  };

  const handleSaveLocally = () => {
    if (recordedVideoBlob) { 
      const urlToSave = recordedVideoUrl || URL.createObjectURL(recordedVideoBlob); 
      const a = document.createElement('a');
      a.href = urlToSave; 
      const safeTitle = title.replace(/[^a-z0-9_]+/gi, '_').toLowerCase() || 'recorded_video';
      const extension = getFileExtensionFromMimeType(recordedVideoBlob.type || actualMimeTypeRef.current);
      a.download = `${safeTitle}_${Date.now()}.${extension}`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      
      if (!recordedVideoUrl) URL.revokeObjectURL(urlToSave); // Only revoke if we created it just for this save action

      setIsLocallySaved(true);
      toast({ title: "Video Saved Locally", description: `Video saved as ${a.download}. You can still upload it if desired.` });
    } else {
        setError("No recorded video available to save.");
        toast({ variant: "destructive", title: "Save Error", description: "No recorded video to save."});
    }
  };

  const resetRecorderState = useCallback((backToInitial = true) => {
    console.log("VideoRecorder: resetRecorderState called. backToInitial:", backToInitial);
    setTitle(''); setDescription(''); setKeywords(''); setFeatured(false);
    
    if (recordedVideoUrlRef_forCleanup.current) { URL.revokeObjectURL(recordedVideoUrlRef_forCleanup.current); recordedVideoUrlRef_forCleanup.current = null; }
    setRecordedVideoUrl(null); // Clear the state URL
    
    if (thumbnailGenerationVideoUrl_cleanupRef.current) { URL.revokeObjectURL(thumbnailGenerationVideoUrl_cleanupRef.current); thumbnailGenerationVideoUrl_cleanupRef.current = null; }
    
    setRecordedVideoBlob(null); 
    
    const thumbsToRevoke = [...potentialThumbnailsRef_forCleanup.current];
    thumbsToRevoke.forEach(url => { if (url) URL.revokeObjectURL(url); });
    potentialThumbnailsRef_forCleanup.current = [];
    setPotentialThumbnails(Array(NUM_THUMBNAILS_TO_GENERATE).fill(null)); 
    setPotentialThumbnailBlobs(Array(NUM_THUMBNAILS_TO_GENERATE).fill(null));
    setSelectedThumbnailIndex(null);
    
    timerSecondsRef.current = 0; setDisplayTime(0); 
    actualMimeTypeRef.current = ''; recordedChunksRef.current = [];
    setIsLocallySaved(false);
    setUploadProgress(0);

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try { mediaRecorderRef.current.stop(); } catch (e) { console.warn("Error stopping mediarecorder during reset:", e); }
    }
    mediaRecorderRef.current = null;
    
    if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
    
    setError(null); setSuccessMessage(null); 
    setIsPreviewLoading(false); 
    setPreviewRotation(0);

    if (videoPreviewRef.current) { 
        videoPreviewRef.current.srcObject = null; 
        videoPreviewRef.current.src = ""; 
        videoPreviewRef.current.controls = false;
        videoPreviewRef.current.muted = true;
    }

    if (backToInitial) {
      stopMediaStream();
      setRecordingState('initial');
      setVideoElementKey('initial-reset-' + Date.now());
    } else { 
      if (isStreamValid(mediaStreamRef.current) && videoPreviewRef.current) {
        videoPreviewRef.current.srcObject = mediaStreamRef.current;
        videoPreviewRef.current.src = "";
        videoPreviewRef.current.controls = false;
        videoPreviewRef.current.muted = true;
        videoPreviewRef.current.play().catch(e => console.warn("Error re-playing live stream after soft reset:", e));
        setRecordingState('ready');
        setVideoElementKey('live-soft-reset-' + Date.now());
      } else { 
        stopMediaStream(); 
        setRecordingState('initial');
        setVideoElementKey('initial-hard-reset-' + Date.now());
      }
    }
  }, [stopMediaStream, isStreamValid]);

  const handleUpload = async (event: FormEvent) => {
    event.preventDefault();
    if (selectedThumbnailIndex === null || !potentialThumbnailBlobs[selectedThumbnailIndex!]) {
      setError("Please select a valid thumbnail before uploading."); return;
    }
    const selectedThumbnailBlob = potentialThumbnailBlobs[selectedThumbnailIndex!];
    if (!recordedVideoBlob || !selectedThumbnailBlob || !user || !doctorProfile) {
      setError("Missing video data, thumbnail, or user info. Please ensure you are logged in and have a doctor profile."); return;
    }
    if (!title.trim()) { setError("Video title is required."); return; }

    const id = uuidv4(); 
    console.log("VideoRecorder: Generated id for upload:", id);
    
    const videoDataForAction: Omit<VideoMeta, 'createdAt' | 'permalink' | 'viewCount' | 'likeCount' | 'commentCount' | 'comments'> = {
      id: id, 
      title, 
      description,
      doctorId: doctorProfile.uid,
      doctorName: doctorProfile.displayName || doctorProfile.email || 'Unknown Doctor',
      videoUrl: '', 
      thumbnailUrl: '', 
      duration: formatTime(timerSecondsRef.current), 
      recordingDuration: timerSecondsRef.current,
      tags: keywords.split(',').map(k => k.trim()).filter(Boolean),
      featured,
      storagePath: '', 
      thumbnailStoragePath: '', 
      videoSize: recordedVideoBlob.size,
      videoType: recordedVideoBlob.type || actualMimeTypeRef.current || 'video/webm',
    };
    
    console.log("[VideoRecorder:handleUpload] videoDataForAction (client-side before call):", JSON.stringify(videoDataForAction, null, 2));
    setRecordingState('uploading');
    setError(null); setSuccessMessage(null);  setUploadProgress(0);

    try {
      const safeTitleForFile = title.replace(/[^a-z0-9_]+/gi, '_').toLowerCase() || id;
      const timestamp = Date.now();
      const videoExtension = getFileExtensionFromMimeType(recordedVideoBlob.type || actualMimeTypeRef.current);
      const videoFileName = `${safeTitleForFile}_${timestamp}.${videoExtension}`;
      const thumbnailFileName = `thumbnail_${safeTitleForFile}_${timestamp}.jpg`;

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
      
      const finalVideoDataForAction = { // This is what is sent to the server action
        ...videoDataForAction,
        videoUrl,
        thumbnailUrl,
        storagePath: videoStoragePath,
        thumbnailStoragePath: thumbnailStoragePath,
      };
      
      console.log("[VideoRecorder:handleUpload] Final videoData object being sent to server action:", JSON.stringify(finalVideoDataForAction, null, 2));

      const result = await addVideoMetadataToFirestore(finalVideoDataForAction);

      if (result.success) {
        setSuccessMessage("Video uploaded successfully and metadata saved!");
        setRecordingState('success');
        resetRecorderState(false); 
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

  const handleRotatePreview = () => { setPreviewRotation(current => (current + 90) % 360); };
  
  const showSetupCameraState = recordingState === 'initial';
  const showLiveFeedActive = recordingState === 'ready' || recordingState === 'recording';
  const showRecordedFeedActive = recordingState === 'stopped' && !!recordedVideoUrl;
  
  const showLiveRecordControls = recordingState === 'ready';
  const showRecordingInProgressControls = recordingState === 'recording';
  const showReviewAndUploadControls = recordingState === 'stopped' && recordedVideoBlob;
  const showUploadingProgress = recordingState === 'uploading';
  const showSuccessMessageState = recordingState === 'success' && successMessage;
  
  const showResetCameraButton = ['ready', 'error', 'stopped'].includes(recordingState) && !showSuccessMessageState && !isPreviewLoading;
  const showRecordAnotherButton = showSuccessMessageState;


  if (!isAdmin && typeof window !== 'undefined' && !user) { 
    return <div className="flex items-center justify-center h-full"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  }
  if (!isAdmin && typeof window !== 'undefined' && user) { 
    return (<Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertTitle>Access Denied</AlertTitle><AlertDescription>You must be an administrator to access this feature.</AlertDescription></Alert>);
  }

  return (
    <div className="space-y-6">
      {error && !successMessage && (
        <Alert variant="destructive" className="w-full">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {successMessage && (
        <Alert variant="default" className="w-full bg-green-100 border-green-400 text-green-700 dark:bg-green-900/30 dark:border-green-600 dark:text-green-300">
          <CheckCircle className="h-4 w-4" />
          <AlertTitle>Success!</AlertTitle>
          <AlertDescription>{successMessage}</AlertDescription>
        </Alert>
      )}
      
      <Card className="overflow-hidden shadow-lg rounded-xl">
        <CardContent className="p-0">
          <div className="aspect-video bg-slate-900 rounded-t-lg overflow-hidden border-b border-slate-700 shadow-inner relative group">
            <video
              key={videoElementKey} 
              ref={videoPreviewRef}
              className={`w-full h-full object-contain bg-black ${
                (recordingState !== 'initial' && recordingState !== 'permission') ? 'block' : 'hidden'
              }`}
              style={{ transform: `rotate(${previewRotation}deg)` }}
              playsInline
              muted={recordingState !== 'stopped'}
              controls={recordingState === 'stopped' && !!recordedVideoUrl}
            />
            
            {(recordingState === 'initial' || recordingState === 'permission') && (
                 <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center bg-black/70">
                    {recordingState === 'initial' && <Camera size={56} className="text-slate-400 mb-4" />}
                    {recordingState === 'permission' && <Loader2 className="h-12 w-12 animate-spin text-white mb-4" />}
                    <p className="text-slate-300 text-lg">
                      {recordingState === 'initial' ? 'Click "Setup Camera &amp; Mic" to begin.' : 'Requesting camera permissions...'}
                    </p>
                 </div>
            )}
             {isPreviewLoading && recordingState === 'stopped' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center bg-black/70">
                    <Loader2 className="h-12 w-12 animate-spin text-white mb-4" />
                    <p className="text-slate-300 text-lg">Loading recorded preview...</p>
                </div>
            )}

            {(showLiveFeedActive || showRecordedFeedActive) && (
              <Button onClick={handleRotatePreview} variant="outline" size="icon" className="absolute top-4 left-4 z-10 bg-black/50 text-white hover:bg-black/70 border-white/50 opacity-0 group-hover:opacity-100 transition-opacity" title="Rotate Preview">
                <RotateCw size={20} />
              </Button>
            )}
            {recordingState === 'recording' && (
              <div className="absolute top-4 right-4 bg-red-600 text-white px-3 py-1.5 rounded-lg text-sm font-mono shadow-lg flex items-center gap-2">
                <Mic size={18} className="animate-pulse" /> REC {formatTime(displayTime)}
              </div>
            )}
          </div>
        </CardContent>
        <CardFooter className="pt-6 pb-6 bg-slate-50 dark:bg-slate-800/50 border-t dark:border-slate-700 flex flex-col sm:flex-row gap-4 items-center justify-center">
          {showSetupCameraState && (
            <Button onClick={requestPermissionsAndSetup} variant="default" size="lg" className="gap-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg text-base px-6 py-3">
              <Settings2 className="h-5 w-5" /> Setup Camera &amp; Mic
            </Button>
          )}
          {showLiveRecordControls && (
            <Button onClick={startRecording} className="gap-2 bg-green-500 hover:bg-green-600 text-white w-full sm:w-auto rounded-lg px-6 py-3 text-base" size="lg">
              <Play className="h-5 w-5" /> Start Recording
            </Button>
          )}
          {showRecordingInProgressControls && (
            <Button onClick={stopRecording} variant="destructive" className="gap-2 w-full sm:w-auto rounded-lg px-6 py-3 text-base" size="lg">
              <Square className="h-5 w-5" /> Stop Recording
            </Button>
          )}
          {showRecordAnotherButton && (
            <Button onClick={() => resetRecorderState(true)} className="gap-2 bg-blue-500 hover:bg-blue-600 text-white w-full sm:w-auto rounded-lg px-6 py-3 text-base" size="lg">
              <RefreshCcw className="h-5 w-5" /> Record Another Video
            </Button>
          )}
           {showResetCameraButton && (
             <Button onClick={() => resetRecorderState(true)} variant="outline" className="gap-2 w-full sm:w-auto rounded-lg text-base px-5 py-2.5">
                <RefreshCcw className="h-5 w-5" /> Reset Camera &amp; Start Over
            </Button>
           )}
        </CardFooter>
      </Card>

      {showReviewAndUploadControls && (
        <Card className="shadow-xl mt-8 rounded-xl">
          <CardHeader className="border-b dark:border-slate-700">
            <CardTitle className="text-2xl font-headline">Review &amp; Process Video</CardTitle>
            <CardDescription>Timer Duration: {formatTime(timerSecondsRef.current)}. MimeType: {recordedVideoBlob?.type || actualMimeTypeRef.current || 'N/A'}</CardDescription>
             {error && error.includes("Preview Error:") && <p className="text-sm text-destructive mt-2">{error}</p>}
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
                          key={thumbUrl} 
                          type="button"
                          onClick={() => setSelectedThumbnailIndex(index)}
                          className={`relative aspect-video rounded-lg overflow-hidden border-4 transition-all duration-200 ease-in-out hover:opacity-70 focus:outline-none
                            ${selectedThumbnailIndex === index ? 'border-primary ring-4 ring-primary/50 ring-offset-2 ring-offset-background' : 'border-slate-300 dark:border-slate-600'}`}
                        >
                          <NextImage src={thumbUrl} alt={`Thumbnail ${index + 1}`} fill sizes="(max-width: 640px) 50vw, (max-width: 768px) 33vw, 20vw" className="object-cover transition-transform group-hover:scale-105" data-ai-hint="video thumbnail selection"/>
                          {selectedThumbnailIndex === index && (
                            <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                              <CheckCircle size={40} className="text-white opacity-90" />
                            </div>
                          )}
                        </button>
                      ) : (
                        <div key={`placeholder-${index}`} className="aspect-video bg-muted rounded-lg flex items-center justify-center border border-dashed border-slate-300 dark:border-slate-700">
                          <ImageIcon size={32} className="text-muted-foreground" />
                        </div>
                      )
                    ))}
                  </div>
                  {selectedThumbnailIndex === null && <p className="text-xs text-destructive mt-1">Please select a thumbnail.</p>}
                </div>
            )}
             {!isGeneratingThumbnails && !potentialThumbnails.some(t => t) && recordedVideoBlob && timerSecondsRef.current > 0 && (
                <Alert variant="default">
                    <Film className="h-4 w-4"/>
                    <AlertTitle>Thumbnails Pending or Failed</AlertTitle>
                    <AlertDescription>
                        {error && error.includes("thumbnail") ? error : "Thumbnails could not be generated or are still pending. If they don't appear, the video might be too short or incompatible. You can still proceed to save/upload."}
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
            <Button 
                type="button" 
                onClick={handleSaveLocally} 
                variant="outline" 
                className="gap-2 w-full sm:w-auto rounded-lg text-base px-5 py-2.5" 
                disabled={!recordedVideoBlob}
            >
              <Download className="h-5 w-5" /> {isLocallySaved ? "Saved Locally" : "Save Locally" }
            </Button>
            <Button
              type="submit"
              form="upload-form-video-recorder"
              disabled={!recordedVideoBlob || selectedThumbnailIndex === null || !title.trim() || recordingState === 'uploading' || isPreviewLoading}
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

