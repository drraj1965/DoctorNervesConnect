
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function EditVideoPage({ params }: { params: { id: string } }) {
  const videoId = params.id;

  return (
    <div className="container mx-auto py-8">
      <Link href={`/videos/${videoId}`} passHref className="mb-6 inline-block">
        <Button variant="outline" size="sm" className="gap-2">
            <ArrowLeft size={16} /> Back to Video
        </Button>
      </Link>
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl font-headline">Edit Video: {videoId}</CardTitle>
          <CardDescription>
            This page will allow administrators to edit the metadata for the video.
            Functionality to modify title, description, tags, and other details will be available here.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">Video editing form is under development.</p>
          {/* 
            TODO: 
            1. Fetch video data using videoId.
            2. Create a form (similar to VideoRecorder metadata form) pre-filled with video data.
            3. Implement a server action to update video metadata in Firestore.
          */}
        </CardContent>
      </Card>
    </div>
  );
}
