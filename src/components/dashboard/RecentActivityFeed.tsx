
"use client";

import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { getRecentVideos } from "@/lib/firebase/firestore";
import type { VideoMeta } from "@/types";
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import { Skeleton } from '@/components/ui/skeleton';
import { VideoIcon, Star } from 'lucide-react';

export default function RecentActivityFeed() {
  const [recentVideos, setRecentVideos] = useState<VideoMeta[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchRecentVideos = async () => {
      setLoading(true);
      try {
        // Fetch featured videos uploaded, limit to 5
        // The `days` parameter for getRecentVideos is effectively ignored if featuredOnly=true,
        // as we want all featured videos sorted by recent creation.
        // Or, if we want featured AND recent, we keep the days param.
        // For "Recent Activity" showing featured items, it's typical to show *any* featured item, ordered by recency.
        // If strictly "featured in last 7 days", then: getRecentVideos(7, 5, true)
        const videos = await getRecentVideos(365, 5, true); // Show featured from last year, limit 5
        setRecentVideos(videos);
      } catch (error) {
        console.error("Failed to fetch recent videos for feed:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchRecentVideos();
  }, []);

  return (
    <Card className="shadow-lg rounded-lg">
      <CardHeader>
        <CardTitle className="text-xl font-headline">Recent Activity</CardTitle>
        <CardDescription>Featured videos recently added.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading && (
          <>
            {[...Array(3)].map((_, i) => (
              <div key={i} className="flex items-center space-x-3 p-2 rounded-md hover:bg-muted/50 transition-colors">
                <Skeleton className="h-10 w-10 rounded-md" />
                <div className="space-y-1.5 flex-1">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
            ))}
          </>
        )}
        {!loading && recentVideos.length === 0 && (
          <p className="text-sm text-muted-foreground p-2">No new featured videos at the moment.</p>
        )}
        {!loading && recentVideos.map((video) => (
          <Link href={video.permalink || `/videos/${video.id}`} key={video.id} className="flex items-start space-x-3 group p-2 rounded-md hover:bg-muted/30 dark:hover:bg-muted/10 transition-colors">
            <Avatar className="h-12 w-12 rounded-md shadow">
              <AvatarImage src={video.thumbnailUrl} alt={video.title} className="object-cover" data-ai-hint="video thumbnail" />
              <AvatarFallback className="bg-primary/10 text-primary rounded-md">
                <VideoIcon size={24} />
              </AvatarFallback>
            </Avatar>
            <div className="flex-1">
              <div className="flex justify-between items-center">
                <p className="font-medium text-sm group-hover:text-primary transition-colors line-clamp-2 leading-tight">
                  {video.title}
                </p>
                {video.featured && <Star size={14} className="text-accent fill-accent flex-shrink-0 ml-2" title="Featured" />}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                By {video.doctorName} • {video.createdAt ? formatDistanceToNow(new Date(video.createdAt), { addSuffix: true }) : 'Date unknown'}
              </p>
            </div>
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}
