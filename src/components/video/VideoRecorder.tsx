
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
const NUM_THUMBNAILS_TO_GENERATE = 3; // Let's keep this at 3 for the main recorder for now, or align with iOS one if preferred.
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
  }, [isAdmin, user, router]);

  const formatTime = (totalSeconds: number): string => {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
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
  };

  const isStreamValid = (stream: MediaStream | null): boolean => {
    console.log("VideoRecorder (isStreamValid): Validating stream object:", stream);
    if (!stream) {
      console.warn("VideoRecorder (isStreamValid): Stream is null or undefined.");
      return false;
    }
    if (!(stream instanceof MediaStream)) {
      console.warn("VideoRecorder (isStreamValid): Provided object is not an instance of MediaStream. Value:", stream);
      return false;
    }
    if (!stream.active) {
      console.warn("VideoRecorder (isStreamValid): Stream is not active.");
      return false;
    }
    if (stream.getTracks().length === 0) {
      console.warn("VideoRecorder (isStreamValid): Stream has no tracks.");
      return false;
    }
    const videoTrack = stream.getVideoTracks()[0];
    if (!videoTrack) {
      console.warn("VideoRecorder (isStreamValid): Stream has no video tracks.");
      return false;
    }
    if (videoTrack.readyState !== 'live') {
      console.warn(`VideoRecorder (isStreamValid): Video track is not live. State: ${videoTrack.readyState}`);
      return false;
    }
    console.log("VideoRecorder (isStreamValid): Stream appears to be valid and active.");
    return true;
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
      // Ensure any old stream is fully stopped before requesting a new one
      if (mediaStreamRef.current) {
        console.log("VideoRecorder: Stopping existing stream before requesting new permissions.");
        stopMediaStream();
      }

      const stream = await navigator.mediaDevices.getUserMedia(constraints);

      if (!isStreamValid(stream)) {
        console.error("VideoRecorder: getUserMedia succeeded but returned an invalid or inactive stream.");
        stream?.getTracks().forEach(track => track.stop()); // Cleanup potentially problematic stream
        throw new Error("Camera stream acquired but is not active or valid. Please check permissions and try again.");
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
      setError(`Failed to access camera/microphone: ${errorMessage}. Please check permissions and ensure your browser supports media recording.`);
      setRecordingState('error');
    }
  };

