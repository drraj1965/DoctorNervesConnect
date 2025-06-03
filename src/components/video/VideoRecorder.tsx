
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

type RecordingState = 'initial' | 'permission' | 'ready' | 'recording' | 'stopped' | 'uploading' | 'success' | 'error';

const MAX_RECORDING_TIME_MS = 30 * 60 * 1000;
const NUM_THUMBNAILS_TO_GENERATE = 5;
const RECORDING_TIMESLICE_MS = 1000; // For ondataavailable events

export default function VideoRecorder() {
  const { user, doctorProfile, isAdmin } = useAuth();
  const router = useRouter();

  const [recordingState, setRecordingState] = useState<RecordingState>('initial');
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  
  const liveVideoPreviewRef = useRef<HTMLVideoElement | null>(null);
  const recordedVideoPreviewRef = useRef<HTMLVideoElement | null>(null);

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
    if (liveVideoPreviewRef.current) {
      liveVideoPreviewRef.current.srcObject = null;
      liveVideoPreviewRef.current.src = "";
    }
     if (recordedVideoPreviewRef.current) {
      recordedVideoPreviewRef.current.srcObject = null;
      recordedVideoPreviewRef.current.src = "";
    }
  }, []);

  useEffect(() => {
    if (!isAdmin && user) {
      router.replace('/dashboard');
    }
    return () => {
      console.log("VideoRecorder: Component unmounting or user/admin status changed -> stopping media stream.");
      stopMediaStream();
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
      }
    };
  }, [isAdmin, user, router, stopMediaStream]);


  useEffect(() => {
    const previousUrl = recordedVideoUrlRef_forCleanup.current;
    recordedVideoUrlRef_forCleanup.current = recordedVideoUrl;
    return () => {
      if (previousUrl) {
        console.log("VideoRecorder: useEffect[recordedVideoUrl] cleanup - revoking old recordedVideoUrl:", previousUrl.substring(0,50));
        URL.revokeObjectURL(previousUrl);
      }
    };
  }, [recordedVideoUrl]);

  useEffect(() => {
    const previousThumbnails = potentialThumbnailsRef_forCleanup.current;
    potentialThumbnailsRef_forCleanup.current = [...potentialThumbnails];
    return () => {
      previousThumbnails.forEach((url, index) => {
        if (url) {
          console.log(`VideoRecorder: useEffect[potentialThumbnails] cleanup - revoking old thumb ${index}:`, url.substring(0,50));
          URL.revokeObjectURL(url);
        }
      });
    };
  }, [potentialThumbnails]);
  
  useEffect(() => {
    const urlToRevoke = thumbnailGenerationVideoUrl_cleanupRef.current;
    return () => {
        if (urlToRevoke) {
            console.log("VideoRecorder: useEffect[recordedVideoBlob related] cleanup - revoking old thumbnailGenerationVideoUrl:", urlToRevoke.substring(0,50));
            URL.revokeObjectURL(urlToRevoke);
            thumbnailGenerationVideoUrl_cleanupRef.current = null;
        }
    };
  }, [recordedVideoBlob]); // Runs when recordedVideoBlob changes, esp. when set to null on reset


  const requestPermissionsAndSetup = useCallback(async () => {
    console.log("VideoRecorder: Requesting media permissions...");
    setError(null);
    setSuccessMessage(null); // Clear any previous success messages
    setRecordingState('permission');

    if (isStreamValid(mediaStreamRef.current)) {
        console.log("VideoRecorder: Stream already valid in requestPermissionsAndSetup. Setting state to ready.");
        if (liveVideoPreviewRef.current) {
            if (liveVideoPreviewRef.current.srcObject !== mediaStreamRef.current) {
                 liveVideoPreviewRef.current.srcObject = mediaStreamRef.current;
                 liveVideoPreviewRef.current.src = "";
            }
            liveVideoPreviewRef.current.muted = true;
            liveVideoPreviewRef.current.controls = false;
            await liveVideoPreviewRef.current.play().catch(e => console.warn("VideoRecorder: Error playing existing stream in preview during setup:", e));
        }
        setRecordingState('ready');
        return;
    }
    
    stopMediaStream(); 

    try {
      const constraints: MediaStreamConstraints = {
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: { ideal: 'user' } },
        audio: true
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      
      if (!isStreamValid(stream)) {
        stream?.getTracks().forEach(track => track.stop()); // Clean up the invalid stream
        throw new Error("Camera stream acquired but is not active or valid.");
      }

      mediaStreamRef.current = stream;

      if (liveVideoPreviewRef.current) {
        liveVideoPreviewRef.current.srcObject = stream;
        liveVideoPreviewRef.current.src = ""; 
        liveVideoPreviewRef.current.muted = true;
        liveVideoPreviewRef.current.controls = false;
        liveVideoPreviewRef.current.setAttribute('playsinline', 'true'); // For iOS Safari
        await liveVideoPreviewRef.current.play().catch(e => {
            console.warn("VideoRecorder: Error playing live preview on setup:", e);
            // If play fails, the stream might still be "valid" but unusable for preview.
            // Consider stopping it and showing an error.
        });
      }
      setRecordingState('ready');
      setPreviewRotation(0); // Reset rotation on new setup
      console.log("VideoRecorder: Media permissions granted and stream set up successfully.");
    } catch (err) {
      console.error("VideoRecorder: Error accessing media devices:", err);
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError(`Failed to access camera/microphone: ${errorMessage}. Please ensure permissions are allowed in your browser settings.`);
      stopMediaStream(); // Ensure stream is stopped on error
      setRecordingState('initial'); 
    }
  }, [stopMediaStream, isStreamValid]);


  const formatTime = (totalSeconds: number): string => {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(Math.floor(seconds)).padStart(2, '0')}`;
  };

  const startRecording = async () => {
    console.log("VideoRecorder: Attempting to start recording...");
    if (recordingState !== 'ready') {
        setError("Camera not ready. Please set up the camera first.");
        console.warn("VideoRecorder: Start recording called but state is not 'ready'. State:", recordingState);
        return;
    }
    setError(null); setSuccessMessage(null); setIsLocallySaved(false);

    if (!isStreamValid(mediaStreamRef.current)) {
      setError("Failed to initialize recording: Camera stream is invalid. Please try setting up the camera again.");
      console.warn("VideoRecorder: Stream invalid at startRecording. Attempting re-setup.");
      await requestPermissionsAndSetup(); // Try to re-setup
      if (!isStreamValid(mediaStreamRef.current)) { // Check again after re-setup attempt
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


    recordedChunksRef.current = [];
    setRecordedVideoBlob(null);
    // No need to revoke/set recordedVideoUrl here, that's for after stopping.
    // Cleanup for previous recording's thumbnails/blobs should happen in reset or their own effects.
    
    timerSecondsRef.current = 0;
    setDisplayTime(0); 
    actualMimeTypeRef.current = '';

    if (liveVideoPreviewRef.current) {
        if (liveVideoPreviewRef.current.srcObject !== mediaStreamRef.current || liveVideoPreviewRef.current.src) {
          console.log("VideoRecorder: Setting/Resetting preview to live stream for recording.");
          liveVideoPreviewRef.current.srcObject = mediaStreamRef.current;
          liveVideoPreviewRef.current.src = ""; 
        }
        liveVideoPreviewRef.current.muted = true;
        liveVideoPreviewRef.current.controls = false;
        await liveVideoPreviewRef.current.play().catch(e => console.warn("VideoRecorder: Error re-playing live preview for recording:", e));
    }

    let chosenMimeType = '';
    const mimeTypesToCheck = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4;codecs=avc1.42E01E', 'video/mp4'];
    for (const type of mimeTypesToCheck) { if (MediaRecorder.isTypeSupported(type)) { chosenMimeType = type; break; } }
    const options: MediaRecorderOptions = {};
    if (chosenMimeType) options.mimeType = chosenMimeType;
    console.log("VideoRecorder: MediaRecorder options:", options);

    try {
      console.log("VideoRecorder: Instantiating MediaRecorder. Stream active:", mediaStreamRef.current?.active, "Tracks:", mediaStreamRef.current?.getVideoTracks()[0]?.readyState, mediaStreamRef.current?.getAudioTracks()[0]?.readyState);
      mediaRecorderRef.current = new MediaRecorder(mediaStreamRef.current, options);
    } catch (e: any) {
      console.error("VideoRecorder: Error creating MediaRecorder instance:", e);
      setError(`Failed to initialize recorder: ${e.message || String(e)}. Try resetting the camera.`);
      setRecordingState('ready'); 
      return;
    }

    mediaRecorderRef.current.onstart = () => {
      if (mediaRecorderRef.current) actualMimeTypeRef.current = mediaRecorderRef.current.mimeType || chosenMimeType || '';
      console.log(`VideoRecorder: MediaRecorder.onstart. Actual MIME: ${actualMimeTypeRef.current}. State: ${mediaRecorderRef.current?.state}`);
      setRecordingState('recording');
      setDisplayTime(0); 
      timerSecondsRef.current = 0;
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = setInterval(() => {
        timerSecondsRef.current++;
        setDisplayTime(prev => prev + 1);
        if (timerSecondsRef.current * 1000 >= MAX_RECORDING_TIME_MS) { 
          stopRecording(); 
          setError("Max recording time reached."); 
        }
      }, 1000);
    };

    mediaRecorderRef.current.ondataavailable = (event) => {
      if (event.data.size > 0) recordedChunksRef.current.push(event.data);
    };

    mediaRecorderRef.current.onstop = async () => {
      const finalRecordedDuration = timerSecondsRef.current;
      console.log(`VideoRecorder: MediaRecorder.onstop. Chunks: ${recordedChunksRef.current.length}. Timer Duration: ${finalRecordedDuration}s`);
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
      // Note: Do not setRecordingState('stopped') here yet. Wait for blob processing.

      const currentMimeType = actualMimeTypeRef.current || mediaRecorderRef.current?.mimeType || 'video/webm';
      const blob = new Blob(recordedChunksRef.current, { type: currentMimeType });
      console.log(`VideoRecorder: Blob created. Size: ${blob.size}, Type: ${blob.type}`);

      if (blob.size === 0) {
        setError("Recorded video is empty. Please try recording again.");
        setRecordingState('ready'); // Go back to ready state
        return;
      }
      setRecordedVideoBlob(blob); // This will trigger useEffect for thumbnailGenerationVideoUrl_cleanupRef
      
      const newMainPreviewUrl = URL.createObjectURL(blob);
      setRecordedVideoUrl(newMainPreviewUrl); // This triggers useEffect for recordedVideoUrlRef_forCleanup

      let newThumbGenUrl: string | null = null;
      try {
        const blobSliceForThumbs = blob.slice(); 
        newThumbGenUrl = URL.createObjectURL(blobSliceForThumbs);
        if (thumbnailGenerationVideoUrl_cleanupRef.current) {
            URL.revokeObjectURL(thumbnailGenerationVideoUrl_cleanupRef.current);
        }
        thumbnailGenerationVideoUrl_cleanupRef.current = newThumbGenUrl;
      } catch (sliceError) {
        console.error("VideoRecorder: Error slicing blob for thumbnail URL:", sliceError);
        newThumbGenUrl = newMainPreviewUrl; // Fallback, but with potential issues.
      }

      if (recordedVideoPreviewRef.current) {
        console.log("VideoRecorder: Setting up recorded video preview element.");
        recordedVideoPreviewRef.current.srcObject = null;
        recordedVideoPreviewRef.current.src = ""; 
        recordedVideoPreviewRef.current.src = newMainPreviewUrl;
        recordedVideoPreviewRef.current.muted = false;
        recordedVideoPreviewRef.current.controls = true;
        recordedVideoPreviewRef.current.load(); 
        
        recordedVideoPreviewRef.current.onloadedmetadata = () => {
          console.log(`VideoRecorder: Recorded preview metadata loaded. Element duration: ${recordedVideoPreviewRef.current?.duration}s, Timer duration: ${finalRecordedDuration}s.`);
          recordedVideoPreviewRef.current?.play().catch(e => {
            console.warn("Error playing recorded preview in onloadedmetadata:", e);
            setError(`Preview Error: Could not play recorded video. (${e.name || 'Unknown media error'})`);
          });
        };
        recordedVideoPreviewRef.current.onerror = (e) => {
          const videoError = recordedVideoPreviewRef.current?.error;
          console.error("VideoRecorder: Error loading recorded video in preview. Event:", e, "VideoError:", videoError);
          setError(`Preview Error: ${videoError?.message || 'Media error'}. Code: ${videoError?.code}. Try local save.`);
        };
      }
      setRecordingState('stopped'); // Now transition state after setting up URLs

      if (finalRecordedDuration > 0 && newThumbGenUrl) {
        console.log(`VideoRecorder: onstop - Blob valid. Proceeding to thumbnails with timer duration: ${finalRecordedDuration}s.`);
        await generatePotentialThumbnails(newThumbGenUrl, finalRecordedDuration);
      } else if (finalRecordedDuration <= 0) {
        console.warn("VideoRecorder: onstop - Recorded duration is 0s. Skipping thumbnail generation.");
        setError("Recording was too short to generate thumbnails. Please record for at least a few seconds.");
        setPotentialThumbnails(Array(NUM_THUMBNAILS_TO_GENERATE).fill(null));
        setPotentialThumbnailBlobs(Array(NUM_THUMBNAILS_TO_GENERATE).fill(null));
      } else if (!newThumbGenUrl) {
         console.warn("VideoRecorder: onstop - Thumbnail generation URL could not be created. Skipping thumbnail generation.");
         setError("Could not prepare video for thumbnail generation.");
      }
    };

    mediaRecorderRef.current.onerror = (event: Event) => {
      console.error("VideoRecorder: MediaRecorder.onerror:", event);
      const mrError = event as any; // DOMException
      let errorMsg = "Recording error occurred.";
      if (mrError.error?.message) errorMsg += ` Details: ${mrError.error.message}`;
      else if (mrError.error?.name) errorMsg += ` Details: ${mrError.error.name}`;
      else if (mrError.type) errorMsg += ` Type: ${mrError.type}`;
      setError(errorMsg);
      setRecordingState('ready');
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    };

    try {
      console.log("VideoRecorder: Calling mediaRecorderRef.current.start() with timeslice:", RECORDING_TIMESLICE_MS);
      mediaRecorderRef.current.start(RECORDING_TIMESLICE_MS);
    } catch (startError: any) {
      console.error("VideoRecorder: Error calling mediaRecorder.start():", startError);
      setError(`Failed to start MediaRecorder: ${startError.message}. State: ${mediaRecorderRef.current?.state}. Try resetting camera.`);
      setRecordingState('ready');
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    }
  };

  const stopRecording = () => {
    console.log(`VideoRecorder: stopRecording() called. Current MediaRecorder state: ${mediaRecorderRef.current?.state}. Timer ref: ${timerSecondsRef.current}s.`);
    if (mediaRecorderRef.current && (mediaRecorderRef.current.state === 'recording' || mediaRecorderRef.current.state === 'paused')) {
      mediaRecorderRef.current.stop(); // This will trigger 'onstop'
    } else {
      console.warn(`VideoRecorder: stopRecording() called but recorder not in 'recording' or 'paused' state. State: ${mediaRecorderRef.current?.state}. Forcing timer stop.`);
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
      if (recordingState === 'recording') { // If UI is stuck in recording but recorder isn't
         setRecordingState('stopped'); // Try to recover state
      }
    }
  };

  const generateSpecificThumbnail = useCallback((videoObjectUrlForThumbs: string, time: number, index: number): Promise<{ blob: Blob; blobUrl: string } | null> => {
    return new Promise((resolve) => {
      console.log(`VideoRecorder: generateSpecificThumbnail - Idx ${index}, Time ${time}s`);
      const videoElement = document.createElement('video');
      videoElement.preload = 'metadata';
      videoElement.muted = true;
      videoElement.src = videoObjectUrlForThumbs;
      videoElement.crossOrigin = "anonymous"; // In case of CORS issues if URL were not a blob

      let seekedFired = false;
      let metadataLoaded = false;
      let resolved = false;

      const cleanupAndResolve = (value: { blob: Blob; blobUrl: string } | null) => {
          if (resolved) return;
          resolved = true;
          clearTimeout(timeoutId);
          videoElement.removeEventListener('loadedmetadata', onMetadata);
          videoElement.removeEventListener('seeked', onSeeked);
          videoElement.removeEventListener('error', onErrorHandler);
          videoElement.src = ""; 
          videoElement.removeAttribute('src');
          videoElement.remove(); // Remove element from DOM if it was ever added (it's not here)
          resolve(value);
      };

      const timeoutId = setTimeout(() => {
        console.warn(`VideoRecorder: Thumb[${index}] generation timed out after 7s for time ${time}s.`);
        cleanupAndResolve(null);
      }, 7000); 

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
        
        if (canvas.width === 0 || canvas.height === 0) { 
            console.warn(`VideoRecorder: Thumbnail[${index}] - Canvas dimensions are zero.`);
            cleanupAndResolve(null); return;
        }

        const ctx = canvas.getContext('2d');
        if (ctx) {
            try {
                ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
                canvas.toBlob(blob => {
                    if (blob && blob.size > 0) {
                        cleanupAndResolve({ blob, blobUrl: URL.createObjectURL(blob) });
                    } else { 
                        console.warn(`VideoRecorder: Thumbnail[${index}] toBlob resulted in null or empty blob.`);
                        cleanupAndResolve(null); 
                    }
                }, 'image/jpeg', 0.85); 
            } catch (drawError) { 
                console.error(`VideoRecorder: Draw error for thumb ${index}`, drawError); 
                cleanupAndResolve(null); 
            }
        } else { 
            console.error(`VideoRecorder: Thumbnail[${index}] - Could not get 2D context for canvas.`);
            cleanupAndResolve(null); 
        }
      };

      const onMetadata = async () => {
          metadataLoaded = true;
          console.log(`VideoRecorder: Thumb[${index}] metadata. Duration: ${videoElement.duration}s. Dims: ${videoElement.videoWidth}x${videoElement.videoHeight}. Seeking to ${time}s.`);
          const seekTime = Math.max(0.01, Math.min(time, (videoElement.duration > 0 && Number.isFinite(videoElement.duration)) ? videoElement.duration - 0.01 : time));
          videoElement.currentTime = seekTime;
          // Small delay to allow currentTime to apply before checking readyState
          await new Promise(r => setTimeout(r, 200)); 
          if (videoElement.readyState >= 2 && !seekedFired) { // HAVE_CURRENT_DATA or more
            console.log(`VideoRecorder: Thumb[${index}] readyState >= 2 after seek attempt, capturing frame.`);
            captureFrame();
          } else if (!seekedFired) {
            console.log(`VideoRecorder: Thumb[${index}] readyState < 2 (${videoElement.readyState}) after seek attempt, waiting for 'seeked'.`);
          }
      };
      const onSeeked = () => {
          if (resolved || seekedFired) return; // Already handled or resolved
          if (!metadataLoaded) { console.warn(`VideoRecorder: Thumb[${index}] seeked before metadata loaded.`); cleanupAndResolve(null); return; }
          seekedFired = true;
          console.log(`VideoRecorder: Thumb[${index}] seeked to ${videoElement.currentTime}s. Capturing frame.`);
          captureFrame();
      };
      const onErrorHandler = (e: Event | string) => { 
        console.error(`VideoRecorder: Thumb[${index}] video element error:`, videoElement.error, e); 
        cleanupAndResolve(null); 
      };
      
      videoElement.addEventListener('loadedmetadata', onMetadata);
      videoElement.addEventListener('seeked', onSeeked);
      videoElement.addEventListener('error', onErrorHandler);
      videoElement.load(); // Start loading the video
    });
  }, []);

  const generatePotentialThumbnails = useCallback(async (videoObjectUrlForThumbs: string, duration: number) => {
    if (!videoObjectUrlForThumbs) {
      setError("Cannot generate thumbnails: video URL for thumbnails is missing.");
      setIsGeneratingThumbnails(false); return;
    }
    if (!(duration > 0 && Number.isFinite(duration))) {
      console.warn("VideoRecorder: Thumbnail generation skipped, duration invalid or zero:", duration);
      setError("Cannot generate thumbnails: video duration is invalid or too short for thumbnails.");
      setIsGeneratingThumbnails(false);
      setPotentialThumbnails(Array(NUM_THUMBNAILS_TO_GENERATE).fill(null));
      setPotentialThumbnailBlobs(Array(NUM_THUMBNAILS_TO_GENERATE).fill(null));
      return;
    }
    console.log(`VideoRecorder: Generating thumbnails. Duration: ${duration}s`);
    setIsGeneratingThumbnails(true);
    
    const oldThumbURLs = [...potentialThumbnailsRef_forCleanup.current]; 
    setPotentialThumbnails(Array(NUM_THUMBNAILS_TO_GENERATE).fill(null)); 
    setPotentialThumbnailBlobs(Array(NUM_THUMBNAILS_TO_GENERATE).fill(null));

    let timePoints: number[];
     if (duration < 1) { // For very short videos
        timePoints = [duration / 2, Math.min(duration * 0.9, duration - 0.01)].filter(t => t > 0.01).slice(0, NUM_THUMBNAILS_TO_GENERATE);
        if(timePoints.length === 0 && duration > 0.01) timePoints = [duration * 0.5];

    } else {
        timePoints = Array(NUM_THUMBNAILS_TO_GENERATE).fill(null).map((_, i) => {
            const point = (duration / (NUM_THUMBNAILS_TO_GENERATE + 1)) * (i + 1);
            return Math.max(0.01, Math.min(point, duration - 0.01)); // Ensure time is within bounds and positive
        });
    }
    const uniqueTimes = [...new Set(timePoints)].filter(t => Number.isFinite(t) && t > 0).slice(0, NUM_THUMBNAILS_TO_GENERATE);

    if (uniqueTimes.length === 0) {
        console.warn("VideoRecorder: No valid time points for thumbnail generation for duration:", duration);
        setError("Could not determine valid points in the video to create thumbnails. The video might be too short.");
        setIsGeneratingThumbnails(false);
        oldThumbURLs.forEach(url => { if (url) URL.revokeObjectURL(url); });
        return;
    }

    const settledResults = await Promise.allSettled(
      uniqueTimes.map((time, index) => generateSpecificThumbnail(videoObjectUrlForThumbs, time, index))
    );

    const newUrls: (string | null)[] = [];
    const newBlobs: (Blob | null)[] = [];
    settledResults.forEach((result, idx) => {
      if (result.status === 'fulfilled' && result.value) {
        console.log(`VideoRecorder: Thumbnail generation success for point ${uniqueTimes[idx]}s`);
        newUrls.push(result.value.blobUrl);
        newBlobs.push(result.value.blob);
      } else if (result.status === 'rejected') {
        console.error(`VideoRecorder: Thumbnail generation FAILED for point ${uniqueTimes[idx]}s:`, result.reason);
      } else if (result.status === 'fulfilled' && !result.value) {
         console.warn(`VideoRecorder: Thumbnail generation returned null for point ${uniqueTimes[idx]}s.`);
      }
    });
    
    oldThumbURLs.forEach(url => { if (url) URL.revokeObjectURL(url); });

    while (newUrls.length < NUM_THUMBNAILS_TO_GENERATE) newUrls.push(null);
    while (newBlobs.length < NUM_THUMBNAILS_TO_GENERATE) newBlobs.push(null);

    setPotentialThumbnails(newUrls);
    setPotentialThumbnailBlobs(newBlobs);
    const firstValidIdx = newBlobs.findIndex(b => b !== null);
    setSelectedThumbnailIndex(firstValidIdx !== -1 ? firstValidIdx : null);
    setIsGeneratingThumbnails(false);
    console.log(`VideoRecorder: Thumbnail generation completed. ${newBlobs.filter(b=>b).length} successful.`);
    if (newBlobs.filter(b=>b).length === 0 && !error) { // Only set error if no other error is present
        setError("Failed to generate any thumbnails for this recording.");
    }
  }, [generateSpecificThumbnail, error]); // Added error to dependency array


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
      a.href = recordedVideoUrl; // Use the main preview URL
      const safeTitle = title.replace(/[^a-z0-9_]+/gi, '_').toLowerCase() || 'recorded_video';
      const extension = getFileExtensionFromMimeType(recordedVideoBlob.type || actualMimeTypeRef.current);
      a.download = `${safeTitle}.${extension}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setIsLocallySaved(true);
      setSuccessMessage("Video saved locally! You can now proceed to upload.");
    } else {
        setError("No recorded video available to save.");
    }
  };

  const resetRecorderState = useCallback((backToInitial = true) => {
    console.log("VideoRecorder: resetRecorderState called. backToInitial:", backToInitial);
    setTitle(''); setDescription(''); setKeywords(''); setFeatured(false);
    
    setRecordedVideoBlob(null); // Triggers useEffect for thumbnailGenerationVideoUrl_cleanupRef
    setRecordedVideoUrl(null);  // Triggers useEffect for recordedVideoUrlRef_forCleanup

    // Explicitly revoke potential thumbnails
    potentialThumbnailsRef_forCleanup.current.forEach(url => { if (url) URL.revokeObjectURL(url); });
    potentialThumbnailsRef_forCleanup.current = [];
    setPotentialThumbnails(Array(NUM_THUMBNAILS_TO_GENERATE).fill(null)); 
    setPotentialThumbnailBlobs(Array(NUM_THUMBNAILS_TO_GENERATE).fill(null));
    setSelectedThumbnailIndex(null);
    
    timerSecondsRef.current = 0;
    setDisplayTime(0); 
    actualMimeTypeRef.current = '';
    recordedChunksRef.current = [];
    setIsLocallySaved(false);

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try { mediaRecorderRef.current.stop(); } catch (e) { console.warn("Error stopping mediarecorder during reset:", e); }
    }
    mediaRecorderRef.current = null;
    
    if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
    }
    
    setError(null);
    setSuccessMessage(null);
    setPreviewRotation(0); // Reset rotation

    if (backToInitial) {
      stopMediaStream();
      setRecordingState('initial');
    } else { 
      if (isStreamValid(mediaStreamRef.current) && liveVideoPreviewRef.current) {
        liveVideoPreviewRef.current.srcObject = mediaStreamRef.current;
        liveVideoPreviewRef.current.src = "";
        liveVideoPreviewRef.current.controls = false;
        liveVideoPreviewRef.current.muted = true;
        liveVideoPreviewRef.current.play().catch(e => console.warn("Error re-playing live stream after soft reset:", e));
        setRecordingState('ready');
      } else {
        stopMediaStream(); 
        setRecordingState('initial');
      }
    }
  }, [stopMediaStream, isStreamValid]);

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
      const videoDataForAction: VideoMeta = {
        id: videoId, title, description,
        doctorId: doctorProfile.uid,
        doctorName: doctorProfile.displayName || doctorProfile.email || 'Unknown Doctor',
        videoUrl, thumbnailUrl,
        duration: formatTime(timerSecondsRef.current), // Use accurate timer duration
        recordingDuration: timerSecondsRef.current,   // Use accurate timer duration
        tags: keywords.split(',').map(k => k.trim()).filter(Boolean),
        createdAt: new Date().toISOString(), 
        viewCount: 0, likeCount: 0, commentCount: 0, featured,
        permalink: `/videos/${videoId}`, 
        storagePath: videoStoragePath, thumbnailStoragePath,
        videoSize: recordedVideoBlob.size,
        videoType: recordedVideoBlob.type || actualMimeTypeRef.current,
        comments: [], 
      };

      const result = await addVideoMetadataToFirestore(videoDataForAction);
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

  const handleRotatePreview = () => {
    setPreviewRotation(current => (current + 90) % 360);
  };

  // UI State Visibility
  const showSetupCameraState = recordingState === 'initial' && !successMessage;
  const showLiveRecordControls = recordingState === 'ready' && !successMessage;
  const showRecordingInProgress = recordingState === 'recording';
  const showReviewAndUpload = (recordingState === 'stopped' || (recordingState === 'error' && recordedVideoBlob)) && !successMessage;
  const showUploadingProgress = recordingState === 'uploading';
  const showSuccessMessageState = recordingState === 'success' && successMessage;


  if (!isAdmin && typeof window !== 'undefined' && !user) { // Auth loading check
    return <div className="flex items-center justify-center h-full"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  }
  if (!isAdmin && typeof window !== 'undefined' && user) { // Not admin but logged in
    return (<Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertTitle>Access Denied</AlertTitle><AlertDescription>You must be an administrator to access the video recorder.</AlertDescription></Alert>);
  }


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
            {/* Live Preview Video Element */}
            <video
              ref={liveVideoPreviewRef}
              className={`w-full h-full object-contain bg-black transition-transform duration-300 ease-in-out ${recordingState === 'ready' || recordingState === 'recording' ? 'block' : 'hidden'}`}
              style={{ transform: `rotate(${previewRotation}deg)` }}
              playsInline
              muted
              autoPlay
            />
            {/* Recorded Video Preview Element */}
            <video
              ref={recordedVideoPreviewRef}
              className={`w-full h-full object-contain bg-black transition-transform duration-300 ease-in-out ${recordingState === 'stopped' && recordedVideoUrl ? 'block' : 'hidden'}`}
              style={{ transform: `rotate(${previewRotation}deg)` }}
              playsInline
              controls
              // autoPlay // Let user initiate play for recorded preview
            />
            {/* Placeholder for initial and permission states */}
            {(recordingState === 'initial' || recordingState === 'permission') && !showSetupCameraState && (
                 <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center bg-black/70">
                    {recordingState === 'permission' && <Loader2 className="h-12 w-12 animate-spin text-white mb-4" />}
                    <Camera size={56} className={`text-slate-400 mb-4 ${recordingState === 'permission' ? 'hidden' : 'block'}`} />
                    <p className="text-slate-300 text-lg">
                        {recordingState === 'permission' ? 'Requesting camera permissions...' : 'Video recorder is idle.'}
                    </p>
                 </div>
            )}


            {/* Rotate Button - visible when any video feed is active */}
            {(recordingState === 'ready' || recordingState === 'recording' || (recordingState === 'stopped' && recordedVideoUrl)) && (
              <Button onClick={handleRotatePreview} variant="outline" size="icon" className="absolute top-4 left-4 z-10 bg-black/50 text-white hover:bg-black/70 border-white/50 opacity-0 group-hover:opacity-100 transition-opacity" title="Rotate Preview">
                <RotateCw size={20} />
              </Button>
            )}
            {showRecordingInProgress && (
              <div className="absolute top-4 right-4 bg-red-600 text-white px-3 py-1.5 rounded-lg text-sm font-mono shadow-lg flex items-center gap-2">
                <Mic size={18} className="animate-pulse" /> REC {formatTime(displayTime)}
              </div>
            )}
            {recordingState === 'stopped' && recordedVideoUrl && (
              <div className="absolute top-4 right-4 bg-blue-600 text-white px-3 py-1.5 rounded-lg text-sm font-mono shadow-lg">
                REVIEWING - {formatTime(timerSecondsRef.current)}
              </div>
            )}
             {showSetupCameraState && (
              <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center bg-black/50">
                <Camera size={56} className="text-slate-300 mb-4" />
                <p className="text-slate-200 mb-6 text-lg">Camera and microphone access needed.</p>
                <Button onClick={requestPermissionsAndSetup} variant="default" size="lg" className="gap-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg text-base px-6 py-3">
                  <Settings2 className="h-5 w-5" /> Setup Camera & Mic
                </Button>
              </div>
            )}
          </div>
        </CardContent>
        <CardFooter className="pt-6 pb-6 bg-slate-50 dark:bg-slate-800/50 border-t dark:border-slate-700 flex flex-col sm:flex-row gap-4 items-center justify-center">
          {showLiveRecordControls && (
            <Button onClick={startRecording} className="gap-2 bg-green-500 hover:bg-green-600 text-white w-full sm:w-auto rounded-lg px-6 py-3 text-base" size="lg">
              <Play className="h-5 w-5" /> Start Recording
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
           {(recordingState === 'ready' || recordingState === 'stopped' || recordingState === 'error') && !showSuccessMessageState && !showSetupCameraState && (
             <Button onClick={() => resetRecorderState(true)} variant="outline" className="gap-2 w-full sm:w-auto rounded-lg text-base px-5 py-2.5">
                <RefreshCcw className="h-5 w-5" /> Reset Camera
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
                          key={thumbUrl} // Use URL as key for stability if reordering is not an issue
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
                    <AlertTitle>Thumbnails Unavailable or Failed</AlertTitle>
                    <AlertDescription>
                        {error && error.includes("thumbnail") ? error : "Thumbnails could not be generated for this recording, or the recording was too short. You can still proceed to save and upload. A default thumbnail might be used or you can update it later."}
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
                disabled={!recordedVideoBlob || isLocallySaved}
            >
              <Download className="h-5 w-5" /> {isLocallySaved ? "Saved Locally" : "Save Locally" }
            </Button>
            <Button
              type="submit"
              form="upload-form-video-recorder"
              disabled={!recordedVideoBlob || selectedThumbnailIndex === null || !title.trim() || recordingState === 'uploading'}
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

