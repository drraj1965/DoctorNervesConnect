"use client";

import dynamic from 'next/dynamic';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';

const VideoRecorder = dynamic(() => import('@/components/video/VideoRecorder'), {
  ssr: false,
  loading: () => (
    <div className="flex flex-col items-center justify-center p-8 min-h-[400px] border rounded-lg shadow-md bg-card">
      <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
      <p className="text-muted-foreground">Loading Video Recorder...</p>
    </div>
  )
});

export default function VideoRecorderPage() {
  return (
    <div className="container mx-auto py-8">
      <Card className="max-w-3xl mx-auto shadow-xl">
        <CardHeader>
          <CardTitle className="text-2xl font-headline">Video Recorder</CardTitle>
          <CardDescription>
            Record, review, and upload your medical videos. Ensure good lighting and clear audio.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <VideoRecorder />
        </CardContent>
      </Card>
    </div>
  );
}
