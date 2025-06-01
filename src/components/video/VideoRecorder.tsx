
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
import { Video, Mic, Square, Download, UploadCloud, AlertCircle, CheckCircle, Loader2, Settings2, Camera, Film, RefreshCcw } from 'lucide-react';
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

  useEffect(() => {
    if (!isAdmin && user) { // Redirect if not admin but logged in
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

  const requestPermissionsAndSetup = async () => {
    console.log("Requesting media permissions...");
    setError(null);
    setRecordingState('permission');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      mediaStreamRef.current = stream;
      if (videoPreviewRef.current) {
        videoPreviewRef.current.srcObject = stream;
        videoPreviewRef.current.muted = true; // Mute live preview
        videoPreviewRef.current.controls = false;
        videoPreviewRef.current.play().catch(e => console.warn("Error playing live preview on setup:", e));
      }
      setRecordingState('idle'); 
      console.log("Media permissions granted and stream set up.");
    } catch (err) {
      console.error("Error accessing media devices:", err);
      setError("Failed to access camera/microphone. Please check permissions and ensure your browser supports media recording.");
      setRecordingState('error');
    }
  };
  
  const startRecording = async () => {
    console.log("Attempting to start recording...");
    if (!mediaStreamRef.current || !mediaStreamRef.current.active) {
      console.log("Media stream not available or not active. Requesting permissions first.");
      await requestPermissionsAndSetup();
      if (!mediaStreamRef.current || !mediaStreamRef.current.active) {
        setError("Cannot start recording: Media stream is not active even after permission request.");
        setRecordingState('error');
        return;
      }
    }
    
    if (mediaStreamRef.current && mediaStreamRef.current.active && (!mediaRecorderRef.current || mediaRecorderRef.current.state !== 'recording')) {
      console.log("Proceeding to start recording setup.");
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

      // Ensure video preview is showing live camera feed
      if (videoPreviewRef.current && videoPreviewRef.current.srcObject !== mediaStreamRef.current) {
          console.log("Resetting video preview to live camera feed.");
          videoPreviewRef.current.srcObject = mediaStreamRef.current;
          videoPreviewRef.current.src = ""; 
          videoPreviewRef.current.controls = false;
          videoPreviewRef.current.muted = true;
          videoPreviewRef.current.play().catch(e => console.warn("Error replaying live preview before recording:", e));
      }


      let chosenMimeType = '';
      const isIOS = typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
      const mp4Simple = 'video/mp4';
      const mp4Avc = 'video/mp4; codecs="avc1.42E01E"'; // A common H.264 profile
      const webmFull = 'video/webm; codecs="vp9,opus"';
      const webmSimple = 'video/webm';

      if (isIOS) {
          if (MediaRecorder.isTypeSupported(mp4Avc)) {
              chosenMimeType = mp4Avc;
          } else if (MediaRecorder.isTypeSupported(mp4Simple)) {
              chosenMimeType = mp4Simple;
          }
          console.log(`iOS detected. Preferred MIME type: ${chosenMimeType || 'Browser default for MP4'}`);
      } else {
          if (MediaRecorder.isTypeSupported(webmFull)) {
              chosenMimeType = webmFull;
          } else if (MediaRecorder.isTypeSupported(webmSimple)) {
              chosenMimeType = webmSimple;
          } else if (MediaRecorder.isTypeSupported(mp4Avc)) {
              chosenMimeType = mp4Avc;
          } else if (MediaRecorder.isTypeSupported(mp4Simple)) {
              chosenMimeType = mp4Simple;
          }
      }
      
      const options: MediaRecorderOptions = {};
      if (chosenMimeType) {
        options.mimeType = chosenMimeType;
        console.log(`Attempting to record with explicit MIME type: ${options.mimeType}`);
      } else {
        console.warn("No preferred MIME type supported or determined. Letting browser choose a default.");
      }

      try {
        // Re-instantiate MediaRecorder for each recording session
        mediaRecorderRef.current = new MediaRecorder(mediaStreamRef.current, options);
        console.log(`MediaRecorder instantiated. Requested MIME type: ${options.mimeType || 'browser default'}. Actual initial state: ${mediaRecorderRef.current.state}`);
      } catch (e) {
        console.error("Error creating MediaRecorder instance:", e);
        const errorMsg = e instanceof Error ? e.message : String(e);
        setError(`Failed to initialize recorder: ${errorMsg}. Try a different browser or check permissions.`);
        setRecordingState('error');
        return;
      }
      
      mediaRecorderRef.current.onstart = () => {
        actualMimeTypeRef.current = mediaRecorderRef.current?.mimeType || chosenMimeType || '';
        console.log(`MediaRecorder.onstart event fired. Actual MIME type: ${actualMimeTypeRef.current}. State: ${mediaRecorderRef.current?.state}`);
        setRecordingState('recording');
        let seconds = 0;
        recordingTimerRef.current = setInterval(() => {
          seconds++;
          setDuration(seconds);
          if (seconds * 1000 >= MAX_RECORDING_TIME_MS) {
            console.log("Max recording time reached. Stopping recording.");
            stopRecording();
            setError("Maximum recording time reached (30 minutes).");
          }
        }, 1000);
      };

      mediaRecorderRef.current.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
          console.log(`MediaRecorder.ondataavailable: chunk size ${event.data.size}, total chunks ${recordedChunksRef.current.length}`);
        } else {
          console.log("MediaRecorder.ondataavailable: received empty chunk.");
        }
      };

      mediaRecorderRef.current.onstop = async () => {
        console.log("MediaRecorder.onstop event fired. State: " + mediaRecorderRef.current?.state);
        if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
        
        if (recordedChunksRef.current.length === 0) {
          console.warn("No data recorded (recordedChunksRef is empty at onstop).");
          setError("No video data was recorded. Please try recording for a few seconds.");
          setRecordingState('error');
          if (mediaStreamRef.current && videoPreviewRef.current) { // Attempt to restore live preview
            videoPreviewRef.current.srcObject = mediaStreamRef.current;
            videoPreviewRef.current.src = "";
            videoPreviewRef.current.controls = false;
            videoPreviewRef.current.muted = true;
            videoPreviewRef.current.play().catch(e => console.warn("Error replaying live preview after empty stop:", e));
          }
          return;
        }

        let blobMimeType = actualMimeTypeRef.current;
        if (isIOS && (!blobMimeType || !blobMimeType.startsWith('video/mp4'))) {
            console.log(`iOS onstop: Overriding blob MIME type to 'video/mp4'. Original was: '${blobMimeType}'`);
            blobMimeType = mp4Simple; // Use the simplest MP4 for blob creation on iOS
        } else if (!blobMimeType) {
            blobMimeType = isIOS ? mp4Simple : webmSimple;
            console.warn(`onstop: actualMimeTypeRef.current was empty. Falling back to: ${blobMimeType}`);
        }
        console.log(`Creating blob with type: ${blobMimeType}. Chunks count: ${recordedChunksRef.current.length}`);
        
        const blob = new Blob(recordedChunksRef.current, { type: blobMimeType });
        console.log(`Recorded Blob created. Size: ${blob.size}, Type: ${blob.type}`);

        if (blob.size === 0) {
            console.warn("Recorded blob size is 0 after creation.");
            setError("Recorded video is empty. Please try recording for a longer duration.");
            setRecordingState('error');
            return;
        }

        setRecordedVideoBlob(blob);
        const url = URL.createObjectURL(blob);
        setRecordedVideoUrl(url);

        if (videoPreviewRef.current) {
          videoPreviewRef.current.srcObject = null; 
          videoPreviewRef.current.src = ""; // Clear previous src thoroughly
          videoPreviewRef.current.src = url; // Assign the new blob URL
          videoPreviewRef.current.controls = true;
          videoPreviewRef.current.muted = false; // Unmute for review

          videoPreviewRef.current.onloadedmetadata = async () => {
             console.log("Video metadata loaded successfully for preview.");
             if(videoPreviewRef.current && videoPreviewRef.current.duration > 0 && Number.isFinite(videoPreviewRef.current.duration)) {
                const videoDuration = Math.round(videoPreviewRef.current.duration);
                console.log(`Actual video duration from metadata: ${videoDuration}s`);
                setDuration(videoDuration);
                await generatePotentialThumbnails(url, videoDuration);
             } else if (videoPreviewRef.current) {
                console.warn("Video duration is 0 or invalid after loading metadata for preview. Attempting fallback thumbnail generation.");
                setDuration(0); // Set duration to 0 if invalid
                await generatePotentialThumbnails(url, 0.1); // Try with a small fixed time
             }
             setRecordingState('stopped'); // Recording successfully processed
          };
          videoPreviewRef.current.onerror = (e) => {
            console.error("Error loading recorded video in preview element.", e);
            setError("Could not load the recorded video for preview and thumbnail generation. The recording might be corrupted or in an unsupported format for preview.");
            setRecordingState('error'); // Error in loading for preview
          }
          console.log(`Setting video preview src to: ${url}. Initiating load.`);
          videoPreviewRef.current.load(); // Explicitly call load
          videoPreviewRef.current.play()
            .then(() => console.log("Video preview playback attempt initiated."))
            .catch(playError => {
              console.error("Error trying to play video preview:", playError);
              // Don't set state to error just for play failure, metadata might still load
            });
        } else {
            console.error("videoPreviewRef.current is null in onstop handler.");
            setError("Internal error: Video preview element not found after recording.");
            setRecordingState('error');
        }
      };
      
      mediaRecorderRef.current.onerror = (event: Event) => {
        console.error("MediaRecorder.onerror event fired:", event);
        let errorDetail = "Unknown recording error.";
        const castEvent = event as any; // Cast to any to access potential error property
        if (castEvent.error && castEvent.error instanceof Error) {
            errorDetail = castEvent.error.message;
            console.error("MediaRecorder DOMException/Error name:", castEvent.error.name);
            console.error("MediaRecorder DOMException/Error message:", castEvent.error.message);
        } else if (castEvent.name) { // For older DOMError
            errorDetail = castEvent.name;
        } else if (typeof event.type === 'string') {
             errorDetail = `Event type: ${event.type}`;
        }
        setError(`A recording error occurred: ${errorDetail}. Please try again or use a different browser/device.`);
        setRecordingState('error');
        if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
        console.log("MediaRecorder.onerror: Set recordingState to 'error'. Cleared timer.");
      };

      console.log("Calling mediaRecorderRef.current.start()...");
      mediaRecorderRef.current.start(); // Start recording
      console.log(`MediaRecorder state immediately after start() call: ${mediaRecorderRef.current.state}`);
      
      // Diagnostic log for state shortly after start
      setTimeout(() => {
        if (mediaRecorderRef.current) {
            console.log(`MediaRecorder state after 100ms: ${mediaRecorderRef.current.state}`);
            if (mediaRecorderRef.current.state !== 'recording' && recordingState !== 'error') {
                 console.warn("MediaRecorder not in 'recording' state 100ms after start, and no explicit error state yet.");
                 // This could indicate start() failed silently or stopped very quickly
            }
        }
      }, 100);

    } else if (mediaRecorderRef.current?.state === 'recording') {
        console.log("Recording is already in progress.");
    } else {
        console.error("Could not start recording due to unexpected state or missing stream.");
        setError("Could not start recording. Please ensure camera/mic are enabled and try again.");
        setRecordingState('error');
    }
  };

  const stopRecording = () => {
    console.log("Stop recording called.");
    if (mediaRecorderRef.current && 
        (mediaRecorderRef.current.state === 'recording' || mediaRecorderRef.current.state === 'paused')) {
      console.log(`Stopping MediaRecorder. Current state: ${mediaRecorderRef.current.state}`);
      mediaRecorderRef.current.stop();
      // onstop handler will take care of timer and state
    } else {
      console.warn("Stop recording called, but MediaRecorder not in a stoppable state. State:", mediaRecorderRef.current?.state);
      // If it was in a weird state, try to clean up
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      // setRecordingState('idle'); // Or error depending on context
    }
  };
  
  const stopMediaStream = () => {
     if (mediaStreamRef.current) {
      console.log("Stopping media stream tracks.");
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }
     if (videoPreviewRef.current) {
        videoPreviewRef.current.srcObject = null;
     }
  }

  const generateSpecificThumbnail = (videoUrl: string, time: number, index: number): Promise<void> => {
    return new Promise((resolve, reject) => {
      const videoElement = document.createElement('video');
      videoElement.preload = 'metadata'; 
      videoElement.muted = true; 
      videoElement.src = videoUrl;
      videoElement.crossOrigin = "anonymous"; // Helpful if blob URL is treated as cross-origin by canvas

      videoElement.onloadedmetadata = () => {
        if (videoElement.duration === 0 && time > 0.01) { // if duration is 0, seeking might not work
            console.warn(`Thumbnail gen: video duration is 0 for ${videoUrl}. Cannot seek to ${time}s.`);
            videoElement.remove();
            return reject(new Error("Video duration is 0, cannot generate thumbnail by seeking."));
        }
        videoElement.currentTime = Math.min(time, videoElement.duration || time); // Ensure time is within bounds
        console.log(`Thumbnail gen: video ${index} currentTime set to ${videoElement.currentTime} (requested ${time}) for ${videoUrl}`);
      };
      
      videoElement.onseeked = () => { 
        console.log(`Thumbnail gen: video ${index} seeked to ${videoElement.currentTime}. Capturing frame.`);
        const canvas = document.createElement('canvas');
        // If videoWidth is 0, it means the video data isn't really loaded for rendering yet.
        if(videoElement.videoWidth === 0 || videoElement.videoHeight === 0) {
            console.warn(`Thumbnail gen: video ${index} dimensions are 0 at onseeked. Width: ${videoElement.videoWidth}, Height: ${videoElement.videoHeight}`);
            videoElement.remove();
            // Try to resolve to avoid promise staying pending, but indicate failure.
            return resolve(); // Or reject(new Error("Video dimensions not available for thumbnail."))
        }
        
        const targetWidth = Math.min(videoElement.videoWidth, 320); 
        const scaleFactor = targetWidth / videoElement.videoWidth;
        canvas.width = targetWidth;
        canvas.height = videoElement.videoHeight * scaleFactor;

        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
          canvas.toBlob((blob) => {
            if (blob) {
              const blobUrl = URL.createObjectURL(blob);
              setPotentialThumbnails(prev => {
                const newThumbs = [...prev];
                newThumbs[index] = blobUrl;
                return newThumbs;
              });
              setPotentialThumbnailBlobs(prev => {
                const newBlobs = [...prev];
                newBlobs[index] = blob;
                return newBlobs;
              });
              console.log(`Thumbnail gen: video ${index} blob created successfully.`);
            } else {
              console.warn(`Thumbnail gen: video ${index} canvas.toBlob() resulted in null blob.`);
            }
            videoElement.remove();
            resolve();
          }, 'image/jpeg', 0.85);
        } else {
          console.error(`Thumbnail gen: video ${index} canvas context not available.`);
          videoElement.remove();
          reject(new Error("Canvas context not available for thumbnail generation."));
        }
      };
      
      videoElement.onerror = (e) => {
          console.error(`Thumbnail gen: Error loading video ${index} for thumbnail at time ${time}s. Event:`, e);
          videoElement.remove();
          reject(new Error(`Error loading video for thumbnail at time ${time}s.`));
      }
      videoElement.load(); // Start loading the video
    });
  };

  const generatePotentialThumbnails = async (videoUrl: string, videoDuration: number) => {
    console.log(`Generating potential thumbnails for video URL: ${videoUrl}, duration: ${videoDuration}s`);
    if (videoDuration <= 0.01 && videoUrl) { 
        console.warn("Video duration is near zero or invalid, attempting to generate a single thumbnail at 0.01s");
        try {
            await generateSpecificThumbnail(videoUrl, 0.01, 0);
        } catch(error) {
             console.error("Error generating fallback thumbnail for near-zero duration video:", error);
        }
        return;
    }
    if (videoDuration <= 0) {
        console.error("Cannot generate thumbnails: video duration is invalid or zero.");
        return;
    }

    const times = [
      Math.min(1, videoDuration * 0.1), 
      Math.max(0.01, videoDuration * 0.5), 
      Math.max(0.01, videoDuration * 0.9)  
    ].map(t => Math.max(0.01, t)); 

    const uniqueTimes = [...new Set(times)].slice(0, NUM_THUMBNAILS_TO_GENERATE);
    
    console.log("Thumbnail generation times:", uniqueTimes);
    try {
      for (let i = 0; i < uniqueTimes.length; i++) {
        await generateSpecificThumbnail(videoUrl, uniqueTimes[i], i);
      }
      console.log("Completed generation of potential thumbnails.");
    } catch (error) {
        console.error("Error generating one or more thumbnails:", error);
    }
  };

  const getFileExtensionFromMimeType = (mimeType: string | undefined): string => {
    if (!mimeType) return 'bin';
    const simpleMimeType = mimeType.split(';')[0]; // e.g., video/webm from video/webm;codecs=vp9
    const parts = simpleMimeType.split('/');
    const subType = parts[1];
    
    if (subType) {
        // Common mappings
        if (subType === 'mp4') return 'mp4';
        if (subType === 'webm') return 'webm';
        if (subType === 'quicktime') return 'mov';
        if (subType === 'x-matroska') return 'mkv';
        return subType;
    }
    return 'bin';
  };

  const handleSaveLocally = () => {
    if (recordedVideoBlob && recordedVideoUrl) {
      const a = document.createElement('a');
      a.href = recordedVideoUrl;
      const safeTitle = title.replace(/[^a-z0-9_]+/gi, '_').toLowerCase() || 'recorded_video';
      const extension = getFileExtensionFromMimeType(recordedVideoBlob.type);
      a.download = `${safeTitle}.${extension}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      console.log(`Video saved locally as ${a.download}`);
    } else {
      console.warn("Cannot save locally: no recorded video blob or URL.");
    }
  };
  
  const resetRecorderState = () => {
    console.log("Resetting recorder state.");
    setTitle(''); setDescription(''); setKeywords(''); setFeatured(false);
    setRecordedVideoBlob(null); 
    if(recordedVideoUrl) URL.revokeObjectURL(recordedVideoUrl);
    setRecordedVideoUrl(null); 
    potentialThumbnails.forEach(url => { if (url) URL.revokeObjectURL(url); });
    setPotentialThumbnails(Array(NUM_THUMBNAILS_TO_GENERATE).fill(null));
    setPotentialThumbnailBlobs(Array(NUM_THUMBNAILS_TO_GENERATE).fill(null));
    setSelectedThumbnailIndex(0);
    setDuration(0);
    actualMimeTypeRef.current = '';
    recordedChunksRef.current = [];
    // stopMediaStream(); // Stop current stream if any, done by requestPermissionsAndSetup
    if (videoPreviewRef.current) {
      videoPreviewRef.current.src = ""; 
      videoPreviewRef.current.srcObject = null;
      videoPreviewRef.current.controls = false;
      videoPreviewRef.current.muted = true;
    }
    setRecordingState('idle');
    requestPermissionsAndSetup(); // Re-request to ensure preview is active
  };


  const handleUpload = async (event: FormEvent) => {
    event.preventDefault();
    const selectedThumbnailBlob = potentialThumbnailBlobs[selectedThumbnailIndex];

    if (!recordedVideoBlob || !selectedThumbnailBlob || !user || !doctorProfile) {
      setError("Missing video data, selected thumbnail, or user information. Please ensure recording is complete and a thumbnail is selected.");
      console.error("Upload precondition failed: Missing data.", {recordedVideoBlob, selectedThumbnailBlob, user, doctorProfile});
      return;
    }
    if (!title.trim()) {
      setError("Video title is required.");
      return;
    }

    console.log("Starting upload process...");
    setRecordingState('uploading');
    setError(null);
    setSuccessMessage(null);
    setUploadProgress(0);

    try {
      const safeTitle = title.replace(/[^a-z0-9_]+/gi, '_').toLowerCase();
      const timestamp = Date.now();
      const videoExtension = getFileExtensionFromMimeType(recordedVideoBlob.type || actualMimeTypeRef.current);
      const videoFileName = `${safeTitle}_${timestamp}.${videoExtension}`;
      const thumbnailFileName = `thumbnail_${safeTitle}_${timestamp}.jpg`; // Thumbnails are always jpeg

      console.log(`Uploading video: ${videoFileName}, thumbnail: ${thumbnailFileName}`);

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
      console.log("Video uploaded to:", videoUrl);
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
      console.log("Thumbnail uploaded to:", thumbnailUrl);
      setUploadProgress(100);

      const videoId = uuidv4();
      const videoData: Omit<VideoMeta, 'id' | 'createdAt' | 'permalink'> = {
        title,
        description,
        doctorId: doctorProfile.uid,
        doctorName: doctorProfile.displayName || doctorProfile.email || 'Unknown Doctor',
        videoUrl,
        thumbnailUrl,
        duration: formatTime(duration),
        recordingDuration: duration,
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
      console.log("Video metadata saved to Firestore with ID:", videoId);

      setSuccessMessage("Video uploaded and metadata saved successfully!");
      setRecordingState('success');
      resetRecorderState(); // Reset after successful upload
      
    } catch (err) {
      console.error("Upload failed:", err);
      setError(`Upload failed: ${err instanceof Error ? err.message : String(err)}`);
      setRecordingState('error');
    } finally {
      setUploadProgress(0); // Reset progress even on error
    }
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
      {error && (
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
            <div className="aspect-video bg-slate-900 rounded-t-lg overflow-hidden border-b border-slate-700 shadow-inner relative">
                <video ref={videoPreviewRef} className="w-full h-full object-contain bg-black" playsInline />
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
                {recordingState === 'idle' && !mediaStreamRef.current && (
                <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center bg-black/30">
                    <Camera size={56} className="text-slate-400 mb-4" />
                    <p className="text-slate-300 mb-6 text-lg">Camera and microphone access needed to record.</p>
                    <Button onClick={requestPermissionsAndSetup} variant="default" size="lg" className="gap-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg text-base px-6 py-3">
                    <Settings2 className="h-5 w-5" /> Setup Camera & Mic
                    </Button>
                </div>
                )}
                 {recordingState === 'idle' && mediaStreamRef.current && !recordedVideoUrl && (
                   <div className="absolute bottom-4 left-1/2 -translate-x-1/2">
                     <Button onClick={startRecording} className="gap-2 bg-green-500 hover:bg-green-600 text-white rounded-lg px-8 py-4 text-lg shadow-xl animate-pulse" size="lg">
                        <Video className="h-6 w-6" /> Start Recording
                    </Button>
                   </div>
                )}
            </div>
        </CardContent>
         <CardFooter className="pt-6 pb-6 bg-slate-50 dark:bg-slate-800/50 border-t dark:border-slate-700 flex flex-col sm:flex-row gap-4 items-center justify-center">
            {mediaStreamRef.current && (recordingState === 'idle' || recordingState === 'stopped') && !recordedVideoUrl && !successMessage && (
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
               <Button onClick={resetRecorderState} className="gap-2 bg-blue-500 hover:bg-blue-600 text-white w-full sm:w-auto rounded-lg px-6 py-3 text-base" size="lg">
                  <RefreshCcw className="h-5 w-5" /> Record Another Video
              </Button>
            )}
         </CardFooter>
      </Card>

      {recordedVideoUrl && recordingState === 'stopped' && (
        <Card className="shadow-xl mt-8 rounded-xl">
          <CardHeader className="border-b dark:border-slate-700">
            <CardTitle className="text-2xl font-headline">Review & Upload Video</CardTitle>
            <CardDescription>Duration: {formatTime(duration)}. Review your video, select a thumbnail, and provide details before uploading.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-8 pt-6">
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
                      <Film size={32} className="text-muted-foreground" />
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
             <Button onClick={resetRecorderState} variant="ghost" className="gap-2 w-full sm:w-auto rounded-lg text-base px-5 py-2.5">
                <RefreshCcw className="h-5 w-5" /> Record Again
            </Button>
            <Button type="submit" form="upload-form-video-recorder" disabled={recordingState === 'uploading'} className="gap-2 flex-grow w-full sm:w-auto bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg text-base px-5 py-2.5">
              {recordingState === 'uploading' ? <Loader2 className="h-5 w-5 animate-spin" /> : <UploadCloud className="h-5 w-5" />}
              {recordingState === 'uploading' ? 'Uploading...' : 'Upload Video'}
            </Button>
          </CardFooter>
        </Card>
      )}
      
      {recordingState === 'uploading' && (
        <Card className="mt-8 rounded-xl">
          <CardContent className="p-6">
            <Progress value={uploadProgress} className="w-full h-3 rounded-full" />
            <p className="text-base text-center mt-3 text-muted-foreground">Uploading video... {Math.round(uploadProgress)}%</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