const startRecording = async () => {
    console.log("VideoRecorder: Attempting to start recording...");
    setError(null); setSuccessMessage(null);

    // Validate current stream or attempt re-setup
    let streamToUse = mediaStreamRef.current;
    if (!isStreamValid(streamToUse)) {
        console.log("VideoRecorder: Current mediaStreamRef.current is invalid or missing. Attempting to request new permissions/setup.");
        // Explicitly stop any potentially lingering old stream parts before new setup
        stopMediaStream();
        await requestPermissionsAndSetup(); // This will update mediaStreamRef.current
        streamToUse = mediaStreamRef.current; // Re-assign after setup attempt
    }

    // Final check after setup attempt
    if (!isStreamValid(streamToUse)) {
        console.error("VideoRecorder: CRITICAL - MediaStream is still invalid after attempting setup. Cannot start recording.");
        setError("Failed to initialize recording: Camera stream could not be established or is invalid. Please try setting up the camera again or check browser permissions.");
        setRecordingState('error');
        return;
    }

    console.log("VideoRecorder: Stream validation passed. Proceeding to MediaRecorder setup.");
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
    setDuration(0);
    actualMimeTypeRef.current = '';

    if (videoPreviewRef.current) {
        if (videoPreviewRef.current.srcObject !== streamToUse) {
          videoPreviewRef.current.srcObject = streamToUse;
          videoPreviewRef.current.src = "";
        }
        videoPreviewRef.current.controls = false;
        videoPreviewRef.current.muted = true;
        videoPreviewRef.current.setAttribute('playsinline', 'true');
        videoPreviewRef.current.setAttribute('autoplay', 'true');
        await videoPreviewRef.current.play().catch(e => console.warn("VideoRecorder: Error replaying live preview before recording:", e));
    }

    let chosenMimeType = '';
    const mimeTypesToCheck = [
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm',
        'video/mp4;codecs=avc1.42E01E', // More specific MP4
        'video/mp4', // Generic MP4
      ];

    for (const type of mimeTypesToCheck) {
      if (MediaRecorder.isTypeSupported(type)) { chosenMimeType = type; break; }
    }
    if (!chosenMimeType) console.warn("VideoRecorder: No explicitly supported MIME type found. Letting browser choose.");
    // actualMimeTypeRef.current will be set by recorder.onstart from recorder.mimeType

    const options: MediaRecorderOptions = {};
    if (chosenMimeType) options.mimeType = chosenMimeType;

    console.log("VideoRecorder: MediaRecorder options:", options);

      try {
        mediaRecorderRef.current = new MediaRecorder(streamToUse!, options);
        console.log(`VideoRecorder: MediaRecorder instantiated. Requested MIME type: ${options.mimeType || 'browser default'}. Actual initial state: ${mediaRecorderRef.current.state}`);
      } catch (e) {
        console.error("VideoRecorder: Error creating MediaRecorder instance:", e);
        setError(`Failed to initialize recorder: ${e instanceof Error ? e.message : String(e)}. Try a different browser or check device compatibility.`);
        setRecordingState('error'); return;
      }

    mediaRecorderRef.current.onstart = () => {
      if(mediaRecorderRef.current) actualMimeTypeRef.current = mediaRecorderRef.current.mimeType || chosenMimeType || '';
      console.log(`VideoRecorder: MediaRecorder.onstart event fired. Actual MIME Type: ${actualMimeTypeRef.current}. State: ${mediaRecorderRef.current?.state}`);
      setRecordingState('recording');
      let seconds = 0;
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      setDuration(0);
      recordingTimerRef.current = setInterval(() => {
        seconds++; setDuration(seconds);
        if (seconds * 1000 >= MAX_RECORDING_TIME_MS) { stopRecording(); setError("Maximum recording time reached.");}
      }, 1000);
    };

    mediaRecorderRef.current.ondataavailable = (event) => {
      if (event.data.size > 0) recordedChunksRef.current.push(event.data);
    };

    mediaRecorderRef.current.onstop = async () => {
      console.log(`VideoRecorder: MediaRecorder.onstop event fired. Chunks collected: ${recordedChunksRef.current.length}`);
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);

      const currentMimeType = actualMimeTypeRef.current || mediaRecorderRef.current?.mimeType || 'video/webm';
      const blob = new Blob(recordedChunksRef.current, { type: currentMimeType });
      console.log(`VideoRecorder: Recorded Blob created. Size: ${blob.size}, Type: ${blob.type}`);

      if (blob.size === 0) {
          console.warn("VideoRecorder: Recorded blob size is 0. This often indicates an issue with MediaRecorder or an extremely short recording.");
          setError("Recorded video is empty. Please try recording for a few seconds.");
          // Do not set to 'error' state here if stream is still valid for retry
          if (mediaStreamRef.current && videoPreviewRef.current && isStreamValid(mediaStreamRef.current)) {
                videoPreviewRef.current.srcObject = mediaStreamRef.current;
                videoPreviewRef.current.src = "";
                videoPreviewRef.current.controls = false;
                videoPreviewRef.current.muted = true;
                await videoPreviewRef.current.play().catch(e => console.warn("VideoRecorder: Error replaying live preview after empty stop:", e));
                setRecordingState('idle'); // Back to idle to allow another recording attempt
          } else {
                setRecordingState('error'); // If stream also became invalid
          }
          return;
      }

      setRecordedVideoBlob(blob);
      const url = URL.createObjectURL(blob);
      setRecordedVideoUrl(url);

      let previewSetupSuccess = false;
      if (videoPreviewRef.current) {
          videoPreviewRef.current.srcObject = null;
          videoPreviewRef.current.src = "";
          videoPreviewRef.current.src = url;
          videoPreviewRef.current.controls = true;
          videoPreviewRef.current.muted = false;
          videoPreviewRef.current.setAttribute('playsinline', 'true');
          videoPreviewRef.current.removeAttribute('autoplay');

          try {
            await new Promise<void>((resolvePromise, rejectPromise) => {
                if (!videoPreviewRef.current) {
                    rejectPromise(new Error("Video preview ref became null"));
                    return;
                }
                videoPreviewRef.current.onloadedmetadata = () => {
                    console.log("VideoRecorder: Video metadata loaded successfully for preview.");
                    previewSetupSuccess = true;
                    resolvePromise();
                };
                videoPreviewRef.current.onerror = (e) => {
                    const videoError = videoPreviewRef.current?.error;
                    console.error("VideoRecorder: Error loading recorded video in preview element. Event:", e, "VideoError:", videoError);
                    setError(`Could not load the recorded video for preview. Code: ${videoError?.code}, Message: ${videoError?.message || 'Unknown media error'}. The recording might be corrupted or in an unsupported format for direct browser preview. Try saving locally and opening with VLC or a similar player.`);
                    previewSetupSuccess = false; 
                    resolvePromise(); 
                };
                videoPreviewRef.current.load();
            });
          } catch (previewError) {
             console.error("VideoRecorder: Exception during preview setup promise:", previewError);
             previewSetupSuccess = false;
          }
      } else {
          console.error("VideoRecorder: videoPreviewRef.current is null in onstop handler.");
      }

      if (blob.size > 0) {
        console.log(`VideoRecorder: onstop - Blob is valid (size: ${blob.size}). Preview setup success: ${previewSetupSuccess}. Proceeding to thumbnails using timer duration: ${duration}s.`);
        await generatePotentialThumbnails(url, duration); 
      }
      setRecordingState('stopped'); 
    };

    mediaRecorderRef.current.onerror = (event: Event) => {
      console.error("VideoRecorder: MediaRecorder.onerror event fired:", event);
      let errorDetail = "Unknown recording error.";
      const castEvent = event as any;
      if (castEvent.error && castEvent.error.name) errorDetail = `Name: ${castEvent.error.name}, Message: ${castEvent.error.message}`;
      setError(`A recording error occurred: ${errorDetail}.`);
      setRecordingState('error');
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    };

    try {
      console.log("VideoRecorder: Calling mediaRecorderRef.current.start() with timeslice:", RECORDING_TIMESLICE_MS);
      mediaRecorderRef.current.start(RECORDING_TIMESLICE_MS);
      console.log(`VideoRecorder: MediaRecorder state immediately after start() call: ${mediaRecorderRef.current.state}`);

      setTimeout(() => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'recording' && recordingState !== 'error') {
             console.warn("VideoRecorder: MediaRecorder NOT in 'recording' state 100ms after start(). Current app recordingState:", recordingState, "MediaRecorder state:", mediaRecorderRef.current.state);
             if (mediaRecorderRef.current.state === 'inactive' && recordedChunksRef.current.length === 0 && recordingState !== 'error') {
                 setError("Recording failed to start actively or stopped immediately. Please check console logs for MediaRecorder errors. Try re-enabling camera or check browser permissions.");
                 setRecordingState('error');
             }
        }
      }, 100);
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
    }
  };

  const generateSpecificThumbnail = (videoUrl: string, time: number, index: number): Promise<void> => {
    return new Promise((resolve, reject) => {
      console.log(`VideoRecorder: generateSpecificThumbnail - Attempting for index ${index} at time ${time}s from URL (first 30 chars): ${videoUrl.substring(0,30)}...`);
      const videoElement = document.createElement('video');
      videoElement.preload = 'metadata';
      videoElement.muted = true;
      videoElement.src = videoUrl;
      videoElement.crossOrigin = "anonymous"; 

      let seekedFired = false; 

      videoElement.onloadedmetadata = () => {
        console.log(`VideoRecorder: generateSpecificThumbnail[${index}] - Metadata loaded. Reported duration: ${videoElement.duration}s. Video dimensions: ${videoElement.videoWidth}x${videoElement.videoHeight}. Seeking to ${time}s.`);
        if (videoElement.videoWidth === 0 || videoElement.videoHeight === 0) {
          console.warn(`VideoRecorder: generateSpecificThumbnail[${index}] - Video dimensions are 0x0 after metadata loaded. Thumbnail capture might be blank.`);
        }
        if (isNaN(videoElement.duration) || videoElement.duration === 0) {
          console.warn(`VideoRecorder: generateSpecificThumbnail[${index}] - Video duration is ${videoElement.duration}. This might affect seeking precisely. Continuing with requested time: ${time}`);
        }
        const seekTime = (videoElement.duration > 0 && Number.isFinite(videoElement.duration)) ? Math.min(time, videoElement.duration - 0.01) : time;
        videoElement.currentTime = Math.max(0.01, seekTime); 
      };

      videoElement.onseeked = () => {
        if (seekedFired) return; 
        seekedFired = true;
        console.log(`VideoRecorder: generateSpecificThumbnail[${index}] - Seeked to ${videoElement.currentTime}. Capturing frame.`);

        if (videoElement.videoWidth === 0 || videoElement.videoHeight === 0) {
          console.warn(`VideoRecorder: generateSpecificThumbnail[${index}] - Video dimensions are 0x0 AT SEEKED. Thumbnail capture will likely be blank or fail.`);
        }

        const canvas = document.createElement('canvas');
        const targetWidth = Math.min(videoElement.videoWidth || 320, 320); 
        const scaleFactor = (videoElement.videoWidth && videoElement.videoWidth > 0) ? targetWidth / videoElement.videoWidth : 1;
        canvas.width = targetWidth;
        canvas.height = (videoElement.videoHeight || 180) * scaleFactor; 

        if (canvas.width === 0 || canvas.height === 0) {
           console.error(`VideoRecorder: generateSpecificThumbnail[${index}] - Canvas dimensions are zero (W: ${canvas.width}, H: ${canvas.height}). Cannot drawImage.`);
           videoElement.remove(); 
           reject(new Error(`Canvas dimensions zero for thumbnail ${index}.`));
           return;
        }

        const ctx = canvas.getContext('2d');
        if (ctx) {
          try {
            ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
            canvas.toBlob((blob) => {
              if (blob && blob.size > 0) {
                const blobUrl = URL.createObjectURL(blob);
                console.log(`VideoRecorder: generateSpecificThumbnail[${index}] - Blob created successfully. Size: ${blob.size}, URL (first 30): ${blobUrl.substring(0,30)}`);
                setPotentialThumbnails(prev => { const n = [...prev]; n[index] = blobUrl; return n; });
                setPotentialThumbnailBlobs(prev => { const n = [...prev]; n[index] = blob; return n; });
              } else {
                console.warn(`VideoRecorder: generateSpecificThumbnail[${index}] - canvas.toBlob() resulted in null or empty blob.`);
              }
              videoElement.remove(); 
              resolve();
            }, 'image/jpeg', 0.85); 
          } catch(drawError) {
            console.error(`VideoRecorder: generateSpecificThumbnail[${index}] - Error drawing video to canvas:`, drawError);
            videoElement.remove(); 
            reject(new Error(`Canvas drawImage failed for thumbnail ${index}. Error: ${drawError instanceof Error ? drawError.message : String(drawError)}`));
          }
        } else {
          console.error(`VideoRecorder: generateSpecificThumbnail[${index}] - Canvas context not available.`);
          videoElement.remove(); 
          reject(new Error(`Canvas context not available for thumbnail ${index}.`));
        }
      };
      
      videoElement.onerror = (e) => {
          const vidError = videoElement.error;
          console.error(`VideoRecorder: generateSpecificThumbnail[${index}] - Error with temporary video element. Code: ${vidError?.code}, Message: ${vidError?.message}. Event:`, e);
          videoElement.remove(); 
          reject(new Error(`Error with video element for thumbnail ${index}. Code: ${vidError?.code}, Msg: ${vidError?.message}`));
      };

      console.log(`VideoRecorder: generateSpecificThumbnail[${index}] - Calling videoElement.load()`);
      videoElement.load(); 
    });
  };

  const generatePotentialThumbnails = async (videoUrl: string, videoTimerDuration: number) => {
    console.log(`VideoRecorder: generatePotentialThumbnails - Starting for video URL (first 30): ${videoUrl.substring(0,30)}..., timer duration: ${videoTimerDuration}s`);
    if (!videoUrl) {
        console.error("VideoRecorder: generatePotentialThumbnails - Cannot generate, videoUrl is null or empty.");
        return;
    }
    const effectiveDuration = videoTimerDuration > 0 ? videoTimerDuration : 0.1; 

    potentialThumbnails.forEach(url => { if (url) URL.revokeObjectURL(url); });
    setPotentialThumbnails(Array(NUM_THUMBNAILS_TO_GENERATE).fill(null));
    setPotentialThumbnailBlobs(Array(NUM_THUMBNAILS_TO_GENERATE).fill(null));
    setSelectedThumbnailIndex(null);

    if (effectiveDuration <= 0.01 && effectiveDuration !== 0) { 
        console.warn("VideoRecorder: generatePotentialThumbnails - Video duration from timer is near zero, attempting single thumbnail at 0.01s");
        try { await generateSpecificThumbnail(videoUrl, 0.01, 0); }
        catch(error) { console.error("VideoRecorder: generatePotentialThumbnails - Error generating fallback thumbnail for near-zero duration:", error); }
    } else if (effectiveDuration <= 0 && recordedVideoBlob && recordedVideoBlob.size > 0) { 
        console.warn("VideoRecorder: generatePotentialThumbnails - Timer duration is zero but blob exists, attempting single thumbnail at 0.05s");
        try { await generateSpecificThumbnail(videoUrl, 0.05, 0); }
        catch(error) { console.error("VideoRecorder: generatePotentialThumbnails - Error generating single thumbnail for zero timer duration blob:", error); }
    } else if (effectiveDuration <= 0) {
        console.warn("VideoRecorder: generatePotentialThumbnails - Effective video duration is zero or negative. Cannot generate thumbnails."); return;
    } else {
        const timePoints = Array(NUM_THUMBNAILS_TO_GENERATE).fill(null).map((_, i) => {
            const point = (effectiveDuration / (NUM_THUMBNAILS_TO_GENERATE + 1)) * (i + 1);
            return Math.max(0.01, Math.min(point, effectiveDuration - 0.01)); 
        });
        const uniqueTimes = [...new Set(timePoints)].slice(0, NUM_THUMBNAILS_TO_GENERATE); 
        console.log("VideoRecorder: generatePotentialThumbnails - Thumbnail generation time points:", uniqueTimes);
        for (let i = 0; i < uniqueTimes.length; i++) {
            try { await generateSpecificThumbnail(videoUrl, uniqueTimes[i], i); }
            catch (thumbError) { console.error(`VideoRecorder: generatePotentialThumbnails - Error for time point ${uniqueTimes[i]}:`, thumbError); }
        }
    }

    const firstValidIndex = potentialThumbnailBlobs.findIndex(blob => blob !== null && blob.size > 0);
    if (firstValidIndex !== -1) {
        setSelectedThumbnailIndex(firstValidIndex);
        console.log(`VideoRecorder: generatePotentialThumbnails - Setting selectedThumbnailIndex to first valid: ${firstValidIndex}`);
    } else {
        setSelectedThumbnailIndex(null);
        console.warn("VideoRecorder: generatePotentialThumbnails - No thumbnails were successfully generated.");
    }
    console.log(`VideoRecorder: generatePotentialThumbnails - Completed. ${firstValidIndex !== -1 ? 'At least one success.' : 'No successes.'}`);
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
    }
  };

  const resetRecorderState = (setupNewStream = true) => {
    setTitle(''); setDescription(''); setKeywords(''); setFeatured(false);
    setRecordedVideoBlob(null);
    if(recordedVideoUrl) URL.revokeObjectURL(recordedVideoUrl);
    setRecordedVideoUrl(null);
    potentialThumbnails.forEach(url => { if (url) URL.revokeObjectURL(url); });
    setPotentialThumbnails(Array(NUM_THUMBNAILS_TO_GENERATE).fill(null));
    setPotentialThumbnailBlobs(Array(NUM_THUMBNAILS_TO_GENERATE).fill(null));
    setSelectedThumbnailIndex(null);
    setDuration(0);
    actualMimeTypeRef.current = '';
    recordedChunksRef.current = [];

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
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
    if (selectedThumbnailIndex === null || !potentialThumbnailBlobs[selectedThumbnailIndex]) {
        setError("Please select a valid thumbnail before uploading.");
        return;
    }
    const selectedThumbnailBlob = potentialThumbnailBlobs[selectedThumbnailIndex!];


    if (!recordedVideoBlob || !selectedThumbnailBlob || !user || !doctorProfile) {
      setError("Missing video data, selected thumbnail, or user information.");
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
      const safeTitle = title.replace(/[^a-z0-9_]+/gi, '_').toLowerCase() || uuidv4();
      const timestamp = Date.now();
      const videoExtension = getFileExtensionFromMimeType(recordedVideoBlob.type || actualMimeTypeRef.current);
      const videoFileName = `${safeTitle}_${timestamp}.${videoExtension}`;
      const thumbnailFileName = `thumbnail_${safeTitle}_${timestamp}.jpg`;

      const videoStoragePath = await uploadFileToStorage(
        `videos/${doctorProfile.uid}`,
        recordedVideoBlob,
        videoFileName,
        (snapshot) => setUploadProgress(Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 0.9 * 100)) 
      );
      const videoUrl = await getFirebaseStorageDownloadUrl(videoStoragePath);
      setUploadProgress(90); 

      const thumbnailStoragePath = await uploadFileToStorage(
        `thumbnails/${doctorProfile.uid}`,
        selectedThumbnailBlob,
        thumbnailFileName,
         (snapshot) => setUploadProgress(Math.round(90 + (snapshot.bytesTransferred / snapshot.totalBytes) * 0.1 * 100)) 
      );
      const thumbnailUrl = await getFirebaseStorageDownloadUrl(thumbnailStoragePath);
      setUploadProgress(100);

      const videoId = uuidv4();
      const videoData: Omit<VideoMeta, 'id' | 'createdAt' | 'permalink'> = {
        title, description, doctorId: doctorProfile.uid,
        doctorName: doctorProfile.displayName || doctorProfile.email || 'Unknown Doctor',
        videoUrl, thumbnailUrl, duration: formatTime(duration), recordingDuration: duration,
        tags: keywords.split(',').map(k => k.trim()).filter(Boolean),
        viewCount: 0, featured, storagePath: videoStoragePath, thumbnailStoragePath: thumbnailStoragePath,
        videoSize: recordedVideoBlob.size, videoType: recordedVideoBlob.type || actualMimeTypeRef.current,
        comments: [],
      };

      await addVideoMetadataToFirestore({ ...videoData, videoId });

      setSuccessMessage("Video uploaded successfully!");
      setRecordingState('success');
      if (videoPreviewRef.current && recordedVideoUrl) videoPreviewRef.current.src = recordedVideoUrl; 

    } catch (err) {
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
     return ( <Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertTitle>Access Denied</AlertTitle><AlertDescription>You must be an administrator to access the video recorder.</AlertDescription></Alert>);
  }

  const showSetupCamera = recordingState === 'idle' && !mediaStreamRef.current && !successMessage;
  const showLiveRecordControls = (recordingState === 'idle' || recordingState === 'permission') && mediaStreamRef.current && !recordedVideoUrl && !successMessage;
  const showRecordingInProgress = recordingState === 'recording' || recordingState === 'paused';
  const showReviewAndUpload = (recordingState === 'stopped' || (recordingState === 'error' && recordedVideoBlob)) && recordedVideoUrl; 
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
                    playsInline muted autoPlay
                />
                {(showLiveRecordControls || showReviewAndUpload || showRecordingInProgress) && (
                    <Button onClick={handleRotatePreview} variant="outline" size="icon" className="absolute top-4 left-4 z-10 bg-black/50 text-white hover:bg-black/70 border-white/50 opacity-0 group-hover:opacity-100 transition-opacity" title="Rotate Preview">
                        <RotateCw size={20} />
                    </Button>
                )}
                {showRecordingInProgress && (
                <div className="absolute top-4 right-4 bg-red-600 text-white px-3 py-1.5 rounded-lg text-sm font-mono shadow-lg flex items-center gap-2">
                    <Mic size={18} className="animate-pulse" /> REC {formatTime(duration)}
                </div>
                )}
                 {showReviewAndUpload && recordedVideoUrl && (
                    <div className="absolute top-4 right-4 bg-blue-600 text-white px-3 py-1.5 rounded-lg text-sm font-mono shadow-lg">
                        REVIEWING - {formatTime(duration)}
                    </div>
                )}
                {showSetupCamera && (
                <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center bg-black/50">
                    <Camera size={56} className="text-slate-300 mb-4" />
                    <p className="text-slate-200 mb-6 text-lg">Camera and microphone access needed to record.</p>
                    <Button onClick={() => requestPermissionsAndSetup()} variant="default" size="lg" className="gap-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg text-base px-6 py-3">
                    <Settings2 className="h-5 w-5" /> Setup Camera & Mic
                    </Button>
                </div>
                )}
                 {showLiveRecordControls && mediaStreamRef.current && (
                   <div className="absolute bottom-4 left-1/2 -translate-x-1/2">
                     <Button onClick={startRecording} className="gap-2 bg-green-500 hover:bg-green-600 text-white rounded-full px-8 py-4 text-lg shadow-xl animate-pulse" size="lg">
                        <Video className="h-6 w-6" /> Start Recording
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
            <CardTitle className="text-2xl font-headline">Review & Upload Video</CardTitle>
            <CardDescription>Duration: {formatTime(duration)}. Review your video, select a thumbnail, and provide details before uploading. Recorded MimeType: {recordedVideoBlob?.type || actualMimeTypeRef.current || 'N/A'}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-8 pt-6">
            {(recordingState === 'error' && error && !successMessage) && (
                 <Alert variant="destructive" className="w-full">
                    <AlertCircle className="h-4 w-4" /><AlertTitle>Notice</AlertTitle><AlertDescription>{error}</AlertDescription>
                </Alert>
            )}
            <div>
              <Label className="mb-3 block text-base font-medium text-foreground">Select Thumbnail</Label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                {potentialThumbnails.map((thumbUrl, index) => (
                  thumbUrl ? (
                    <button
                      key={index}
                      type="button"
                      onClick={() => setSelectedThumbnailIndex(index)}
                      className={`relative aspect-video rounded-lg overflow-hidden border-4 transition-all duration-200 ease-in-out hover:opacity-70 focus:outline-none
                        ${selectedThumbnailIndex === index ? 'border-primary ring-4 ring-primary/50 ring-offset-2 ring-offset-background' : 'border-slate-300 dark:border-slate-600'}`}
                    >
                      <Image src={thumbUrl} alt={`Thumbnail ${index + 1}`} layout="fill" objectFit="cover" className="transition-transform group-hover:scale-105" data-ai-hint="video thumbnail"/>
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
              {selectedThumbnailIndex === null && potentialThumbnails.some(t=>t===null) && recordedVideoBlob && <p className="text-xs text-destructive mt-1">Thumbnails are generating or some failed. Please wait or re-record if they don't appear or select one that did.</p>}
               {selectedThumbnailIndex === null && potentialThumbnails.every(t=>t===null) && recordedVideoBlob && <p className="text-xs text-muted-foreground mt-1">Attempting to generate thumbnails... If they don't appear, the recorded video might be too short or problematic for thumbnail extraction.</p>}

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
            <Button
                type="submit"
                form="upload-form-video-recorder"
                disabled={recordingState === 'uploading' || !recordedVideoBlob || selectedThumbnailIndex === null || !potentialThumbnailBlobs[selectedThumbnailIndex!] }
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
             {error && ( <Alert variant="destructive" className="w-full mb-4"><AlertCircle className="h-4 w-4" /><AlertTitle>Upload Failed</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> )}
            <Progress value={uploadProgress} className="w-full h-3 rounded-full" />
            <p className="text-base text-center mt-3 text-muted-foreground">Uploading video... {Math.round(uploadProgress)}%</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

