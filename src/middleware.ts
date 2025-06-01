import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { auth } from '@/lib/firebase/config'; // Assuming this can be used server-side or an admin SDK setup
import { getDoctorProfileByUid } from '@/lib/firebase/firestore'; // For checking admin status

// This is a simplified example. For robust server-side auth with Firebase,
// you'd typically use Firebase Admin SDK to verify ID tokens.
// Client-side checks are illustrative here but not secure for route protection alone.

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const publicPaths = ['/login', '/register', '/api/auth/session']; // Add any other public paths

  // Allow public paths
  if (publicPaths.some(path => pathname.startsWith(path))) {
    return NextResponse.next();
  }

  // For client-side navigation, auth state is usually managed by AuthContext.
  // Middleware runs server-side. We need a way to check auth status.
  // One common way is checking a session cookie set upon login.
  // For this example, let's assume a cookie named 'firebaseIdToken' exists.

  const idToken = request.cookies.get('firebaseIdToken')?.value;

  if (!idToken) {
    // Redirect to login if no token and trying to access a protected route
    if (!pathname.startsWith('/login')) {
        const loginUrl = new URL('/login', request.url);
        loginUrl.searchParams.set('redirectedFrom', pathname);
        return NextResponse.redirect(loginUrl);
    }
    return NextResponse.next();
  }
  
  // If there's a token, attempt to verify it (simplified for now)
  // In a real app, you'd use Firebase Admin SDK here.
  // For now, we'll assume the presence of a token means "logged in".
  // The critical part is admin check for admin routes.

  if (pathname.startsWith('/admin')) {
    // This is where you'd robustly verify the token and check admin role.
    // For this example, we'll assume the client-side AuthContext handles UI,
    // and server-side, you'd verify token claims or check Firestore.
    // This check is simplified: if a token exists, and it's an admin path,
    // we're letting it pass for now, expecting client-side checks or page-level server-side checks.
    // A proper implementation would involve:
    // 1. Verifying `idToken` with Firebase Admin SDK.
    // 2. Extracting UID from the verified token.
    // 3. Checking if UID exists in the 'doctors' collection.
    // try {
    //   const decodedToken = await admin.auth().verifyIdToken(idToken);
    //   const isAdmin = await checkUserIsAdmin(decodedToken.uid); // You'd need a server-side checkUserIsAdmin
    //   if (!isAdmin) {
    //     return NextResponse.redirect(new URL('/dashboard', request.url)); // Or an unauthorized page
    //   }
    // } catch (error) {
    //   // Token verification failed
    //   const loginUrl = new URL('/login', request.url);
    //   loginUrl.searchParams.set('redirectedFrom', pathname);
    //   return NextResponse.redirect(loginUrl);
    // }
  }
  
  // If trying to access login/register while already "authenticated" (token exists)
  if ((pathname.startsWith('/login') || pathname.startsWith('/register')) && idToken) {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!api|_next/static|_next/image|favicon.ico).*)',
  ],
};
