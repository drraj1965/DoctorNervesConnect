
"use client";

import { useState, useRef, useEffect, FormEvent, ChangeEvent, useCallback } from 'react';
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
import { saveUploadedVideoMetadataAction } from './actions';
import { UploadCloud, AlertCircle, CheckCircle, Loader2, Film, Image as ImageIcon, RefreshCcw, RotateCw } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import type { VideoMeta } from '@/types';

const NUM_THUMBNAILS_TO_GENERATE = 5;

export default function UploadLocalVideoPage() {
  const { user, doctorProfile, isAdmin, loading: authLoading } = useAuth();
  const router = useRouter();

  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState<string | null>(null);
  const videoPreviewRef = useRef<HTMLVideoElement | null>(null);
  const [videoDuration, setVideoDuration] = useState(0); // Raw duration in seconds

  const [potentialThumbnails, setPotentialThumbnails] = useState<(string | null)[]>(Array(NUM_THUMBNAILS_TO_GENERATE).fill(null));
  const [potentialThumbnailBlobs, setPotentialThumbnailBlobs] = useState<(Blob | null)[]>(Array(NUM_THUMBNAILS_TO_GENERATE).fill(null));
  const [selectedThumbnailIndex, setSelectedThumbnailIndex] = useState<number | null>(null);
  
  const [isFileProcessing, setIsFileProcessing] = useState(false); // For initial file loading/metadata read
  const [isGeneratingThumbnails, setIsGeneratingThumbnails] = useState(false);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [keywords, setKeywords] = useState('');
  const [featured, setFeatured] = useState(false);
  const [previewRotation, setPreviewRotation] = useState(0);

  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !isAdmin) {
      router.replace('/dashboard');
    }
  }, [authLoading, isAdmin, router]);

  const formatTime = (totalSeconds: number): string => {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = Math.floor(totalSeconds % 60);
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  };
  
  const clearPreviousFileData = () => {
    console.log("UploadPage: clearPreviousFileData called");
    if (videoPreviewUrl) {
      console.log("UploadPage: Revoking old videoPreviewUrl:", videoPreviewUrl);
      URL.revokeObjectURL(videoPreviewUrl);
    }
    setVideoPreviewUrl(null);
    setVideoDuration(0);
    potentialThumbnails.forEach((url, index) => { 
      if (url) {
        console.log(`UploadPage: Revoking old potentialThumbnail URL ${index}:`, url);
        URL.revokeObjectURL(url); 
      }
    });
    setPotentialThumbnails(Array(NUM_THUMBNAILS_TO_GENERATE).fill(null));
    setPotentialThumbnailBlobs(Array(NUM_THUMBNAILS_TO_GENERATE).fill(null));
    setSelectedThumbnailIndex(null);
    setIsGeneratingThumbnails(false);
    setTitle('');
    setDescription('');
    setKeywords('');
    setFeatured(false);
    setPreviewRotation(0);
    if (videoPreviewRef.current) {
        videoPreviewRef.current.src = "";
        videoPreviewRef.current.removeAttribute('src');
        videoPreviewRef.current.poster = ""; 
        videoPreviewRef.current.load();
    }
  }

  const resetForm = useCallback(() => {
    console.log("UploadPage: resetForm (full) called");
    clearPreviousFileData();
    setVideoFile(null); // This clears the current file
    setUploadProgress(0);
    setIsUploading(false);
    setError(null);
    setSuccessMessage(null);
    
    const fileInput = document.getElementById('local-video-file') as HTMLInputElement;
    if (fileInput) fileInput.value = '';
    console.log("UploadPage: resetForm (full) completed");
  }, [videoPreviewUrl, potentialThumbnails]);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    console.log("UploadPage: handleFileChange triggered.");
    setError(null);
    setIsFileProcessing(true); // Start processing feedback
    
    const file = event.target.files?.[0];

    if (file) {
      console.log("UploadPage: File selected:", file.name, file.type, file.size);
      clearPreviousFileData(); // Clear data from any *previous* file
      setVideoFile(file); // Set the new file

      if (!file.type.startsWith('video/')) {
        const typeError = "Invalid file type. Please select a video file (e.g., MP4, WebM).";
        console.error("UploadPage: " + typeError);
        setError(typeError);
        setIsFileProcessing(false);
        setVideoFile(null);
        const fileInput = event.target as HTMLInputElement;
        if (fileInput) fileInput.value = '';
        return;
      }
      
      let objectUrl = '';
      try {
        objectUrl = URL.createObjectURL(file);
        console.log("UploadPage: Created object URL for new file:", objectUrl);
        setVideoPreviewUrl(objectUrl); // This will trigger the onLoadedMetadata of videoPreviewRef
      } catch (urlError) {
        console.error("UploadPage: Error creating object URL:", urlError);
        setError("Could not create a preview for the selected file.");
        setIsFileProcessing(false);
        setVideoFile(null);
        return;
      }
    } else {
      console.log("UploadPage: No file selected in this event.");
      clearPreviousFileData(); // If user cancels, clear previews
      setVideoFile(null);
      setIsFileProcessing(false);
    }
  };

  const handleVideoMetadataLoaded = () => {
    if (videoPreviewRef.current && videoPreviewUrl) {
      const duration = videoPreviewRef.current.duration;
      console.log(`UploadPage: Main video preview metadata loaded. Reported duration: ${duration}s`);
      if (duration > 0 && Number.isFinite(duration)) {
        setVideoDuration(duration);
        generateThumbnailsFromVideoFile(videoPreviewUrl, duration);
      } else {
        console.warn("UploadPage: Video duration is invalid or not available from main preview. Will use fallback for thumbnails if possible.", duration);
        setError("Could not determine video duration. Thumbnails may be inaccurate or fail.");
        // Attempt thumbnail generation with a very short fallback duration, or fixed points
        generateThumbnailsFromVideoFile(videoPreviewUrl, 0.1); // Fallback to 0.1s, knowing it might not be ideal
      }
    }
    setIsFileProcessing(false); // Finished initial file processing (metadata read attempt)
  };

  const handleVideoPreviewError = (e: React.SyntheticEvent<HTMLVideoElement, Event>) => {
    console.error("UploadPage: Main video preview error. Event:", e, "Video element error:", videoPreviewRef.current?.error);
    const videoError = videoPreviewRef.current?.error;
    setError(`Error loading video preview: ${videoError?.message || 'Unknown media error'}. The file might be corrupted or in an unsupported format.`);
    setIsFileProcessing(false);
    // Optionally, still try to generate thumbnails if a videoPreviewUrl exists
    if (videoPreviewUrl) {
        console.warn("UploadPage: Main preview failed, but attempting thumbnail generation with fallback duration.");
        generateThumbnailsFromVideoFile(videoPreviewUrl, 0.1); // Try with a small duration
    }
  };


  const generateSpecificThumbnail = useCallback((videoObjectUrl: string, time: number, index: number): Promise<{ blob: Blob; blobUrl: string } | null> => {
    return new Promise((resolve) => {
      console.log(`UploadPage: generateSpecificThumbnail - Idx ${index}, Time ${time}s from URL: ${videoObjectUrl.substring(0,30)}`);
      const videoElement = document.createElement('video');
      videoElement.preload = 'metadata'; // 'auto' or 'metadata'
      videoElement.muted = true;
      videoElement.crossOrigin = "anonymous"; // Important for canvas.toBlob if source is not same-origin (though blob URLs are)

      let resolved = false;
      const resolveOnce = (value: { blob: Blob; blobUrl: string } | null) => {
        if (resolved) return;
        resolved = true;
        videoElement.remove(); // Clean up the temporary video element
        resolve(value);
      };

      const timeoutId = setTimeout(() => {
        console.warn(`UploadPage: Thumb[${index}] generation timed out after 7s for time ${time}s.`);
        resolveOnce(null);
      }, 7000); // 7-second timeout per thumbnail

      videoElement.onloadedmetadata = async () => {
        console.log(`UploadPage: Thumb[${index}] metadata loaded. Reported duration: ${videoElement.duration}s. Dims: ${videoElement.videoWidth}x${videoElement.videoHeight}. ReadyState: ${videoElement.readyState}. Seeking to ${time}s.`);
        const seekTime = Math.max(0.01, Math.min(time, (videoElement.duration > 0 && Number.isFinite(videoElement.duration)) ? videoElement.duration - 0.01 : time));
        console.log(`UploadPage: Thumb[${index}] - Calculated seekTime: ${seekTime} (original time: ${time})`);
        videoElement.currentTime = seekTime;
        // Some browsers need a slight delay or specific event for reliable seeking
        // 'seeked' is more reliable than 'canplay' or 'loadeddata' for this purpose
      };

      videoElement.onseeked = () => {
        clearTimeout(timeoutId); // Clear timeout once seek is successful
        console.log(`UploadPage: Thumb[${index}] seeked to ${videoElement.currentTime}s. ReadyState: ${videoElement.readyState}. Capturing frame.`);
        
        if (videoElement.videoWidth === 0 || videoElement.videoHeight === 0) {
            console.warn(`UploadPage: Thumbnail[${index}] - Video dimensions 0x0 at capture time. Cannot create thumbnail.`);
            resolveOnce(null); return;
        }
        const canvas = document.createElement('canvas');
        const targetWidth = Math.min(videoElement.videoWidth || 320, 320); 
        const scaleFactor = videoElement.videoWidth > 0 ? targetWidth / videoElement.videoWidth : 1;
        canvas.width = targetWidth;
        canvas.height = (videoElement.videoHeight || 180) * scaleFactor;
        
        if (canvas.width === 0 || canvas.height === 0) {
            console.warn(`UploadPage: Thumbnail[${index}] - Canvas dimensions are zero. Cannot create thumbnail.`);
            resolveOnce(null); return;
        }

        const ctx = canvas.getContext('2d');
        if (ctx) {
            try {
                ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
                canvas.toBlob(blob => {
                    if (blob && blob.size > 0) {
                        console.log(`UploadPage: Thumbnail[${index}] blob created. Size: ${blob.size}`);
                        resolveOnce({ blob, blobUrl: URL.createObjectURL(blob) });
                    } else { 
                        console.warn(`UploadPage: Thumbnail[${index}] toBlob resulted in null or empty blob.`);
                        resolveOnce(null); 
                    }
                }, 'image/jpeg', 0.85); 
            } catch (drawError) { 
                console.error(`UploadPage: DrawImage/toBlob error for thumb ${index}:`, drawError); 
                resolveOnce(null); 
            }
        } else { 
            console.error(`UploadPage: Thumbnail[${index}] - Could not get 2D context for canvas.`);
            resolveOnce(null); 
        }
      };
      
      videoElement.onerror = (e) => { 
        clearTimeout(timeoutId);
        console.error(`UploadPage: Thumb[${index}] video element error:`, videoElement.error, e); 
        resolveOnce(null); 
      };
      
      videoElement.src = videoObjectUrl;
      console.log(`UploadPage: Thumb[${index}] - Calling videoElement.load()`);
      videoElement.load(); // Explicitly call load
    });
  }, []);

  const generateThumbnailsFromVideoFile = useCallback(async (currentVideoObjectUrl: string, duration: number) => {
    if (!currentVideoObjectUrl) {
      setError("Cannot generate thumbnails: video URL is missing.");
      return;
    }
    const effectiveDurationForThumbnails = (duration > 0.01 && Number.isFinite(duration)) ? duration : 0.1; 
    console.log(`UploadPage: Generating thumbnails. Effective duration: ${effectiveDurationForThumbnails}s from URL: ${currentVideoObjectUrl.substring(0,30)}...`);
    setIsGeneratingThumbnails(true);
    
    const oldPotentialThumbnails = [...potentialThumbnails]; // Keep a reference to old URLs for cleanup
    // Don't clear potentialThumbnails/Blobs here yet, do it after new ones are generated or if generation fails completely.

    let timePoints: number[];
    if (effectiveDurationForThumbnails <= 0.1 && duration > 0) { // If original duration was invalid, try fixed points.
        console.warn("UploadPage: Using fixed time points for thumbnails due to very short/invalid effective duration but valid original duration.");
        timePoints = [0.1, 0.5, 1.0, 1.5, 2.0].filter(t => t < duration); // Ensure points are within original valid duration
         if (timePoints.length === 0 && duration > 0.01) timePoints = [duration * 0.1, duration * 0.5, duration * 0.9].filter(t => t >= 0.01);
    } else if (effectiveDurationForThumbnails < 1) { 
        timePoints = [effectiveDurationForThumbnails / 2, Math.min(effectiveDurationForThumbnails * 0.9, effectiveDurationForThumbnails - 0.01)].filter(t => t >= 0.01).slice(0, NUM_THUMBNAILS_TO_GENERATE);
        if(timePoints.length === 0 && effectiveDurationForThumbnails >= 0.01) timePoints = [effectiveDurationForThumbnails * 0.5];
    } else {
        timePoints = Array(NUM_THUMBNAILS_TO_GENERATE).fill(null).map((_, i) => {
            const point = (effectiveDurationForThumbnails / (NUM_THUMBNAILS_TO_GENERATE + 1)) * (i + 1);
            return Math.max(0.01, Math.min(point, effectiveDurationForThumbnails - 0.01)); 
        });
    }
    const uniqueTimes = [...new Set(timePoints)].filter(t => Number.isFinite(t) && t >= 0.01).slice(0, NUM_THUMBNAILS_TO_GENERATE);
    console.log("UploadPage: Thumbnail generation time points:", uniqueTimes);

    if (uniqueTimes.length === 0) {
        console.warn("UploadPage: No valid time points for thumbnail generation.");
        setIsGeneratingThumbnails(false);
        if (!error) setError("Could not determine valid points in the video to create thumbnails. The video might be too short or problematic.");
        setPotentialThumbnails(Array(NUM_THUMBNAILS_TO_GENERATE).fill(null)); // Clear if failed
        setPotentialThumbnailBlobs(Array(NUM_THUMBNAILS_TO_GENERATE).fill(null));
        oldPotentialThumbnails.forEach(url => { if (url) URL.revokeObjectURL(url); });
        return;
    }
    
    const settledResults = await Promise.allSettled(
      uniqueTimes.map((time, index) => generateSpecificThumbnail(currentVideoObjectUrl, time, index))
    );

    const newUrls: (string | null)[] = [];
    const newBlobs: (Blob | null)[] = [];
    settledResults.forEach((result, idx) => {
      if (result.status === 'fulfilled' && result.value) {
        console.log(`UploadPage: Thumbnail generation success for point ${uniqueTimes[idx]}s`);
        newUrls.push(result.value.blobUrl);
        newBlobs.push(result.value.blob);
      } else if (result.status === 'rejected') {
        console.error(`UploadPage: Thumbnail generation FAILED for point ${uniqueTimes[idx]}s:`, result.reason);
      } else if (result.status === 'fulfilled' && !result.value) {
        console.warn(`UploadPage: Thumbnail generation returned null for point ${uniqueTimes[idx]}s.`);
      }
    });
    
    oldPotentialThumbnails.forEach(url => { if (url) URL.revokeObjectURL(url); }); // Cleanup old URLs after new ones are processed

    while (newUrls.length < NUM_THUMBNAILS_TO_GENERATE) newUrls.push(null);
    while (newBlobs.length < NUM_THUMBNAILS_TO_GENERATE) newBlobs.push(null);

    setPotentialThumbnails(newUrls);
    setPotentialThumbnailBlobs(newBlobs);
    const firstValidIdx = newBlobs.findIndex(b => b !== null);
    setSelectedThumbnailIndex(firstValidIdx !== -1 ? firstValidIdx : null);
    setIsGeneratingThumbnails(false);
    console.log(`UploadPage: Thumbnail generation completed. ${newBlobs.filter(b=>b).length} successful.`);
    if (newBlobs.filter(b=>b).length === 0 && !error) { 
        setError("Failed to generate any thumbnails. The video might be too short or in a format that's difficult to process for thumbnails in the browser.");
    }
  }, [generateSpecificThumbnail, error, potentialThumbnails]); // Removed 'error' as it caused loops, added 'potentialThumbnails' for cleanup logic


  const handleUploadSubmit = async (event: FormEvent) => {
    event.preventDefault();
    console.log("UploadPage: handleUploadSubmit initiated.");
    if (!videoFile || selectedThumbnailIndex === null || !potentialThumbnailBlobs[selectedThumbnailIndex!]) {
      const msg = "Please select a video file and a thumbnail.";
      console.error("UploadPage: " + msg); setError(msg); return;
    }
    const selectedThumbnailBlob = potentialThumbnailBlobs[selectedThumbnailIndex!];
    if (!selectedThumbnailBlob) {
      const msg = "Selected thumbnail data is missing.";
      console.error("UploadPage: " + msg); setError(msg); return;
    }
    if (!title.trim()) {
      const msg = "Video title is required.";
      console.error("UploadPage: " + msg); setError(msg); return;
    }
    if (!user || !doctorProfile) {
      const msg = "User or doctor profile not available. Please re-login.";
      console.error("UploadPage: " + msg); setError(msg); return;
    }

    setIsUploading(true);
    setUploadProgress(0);
    setError(null);
    setSuccessMessage(null);
    console.log("UploadPage: Starting upload process...");

    try {
      const safeTitle = title.replace(/[^a-z0-9_]+/gi, '_').toLowerCase() || uuidv4();
      const timestamp = Date.now();
      const videoExtension = videoFile.name.split('.').pop() || 'mp4';
      const videoFileName = `${safeTitle}_${timestamp}.${videoExtension}`;
      const thumbnailFileName = `thumbnail_${safeTitle}_${timestamp}.jpg`;

      console.log(`UploadPage: Uploading video file: videos/${doctorProfile.uid}/${videoFileName}`);
      const videoStoragePath = await uploadFileToStorage(
        `videos/${doctorProfile.uid}`,
        videoFile,
        videoFileName,
        (snapshot) => setUploadProgress(Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 0.9 * 100))
      );
      const uploadedVideoUrl = await getFirebaseStorageDownloadUrl(videoStoragePath);
      console.log("UploadPage: Video file uploaded. URL:", uploadedVideoUrl);
      setUploadProgress(90);

      console.log(`UploadPage: Uploading thumbnail file: thumbnails/${doctorProfile.uid}/${thumbnailFileName}`);
      const thumbnailStoragePath = await uploadFileToStorage(
        `thumbnails/${doctorProfile.uid}`,
        selectedThumbnailBlob,
        thumbnailFileName,
        (snapshot) => setUploadProgress(Math.round(90 + (snapshot.bytesTransferred / snapshot.totalBytes) * 0.1 * 100))
      );
      const uploadedThumbnailUrl = await getFirebaseStorageDownloadUrl(thumbnailStoragePath);
      console.log("UploadPage: Thumbnail file uploaded. URL:", uploadedThumbnailUrl);
      setUploadProgress(100);

      const videoId = uuidv4();
      const videoData: VideoMeta = {
        id: videoId,
        title,
        description,
        doctorId: doctorProfile.uid,
        doctorName: doctorProfile.displayName || doctorProfile.email || 'Unknown Doctor',
        videoUrl: uploadedVideoUrl,
        thumbnailUrl: uploadedThumbnailUrl,
        duration: formatTime(videoDuration), // Uses state `videoDuration`
        recordingDuration: Math.round(videoDuration), // Uses state `videoDuration`
        tags: keywords.split(',').map(k => k.trim()).filter(Boolean),
        createdAt: new Date().toISOString(), 
        viewCount: 0,
        likeCount: 0, 
        commentCount: 0,
        featured,
        permalink: `/videos/${videoId}`,
        storagePath: videoStoragePath,
        thumbnailStoragePath: thumbnailStoragePath,
        videoSize: videoFile.size,
        videoType: videoFile.type,
        comments: [],
      };
      
      console.log("UploadPage: Calling saveUploadedVideoMetadataAction with data:", JSON.stringify(videoData, null, 2));
      const result = await saveUploadedVideoMetadataAction(videoData);

      if (result.success) {
        const successMsg = `Video "${title}" uploaded and metadata saved!`;
        console.log("UploadPage: " + successMsg);
        setSuccessMessage(successMsg);
        resetForm();
      } else {
        throw new Error(result.error || "Failed to save video metadata.");
      }
    } catch (err) {
      console.error("UploadPage: Upload failed:", err);
      setError(err instanceof Error ? err.message : "An unknown error occurred during upload.");
    } finally {
      setIsUploading(false);
      console.log("UploadPage: Upload process finished.");
    }
  };

  const handleRotatePreview = () => {
    setPreviewRotation(current => (current + 90) % 360);
  };
  
  if (authLoading) {
    return <div className="flex items-center justify-center h-screen"><Loader2 className="h-12 w-12 animate-spin text-primary" /></div>;
  }
  if (!isAdmin) {
    return <div className="p-4 text-center text-destructive">Access Denied. You must be an admin to use this feature.</div>;
  }

  return (
    <div className="container mx-auto py-8 space-y-6">
      <Card className="shadow-xl rounded-lg">
        <CardHeader>
          <CardTitle className="text-2xl font-headline flex items-center gap-2">
            <UploadCloud size={28} className="text-primary" /> Upload Local Video File
          </CardTitle>
          <CardDescription>
            Select a video file from your device, add details, and upload it to the platform.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {successMessage && (
            <Alert variant="default" className="bg-green-100 border-green-400 text-green-700 dark:bg-green-900/30 dark:border-green-600 dark:text-green-300">
              <CheckCircle className="h-4 w-4" />
              <AlertTitle>Success!</AlertTitle>
              <AlertDescription>{successMessage}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label htmlFor="local-video-file" className="text-base">Select Video File</Label>
            <Input
              id="local-video-file"
              type="file"
              accept="video/*"
              onChange={(e) => { console.log("UploadPage: File input onChange event fired."); handleFileChange(e); }}
              className="text-base p-2 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-primary/10 file:text-primary hover:file:bg-primary/20"
              disabled={isUploading || isFileProcessing}
            />
          </div>
          
          {isFileProcessing && (
             <div className="text-center py-4">
              <Loader2 className="h-6 w-6 animate-spin text-primary mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">Processing video file...</p>
            </div>
          )}

          {videoPreviewUrl && !isFileProcessing && (
            <>
              <div className="relative group">
                <video
                  ref={videoPreviewRef}
                  src={videoPreviewUrl} // Controlled by state
                  controls
                  playsInline
                  className="w-full aspect-video rounded-md border bg-slate-900 object-contain shadow-inner transition-transform duration-300 ease-in-out"
                  style={{ transform: `rotate(${previewRotation}deg)` }}
                  key={videoPreviewUrl} 
                  onLoadedMetadata={handleVideoMetadataLoaded}
                  onError={handleVideoPreviewError}
                />
                <Button
                    onClick={handleRotatePreview}
                    variant="outline"
                    size="icon"
                    className="absolute top-2 left-2 z-10 bg-black/40 text-white hover:bg-black/60 border-white/30 opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Rotate Preview"
                >
                    <RotateCw size={18} />
                </Button>
                {videoDuration > 0 && Number.isFinite(videoDuration) && (
                    <div className="absolute bottom-2 right-2 bg-black/50 text-white px-2 py-1 rounded text-xs">
                        Duration: {formatTime(videoDuration)}
                    </div>
                )}
              </div>
              
              {isGeneratingThumbnails && (
                <div className="text-center py-4">
                  <Loader2 className="h-6 w-6 animate-spin text-primary mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">Generating thumbnails...</p>
                </div>
              )}

              {!isGeneratingThumbnails && potentialThumbnails.some(t => t) && (
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
                          <Image src={thumbUrl} alt={`Thumbnail ${index + 1}`} fill sizes="(max-width: 768px) 33vw, 20vw" className="object-cover" data-ai-hint="video thumbnail" />
                          {selectedThumbnailIndex === index && (
                            <div className="absolute inset-0 bg-primary/50 flex items-center justify-center">
                              <CheckCircle size={24} className="text-white opacity-90" />
                            </div>
                          )}
                        </button>
                      ) : (
                        <div key={index} className="aspect-video bg-muted rounded-md flex items-center justify-center border border-dashed border-border">
                          <ImageIcon size={24} className="text-muted-foreground" />
                        </div>
                      )
                    ))}
                  </div>
                  {selectedThumbnailIndex === null && <p className="text-xs text-destructive mt-1">Please select a thumbnail.</p>}
                </div>
              )}
               {!isGeneratingThumbnails && !potentialThumbnails.some(t => t) && videoFile && (
                 <Alert variant="default" className="mt-4">
                    <Film className="h-4 w-4"/>
                    <AlertTitle>Thumbnails Pending or Failed</AlertTitle>
                    <AlertDescription>
                        {error && error.includes("thumbnail") ? error : "Thumbnails could not be generated for this video. You can still proceed to upload if you wish, or try a different video file. You can update the thumbnail later."}
                         {!error && " If thumbnails do not appear, the video might be too short or in a format difficult for browser-based processing."}
                    </AlertDescription>
                </Alert>
               )}

              <form onSubmit={handleUploadSubmit} className="space-y-4 pt-4 border-t" id="upload-local-video-form">
                <h3 className="text-lg font-semibold">Video Details</h3>
                 <div className="space-y-1">
                  <Label htmlFor="videoTitle">Video Title <span className="text-destructive">*</span></Label>
                  <Input id="videoTitle" type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Enter a title for the video" required disabled={isUploading}/>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="videoDescription">Description</Label>
                  <Textarea id="videoDescription" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Summarize the video content" rows={3} disabled={isUploading}/>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="videoKeywords">Keywords (comma-separated)</Label>
                  <Input id="videoKeywords" type="text" value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="e.g., cardiology, tutorial" disabled={isUploading}/>
                </div>
                <div className="flex items-center space-x-2">
                    <Checkbox id="featured" checked={featured} onCheckedChange={(checkedStatus) => setFeatured(Boolean(checkedStatus))} disabled={isUploading}/>
                    <Label htmlFor="featured" className="font-normal text-sm">Feature this video</Label>
                </div>
                <Button
                  type="submit"
                  form="upload-local-video-form"
                  disabled={!videoFile || selectedThumbnailIndex === null || !title.trim() || isUploading || (potentialThumbnails.some(t=>t) && (!potentialThumbnailBlobs[selectedThumbnailIndex!] || potentialThumbnailBlobs[selectedThumbnailIndex!]?.size === 0) ) }
                  className="w-full gap-2 bg-primary hover:bg-primary/90 text-primary-foreground"
                >
                  {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud size={18} />}
                  {isUploading ? 'Uploading...' : 'Upload Video to App'}
                </Button>
              </form>
            </>
          )}

          {isUploading && (
            <div className="space-y-2 pt-4 border-t">
              <Label>Upload Progress</Label>
              <Progress value={uploadProgress} className="w-full h-2.5" />
              <p className="text-sm text-muted-foreground text-center">{Math.round(uploadProgress)}%</p>
            </div>
          )}
        </CardContent>
        {successMessage && (
             <CardFooter className="pt-4 border-t">
                <Button onClick={resetForm} variant="outline" className="w-full sm:w-auto">
                    <RefreshCcw size={16} className="mr-2" /> Upload Another Video
                </Button>
            </CardFooter>
        )}
      </Card>
    </div>
  );
}

    