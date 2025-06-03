
"use client";

import { useEffect, useRef, useState, ChangeEvent, FormEvent, useCallback } from "react";
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
import NextImage from "next/image"; // Renamed to avoid conflict
import { getStorage, ref as storageRefFirebase, uploadBytesResumable, getDownloadURL as getFirebaseDownloadURL, UploadTaskSnapshot } from "firebase/storage";
import { useToast } from '@/hooks/use-toast';

const NUM_THUMBNAILS_TO_GENERATE = 5;

export default function VideoRecorderIOSPage() {
  const videoPreviewRef = useRef<HTMLVideoElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordedVideoBlob, setRecordedVideoBlob] = useState<Blob | null>(null);
  const [recordedVideoUrl, setRecordedVideoUrl] = useState<string | null>(null);
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);

  const timerSecondsRef = useRef(0); 
  const [isGeneratingThumbnails, setIsGeneratingThumbnails] = useState(false);
  const [isLocallySaved, setIsLocallySaved] = useState(false);

  const { user, isAdmin, loading: authLoading, doctorProfile } = useAuth();
  const router = useRouter();
  const { toast } = useToast();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [keywords, setKeywords] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [uploadSuccessMessage, setUploadSuccessMessage] = useState<string | null>(null); 
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [previewRotation, setPreviewRotation] = useState(0);
  const actualMimeTypeRef = useRef<string>('');

  const [potentialThumbnails, setPotentialThumbnails] = useState<(string | null)[]>(Array(NUM_THUMBNAILS_TO_GENERATE).fill(null));
  const [potentialThumbnailBlobs, setPotentialThumbnailBlobs] = useState<(Blob | null)[]>(Array(NUM_THUMBNAILS_TO_GENERATE).fill(null));
  const [selectedThumbnailIndex, setSelectedThumbnailIndex] = useState<number | null>(null);
  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);


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
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: true,
      });

      if (!stream.active || stream.getVideoTracks().length === 0 || stream.getVideoTracks()[0].readyState !== 'live') {
        throw new Error(`Camera stream is not active (state: ${stream.getVideoTracks()[0]?.readyState}).`);
      }
      setMediaStream(stream);
      if (videoPreviewRef.current) {
        videoPreviewRef.current.srcObject = stream;
        videoPreviewRef.current.src = "";
        videoPreviewRef.current.muted = true;
        videoPreviewRef.current.controls = false;
        videoPreviewRef.current.setAttribute('playsinline', 'true');
        videoPreviewRef.current.setAttribute('autoplay', 'true');
        await videoPreviewRef.current.play().catch(e => console.warn("VideoRecorderIOS: Error playing live preview:", e));
      }
    } catch (err) {
      console.error("VideoRecorderIOS: Error accessing media devices:", err);
      setError(`Failed to access camera/microphone: ${err instanceof Error ? err.message : String(err)}.`);
    }
  };

  useEffect(() => {
    if (!authLoading && isAdmin) {
      requestPermissionsAndSetup();
    }
    return () => {
      mediaStream?.getTracks().forEach(track => track.stop());
      if (recordedVideoUrl) URL.revokeObjectURL(recordedVideoUrl);
      potentialThumbnails.forEach(url => { if (url) URL.revokeObjectURL(url) });
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    };
  }, [authLoading, isAdmin, mediaStream, recordedVideoUrl, potentialThumbnails]);


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
    const types = [
      'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm',
      'video/mp4;codecs=avc1.4D401E', 'video/mp4;codecs=avc1.42E01E', 'video/mp4;codecs=h264',
      'video/mp4', 'video/quicktime',
    ];
    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) return type;
    }
    return '';
  };

  const startRecording = () => {
    if (!mediaStream || !mediaStream.active || mediaStream.getVideoTracks().length === 0 || mediaStream.getVideoTracks()[0].readyState !== 'live') {
      setError("Media stream not ready. Please ensure camera/mic permissions are granted and active.");
      requestPermissionsAndSetup(); return;
    }

    if (videoPreviewRef.current && videoPreviewRef.current.srcObject !== mediaStream) {
      videoPreviewRef.current.srcObject = mediaStream;
      videoPreviewRef.current.src = "";
      videoPreviewRef.current.muted = true; videoPreviewRef.current.controls = false;
      videoPreviewRef.current.setAttribute('playsinline', 'true'); videoPreviewRef.current.setAttribute('autoplay', 'true');
      videoPreviewRef.current.play().catch(e => console.warn("Error re-playing live preview for recording:", e));
    }
    setRecordedVideoBlob(null); setIsLocallySaved(false);
    if (recordedVideoUrl) URL.revokeObjectURL(recordedVideoUrl); setRecordedVideoUrl(null);
    potentialThumbnails.forEach(url => { if (url) URL.revokeObjectURL(url) });
    setPotentialThumbnails(Array(NUM_THUMBNAILS_TO_GENERATE).fill(null));
    setPotentialThumbnailBlobs(Array(NUM_THUMBNAILS_TO_GENERATE).fill(null));
    setSelectedThumbnailIndex(null); recordedChunksRef.current = [];

    const mimeType = getSupportedMimeType(); actualMimeTypeRef.current = mimeType;
    const options: MediaRecorderOptions = {}; if (mimeType) options.mimeType = mimeType;

    try {
      const recorder = new MediaRecorder(mediaStream, options); mediaRecorderRef.current = recorder;
      timerSecondsRef.current = 0; setError(null); setUploadSuccessMessage(null);

      recorder.onstart = () => {
        if (recorder.mimeType) actualMimeTypeRef.current = recorder.mimeType;
        setIsRecording(true); timerSecondsRef.current = 0;
        if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = setInterval(() => { timerSecondsRef.current++; }, 1000);
      };
      recorder.ondataavailable = (event) => { if (event.data.size > 0) recordedChunksRef.current.push(event.data); };
      recorder.onstop = async () => {
        setIsRecording(false); if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
        const finalRecordedDuration = timerSecondsRef.current;
        const currentMimeType = actualMimeTypeRef.current || mediaRecorderRef.current?.mimeType || (getSupportedMimeType().startsWith('video/webm') ? 'video/webm' : 'video/mp4');
        if (recordedChunksRef.current.length === 0) { setError("No video data recorded."); return; }
        const blob = new Blob(recordedChunksRef.current, { type: currentMimeType });
        if (blob.size === 0) { setError("Recording failed: empty file."); return; }
        setRecordedVideoBlob(blob); const newRecordedVideoUrl = URL.createObjectURL(blob); setRecordedVideoUrl(newRecordedVideoUrl);

        if (videoPreviewRef.current) {
          videoPreviewRef.current.srcObject = null; videoPreviewRef.current.src = ""; 
          videoPreviewRef.current.src = newRecordedVideoUrl;
          videoPreviewRef.current.muted = false; videoPreviewRef.current.controls = true;
          videoPreviewRef.current.load(); 
          
          videoPreviewRef.current.onloadedmetadata = async () => {
            const videoElementReportedDuration = videoPreviewRef.current?.duration;
            let durationForThumbnails = finalRecordedDuration > 0 ? finalRecordedDuration : (videoElementReportedDuration && Number.isFinite(videoElementReportedDuration) && videoElementReportedDuration > 0.1 ? videoElementReportedDuration : 0.1);
            if (blob.size > 0) await generateThumbnailsFromVideo(newRecordedVideoUrl, durationForThumbnails);
            videoPreviewRef.current?.play().catch(e => console.warn("Error playing recorded video for review", e));
          };
          videoPreviewRef.current.onerror = (e) => {
            const videoError = videoPreviewRef.current?.error;
            setError(`Preview Error. Code: ${videoError?.code}, Msg: ${videoError?.message || 'Media error'}.`);
            if (blob.size > 0 && finalRecordedDuration > 0) generateThumbnailsFromVideo(newRecordedVideoUrl, finalRecordedDuration);
          };
        }
      };
      recorder.onerror = (event) => { setError("A recording error occurred."); setIsRecording(false); if (recordingTimerRef.current) clearInterval(recordingTimerRef.current); }
      recorder.start(1000); 
    } catch (e) {
      setError(`Failed to start recorder: ${e instanceof Error ? e.message : String(e)}.`); setIsRecording(false);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop();
    } else {
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current); setIsRecording(false);
    }
  };

  const generateSpecificThumbnail = useCallback((videoObjectUrl: string, time: number, index: number): Promise<{ blob: Blob; blobUrl: string } | null> => {
    return new Promise((resolve) => {
      console.log(`IOSPage: generateSpecificThumbnail - Idx ${index}, Time ${time}s`);
      const videoElement = document.createElement('video');
      videoElement.preload = 'metadata'; videoElement.muted = true; videoElement.src = videoObjectUrl; videoElement.crossOrigin = "anonymous";
      let seekedFired = false, metadataLoaded = false;

      const cleanupAndResolve = (value: { blob: Blob; blobUrl: string } | null) => { videoElement.remove(); resolve(value); };
      const captureFrame = () => {
        if (videoElement.videoWidth === 0 || videoElement.videoHeight === 0) { cleanupAndResolve(null); return; }
        const canvas = document.createElement('canvas');
        const targetWidth = Math.min(videoElement.videoWidth || 320, 320);
        const scaleFactor = videoElement.videoWidth > 0 ? targetWidth / videoElement.videoWidth : 1;
        canvas.width = targetWidth; canvas.height = (videoElement.videoHeight || 180) * scaleFactor;
        if (canvas.width === 0 || canvas.height === 0) { cleanupAndResolve(null); return; }
        const ctx = canvas.getContext('2d');
        if (ctx) {
          try {
            ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
            canvas.toBlob(blob => { blob && blob.size > 0 ? cleanupAndResolve({ blob, blobUrl: URL.createObjectURL(blob) }) : cleanupAndResolve(null); }, 'image/jpeg', 0.85);
          } catch (drawError) { console.error(`IOSPage: Draw error for thumb ${index}`, drawError); cleanupAndResolve(null); }
        } else { cleanupAndResolve(null); }
      };
      
      videoElement.onloadedmetadata = async () => {
        metadataLoaded = true;
        const seekTime = Math.max(0.01, Math.min(time, (videoElement.duration > 0 && Number.isFinite(videoElement.duration)) ? videoElement.duration - 0.01 : time));
        videoElement.currentTime = seekTime; await new Promise(r => setTimeout(r, 50));
        if (videoElement.readyState >= 2 && !seekedFired) captureFrame();
      };
      videoElement.onseeked = () => { if (seekedFired || !metadataLoaded) return; seekedFired = true; captureFrame(); };
      videoElement.onerror = () => cleanupAndResolve(null);
      const timeout = setTimeout(() => { if (!seekedFired && !metadataLoaded) cleanupAndResolve(null); }, 5000);
      videoElement.onseeked = () => { clearTimeout(timeout); if (seekedFired || !metadataLoaded) return; seekedFired = true; captureFrame(); };
      videoElement.load();
    });
  }, []);

  const generateThumbnailsFromVideo = useCallback(async (videoObjectUrl: string, duration: number) => {
    if (!videoObjectUrl || !(duration >= 0 && Number.isFinite(duration))) { // Allow duration 0 for short files
      setError("Cannot generate thumbnails: video duration is invalid or URL missing.");
      setIsGeneratingThumbnails(false); return;
    }
    setIsGeneratingThumbnails(true);
    const oldUrls = [...potentialThumbnails];
    setPotentialThumbnails(Array(NUM_THUMBNAILS_TO_GENERATE).fill(null));
    setPotentialThumbnailBlobs(Array(NUM_THUMBNAILS_TO_GENERATE).fill(null));
    
    let timePoints: number[];
    const effectiveDuration = duration > 0.01 ? duration : 0.1; // Ensure some duration for calculation

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

    const settledResults = await Promise.allSettled(uniqueTimes.map((time, index) => generateSpecificThumbnail(videoObjectUrl, time, index)));
    const newUrls: (string | null)[] = []; const newBlobs: (Blob | null)[] = [];
    settledResults.forEach(result => { if (result.status === 'fulfilled' && result.value) { newUrls.push(result.value.blobUrl); newBlobs.push(result.value.blob); } });
    
    oldUrls.forEach(url => { if (url) URL.revokeObjectURL(url); });
    while (newUrls.length < NUM_THUMBNAILS_TO_GENERATE) newUrls.push(null);
    while (newBlobs.length < NUM_THUMBNAILS_TO_GENERATE) newBlobs.push(null);

    setPotentialThumbnails(newUrls); setPotentialThumbnailBlobs(newBlobs);
    const firstValidIdx = newBlobs.findIndex(b => b !== null);
    setSelectedThumbnailIndex(firstValidIdx !== -1 ? firstValidIdx : null);
    setIsGeneratingThumbnails(false);
  }, [generateSpecificThumbnail, potentialThumbnails]);


  const handleRotatePreview = () => { setPreviewRotation(current => (current + 90) % 360); };

  const resetRecorder = async (isFullReset = true) => {
    stopRecording();
    if (isFullReset && mediaStream) { mediaStream.getTracks().forEach(track => track.stop()); setMediaStream(null); }
    setRecordedVideoBlob(null); setIsLocallySaved(false);
    if (recordedVideoUrl) URL.revokeObjectURL(recordedVideoUrl); setRecordedVideoUrl(null);
    potentialThumbnails.forEach(url => { if (url) URL.revokeObjectURL(url) });
    setPotentialThumbnails(Array(NUM_THUMBNAILS_TO_GENERATE).fill(null));
    setPotentialThumbnailBlobs(Array(NUM_THUMBNAILS_TO_GENERATE).fill(null));
    setSelectedThumbnailIndex(null); recordedChunksRef.current = [];
    timerSecondsRef.current = 0; 
    if (isFullReset) { setTitle(''); setDescription(''); setKeywords(''); }
    setError(null); setUploadSuccessMessage(null); setIsUploading(false); setUploadProgress(0);
    if (videoPreviewRef.current) {
      videoPreviewRef.current.srcObject = null; videoPreviewRef.current.src = "";
      videoPreviewRef.current.controls = false; videoPreviewRef.current.muted = true;
    }
    if (isFullReset) await requestPermissionsAndSetup();
  };

  const saveVideoLocally = () => {
    if (!recordedVideoBlob) { toast({ variant: "destructive", title: "No Video", description: "No recorded video to save." }); return; }
    const urlToSave = recordedVideoUrl || URL.createObjectURL(recordedVideoBlob);
    const a = document.createElement("a"); a.href = urlToSave;
    const safeTitle = title.replace(/[^a-z0-9_]+/gi, '_').toLowerCase() || 'ios_recording';
    const extension = getFileExtensionFromMimeType(recordedVideoBlob.type || actualMimeTypeRef.current);
    a.download = `${safeTitle}_${Date.now()}.${extension}`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    if (!recordedVideoUrl) URL.revokeObjectURL(urlToSave);
    setIsLocallySaved(true);
    toast({ title: "Video Saved Locally", description: `Video saved as ${a.download}. You can now proceed to upload it.` });
  };

  const handleUploadSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!recordedVideoBlob || !user || !doctorProfile) { setError("No video to upload or user data missing."); return; }
    if (!title.trim()) { setError("Please provide a title."); return; }
    if (selectedThumbnailIndex === null || !potentialThumbnailBlobs[selectedThumbnailIndex]) { setError("Please select a thumbnail."); return; }
    const selectedThumbnailBlob = potentialThumbnailBlobs[selectedThumbnailIndex!];
    if (!selectedThumbnailBlob) { setError("Selected thumbnail data missing."); return; }

    setIsUploading(true); setUploadProgress(0); setError(null); setUploadSuccessMessage(null);
    const currentUserId = doctorProfile.uid;
    const currentDoctorName = doctorProfile.displayName || doctorProfile.email || "Unknown Doctor";

    try {
      const safeTitleForFile = title.replace(/[^a-z0-9_]+/gi, '_').toLowerCase();
      const timestamp = Date.now();
      const videoExtension = getFileExtensionFromMimeType(recordedVideoBlob.type || actualMimeTypeRef.current);
      const videoFileName = `${safeTitleForFile}_ios_${timestamp}.${videoExtension}`;
      const videoStoragePath = `videos/${currentUserId}/${videoFileName}`;
      const thumbnailFileName = `thumb_${safeTitleForFile}_ios_${timestamp}.jpg`;
      const thumbnailStoragePath = `thumbnails/${currentUserId}/${thumbnailFileName}`;

      const videoFileRef = storageRefFirebase(firebaseStorage, videoStoragePath);
      const videoUploadTask = uploadBytesResumable(videoFileRef, recordedVideoBlob);
      videoUploadTask.on('state_changed', (s) => setUploadProgress( (s.bytesTransferred / s.totalBytes) * 0.8 * 100 ), 
        (err) => { setError(`Video upload failed: ${err.message}`); setIsUploading(false); },
        async () => {
          const downloadURL = await getFirebaseDownloadURL(videoUploadTask.snapshot.ref);
          const thumbFileRef = storageRefFirebase(firebaseStorage, thumbnailStoragePath);
          const thumbUploadTask = uploadBytesResumable(thumbFileRef, selectedThumbnailBlob);
          thumbUploadTask.on('state_changed', (s) => setUploadProgress(80 + (s.bytesTransferred / s.totalBytes) * 0.2 * 100),
            (err) => { setError(`Thumbnail upload failed: ${err.message}.`); setIsUploading(false); },
            async () => {
              const thumbDownloadURL = await getFirebaseDownloadURL(thumbUploadTask.snapshot.ref);
              const videoId = uuidv4();
              const videoMetaDataForAction = {
                videoId, title, description, keywords: keywords.split(',').map(k => k.trim()).filter(Boolean),
                videoUrl: downloadURL, storagePath: videoStoragePath, thumbnailUrl: thumbDownloadURL, thumbnailStoragePath,
                videoSize: recordedVideoBlob.size, videoType: recordedVideoBlob.type || actualMimeTypeRef.current,
                recordingDuration: timerSecondsRef.current, doctorId: doctorProfile.uid, doctorName: currentDoctorName,
                duration: formatTime(timerSecondsRef.current), viewCount: 0, likeCount: 0, commentCount: 0, featured: false, comments: [],
              };
              const result = await addVideoMetadataFromIOSAction(videoMetaDataForAction as any);
              if (result.success) {
                setUploadSuccessMessage(`Video "${title}" uploaded!`); setIsUploading(false);
                resetRecorder(false); // Soft reset, keep camera stream if possible
              } else { throw new Error(result.error || "Failed to save metadata."); }
            }
          );
        }
      );
    } catch (err) { setError(`Operation failed: ${err instanceof Error ? err.message : String(err)}`); setIsUploading(false); }
  };


  if (authLoading) return <div className="flex items-center justify-center h-screen"><Loader2 className="h-12 w-12 animate-spin text-primary" /></div>;
  if (!isAdmin) return <div className="p-4 text-center text-destructive">Access Denied.</div>;

  const canSaveLocally = recordedVideoBlob && title.trim() && selectedThumbnailIndex !== null && potentialThumbnailBlobs[selectedThumbnailIndex] !== null;
  const canUpload = isLocallySaved && canSaveLocally;

  const showUploadForm = recordedVideoBlob && !isUploading && !uploadSuccessMessage;
  const showLiveRecordControls = mediaStream && !recordedVideoBlob && !uploadSuccessMessage;
  const showSetupCamera = !mediaStream && !recordedVideoBlob && !uploadSuccessMessage;
  const actualBlobTypeForDisplay = recordedVideoBlob?.type || actualMimeTypeRef.current || 'N/A';

  return (
    <div className="container mx-auto p-4 space-y-6">
      <Card className="shadow-xl rounded-lg">
        <CardHeader>
          <CardTitle className="text-2xl font-headline flex items-center gap-2"><Camera size={28} /> iOS Video Recorder</CardTitle>
          <CardDescription>Optimized for iOS & Safari. Preview rotation only affects display.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground border p-2 rounded-md">
            Debug: Stream: {mediaStream ? 'OK' : 'N/A'}. Recording: {isRecording.toString()}. Blob: {recordedVideoBlob ? `${(recordedVideoBlob.size / 1024 / 1024).toFixed(2)} MB (${actualBlobTypeForDisplay})` : 'No'}. Timer: {timerSecondsRef.current}s. Rotation: {previewRotation}°. Saved: {isLocallySaved.toString()}
          </p>
          {error && <Alert variant="destructive"><AlertCircle /><AlertTitle>Error</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
          {uploadSuccessMessage && <Alert className="bg-green-100"><CheckCircle /><AlertTitle>Success</AlertTitle><AlertDescription>{uploadSuccessMessage}</AlertDescription></Alert>}

          <div className="relative group">
            <video ref={videoPreviewRef} autoPlay={!recordedVideoUrl} muted={!recordedVideoUrl} playsInline controls={!!recordedVideoUrl}
              className="w-full aspect-video rounded-md border bg-slate-900 object-contain transition-transform"
              style={{ transform: `rotate(${previewRotation}deg)` }} key={recordedVideoUrl || 'live_preview_ios'} />
            {((mediaStream && !recordedVideoBlob) || recordedVideoBlob) && !isUploading && (
              <Button onClick={handleRotatePreview} variant="outline" size="icon" className="absolute top-2 left-2 z-10" title="Rotate Preview"><RotateCw /></Button>)}
            {isRecording && <div className="absolute top-4 right-4 bg-red-600 text-white px-2 py-1 rounded-md text-xs flex items-center gap-1"><Mic /> REC {formatTime(timerSecondsRef.current)}</div>}
          </div>

          {showLiveRecordControls && (
            <div className="flex flex-col sm:flex-row gap-2">
              {!isRecording ? (<Button onClick={startRecording} disabled={isUploading} className="flex-1 gap-2 bg-green-600"><Mic /> Start Recording</Button>)
               : (<Button onClick={stopRecording} disabled={isUploading} className="flex-1 gap-2 bg-red-600"><Square /> Stop Recording</Button>)}
            </div>
          )}
          {showSetupCamera && <Button onClick={() => requestPermissionsAndSetup()} variant="outline" className="w-full gap-2"><Camera /> Setup Camera & Mic</Button>}
          {uploadSuccessMessage && <Button onClick={() => resetRecorder(true)} variant="default" className="w-full gap-2"><RefreshCcw /> Record Another</Button>}

          {showUploadForm && (
            <form onSubmit={handleUploadSubmit} className="space-y-4 pt-4 border-t" id="ios-upload-form">
              <h3 className="text-lg font-semibold">Review & Upload</h3>
              {isGeneratingThumbnails && <div className="text-center py-2"><Loader2 className="animate-spin inline-block mr-2"/>Generating thumbnails...</div>}
              {!isGeneratingThumbnails && (
                <div>
                  <Label className="mb-2 block text-sm font-medium">Select Thumbnail <span className="text-destructive">*</span></Label>
                  <div className="grid grid-cols-3 md:grid-cols-5 gap-2">
                    {potentialThumbnails.map((thumbUrl, index) => (thumbUrl ? (
                        <button type="button" key={index} onClick={() => setSelectedThumbnailIndex(index)}
                          className={`relative aspect-video rounded-md overflow-hidden border-2 ${selectedThumbnailIndex === index ? 'border-primary ring-2' : 'border-muted'}`}>
                          <NextImage src={thumbUrl} alt={`T${index}`} fill sizes="(max-width: 768px) 33vw, 20vw" className="object-cover" data-ai-hint="thumbnail selection"/>
                          {selectedThumbnailIndex === index && <div className="absolute inset-0 bg-primary/50 flex items-center justify-center"><CheckCircle className="text-white"/></div>}
                        </button>) 
                      : (<div key={index} className="aspect-video bg-muted rounded-md flex items-center justify-center border"><ImageIcon/></div>)
                    ))}
                  </div>
                  {selectedThumbnailIndex === null && potentialThumbnails.some(t=>t) && <p className="text-xs text-destructive mt-1">Please select a thumbnail.</p>}
                </div>
              )}
              <div className="space-y-1"><Label htmlFor="videoTitle">Title <span className="text-destructive">*</span></Label><Input id="videoTitle" value={title} onChange={(e) => setTitle(e.target.value)} required /></div>
              <div className="space-y-1"><Label htmlFor="videoDescription">Description</Label><Textarea id="videoDescription" value={description} onChange={(e) => setDescription(e.target.value)} rows={3}/></div>
              <div className="space-y-1"><Label htmlFor="videoKeywords">Keywords</Label><Input id="videoKeywords" value={keywords} onChange={(e) => setKeywords(e.target.value)} /></div>
              <div className="flex flex-col sm:flex-row gap-2">
                <Button type="button" onClick={saveVideoLocally} variant="outline" className="flex-1 gap-2" disabled={!canSaveLocally || isLocallySaved}>
                  <Download /> {isLocallySaved ? "Saved Locally" : "Save to Device"}
                </Button>
                <Button type="submit" form="ios-upload-form" disabled={!canUpload || isUploading} className="flex-1 gap-2 bg-primary">
                  {isUploading ? <Loader2 className="animate-spin"/> : <UploadCloud />} Upload to App
                </Button>
              </div>
            </form>
          )}
          {isUploading && (<div className="space-y-2 pt-4 border-t"><Label>Upload Progress</Label><Progress value={uploadProgress}/> <p>{Math.round(uploadProgress)}%</p></div>)}
        </CardContent>
        <CardFooter className="flex flex-col sm:flex-row gap-2 pt-4 border-t">
          <Button onClick={() => resetRecorder(true)} variant="outline" className="w-full sm:w-auto"><RefreshCcw className="mr-2"/> Reset & Re-initialize Camera</Button>
        </CardFooter>
      </Card>
    </div>
  );
}

// Helper to format time, already used in VideoRecorder.tsx
function formatTime(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
