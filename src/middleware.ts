import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "./auth.config";

const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isPublic =
    pathname === "/" ||
    pathname === "/login" ||
    pathname === "/register" ||
    pathname.startsWith("/api/auth") ||
    pathname === "/api/register";
  if (isPublic || req.auth?.user) return NextResponse.next();
  // Route API dijawab JSON 401, halaman di-redirect ke /login.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Silakan login dulu." } },
      { status: 401 },
    );
  }
  const url = new URL("/login", req.nextUrl.origin);
  return NextResponse.redirect(url);
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.png|logo.png).*)"],
};
