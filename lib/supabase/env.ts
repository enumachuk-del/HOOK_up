export function hasSupabaseConfig(): boolean {
  if (!(
    process.env.NEXT_PUBLIC_SUPABASE_URL
    && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    && process.env.NEXT_PUBLIC_APP_URL
  )) return false;

  try {
    getSupabaseConfig();
    getAppUrl();
    return true;
  } catch {
    return false;
  }
}

export function getSupabaseConfig(): { url: string; key: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error("Supabase URL and publishable key are required.");
  }

  const parsedUrl = new URL(url);
  if (
    !["http:", "https:"].includes(parsedUrl.protocol)
    || parsedUrl.username
    || parsedUrl.password
    || parsedUrl.pathname !== "/"
    || parsedUrl.search
    || parsedUrl.hash
  ) {
    throw new Error("The Supabase URL must be an HTTP or HTTPS origin.");
  }

  return { url: parsedUrl.origin, key };
}

export function getAppUrl(): string {
  const configuredUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!configuredUrl) {
    throw new Error("NEXT_PUBLIC_APP_URL is required for authentication redirects.");
  }

  const url = new URL(configuredUrl);
  if (
    !["http:", "https:"].includes(url.protocol)
    || url.username
    || url.password
    || url.pathname !== "/"
    || url.search
    || url.hash
    || (process.env.NODE_ENV === "production" && url.protocol !== "https:")
  ) {
    throw new Error("NEXT_PUBLIC_APP_URL must be an application origin.");
  }
  return url.origin;
}
