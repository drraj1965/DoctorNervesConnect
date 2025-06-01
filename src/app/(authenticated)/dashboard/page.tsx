
"use client";

import { useAuth } from '@/context/AuthContext';
import AdminDashboardClient from '@/components/dashboard/AdminDashboardClient';
import UserDashboardClient from '@/components/dashboard/UserDashboardClient'; // To be created
import { Loader2 } from 'lucide-react';

export default function DashboardPage() {
  const { isAdmin, loading, user } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-10rem)]">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    // This should ideally be handled by layout/middleware, but as a safeguard
    return <p>Redirecting to login...</p>; 
  }
  
  return isAdmin ? <AdminDashboardClient /> : <UserDashboardClient />;
}
