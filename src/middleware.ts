import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

const isPublicRoute = createRouteMatcher([
  '/api/webhooks/clerk',
  '/api/cron/(.*)',
  '/api/auth/(.*)',
  '/api/admin/(.*)',  // Admin endpoints (should add proper auth later)
  '/api/shows/search',  // TMDB search doesn't need user auth
  '/api/ok',
]);

const isApiRoute = createRouteMatcher(['/api/(.*)']);

export default clerkMiddleware(async (auth, request) => {
  if (!isPublicRoute(request)) {
    const { userId } = await auth();

    // For API routes, return 401 JSON instead of redirecting
    if (!userId && isApiRoute(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // For non-API routes, use default protect behavior (redirect)
    if (!userId) {
      await auth.protect();
    }
  }
});

export const config = {
  matcher: [
    // Skip Next.js internals and all static files
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
};
