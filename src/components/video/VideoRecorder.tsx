
"use client";

import { useEffect, useRef, useState, useCallback, FormEvent } from 'react';
import { useAuth } from '@/context/AuthContext';
import { uploadFileToStorage, getFirebaseStorageDownloadUrl } from '@/lib/firebase/storage';
import { addVideoMetadataToFirestore } from './actions';
import { Video, Mic, Square, Download, UploadCloud, AlertCircle, CheckCircle, Loader2, Settings2, Camera, Film, RefreshCcw, RotateCw, Image as ImageIcon, Play } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import type { VideoMeta, VideoDataForCreation } from '@/types';
import NextImage from 'next/image';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';

const NUM_THUMBNAILS_TO_GENERATE = 5;
const PREVIEW_LOAD_TIMEOUT_MS = 15000; // 15 seconds

type RecordingState = 'initial' | 'permission' | 'ready' | 'recording' | 'stopped' | 'uploading' | 'success' | 'error';

function formatTime(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export default function VideoRecorder() {
  const { user, doctorProfile } = useAuth();
  const { toast } = useToast();

  const videoPreviewRef = useRef<HTMLVideoElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const timerSecondsRef = useRef(0);
  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);
  
  const recordedVideoUrlRef_forCleanup = useRef<string | null>(null);
  const previewLoadTimerRef = useRef<NodeJS.Timeout | null>(null);
  
  const ffmpegRef = useRef<any | null>(null); 

  const [recordingState, setRecordingState] = useState<RecordingState>('initial');
  const [recordedVideoBlob, setRecordedVideoBlob] = useState<Blob | null>(null);
  const [recordedVideoUrl, setRecordedVideoUrl] = useState<string | null>(null);
  const [actualMimeType, setActualMimeType] = useState<string>('');

  const [potentialThumbnails, setPotentialThumbnails] = useState<(string | null)[]>(Array(NUM_THUMBNAILS_TO_GENERATE).fill(null));
  const [potentialThumbnailBlobs, setPotentialThumbnailBlobs] = useState<(Blob | null)[]>(Array(NUM_THUMBNAILS_TO_GENERATE).fill(null));
  const [selectedThumbnailIndex, setSelectedThumbnailIndex] = useState<number | null>(null);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [keywords, setKeywords] = useState('');
  const [featured, setFeatured] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [previewRotation, setPreviewRotation] = useState(0);
  const [videoElementKey, setVideoElementKey] = useState<string>('initial-key-' + Date.now());
  const [isLocallySaved, setIsLocallySaved] = useState(false);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [isGeneratingThumbnails, setIsGeneratingThumbnails] = useState(false);
  const [ffmpegLoaded, setFfmpegLoaded] = useState(false);
  const [ffmpegLoading, setFfmpegLoading] = useState(false);

  const isStreamValid = useCallback(() => {
    if (!mediaStreamRef.current || !mediaStreamRef.current.active) {
      console.warn("VideoRecorder (isStreamValid): Stream is null or not active.");
      return false;
    }
    const videoTrack = mediaStreamRef.current.getVideoTracks()[0];
    if (!videoTrack || videoTrack.readyState !== 'live') {
      console.warn("VideoRecorder (isStreamValid): Video track is missing or not live. State:", videoTrack?.readyState);
      return false;
    }
    console.log("VideoRecorder (isStreamValid): Stream appears to be valid and active.");
    return true;
  }, []);

  const stopMediaStream = useCallback(() => {
    if (mediaStreamRef.current) {
      console.log("VideoRecorder: Stopping media stream tracks.");
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      console.log("VideoRecorder: Main useEffect cleanup (unmount or core dep change) -> stopping media stream.");
      stopMediaStream();
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      if (recordedVideoUrlRef_forCleanup.current) URL.revokeObjectURL(recordedVideoUrlRef_forCleanup.current);
      potentialThumbnails.forEach(url => { if (url) URL.revokeObjectURL(url); });
      if (previewLoadTimerRef.current) clearTimeout(previewLoadTimerRef.current);
    };
  }, [stopMediaStream, potentialThumbnails]);


  const generateSpecificThumbnail = useCallback(async (videoObjectUrlForThumb: string, time: number, index: number): Promise<{ blob: Blob; blobUrl: string } | null> => {
    return new Promise((resolve) => {
      if (!videoObjectUrlForThumb) {
        console.error(`VideoRecorder: Thumb[${index}] - videoObjectUrlForThumb is null or empty.`);
        resolve(null);
        return;
      }
      console.log(`VideoRecorder: generateSpecificThumbnail - Idx ${index}, Time ${time}s`);
      const videoElement = document.createElement('video');
      videoElement.preload = 'metadata';
      videoElement.muted = true;
      videoElement.crossOrigin = "anonymous";

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
        videoElement.remove();
        resolve(value);
      };

      const timeoutId = setTimeout(() => {
        console.warn(`VideoRecorder: Thumb[${index}] generation timed out after 7s for time ${time}s.`);
        cleanupAndResolve(null);
      }, 7000);

      const onMetadata = async () => {
        console.log(`VideoRecorder: Thumb[${index}] metadata. Duration: ${videoElement.duration}s. Dims: ${videoElement.videoWidth}x${videoElement.videoHeight}. ReadyState: ${videoElement.readyState}. Seeking to ${time}s.`);
        const actualDuration = (videoElement.duration > 0 && Number.isFinite(videoElement.duration)) ? videoElement.duration : time + 0.1;
        const seekTime = Math.max(0.01, Math.min(time, actualDuration - 0.01));
        if (videoElement.readyState < 1) {
           console.warn(`VideoRecorder: Thumb[${index}] metadata loaded but readyState is ${videoElement.readyState}. Waiting before seeking.`);
        }
        videoElement.currentTime = seekTime;
      };

      const onSeeked = () => {
        if (resolved) return;
         console.log(`VideoRecorder: Thumb[${index}] seeked to ${videoElement.currentTime}s. ReadyState: ${videoElement.readyState}. Capturing frame.`);
        if (videoElement.readyState < 2 && videoElement.videoWidth > 0 && videoElement.videoHeight > 0) {
          console.warn(`VideoRecorder: Thumb[${index}] readyState < 2 (${videoElement.readyState}) after seek attempt, waiting for 'seeked'.`);
           setTimeout(() => { if (!resolved && videoElement.readyState >=2) captureFrame(); else if (!resolved) cleanupAndResolve(null);}, 100);
           return;
        }
        captureFrame();
      };

      const captureFrame = () => {
        if (resolved) return;
        clearTimeout(timeoutId);
        if (videoElement.videoWidth === 0 || videoElement.videoHeight === 0) {
            console.warn(`VideoRecorder: Thumbnail[${index}] - Video dimensions 0x0 at capture time.`);
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
                    if (blob && blob.size > 0) cleanupAndResolve({ blob, blobUrl: URL.createObjectURL(blob) });
                    else { console.warn(`VideoRecorder: Thumbnail[${index}] toBlob resulted in null or empty blob.`); cleanupAndResolve(null); }
                }, 'image/jpeg', 0.85);
            } catch (drawError) { console.error(`VideoRecorder: DrawImage/toBlob error for thumb ${index}:`, drawError); cleanupAndResolve(null); }
        } else { console.error(`VideoRecorder: Thumbnail[${index}] - Could not get 2D context for canvas.`); cleanupAndResolve(null); }
      }

      const onErrorHandler = (e: Event | string) => {
        if (resolved) return;
        console.error(`VideoRecorder: Thumb[${index}] video element error:`, videoElement.error, e);
        cleanupAndResolve(null);
      };

      videoElement.addEventListener('loadedmetadata', onMetadata, { once: true });
      videoElement.addEventListener('seeked', onSeeked, { once: true });
      videoElement.addEventListener('error', onErrorHandler, { once: true });
      videoElement.src = videoObjectUrlForThumb;
      videoElement.load();
    });
  }, []);

  const generatePotentialThumbnails = useCallback(async (videoObjectUrlForThumbs: string, durationInSeconds: number) => {
    if (!videoObjectUrlForThumbs) {
      console.error("VideoRecorder: Cannot generate thumbnails, videoObjectUrlForThumbs is missing.");
      setError("Video data for thumbnails is missing.");
      setIsGeneratingThumbnails(false);
      return;
    }
    console.log(`VideoRecorder: Generating thumbnails. Duration: ${durationInSeconds}s`);
    setIsGeneratingThumbnails(true);
    potentialThumbnails.forEach(url => { if (url) URL.revokeObjectURL(url); });
    setPotentialThumbnails(Array(NUM_THUMBNAILS_TO_GENERATE).fill(null));
    setPotentialThumbnailBlobs(Array(NUM_THUMBNAILS_TO_GENERATE).fill(null));

    const effectiveDuration = Math.max(0.1, durationInSeconds);
    let timePoints: number[];

    if (effectiveDuration < 1) {
      timePoints = [effectiveDuration / 2, Math.min(effectiveDuration * 0.9, effectiveDuration - 0.01)].filter(t => t > 0.01).slice(0, NUM_THUMBNAILS_TO_GENERATE);
      if(timePoints.length === 0 && effectiveDuration > 0.01) timePoints = [effectiveDuration * 0.5];
    } else {
      timePoints = Array(NUM_THUMBNAILS_TO_GENERATE).fill(null).map((_, i) => {
          const point = (effectiveDuration / (NUM_THUMBNAILS_TO_GENERATE + 1)) * (i + 1);
          return Math.max(0.01, Math.min(point, effectiveDuration - 0.01));
      });
    }
    const uniqueTimes = [...new Set(timePoints)].filter(t => Number.isFinite(t) && t > 0).slice(0, NUM_THUMBNAILS_TO_GENERATE);
    if (uniqueTimes.length === 0 && effectiveDuration > 0.01) {
        uniqueTimes.push(Math.max(0.01, effectiveDuration * 0.1));
    }
     if (uniqueTimes.length === 0) {
        console.warn("VideoRecorder: No valid time points for thumbnail generation from canvas.");
        setIsGeneratingThumbnails(false);
        if (!error) setError("Could not determine valid points for thumbnails. Video might be too short or problematic.");
        return;
    }

    const settledResults = await Promise.allSettled(
      uniqueTimes.map((time, index) => generateSpecificThumbnail(videoObjectUrlForThumbs, time, index))
    );

    const newUrls: (string | null)[] = [];
    const newBlobs: (Blob | null)[] = [];
    let successfulGenerations = 0;
    settledResults.forEach((result, idx) => {
      if (result.status === 'fulfilled' && result.value) {
        console.log(`VideoRecorder: Thumbnail generation success for point ${uniqueTimes[idx]}s`);
        newUrls.push(result.value.blobUrl);
        newBlobs.push(result.value.blob);
        successfulGenerations++;
      } else {
        console.error(`VideoRecorder: Thumbnail generation FAILED for point ${uniqueTimes[idx]}s:`, result.status === 'rejected' ? result.reason : 'Null value');
      }
    });

    while (newUrls.length < NUM_THUMBNAILS_TO_GENERATE) newUrls.push(null);
    while (newBlobs.length < NUM_THUMBNAILS_TO_GENERATE) newBlobs.push(null);

    setPotentialThumbnails(newUrls);
    setPotentialThumbnailBlobs(newBlobs);
    const firstValidIdx = newBlobs.findIndex(b => b !== null);
    setSelectedThumbnailIndex(firstValidIdx !== -1 ? firstValidIdx : null);
    setIsGeneratingThumbnails(false);
    console.log(`VideoRecorder: Thumbnail generation completed. ${successfulGenerations} successful.`);
    if (successfulGenerations === 0 && !error && durationInSeconds > 0.1) {
        setError("Failed to generate any thumbnails via canvas method. The video might be too short or in a format difficult for browser processing. You can try FFmpeg method.");
    }
  }, [generateSpecificThumbnail, error, potentialThumbnails]);


  useEffect(() => {
    if (recordedVideoBlob && recordingState === 'stopped') {
      console.log("VideoRecorder: Preparing recorded video preview. Blob size:", recordedVideoBlob.size);
      const objectUrl = URL.createObjectURL(recordedVideoBlob);
      
      if (recordedVideoUrlRef_forCleanup.current) {
        URL.revokeObjectURL(recordedVideoUrlRef_forCleanup.current);
      }
      recordedVideoUrlRef_forCleanup.current = objectUrl;
      setRecordedVideoUrl(objectUrl);
      setVideoElementKey('recorded-preview-' + Date.now()); 
    } else if (recordingState !== 'stopped' && recordedVideoUrlRef_forCleanup.current) {
      URL.revokeObjectURL(recordedVideoUrlRef_forCleanup.current);
      recordedVideoUrlRef_forCleanup.current = null;
      setRecordedVideoUrl(null);
    }
  }, [recordedVideoBlob, recordingState]);


  // This effect handles setting up the video element for the recorded preview
  // AFTER the videoElementKey has changed and recordedVideoUrl is set.
  useEffect(() => {
    const videoElement = videoPreviewRef.current;
    if (videoElementKey.startsWith('recorded-preview-') && recordedVideoUrl && videoElement) {
      console.log("VideoRecorder: Configuring video element for recorded preview (key changed). Src:", recordedVideoUrl.substring(0,50)+"...");
      
      videoElement.srcObject = null; // CRITICAL: clear any live stream
      videoElement.src = ""; // Clear old src just in case
      videoElement.src = recordedVideoUrl;
      videoElement.muted = false;
      videoElement.controls = true; // CRITICAL: ensure controls are enabled

      const handleMetadataLoaded = () => {
        setIsPreviewLoading(false);
        if (previewLoadTimerRef.current) clearTimeout(previewLoadTimerRef.current);
        const reportedDuration = videoElement.duration;
        const timerDuration = timerSecondsRef.current;
        console.log(`VideoRecorder: Recorded preview metadata loaded. Element duration: ${isFinite(reportedDuration) ? reportedDuration.toFixed(2) : 'Infinity'} Timer duration: ${timerDuration} s.`);
        
        videoElement.play().catch(playError => {
          console.error("VideoRecorder: Error playing recorded preview:", playError.name, playError.message);
          // Don't set a generic error here as the video might still be usable for thumbnails
          toast({variant: "destructive", title: "Preview Playback Issue", description: `Could not auto-play: ${playError.message}`});
        });

        if (recordedVideoBlob && recordedVideoBlob.size > 0) {
            // Use a new URL for thumbnail generation to avoid issues if the main preview URL is revoked too early
            const thumbGenBlobSlice = recordedVideoBlob.slice(); 
            const thumbGenUrl = URL.createObjectURL(thumbGenBlobSlice);
            generatePotentialThumbnails(thumbGenUrl, timerDuration > 0 ? timerDuration : (isFinite(reportedDuration) && reportedDuration > 0 ? reportedDuration : 0.1))
                .finally(() => {
                    // Clean up the temporary URL used for thumbnail generation
                    console.log("VideoRecorder: Revoking temporary URL for thumbnail generation:", thumbGenUrl.substring(0,50)+"...");
                    URL.revokeObjectURL(thumbGenUrl);
                });
        }
      };

      const handleError = (e: Event) => {
        setIsPreviewLoading(false);
        if (previewLoadTimerRef.current) clearTimeout(previewLoadTimerRef.current);
        const videoError = videoElement.error;
        console.error("VideoRecorder: Recorded preview error. Event:", e, "Video Error Object:", videoError);
        setError(`Preview Error. Code: ${videoError?.code}, Msg: ${videoError?.message || 'Unknown media error'}. The recording may be corrupted.`);
        if (recordedVideoBlob && recordedVideoBlob.size > 0 && timerSecondsRef.current > 0) {
            const thumbGenBlobSlice = recordedVideoBlob.slice();
            const thumbGenUrl = URL.createObjectURL(thumbGenBlobSlice);
            generatePotentialThumbnails(thumbGenUrl, timerSecondsRef.current)
              .finally(() => {
                  URL.revokeObjectURL(thumbGenUrl);
              });
        }
      };
      
      videoElement.addEventListener('loadedmetadata', handleMetadataLoaded, { once: true });
      videoElement.addEventListener('error', handleError, { once: true });
      
      setIsPreviewLoading(true);
      if (previewLoadTimerRef.current) clearTimeout(previewLoadTimerRef.current);
      previewLoadTimerRef.current = setTimeout(() => {
        if (isPreviewLoading) {
          console.warn("VideoRecorder: Preview load timed out.");
          setError("Preview Error: Timed out waiting for video to load. Try saving locally to verify.");
          setIsPreviewLoading(false);
          if (recordedVideoBlob && timerSecondsRef.current > 0) {
              const thumbGenBlobSlice = recordedVideoBlob.slice();
              const thumbGenUrl = URL.createObjectURL(thumbGenBlobSlice);
              generatePotentialThumbnails(thumbGenUrl, timerSecondsRef.current)
                .finally(() => {
                    URL.revokeObjectURL(thumbGenUrl);
                });
          }
        }
      }, PREVIEW_LOAD_TIMEOUT_MS);

      console.log("VideoRecorder: Calling videoElement.load() for recorded preview (key change effect).");
      videoElement.load(); // ESSENTIAL to make the browser process the new src

      return () => {
        if (previewLoadTimerRef.current) clearTimeout(previewLoadTimerRef.current);
        // Event listeners are {once: true}, so no explicit removal needed for them here
        // The main recordedVideoUrlRef_forCleanup.current is revoked in the top-level useEffect
      }
    }
  }, [videoElementKey, recordedVideoUrl, recordedVideoBlob, generatePotentialThumbnails, isPreviewLoading, toast]);

  // This effect handles setting up the live preview.
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
  }, [recordingState, stopMediaStream]); // Removed isStreamValid as it might cause issues with stale closures

  const requestPermissionsAndSetup = useCallback(async () => {
    setError(null);
    setRecordingState('permission');
    console.log("VideoRecorder: Requesting media permissions...");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: { echoCancellation: true, noiseSuppression: true },
      });

      if (!stream || !stream.active || stream.getVideoTracks().length === 0 || stream.getVideoTracks()[0].readyState !== 'live') {
        throw new Error(`Camera stream is not active or invalid (state: ${stream?.getVideoTracks()[0]?.readyState}).`);
      }
      mediaStreamRef.current = stream;
      console.log("VideoRecorder: Media permissions granted, stream is in mediaStreamRef.current.");
      setVideoElementKey('live-preview'); 
      setRecordingState('ready');
    } catch (err) {
      console.error("VideoRecorder: Error accessing media devices:", err);
      const message = err instanceof Error ? err.message : String(err);
      setError(`Failed to access camera/microphone: ${message}. Ensure permissions are allowed and no other app is using the camera.`);
      stopMediaStream();
      setRecordingState('initial');
    }
  }, [stopMediaStream]);


  const getSupportedMimeType = useCallback(() => {
    const types = [
      'video/webm;codecs=vp8,opus', 
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=h264,opus',
      'video/mp4;codecs=avc1',
      'video/webm',
      'video/mp4',
    ];
    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) {
        console.log("VideoRecorder: Using MIME type:", type);
        return type;
      }
    }
    const defaultType = 'video/webm';
    console.warn("VideoRecorder: No preferred MIME type supported, falling back to:", defaultType);
    return defaultType;
  }, []);


  const startRecording = useCallback(() => {
    setError(null);
    console.log("VideoRecorder: Attempting to start recording...");
    if (!mediaStreamRef.current || !mediaStreamRef.current.active || mediaStreamRef.current.getVideoTracks().length === 0 || mediaStreamRef.current.getVideoTracks()[0].readyState !== 'live') {
      setError("Media stream not ready or invalid. Please re-setup camera.");
      console.error("VideoRecorder: startRecording - stream invalid or null.");
      requestPermissionsAndSetup(); 
      return;
    }
    console.log("VideoRecorder: Stream validation passed for startRecording.");
    console.log("  - Stream object being passed to MediaRecorder:", mediaStreamRef.current);
    console.log("  - Stream active:", mediaStreamRef.current.active);
    mediaStreamRef.current.getVideoTracks().forEach((track, idx) => console.log(`  - Track ${idx} (video): kind=${track.kind}, id=${track.id}, label='${track.label}', readyState=${track.readyState}, muted=${track.muted}, enabled=${track.enabled}`));
    mediaStreamRef.current.getAudioTracks().forEach((track, idx) => console.log(`  - Track ${idx} (audio): kind=${track.kind}, id=${track.id}, label='${track.label}', readyState=${track.readyState}, muted=${track.muted}, enabled=${track.enabled}`));

    if (videoPreviewRef.current && videoPreviewRef.current.srcObject !== mediaStreamRef.current) {
        console.log("VideoRecorder: Re-setting preview to live stream for recording as it was lost or changed.");
        videoPreviewRef.current.srcObject = mediaStreamRef.current;
        videoPreviewRef.current.src = "";
        videoPreviewRef.current.muted = true; 
        videoPreviewRef.current.controls = false;
        videoPreviewRef.current.play().catch(e => console.warn("VideoRecorder: Error re-playing live preview for recording during startRecording:", e.name, e.message));
    }
    
    setRecordedVideoBlob(null); 
    setIsLocallySaved(false);
    potentialThumbnails.forEach(url => { if (url) URL.revokeObjectURL(url); });
    setPotentialThumbnails(Array(NUM_THUMBNAILS_TO_GENERATE).fill(null));
    setPotentialThumbnailBlobs(Array(NUM_THUMBNAILS_TO_GENERATE).fill(null));
    setSelectedThumbnailIndex(null); recordedChunksRef.current = []; timerSecondsRef.current = 0;

    const mimeTypeToUse = getSupportedMimeType();
    setActualMimeType(mimeTypeToUse);
    const options: MediaRecorderOptions = { mimeType: mimeTypeToUse };
    console.log("VideoRecorder: MediaRecorder options:", options);

    try {
      console.log("VideoRecorder: Instantiating MediaRecorder. Stream active:", mediaStreamRef.current.active, "Tracks:", mediaStreamRef.current.getVideoTracks()[0]?.readyState, mediaStreamRef.current.getAudioTracks()[0]?.readyState);
      const recorder = new MediaRecorder(mediaStreamRef.current, options);
      mediaRecorderRef.current = recorder;

      recorder.onstart = () => {
        console.log("VideoRecorder: MediaRecorder.onstart. Actual MIME:", recorder.mimeType, ". State:", recorder.state);
        setRecordingState('recording');
        timerSecondsRef.current = 0;
        if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = setInterval(() => { timerSecondsRef.current++; }, 1000);
      };

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        console.log("VideoRecorder: MediaRecorder.onstop. Chunks:", recordedChunksRef.current.length, ". Timer Duration:", timerSecondsRef.current + "s");
        if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
        
        const finalMimeType = mediaRecorderRef.current?.mimeType || actualMimeType || 'video/webm';
        if (recordedChunksRef.current.length === 0) {
          console.error("VideoRecorder: No video data recorded (chunks empty).");
          setError("No video data was recorded. Please try again.");
          setRecordingState('ready'); 
          return;
        }
        const blob = new Blob(recordedChunksRef.current, { type: finalMimeType });
        console.log("VideoRecorder: Blob created. Size:", blob.size, ", Type:", blob.type);
        if (blob.size === 0) {
          console.error("VideoRecorder: Recording failed: empty file created.");
          setError("Recording resulted in an empty file. Please try again.");
          setRecordingState('ready'); 
          return;
        }
        setRecordedVideoBlob(blob); 
        setRecordingState('stopped'); 
      };

      recorder.onerror = (event) => {
        console.error("VideoRecorder: MediaRecorder error event:", event);
        let specificError = "A recording error occurred.";
        // @ts-ignore DOMException is not always on event type, but often is in 'error' property
        if (event.error instanceof DOMException) {
             // @ts-ignore
            specificError = `Recorder Error: ${event.error.name} - ${event.error.message}`;
        }
        setError(specificError);
        if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
        setRecordingState('error');
      };
      
      console.log("VideoRecorder: Calling mediaRecorderRef.current.start() with timeslice:", 1000);
      recorder.start(1000); 
    } catch (e: any) {
      console.error("VideoRecorder: Failed to start MediaRecorder:", e);
      setError(`Failed to start recorder: ${e.message}. Ensure your browser supports MediaRecorder with the selected codecs.`);
      setRecordingState('error');
    }
  }, [getSupportedMimeType, requestPermissionsAndSetup, potentialThumbnails, actualMimeType]);


  const stopRecording = useCallback(() => {
    console.log("VideoRecorder: stopRecording() called. Current MediaRecorder state:", mediaRecorderRef.current?.state, ". Timer ref:", timerSecondsRef.current + "s.");
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop(); 
    } else {
      console.warn("VideoRecorder: stopRecording called but recorder not in 'recording' state or not initialized.");
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      if (recordingState === 'recording') setRecordingState('ready'); 
    }
  }, [recordingState]);


  const resetRecorderState = useCallback((fullReset = true) => {
    console.log(`VideoRecorder: resetRecorderState called. Full reset: ${fullReset}`);
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop(); 
    }
    mediaRecorderRef.current = null;
    if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
    
    setRecordedVideoBlob(null); 
    
    potentialThumbnails.forEach(url => { if (url) URL.revokeObjectURL(url); });
    setPotentialThumbnails(Array(NUM_THUMBNAILS_TO_GENERATE).fill(null));
    setPotentialThumbnailBlobs(Array(NUM_THUMBNAILS_TO_GENERATE).fill(null));
    setSelectedThumbnailIndex(null);

    recordedChunksRef.current = [];
    timerSecondsRef.current = 0;
    
    setTitle(''); setDescription(''); setKeywords(''); setFeatured(false);
    setError(null); 
    setUploadProgress(0);
    setPreviewRotation(0);
    setIsLocallySaved(false);
    setIsPreviewLoading(false);
    setIsGeneratingThumbnails(false);

    if (fullReset) {
      console.log("VideoRecorder: Full reset, stopping media stream and re-requesting permissions.");
      stopMediaStream();
      setVideoElementKey('initial-key-' + Date.now());
      setRecordingState('initial'); 
    } else {
      console.log("VideoRecorder: Soft reset, attempting to go back to 'ready' state with existing stream.");
      if (mediaStreamRef.current && mediaStreamRef.current.active) {
         setVideoElementKey('live-preview'); 
         setRecordingState('ready');
      } else {
         console.warn("VideoRecorder: Soft reset failed, stream not active. Forcing full reset.");
         stopMediaStream();
         setVideoElementKey('initial-key-' + Date.now());
         setRecordingState('initial');
      }
    }
  }, [stopMediaStream, potentialThumbnails]);


  const handleSaveLocally = () => {
    if (!recordedVideoBlob) {
      toast({ variant: "destructive", title: "No Video", description: "No recorded video to save." });
      return;
    }
    const urlToSave = recordedVideoUrl || URL.createObjectURL(recordedVideoBlob);
    const a = document.createElement("a");
    a.href = urlToSave;
    const safeTitle = title.replace(/[^a-z0-9_]+/gi, '_').toLowerCase() || 'web_recording';
    const extension = actualMimeType ? actualMimeType.split('/')[1]?.split(';')[0] || 'webm' : 'webm';
    a.download = `${safeTitle}_${Date.now()}.${extension}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    if (urlToSave !== recordedVideoUrl) URL.revokeObjectURL(urlToSave); 
    setIsLocallySaved(true);
    toast({ title: "Video Saved Locally", description: `Video saved as ${a.download}. You can now proceed to upload it.` });
  };


  const handleRotatePreview = () => { setPreviewRotation(current => (current + 90) % 360); };
  
  const handleFFmpegLoad = async () => {
    if (ffmpegRef.current && ffmpegLoaded) {
      toast({title: "FFmpeg Ready", description: "FFmpeg is already loaded."});
      return;
    }
    setFfmpegLoading(true);
    setError(null);
    try {
      const { createFFmpeg } = await import('@ffmpeg/ffmpeg'); 
      if (!ffmpegRef.current) {
        console.log("VideoRecorder: Creating FFmpeg instance (v0.11.0)...");
        ffmpegRef.current = createFFmpeg({ 
          log: true, 
          corePath: '/ffmpeg/ffmpeg-core.js', // For v0.11.0, this loads .wasm and .worker.js relative to this
        });
      }
      if (!ffmpegRef.current.isLoaded()) {
        console.log("VideoRecorder: Loading FFmpeg v0.11.0 for thumbnails...");
        toast({title: "Loading FFmpeg", description: "Please wait, this may take a moment..."});
        await ffmpegRef.current.load();
      }
      setFfmpegLoaded(true);
      toast({title: "FFmpeg Loaded", description: "Ready to generate thumbnails with FFmpeg."});
      console.log("VideoRecorder: FFmpeg v0.11.0 loaded successfully.");
    } catch (err) {
      console.error("VideoRecorder: Error loading FFmpeg v0.11.0:", err);
      setError("Failed to load FFmpeg. Ensure assets (ffmpeg-core.js, .wasm, .worker.js from v0.11.0) are in public/ffmpeg/. Check console.");
      toast({variant: "destructive", title: "FFmpeg Load Failed", description: "Could not load FFmpeg."});
      setFfmpegLoaded(false); 
    } finally {
      setFfmpegLoading(false);
    }
  };

  const handleGenerateThumbnailsWithFFmpeg = async () => {
    if (!recordedVideoBlob) {
      setError("No recorded video available to generate FFmpeg thumbnails.");
      return;
    }
    if (!ffmpegRef.current || !ffmpegRef.current.isLoaded()) {
      setError("FFmpeg is not loaded yet. Please click 'Load FFmpeg' first.");
      toast({variant: "destructive", title: "FFmpeg Not Loaded", description: "Please load FFmpeg first."});
      return;
    }

    setIsGeneratingThumbnails(true);
    setError(null);
    potentialThumbnails.forEach(url => { if (url) URL.revokeObjectURL(url); });
    setPotentialThumbnails(Array(NUM_THUMBNAILS_TO_GENERATE).fill(null));
    setPotentialThumbnailBlobs(Array(NUM_THUMBNAILS_TO_GENERATE).fill(null));

    try {
      const { fetchFile } = await import('@ffmpeg/ffmpeg'); 
      console.log("VideoRecorder: Generating thumbnails with FFmpeg v0.11.0...");
      toast({title: "Generating FFmpeg Thumbnails", description: "Processing video..."});
      const inputFileName = "input." + (actualMimeType.split('/')[1]?.split(';')[0] || 'webm');
      ffmpegRef.current.FS("writeFile", inputFileName, await fetchFile(recordedVideoBlob));

      const duration = timerSecondsRef.current > 0 ? timerSecondsRef.current : 10; 
      const timePoints = Array(NUM_THUMBNAILS_TO_GENERATE).fill(null).map((_, i) => {
        const point = (duration / (NUM_THUMBNAILS_TO_GENERATE + 1)) * (i + 1);
        return Math.max(0.1, Math.min(point, duration - 0.1)).toFixed(3);
      });
      
      const newUrls: (string | null)[] = [];
      const newBlobs: (Blob | null)[] = [];

      for (let i = 0; i < timePoints.length; i++) {
        const outputFileName = `thumb-${i + 1}.jpg`;
        console.log(`VideoRecorder: FFmpeg v0.11.0 -ss ${timePoints[i]} -i ${inputFileName} -vframes 1 -q:v 3 ${outputFileName}`);
        await ffmpegRef.current.run('-ss', timePoints[i], '-i', inputFileName, '-vframes', '1', '-q:v', '3', '-vf', 'scale=320:-1', outputFileName);
        const data = ffmpegRef.current.FS('readFile', outputFileName);
        const blob = new Blob([data.buffer], { type: 'image/jpeg' });
        if (blob.size > 0) {
          newUrls.push(URL.createObjectURL(blob));
          newBlobs.push(blob);
        } else {
          newUrls.push(null); newBlobs.push(null);
        }
        ffmpegRef.current.FS('unlink', outputFileName);
      }
      ffmpegRef.current.FS('unlink', inputFileName);

      setPotentialThumbnails(newUrls);
      setPotentialThumbnailBlobs(newBlobs);
      const firstValidIdx = newBlobs.findIndex(b => b !== null);
      setSelectedThumbnailIndex(firstValidIdx !== -1 ? firstValidIdx : null);
      toast({title: "FFmpeg Thumbnails Generated", description: `${newBlobs.filter(b=>b).length} thumbnails created.`});

    } catch (err) {
      console.error("VideoRecorder: FFmpeg v0.11.0 thumbnail generation failed:", err);
      setError("FFmpeg thumbnail generation failed. Check console for details.");
      toast({variant: "destructive", title: "FFmpeg Thumbnail Error", description: "Generation failed."});
    } finally {
      setIsGeneratingThumbnails(false);
    }
  };


  const handleUpload = async () => {
    if (!user || !doctorProfile) { setError("User or doctor profile not available. Please re-login."); setRecordingState('error'); return; }
    if (!recordedVideoBlob) { setError("No recorded video to upload."); setRecordingState('error'); return; }
    if (selectedThumbnailIndex === null || !potentialThumbnailBlobs[selectedThumbnailIndex]) { setError("Please select a thumbnail."); return; }
    const selectedThumbnailBlobFile = potentialThumbnailBlobs[selectedThumbnailIndex!];
    if (!selectedThumbnailBlobFile) { setError("Selected thumbnail data is missing."); return; }
    if (!title.trim()) { setError("Video title is required."); return; }

    setRecordingState('uploading');
    setUploadProgress(0);
    setError(null);
    
    const videoId = uuidv4();
    console.log("[VideoRecorder:handleUpload] Generated id for this upload:", videoId);
    console.log("[VideoRecorder:handleUpload] Data to be used: Title:", title, "Desc:", description, "Keywords:", keywords, "Featured:", featured);
    console.log("[VideoRecorder:handleUpload] Recorded Blob available:", !!recordedVideoBlob, "Size:", recordedVideoBlob.size);
    console.log("[VideoRecorder:handleUpload] Selected Thumbnail Index:", selectedThumbnailIndex, "Blob available:", !!selectedThumbnailBlobFile);


    let videoDataForAction: VideoDataForCreation = {
      id: videoId,
      title,
      description,
      doctorId: doctorProfile.uid,
      doctorName: doctorProfile.displayName || doctorProfile.email || "Unknown Doctor",
      videoUrl: "", 
      thumbnailUrl: "", 
      duration: formatTime(timerSecondsRef.current),
      recordingDuration: timerSecondsRef.current,
      tags: keywords.split(',').map(k => k.trim()).filter(Boolean),
      featured: featured,
      storagePath: "", 
      thumbnailStoragePath: "", 
      videoSize: recordedVideoBlob.size,
      videoType: recordedVideoBlob.type || actualMimeType || 'video/webm',
    };
    console.log("[VideoRecorder:handleUpload] Client-side videoDataForAction (before storage upload):", JSON.stringify(videoDataForAction, null, 2));

    try {
      const safeTitleForFile = title.replace(/[^a-z0-9_]+/gi, '_').toLowerCase() || 'recorded_video';
      const timestamp = Date.now();
      const videoExtension = actualMimeType ? actualMimeType.split('/')[1]?.split(';')[0] || 'webm' : 'webm';
      const videoFileName = `${safeTitleForFile}_${timestamp}.${videoExtension}`;
      const thumbnailFileName = `thumbnail_${safeTitleForFile}_${timestamp}.jpg`;

      const videoStorageFullPath = `videos/${doctorProfile.uid}/${videoFileName}`;
      await uploadFileToStorage(
        `videos/${doctorProfile.uid}`,
        recordedVideoBlob,
        videoFileName,
        (snapshot) => setUploadProgress(Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 0.8 * 100))
      );
      videoDataForAction.videoUrl = await getFirebaseStorageDownloadUrl(videoStorageFullPath);
      videoDataForAction.storagePath = videoStorageFullPath;
      setUploadProgress(80);

      const thumbnailStorageFullPath = `thumbnails/${doctorProfile.uid}/${thumbnailFileName}`;
      await uploadFileToStorage(
        `thumbnails/${doctorProfile.uid}`,
        selectedThumbnailBlobFile,
        thumbnailFileName,
        (snapshot) => setUploadProgress(Math.round(80 + (snapshot.bytesTransferred / snapshot.totalBytes) * 0.2 * 100))
      );
      videoDataForAction.thumbnailUrl = await getFirebaseStorageDownloadUrl(thumbnailStorageFullPath);
      videoDataForAction.thumbnailStoragePath = thumbnailStorageFullPath;
      setUploadProgress(100);
      
      console.log("[VideoRecorder:handleUpload] Final videoData object being sent to server action:", JSON.stringify(videoDataForAction, null, 2));
      const result = await addVideoMetadataToFirestore(videoDataForAction);

      if (result.success && result.id) {
        toast({ title: "Upload Successful!", description: `Video "${title}" uploaded with ID: ${result.id}.` });
        setRecordingState('success');
        resetRecorderState(false);
      } else {
        console.error("[VideoRecorder:handleUpload] Error from addVideoMetadataToFirestore:", result.error);
        setError(`Failed to save video metadata: ${result.error}`);
        setRecordingState('error'); 
      }
    } catch (err: any) {
      console.error("[VideoRecorder:handleUpload] Critical error during upload process:", err);
      setError(`Upload failed: ${err.message || "An unknown error occurred."}`);
      setRecordingState('error');
    }
  };


  const showSetupButton = recordingState === 'initial';
  const showRecordControls = recordingState === 'ready' || recordingState === 'recording';
  const showReviewAndUpload = recordingState === 'stopped' || recordingState === 'error' ;
  const isVideoElementVisible = recordingState === 'permission' || recordingState === 'ready' || recordingState === 'recording' || (recordingState === 'stopped' && !!recordedVideoUrl);


  return (
    <Card className="w-full max-w-3xl mx-auto shadow-xl rounded-lg">
      <CardHeader>
        <CardTitle className="text-2xl font-headline flex items-center gap-2">
          <Camera size={28} className="text-primary"/> Web Video Recorder
        </CardTitle>
        <CardDescription>
          Record, review, and upload your video. Ensure good lighting and clear audio.
          <strong>IMPORTANT for FFmpeg:</strong> You MUST delete your `node_modules` folder and `package-lock.json` (or `yarn.lock`), then run `npm install` (or `yarn install`) to use FFmpeg v0.11.0. Then, copy the <strong>v0.11.0</strong> versions of `ffmpeg-core.js`, `ffmpeg-core.wasm`, and `ffmpeg-core.worker.js` from `node_modules/@ffmpeg/core/dist/` into your `public/ffmpeg/` directory.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {recordingState === 'success' && (
            <Alert variant="default" className="bg-green-100 dark:bg-green-900/30 border-green-400 text-green-700 dark:text-green-300">
                <CheckCircle className="h-4 w-4" />
                <AlertTitle>Upload Successful!</AlertTitle>
                <AlertDescription>Your video has been uploaded. You can record another one or manage your videos.</AlertDescription>
            </Alert>
        )}

        {recordingState === 'permission' && !mediaStreamRef.current && ( 
            <div className="text-center py-4">
                <Loader2 className="h-6 w-6 animate-spin text-primary mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">Requesting camera & microphone permissions...</p>
            </div>
        )}

        {isVideoElementVisible && (
          <div className="relative group">
            <video
              key={videoElementKey}
              ref={videoPreviewRef}
              muted={recordingState !== 'stopped'} 
              controls={recordingState === 'stopped' && !!recordedVideoUrl}
              playsInline 
              className="w-full aspect-video rounded-md border bg-slate-900 object-contain shadow-inner transition-transform duration-300 ease-in-out"
              style={{ transform: `rotate(${previewRotation}deg)` }}
            />
            <Button
                onClick={handleRotatePreview}
                variant="outline"
                size="icon"
                className="absolute top-2 left-2 z-10 bg-black/40 text-white hover:bg-black/60 border-white/30 opacity-0 group-hover:opacity-100 transition-opacity"
                title="Rotate Preview (display only)"
                disabled={recordingState === 'uploading'}
            >
                <RotateCw size={18} />
            </Button>
            {recordingState === 'recording' && (
                <div className="absolute top-2 right-2 bg-red-600 text-white px-2 py-1 rounded text-xs flex items-center gap-1 animate-pulse">
                    <Mic size={14} /> REC: {formatTime(timerSecondsRef.current)}
                </div>
            )}
            {isPreviewLoading && recordingState === 'stopped' && (
                <div className="absolute inset-0 bg-black/50 flex flex-col items-center justify-center rounded-md">
                    <Loader2 className="h-8 w-8 animate-spin text-white mb-2" />
                    <p className="text-sm text-white">Loading recorded preview...</p>
                </div>
            )}
          </div>
        )}

        {showSetupButton && (
          <Button onClick={requestPermissionsAndSetup} className="w-full gap-2">
            <Camera size={18} /> Setup Camera & Mic
          </Button>
        )}

        {showRecordControls && (
          <div className="flex flex-col sm:flex-row gap-2">
            {recordingState === 'ready' && (
              <Button onClick={startRecording} className="flex-1 gap-2 bg-green-600 hover:bg-green-700 text-white">
                <Mic size={18} /> Start Recording
              </Button>
            )}
            {recordingState === 'recording' && (
              <Button onClick={stopRecording} className="flex-1 gap-2 bg-red-600 hover:bg-red-700 text-white">
                <Square size={18} /> Stop Recording
              </Button>
            )}
          </div>
        )}
        
        {showReviewAndUpload && recordedVideoBlob && (
          <div className="space-y-4 pt-4 border-t">
            <h3 className="text-lg font-semibold">Review & Upload Video</h3>
            <div className="space-y-1">
                <Label htmlFor="videoTitleRec">Video Title <span className="text-destructive">*</span></Label>
                <Input id="videoTitleRec" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Enter a title" required disabled={recordingState === 'uploading'}/>
            </div>
            <div className="space-y-1">
                <Label htmlFor="videoDescRec">Description</Label>
                <Textarea id="videoDescRec" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Summarize the video content" rows={3} disabled={recordingState === 'uploading'}/>
            </div>
            <div className="space-y-1">
                <Label htmlFor="videoKeywordsRec">Keywords (comma-separated)</Label>
                <Input id="videoKeywordsRec" value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="e.g., cardiology, tutorial" disabled={recordingState === 'uploading'}/>
            </div>
            <div className="flex items-center space-x-2">
                <Checkbox id="featuredRec" checked={featured} onCheckedChange={(checkedStatus) => setFeatured(Boolean(checkedStatus))} disabled={recordingState === 'uploading'}/>
                <Label htmlFor="featuredRec" className="font-normal text-sm">Feature this video</Label>
            </div>

            <div className="my-4 p-3 border rounded-md bg-muted/30 space-y-3">
                <Label className="mb-1 block text-sm font-medium text-foreground">Thumbnail Generation</Label>
                <div className="flex flex-wrap gap-2">
                    <Button onClick={() => recordedVideoUrl && generatePotentialThumbnails(recordedVideoUrl, timerSecondsRef.current)} 
                            disabled={isGeneratingThumbnails || !recordedVideoUrl || recordingState === 'uploading'} 
                            variant="outline" size="sm" className="gap-1.5">
                        {isGeneratingThumbnails && !ffmpegLoaded ? <Loader2 className="animate-spin"/> : <ImageIcon size={16}/>} Generate (Canvas)
                    </Button>
                    {!ffmpegLoaded && 
                        <Button onClick={handleFFmpegLoad} variant="outline" size="sm" className="gap-1.5" disabled={ffmpegLoading || recordingState === 'uploading'}>
                            {ffmpegLoading ? <Loader2 className="animate-spin"/> : <Settings2 size={16}/>} Load FFmpeg (v0.11)
                        </Button>
                    }
                    {ffmpegLoaded && 
                        <Button onClick={handleGenerateThumbnailsWithFFmpeg} 
                                disabled={isGeneratingThumbnails || !recordedVideoBlob || recordingState === 'uploading' || ffmpegLoading} 
                                variant="outline" size="sm" className="gap-1.5">
                           {isGeneratingThumbnails ? <Loader2 className="animate-spin"/> : <Film size={16}/>} Generate (FFmpeg)
                        </Button>
                    }
                </div>
                {isGeneratingThumbnails && <p className="text-xs text-muted-foreground">Generating thumbnails, please wait...</p>}
                {ffmpegLoading && <p className="text-xs text-muted-foreground">Loading FFmpeg, please wait...</p>}
                
                {potentialThumbnails.some(t => t) && !isGeneratingThumbnails && (
                    <div>
                        <Label className="mt-2 mb-1 block text-xs font-medium text-foreground/80">Select Thumbnail <span className="text-destructive">*</span></Label>
                        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                        {potentialThumbnails.map((thumbUrl, index) => (
                            thumbUrl ? (
                            <button
                                key={index} type="button" onClick={() => setSelectedThumbnailIndex(index)}
                                className={`relative aspect-video rounded-md overflow-hidden border-2 transition-all duration-150 ease-in-out hover:opacity-80 focus:outline-none
                                    ${selectedThumbnailIndex === index ? 'border-primary ring-2 ring-primary/50' : 'border-muted hover:border-primary/50'}`}
                                disabled={recordingState === 'uploading'}
                            >
                                <NextImage src={thumbUrl} alt={`Thumbnail ${index + 1}`} fill sizes="(max-width: 768px) 33vw, 20vw" className="object-cover" data-ai-hint="video thumbnail selection"/>
                                {selectedThumbnailIndex === index && (
                                <div className="absolute inset-0 bg-primary/50 flex items-center justify-center">
                                    <CheckCircle size={24} className="text-white opacity-90" />
                                </div>
                                )}
                            </button>
                            ) : ( <div key={index} className="aspect-video bg-muted rounded-md flex items-center justify-center border border-dashed border-border"><ImageIcon size={24} className="text-muted-foreground" /></div>)
                        ))}
                        </div>
                        {selectedThumbnailIndex === null && <p className="text-xs text-destructive mt-1">Please select a thumbnail.</p>}
                    </div>
                )}
            </div>
            
            <div className="flex flex-col sm:flex-row gap-2">
                 <Button onClick={handleSaveLocally} variant="outline" className="flex-1 gap-2" disabled={!recordedVideoBlob || recordingState === 'uploading'}>
                    <Download size={18} /> {isLocallySaved ? "Saved Locally" : "Save to Device"}
                </Button>
                <Button onClick={handleUpload} className="flex-1 gap-2 bg-primary hover:bg-primary/90 text-primary-foreground" 
                        disabled={!recordedVideoBlob || selectedThumbnailIndex === null || !title.trim() || recordingState === 'uploading' || (potentialThumbnails.some(t=>t) && (!potentialThumbnailBlobs[selectedThumbnailIndex!] || potentialThumbnailBlobs[selectedThumbnailIndex!]?.size === 0))}>
                {recordingState === 'uploading' ? <Loader2 className="animate-spin" /> : <UploadCloud size={18} />}
                {recordingState === 'uploading' ? `Uploading... ${Math.round(uploadProgress)}%` : 'Upload Video'}
                </Button>
            </div>
             {recordingState === 'uploading' && <Progress value={uploadProgress} className="w-full h-2 mt-2" />}
          </div>
        )}

      </CardContent>
      <CardFooter className="pt-4 border-t">
        <Button onClick={() => resetRecorderState(true)} variant="outline" className="w-full sm:w-auto" disabled={recordingState === 'recording' || recordingState === 'uploading' || ffmpegLoading}>
            <RefreshCcw size={16} className="mr-2" /> Reset Recorder
        </Button>
      </CardFooter>
    </Card>
  );
}

