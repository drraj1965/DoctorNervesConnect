
"use client";

import { useEffect, useState, FormEvent, ChangeEvent } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox'; // Added Checkbox
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import Link from "next/link";
import Image from 'next/image';
import { ArrowLeft, UploadCloud, AlertCircle, CheckCircle, Loader2 } from "lucide-react";
import { getVideoById, updateVideoMetadata as updateVideoMetadataFirestore } from "@/lib/firebase/firestore"; 
import type { VideoMeta } from "@/types";
import { useToast } from '@/hooks/use-toast';
import { updateVideoThumbnailAction } from './actions'; 
import { updateDoc, doc } from "firebase/firestore";
import { db } from "@/lib/firebase/config"; 
import { revalidatePath } from 'next/cache'; // This will cause an error in client component, remove if not inside server action

export default function EditVideoPage({ params }: { params: { id: string } }) {
  const videoId = params.id;
  const router = useRouter();
  const { toast } = useToast();

  const [video, setVideo] = useState<VideoMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [featured, setFeatured] = useState(false);
  const [newThumbnailFile, setNewThumbnailFile] = useState<File | null>(null);
  const [thumbnailPreview, setThumbnailPreview] = useState<string | null>(null);
  
  const [isUpdatingDetails, setIsUpdatingDetails] = useState(false);
  const [isUpdatingThumbnail, setIsUpdatingThumbnail] = useState(false);

  useEffect(() => {
    if (videoId) {
      const fetchVideo = async () => {
        setLoading(true);
        setError(null);
        try {
          const fetchedVideo = await getVideoById(videoId as string);
          if (fetchedVideo) {
            setVideo(fetchedVideo);
            setTitle(fetchedVideo.title);
            setDescription(fetchedVideo.description);
            setTags(fetchedVideo.tags.join(', '));
            setFeatured(fetchedVideo.featured);
            setThumbnailPreview(fetchedVideo.thumbnailUrl);
          } else {
            setError("Video not found.");
          }
        } catch (err) {
          console.error("Failed to fetch video:", err);
          setError("Failed to load video data.");
        } finally {
          setLoading(false);
        }
      };
      fetchVideo();
    }
  }, [videoId]);

  const handleThumbnailChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setNewThumbnailFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setThumbnailPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleUpdateThumbnail = async () => {
    if (!newThumbnailFile || !video) {
      toast({ variant: "destructive", title: "No new thumbnail selected." });
      return;
    }
    setIsUpdatingThumbnail(true);
    setError(null);
    try {
      const result = await updateVideoThumbnailAction(videoId, newThumbnailFile, video.thumbnailStoragePath);
      if (result.success && result.newThumbnailUrl) {
        toast({ title: "Thumbnail Updated", description: "The video thumbnail has been successfully updated." });
        setVideo(prev => prev ? { ...prev, thumbnailUrl: result.newThumbnailUrl!, thumbnailStoragePath: result.newThumbnailStoragePath || prev.thumbnailStoragePath } : null);
        setThumbnailPreview(result.newThumbnailUrl); 
        setNewThumbnailFile(null); 
      } else {
        throw new Error(result.error || "Failed to update thumbnail.");
      }
    } catch (err) {
      console.error("Failed to update thumbnail:", err);
      setError(err instanceof Error ? err.message : "An unknown error occurred.");
      toast({ variant: "destructive", title: "Update Failed", description: err instanceof Error ? err.message : "Could not update thumbnail." });
    } finally {
      setIsUpdatingThumbnail(false);
    }
  };
  
  const handleUpdateDetails = async (event: FormEvent) => {
    event.preventDefault();
    if (!video) return;
    setIsUpdatingDetails(true);
    setError(null);
    try {
        const updatedData = {
            title,
            description,
            tags: tags.split(',').map(t => t.trim()).filter(Boolean),
            featured
        };
      
        await updateVideoMetadataFirestore(videoId, updatedData); 

        toast({ title: "Video Details Updated", description: "The video metadata has been saved." });
        setVideo(prev => prev ? { ...prev, ...updatedData, tags: updatedData.tags } : null);
        // Revalidation should happen in server action or via API route for proper effect
        // router.refresh(); // Simple client-side refresh for now
    } catch (err) {
        console.error("Failed to update video details:", err);
        setError(err instanceof Error ? err.message : "An unknown error occurred while saving details.");
        toast({ variant: "destructive", title: "Update Failed", description: err instanceof Error ? err.message : "Could not save video details." });
    } finally {
        setIsUpdatingDetails(false);
    }
  };


  if (loading) {
    return (
      <div className="container mx-auto py-8">
        <Skeleton className="h-8 w-32 mb-4" /> 
        <Card>
          <CardHeader><Skeleton className="h-7 w-1/2" /></CardHeader>
          <CardContent className="space-y-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-40 w-1/3" />
            <Skeleton className="h-10 w-1/4" />
          </CardContent>
          <CardFooter><Skeleton className="h-10 w-24" /></CardFooter>
        </Card>
      </div>
    );
  }

  if (error && !video) {
    return (
      <div className="container mx-auto py-8 text-center">
        <Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertTitle>Error</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>
        <Button onClick={() => router.back()} variant="outline" className="mt-4">Go Back</Button>
      </div>
    );
  }
  
  if (!video) {
     return <div className="container mx-auto py-8 text-center"><p>Video data could not be loaded.</p></div>;
  }

  return (
    <div className="container mx-auto py-8">
      <Link href={`/videos/${videoId}`} passHref className="mb-6 inline-block">
        <Button variant="outline" size="sm" className="gap-2">
            <ArrowLeft size={16} /> Back to Video
        </Button>
      </Link>
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl font-headline">Edit Video: {video.title}</CardTitle>
          <CardDescription>
            Modify the video's metadata and thumbnail.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-8">
          {error && ( // Display general errors from page state
            <Alert variant="destructive" className="mb-4">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <form onSubmit={handleUpdateDetails} id="video-details-form" className="space-y-4">
            <div>
              <Label htmlFor="title">Title <span className="text-destructive">*</span></Label>
              <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} required />
            </div>
            <div>
              <Label htmlFor="description">Description</Label>
              <Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} rows={5} />
            </div>
            <div>
              <Label htmlFor="tags">Tags (comma-separated)</Label>
              <Input id="tags" value={tags} onChange={(e) => setTags(e.target.value)} />
            </div>
            <div className="flex items-center space-x-2 pt-2">
                <Checkbox id="featured" checked={featured} onCheckedChange={(checkedStatus) => setFeatured(Boolean(checkedStatus))} />
                <Label htmlFor="featured" className="font-normal text-sm">Feature this video on Homepage</Label>
            </div>
             <Button type="submit" disabled={isUpdatingDetails} className="w-full sm:w-auto">
                {isUpdatingDetails ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Save Details
            </Button>
          </form>

          <div className="space-y-4 border-t pt-6">
            <h3 className="text-lg font-medium">Update Thumbnail</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
                <div>
                    <Label htmlFor="thumbnail">New Thumbnail File</Label>
                    <Input id="thumbnail" type="file" accept="image/*" onChange={handleThumbnailChange} className="mt-1" />
                    {newThumbnailFile && <p className="text-xs text-muted-foreground mt-1">Selected: {newThumbnailFile.name}</p>}
                </div>
                {thumbnailPreview && (
                    <div className="space-y-2">
                        <Label>Current/New Preview</Label>
                        <Image 
                            src={thumbnailPreview} 
                            alt="Thumbnail preview" 
                            width={320} 
                            height={180} 
                            className="rounded-md border object-cover aspect-video"
                            data-ai-hint="video thumbnail"
                        />
                    </div>
                )}
            </div>
            {newThumbnailFile && (
              <Button onClick={handleUpdateThumbnail} disabled={isUpdatingThumbnail} className="w-full sm:w-auto gap-1.5">
                {isUpdatingThumbnail ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UploadCloud size={16}/>}
                Upload New Thumbnail
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// No need for the duplicate import of updateDoc and db here as it's handled by updateVideoMetadataFirestore from lib
