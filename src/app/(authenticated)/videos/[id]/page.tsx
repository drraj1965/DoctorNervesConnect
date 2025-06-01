
"use client";

import { useEffect, useState, Suspense, useRef, FormEvent } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type { VideoMeta, VideoComment } from '@/types';
import { getVideoById } from '@/lib/firebase/firestore';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowLeft, CalendarDays, UserCircle, Tag, Eye, Share2, MessageSquare, Edit3, Trash2, AlertTriangle, Copy, Mic, Send } from 'lucide-react';
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
import { deleteVideoAction, addCommentAction } from './actions'; 
import { formatDistanceToNow } from 'date-fns';

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

  // Comment states
  const [newCommentText, setNewCommentText] = useState('');
  const [isPostingComment, setIsPostingComment] = useState(false);

  // Speech recognition states
  const [isListening, setIsListening] = useState(false);
  const speechRecognitionRef = useRef<SpeechRecognition | null>(null);


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
  
  // Initialize SpeechRecognition
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const SpeechRecognitionAPI = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognitionAPI) {
        const recognition = new SpeechRecognitionAPI();
        recognition.continuous = false;
        recognition.interimResults = false;
        recognition.lang = 'en-US';

        recognition.onresult = (event: SpeechRecognitionEvent) => {
          const transcript = event.results[0][0].transcript;
          setNewCommentText(prev => prev ? prev + ' ' + transcript : transcript);
          setIsListening(false);
        };
        recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
          console.error('Speech recognition error:', event.error);
          toast({ variant: 'destructive', title: 'Speech Error', description: event.error });
          setIsListening(false);
        };
        recognition.onend = () => {
          setIsListening(false);
        };
        speechRecognitionRef.current = recognition;
      } else {
        console.warn("Speech Recognition API not supported in this browser.");
      }
    }
  }, [toast]);


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
        router.push('/videos'); 
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

  const handlePostComment = async (e: FormEvent) => {
    e.preventDefault();
    if (!user || !newCommentText.trim() || !video) {
      toast({ variant: "destructive", title: "Error", description: "Cannot post empty comment or user not logged in." });
      return;
    }
    setIsPostingComment(true);
    try {
      const result = await addCommentAction(video.id, {
        userId: user.uid,
        userName: user.displayName || user.email || "Anonymous",
        userPhotoUrl: user.photoURL || undefined,
        text: newCommentText,
      });
      if (result.success && result.commentId) {
        toast({ title: "Comment Posted" });
        setNewCommentText('');
        // Optimistically update UI or refetch video data
        // For simplicity, let's refetch (though optimistic update is better UX)
        const updatedVideo = await getVideoById(videoId);
        setVideo(updatedVideo);
      } else {
        throw new Error(result.error || "Failed to post comment.");
      }
    } catch (err) {
      console.error("Failed to post comment:", err);
      toast({ variant: "destructive", title: "Comment Failed", description: err instanceof Error ? err.message : "An unknown error occurred." });
    } finally {
      setIsPostingComment(false);
    }
  };
  
  const toggleListening = () => {
    if (!speechRecognitionRef.current) {
      toast({ variant: 'destructive', title: 'Unsupported', description: 'Speech recognition is not supported in your browser.' });
      return;
    }
    if (isListening) {
      speechRecognitionRef.current.stop();
    } else {
      speechRecognitionRef.current.start();
    }
    setIsListening(!isListening);
  };


  if (loading) {
    return (
      <div className="container mx-auto py-8 max-w-4xl">
        <Skeleton className="h-10 w-32 mb-6" />
        <Skeleton className="aspect-video w-full rounded-lg mb-6" />
        <Skeleton className="h-8 w-3/4 mb-2" /> 
        <Skeleton className="h-5 w-1/2 mb-4" /> 
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
              {/* <Button variant="outline" size="sm" className="gap-1.5"><MessageSquare size={16}/> Comment</Button> */}
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

      <Card className="mt-8">
        <CardHeader>
          <CardTitle className="text-xl flex items-center gap-2"><MessageSquare size={24}/> Comments ({video.comments?.length || 0})</CardTitle>
        </CardHeader>
        <CardContent>
          {user && (
            <form onSubmit={handlePostComment} className="mb-6 space-y-3">
              <Label htmlFor="new-comment" className="sr-only">Your comment</Label>
              <div className="relative">
                <Textarea
                  id="new-comment"
                  value={newCommentText}
                  onChange={(e) => setNewCommentText(e.target.value)}
                  placeholder="Write your comment here..."
                  rows={3}
                  className="pr-12"
                  disabled={isPostingComment}
                />
                {speechRecognitionRef.current && (
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={toggleListening}
                    className={`absolute right-2 top-1/2 -translate-y-1/2 ${isListening ? 'text-destructive animate-pulse' : 'text-muted-foreground'}`}
                    title={isListening ? "Stop listening" : "Use microphone"}
                    disabled={isPostingComment}
                >
                    <Mic size={18} />
                </Button>
                 )}
              </div>
              <Button type="submit" disabled={isPostingComment || !newCommentText.trim()} className="gap-2">
                {isPostingComment ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send size={16} />}
                Post Comment
              </Button>
            </form>
          )}
          {!user && <p className="text-muted-foreground mb-4">Please <Link href="/login" className="text-primary hover:underline">log in</Link> to post a comment.</p>}

          <div className="space-y-4">
            {video.comments && video.comments.length > 0 ? (
              video.comments.sort((a,b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).map(comment => (
                <div key={comment.id} className="flex items-start space-x-3 p-3 border rounded-lg bg-card shadow-sm">
                  <Avatar className="h-9 w-9">
                    <AvatarImage src={comment.userPhotoUrl || undefined} alt={comment.userName} />
                    <AvatarFallback>{comment.userName.charAt(0).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                        <p className="text-sm font-medium text-foreground">{comment.userName} {comment.userId === video.doctorId && <Badge variant="outline" className="ml-1 text-xs">Author</Badge>}</p>
                        <p className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(comment.createdAt), { addSuffix: true })}</p>
                    </div>
                    <p className="text-sm text-foreground/80 whitespace-pre-wrap mt-1">{comment.text}</p>
                    {/* TODO: Add reply functionality here */}
                  </div>
                </div>
              ))
            ) : (
              <p className="text-muted-foreground">No comments yet. Be the first to comment!</p>
            )}
          </div>
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
