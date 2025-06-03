
"use client";
import { useEffect, useState } from 'react';
import type { VideoMeta } from '@/types';
import { getAllVideos } from '@/lib/firebase/firestore'; // Assuming this function exists
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import Image from 'next/image';
import { PlayCircle, Share2, MessageSquare, Eye } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';

const PLACEHOLDER_IMAGE_URL = "https://placehold.co/600x400.png";

const getSafeImageUrl = (url?: string | null): string => {
  if (url && (url.startsWith('https://') || url.startsWith('http://'))) {
    try {
      new URL(url);
      return url;
    } catch (e) {
      return PLACEHOLDER_IMAGE_URL;
    }
  }
  return PLACEHOLDER_IMAGE_URL;
};


export default function VideosPage() {
  const [videos, setVideos] = useState<VideoMeta[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchVideos = async () => {
      setLoading(true);
      try {
        const fetchedVideos = await getAllVideos();
        setVideos(fetchedVideos);
      } catch (error) {
        console.error("Failed to fetch videos:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchVideos();
  }, []);

  if (loading) {
    return (
      <div className="container mx-auto py-8">
        <h1 className="text-3xl font-bold mb-8 font-headline">Available Videos</h1>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[...Array(6)].map((_, i) => (
            <Card key={i} className="overflow-hidden shadow-lg">
              <Skeleton className="w-full h-48" />
              <CardHeader>
                <Skeleton className="h-6 w-3/4 mb-2" />
                <Skeleton className="h-4 w-1/2" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-4 w-full mb-1" />
                <Skeleton className="h-4 w-5/6" />
              </CardContent>
              <CardFooter className="flex justify-between items-center">
                <Skeleton className="h-8 w-24" />
                <div className="flex space-x-2">
                  <Skeleton className="h-6 w-6 rounded-full" />
                  <Skeleton className="h-6 w-6 rounded-full" />
                </div>
              </CardFooter>
            </Card>
          ))}
        </div>
      </div>
    );
  }
  
  if(videos.length === 0) {
    return (
       <div className="container mx-auto py-8 text-center">
        <h1 className="text-3xl font-bold mb-8 font-headline">Available Videos</h1>
        <p className="text-muted-foreground text-lg">No videos available at the moment. Check back soon!</p>
      </div>
    )
  }

  return (
    <div className="container mx-auto py-8">
      <h1 className="text-3xl font-bold mb-8 font-headline">Available Videos</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {videos.map(video => (
          <Card key={video.id} className="overflow-hidden shadow-lg flex flex-col">
            <Link href={video.permalink || `/videos/${video.id}`} className="block group">
              <div className="relative w-full aspect-video">
                <Image 
                  src={getSafeImageUrl(video.thumbnailUrl)} 
                  alt={video.title} 
                  fill
                  sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                  className="object-cover group-hover:scale-105 transition-transform duration-300"
                  data-ai-hint="medical video thumbnail"
                  onError={(e) => {
                    console.warn(`Error loading image: ${video.thumbnailUrl}`);
                    (e.target as HTMLImageElement).src = PLACEHOLDER_IMAGE_URL; 
                  }}
                />
                <div className="absolute inset-0 bg-black/20 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                  <PlayCircle className="w-16 h-16 text-white" />
                </div>
              </div>
            </Link>
            <CardHeader>
              <Link href={video.permalink || `/videos/${video.id}`} className="block">
                <CardTitle className="text-xl hover:text-primary transition-colors">{video.title}</CardTitle>
              </Link>
              <p className="text-xs text-muted-foreground">By {video.doctorName} • {new Date(video.createdAt).toLocaleDateString()}</p>
            </CardHeader>
            <CardContent className="flex-grow">
              <p className="text-sm text-muted-foreground line-clamp-3">{video.description}</p>
            </CardContent>
            <CardFooter className="flex justify-between items-center mt-auto pt-4 border-t">
              <Link href={video.permalink || `/videos/${video.id}`} passHref>
                <Button variant="default" size="sm">Watch Video</Button>
              </Link>
              <div className="flex items-center space-x-3 text-muted-foreground">
                <span className="flex items-center text-xs"><Eye size={14} className="mr-1"/> {video.viewCount || 0}</span>
              </div>
            </CardFooter>
          </Card>
        ))}
      </div>
    </div>
  );
}

