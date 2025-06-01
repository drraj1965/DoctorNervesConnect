
"use client";

import React, { ReactNode, useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { SidebarProvider, Sidebar, SidebarInset, SidebarContent, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarHeader, SidebarTrigger, SidebarFooter } from '@/components/ui/sidebar';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import Link from 'next/link';
import { LayoutDashboard, Video, FileText, MessageSquare, Activity, LogOut, UserCircle, ShieldCheck, Loader2, Settings, Sun, Moon, Users, VideoIcon, UploadCloud } from 'lucide-react';

const AppLogo = () => (
  <Link href="/dashboard" className="flex items-center gap-2 font-semibold text-lg text-primary">
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-7 h-7">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"/>
      <path d="M12 12.5c.83 0 1.5-.67 1.5-1.5V8c0-.83-.67-1.5-1.5-1.5S10.5 7.17 10.5 8v3c0 .83.67 1.5 1.5 1.5zm4.5-1.5L15 9.5v-2c0-.28.22-.5.5-.5s.5.22.5.5V8h.5c.28 0 .5.22.5.5v1.5L18 9.5c.21.21.21.54 0 .75l-1.5 1.5V14c0 .28-.22-.5-.5-.5s-.5-.22-.5-.5v-.5h-.5c-.28 0-.5-.22-.5-.5V11.5l-1.5-1.5c-.21-.21-.21-.54 0-.75zm-9 0l1.5-1.5V8c0-.28-.22-.5-.5-.5S7 7.72 7 8v-.5H6.5c-.28 0-.5.22-.5.5V9.5L4.5 11c-.21.21-.21-.54 0 .75l1.5 1.5V14c0 .28.22.5.5.5s.5-.22.5.5v.5h.5c.28 0 .5-.22.5.5v-1.5l1.5-1.5c.21-.21-.21-.54 0-.75z"/>
    </svg>
    DoctorNerves Connect
  </Link>
);


const UserNav = () => {
  const { user, logout, isAdmin } = useAuth();
  const router = useRouter();

  const handleLogout = async () => {
    await logout();
    router.push('/login');
  };

  if (!user) return null;

  return (
    <div className="flex items-center gap-4">
      <span className="text-sm text-muted-foreground">
        {user.displayName || user.email} {isAdmin && "(Admin)"}
      </span>
      <Avatar className="h-9 w-9">
        <AvatarImage src={user.photoURL || undefined} alt={user.displayName || user.email || 'User'} />
        <AvatarFallback>{user.email ? user.email[0].toUpperCase() : 'U'}</AvatarFallback>
      </Avatar>
      <Button variant="ghost" size="icon" onClick={handleLogout} title="Logout">
        <LogOut className="h-5 w-5" />
      </Button>
    </div>
  );
};


const MainSidebarContent = () => {
  const { isAdmin } = useAuth();
  const pathname = usePathname();

  const commonLinks = [
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { href: "/videos", label: "Videos", icon: Video },
    // { href: "/articles", label: "Medical Articles", icon: FileText },
    // { href: "/qa", label: "Q&A", icon: MessageSquare },
  ];

  const adminLinks = [
    { href: "/admin/recorder", label: "Record Video", icon: UploadCloud },
    // { href: "/admin/article/new", label: "Write Article", icon: FileText },
    // { href: "/admin/questions", label: "Answer Questions", icon: MessageSquare },
    // { href: "/admin/users", label: "Manage Users", icon: Users },
  ];
  
  // const userLinks = [
  //   { href: "/user/health-data", label: "Health Data", icon: Activity },
  // ];

  let links = isAdmin ? [...commonLinks, ...adminLinks] : [...commonLinks/*, ...userLinks*/];
  if(isAdmin) {
    links.push({ href: "/admin/manage-content", label: "Manage Content", icon: Settings });
  }


  return (
    <>
      <SidebarHeader className="p-4">
        <AppLogo />
      </SidebarHeader>
      <SidebarContent>
        <SidebarMenu>
          {links.map((link) => (
            <SidebarMenuItem key={link.href}>
              <Link href={link.href} legacyBehavior passHref>
                <SidebarMenuButton 
                  isActive={pathname === link.href || (link.href !== "/dashboard" && pathname.startsWith(link.href))}
                  className="w-full"
                  tooltip={link.label}
                >
                  <link.icon className="mr-2 h-5 w-5" />
                  <span>{link.label}</span>
                </SidebarMenuButton>
              </Link>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarContent>
      <SidebarFooter className="p-4 mt-auto border-t border-border">
         {/* Footer content like settings, theme toggle can go here */}
      </SidebarFooter>
    </>
  );
};


export default function AppLayoutClient({ children }: { children: ReactNode }) {
  const { user, loading, isAdmin } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const [sidebarOpen, setSidebarOpen] = useState(true); // Default open state

  useEffect(() => {
    if (!loading && !user && pathname !== '/login' && pathname !== '/register') {
      router.push('/login');
    }
  }, [user, loading, router, pathname]);


  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
      </div>
    );
  }
  
  if (!user && (pathname !== '/login' && pathname !== '/register')) {
     // This case should be handled by the useEffect redirect, but as a fallback:
    return null; // Or a specific "redirecting..." message
  }
  
  // For login and register pages, don't render the main app layout
  if (pathname === '/login' || pathname === '/register') {
    return <>{children}</>;
  }


  return (
    <SidebarProvider open={sidebarOpen} onOpenChange={setSidebarOpen} defaultOpen={true}>
      <div className="flex min-h-screen">
        <Sidebar collapsible="icon" className="border-r">
          <MainSidebarContent />
        </Sidebar>
        <SidebarInset>
          <header className="sticky top-0 z-10 flex h-16 items-center justify-between border-b bg-background/80 backdrop-blur-sm px-4 md:px-6">
            <SidebarTrigger className="md:hidden" /> {/* Only show on mobile */}
            <div className="flex-1" /> {/* Spacer */}
            <UserNav />
          </header>
          <main className="flex-1 p-4 md:p-6 lg:p-8">
            {children}
          </main>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}

