import { NextRequest, NextResponse } from "next/server";

const RELEASES_API_URL = "https://api.github.com/repos/MarceloSantosCorrea/dev-http/releases";
const RELEASES_FALLBACK_URL = "https://github.com/MarceloSantosCorrea/dev-http/releases";

function detectPlatformExtension(userAgent: string): string | null {
  if (/Windows/i.test(userAgent)) return ".exe";
  if (/Macintosh|Mac OS X/i.test(userAgent)) return ".dmg";
  if (/Linux/i.test(userAgent)) return ".AppImage";
  return null;
}

export async function GET(request: NextRequest) {
  const userAgent = request.headers.get("user-agent") ?? "";
  const ext = detectPlatformExtension(userAgent);

  try {
    const res = await fetch(RELEASES_API_URL, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "DevHttp-Web",
      },
      next: { revalidate: 300 },
    });

    if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);

    const releases: unknown[] = await res.json();
    if (!Array.isArray(releases)) throw new Error("Unexpected payload");

    const agentReleases = releases.filter(
      (r): r is Record<string, unknown> =>
        r !== null &&
        typeof r === "object" &&
        (r as Record<string, unknown>).draft !== true &&
        (r as Record<string, unknown>).prerelease !== true &&
        typeof (r as Record<string, unknown>).tag_name === "string" &&
        ((r as Record<string, unknown>).tag_name as string).startsWith("agent-v"),
    );

    if (agentReleases.length === 0) {
      return NextResponse.redirect(RELEASES_FALLBACK_URL);
    }

    const latest = agentReleases[0];
    const assets = Array.isArray(latest.assets) ? latest.assets : [];

    if (ext) {
      const asset = assets.find(
        (a): a is Record<string, string> =>
          typeof a?.name === "string" &&
          typeof a?.browser_download_url === "string" &&
          a.name.endsWith(ext),
      );

      if (asset) {
        return NextResponse.redirect(asset.browser_download_url);
      }
    }

    const releaseUrl =
      typeof latest.html_url === "string" ? latest.html_url : RELEASES_FALLBACK_URL;
    return NextResponse.redirect(releaseUrl);
  } catch {
    return NextResponse.redirect(RELEASES_FALLBACK_URL);
  }
}
