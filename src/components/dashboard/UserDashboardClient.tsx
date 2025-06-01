
"use client";

import { useEffect, useState } from 'react';
import DashboardStatsCard from './DashboardStatsCard';
import RecentActivityFeed from './RecentActivityFeed';
import { Video, FileText, Activity } from 'lucide-react';
import { getVideosCount } from '@/lib/firebase/firestore';
import { Button } from '@/components/ui/button';
import Link from 'next/link';

export default function UserDashboardClient() {
  const [videoCount, setVideoCount] = useState<number | string>("...");
  const [loadingVideoCount, setLoadingVideoCount] = useState(true);

  useEffect(() => {
    const fetchCounts = async () => {
      setLoadingVideoCount(true);
      try {
        const count = await getVideosCount();
        setVideoCount(count);
      } catch (error) {
        console.error("Failed to fetch video count:", error);
        setVideoCount("Error");
      } finally {
        setLoadingVideoCount(false);
      }
    };
    fetchCounts();
  }, []);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <DashboardStatsCard 
          title="Available Videos" 
          value={videoCount} 
          icon={Video} 
          isLoading={loadingVideoCount}
          description="Watch educational videos"
        />
        <DashboardStatsCard title="Medical Articles" value="..." icon={FileText} description="Read insightful articles" />
        <DashboardStatsCard title="My Health Data" value="..." icon={Activity} description="Track your health journey" />
      </div>
      
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <RecentActivityFeed />
        </div>
        <div className="lg:col-span-1 space-y-4">
           <Card className="shadow-lg rounded-lg">
            <CardHeader>
              <CardTitle className="text-lg font-semibold">Explore</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col space-y-3">
              <Button asChild variant="default" className="w-full justify-start">
                <Link href="/videos"><Video className="mr-2 h-4 w-4" /> Browse Videos</Link>
              </Button>
              <Button asChild variant="outline" className="w-full justify-start">
                <Link href="#"><FileText className="mr-2 h-4 w-4" /> Read Articles</Link>
              </Button>
               <Button asChild variant="outline" className="w-full justify-start">
                <Link href="#"><Activity className="mr-2 h-4 w-4" /> View My Health</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

// Dummy Card components if not imported from ui
const Card = ({ className, children }: {className?: string, children: React.ReactNode}) => <div className={`bg-card text-card-foreground border rounded-lg ${className}`}>{children}</div>;
const CardHeader = ({ className, children }: {className?: string, children: React.ReactNode}) => <div className={`p-6 ${className}`}>{children}</div>;
const CardTitle = ({ className, children }: {className?: string, children: React.ReactNode}) => <h3 className={`font-semibold text-xl ${className}`}>{children}</h3>;
const CardContent = ({ className, children }: {className?: string, children: React.ReactNode}) => <div className={`p-6 pt-0 ${className}`}>{children}</div>;
