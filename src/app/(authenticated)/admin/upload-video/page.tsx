
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
import { saveUploadedVideoMetadataAction } from './actions'; // New action
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
  const [videoDuration, setVideoDuration] = useState(0);

  const [potentialThumbnails, setPotentialThumbnails] = useState<(string | null)[]>(Array(NUM_THUMBNAILS_TO_GENERATE).fill(null));
  const [potentialThumbnailBlobs, setPotentialThumbnailBlobs] = useState<(Blob | null)[]>(Array(NUM_THUMBNAILS_TO_GENERATE).fill(null));
  const [selectedThumbnailIndex, setSelectedThumbnailIndex] = useState<number | null>(null);
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
  
  const resetForm = () => {
    setVideoFile(null);
    if (videoPreviewUrl) URL.revokeObjectURL(videoPreviewUrl);
    setVideoPreviewUrl(null);
    setVideoDuration(0);
    potentialThumbnails.forEach(url => { if (url) URL.revokeObjectURL(url); });
    setPotentialThumbnails(Array(NUM_THUMBNAILS_TO_GENERATE).fill(null));
    setPotentialThumbnailBlobs(Array(NUM_THUMBNAILS_TO_GENERATE).fill(null));
    setSelectedThumbnailIndex(null);
    setIsGeneratingThumbnails(false);
    setTitle('');
    setDescription('');
    setKeywords('');
    setFeatured(false);
    setUploadProgress(0);
    setIsUploading(false);
    setError(null);
    setSuccessMessage(null);
    setPreviewRotation(0);
    if (videoPreviewRef.current) {
        videoPreviewRef.current.src = "";
        videoPreviewRef.current.removeAttribute('src');
        videoPreviewRef.current.load();
    }
    const fileInput = document.getElementById('local-video-file') as HTMLInputElement;
    if (fileInput) fileInput.value = '';
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    resetForm(); // Reset previous state when a new file is selected
    const file = event.target.files?.[0];
    if (file) {
      if (!file.type.startsWith('video/')) {
        setError("Invalid file type. Please select a video file.");
        return;
      }
      setVideoFile(file);
      const url = URL.createObjectURL(file);
      setVideoPreviewUrl(url);

      // Get duration and generate thumbnails
      const tempVideoEl = document.createElement('video');
      tempVideoEl.preload = 'metadata';
      tempVideoEl.onloadedmetadata = () => {
        setVideoDuration(tempVideoEl.duration);
        generateThumbnailsFromVideoFile(url, tempVideoEl.duration);
        URL.revokeObjectURL(tempVideoEl.src); // Clean up temporary object URL
      };
      tempVideoEl.onerror = () => {
        setError("Could not load video metadata. The file might be corrupted or in an unsupported format.");
        URL.revokeObjectURL(tempVideoEl.src);
      }
      tempVideoEl.src = url; // Use the same URL as preview, it's fine
    }
  };

  const generateSpecificThumbnail = useCallback((videoObjectUrl: string, time: number, index: number): Promise<{ blob: Blob; blobUrl: string } | null> => {
    return new Promise((resolve) => {
      console.log(`UploadPage: generateSpecificThumbnail - Idx ${index}, Time ${time}s`);
      const videoElement = document.createElement('video');
      videoElement.preload = 'metadata';
      videoElement.muted = true;
      videoElement.src = videoObjectUrl;
      videoElement.crossOrigin = "anonymous";

      let seekedFired = false;
      let metadataLoaded = false;

      const cleanupAndResolve = (value: { blob: Blob; blobUrl: string } | null) => {
          videoElement.remove();
          resolve(value);
      };

      const captureFrame = () => {
        if (videoElement.videoWidth === 0 || videoElement.videoHeight === 0) {
            console.warn(`UploadPage: Thumbnail[${index}] - Video dimensions 0x0 at capture.`);
            cleanupAndResolve(null); return;
        }
        const canvas = document.createElement('canvas');
        const targetWidth = Math.min(videoElement.videoWidth || 320, 320);
        const scaleFactor = videoElement.videoWidth > 0 ? targetWidth / videoElement.videoWidth : 1;
        canvas.width = targetWidth;
        canvas.height = (videoElement.videoHeight || 180) * scaleFactor;
        if (canvas.width === 0 || canvas.height === 0) { cleanupAndResolve(null); return; }

        const ctx = canvas.getContext('2d');
        if (ctx) {
            try {
                ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
                canvas.toBlob(blob => {
                    if (blob && blob.size > 0) {
                        cleanupAndResolve({ blob, blobUrl: URL.createObjectURL(blob) });
                    } else { cleanupAndResolve(null); }
                }, 'image/jpeg', 0.85);
            } catch (drawError) { console.error(`UploadPage: Draw error for thumb ${index}`, drawError); cleanupAndResolve(null); }
        } else { cleanupAndResolve(null); }
      };
      
      videoElement.onloadedmetadata = async () => {
          metadataLoaded = true;
          console.log(`UploadPage: Thumb[${index}] metadata. Duration: ${videoElement.duration}s. Dims: ${videoElement.videoWidth}x${videoElement.videoHeight}. Seeking to ${time}s.`);
          const seekTime = Math.max(0.01, Math.min(time, (videoElement.duration > 0 && Number.isFinite(videoElement.duration)) ? videoElement.duration - 0.01 : time));
          videoElement.currentTime = seekTime;
          await new Promise(r => setTimeout(r, 50));
          if (videoElement.readyState >= 2 && !seekedFired) captureFrame();
      };
      videoElement.onseeked = () => {
          if (seekedFired) return;
          if (!metadataLoaded) { console.warn(`UploadPage: Thumb[${index}] seeked before metadata.`); return; }
          seekedFired = true;
          captureFrame();
      };
      videoElement.onerror = (e) => { console.error(`UploadPage: Thumb[${index}] video error:`, videoElement.error, e); cleanupAndResolve(null); };
      
      const timeout = setTimeout(() => { if (!seekedFired && !metadataLoaded) cleanupAndResolve(null); }, 5000);
      videoElement.onseeked = () => { clearTimeout(timeout); /* Original onseeked logic duplicated */ if (seekedFired) return; if (!metadataLoaded) return; seekedFired = true; captureFrame(); };
      videoElement.load();
    });
  }, []);

  const generateThumbnailsFromVideoFile = useCallback(async (videoObjectUrl: string, duration: number) => {
    if (!videoObjectUrl || duration <= 0) {
      setError("Cannot generate thumbnails: video duration is invalid or URL missing.");
      return;
    }
    console.log(`UploadPage: Generating thumbnails. Duration: ${duration}s`);
    setIsGeneratingThumbnails(true);
    potentialThumbnails.forEach(url => { if (url) URL.revokeObjectURL(url); });
    setPotentialThumbnails(Array(NUM_THUMBNAILS_TO_GENERATE).fill(null));
    setPotentialThumbnailBlobs(Array(NUM_THUMBNAILS_TO_GENERATE).fill(null));

    let timePoints: number[];
    if (duration < 1) { // Very short video
        timePoints = [duration / 2, Math.min(duration * 0.9, duration - 0.01)].filter(t => t > 0.01).slice(0, NUM_THUMBNAILS_TO_GENERATE);
        if(timePoints.length === 0 && duration > 0.01) timePoints = [duration * 0.5];
    } else {
        timePoints = Array(NUM_THUMBNAILS_TO_GENERATE).fill(null).map((_, i) => {
            const point = (duration / (NUM_THUMBNAILS_TO_GENERATE + 1)) * (i + 1);
            return Math.max(0.01, Math.min(point, duration - 0.01));
        });
    }
    const uniqueTimes = [...new Set(timePoints)].filter(t => Number.isFinite(t) && t > 0).slice(0, NUM_THUMBNAILS_TO_GENERATE);

    const settledResults = await Promise.allSettled(
      uniqueTimes.map((time, index) => generateSpecificThumbnail(videoObjectUrl, time, index))
    );

    const newUrls: (string | null)[] = [];
    const newBlobs: (Blob | null)[] = [];
    settledResults.forEach((result) => {
      if (result.status === 'fulfilled' && result.value) {
        newUrls.push(result.value.blobUrl);
        newBlobs.push(result.value.blob);
      }
    });
    
    // Pad with nulls if fewer than NUM_THUMBNAILS_TO_GENERATE were successful
    while (newUrls.length < NUM_THUMBNAILS_TO_GENERATE) newUrls.push(null);
    while (newBlobs.length < NUM_THUMBNAILS_TO_GENERATE) newBlobs.push(null);

    setPotentialThumbnails(newUrls);
    setPotentialThumbnailBlobs(newBlobs);
    const firstValidIdx = newBlobs.findIndex(b => b !== null);
    setSelectedThumbnailIndex(firstValidIdx !== -1 ? firstValidIdx : null);
    setIsGeneratingThumbnails(false);
    console.log(`UploadPage: Thumbnail generation completed. ${newBlobs.filter(b=>b).length} successful.`);
  }, [generateSpecificThumbnail, potentialThumbnails]);


  const handleUploadSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!videoFile || selectedThumbnailIndex === null || !potentialThumbnailBlobs[selectedThumbnailIndex]) {
      setError("Please select a video file and a thumbnail.");
      return;
    }
    const selectedThumbnailBlob = potentialThumbnailBlobs[selectedThumbnailIndex!];
    if (!selectedThumbnailBlob) {
      setError("Selected thumbnail data is missing.");
      return;
    }
    if (!title.trim()) {
      setError("Video title is required.");
      return;
    }
    if (!user || !doctorProfile) {
      setError("User or doctor profile not available. Please re-login.");
      return;
    }

    setIsUploading(true);
    setUploadProgress(0);
    setError(null);
    setSuccessMessage(null);

    try {
      const safeTitle = title.replace(/[^a-z0-9_]+/gi, '_').toLowerCase() || uuidv4();
      const timestamp = Date.now();
      const videoExtension = videoFile.name.split('.').pop() || 'mp4';
      const videoFileName = `${safeTitle}_${timestamp}.${videoExtension}`;
      const thumbnailFileName = `thumbnail_${safeTitle}_${timestamp}.jpg`;

      const videoStoragePath = await uploadFileToStorage(
        `videos/${doctorProfile.uid}`,
        videoFile,
        videoFileName,
        (snapshot) => setUploadProgress(Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 0.9 * 100))
      );
      const uploadedVideoUrl = await getFirebaseStorageDownloadUrl(videoStoragePath);
      setUploadProgress(90);

      const thumbnailStoragePath = await uploadFileToStorage(
        `thumbnails/${doctorProfile.uid}`,
        selectedThumbnailBlob,
        thumbnailFileName,
        (snapshot) => setUploadProgress(Math.round(90 + (snapshot.bytesTransferred / snapshot.totalBytes) * 0.1 * 100))
      );
      const uploadedThumbnailUrl = await getFirebaseStorageDownloadUrl(thumbnailStoragePath);
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
        duration: formatTime(videoDuration),
        recordingDuration: Math.round(videoDuration),
        tags: keywords.split(',').map(k => k.trim()).filter(Boolean),
        createdAt: new Date().toISOString(), // Will be replaced by serverTimestamp in action
        viewCount: 0,
        featured,
        permalink: `/videos/${videoId}`,
        storagePath: videoStoragePath,
        thumbnailStoragePath: thumbnailStoragePath,
        videoSize: videoFile.size,
        videoType: videoFile.type,
        comments: [],
      };

      const result = await saveUploadedVideoMetadataAction(videoData);

      if (result.success) {
        setSuccessMessage(`Video "${title}" uploaded and metadata saved!`);
        resetForm(); // Reset form after successful upload
      } else {
        throw new Error(result.error || "Failed to save video metadata.");
      }
    } catch (err) {
      console.error("Upload failed:", err);
      setError(err instanceof Error ? err.message : "An unknown error occurred during upload.");
    } finally {
      setIsUploading(false);
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
              onChange={handleFileChange}
              className="text-base p-2 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-primary/10 file:text-primary hover:file:bg-primary/20"
              disabled={isUploading}
            />
          </div>

          {videoPreviewUrl && (
            <>
              <div className="relative group">
                <video
                  ref={videoPreviewRef}
                  src={videoPreviewUrl}
                  controls
                  playsInline
                  className="w-full aspect-video rounded-md border bg-slate-900 object-contain shadow-inner transition-transform duration-300 ease-in-out"
                  style={{ transform: `rotate(${previewRotation}deg)` }}
                  key={videoPreviewUrl}
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
                {videoDuration > 0 && (
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
                  disabled={!videoFile || selectedThumbnailIndex === null || !title.trim() || isUploading}
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
