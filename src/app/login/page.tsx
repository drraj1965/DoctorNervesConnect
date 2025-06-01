
"use client";
import { useState, FormEvent, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '@/lib/firebase/config';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import Link from 'next/link';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertCircle, Loader2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading: authLoading } = useAuth();

  useEffect(() => {
    if (!authLoading && user) {
      const redirectedFrom = searchParams.get('redirectedFrom');
      router.replace(redirectedFrom || '/dashboard');
    }
  }, [user, authLoading, router, searchParams]);


  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      // Store token in cookie for middleware (simplified)
      const token = await userCredential.user.getIdToken();
      document.cookie = `firebaseIdToken=${token}; path=/; max-age=${60 * 60 * 24 * 7}`; // 7 days
      
      // AuthProvider will handle user state update and redirection logic
      // Forcing a dashboard navigation might be redundant if AuthContext handles it.
      // router.push('/dashboard');
    } catch (err) {
      console.error("Login failed:", err);
      setError(err instanceof Error ? err.message : "An unknown error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  };
  
  if (authLoading || (!authLoading && user)) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
      </div>
    );
  }


  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-primary/10 via-background to-background p-4">
      <Card className="w-full max-w-md shadow-2xl">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-16 h-16 text-primary">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"/>
                <path d="M12 12.5c.83 0 1.5-.67 1.5-1.5V8c0-.83-.67-1.5-1.5-1.5S10.5 7.17 10.5 8v3c0 .83.67 1.5 1.5 1.5zm4.5-1.5L15 9.5v-2c0-.28.22-.5.5-.5s.5.22.5.5V8h.5c.28 0 .5.22.5.5v1.5L18 9.5c.21.21.21.54 0 .75l-1.5 1.5V14c0 .28-.22.5-.5.5s-.5-.22-.5-.5v-.5h-.5c-.28 0-.5-.22-.5-.5V11.5l-1.5-1.5c-.21-.21-.21-.54 0-.75zm-9 0l1.5-1.5V8c0-.28-.22-.5-.5-.5S7 7.72 7 8v-.5H6.5c-.28 0-.5.22-.5.5V9.5L4.5 11c-.21.21-.21-.54 0 .75l1.5 1.5V14c0 .28.22.5.5.5s.5-.22.5.5v.5h.5c.28 0 .5-.22.5.5v-1.5l1.5-1.5c.21-.21-.21-.54 0-.75z"/>
            </svg>
          </div>
          <CardTitle className="text-3xl font-headline">Welcome Back!</CardTitle>
          <CardDescription>Log in to DoctorNerves Connect</CardDescription>
        </CardHeader>
        <CardContent>
          {error && (
            <Alert variant="destructive" className="mb-4">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Login Failed</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Log In
            </Button>
          </form>
        </CardContent>
        <CardFooter className="text-center text-sm">
          <p>Don't have an account? <Link href="/register" className="text-primary hover:underline font-medium">Register here</Link></p>
        </CardFooter>
      </Card>
    </div>
  );
}
