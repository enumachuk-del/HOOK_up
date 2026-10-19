import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getAppUrl, getSupabaseConfig } from "@/lib/supabase/env";

const recoveryCookie = "splendid-hubs-password-recovery";
const legacyRecoveryCookie = "kindred-password-recovery";

function callbackErrorResponse(appUrl: string) {
  const response = NextResponse.redirect(new URL("/?auth_error=callback", appUrl));
  response.cookies.set(recoveryCookie, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  response.cookies.set(legacyRecoveryCookie, "", { path: "/", maxAge: 0 });
  return response;
}

export async function GET(request: NextRequest) {
  const appUrl = getAppUrl();
  const requestedNext = request.nextUrl.searchParams.get("next");
  const next = requestedNext === "/auth/update-password" ? requestedNext : "/";
  const code = request.nextUrl.searchParams.get("code");
  if (!code) {
    return callbackErrorResponse(appUrl);
  }

  try {
    const { url, key } = getSupabaseConfig();
    const response = NextResponse.redirect(new URL(next, appUrl));
    response.cookies.set(recoveryCookie, "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
    response.cookies.set(legacyRecoveryCookie, "", { path: "/", maxAge: 0 });
    const supabase = createServerClient(url, key, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            request.cookies.set(name, value);
            response.cookies.set(name, value, options);
          });
        },
      },
    });
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return callbackErrorResponse(appUrl);
    }

    if (request.nextUrl.searchParams.get("flow") === "recovery" && next === "/auth/update-password") {
      const { data, error: userError } = await supabase.auth.getUser();
      if (userError || !data.user) {
        return callbackErrorResponse(appUrl);
      }
      response.cookies.set(recoveryCookie, data.user.id, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 30 * 60,
      });
    }
    return response;
  } catch {
    return callbackErrorResponse(appUrl);
  }
}
