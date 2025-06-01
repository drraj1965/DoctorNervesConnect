
"use client";

import { useEffect, useState } from 'react';
import DashboardStatsCard from './DashboardStatsCard';
import RecentActivityFeed from './RecentActivityFeed';
import { Video, Users, FileText, MessageSquare } from 'lucide-react';
import { getVideosCount } from '@/lib/firebase/firestore';
import { Button } from '@/components/ui/button';
import Link from 'next/link';

export default function AdminDashboardClient() {
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
    // Consider real-time updates if needed
  }, []);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <DashboardStatsCard 
          title="Available Videos" 
          value={videoCount} 
          icon={Video} 
          isLoading={loadingVideoCount}
          description="Total videos in the library"
        />
        {/* Placeholder cards for other stats */}
        <DashboardStatsCard title="Total Patients" value="..." icon={Users} description="Registered patients" />
        <DashboardStatsCard title="Articles Published" value="..." icon={FileText} description="Medical articles available" />
        <DashboardStatsCard title="Pending Questions" value="..." icon={MessageSquare} description="Questions needing answers" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <RecentActivityFeed />
        </div>
        <div className="lg:col-span-1 space-y-4">
           <Card className="shadow-lg rounded-lg">
            <CardHeader>
              <CardTitle className="text-lg font-semibold">Quick Actions</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col space-y-3">
              <Button asChild variant="default" className="w-full justify-start">
                <Link href="/admin/recorder"><Video className="mr-2 h-4 w-4" /> Record New Video</Link>
              </Button>
              <Button asChild variant="outline" className="w-full justify-start">
                <Link href="#"><FileText className="mr-2 h-4 w-4" /> Write New Article</Link>
              </Button>
               <Button asChild variant="outline" className="w-full justify-start">
                <Link href="#"><MessageSquare className="mr-2 h-4 w-4" /> Answer Questions</Link>
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

