
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
import { addVideoMetadataToFirestore } from './actions'; // Corrected import
import { Video, Mic, Square, Download, UploadCloud, AlertCircle, CheckCircle, Loader2, Settings2, Camera, Film, RefreshCcw, RotateCw, Image as ImageIcon, Play } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import type { VideoMeta } from '@/types';
import { useRouter } from 'next/navigation';
import NextImage from 'next/image';
import { useToast } from '@/hooks/use-toast';


type RecordingState = 'initial' | 'permission' | 'ready' | 'recording' | 'stopped' | 'uploading' | 'success' | 'error';

const MAX_RECORDING_TIME_MS = 30 * 60 * 1000; // 30 minutes
const NUM_THUMBNAILS_TO_GENERATE = 5;
const RECORDING_TIMESLICE_MS = 1000; // How often ondataavailable fires
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
  const [recordedVideoUrl, setRecordedVideoUrl] = useState<string | null>(null); // For main preview of recorded video
  const recordedVideoUrlRef_forCleanup = useRef<string | null>(null); // To manage URL.revokeObjectURL

  const thumbnailGenerationVideoUrl_cleanupRef = useRef<string | null>(null); // Separate URL for thumbnail gen

  const [potentialThumbnails, setPotentialThumbnails] = useState<(string | null)[]>(Array(NUM_THUMBNAILS_TO_GENERATE).fill(null));
  const potentialThumbnailsRef_forCleanup = useRef<(string | null)[]>([]);
  const [potentialThumbnailBlobs, setPotentialThumbnailBlobs] = useState<(Blob | null)[]>(Array(NUM_THUMBNAILS_TO_GENERATE).fill(null));
  const [selectedThumbnailIndex, setSelectedThumbnailIndex] = useState<number | null>(null);

  const [isGeneratingThumbnails, setIsGeneratingThumbnails] = useState(false);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false); // For recorded preview
  const previewLoadTimerRef = useRef<NodeJS.Timeout | null>(null);

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
  // Key for the video element to help React re-mount it when source type changes fundamentally
  const [videoElementKey, setVideoElementKey] = useState('initial-key-' + Date.now());


  const isStreamValid = useCallback((stream: MediaStream | null): stream is MediaStream => {
    if (!stream) { console.warn("VideoRecorder (isStreamValid): Stream is null or undefined."); return false; }
    if (!(stream instanceof MediaStream)) { console.warn("VideoRecorder (isStreamValid): Provided object is not an instance of MediaStream."); return false; }
    if (!stream.active) { console.warn("VideoRecorder (isStreamValid): Stream is not active."); return false; }
    if (stream.getTracks().length === 0) { console.warn("VideoRecorder (isStreamValid): Stream has no tracks."); return false; }
    const videoTrack = stream.getVideoTracks()[0];
    if (!videoTrack) { console.warn("VideoRecorder (isStreamValid): Stream has no video tracks."); return false; }
    if (videoTrack.readyState !== 'live') { console.warn(`VideoRecorder (isStreamValid): Video track is not live. State: ${videoTrack.readyState}`); return false; }
    // console.log("VideoRecorder (isStreamValid): Stream appears to be valid and active.");
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
      if (recordedVideoUrlRef_forCleanup.current) URL.revokeObjectURL(recordedVideoUrlRef_forCleanup.current);
      if (thumbnailGenerationVideoUrl_cleanupRef.current) URL.revokeObjectURL(thumbnailGenerationVideoUrl_cleanupRef.current);
      potentialThumbnailsRef_forCleanup.current.forEach(url => { if (url) URL.revokeObjectURL(url); });
    };
  }, [isAdmin, user, router, stopMediaStream]);


  useEffect(() => {
    const oldUrl = recordedVideoUrlRef_forCleanup.current;
    if (recordedVideoUrl) { // If a new URL is set for the main recorded preview
        recordedVideoUrlRef_forCleanup.current = recordedVideoUrl;
    }
    return () => {
      if (oldUrl && oldUrl !== recordedVideoUrl) { // Clean up old URL only if it's different from new
        console.log("VideoRecorder: useEffect[recordedVideoUrl] cleanup - revoking old recordedVideoUrl:", oldUrl.substring(0,50));
        URL.revokeObjectURL(oldUrl);
      }
    };
  }, [recordedVideoUrl]);

  useEffect(() => {
    const oldThumbs = [...potentialThumbnailsRef_forCleanup.current];
    potentialThumbnailsRef_forCleanup.current = [...potentialThumbnails.filter(t => t !== null) as string[]];
    return () => {
      oldThumbs.forEach((url, index) => {
        if (url) {
          // console.log(`VideoRecorder: useEffect[potentialThumbnails related] cleanup - revoking old thumb ${index}:`, url.substring(0,50));
          URL.revokeObjectURL(url);
        }
      });
    };
  }, [potentialThumbnails]);

  useEffect(() => {
    // Cleanup thumbnail generation specific URL when recorded blob is gone
    const currentThumbGenUrl = thumbnailGenerationVideoUrl_cleanupRef.current;
    if (!recordedVideoBlob && currentThumbGenUrl) {
        // console.log("VideoRecorder: useEffect[recordedVideoBlob related] cleanup - revoking thumbnailGenerationVideoUrl:", currentThumbGenUrl.substring(0,50));
        URL.revokeObjectURL(currentThumbGenUrl);
        thumbnailGenerationVideoUrl_cleanupRef.current = null;
    }
    // No return needed here as we are modifying a ref, not returning a cleanup for this specific effect's prior state.
  }, [recordedVideoBlob]);


  const generateSpecificThumbnail = useCallback((videoObjectUrlForThumbs: string, time: number, index: number): Promise<{ blob: Blob; blobUrl: string } | null> => {
    return new Promise((resolve) => {
      // console.log(`VideoRecorder: generateSpecificThumbnail - Idx ${index}, Time ${time}s`);
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
          // console.log(`VideoRecorder: Thumb[${index}] metadata. Duration: ${videoElement.duration}s. Dims: ${videoElement.videoWidth}x${videoElement.videoHeight}. ReadyState: ${videoElement.readyState}. Seeking to ${time}s.`);
          const seekTime = Math.max(0.01, Math.min(time, (videoElement.duration > 0 && Number.isFinite(videoElement.duration)) ? videoElement.duration - 0.01 : time));
          videoElement.currentTime = seekTime;
          if (videoElement.readyState >= 2 && !seekedFired) { // HTMLMediaElement.HAVE_CURRENT_DATA or more
             await new Promise(r => setTimeout(r, 100)); // Short delay for browser to process seek
             if (videoElement.readyState >= 2) captureFrame(); else console.log(`Thumb[${index}] readyState < 2 after delay, deferring to seeked.`);
          } else if (!seekedFired) {
            // console.log(`VideoRecorder: Thumb[${index}] readyState < 2 (${videoElement.readyState}) after seek attempt, waiting for 'seeked'.`);
          }
      };
      const onSeeked = () => {
          if (resolved || seekedFired || !metadataLoaded) return; seekedFired = true;
          // console.log(`VideoRecorder: Thumb[${index}] seeked to ${videoElement.currentTime}s. Capturing frame.`);
          captureFrame();
      };
      const onErrorHandler = (e: Event | string) => { console.error(`VideoRecorder: Thumb[${index}] video error:`, videoElement.error, e); cleanupAndResolve(null); };

      videoElement.addEventListener('loadedmetadata', onMetadata);
      videoElement.addEventListener('seeked', onSeeked);
      videoElement.addEventListener('error', onErrorHandler);
      videoElement.load(); // Necessary to trigger loading
    });
  }, []);

  const generatePotentialThumbnails = useCallback(async (videoBlobUrlForThumbs: string | null, durationToUse: number) => {
    if (!videoBlobUrlForThumbs) {
      setError("Video data for thumbnails is missing.");
      setIsGeneratingThumbnails(false); return;
    }
    if (!(durationToUse > 0 && Number.isFinite(durationToUse))) {
      setError("Recording was too short or duration invalid. Thumbnails cannot be generated.");
      setIsGeneratingThumbnails(false); setPotentialThumbnails(Array(NUM_THUMBNAILS_TO_GENERATE).fill(null)); setPotentialThumbnailBlobs(Array(NUM_THUMBNAILS_TO_GENERATE).fill(null)); return;
    }
    console.log(`VideoRecorder: Generating thumbnails. Duration: ${durationToUse}s`);
    setIsGeneratingThumbnails(true);

    const oldThumbsToRevoke = [...potentialThumbnailsRef_forCleanup.current]; // Capture current state for cleanup
    setPotentialThumbnails(Array(NUM_THUMBNAILS_TO_GENERATE).fill(null)); // Clear UI immediately
    setPotentialThumbnailBlobs(Array(NUM_THUMBNAILS_TO_GENERATE).fill(null));

    let timePoints: number[];
     if (durationToUse < 1) { // Very short video
        timePoints = [durationToUse / 2, Math.min(durationToUse * 0.9, durationToUse - 0.01)].filter(t => t > 0.01).slice(0, NUM_THUMBNAILS_TO_GENERATE);
        if(timePoints.length === 0 && durationToUse > 0.01) timePoints = [durationToUse * 0.5]; // At least one point if possible
    } else {
        timePoints = Array(NUM_THUMBNAILS_TO_GENERATE).fill(null).map((_, i) => {
            const point = (durationToUse / (NUM_THUMBNAILS_TO_GENERATE + 1)) * (i + 1);
            return Math.max(0.01, Math.min(point, durationToUse - 0.01)); // Ensure within valid range
        });
    }
    const uniqueTimes = [...new Set(timePoints)].filter(t => Number.isFinite(t) && t > 0).slice(0, NUM_THUMBNAILS_TO_GENERATE);

    if (uniqueTimes.length === 0) {
        setError("Could not determine valid points for thumbnails. Video might be too short.");
        setIsGeneratingThumbnails(false);
        oldThumbsToRevoke.forEach(url => { if (url) URL.revokeObjectURL(url); }); // Clean up old
        potentialThumbnailsRef_forCleanup.current = []; // Reset cleanup ref
        return;
    }

    const settledResults = await Promise.allSettled(uniqueTimes.map((time, index) => generateSpecificThumbnail(videoBlobUrlForThumbs, time, index)));
    const newUrls: (string | null)[] = []; const newBlobs: (Blob | null)[] = [];
    let successfulGenerations = 0;
    settledResults.forEach((result, idx) => {
      if (result.status === 'fulfilled' && result.value) {
        // console.log(`VideoRecorder: Thumbnail generation success for point ${uniqueTimes[idx]}s`);
        newUrls.push(result.value.blobUrl); newBlobs.push(result.value.blob);
        successfulGenerations++;
      } else { console.error(`VideoRecorder: Thumbnail generation FAILED for point ${uniqueTimes[idx]}s:`, result.status === 'rejected' ? result.reason : 'null result'); }
    });
    
    oldThumbsToRevoke.forEach(url => { if (url) URL.revokeObjectURL(url); }); // Cleanup previously generated ones
    potentialThumbnailsRef_forCleanup.current = [...newUrls.filter(url => url !== null) as string[]]; // Update cleanup ref with new valid URLs

    while (newUrls.length < NUM_THUMBNAILS_TO_GENERATE) newUrls.push(null); // Pad arrays for UI
    while (newBlobs.length < NUM_THUMBNAILS_TO_GENERATE) newBlobs.push(null);

    setPotentialThumbnails(newUrls); setPotentialThumbnailBlobs(newBlobs);
    const firstValidIdx = newBlobs.findIndex(b => b !== null); setSelectedThumbnailIndex(firstValidIdx !== -1 ? firstValidIdx : null);
    setIsGeneratingThumbnails(false);
    console.log(`VideoRecorder: Thumbnail generation completed. ${successfulGenerations} successful.`);
    if (successfulGenerations === 0 && !error) { setError("Failed to generate any thumbnails. The video might be too short or incompatible."); }
  }, [generateSpecificThumbnail, error]);


  // Effect to handle playing live stream when state is 'ready'
  useEffect(() => {
    if (recordingState === 'ready' && mediaStreamRef.current && videoPreviewRef.current) {
      const videoElement = videoPreviewRef.current;
      // Ensure srcObject is correctly set if it was somehow cleared or changed
      if (videoElement.srcObject !== mediaStreamRef.current) {
          videoElement.srcObject = mediaStreamRef.current;
          videoElement.src = ""; // Clear any blob src
          videoElement.muted = true;
          videoElement.controls = false;
      }
      
      console.log("VideoRecorder: Attempting to play live preview as state is 'ready'.");
      videoElement.play()
        .then(() => {
          console.log("VideoRecorder: Live preview playing successfully.");
        })
        .catch((playError: any) => {
          console.error("VideoRecorder: Error playing live preview in 'ready' state useEffect:", playError.name, playError.message);
          setError(`Failed to start camera preview: ${playError.message}. Check console for details.`);
          stopMediaStream();
          setRecordingState('initial');
        });
    }
  }, [recordingState, stopMediaStream]); // Runs when recordingState changes

  // Effect to handle setting up and playing recorded video preview
  useEffect(() => {
    if (recordedVideoBlob && videoPreviewRef.current && recordingState === 'stopped') {
      const videoElement = videoPreviewRef.current;
      const objectUrl = URL.createObjectURL(recordedVideoBlob);
      console.log("VideoRecorder: useEffect[recordedVideoBlob] - Created object URL for recorded preview:", objectUrl.substring(0,50));
      setRecordedVideoUrl(objectUrl); // This will also update recordedVideoUrlRef_forCleanup via its own effect

      // Detach live stream
      videoElement.srcObject = null;
      videoElement.src = objectUrl;
      videoElement.muted = false;
      videoElement.controls = true;
      // videoElementKey is updated here to force re-mount for recorded content
      setVideoElementKey('recorded-preview-' + Date.now());


      let loadedMetadataListener: () => void;
      let errorListener: (e: Event) => void;
      let canPlayListener: () => void;

      const cleanupListeners = () => {
        if (previewLoadTimerRef.current) clearTimeout(previewLoadTimerRef.current);
        if (loadedMetadataListener) videoElement.removeEventListener('loadedmetadata', loadedMetadataListener);
        if (errorListener) videoElement.removeEventListener('error', errorListener);
        if (canPlayListener) videoElement.removeEventListener('canplay', canPlayListener);
      };
      
      loadedMetadataListener = async () => {
        console.log("VideoRecorder: Recorded preview metadata loaded. Element duration:", videoElement.duration, "Timer duration:", timerSecondsRef.current, "s.");
        setIsPreviewLoading(true); // Keep loading until canplay or timeout
        // Don't play yet, wait for canplay
      };

      canPlayListener = async () => {
        cleanupListeners();
        setIsPreviewLoading(false);
        console.log("VideoRecorder: Recorded preview 'canplay' event. Attempting to play.");
        videoElement.play().catch(err => {
          console.error("VideoRecorder: Error playing recorded preview (canplay):", err.name, err.message);
          setError(`Preview Error: Could not play recorded video. (${err.name || 'MediaError'}). Try local save.`);
        });
        
        // Generate thumbnails now that the main preview is considered ready
        const thumbGenUrl = URL.createObjectURL(recordedVideoBlob.slice());
        if (thumbnailGenerationVideoUrl_cleanupRef.current) URL.revokeObjectURL(thumbnailGenerationVideoUrl_cleanupRef.current);
        thumbnailGenerationVideoUrl_cleanupRef.current = thumbGenUrl;
        await generatePotentialThumbnails(thumbGenUrl, timerSecondsRef.current);
      };

      errorListener = async (e: Event) => {
        cleanupListeners();
        setIsPreviewLoading(false);
        const videoError = videoElement.error;
        console.error("VideoRecorder: Error loading recorded video in preview (onerror). Event:", e, "VideoError:", videoError);
        setError(`Preview Error: ${videoError?.message || 'Media error'}. Code: ${videoError?.code}. Try local save.`);
        
        // Still attempt thumbnail generation if recording was made
        if (timerSecondsRef.current > 0) {
            const thumbGenUrl = URL.createObjectURL(recordedVideoBlob.slice());
            if (thumbnailGenerationVideoUrl_cleanupRef.current) URL.revokeObjectURL(thumbnailGenerationVideoUrl_cleanupRef.current);
            thumbnailGenerationVideoUrl_cleanupRef.current = thumbGenUrl;
            await generatePotentialThumbnails(thumbGenUrl, timerSecondsRef.current);
        }
      };

      videoElement.addEventListener('loadedmetadata', loadedMetadataListener);
      videoElement.addEventListener('canplay', canPlayListener);
      videoElement.addEventListener('error', errorListener);
      
      videoElement.load(); // Important to trigger loading of the new src
      setIsPreviewLoading(true);

      if (previewLoadTimerRef.current) clearTimeout(previewLoadTimerRef.current);
      previewLoadTimerRef.current = setTimeout(async () => {
        console.warn("VideoRecorder: Recorded preview loading timed out.");
        if (isPreviewLoading) { // Only act if still loading (canplay or error hasn't fired)
            cleanupListeners();
            setIsPreviewLoading(false);
            setError("Preview Error: Timed out waiting for video to load. Please try saving locally to verify.");
            if (timerSecondsRef.current > 0 && recordedVideoBlob) { // Ensure recordedVideoBlob is still current
                const thumbGenUrl = URL.createObjectURL(recordedVideoBlob.slice());
                if (thumbnailGenerationVideoUrl_cleanupRef.current) URL.revokeObjectURL(thumbnailGenerationVideoUrl_cleanupRef.current);
                thumbnailGenerationVideoUrl_cleanupRef.current = thumbGenUrl;
                await generatePotentialThumbnails(thumbGenUrl, timerSecondsRef.current);
            }
        }
      }, PREVIEW_LOAD_TIMEOUT_MS);
      
      return () => { // Cleanup for this useEffect instance
        cleanupListeners();
        // The recordedVideoUrl itself is cleaned up by its own useEffect for recordedVideoUrl state
      };
    }
  }, [recordedVideoBlob, recordingState, generatePotentialThumbnails]);


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
        console.error("VideoRecorder: Acquired stream is not valid after getUserMedia.");
        stream?.getTracks().forEach(track => track.stop());
        throw new Error("Acquired camera stream is not active or valid.");
      }
      
      mediaStreamRef.current = stream;
      console.log("VideoRecorder: Media permissions granted, stream in ref. Setting state to 'ready'.");
      // Update key to ensure video element can pick up new srcObject if it was previously used for blob
      setVideoElementKey('live-preview-' + Date.now()); 
      setRecordingState('ready'); // This will trigger the useEffect to set srcObject and play
      
    } catch (err: any) {
      console.error("VideoRecorder: Error in requestPermissionsAndSetup:", err.name, err.message);
      setError(`Failed to set up camera: ${err.message}. Please check permissions and ensure no other app is using the camera.`);
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
      'video/webm;codecs=vp8,opus', // Prioritize VP8 for broader compatibility
      'video/webm;codecs=vp9,opus',
      'video/webm',
      'video/mp4;codecs=avc1.42E01E', // H.264
      'video/mp4',
    ];
    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) {
        console.log("VideoRecorder: Using MIME type:", type);
        return type;
      }
    }
    console.warn("VideoRecorder: No preferred MIME type supported, returning empty string (browser will choose default).");
    return ''; 
  };

  const startRecording = async () => {
    console.log("VideoRecorder: Attempting to start recording...");
    if (recordingState !== 'ready' || !isStreamValid(mediaStreamRef.current)) {
      setError("Camera not ready or stream invalid. Please set up the camera first.");
      if (!isStreamValid(mediaStreamRef.current)) requestPermissionsAndSetup(); // Try to re-setup
      return;
    }
    console.log("VideoRecorder: Stream validation passed for startRecording.");
    
    setError(null); setSuccessMessage(null); setIsLocallySaved(false);
    recordedChunksRef.current = []; setRecordedVideoBlob(null); setRecordedVideoUrl(null);

    if(videoPreviewRef.current && videoPreviewRef.current.srcObject !== mediaStreamRef.current) {
        console.warn("VideoRecorder: srcObject mismatch before recording, re-assigning live stream.");
        videoPreviewRef.current.srcObject = mediaStreamRef.current;
        videoPreviewRef.current.src = "";
        videoPreviewRef.current.muted = true;
        videoPreviewRef.current.controls = false;
        try {
            await videoPreviewRef.current.play();
        } catch(e) {
            console.error("VideoRecorder: Error re-playing live preview for recording:", e);
        }
    }


    timerSecondsRef.current = 0;
    setDisplayTime(0); // Reset display timer
    actualMimeTypeRef.current = '';


    const chosenMimeType = getSupportedMimeType();
    const options: MediaRecorderOptions = {};
    if (chosenMimeType) options.mimeType = chosenMimeType;
    console.log("VideoRecorder: MediaRecorder options:", options);

    try {
      console.log("VideoRecorder: Instantiating MediaRecorder.");
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
      setDisplayTime(0); 
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
      const finalRecordedDuration = timerSecondsRef.current; // Capture before any async ops
      console.log(`VideoRecorder: MediaRecorder.onstop. Chunks: ${recordedChunksRef.current.length}. Timer Duration: ${finalRecordedDuration}s`);
      if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }

      // It's crucial that stopMediaStream() is NOT called here if we want to allow "record another"
      // without re-requesting permissions. We only stop tracks when fully resetting.

      const currentMimeType = actualMimeTypeRef.current || mediaRecorderRef.current?.mimeType || 'video/webm';
      const blob = new Blob(recordedChunksRef.current, { type: currentMimeType });
      console.log(`VideoRecorder: Blob created. Size: ${blob.size}, Type: ${blob.type}`);

      if (blob.size === 0) {
        setError("Recorded video is empty. Please try recording again.");
        setRecordingState('ready'); return;
      }
      
      setRecordedVideoBlob(blob); // This will trigger the useEffect for recorded blob processing
      setRecordingState('stopped'); // This state change is important for the useEffect
    };

    mediaRecorderRef.current.onerror = (event: Event) => {
      const mrError = event as any; // Cast to any to access potential 'error' property
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
      mediaRecorderRef.current.stop(); // This will trigger onstop
    } else {
      console.warn(`VideoRecorder: stopRecording called but recorder not in 'recording' state. Current state: ${mediaRecorderRef.current?.state}`);
      if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
      if(recordingState === 'recording') setRecordingState('stopped'); // Force state if needed
    }
  };


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
      // Use the main recordedVideoUrl if available, otherwise create a temp one
      const urlToSave = recordedVideoUrl || URL.createObjectURL(recordedVideoBlob); 
      const a = document.createElement('a');
      a.href = urlToSave;
      const safeTitle = title.replace(/[^a-z0-9_]+/gi, '_').toLowerCase() || 'recorded_video';
      const extension = getFileExtensionFromMimeType(recordedVideoBlob.type || actualMimeTypeRef.current);
      a.download = `${safeTitle}_${Date.now()}.${extension}`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);

      if (!recordedVideoUrl) URL.revokeObjectURL(urlToSave); // Only revoke if it was temp and not the main state one

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
    if (thumbnailGenerationVideoUrl_cleanupRef.current) { URL.revokeObjectURL(thumbnailGenerationVideoUrl_cleanupRef.current); thumbnailGenerationVideoUrl_cleanupRef.current = null; }

    setRecordedVideoBlob(null); // This will trigger its useEffect cleanup for recordedVideoUrl
    setRecordedVideoUrl(null); 

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
    if (previewLoadTimerRef.current) clearTimeout(previewLoadTimerRef.current);
    setPreviewRotation(0);

    if (videoPreviewRef.current) { // Clear the single video element
        videoPreviewRef.current.srcObject = null;
        videoPreviewRef.current.src = "";
        videoPreviewRef.current.controls = false;
        videoPreviewRef.current.muted = true;
    }

    if (backToInitial) {
      stopMediaStream(); // This will also nullify mediaStreamRef.current
      setVideoElementKey('initial-key-' + Date.now()); // Force re-mount for freshness
      setRecordingState('initial');
    } else {
      // Soft reset: attempt to go back to 'ready' if stream was kept (it isn't by default with stopMediaStream)
      // This logic path needs re-evaluation if we want to keep the stream for "record another" without re-permissioning
      // For now, a soft reset effectively becomes a full reset if stream is stopped.
      // To keep stream: DON'T call stopMediaStream(). Check if mediaStreamRef.current is still valid.
      if (mediaStreamRef.current && isStreamValid(mediaStreamRef.current) && videoPreviewRef.current) {
        console.log("VideoRecorder: Soft reset - reusing existing media stream.");
        setVideoElementKey('live-preview-' + Date.now()); // Refresh key for live
        setRecordingState('ready'); // Trigger useEffect for playing live stream
      } else {
        console.log("VideoRecorder: Soft reset - media stream not available or invalid, performing full reset.");
        stopMediaStream();
        setVideoElementKey('initial-key-' + Date.now());
        setRecordingState('initial');
      }
    }
  }, [stopMediaStream, isStreamValid]);

  const handleUpload = async (event: FormEvent) => {
    event.preventDefault();
    const currentVideoId = uuidv4(); // Generate ID for this upload attempt
    console.log("[VideoRecorder:handleUpload] Generated currentVideoId for this upload:", currentVideoId);

    if (selectedThumbnailIndex === null || !potentialThumbnailBlobs[selectedThumbnailIndex!]) {
      setError("Please select a valid thumbnail before uploading."); return;
    }
    const selectedThumbnailBlob = potentialThumbnailBlobs[selectedThumbnailIndex!];
    if (!recordedVideoBlob || !selectedThumbnailBlob || !user || !doctorProfile) {
      setError("Missing video data, thumbnail, or user info. Please ensure you are logged in and have a doctor profile."); return;
    }
    if (!title.trim()) { setError("Video title is required."); return; }

    const videoDataForAction: Omit<VideoMeta, 'createdAt' | 'permalink' | 'viewCount' | 'likeCount' | 'commentCount' | 'comments'> = {
      id: currentVideoId, // Use the generated ID
      title,
      description,
      doctorId: doctorProfile.uid,
      doctorName: doctorProfile.displayName || doctorProfile.email || 'Unknown Doctor',
      videoUrl: '', 
      thumbnailUrl: '',
      duration: formatTime(timerSecondsRef.current), // Use accurate timer duration
      recordingDuration: timerSecondsRef.current, // Use accurate timer duration
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
      const safeTitleForFile = title.replace(/[^a-z0-9_]+/gi, '_').toLowerCase() || currentVideoId;
      const timestamp = Date.now();
      const videoExtension = getFileExtensionFromMimeType(recordedVideoBlob.type || actualMimeTypeRef.current);
      const videoFileName = `${safeTitleForFile}_${timestamp}.${videoExtension}`;
      const thumbnailFileName = `thumbnail_${safeTitleForFile}_${timestamp}.jpg`;

      const videoStoragePath = await uploadFileToStorage(
        `videos/${doctorProfile.uid}`, recordedVideoBlob, videoFileName,
        (s) => setUploadProgress(Math.round((s.bytesTransferred / s.totalBytes) * 0.9 * 100))
      );
      const uploadedVideoUrl = await getFirebaseStorageDownloadUrl(videoStoragePath);
      setUploadProgress(90);

      const thumbnailStoragePath = await uploadFileToStorage(
        `thumbnails/${doctorProfile.uid}`, selectedThumbnailBlob, thumbnailFileName,
        (s) => setUploadProgress(Math.round(90 + (s.bytesTransferred / s.totalBytes) * 0.1 * 100))
      );
      const uploadedThumbnailUrl = await getFirebaseStorageDownloadUrl(thumbnailStoragePath);
      setUploadProgress(100);

      // Update the videoDataForAction with actual URLs and paths
      const finalVideoDataForAction = {
        ...videoDataForAction, // already has the correct id
        videoUrl: uploadedVideoUrl,
        thumbnailUrl: uploadedThumbnailUrl,
        storagePath: videoStoragePath,
        thumbnailStoragePath: thumbnailStoragePath,
      };

      console.log("[VideoRecorder:handleUpload] Final videoData object being sent to server action:", JSON.stringify(finalVideoDataForAction, null, 2));
      // Ensure addVideoMetadataToFirestore expects 'id', not 'videoId' in its direct param if VideoDataForFirestore type was changed
      const result = await addVideoMetadataToFirestore(finalVideoDataForAction); 

      if (result.success) {
        setSuccessMessage("Video uploaded successfully and metadata saved!");
        setRecordingState('success');
        resetRecorderState(false); // Soft reset, attempt to keep camera stream for "record another"
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

  // UI Visibility Flags
  const showSetupCameraState = recordingState === 'initial';
  // Video player display logic: Show if ready for live, recording, or if recorded video URL exists and stopped/success/error
  const showVideoPlayer = recordingState === 'ready' || recordingState === 'recording' || (recordingState === 'stopped' && recordedVideoUrl) || recordingState === 'success' || recordingState === 'error';
  
  const showLiveRecordControls = recordingState === 'ready';
  const showRecordingInProgressControls = recordingState === 'recording';
  const showReviewAndUploadControls = recordingState === 'stopped' && recordedVideoBlob;
  const showUploadingProgress = recordingState === 'uploading';
  const showSuccessMessageState = recordingState === 'success' && successMessage;
  // Show reset button if not initial, not actively recording/uploading, and not in permission phase
  const showResetCameraButton = !['initial', 'recording', 'uploading', 'permission'].includes(recordingState) && !showSuccessMessageState;
  const showRecordAnotherButton = showSuccessMessageState;


  if (!isAdmin && typeof window !== 'undefined' && !user) { // Auth check
    return <div className="flex items-center justify-center h-full"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  }
  if (!isAdmin && typeof window !== 'undefined' && user) {
    return (<Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertTitle>Access Denied</AlertTitle><AlertDescription>You must be an administrator to access this feature.</AlertDescription></Alert>);
  }

  return (
    <div className="space-y-6">
      {error && !successMessage && ( /* General error display */
        <Alert variant="destructive" className="w-full">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {successMessage && ( /* Success message display */
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
                // Show video element if it's supposed to display live or recorded video
                (recordingState === 'ready' || recordingState === 'recording' || (recordingState === 'stopped' && recordedVideoUrl) || (recordingState === 'permission' && mediaStreamRef.current) ) ? 'block' : 'hidden'
              }`}
              style={{ transform: `rotate(${previewRotation}deg)` }}
              playsInline // Important for mobile
              // Muted for live preview, unmuted for recorded playback
              muted={recordingState !== 'stopped'}
              // Controls only for recorded playback
              controls={recordingState === 'stopped' && !!recordedVideoUrl}
            />
            
            {/* Placeholder / Status Overlay */}
            {(recordingState === 'initial' || (recordingState === 'permission' && !mediaStreamRef.current && !error) ) && (
                 <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center bg-black/70">
                    {recordingState === 'initial' && <Camera size={56} className="text-slate-400 mb-4" />}
                    {recordingState === 'permission' && <Loader2 className="h-12 w-12 animate-spin text-white mb-4" />}
                    <p className="text-slate-300 text-lg">
                      {recordingState === 'initial' ? 'Click "Setup Camera & Mic" to begin.' : 'Requesting camera permissions...'}
                    </p>
                 </div>
            )}
            {isPreviewLoading && recordingState === 'stopped' && ( /* Loading for recorded preview */
                <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center bg-black/70">
                    <Loader2 className="h-12 w-12 animate-spin text-white mb-4" />
                    <p className="text-slate-300 text-lg">Loading recorded preview...</p>
                </div>
            )}

            {/* Rotate button always available if video is potentially visible */}
            {(recordingState !== 'initial' && recordingState !== 'permission' || mediaStreamRef.current) && (
              <Button onClick={handleRotatePreview} variant="outline" size="icon" className="absolute top-4 left-4 z-10 bg-black/50 text-white hover:bg-black/70 border-white/50 opacity-0 group-hover:opacity-100 transition-opacity" title="Rotate Preview">
                <RotateCw size={20} />
              </Button>
            )}
            {recordingState === 'recording' && ( /* REC indicator */
              <div className="absolute top-4 right-4 bg-red-600 text-white px-3 py-1.5 rounded-lg text-sm font-mono shadow-lg flex items-center gap-2">
                <Mic size={18} className="animate-pulse" /> REC {formatTime(displayTime)}
              </div>
            )}
          </div>
        </CardContent>
        <CardFooter className="pt-6 pb-6 bg-slate-50 dark:bg-slate-800/50 border-t dark:border-slate-700 flex flex-col sm:flex-row gap-4 items-center justify-center">
          {showSetupCameraState && ( /* "Setup Camera" button */
            <Button onClick={requestPermissionsAndSetup} variant="default" size="lg" className="gap-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg text-base px-6 py-3">
              <Settings2 className="h-5 w-5" /> Setup Camera &amp; Mic
            </Button>
          )}
          {showLiveRecordControls && ( /* "Start Recording" button */
            <Button onClick={startRecording} className="gap-2 bg-green-500 hover:bg-green-600 text-white w-full sm:w-auto rounded-lg px-6 py-3 text-base" size="lg" disabled={recordingState !== 'ready'}>
              <Play className="h-5 w-5" /> Start Recording
            </Button>
          )}
          {showRecordingInProgressControls && ( /* "Stop Recording" button */
            <Button onClick={stopRecording} variant="destructive" className="gap-2 w-full sm:w-auto rounded-lg px-6 py-3 text-base" size="lg">
              <Square className="h-5 w-5" /> Stop Recording
            </Button>
          )}
          {showRecordAnotherButton && ( /* "Record Another" button */
            <Button onClick={() => resetRecorderState(false)} className="gap-2 bg-blue-500 hover:bg-blue-600 text-white w-full sm:w-auto rounded-lg px-6 py-3 text-base" size="lg">
              <RefreshCcw className="h-5 w-5" /> Record Another Video
            </Button>
          )}
           {showResetCameraButton && ( /* "Reset Camera" button */
             <Button onClick={() => resetRecorderState(true)} variant="outline" className="gap-2 w-full sm:w-auto rounded-lg text-base px-5 py-2.5">
                <RefreshCcw className="h-5 w-5" /> Reset Camera &amp; Start Over
            </Button>
           )}
        </CardFooter>
      </Card>

      {showReviewAndUploadControls && ( /* Metadata form and thumbnail selection */
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
                          key={thumbUrl} // Use URL as key since it's unique after generation
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

      {showUploadingProgress && ( /* Upload progress display */
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

