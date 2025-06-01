
"use client";

import { useEffect, useState, Suspense } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type { VideoMeta } from '@/types';
import { getVideoById } from '@/lib/firebase/firestore';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowLeft, CalendarDays, UserCircle, Tag, Eye, Share2, MessageSquare, Edit3, Trash2, AlertTriangle, Copy } from 'lucide-react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from '@/hooks/use-toast';
import { deleteVideoAction } from './actions'; // To be created

// A simple video player component
const VideoPlayer = ({ src, type }: { src: string; type?: string }) => {
  return (
    <div className="aspect-video w-full bg-black rounded-lg overflow-hidden shadow-2xl">
      <video controls className="w-full h-full" key={src}>
        <source src={src} type={type || 'video/webm'} />
        Your browser does not support the video tag.
      </video>
    </div>
  );
};

function VideoDetailPageContent({ videoId }: { videoId: string }) {
  const [video, setVideo] = useState<VideoMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [isDeleting, setIsDeleting] = useState(false);
  const { user, isAdmin } = useAuth();
  const router = useRouter();
  const { toast } = useToast();

  useEffect(() => {
    if (videoId) {
      const fetchVideo = async () => {
        setLoading(true);
        try {
          const fetchedVideo = await getVideoById(videoId as string);
          setVideo(fetchedVideo);
        } catch (error) {
          console.error("Failed to fetch video:", error);
        } finally {
          setLoading(false);
        }
      };
      fetchVideo();
    }
  }, [videoId]);

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: video?.title,
          text: video?.description,
          url: window.location.href,
        });
        toast({ title: "Shared successfully!" });
      } catch (error) {
        console.error("Error sharing:", error);
        // Fallback to copy if share fails or is cancelled
        copyLinkToClipboard();
      }
    } else {
      copyLinkToClipboard();
    }
  };

  const copyLinkToClipboard = () => {
     navigator.clipboard.writeText(window.location.href)
      .then(() => {
        toast({ title: "Link Copied!", description: "Video link copied to clipboard." });
      })
      .catch(err => {
        console.error("Failed to copy link:", err);
        toast({ variant: "destructive", title: "Copy Failed", description: "Could not copy link to clipboard." });
      });
  }

  const handleDeleteVideo = async () => {
    if (!video || !video.storagePath || !video.thumbnailStoragePath) {
      toast({ variant: "destructive", title: "Error", description: "Video data is incomplete for deletion." });
      return;
    }
    setIsDeleting(true);
    try {
      const result = await deleteVideoAction(videoId, video.storagePath, video.thumbnailStoragePath);
      if (result.success) {
        toast({ title: "Video Deleted", description: "The video has been successfully deleted." });
        router.push('/videos'); // Redirect to videos list
      } else {
        throw new Error(result.error || "Failed to delete video.");
      }
    } catch (error) {
      console.error("Failed to delete video:", error);
      toast({ variant: "destructive", title: "Deletion Failed", description: error instanceof Error ? error.message : "An unknown error occurred." });
    } finally {
      setIsDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="container mx-auto py-8 max-w-4xl">
        <Skeleton className="h-10 w-32 mb-6" /> {/* Back button skeleton */}
        <Skeleton className="aspect-video w-full rounded-lg mb-6" />
        <Skeleton className="h-8 w-3/4 mb-2" /> {/* Title */}
        <Skeleton className="h-5 w-1/2 mb-4" /> {/* Meta info */}
        <div className="space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
        </div>
        <div className="mt-4 flex space-x-2">
          <Skeleton className="h-5 w-16" /> <Skeleton className="h-5 w-20" />
        </div>
      </div>
    );
  }

  if (!video) {
    return (
      <div className="container mx-auto py-8 text-center">
        <h1 className="text-2xl font-bold">Video not found</h1>
        <p className="text-muted-foreground">The video you are looking for does not exist or may have been removed.</p>
        <Button onClick={() => router.back()} variant="outline" className="mt-4">Go Back</Button>
      </div>
    );
  }
  
  // Admin can edit/delete if they are an admin, regardless of who uploaded.
  const canManage = isAdmin;

  return (
    <div className="container mx-auto py-8 max-w-4xl">
      <Button onClick={() => router.back()} variant="outline" size="sm" className="mb-6 gap-2">
        <ArrowLeft size={16} /> Back to Videos
      </Button>

      <VideoPlayer src={video.videoUrl} type={video.videoType} />

      <Card className="mt-6 shadow-lg">
        <CardHeader>
          <CardTitle className="text-3xl font-headline">{video.title}</CardTitle>
          <div className="flex items-center space-x-4 text-sm text-muted-foreground mt-2">
            <div className="flex items-center gap-1.5">
              <UserCircle size={16} />
              <span>{video.doctorName}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <CalendarDays size={16} />
              <span>{new Date(video.createdAt).toLocaleDateString()}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Eye size={16} />
              <span>{video.viewCount || 0} views</span>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-foreground/80 leading-relaxed whitespace-pre-wrap">{video.description}</p>
          
          {video.tags && video.tags.length > 0 && (
            <div className="mt-4">
              <h3 className="text-sm font-semibold mb-1.5 flex items-center gap-1.5"><Tag size={16} />Tags:</h3>
              <div className="flex flex-wrap gap-2">
                {video.tags.map(tag => <Badge key={tag} variant="secondary">{tag}</Badge>)}
              </div>
            </div>
          )}

          <div className="mt-6 flex flex-wrap gap-2 items-center justify-between">
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="gap-1.5" onClick={handleShare}><Share2 size={16}/> Share</Button>
              <Button variant="outline" size="sm" className="gap-1.5"><MessageSquare size={16}/> Comment</Button>
            </div>
            {canManage && (
              <div className="flex gap-2">
                <Button asChild variant="outline" size="sm" className="gap-1.5 text-blue-600 border-blue-600 hover:bg-blue-50 hover:text-blue-700 dark:text-blue-400 dark:border-blue-400 dark:hover:bg-blue-900/30 dark:hover:text-blue-300">
                  <Link href={`/admin/videos/edit/${video.id}`}><Edit3 size={16}/> Edit</Link>
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" size="sm" className="gap-1.5">
                      <Trash2 size={16}/> Delete
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle className="flex items-center gap-2"><AlertTriangle className="text-destructive"/>Are you absolutely sure?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This action cannot be undone. This will permanently delete the video
                        "{video.title}" and all associated data from the servers.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={handleDeleteVideo} disabled={isDeleting} className="bg-destructive hover:bg-destructive/90">
                        {isDeleting ? "Deleting..." : "Yes, delete video"}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Placeholder for Comments Section */}
      <Card className="mt-8">
        <CardHeader>
          <CardTitle>Comments</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">Comments section coming soon.</p>
        </CardContent>
      </Card>
    </div>
  );
}


export default function VideoPage() {
  const params = useParams();
  const videoId = params.id as string;

  return (
    <Suspense fallback={<div className="container mx-auto py-8 max-w-4xl"><Skeleton className="h-96 w-full" /></div>}>
      {videoId ? <VideoDetailPageContent videoId={videoId} /> : <p>Loading video...</p>}
    </Suspense>
  )
}
