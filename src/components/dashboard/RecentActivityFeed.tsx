
"use client";

import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { getRecentVideos } from "@/lib/firebase/firestore";
import type { VideoMeta } from "@/types";
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import { Skeleton } from '@/components/ui/skeleton';
import { VideoIcon } from 'lucide-react';

export default function RecentActivityFeed() {
  const [recentVideos, setRecentVideos] = useState<VideoMeta[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchRecentVideos = async () => {
      setLoading(true);
      try {
        // Fetch videos uploaded in the last 7 days, limit to 5
        const videos = await getRecentVideos(7, 5); 
        setRecentVideos(videos);
      } catch (error) {
        console.error("Failed to fetch recent videos:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchRecentVideos();
    // For real-time updates, you could use onSnapshot here if desired
    // This would require modifying getRecentVideos to return an unsubscribe function
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent Activity</CardTitle>
        <CardDescription>Latest videos uploaded in the last 7 days.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading && (
          <>
            {[...Array(3)].map((_, i) => (
              <div key={i} className="flex items-center space-x-3">
                <Skeleton className="h-10 w-10 rounded-full" />
                <div className="space-y-1">
                  <Skeleton className="h-4 w-[200px]" />
                  <Skeleton className="h-3 w-[150px]" />
                </div>
              </div>
            ))}
          </>
        )}
        {!loading && recentVideos.length === 0 && (
          <p className="text-sm text-muted-foreground">No recent video activity.</p>
        )}
        {!loading && recentVideos.map((video) => (
          <div key={video.id} className="flex items-start space-x-3 group">
            <Avatar className="h-10 w-10 rounded-md">
              <AvatarImage src={video.thumbnailUrl} alt={video.title} data-ai-hint="video thumbnail" />
              <AvatarFallback className="bg-primary text-primary-foreground">
                <VideoIcon size={20} />
              </AvatarFallback>
            </Avatar>
            <div className="flex-1">
              <Link href={video.permalink || `/videos/${video.id}`} className="font-medium text-sm hover:underline group-hover:text-primary transition-colors">
                {video.title}
              </Link>
              <p className="text-xs text-muted-foreground">
                Uploaded by {video.doctorName} • {formatDistanceToNow(new Date(video.createdAt), { addSuffix: true })}
              </p>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
