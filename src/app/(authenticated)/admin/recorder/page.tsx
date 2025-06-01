
import VideoRecorder from '@/components/video/VideoRecorder';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

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
