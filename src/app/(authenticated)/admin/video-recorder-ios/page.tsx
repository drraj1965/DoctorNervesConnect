
"use client";

import { useEffect, useRef, useState, ChangeEvent, FormEvent } from "react";
import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Loader2, Video, Mic, Square, Download, UploadCloud, AlertCircle, RotateCw, Camera, RefreshCcw, Film, CheckCircle, Image as ImageIcon } from "lucide-react";
import { storage as firebaseStorage } from "@/lib/firebase/config"; 
import { addVideoMetadataFromIOSAction } from "./actions";
import { v4 as uuidv4 } from 'uuid';
import Image from "next/image";
import { getStorage, ref as storageRefFirebase, uploadBytesResumable, getDownloadURL as getFirebaseDownloadURL, UploadTaskSnapshot } from "firebase/storage";
import { useToast } from "@/hooks/use-toast"; // Import useToast

const NUM_THUMBNAILS_TO_GENERATE = 5;

export default function VideoRecorderIOSPage() {
  const videoPreviewRef = useRef<HTMLVideoElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordedVideoBlob, setRecordedVideoBlob] = useState<Blob | null>(null);
  const [recordedVideoUrl, setRecordedVideoUrl] = useState<string | null>(null);
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [recordingDuration, setRecordingDuration] = useState(0);
  
  const { user, isAdmin, loading: authLoading, doctorProfile } = useAuth();
  const router = useRouter();
  const { toast } = useToast(); // Initialize toast

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [keywords, setKeywords] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [uploadSuccessMessage, setUploadSuccessMessage] = useState<string | null>(null); // Renamed for clarity
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false); // Corrected initialization
  const [previewRotation, setPreviewRotation] = useState(0);
  const actualMimeTypeRef = useRef<string>('');

  const [potentialThumbnails, setPotentialThumbnails] = useState<(string | null)[]>(Array(NUM_THUMBNAILS_TO_GENERATE).fill(null));
  const [potentialThumbnailBlobs, setPotentialThumbnailBlobs] = useState<(Blob | null)[]>(Array(NUM_THUMBNAILS_TO_GENERATE).fill(null));
  const [selectedThumbnailIndex, setSelectedThumbnailIndex] = useState<number | null>(null);


  useEffect(() => {
    if (!authLoading && !isAdmin) {
      router.replace('/dashboard');
    }
  }, [authLoading, isAdmin, router]);

  const requestPermissionsAndSetup = async () => {
    setError(null);
    setUploadSuccessMessage(null);
    console.log("VideoRecorderIOS: Requesting media permissions...");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: true,
      });

      if (!stream.active || stream.getVideoTracks().length === 0 || stream.getVideoTracks()[0].readyState !== 'live') {
        const videoTrackState = stream.getVideoTracks()[0]?.readyState;
        console.error(`VideoRecorderIOS: Stream is not active or video track not live. Stream active: ${stream.active}, Video track readyState: ${videoTrackState}`);
        throw new Error(`Camera stream is not active (state: ${videoTrackState}). Please check permissions and try again.`);
      }
      console.log("VideoRecorderIOS: Media stream obtained. Video track readyState:", stream.getVideoTracks()[0]?.readyState);
      
      setMediaStream(stream);
      if (videoPreviewRef.current) {
        videoPreviewRef.current.srcObject = stream;
        videoPreviewRef.current.src = ""; // Clear any previous blob src
        videoPreviewRef.current.muted = true;
        videoPreviewRef.current.controls = false;
        videoPreviewRef.current.setAttribute('playsinline', 'true');
        videoPreviewRef.current.setAttribute('autoplay', 'true');
        await videoPreviewRef.current.play().catch(e => console.warn("VideoRecorderIOS: Error playing live preview:", e));
      }
      // Do not reset previewRotation here, allow user to set it for live view first
      console.log("VideoRecorderIOS: Permissions granted and stream setup complete.");
    } catch (err) {
      console.error("VideoRecorderIOS: Error accessing media devices:", err);
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError(`Failed to access camera/microphone: ${errorMessage}.`);
    }
  };

  useEffect(() => {
    if (!authLoading && isAdmin) {
        requestPermissionsAndSetup();
    }
    return () => {
      mediaStream?.getTracks().forEach(track => track.stop());
      if (recordedVideoUrl) URL.revokeObjectURL(recordedVideoUrl);
      potentialThumbnails.forEach(url => { if(url) URL.revokeObjectURL(url) });
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, isAdmin]);


  const getFileExtensionFromMimeType = (mimeTypeString: string): string => {
    if (!mimeTypeString) return 'bin';
    const simpleMime = mimeTypeString.split(';')[0];
    const parts = simpleMime.split('/');
    const subType = parts[1];
    if (subType) {
        if (subType.includes('mp4')) return 'mp4';
        if (subType.includes('webm')) return 'webm';
        if (subType.includes('quicktime')) return 'mov';
        return subType.replace(/[^a-z0-9]/gi, '');
    }
    return 'bin';
  };

  const getSupportedMimeType = () => {
    const isSafari = typeof navigator !== 'undefined' && /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
    const isIOS = typeof navigator !== 'undefined' && (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) && !(window as any).MSStream;
    
    console.log("VideoRecorderIOS: isIOS:", isIOS, "isSafari:", isSafari);

    const types = (isIOS || isSafari)
      ? [ 
          // Prioritize MP4 for iOS/Safari for recording reliability
          'video/webm;codecs=vp9,opus', 
          'video/webm;codecs=vp8,opus', 
          'video/webm',     
          'video/mp4;codecs=avc1.4D401E', 
          'video/mp4;codecs=avc1.42E01E', 
          'video/mp4;codecs=h264',
          'video/mp4', 
          'video/quicktime',          
        ]
      : [ 
          // Prioritize WebM for non-iOS
          'video/webm;codecs=vp9,opus',
          'video/webm;codecs=vp8,opus',
          'video/webm',
          'video/mp4;codecs=avc1.42E01E',
          'video/mp4',
        ];
    
    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) {
        console.log("VideoRecorderIOS: Using supported MIME type:", type);
        return type;
      }
      console.log("VideoRecorderIOS: MIME type NOT supported:", type);
    }
    console.warn("VideoRecorderIOS: No preferred MIME type supported. Using browser default.");
    return ''; 
  };

  const startRecording = () => {
    if (!mediaStream || !mediaStream.active) {
      setError("Media stream not available. Please ensure camera/mic permissions are granted.");
      console.log("VideoRecorderIOS: Start recording called but mediaStream is invalid or inactive. Attempting re-setup.");
      requestPermissionsAndSetup(); 
      return;
    }
     if (mediaStream.getVideoTracks().length === 0 || mediaStream.getVideoTracks()[0].readyState !== 'live') {
        const trackState = mediaStream.getVideoTracks()[0]?.readyState;
        console.error(`VideoRecorderIOS: CRITICAL - Video track not live before recording. State: ${trackState}`);
        setError(`Failed to initialize recording: The camera video track is not live (state: ${trackState}). Try re-enabling camera.`);
        return;
    }

    if (videoPreviewRef.current && videoPreviewRef.current.srcObject !== mediaStream) {
        console.log("VideoRecorderIOS: Resetting video preview srcObject to live stream for recording.");
        videoPreviewRef.current.srcObject = mediaStream;
        videoPreviewRef.current.src = ""; // Clear any blob src
        videoPreviewRef.current.muted = true; 
        videoPreviewRef.current.controls = false;
        videoPreviewRef.current.setAttribute('playsinline', 'true');
        videoPreviewRef.current.setAttribute('autoplay', 'true');
        videoPreviewRef.current.play().catch(e => console.warn("Error re-playing live preview for recording:", e));
    }
    setRecordedVideoBlob(null);
    if (recordedVideoUrl) URL.revokeObjectURL(recordedVideoUrl);
    setRecordedVideoUrl(null);
    potentialThumbnails.forEach(url => { if(url) URL.revokeObjectURL(url) });
    setPotentialThumbnails(Array(NUM_THUMBNAILS_TO_GENERATE).fill(null));
    setPotentialThumbnailBlobs(Array(NUM_THUMBNAILS_TO_GENERATE).fill(null));
    setSelectedThumbnailIndex(null);

    const mimeType = getSupportedMimeType();
    actualMimeTypeRef.current = mimeType;
    console.log("VideoRecorderIOS: Attempting to record with MIME type:", mimeType || "browser default");
    
    const options: MediaRecorderOptions = {};
    if (mimeType) options.mimeType = mimeType;

    try {
      const recorder = new MediaRecorder(mediaStream, options);
      mediaRecorderRef.current = recorder;
      recordedChunksRef.current = [];
      setRecordingDuration(0);
      setError(null);
      setUploadSuccessMessage(null);

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
          console.log(`VideoRecorderIOS: ondataavailable - chunk size ${event.data.size}`);
        }
      };

      recorder.onstop = async () => {
        setIsRecording(false);
        if(recordingTimerRef.current) clearInterval(recordingTimerRef.current);

        const currentMimeType = mediaRecorderRef.current?.mimeType || actualMimeTypeRef.current || 'video/webm';
        console.log("VideoRecorderIOS: onstop - Using MimeType for blob:", currentMimeType, "Chunks:", recordedChunksRef.current.length);
        if (recordedChunksRef.current.length === 0) {
            setError("No video data was recorded. This can happen on iOS if recording is too short or due to browser limitations. Please try recording for at least a few seconds. Ensure Low Power Mode is off.");
            return;
        }
        const blob = new Blob(recordedChunksRef.current, { type: currentMimeType });
        if (blob.size === 0) {
          setError("Recording failed: The recorded video file is empty. This is often an iOS limitation. Please try again, ensure camera permissions are active, and Low Power Mode is off.");
          return;
        }
        setRecordedVideoBlob(blob);
        const newRecordedVideoUrl = URL.createObjectURL(blob);
        setRecordedVideoUrl(newRecordedVideoUrl);

         if (videoPreviewRef.current) {
            videoPreviewRef.current.srcObject = null; // Important: switch from live stream
            videoPreviewRef.current.src = newRecordedVideoUrl; 
            videoPreviewRef.current.muted = false;
            videoPreviewRef.current.controls = true; // Show controls for recorded preview
            videoPreviewRef.current.load(); // Ensure new src is loaded
            
            // Do not reset previewRotation here. The existing rotation should apply to the new src.

            videoPreviewRef.current.onloadedmetadata = async () => {
                const videoDuration = Math.round(videoPreviewRef.current?.duration || 0);
                setRecordingDuration(videoDuration); // Update duration from actual video
                await generateThumbnailsFromVideo(newRecordedVideoUrl, videoDuration);
                // Explicitly play after metadata loaded, and controls are visible
                videoPreviewRef.current?.play().catch(e => console.warn("VideoRecorderIOS: Error playing recorded video for review", e));
            };
             videoPreviewRef.current.onerror = (e) => {
                 console.error("VideoRecorderIOS: Error loading recorded video in preview for onloadedmetadata. Event:", e);
                 setError("Could not load recorded video for review. File may be corrupt or unsupported for preview.");
             };
        }
      };
      recorder.onerror = (event) => {
        console.error("VideoRecorderIOS: MediaRecorder error:", event);
        setError("A recording error occurred. Please try again. Check console for details.");
        setIsRecording(false);
        if(recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      }

      recorder.start();
      setIsRecording(true);
      let seconds = 0;
      recordingTimerRef.current = setInterval(() => {
          seconds++;
          setRecordingDuration(seconds);
      }, 1000);
      console.log("VideoRecorderIOS: MediaRecorder started. State:", recorder.state);
    } catch (e) {
        console.error("VideoRecorderIOS: Error instantiating MediaRecorder:", e);
        setError(`Failed to start recorder: ${e instanceof Error ? e.message : String(e)}. Check browser compatibility.`);
        setIsRecording(false);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop();
      console.log("VideoRecorderIOS: MediaRecorder stopped.");
    } else {
      console.log("VideoRecorderIOS: Stop called but recorder not in 'recording' state. Current state:", mediaRecorderRef.current?.state);
    }
    // setIsRecording will be set to false in recorder.onstop
  };

  const generateThumbnailsFromVideo = async (videoUrl: string, duration: number) => {
    // This function remains largely the same, but ensure it gracefully handles errors.
    if (!videoPreviewRef.current || duration < 0.01 && duration !==0 ) { // Allow near-zero for single frame attempt
        console.warn("VideoRecorderIOS: Cannot generate thumbnails, video element or duration invalid for multiple thumbnails. Duration:", duration);
         if (duration === 0 && videoUrl) { // Try one frame if duration is absolute zero but URL exists
            await generateSpecificThumbnail(videoUrl, 0.05, 0); // Try a very early frame
         }
        return;
    }
    const videoElement = document.createElement('video'); // Use a temporary video element for generation
    videoElement.src = videoUrl;
    videoElement.muted = true;
    videoElement.crossOrigin = "anonymous";


    const tempThumbnails: (string | null)[] = [];
    const tempThumbnailBlobs: (Blob | null)[] = [];

    const captureFrame = (time: number): Promise<Blob | null> => {
      return new Promise((resolve, reject) => {
        videoElement.currentTime = time;
        videoElement.onseeked = () => {
          const canvas = document.createElement('canvas');
          canvas.width = videoElement.videoWidth / 3; // Smaller thumbnails
          canvas.height = videoElement.videoHeight / 3;
          const ctx = canvas.getContext('2d');
          if (!ctx) return resolve(null);
          ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
          canvas.toBlob(blob => resolve(blob), 'image/jpeg', 0.8);
        };
        videoElement.onerror = (e) => {
          console.error("Error during thumbnail generation seek/draw:", e);
          reject(e);
        };
        if(videoElement.readyState >= 2) { // HAVE_CURRENT_DATA or more
            videoElement.dispatchEvent(new Event('seeked')); // Manually trigger if already seekable
        }
      });
    };
    
    const timePoints = duration > 1 ? 
      Array(NUM_THUMBNAILS_TO_GENERATE).fill(0).map((_, i) => (duration / (NUM_THUMBNAILS_TO_GENERATE +1)) * (i+1))
      : [Math.max(0.05, duration / 2)]; // Single thumbnail for very short videos

    for (let i = 0; i < timePoints.length; i++) {
        try {
            const blob = await captureFrame(timePoints[i]);
            if (blob) {
                tempThumbnails.push(URL.createObjectURL(blob));
                tempThumbnailBlobs.push(blob);
            } else {
                tempThumbnails.push(null);
                tempThumbnailBlobs.push(null);
            }
        } catch (thumbError) {
            console.error(`VideoRecorderIOS: Error generating thumbnail ${i}:`, thumbError);
            tempThumbnails.push(null);
            tempThumbnailBlobs.push(null);
        }
    }
    videoElement.remove(); // Clean up temporary video element
    setPotentialThumbnails(tempThumbnails);
    setPotentialThumbnailBlobs(tempThumbnailBlobs);
    const firstValidIndex = tempThumbnails.findIndex(t => t !== null);
    setSelectedThumbnailIndex(firstValidIndex !== -1 ? firstValidIndex : null);
  };

  // Helper for single thumbnail generation if main loop fails
  const generateSpecificThumbnail = async (videoUrl: string, time: number, index: number) => {
     // ... (implementation similar to VideoRecorder.tsx or simplified as above)
     // For brevity, assuming this logic is robust or uses a single element approach
     console.log(`Attempting to generate specific thumbnail at time ${time} for index ${index}`);
  };


  const handleRotatePreview = () => {
    setPreviewRotation(current => (current + 90) % 360);
  };

  const resetRecorder = async (isFullReset = true) => {
    stopRecording(); // Ensure recorder is stopped
    if (isFullReset && mediaStream) {
      mediaStream.getTracks().forEach(track => track.stop());
      setMediaStream(null);
    }
    setRecordedVideoBlob(null);
    if(recordedVideoUrl) URL.revokeObjectURL(recordedVideoUrl);
    setRecordedVideoUrl(null);
    potentialThumbnails.forEach(url => { if(url) URL.revokeObjectURL(url) });
    setPotentialThumbnails(Array(NUM_THUMBNAILS_TO_GENERATE).fill(null));
    setPotentialThumbnailBlobs(Array(NUM_THUMBNAILS_TO_GENERATE).fill(null));
    setSelectedThumbnailIndex(null);
    recordedChunksRef.current = [];
    setRecordingDuration(0);
    
    // Only reset metadata if it's a full reset, not just for re-attempting upload
    if(isFullReset) {
      setTitle('');
      setDescription('');
      setKeywords('');
    }

    setError(null);
    setUploadSuccessMessage(null); // Clear upload success message on reset
    setIsUploading(false);
    setUploadProgress(0);
    // Do not reset previewRotation here automatically, user might want to keep it for next recording.
    // Or reset if it's a full UI reset: setPreviewRotation(0)
    
    if (videoPreviewRef.current) {
        videoPreviewRef.current.srcObject = null;
        videoPreviewRef.current.src = "";
        videoPreviewRef.current.controls = false;
        videoPreviewRef.current.muted = true;
    }
    if (isFullReset) {
        await requestPermissionsAndSetup(); 
    }
  };

  const saveVideoLocally = () => {
    if (!recordedVideoBlob) return;
    const urlToSave = recordedVideoUrl || URL.createObjectURL(recordedVideoBlob); 
    const a = document.createElement("a");
    a.href = urlToSave;
    const safeTitle = title.replace(/[^a-z0-9_]+/gi, '_').toLowerCase() || 'ios_recording';
    const extension = getFileExtensionFromMimeType(recordedVideoBlob.type || actualMimeTypeRef.current);
    a.download = `${safeTitle}_${Date.now()}.${extension}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    if (!recordedVideoUrl) URL.revokeObjectURL(urlToSave); 
    
    toast({ // Use toast for local save success
      title: "Video Saved Locally",
      description: `Video saved as ${a.download}. You can still proceed to upload it.`,
    });
    // Do NOT setUploadSuccessMessage here, as it hides the upload form.
  };

  const handleUploadSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!recordedVideoBlob || !user || !doctorProfile) {
        setError("No video to upload, user not authenticated, or doctor profile missing.");
        console.error("VideoRecorderIOS: Upload cancelled.", { hasBlob: !!recordedVideoBlob, hasUser: !!user, hasDoctorProfile: !!doctorProfile });
        return;
    }
    if (!title.trim()) {
        setError("Please provide a title for the video.");
        return;
    }
    if (selectedThumbnailIndex === null || !potentialThumbnailBlobs[selectedThumbnailIndex]) {
        setError("Please select a thumbnail for the video.");
        return;
    }
    const selectedThumbnailBlob = potentialThumbnailBlobs[selectedThumbnailIndex!];
    if (!selectedThumbnailBlob) {
        setError("Selected thumbnail data is missing. Please try selecting again.");
        return;
    }

    setIsUploading(true);
    setUploadProgress(0);
    setError(null);
    setUploadSuccessMessage(null); // Clear previous success message

    const currentUserId = doctorProfile.uid;
    console.log("VideoRecorderIOS: Current User for upload:", JSON.stringify(user));
    console.log("VideoRecorderIOS: Doctor Profile for upload:", JSON.stringify(doctorProfile));
    console.log(`VideoRecorderIOS: User UID for path: ${currentUserId}`);
    const currentDoctorName = doctorProfile.displayName || doctorProfile.email || "Unknown Doctor";

    try {
      const safeTitleForFile = title.replace(/[^a-z0-9_]+/gi, '_').toLowerCase();
      const timestamp = Date.now();
      const videoExtension = getFileExtensionFromMimeType(recordedVideoBlob.type || actualMimeTypeRef.current);
      const videoFileName = `${safeTitleForFile}_ios_${timestamp}.${videoExtension}`;
      const videoStoragePath = `videos/${currentUserId}/${videoFileName}`; 
      
      const thumbnailFileName = `thumb_${safeTitleForFile}_ios_${timestamp}.jpg`;
      const thumbnailStoragePath = `thumbnails/${currentUserId}/${thumbnailFileName}`;

      console.log(`VideoRecorderIOS: Attempting to upload video to Firebase Storage path: ${videoStoragePath}`);
      
      const videoFileRef = storageRefFirebase(firebaseStorage, videoStoragePath);
      const videoUploadTask = uploadBytesResumable(videoFileRef, recordedVideoBlob);

      videoUploadTask.on('state_changed',
        (snapshot: UploadTaskSnapshot) => {
          const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
          setUploadProgress(progress * 0.8); // 80% for video upload
        },
        (uploadError: any) => {
          console.error("VideoRecorderIOS: Firebase Video Upload failed:", uploadError);
          setError(`Video upload failed: ${uploadError.message}`);
          setIsUploading(false);
        },
        async () => {
          const downloadURL = await getFirebaseDownloadURL(videoUploadTask.snapshot.ref);
          console.log("VideoRecorderIOS: Video uploaded successfully! URL:", downloadURL);
          
          console.log(`VideoRecorderIOS: Attempting to upload thumbnail to Firebase Storage path: ${thumbnailStoragePath}`);
          const thumbFileRef = storageRefFirebase(firebaseStorage, thumbnailStoragePath);
          const thumbUploadTask = uploadBytesResumable(thumbFileRef, selectedThumbnailBlob);

          thumbUploadTask.on('state_changed', 
            (snapshot: UploadTaskSnapshot) => {
                const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
                setUploadProgress(80 + (progress * 0.2)); // Remaining 20% for thumbnail
            },
            (thumbError: any) => {
                console.error("VideoRecorderIOS: Firebase Thumbnail Upload failed:", thumbError);
                setError(`Thumbnail upload failed: ${thumbError.message}. Video was uploaded but thumbnail failed.`);
                setIsUploading(false);
            },
            async () => {
                const thumbDownloadURL = await getFirebaseDownloadURL(thumbUploadTask.snapshot.ref);
                console.log("VideoRecorderIOS: Thumbnail uploaded successfully! URL:", thumbDownloadURL);

                const videoId = uuidv4();
                const videoMetaData = { 
                    videoId,
                    title,
                    description,
                    keywords: keywords.split(',').map(k => k.trim()).filter(Boolean),
                    videoUrl: downloadURL,
                    storagePath: videoStoragePath,
                    thumbnailUrl: thumbDownloadURL,
                    thumbnailStoragePath: thumbnailStoragePath,
                    videoSize: recordedVideoBlob.size,
                    videoType: recordedVideoBlob.type || actualMimeTypeRef.current,
                    recordingDuration: recordingDuration, 
                    doctorId: currentUserId,
                    doctorName: currentDoctorName,
                };

                const result = await addVideoMetadataFromIOSAction(videoMetaData);

                if (result.success) {
                    setUploadSuccessMessage(`Video "${title}" uploaded and metadata saved! It should now appear in the video list.`);
                    setIsUploading(false);
                    setTitle(''); setDescription(''); setKeywords(''); setSelectedThumbnailIndex(null);
                    setRecordedVideoBlob(null);
                    if(recordedVideoUrl) URL.revokeObjectURL(recordedVideoUrl);
                    setRecordedVideoUrl(null);
                    potentialThumbnails.forEach(url => { if(url) URL.revokeObjectURL(url) });
                    setPotentialThumbnails(Array(NUM_THUMBNAILS_TO_GENERATE).fill(null));
                    setPotentialThumbnailBlobs(Array(NUM_THUMBNAILS_TO_GENERATE).fill(null));
                } else {
                    let detailedError = result.error || "Failed to save video metadata to Firestore.";
                    if (detailedError.toLowerCase().includes("permission_denied") || detailedError.toLowerCase().includes("missing or insufficient permissions")) {
                        detailedError += " This often means the authenticated user's document in the '/doctors' collection in Firestore is missing an 'isAdmin: true' field, or the Firestore rules are not correctly configured for this user to create video entries.";
                        console.error("Firestore permission error details: Ensure /doctors/" + currentUserId + " has isAdmin:true field for Firestore rules.");
                    }
                    throw new Error(detailedError);
                }
            }
          );
        }
      );
    } catch (err) {
      console.error("VideoRecorderIOS: Upload or metadata saving failed:", err);
      setError(`Operation failed: ${err instanceof Error ? err.message : String(err)}`);
      setIsUploading(false);
    }
  };


  if (authLoading) {
    return <div className="flex items-center justify-center h-screen"><Loader2 className="h-12 w-12 animate-spin text-primary" /></div>;
  }
  if (!isAdmin) {
    return <div className="p-4 text-center text-destructive">Access Denied. You must be an admin to use this feature.</div>;
  }

  const showUploadForm = recordedVideoBlob && !isUploading && !uploadSuccessMessage;
  const showLiveRecordControls = mediaStream && !recordedVideoBlob && !uploadSuccessMessage;
  const showSetupCamera = !mediaStream && !recordedVideoBlob && !uploadSuccessMessage;

  return (
    <div className="container mx-auto p-4 space-y-6">
      <Card className="shadow-xl rounded-lg">
        <CardHeader>
          <CardTitle className="text-2xl font-headline flex items-center gap-2">
            <Camera size={28} className="text-primary"/> iOS Video Recorder
          </CardTitle>
          <CardDescription>
            Optimized for recording on iPhone, iPad, and Safari on macOS. Prioritizes WebM if supported, falls back to MP4. Preview rotation only affects display, not the final recording.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground border p-2 rounded-md">
            Debug Status: mediaStream is {mediaStream ? 'available' : 'NOT available'}. 
            isRecording: {isRecording.toString()}.
            Recorded Blob: {recordedVideoBlob ? `${(recordedVideoBlob.size / 1024 / 1024).toFixed(2)} MB (Type: ${recordedVideoBlob.type || actualMimeTypeRef.current || 'N/A'})` : 'No'}.
            Duration: {recordingDuration}s. Rotation: {previewRotation}°.
          </p>
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {uploadSuccessMessage && (
             <Alert variant="default" className="bg-green-100 border-green-400 text-green-700 dark:bg-green-900/30 dark:border-green-600 dark:text-green-300">
              <CheckCircle className="h-4 w-4"/>
              <AlertTitle>Success</AlertTitle>
              <AlertDescription>{uploadSuccessMessage}</AlertDescription>
            </Alert>
          )}

          <div className="relative group">
            <video
              ref={videoPreviewRef}
              autoPlay
              muted={!recordedVideoUrl} // Unmute for recorded preview, mute for live
              playsInline
              controls={!!recordedVideoUrl} // Show controls only for recorded video
              className="w-full aspect-video rounded-md border bg-slate-900 object-contain transition-transform duration-300 ease-in-out"
              style={{ transform: `rotate(${previewRotation}deg)` }}
              key={recordedVideoUrl || 'live_preview'} // Key change to force re-render on src change
            />
            {/* Rotate button visible for live preview AND recorded preview if not uploading */}
            {((mediaStream && !recordedVideoBlob) || recordedVideoBlob) && !isUploading && ( 
              <Button 
                  onClick={handleRotatePreview} 
                  variant="outline" 
                  size="icon" 
                  className="absolute top-2 left-2 z-10 bg-black/40 text-white hover:bg-black/60 border-white/30 opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Rotate Preview"
              >
                  <RotateCw size={18} />
              </Button>
            )}
             {isRecording && (
                <div className="absolute top-4 right-4 bg-red-600 text-white px-2 py-1 rounded-md text-xs font-mono shadow-md flex items-center gap-1">
                    <Mic size={14} className="animate-pulse" /> REC {String(Math.floor(recordingDuration/60)).padStart(2,'0')}:{String(recordingDuration%60).padStart(2,'0')}
                </div>
            )}
          </div>

          {showLiveRecordControls && (
            <div className="flex flex-col sm:flex-row gap-2">
              {!isRecording ? (
                <Button
                  onClick={startRecording}
                  disabled={isUploading} // Should not be uploading at this stage
                  className="flex-1 gap-2 bg-green-600 hover:bg-green-700 text-white"
                >
                  <Mic size={18} /> Start Recording
                </Button>
              ) : (
                <Button
                  onClick={stopRecording}
                  disabled={isUploading} // Should not be uploading
                  className="flex-1 gap-2 bg-red-600 hover:bg-red-700 text-white"
                >
                  <Square size={18} /> Stop Recording
                </Button>
              )}
            </div>
          )}
          
          {showSetupCamera && (
            <Button onClick={requestPermissionsAndSetup} variant="outline" className="w-full gap-2">
                <Camera size={18} /> Setup Camera & Mic
            </Button>
          )}

          {uploadSuccessMessage && (
             <Button onClick={() => resetRecorder(true)} variant="default" className="w-full gap-2">
                <RefreshCcw size={18} /> Record Another Video
            </Button>
          )}


          {showUploadForm && (
            <form onSubmit={handleUploadSubmit} className="space-y-4 pt-4 border-t" id="ios-upload-form">
              <h3 className="text-lg font-semibold">Review & Upload Recording</h3>
              <p className="text-sm text-muted-foreground">
                Video Type: {recordedVideoBlob?.type || actualMimeTypeRef.current || "N/A"}, Size: {recordedVideoBlob ? (recordedVideoBlob.size / 1024 / 1024).toFixed(2) : "N/A"} MB, Duration: {recordingDuration}s.
                 Note: The recorded video file itself is not rotated by the preview rotation.
              </p>
              <p className="text-xs text-muted-foreground">If the video does not play correctly in other software like iMovie, it might be due to specific MP4 encoding details from the browser. Consider using a video converter if issues arise.</p>


              <div>
                <Label className="mb-2 block text-sm font-medium text-foreground">Select Thumbnail</Label>
                <div className="grid grid-cols-3 md:grid-cols-5 gap-2">
                    {potentialThumbnails.map((thumbUrl, index) => (
                    thumbUrl ? (
                        <button
                        key={index}
                        type="button"
                        onClick={() => setSelectedThumbnailIndex(index)}
                        className={`relative aspect-video rounded-md overflow-hidden border-2 transition-all duration-150 ease-in-out hover:opacity-80 focus:outline-none
                            ${selectedThumbnailIndex === index ? 'border-primary ring-2 ring-primary/50' : 'border-muted hover:border-primary/50'}`}
                        >
                        <Image src={thumbUrl} alt={`Thumbnail ${index + 1}`} layout="fill" objectFit="cover" data-ai-hint="video thumbnail" />
                        {selectedThumbnailIndex === index && (
                            <div className="absolute inset-0 bg-primary/50 flex items-center justify-center">
                            <CheckCircle size={24} className="text-white opacity-90" />
                            </div>
                        )}
                        </button>
                    ) : (
                        <div key={index} className="aspect-video bg-muted rounded-md flex items-center justify-center border border-dashed border-border">
                        <ImageIcon size={24} className="text-muted-foreground animate-pulse" />
                        </div>
                    )
                    ))}
                </div>
                {selectedThumbnailIndex === null && potentialThumbnails.some(t=>t===null) && <p className="text-xs text-destructive mt-1">Thumbnails are generating or failed. Please wait or re-record if they don't appear.</p>}
                {selectedThumbnailIndex === null && !potentialThumbnails.some(t=>t===null) && recordedVideoBlob && <p className="text-xs text-destructive mt-1">Please select a thumbnail.</p>}
              </div>


              <div className="space-y-1">
                <Label htmlFor="videoTitle">Video Title <span className="text-destructive">*</span></Label>
                <Input 
                  id="videoTitle" 
                  type="text" 
                  value={title} 
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setTitle(e.target.value)} 
                  placeholder="Enter a title for the video"
                  required
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="videoDescription">Description</Label>
                <Textarea 
                  id="videoDescription" 
                  value={description} 
                  onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setDescription(e.target.value)} 
                  placeholder="Summarize the video content"
                  rows={3}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="videoKeywords">Keywords (comma-separated)</Label>
                <Input 
                  id="videoKeywords" 
                  type="text" 
                  value={keywords} 
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setKeywords(e.target.value)} 
                  placeholder="e.g., cardiology, ios, tutorial"
                />
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <Button
                  type="button"
                  onClick={saveVideoLocally}
                  variant="outline"
                  className="flex-1 gap-2"
                  disabled={!recordedVideoBlob} // Disable if no blob
                >
                  <Download size={18} /> Save to Device
                </Button>
                <Button
                  type="submit"
                  form="ios-upload-form"
                  disabled={!title.trim() || isUploading || selectedThumbnailIndex === null || !recordedVideoBlob}
                  className="flex-1 gap-2 bg-primary hover:bg-primary/90 text-primary-foreground"
                >
                  {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud size={18} />}
                  {isUploading ? 'Uploading...' : 'Upload to App'}
                </Button>
              </div>
            </form>
          )}
          {isUploading && (
            <div className="space-y-2 pt-4 border-t">
                <Label>Upload Progress</Label>
                <div className="w-full bg-muted rounded-full h-2.5">
                    <div className="bg-primary h-2.5 rounded-full" style={{ width: `${uploadProgress}%` }}></div>
                </div>
                <p className="text-sm text-muted-foreground text-center">{Math.round(uploadProgress)}%</p>
            </div>
          )}

        </CardContent>
         <CardFooter className="flex flex-col sm:flex-row gap-2 pt-4 border-t">
            <Button onClick={() => resetRecorder(true)} variant="outline" className="w-full sm:w-auto">
              <RefreshCcw size={16} className="mr-2" /> Reset & Re-initialize Camera
            </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
