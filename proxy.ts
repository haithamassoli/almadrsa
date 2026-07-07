import { NextResponse, type NextRequest } from "next/server";

// UX-only gate: bounce unauthenticated staff to /login. Real enforcement is
// server-side in every Convex function (role + ownership checks).
export function proxy(request: NextRequest) {
  const hasSession = request.cookies
    .getAll()
    .some((cookie) => cookie.name.includes("session_token"));
  if (!hasSession) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirect", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/teacher/:path*"],
};
