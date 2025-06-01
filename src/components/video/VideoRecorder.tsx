
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
import { Video, Mic, Square, Play, Download, UploadCloud, AlertCircle, CheckCircle, Loader2, Settings2, Camera, Film } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import type { VideoMeta } from '@/types';
import { useRouter } from 'next/navigation';
import Image from 'next/image'; // For displaying thumbnails

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
    if (!isAdmin) {
      router.replace('/dashboard'); 
    }
    return () => { 
      stopMediaStream();
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      if (recordedVideoUrl) URL.revokeObjectURL(recordedVideoUrl);
      potentialThumbnails.forEach(url => { if (url) URL.revokeObjectURL(url); });
    };
  }, [isAdmin, router, recordedVideoUrl, potentialThumbnails]);


  const formatTime = (totalSeconds: number): string => {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  };

  const requestPermissionsAndSetup = async () => {
    setError(null);
    setRecordingState('permission');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      mediaStreamRef.current = stream;
      if (videoPreviewRef.current) {
        videoPreviewRef.current.srcObject = stream;
      }
      setRecordingState('idle'); 
    } catch (err) {
      console.error("Error accessing media devices:", err);
      setError("Failed to access camera/microphone. Please check permissions and ensure your browser supports media recording.");
      setRecordingState('error');
    }
  };
  
  const startRecording = async () => {
    if (!mediaStreamRef.current) {
      await requestPermissionsAndSetup();
      if (!mediaStreamRef.current) return; 
    }
    
    if (mediaStreamRef.current && mediaRecorderRef.current?.state !== 'recording') {
      setError(null);
      recordedChunksRef.current = [];
      setRecordedVideoBlob(null);
      if (recordedVideoUrl) URL.revokeObjectURL(recordedVideoUrl);
      setRecordedVideoUrl(null);
      potentialThumbnails.forEach(url => { if (url) URL.revokeObjectURL(url); });
      setPotentialThumbnails(Array(NUM_THUMBNAILS_TO_GENERATE).fill(null));
      setPotentialThumbnailBlobs(Array(NUM_THUMBNAILS_TO_GENERATE).fill(null));
      setSelectedThumbnailIndex(0);
      setDuration(0);
      actualMimeTypeRef.current = '';

      let chosenMimeType = '';
      const isIOS = typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;

      const webmFull = 'video/webm; codecs=vp9,opus';
      const webmSimple = 'video/webm';
      const mp4Simple = 'video/mp4';
      // More specific MP4 types can sometimes be helpful, but simple 'video/mp4' is often best for iOS.
      // const mp4Full = 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"';


      if (isIOS) {
          if (MediaRecorder.isTypeSupported(mp4Simple)) {
              chosenMimeType = mp4Simple;
          }
          // On iOS, we strongly prefer MP4. Don't bother checking WebM.
          console.log("iOS detected, preferring MP4.");
      } else {
          // For non-iOS, try WebM first
          if (MediaRecorder.isTypeSupported(webmFull)) {
              chosenMimeType = webmFull;
          } else if (MediaRecorder.isTypeSupported(webmSimple)) {
              chosenMimeType = webmSimple;
          } else if (MediaRecorder.isTypeSupported(mp4Simple)) { // Fallback to MP4
              chosenMimeType = mp4Simple;
          }
      }
      
      if (!chosenMimeType && MediaRecorder.isTypeSupported('')) {
          console.warn("Could not determine a preferred supported MIME type. Letting browser choose a default.");
          // chosenMimeType remains empty string, MediaRecorder will use browser default
      } else if (!chosenMimeType) {
          setError("Video recording is not supported on this device/browser with any common format.");
          setRecordingState('error');
          return;
      }

      const options: MediaRecorderOptions = {};
      if (chosenMimeType) {
        options.mimeType = chosenMimeType;
      }
      console.log(`Attempting to record with MIME type: ${options.mimeType || 'browser default'}`);


      try {
        mediaRecorderRef.current = new MediaRecorder(mediaStreamRef.current, options);
      } catch (e) {
        console.error("Error creating MediaRecorder:", e);
        const errorMsg = e instanceof Error ? e.message : String(e);
        setError(`Failed to initialize recorder: ${errorMsg}. Try a different browser or check permissions.`);
        setRecordingState('error');
        return;
      }
      
      mediaRecorderRef.current.onstart = () => {
        if (mediaRecorderRef.current?.mimeType) {
          actualMimeTypeRef.current = mediaRecorderRef.current.mimeType;
          console.log(`Recording actually started with MIME type: ${actualMimeTypeRef.current}`);
        } else {
           actualMimeTypeRef.current = chosenMimeType || ''; // Fallback to requested or let it be empty for browser default
           console.log(`Recording started, MediaRecorder.mimeType not available at onstart. Assumed: ${actualMimeTypeRef.current || 'browser default'}`);
        }
        setRecordingState('recording');
        
        let seconds = 0;
        recordingTimerRef.current = setInterval(() => {
          seconds++;
          setDuration(seconds);
          if (seconds * 1000 >= MAX_RECORDING_TIME_MS) {
            stopRecording();
            setError("Maximum recording time reached (30 minutes).");
          }
        }, 1000);
      };

      mediaRecorderRef.current.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };

      mediaRecorderRef.current.onstop = async () => {
        if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
        
        // Use the actualMimeTypeRef.current, which should be set by onstart.
        // Fallback if it's somehow still empty.
        const blobMimeType = actualMimeTypeRef.current || (isIOS ? mp4Simple : webmSimple);
        console.log(`Creating blob with type: ${blobMimeType}`);
        const blob = new Blob(recordedChunksRef.current, { type: blobMimeType });
        
        setRecordedVideoBlob(blob);
        const url = URL.createObjectURL(blob);
        setRecordedVideoUrl(url);
        setRecordingState('stopped'); // Set state before async thumbnail generation

        if (videoPreviewRef.current) {
          videoPreviewRef.current.srcObject = null; 
          videoPreviewRef.current.src = url;
          videoPreviewRef.current.controls = true;
          videoPreviewRef.current.onloadedmetadata = async () => {
             if(videoPreviewRef.current && videoPreviewRef.current.duration > 0) { // Ensure duration is valid
                const videoDuration = Math.round(videoPreviewRef.current.duration);
                setDuration(videoDuration); // Update duration based on actual recorded file
                await generatePotentialThumbnails(url, videoDuration);
             } else if (videoPreviewRef.current && videoPreviewRef.current.duration === 0) {
                console.warn("Video duration is 0 after loading metadata. Thumbnails might not generate correctly.");
                // Potentially try to generate a single thumbnail at a very early time (e.g. 0.1s)
                // if duration is 0 but video plays, or set error for thumbnails.
                // For now, we proceed, and generatePotentialThumbnails might handle 0 duration.
                await generatePotentialThumbnails(url, 0.1); // Try with a small fixed time
             }
          };
          videoPreviewRef.current.onerror = () => {
            console.error("Error loading recorded video in preview element.");
            setError("Could not load the recorded video for preview and thumbnail generation.");
          }
        }
      };
      
      mediaRecorderRef.current.onerror = (event: Event) => { // MediaRecorderErrorEvent is more specific if available
        console.error("MediaRecorder error event:", event);
        // Try to get more specific error type if possible
        let errorDetail = "Unknown recording error.";
        if ('error' in event && event.error instanceof Error) {
            errorDetail = event.error.message;
        } else if (typeof (event as any).name === 'string') {
            errorDetail = (event as any).name;
        }
        setError(`A recording error occurred: ${errorDetail}. Please try again.`);
        setRecordingState('error');
        if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      };

      mediaRecorderRef.current.start();
      // setRecordingState('recording') is now set in onstart to ensure mimeType is captured
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && 
        (mediaRecorderRef.current.state === 'recording' || mediaRecorderRef.current.state === 'paused')) {
      mediaRecorderRef.current.stop();
    }
    // Timer is cleared in onstop
  };
  
  const stopMediaStream = () => {
     if (mediaStreamRef.current) {
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
      videoElement.preload = 'metadata'; // Important for seeking
      videoElement.muted = true; // Important for autoplay if enabled
      videoElement.src = videoUrl;

      videoElement.onloadedmetadata = () => {
        videoElement.currentTime = Math.min(time, videoElement.duration); // Ensure time is within bounds
      };
      
      videoElement.onseeked = () => { // Use onseeked for more reliability after currentTime change
        const canvas = document.createElement('canvas');
        const targetWidth = Math.min(videoElement.videoWidth, 320); 
        if(videoElement.videoWidth === 0) { // Video dimensions not yet available
            videoElement.remove();
            console.warn(`Thumbnail generation failed for time ${time}s: video width is 0.`);
            return reject(new Error("Video dimensions not available for thumbnail."));
        }
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
            }
            videoElement.remove();
            resolve();
          }, 'image/jpeg', 0.85);
        } else {
          videoElement.remove();
          reject(new Error("Canvas context not available for thumbnail generation."));
        }
      };

      videoElement.onerror = (e) => {
          console.error(`Error loading video for thumbnail at time ${time}s.`, e);
          videoElement.remove();
          reject(new Error(`Error loading video for thumbnail at time ${time}s.`));
      }
      // Start loading the video
      videoElement.load(); 
    });
  };

  const generatePotentialThumbnails = async (videoUrl: string, videoDuration: number) => {
    if (videoDuration <= 0 && videoUrl) { // If duration is 0, try a fixed early point
        console.warn("Video duration is 0 or invalid, attempting to generate a single thumbnail at 0.1s");
        try {
            await generateSpecificThumbnail(videoUrl, 0.1, 0);
        } catch(error) {
             console.error("Error generating fallback thumbnail:", error);
             setError("Could not generate thumbnails for the video.");
        }
        return;
    }
    if (videoDuration <= 0) {
        setError("Cannot generate thumbnails: video duration is invalid.");
        return;
    }

    const times = [
      Math.min(1, videoDuration * 0.1), // 10% or 1s, whichever is smaller but >0
      Math.max(0.1, videoDuration * 0.5), // 50%
      Math.max(0.1, videoDuration * 0.9)  // 90%
    ].map(t => Math.max(0.01, t)); // Ensure times are not 0

    const uniqueTimes = [...new Set(times)].slice(0, NUM_THUMBNAILS_TO_GENERATE);
    
    try {
      for (let i = 0; i < uniqueTimes.length; i++) {
        await generateSpecificThumbnail(videoUrl, uniqueTimes[i], i);
      }
    } catch (error) {
        console.error("Error generating one or more thumbnails:", error);
        setError("Could not generate all thumbnails. Please try recording again.");
    }
  };

  const getFileExtensionFromMimeType = (mimeType: string | undefined): string => {
    if (!mimeType) return 'bin'; // Default extension if MIME type is unknown
    const parts = mimeType.split('/');
    const subType = parts[1];
    if (subType) {
        return subType.split(';')[0]; // Handle cases like 'webm; codecs=vp9,opus' -> 'webm'
    }
    return 'bin'; // Fallback if subtype is not found
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
    }
  };

  const handleUpload = async (event: FormEvent) => {
    event.preventDefault();
    const selectedThumbnailBlob = potentialThumbnailBlobs[selectedThumbnailIndex];

    if (!recordedVideoBlob || !selectedThumbnailBlob || !user || !doctorProfile) {
      setError("Missing video data, selected thumbnail, or user information. Please ensure recording is complete and a thumbnail is selected.");
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
      const safeTitle = title.replace(/[^a-z0-9_]+/gi, '_').toLowerCase();
      const timestamp = Date.now();
      const videoExtension = getFileExtensionFromMimeType(recordedVideoBlob.type);
      const videoFileName = `${safeTitle}_${timestamp}.${videoExtension}`;
      const thumbnailFileName = `thumbnail_${safeTitle}_${timestamp}.jpg`;

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
      setUploadProgress(100);

      const videoId = uuidv4();
      const videoData: Omit<VideoMeta, 'id' | 'createdAt' | 'permalink'> = {
        title,
        description,
        doctorId: doctorProfile.uid,
        doctorName: doctorProfile.displayName || doctorProfile.email || 'Unknown Doctor',
        videoUrl,
        thumbnailUrl,
        duration: formatTime(duration), // Use the state `duration` which is updated from video metadata
        recordingDuration: duration, // Store raw seconds
        tags: keywords.split(',').map(k => k.trim()).filter(Boolean),
        viewCount: 0,
        featured,
        storagePath: videoStoragePath,
        thumbnailStoragePath: thumbnailStoragePath,
        videoSize: recordedVideoBlob.size,
        videoType: recordedVideoBlob.type, // This should be the actual blob type
        comments: [], 
      };
      
      await addVideoMetadataToFirestore({ ...videoData, videoId });

      setSuccessMessage("Video uploaded and metadata saved successfully!");
      setRecordingState('success');
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
      stopMediaStream(); 
      if (videoPreviewRef.current) {
        videoPreviewRef.current.src = ""; 
        videoPreviewRef.current.srcObject = null;
        videoPreviewRef.current.controls = false;
      }
      
    } catch (err) {
      console.error("Upload failed:", err);
      setError(`Upload failed: ${err instanceof Error ? err.message : String(err)}`);
      setRecordingState('error');
    } finally {
      setUploadProgress(0);
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
          <AlertDescription>{successMessage} You will be redirected shortly.</AlertDescription>
        </Alert>
      )}

      <Card className="overflow-hidden shadow-lg rounded-xl">
        <CardContent className="p-0">
            <div className="aspect-video bg-slate-900 rounded-t-lg overflow-hidden border-b border-slate-700 shadow-inner relative">
                <video ref={videoPreviewRef} className="w-full h-full object-contain bg-black" autoPlay muted playsInline />
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
            </div>
        </CardContent>
         <CardFooter className="pt-6 pb-6 bg-slate-50 dark:bg-slate-800/50 border-t dark:border-slate-700 flex flex-col sm:flex-row gap-4 items-center justify-center">
            {mediaStreamRef.current && (recordingState === 'idle' || recordingState === 'stopped') && !recordedVideoUrl && (
            <Button onClick={startRecording} className="gap-2 bg-green-500 hover:bg-green-600 text-white w-full sm:w-auto rounded-lg px-6 py-3 text-base" size="lg">
                <Video className="h-5 w-5" /> Start Recording
            </Button>
            )}
            {recordingState === 'recording' && (
            <Button onClick={stopRecording} variant="destructive" className="gap-2 w-full sm:w-auto rounded-lg px-6 py-3 text-base" size="lg">
                <Square className="h-5 w-5" /> Stop Recording
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
                      <Image src={thumbUrl} alt={`Thumbnail ${index + 1}`} layout="fill" objectFit="cover" className="transition-transform group-hover:scale-105" data-ai-hint="video thumbnail preview select"/>
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
             <Button onClick={() => { 
                setRecordedVideoUrl(null); 
                setRecordedVideoBlob(null);
                recordedChunksRef.current = [];
                potentialThumbnails.forEach(url => { if (url) URL.revokeObjectURL(url); });
                setPotentialThumbnails(Array(NUM_THUMBNAILS_TO_GENERATE).fill(null));
                setPotentialThumbnailBlobs(Array(NUM_THUMBNAILS_TO_GENERATE).fill(null));
                setDuration(0);
                actualMimeTypeRef.current = '';
                stopMediaStream(); // Stop current stream if any
                requestPermissionsAndSetup(); // Re-request to ensure preview is active
              }} 
              variant="ghost" className="gap-2 w-full sm:w-auto rounded-lg text-base px-5 py-2.5">
                <Video className="h-5 w-5" /> Record Again
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

