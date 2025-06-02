
"use client";

import { useEffect, useRef, useState, ChangeEvent } from "react";
import { getStorage, ref as storageRefFirebase, uploadBytesResumable, getDownloadURL as getFirebaseDownloadURL, UploadTaskSnapshot } from "firebase/storage"; // Renamed to avoid conflict with internal ref
import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Loader2, Video, Mic, Square, Download, UploadCloud, AlertCircle, RotateCw, Camera } from "lucide-react";
import { storage as firebaseStorage } from "@/lib/firebase/config"; 

export default function VideoRecorderIOSPage() {
  const videoPreviewRef = useRef<HTMLVideoElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordedVideoBlob, setRecordedVideoBlob] = useState<Blob | null>(null);
  const [recordedVideoUrl, setRecordedVideoUrl] = useState<string | null>(null);
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  
  const { user, isAdmin, loading: authLoading } = useAuth();
  const router = useRouter();

  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [previewRotation, setPreviewRotation] = useState(0);
  const [actualMimeType, setActualMimeType] = useState<string>('');


  useEffect(() => {
    if (!authLoading && !isAdmin) {
      router.replace('/dashboard');
    }
  }, [authLoading, isAdmin, router]);

  const requestPermissionsAndSetup = async () => {
    setError(null);
    setSuccessMessage(null);
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
        videoPreviewRef.current.muted = true;
        videoPreviewRef.current.setAttribute('playsinline', 'true');
        videoPreviewRef.current.setAttribute('autoplay', 'true');
        await videoPreviewRef.current.play().catch(e => console.warn("VideoRecorderIOS: Error playing live preview:", e));
      }
      setPreviewRotation(0);
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
    const isIOS = typeof navigator !== 'undefined' && (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) && !(window as any).MSStream;
    console.log("VideoRecorderIOS: isIOS:", isIOS);

    const types = (isIOS || (typeof navigator !== 'undefined' && /^((?!chrome|android).)*safari/i.test(navigator.userAgent)))
      ? [ 
          'video/mp4;codecs=avc1.4D401E',
          'video/mp4;codecs=avc1.42E01E',
          'video/mp4;codecs=h264',
          'video/mp4',
          'video/quicktime', 
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
        videoPreviewRef.current.muted = true; // Ensure it's muted for autoplay
        videoPreviewRef.current.play().catch(e => console.warn("Error re-playing live preview for recording:", e));
    }

    const mimeType = getSupportedMimeType();
    setActualMimeType(mimeType); 
    console.log("VideoRecorderIOS: Attempting to record with MIME type:", mimeType || "browser default");
    
    const options: MediaRecorderOptions = {};
    if (mimeType) options.mimeType = mimeType;

    try {
      const recorder = new MediaRecorder(mediaStream, options);
      mediaRecorderRef.current = recorder;
      recordedChunksRef.current = [];
      setRecordedVideoBlob(null);
      if (recordedVideoUrl) URL.revokeObjectURL(recordedVideoUrl);
      setRecordedVideoUrl(null);
      setError(null);
      setSuccessMessage(null);

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
          console.log(`VideoRecorderIOS: ondataavailable - chunk size ${event.data.size}`);
        }
      };

      recorder.onstop = () => {
        setIsRecording(false);
        const currentMimeType = mediaRecorderRef.current?.mimeType || actualMimeType || 'video/webm';
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
            videoPreviewRef.current.srcObject = null;
            videoPreviewRef.current.src = newRecordedVideoUrl; // Set src for playback
            videoPreviewRef.current.muted = false;
            videoPreviewRef.current.controls = true;
            videoPreviewRef.current.load(); // Important to reload with new src
            videoPreviewRef.current.play().catch(e => console.warn("VideoRecorderIOS: Error playing recorded video for review", e));
        }
      };
      recorder.onerror = (event) => {
        console.error("VideoRecorderIOS: MediaRecorder error:", event);
        setError("A recording error occurred. Please try again. Check console for details.");
        setIsRecording(false);
      }

      recorder.start();
      setIsRecording(true);
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
    setIsRecording(false); 
  };

  const handleRotatePreview = () => {
    setPreviewRotation(current => (current + 90) % 360);
  };

  const saveVideoLocally = () => {
    if (!recordedVideoBlob) return;
    const urlToSave = recordedVideoUrl || URL.createObjectURL(recordedVideoBlob); // Fallback just in case
    const a = document.createElement("a");
    a.href = urlToSave;
    const safeTitle = title.replace(/[^a-z0-9_]+/gi, '_').toLowerCase() || 'ios_recording';
    const extension = getFileExtensionFromMimeType(recordedVideoBlob.type || actualMimeType);
    a.download = `${safeTitle}_${Date.now()}.${extension}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    if (!recordedVideoUrl) URL.revokeObjectURL(urlToSave); 
    setSuccessMessage(`Video saved locally as ${a.download}`);
  };

  const uploadToFirebase = async () => {
    if (!recordedVideoBlob || !user) {
        setError("No video to upload or user not authenticated. Please ensure you are logged in.");
        console.error("VideoRecorderIOS: Upload cancelled. No video blob or user not found.", { hasBlob: !!recordedVideoBlob, hasUser: !!user });
        return;
    }
    if (!title.trim()) {
        setError("Please provide a title for the video.");
        return;
    }
    setIsUploading(true);
    setUploadProgress(0);
    setError(null);
    setSuccessMessage(null);

    const currentUserId = user.uid;
    console.log(`VideoRecorderIOS: Preparing to upload. User UID: ${currentUserId}`);
    console.log("VideoRecorderIOS: Current user object from useAuth:", JSON.stringify(user, null, 2));


    try {
      const safeTitle = title.replace(/[^a-z0-9_]+/gi, '_').toLowerCase();
      const extension = getFileExtensionFromMimeType(recordedVideoBlob.type || actualMimeType);
      const timestamp = Date.now();
      const filename = `videos/${currentUserId}/ios_uploads/${safeTitle}_${timestamp}.${extension}`;
      
      console.log(`VideoRecorderIOS: Attempting to upload to Firebase Storage path: ${filename}`);
      
      const fileRef = storageRefFirebase(firebaseStorage, filename);
      const uploadTask = uploadBytesResumable(fileRef, recordedVideoBlob);

      uploadTask.on('state_changed',
        (snapshot: UploadTaskSnapshot) => {
          const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
          setUploadProgress(progress);
        },
        (uploadError: any) => {
          console.error("VideoRecorderIOS: Firebase Upload failed:", uploadError);
          console.error("VideoRecorderIOS: Firebase Upload error code:", uploadError.code);
          console.error("VideoRecorderIOS: Firebase Upload error message:", uploadError.message);
          if (uploadError.code === 'storage/unauthorized') {
            setError(`Upload failed: You do not have permission to upload to this location (${filename}). Please check your Firebase Storage security rules to ensure the authenticated user (UID: ${currentUserId}) has write access to this specific path.`);
          } else {
            setError(`Upload failed: ${uploadError.message}`);
          }
          setIsUploading(false);
        },
        async () => {
          const downloadURL = await getFirebaseDownloadURL(uploadTask.snapshot.ref);
          console.log("VideoRecorderIOS: Video uploaded successfully! URL:", downloadURL);
          setSuccessMessage(`Video "${title}" uploaded successfully to Firebase Storage! Path: ${filename}. It won't appear in the app's video list yet as this is a direct upload.`);
          setIsUploading(false);
          setRecordedVideoBlob(null);
          if(recordedVideoUrl) URL.revokeObjectURL(recordedVideoUrl);
          setRecordedVideoUrl(null);
          setTitle('');
        }
      );
    } catch (err) {
      console.error("VideoRecorderIOS: Upload preparation failed:", err);
      setError(`Upload preparation failed: ${err instanceof Error ? err.message : String(err)}`);
      setIsUploading(false);
    }
  };

  if (authLoading) {
    return <div className="flex items-center justify-center h-screen"><Loader2 className="h-12 w-12 animate-spin text-primary" /></div>;
  }
  if (!isAdmin) {
    return <div className="p-4 text-center text-destructive">Access Denied. You must be an admin to use this feature.</div>;
  }

  return (
    <div className="container mx-auto p-4 space-y-6">
      <Card className="shadow-xl rounded-lg">
        <CardHeader>
          <CardTitle className="text-2xl font-headline flex items-center gap-2">
            <Camera size={28} className="text-primary"/> iOS Video Recorder
          </CardTitle>
          <CardDescription>
            Optimized for recording on iPhone, iPad, and Safari on macOS. Preview rotation only affects display, not the final recording.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground border p-2 rounded-md">
            Debug Status: mediaStream is {mediaStream ? 'available' : 'NOT available'}. 
            isRecording: {isRecording.toString()}.
            Recorded Blob: {recordedVideoBlob ? `${(recordedVideoBlob.size / 1024 / 1024).toFixed(2)} MB (${recordedVideoBlob.type})` : 'No'}.
          </p>
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {successMessage && (
             <Alert variant="default" className="bg-green-100 border-green-400 text-green-700 dark:bg-green-900/30 dark:border-green-600 dark:text-green-300">
              <AlertTitle>Success</AlertTitle>
              <AlertDescription>{successMessage}</AlertDescription>
            </Alert>
          )}

          <div className="relative group">
            <video
              ref={videoPreviewRef}
              autoPlay
              muted
              playsInline
              className="w-full aspect-video rounded-md border bg-slate-900 object-contain transition-transform duration-300 ease-in-out"
              style={{ transform: `rotate(${previewRotation}deg)` }}
            />
            {(mediaStream || recordedVideoBlob) && ( // Show rotate button if preview is active or video recorded
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
          </div>

          {mediaStream ? (
            <div className="flex flex-col sm:flex-row gap-2">
              {!isRecording ? (
                <Button
                  onClick={startRecording}
                  disabled={isUploading}
                  className="flex-1 gap-2 bg-green-600 hover:bg-green-700 text-white"
                >
                  <Mic size={18} /> Start Recording
                </Button>
              ) : (
                <Button
                  onClick={stopRecording}
                  disabled={isUploading}
                  className="flex-1 gap-2 bg-red-600 hover:bg-red-700 text-white"
                >
                  <Square size={18} /> Stop Recording
                </Button>
              )}
            </div>
          ) : (
            <Button onClick={requestPermissionsAndSetup} variant="outline" className="w-full gap-2">
                <Camera size={18} /> Setup Camera & Mic
            </Button>
          )}


          {recordedVideoBlob && !isUploading && (
            <div className="space-y-4 pt-4 border-t">
              <h3 className="text-lg font-semibold">Review & Save Recording</h3>
              <p className="text-sm text-muted-foreground">
                Video Type: {recordedVideoBlob.type || actualMimeType || "N/A"}, Size: {(recordedVideoBlob.size / 1024 / 1024).toFixed(2)} MB
              </p>
              <div className="space-y-1">
                <Label htmlFor="videoTitle">Video Title (for filename)</Label>
                <Input 
                  id="videoTitle" 
                  type="text" 
                  value={title} 
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setTitle(e.target.value)} 
                  placeholder="Enter a title for the video"
                />
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <Button
                  onClick={saveVideoLocally}
                  variant="outline"
                  className="flex-1 gap-2"
                >
                  <Download size={18} /> Save to Device
                </Button>
                <Button
                  onClick={uploadToFirebase}
                  disabled={!title.trim()}
                  className="flex-1 gap-2 bg-primary hover:bg-primary/90 text-primary-foreground"
                >
                  <UploadCloud size={18} /> Upload to Firebase
                </Button>
              </div>
            </div>
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
      </Card>
    </div>
  );
}
    

    
