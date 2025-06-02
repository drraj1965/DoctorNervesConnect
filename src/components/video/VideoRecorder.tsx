
"use client";

import { useState, useRef, useEffect, FormEvent } from 'react';
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
import { Video, Mic, Square, Download, UploadCloud, AlertCircle, CheckCircle, Loader2, Settings2, Camera, Film, RefreshCcw, RotateCw } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import type { VideoMeta } from '@/types';
import { useRouter } from 'next/navigation';
import Image from 'next/image';

type RecordingState = 'idle' | 'permission' | 'recording' | 'paused' | 'stopped' | 'uploading' | 'success' | 'error';

const MAX_RECORDING_TIME_MS = 30 * 60 * 1000; // 30 minutes
const NUM_THUMBNAILS_TO_GENERATE = 3;

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
  const [selectedThumbnailIndex, setSelectedThumbnailIndex] = useState<number>(0);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [keywords, setKeywords] = useState('');
  const [featured, setFeatured] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [duration, setDuration] = useState(0); 
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, user, router, recordedVideoUrl, potentialThumbnails]);

  const formatTime = (totalSeconds: number): string => {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  };

  const requestPermissionsAndSetup = async () => {
    console.log("VideoRecorder: Requesting media permissions...");
    setError(null);
    setRecordingState('permission');
    try {
      const constraints: MediaStreamConstraints = {
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: { ideal: 'user' }
        },
        audio: true
      };
      console.log("VideoRecorder: Using media constraints:", JSON.stringify(constraints));
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      
      if (!stream.active || stream.getVideoTracks().length === 0 || stream.getVideoTracks()[0].readyState !== 'live') {
        const videoTrackState = stream.getVideoTracks()[0]?.readyState;
        console.error(`VideoRecorder: Stream is not active or video track not live. Stream active: ${stream.active}, Video track readyState: ${videoTrackState}`);
        throw new Error(`Camera stream is not active (state: ${videoTrackState}). Please check permissions and try again.`);
      }
      console.log("VideoRecorder: Media stream obtained. Video track readyState:", stream.getVideoTracks()[0]?.readyState);

      mediaStreamRef.current = stream;
      if (videoPreviewRef.current) {
        videoPreviewRef.current.srcObject = stream;
        videoPreviewRef.current.muted = true; 
        videoPreviewRef.current.controls = false;
        videoPreviewRef.current.setAttribute('playsinline', 'true'); 
        videoPreviewRef.current.setAttribute('autoplay', 'true');   
        await videoPreviewRef.current.play().catch(e => console.warn("VideoRecorder: Error playing live preview on setup:", e));
        console.log("VideoRecorder: Live preview configured and play attempted.");
      }
      setRecordingState('idle'); 
      setPreviewRotation(0); // Reset rotation
      console.log("VideoRecorder: Media permissions granted and stream set up successfully.");
    } catch (err) {
      console.error("VideoRecorder: Error accessing media devices:", err);
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError(`Failed to access camera/microphone: ${errorMessage}. Please check permissions and ensure your browser supports media recording.`);
      setRecordingState('error');
    }
  };
  
  const startRecording = async () => {
    console.log("VideoRecorder: Attempting to start recording...");
    
    // Check 1: Initial stream validity
    if (!mediaStreamRef.current || !mediaStreamRef.current.active) {
      console.log("VideoRecorder: Media stream not available or not active. Requesting permissions first.");
      await requestPermissionsAndSetup();
      // After attempting setup, re-check rigorously
      if (!mediaStreamRef.current || !mediaStreamRef.current.active) {
          console.error("VideoRecorder: CRITICAL - MediaStream is still invalid or inactive after attempting re-setup.");
          setError("Failed to initialize recording: Camera stream could not be established. Please try setting up the camera again.");
          setRecordingState('error');
          return;
      }
    }

    // Check 2: Ensure mediaStreamRef.current IS a MediaStream instance and is active with live tracks
    if (!(mediaStreamRef.current instanceof MediaStream)) {
        console.error("VideoRecorder: CRITICAL - mediaStreamRef.current is NOT an instance of MediaStream before new MediaRecorder(). Value:", mediaStreamRef.current);
        setError("Failed to initialize recording: Camera data is not in the correct format. Please try re-initializing the camera.");
        setRecordingState('error');
        return;
    }
    if (!mediaStreamRef.current.active) {
        console.error("VideoRecorder: CRITICAL - mediaStreamRef.current is NOT active before new MediaRecorder().");
        setError("Failed to initialize recording: Camera stream is not active. Please try re-initializing the camera.");
        setRecordingState('error');
        return;
    }
    if (mediaStreamRef.current.getTracks().length === 0) {
        console.error("VideoRecorder: CRITICAL - mediaStreamRef.current has NO tracks before new MediaRecorder().");
        setError("Failed to initialize recording: Camera stream has no tracks. Please try re-initializing the camera.");
        setRecordingState('error');
        return;
    }
    let videoTrackLive = false;
    mediaStreamRef.current.getTracks().forEach(track => {
        console.log(`VideoRecorder: Pre-record check just before new MediaRecorder - Track kind: ${track.kind}, readyState: ${track.readyState}, enabled: ${track.enabled}, muted: ${track.muted}, id: ${track.id}`);
        if (track.kind === "video" && track.readyState === 'live') {
            videoTrackLive = true;
        }
    });
    if (!videoTrackLive) {
        const videoTrackState = mediaStreamRef.current.getVideoTracks()[0]?.readyState;
        console.error(`VideoRecorder: CRITICAL - Video track not live (state: ${videoTrackState}) just before new MediaRecorder().`);
        setError(`Failed to initialize recording: The camera video track is not live (state: ${videoTrackState}). Try re-enabling camera or ensure it's not used by another app.`);
        setRecordingState('error');
        return;
    }
    
    // If all checks pass, proceed with MediaRecorder setup
    if (mediaStreamRef.current && mediaStreamRef.current.active && (!mediaRecorderRef.current || mediaRecorderRef.current.state !== 'recording')) {
      console.log("VideoRecorder: Proceeding to start recording setup after successful stream validation.");
      setError(null);
      recordedChunksRef.current = [];
      setRecordedVideoBlob(null);
      if (recordedVideoUrl) {
        URL.revokeObjectURL(recordedVideoUrl);
        setRecordedVideoUrl(null);
      }
      potentialThumbnails.forEach(url => { if (url) URL.revokeObjectURL(url); });
      setPotentialThumbnails(Array(NUM_THUMBNAILS_TO_GENERATE).fill(null));
      setPotentialThumbnailBlobs(Array(NUM_THUMBNAILS_TO_GENERATE).fill(null));
      setSelectedThumbnailIndex(0);
      setDuration(0);
      actualMimeTypeRef.current = '';

      if (videoPreviewRef.current) {
          if (videoPreviewRef.current.srcObject !== mediaStreamRef.current) {
            console.log("VideoRecorder: Resetting video preview to live camera feed for recording.");
            videoPreviewRef.current.srcObject = mediaStreamRef.current;
            videoPreviewRef.current.src = ""; 
          }
          videoPreviewRef.current.controls = false;
          videoPreviewRef.current.muted = true;
          videoPreviewRef.current.setAttribute('playsinline', 'true');
          videoPreviewRef.current.setAttribute('autoplay', 'true');
          await videoPreviewRef.current.play().catch(e => console.warn("VideoRecorder: Error replaying live preview before recording:", e));
      }

      let chosenMimeType = '';
      const isIOS = typeof navigator !== 'undefined' && (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) && !(window as any).MSStream;
      console.log("VideoRecorder: isIOS detected:", isIOS);

      const mimeTypesToCheck = isIOS 
      ? [
          'video/mp4;codecs=avc1.4D401E', 
          'video/mp4;codecs=avc1.42E01E',
          'video/mp4;codecs=hvc1.1.6.L93.90', 
          'video/mp4', 
          'video/webm;codecs=vp9,opus', 
          'video/webm;codecs=vp8,opus',
          'video/webm',
        ]
      : [ 
          'video/webm;codecs=vp9,opus',
          'video/webm;codecs=vp8,opus',
          'video/webm',
          'video/mp4;codecs=avc1.42E01E',
          'video/mp4',
        ];
      
      console.log("VideoRecorder: Checking supported MIME types from list:", mimeTypesToCheck);
      for (const type of mimeTypesToCheck) {
        if (MediaRecorder.isTypeSupported(type)) {
          chosenMimeType = type;
          console.log(`VideoRecorder: Found supported MIME type: ${type}`);
          break;
        } else {
          console.log(`VideoRecorder: MIME type NOT supported: ${type}`);
        }
      }
      
      if (!chosenMimeType) {
        console.warn("VideoRecorder: No explicitly supported MIME type found from preferred list. Letting browser choose a default.");
      }
      console.log(`VideoRecorder: Attempting to record with MIME type: '${chosenMimeType || 'Browser default'}'`);


      const options: MediaRecorderOptions = {};
      if (chosenMimeType) {
        options.mimeType = chosenMimeType;
      }

      try {
        mediaRecorderRef.current = new MediaRecorder(mediaStreamRef.current, options);
        console.log(`VideoRecorder: MediaRecorder instantiated. Requested MIME type: ${options.mimeType || 'browser default'}. Actual initial state: ${mediaRecorderRef.current.state}`);
      } catch (e) {
        console.error("VideoRecorder: Error creating MediaRecorder instance:", e);
        const errorMsg = e instanceof Error ? e.message : String(e);
        setError(`Failed to initialize recorder: ${errorMsg}. Try a different browser or check device compatibility.`);
        setRecordingState('error');
        return;
      }
      
      mediaRecorderRef.current.onstart = () => {
        actualMimeTypeRef.current = mediaRecorderRef.current?.mimeType || chosenMimeType || '';
        console.log(`VideoRecorder: MediaRecorder.onstart event fired. Actual MIME type: ${actualMimeTypeRef.current}. State: ${mediaRecorderRef.current?.state}`);
        setRecordingState('recording');
        let seconds = 0;
        recordingTimerRef.current = setInterval(() => {
          seconds++;
          setDuration(seconds);
          if (seconds * 1000 >= MAX_RECORDING_TIME_MS) {
            console.log("VideoRecorder: Max recording time reached. Stopping recording.");
            stopRecording();
            setError("Maximum recording time reached (30 minutes).");
          }
        }, 1000);
      };

      mediaRecorderRef.current.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
          console.log(`VideoRecorder: MediaRecorder.ondataavailable: chunk size ${event.data.size}, total chunks ${recordedChunksRef.current.length}`);
        } else {
          console.log("VideoRecorder: MediaRecorder.ondataavailable: received empty chunk.");
        }
      };

      mediaRecorderRef.current.onstop = async () => {
        console.log(`VideoRecorder: MediaRecorder.onstop event fired. State: ${mediaRecorderRef.current?.state}. Chunks collected: ${recordedChunksRef.current.length}`);
        if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
        
        if (recordedChunksRef.current.length === 0) {
          console.warn("VideoRecorder: No data recorded (recordedChunksRef is empty at onstop). This can happen on iOS devices or if recording is too short or MediaRecorder failed to start properly.");
          setError("No video data was recorded. Please try recording for at least a few seconds. If using iOS, this may be a device or browser limitation. Ensure Low Power Mode is off.");
          setRecordingState('error');
          if (mediaStreamRef.current && videoPreviewRef.current) { 
            videoPreviewRef.current.srcObject = mediaStreamRef.current;
            videoPreviewRef.current.src = "";
            videoPreviewRef.current.controls = false;
            videoPreviewRef.current.muted = true;
            await videoPreviewRef.current.play().catch(e => console.warn("VideoRecorder: Error replaying live preview after empty stop:", e));
          }
          return;
        }

        let blobMimeType = actualMimeTypeRef.current;
        if (!blobMimeType && recordedChunksRef.current.length > 0) {
            blobMimeType = recordedChunksRef.current[0].type || (isIOS ? 'video/mp4' : 'video/webm');
            console.warn(`VideoRecorder: actualMimeTypeRef.current was empty at onstop, inferring blob type as: ${blobMimeType}`);
        } else if (!blobMimeType) {
            blobMimeType = isIOS ? 'video/mp4' : 'video/webm'; 
             console.warn(`VideoRecorder: actualMimeTypeRef.current was empty and no chunks to infer from. Falling back to: ${blobMimeType}`);
        }
        console.log(`VideoRecorder: Creating blob with type: ${blobMimeType}. Chunks count: ${recordedChunksRef.current.length}`);
        
        const blob = new Blob(recordedChunksRef.current, { type: blobMimeType });
        console.log(`VideoRecorder: Recorded Blob created. Size: ${blob.size}, Type: ${blob.type}`);

        if (blob.size === 0) {
            console.warn("VideoRecorder: Recorded blob size is 0 after creation. This often indicates an issue with MediaRecorder on iOS or an extremely short recording.");
            setError("Recorded video is empty. This might be due to device limitations (common on iOS if recorder didn't start correctly) or if the recording was too short. Please try again, ensuring you record for a few seconds. If the issue persists on an iOS device, it may be related to specific OS media handling. Try disabling Low Power Mode.");
            setRecordingState('error');
            return;
        }

        setRecordedVideoBlob(blob);
        const url = URL.createObjectURL(blob);
        setRecordedVideoUrl(url);

        if (videoPreviewRef.current) {
          videoPreviewRef.current.srcObject = null; 
          videoPreviewRef.current.src = ""; 
          videoPreviewRef.current.src = url; 
          videoPreviewRef.current.controls = true;
          videoPreviewRef.current.muted = false; 
          videoPreviewRef.current.setAttribute('playsinline', 'true'); 
          videoPreviewRef.current.removeAttribute('autoplay');


          videoPreviewRef.current.onloadedmetadata = async () => {
             console.log("VideoRecorder: Video metadata loaded successfully for preview.");
             if(videoPreviewRef.current && videoPreviewRef.current.duration > 0 && Number.isFinite(videoPreviewRef.current.duration)) {
                const videoDuration = Math.round(videoPreviewRef.current.duration);
                console.log(`VideoRecorder: Actual video duration from metadata: ${videoDuration}s`);
                // Do not setDuration(videoDuration) here if we prefer timer based duration
                await generatePotentialThumbnails(url, videoDuration); // Use actual reported duration for thumbnails if valid
             } else if (videoPreviewRef.current) {
                console.warn("VideoRecorder: Video duration is 0 or invalid after loading metadata for preview. Using timer duration for thumbnails.");
                // setDuration(0); // Duration state is already timer based
                await generatePotentialThumbnails(url, duration); // Fallback to timer duration
             }
             setRecordingState('stopped'); 
          };
          videoPreviewRef.current.onerror = (e) => {
            console.error("VideoRecorder: Error loading recorded video in preview element. Event:", e);
            setError("Could not load the recorded video for preview and thumbnail generation. The recording might be corrupted or in an unsupported format for preview. This can occur on some mobile devices.");
            setRecordingState('error'); 
          }
          console.log(`VideoRecorder: Setting video preview src to: ${url}. Initiating load.`);
          videoPreviewRef.current.load(); 
          await videoPreviewRef.current.play()
            .then(() => console.log("VideoRecorder: Video preview playback attempt for review initiated."))
            .catch(playError => {
              console.warn("VideoRecorder: Error trying to play video preview for review (this may be expected on some browsers without user interaction for non-muted video):", playError);
            });
        } else {
            console.error("VideoRecorder: videoPreviewRef.current is null in onstop handler.");
            setError("Internal error: Video preview element not found after recording.");
            setRecordingState('error');
        }
      };
      
      mediaRecorderRef.current.onerror = (event: Event) => {
        console.error("VideoRecorder: MediaRecorder.onerror event fired. Event object:", event);
        let errorDetail = "Unknown recording error.";
        const castEvent = event as any; 
        if (castEvent.error && castEvent.error.name && castEvent.error.message) {
            errorDetail = `Name: ${castEvent.error.name}, Message: ${castEvent.error.message}`;
            console.error("VideoRecorder: MediaRecorder DOMException Name:", castEvent.error.name);
            console.error("VideoRecorder: MediaRecorder DOMException Message:", castEvent.error.message);
        } else if (castEvent.name) { 
            errorDetail = castEvent.name;
        } else if (typeof event.type === 'string') {
             errorDetail = `Event type: ${event.type}`;
        }
        setError(`A recording error occurred: ${errorDetail}. Please try again or use a different browser/device. Ensure permissions are granted and Low Power Mode is off if on iOS.`);
        setRecordingState('error');
        if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
        console.log("VideoRecorder: MediaRecorder.onerror: Set recordingState to 'error'. Cleared timer.");
      };

      console.log("VideoRecorder: Calling mediaRecorderRef.current.start()...");
      mediaRecorderRef.current.start(); 
      console.log(`VideoRecorder: MediaRecorder state immediately after start() call: ${mediaRecorderRef.current.state}`);
      
      setTimeout(() => {
        if (mediaRecorderRef.current) {
            console.log(`VideoRecorder: MediaRecorder state after 100ms: ${mediaRecorderRef.current.state}`);
            if (mediaRecorderRef.current.state !== 'recording' && recordingState !== 'error') {
                 console.warn("VideoRecorder: MediaRecorder NOT in 'recording' state 100ms after start(), and no explicit error state yet. Current app recordingState:", recordingState);
                 if (mediaRecorderRef.current.state === 'inactive' && recordedChunksRef.current.length === 0) {
                     setError("Recording failed to start or stopped immediately. This can happen on iOS. Please check console logs for MediaRecorder errors and ensure device compatibility and Low Power mode is off.");
                     setRecordingState('error');
                 }
            }
        } else {
             console.warn("VideoRecorder: MediaRecorder became null within 100ms of starting.");
        }
      }, 100);

    } else if (mediaRecorderRef.current?.state === 'recording') {
        console.log("VideoRecorder: Recording is already in progress.");
    } else {
        console.error("VideoRecorder: Could not start recording due to unexpected state or missing stream. Stream active:", mediaStreamRef.current?.active, "Recorder state:", mediaRecorderRef.current?.state);
        setError("Could not start recording. Please ensure camera/mic are enabled and try again.");
        setRecordingState('error');
    }
  };

  const stopRecording = () => {
    console.log("VideoRecorder: Stop recording called.");
    if (mediaRecorderRef.current && 
        (mediaRecorderRef.current.state === 'recording' || mediaRecorderRef.current.state === 'paused')) {
      console.log(`VideoRecorder: Stopping MediaRecorder. Current state: ${mediaRecorderRef.current.state}`);
      mediaRecorderRef.current.stop(); // onstop will handle the rest, including clearing timer
    } else {
      console.warn("VideoRecorder: Stop recording called, but MediaRecorder not in a stoppable state. State:", mediaRecorderRef.current?.state);
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current); // Clear timer if stop is called out of sequence
    }
  };
  
  const stopMediaStream = () => {
     if (mediaStreamRef.current) {
      console.log("VideoRecorder: Stopping media stream tracks.");
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }
     if (videoPreviewRef.current) {
        videoPreviewRef.current.srcObject = null;
        videoPreviewRef.current.src = ""; 
     }
  }

  const generateSpecificThumbnail = (videoUrl: string, time: number, index: number): Promise<void> => {
    return new Promise((resolve, reject) => {
      console.log(`ThumbnailGen-${index}: Starting for time ${time}s from ${videoUrl.substring(0,30)}...`);
      const videoElement = document.createElement('video');
      videoElement.preload = 'metadata'; 
      videoElement.muted = true; 
      videoElement.src = videoUrl;
      videoElement.crossOrigin = "anonymous"; 
      videoElement.currentTime = 0.01; 

      videoElement.onloadedmetadata = () => {
        console.log(`ThumbnailGen-${index}: Metadata loaded. Duration: ${videoElement.duration}s. Seeking to ${time}s.`);
        if (videoElement.duration === 0 && time > 0.01) { 
            console.warn(`ThumbnailGen-${index}: Video duration is 0. Cannot seek.`);
            videoElement.remove();
            return reject(new Error(`Video duration is 0 for thumbnail ${index}.`));
        }
        videoElement.currentTime = Math.min(time, videoElement.duration > 0 ? videoElement.duration - 0.01 : time);
      };
      
      videoElement.onseeked = () => { 
        console.log(`ThumbnailGen-${index}: Seeked to ${videoElement.currentTime}. Capturing frame.`);
        if(videoElement.videoWidth === 0 || videoElement.videoHeight === 0) {
            console.warn(`ThumbnailGen-${index}: Video dimensions are 0 at onseeked. W: ${videoElement.videoWidth}, H: ${videoElement.videoHeight}. Thumbnail capture might fail or be blank.`);
        }
        
        const canvas = document.createElement('canvas');
        const targetWidth = Math.min(videoElement.videoWidth || 320, 320); 
        const scaleFactor = videoElement.videoWidth ? targetWidth / videoElement.videoWidth : 1;
        canvas.width = targetWidth;
        canvas.height = (videoElement.videoHeight || 180) * scaleFactor; 

        const ctx = canvas.getContext('2d');
        if (ctx) {
          try {
            ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
            canvas.toBlob((blob) => {
              if (blob && blob.size > 0) {
                const blobUrl = URL.createObjectURL(blob);
                setPotentialThumbnails(prev => { const n = [...prev]; n[index] = blobUrl; return n; });
                setPotentialThumbnailBlobs(prev => { const n = [...prev]; n[index] = blob; return n; });
                console.log(`ThumbnailGen-${index}: Blob created successfully. Size: ${blob.size}`);
              } else {
                console.warn(`ThumbnailGen-${index}: canvas.toBlob() resulted in null or empty blob.`);
              }
              videoElement.remove();
              resolve();
            }, 'image/jpeg', 0.85);
          } catch(drawError) {
            console.error(`ThumbnailGen-${index}: Error drawing video to canvas:`, drawError);
            videoElement.remove();
            reject(new Error(`Canvas drawImage failed for thumbnail ${index}.`));
          }
        } else {
          console.error(`ThumbnailGen-${index}: Canvas context not available.`);
          videoElement.remove();
          reject(new Error(`Canvas context not available for thumbnail ${index}.`));
        }
      };
      
      videoElement.onerror = (e) => {
          console.error(`ThumbnailGen-${index}: Error with video element at time ${time}s. Event:`, e);
          videoElement.remove();
          reject(new Error(`Error with video element for thumbnail ${index} at time ${time}s.`));
      }
      videoElement.load(); 
    });
  };

  const generatePotentialThumbnails = async (videoUrl: string, videoDuration: number) => {
    console.log(`VideoRecorder: Generating potential thumbnails for video URL: ${videoUrl.substring(0,30)}..., duration: ${videoDuration}s`);
    if (!videoUrl) {
        console.error("VideoRecorder: Cannot generate thumbnails, videoUrl is null or empty.");
        return;
    }
    // Use timer-based duration (passed as videoDuration argument) for thumbnail generation
    const effectiveDuration = videoDuration; 

    if (effectiveDuration <= 0.01 && effectiveDuration !==0) { 
        console.warn("VideoRecorder: Video duration is near zero or invalid, attempting to generate a single thumbnail at 0.01s");
        try {
            await generateSpecificThumbnail(videoUrl, 0.01, 0);
        } catch(error) {
             console.error("VideoRecorder: Error generating fallback thumbnail for near-zero duration video:", error);
        }
        return;
    } else if (effectiveDuration === 0) {
         console.warn("VideoRecorder: Video duration is exactly zero. Cannot generate thumbnails.");
         return;
    }

    const times = Array(NUM_THUMBNAILS_TO_GENERATE).fill(null).map((_, i) => {
        // Ensure timepoints are within valid video duration, not exceeding it
        // And ensure they are not negative or too close to 0 causing issues.
        const point = (effectiveDuration / (NUM_THUMBNAILS_TO_GENERATE + 1)) * (i + 1);
        return Math.max(0.01, Math.min(point, effectiveDuration - 0.01));
    });

    const uniqueTimes = [...new Set(times)].slice(0, NUM_THUMBNAILS_TO_GENERATE);
    
    console.log("VideoRecorder: Thumbnail generation times:", uniqueTimes);
    try {
      for (let i = 0; i < uniqueTimes.length; i++) {
        if (potentialThumbnails[i]) URL.revokeObjectURL(potentialThumbnails[i]!);
        setPotentialThumbnails(prev => { const n = [...prev]; n[i] = null; return n; });
        setPotentialThumbnailBlobs(prev => { const n = [...prev]; n[i] = null; return n; });
        
        await generateSpecificThumbnail(videoUrl, uniqueTimes[i], i);
      }
      console.log("VideoRecorder: Completed attempt to generate potential thumbnails.");
    } catch (error) {
        console.error("VideoRecorder: Error during one or more thumbnail generations:", error);
    }
  };

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
      console.log(`VideoRecorder: Video saved locally as ${a.download}`);
    } else {
      console.warn("VideoRecorder: Cannot save locally: no recorded video blob or URL.");
    }
  };
  
  const resetRecorderState = (setupNewStream = true) => {
    console.log("VideoRecorder: Resetting recorder state. Setup new stream:", setupNewStream);
    setTitle(''); setDescription(''); setKeywords(''); setFeatured(false);
    setRecordedVideoBlob(null); 
    if(recordedVideoUrl) URL.revokeObjectURL(recordedVideoUrl);
    setRecordedVideoUrl(null); 
    potentialThumbnails.forEach(url => { if (url) URL.revokeObjectURL(url); });
    setPotentialThumbnails(Array(NUM_THUMBNAILS_TO_GENERATE).fill(null));
    setPotentialThumbnailBlobs(Array(NUM_THUMBNAILS_TO_GENERATE).fill(null));
    setSelectedThumbnailIndex(0);
    setDuration(0); // Timer duration
    actualMimeTypeRef.current = '';
    recordedChunksRef.current = [];
    
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        console.log("VideoRecorder: Resetting - MediaRecorder state is not inactive, attempting stop.");
        try { mediaRecorderRef.current.stop(); } catch(e) { console.warn("Error stopping mediarecorder during reset:", e)}
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
    if(setupNewStream) {
        stopMediaStream(); 
        requestPermissionsAndSetup(); 
    }
  };

  const handleUpload = async (event: FormEvent) => {
    event.preventDefault();
    const selectedThumbnailBlob = potentialThumbnailBlobs[selectedThumbnailIndex];

    if (!recordedVideoBlob || !selectedThumbnailBlob || !user || !doctorProfile) {
      setError("Missing video data, selected thumbnail, or user information. Please ensure recording is complete and a thumbnail is selected.");
      console.error("VideoRecorder: Upload precondition failed: Missing data.", {hasRecordedVideoBlob: !!recordedVideoBlob, hasSelectedThumbnailBlob: !!selectedThumbnailBlob, hasUser: !!user, hasDoctorProfile: !!doctorProfile});
      return;
    }
    if (!title.trim()) {
      setError("Video title is required.");
      return;
    }

    console.log("VideoRecorder: Starting upload process...");
    setRecordingState('uploading');
    setError(null);
    setSuccessMessage(null);
    setUploadProgress(0);

    try {
      const safeTitle = title.replace(/[^a-z0-9_]+/gi, '_').toLowerCase() || uuidv4(); 
      const timestamp = Date.now();
      const videoExtension = getFileExtensionFromMimeType(recordedVideoBlob.type || actualMimeTypeRef.current);
      const videoFileName = `${safeTitle}_${timestamp}.${videoExtension}`;
      const thumbnailFileName = `thumbnail_${safeTitle}_${timestamp}.jpg`;

      console.log(`VideoRecorder: Uploading video: ${videoFileName} (Type: ${recordedVideoBlob.type || actualMimeTypeRef.current}), thumbnail: ${thumbnailFileName}`);

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
      console.log("VideoRecorder: Video uploaded to:", videoUrl);
      setUploadProgress(90);

      const thumbnailStoragePath = await uploadFileToStorage(
        `thumbnails/${doctorProfile.uid}`,
        selectedThumbnailBlob, 
        thumbnailFileName,
         (snapshot) => {
          const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
          setUploadProgress(90 + (progress * 0.1)); 
        }
      );
      const thumbnailUrl = await getFirebaseStorageDownloadUrl(thumbnailStoragePath);
      console.log("VideoRecorder: Thumbnail uploaded to:", thumbnailUrl);
      setUploadProgress(100);

      const videoId = uuidv4();
      const videoData: Omit<VideoMeta, 'id' | 'createdAt' | 'permalink'> = {
        title,
        description,
        doctorId: doctorProfile.uid,
        doctorName: doctorProfile.displayName || doctorProfile.email || 'Unknown Doctor',
        videoUrl,
        thumbnailUrl,
        duration: formatTime(duration), // Use timer-based duration
        recordingDuration: duration, // Store raw seconds
        tags: keywords.split(',').map(k => k.trim()).filter(Boolean),
        viewCount: 0,
        featured,
        storagePath: videoStoragePath,
        thumbnailStoragePath: thumbnailStoragePath,
        videoSize: recordedVideoBlob.size,
        videoType: recordedVideoBlob.type || actualMimeTypeRef.current,
        comments: [], 
      };
      
      await addVideoMetadataToFirestore({ ...videoData, videoId });
      console.log("VideoRecorder: Video metadata saved to Firestore with ID:", videoId);

      setSuccessMessage("Video uploaded and metadata saved successfully!");
      setRecordingState('success');
      setTitle(''); setDescription(''); setKeywords(''); setFeatured(false);
      setRecordedVideoBlob(null); 
      if(recordedVideoUrl) URL.revokeObjectURL(recordedVideoUrl);
      setRecordedVideoUrl(null); 
      potentialThumbnails.forEach(url => { if (url) URL.revokeObjectURL(url); });
      setPotentialThumbnails(Array(NUM_THUMBNAILS_TO_GENERATE).fill(null));
      setPotentialThumbnailBlobs(Array(NUM_THUMBNAILS_TO_GENERATE).fill(null));
      setPreviewRotation(0);

    } catch (err) {
      console.error("VideoRecorder: Upload failed:", err);
      setError(`Upload failed: ${err instanceof Error ? err.message : String(err)}`);
      setRecordingState('error'); 
    } finally {
      if(recordingState !== 'success') setUploadProgress(0);
    }
  };

  const handleRotatePreview = () => {
    setPreviewRotation(current => (current + 90) % 360);
  };
  
  if (!isAdmin && typeof window !== 'undefined' && !user) { 
    return <div className="flex items-center justify-center h-full"><Loader2 className="h-8 w-8 animate-spin" /></div>; 
  }
  if (!isAdmin && typeof window !== 'undefined' && user) {
     return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Access Denied</AlertTitle>
        <AlertDescription>You must be an administrator to access the video recorder.</AlertDescription>
      </Alert>
     );
  }

  return (
    <div className="space-y-6">
      {error && recordingState !== 'uploading' && ( 
        <Alert variant="destructive" className="w-full">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {successMessage && (
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
                    muted 
                    autoPlay 
                />
                {(recordingState === 'idle' && mediaStreamRef.current && !recordedVideoUrl && !successMessage) && (
                    <Button 
                        onClick={handleRotatePreview} 
                        variant="outline" 
                        size="icon" 
                        className="absolute top-4 left-4 z-10 bg-black/50 text-white hover:bg-black/70 border-white/50 opacity-0 group-hover:opacity-100 transition-opacity"
                        title="Rotate Preview"
                    >
                        <RotateCw size={20} />
                    </Button>
                )}
                {(recordingState === 'recording' || recordingState === 'paused') && (
                <div className="absolute top-4 right-4 bg-red-600 text-white px-3 py-1.5 rounded-lg text-sm font-mono shadow-lg flex items-center gap-2">
                    <Mic size={18} className="animate-pulse" /> REC {formatTime(duration)}
                </div>
                )}
                 {recordingState === 'stopped' && recordedVideoUrl && (
                    <div className="absolute top-4 right-4 bg-blue-600 text-white px-3 py-1.5 rounded-lg text-sm font-mono shadow-lg">
                        REVIEWING - {formatTime(duration)}
                    </div>
                )}
                {recordingState === 'idle' && !mediaStreamRef.current && !successMessage && (
                <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center bg-black/50">
                    <Camera size={56} className="text-slate-300 mb-4" />
                    <p className="text-slate-200 mb-6 text-lg">Camera and microphone access needed to record.</p>
                    <Button onClick={requestPermissionsAndSetup} variant="default" size="lg" className="gap-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg text-base px-6 py-3">
                    <Settings2 className="h-5 w-5" /> Setup Camera & Mic
                    </Button>
                </div>
                )}
                 {recordingState === 'idle' && mediaStreamRef.current && !recordedVideoUrl && !successMessage && (
                   <div className="absolute bottom-4 left-1/2 -translate-x-1/2">
                     <Button onClick={startRecording} className="gap-2 bg-green-500 hover:bg-green-600 text-white rounded-full px-8 py-4 text-lg shadow-xl animate-pulse" size="lg">
                        <Video className="h-6 w-6" /> Start Recording
                    </Button>
                   </div>
                )}
            </div>
        </CardContent>
         <CardFooter className="pt-6 pb-6 bg-slate-50 dark:bg-slate-800/50 border-t dark:border-slate-700 flex flex-col sm:flex-row gap-4 items-center justify-center">
            {mediaStreamRef.current && (recordingState === 'idle' || recordingState === 'error') && !recordedVideoUrl && !successMessage && (
              <Button onClick={startRecording} className="gap-2 bg-green-500 hover:bg-green-600 text-white w-full sm:w-auto rounded-lg px-6 py-3 text-base" size="lg">
                  <Video className="h-5 w-5" /> Start Recording
              </Button>
            )}
            {recordingState === 'recording' && (
            <Button onClick={stopRecording} variant="destructive" className="gap-2 w-full sm:w-auto rounded-lg px-6 py-3 text-base" size="lg">
                <Square className="h-5 w-5" /> Stop Recording
            </Button>
            )}
            {recordingState === 'success' && (
               <Button onClick={() => resetRecorderState(true)} className="gap-2 bg-blue-500 hover:bg-blue-600 text-white w-full sm:w-auto rounded-lg px-6 py-3 text-base" size="lg">
                  <RefreshCcw className="h-5 w-5" /> Record Another Video
              </Button>
            )}
         </CardFooter>
      </Card>

      {((recordedVideoUrl && recordingState === 'stopped') || recordingState === 'error' && recordedVideoUrl) && ( 
        <Card className="shadow-xl mt-8 rounded-xl">
          <CardHeader className="border-b dark:border-slate-700">
            <CardTitle className="text-2xl font-headline">Review & Upload Video</CardTitle>
            <CardDescription>Duration: {formatTime(duration)}. Review your video, select a thumbnail, and provide details before uploading. Note: Preview rotation does not change the recorded video's orientation.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-8 pt-6">
            {recordingState === 'error' && error && ( 
                 <Alert variant="destructive" className="w-full">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Upload Error</AlertTitle>
                    <AlertDescription>{error}</AlertDescription>
                </Alert>
            )}
             <div className="flex items-center gap-4">
                <Button onClick={handleRotatePreview} variant="outline" className="gap-2">
                    <RotateCw size={16} /> Rotate Preview
                </Button>
                <p className="text-xs text-muted-foreground">
                    Current Preview Rotation: {previewRotation}° (This does not affect the final recording).
                </p>
            </div>
            <div>
              <Label className="mb-3 block text-base font-medium text-foreground">Select Thumbnail</Label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                {potentialThumbnails.map((thumbUrl, index) => (
                  thumbUrl ? (
                    <button
                      key={index}
                      onClick={() => setSelectedThumbnailIndex(index)}
                      className={`relative aspect-video rounded-lg overflow-hidden border-4 transition-all duration-200 ease-in-out hover:opacity-70 focus:outline-none
                        ${selectedThumbnailIndex === index ? 'border-primary ring-4 ring-primary/50 ring-offset-2 ring-offset-background' : 'border-slate-300 dark:border-slate-600'}`}
                    >
                      <Image src={thumbUrl} alt={`Thumbnail ${index + 1}`} layout="fill" objectFit="cover" className="transition-transform group-hover:scale-105" data-ai-hint="video thumbnail preview"/>
                      {selectedThumbnailIndex === index && (
                        <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                           <CheckCircle size={40} className="text-white opacity-90" />
                        </div>
                      )}
                    </button>
                  ) : (
                    <div key={index} className="aspect-video bg-muted rounded-lg flex items-center justify-center border border-dashed border-slate-300 dark:border-slate-700">
                      <Film size={32} className="text-muted-foreground animate-pulse" />
                    </div>
                  )
                ))}
              </div>
            </div>

            <form onSubmit={handleUpload} className="space-y-6" id="upload-form-video-recorder">
              <div className="space-y-2">
                <Label htmlFor="title" className="text-base">Video Title <span className="text-destructive">*</span></Label>
                <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} required placeholder="e.g., Understanding Blood Pressure" className="text-base p-3 rounded-lg"/>
              </div>
              <div className="space-y-2">
                <Label htmlFor="description" className="text-base">Description</Label>
                <Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Summarize the video content, key topics covered..." rows={4} className="text-base p-3 rounded-lg"/>
              </div>
              <div className="space-y-2">
                <Label htmlFor="keywords" className="text-base">Keywords (comma-separated)</Label>
                <Input id="keywords" value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="e.g., cardiology, hypertension, lifestyle" className="text-base p-3 rounded-lg"/>
              </div>
              <div className="flex items-center space-x-3 pt-2">
                <Checkbox id="featured" checked={featured} onCheckedChange={(checked) => setFeatured(!!checked)} className="h-5 w-5"/>
                <Label htmlFor="featured" className="font-normal text-base">Feature this video on Homepage</Label>
              </div>
            </form>
          </CardContent>
          <CardFooter className="flex flex-col sm:flex-row gap-4 pt-6 border-t dark:border-slate-700">
            <Button type="button" onClick={handleSaveLocally} variant="outline" className="gap-2 w-full sm:w-auto rounded-lg text-base px-5 py-2.5">
              <Download className="h-5 w-5" /> Save Locally
            </Button>
             <Button onClick={() => resetRecorderState(true)} variant="ghost" className="gap-2 w-full sm:w-auto rounded-lg text-base px-5 py-2.5">
                <RefreshCcw className="h-5 w-5" /> Record Again
            </Button>
            <Button type="submit" form="upload-form-video-recorder" disabled={recordingState === 'uploading' || !recordedVideoBlob || !potentialThumbnailBlobs[selectedThumbnailIndex]} className="gap-2 flex-grow w-full sm:w-auto bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg text-base px-5 py-2.5">
              {recordingState === 'uploading' ? <Loader2 className="h-5 w-5 animate-spin" /> : <UploadCloud className="h-5 w-5" />}
              {recordingState === 'uploading' ? 'Uploading...' : 'Upload Video'}
            </Button>
          </CardFooter>
        </Card>
      )}
      
      {recordingState === 'uploading' && (
        <Card className="mt-8 rounded-xl">
          <CardHeader>
             <CardTitle>Upload Progress</CardTitle>
          </CardHeader>
          <CardContent className="p-6">
             {error && ( 
                 <Alert variant="destructive" className="w-full mb-4">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Upload Failed</AlertTitle>
                    <AlertDescription>{error}</AlertDescription>
                </Alert>
            )}
            <Progress value={uploadProgress} className="w-full h-3 rounded-full" />
            <p className="text-base text-center mt-3 text-muted-foreground">Uploading video... {Math.round(uploadProgress)}%</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

    