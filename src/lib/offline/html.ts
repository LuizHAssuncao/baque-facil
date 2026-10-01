// Cloudflare Pages adds this analytics block after the build. Only remove that
// known addition, then require the HTML to match the build's original SHA-256.
// This keeps deployment/version checks intact without disabling host analytics.
const pagesAnalytics = /<!-- Cloudflare Pages Analytics --><script\b[^>]*\bsrc=(['"])https:\/\/static\.cloudflareinsights\.com\/beacon\.min\.js\1[^>]*><\/script><!-- Cloudflare Pages Analytics -->/g;

async function integrityOf(bytes: Uint8Array<ArrayBuffer>) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return `sha256-${btoa(String.fromCharCode(...digest))}`;
}

export async function verifyOfflineHtml(response: Response, integrity: string): Promise<Response> {
  if (response.status !== 200 || !/^text\/html(?:;|$)/i.test(response.headers.get("content-type") ?? "")) {
    throw new Error("Offline HTML unavailable");
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  let verified = bytes;
  if (await integrityOf(bytes) !== integrity) {
    const html = new TextDecoder().decode(bytes);
    const original = html.replace(pagesAnalytics, "");
    if (original === html) throw new Error("Offline HTML integrity mismatch");
    verified = new TextEncoder().encode(original);
    if (await integrityOf(verified) !== integrity) throw new Error("Offline HTML integrity mismatch");
  }

  const headers = new Headers(response.headers);
  // Fetch already decoded compression, and the analytics block may be removed.
  for (const name of ["content-encoding", "content-length", "etag", "content-md5", "digest"]) headers.delete(name);
  return new Response(verified, { status: response.status, statusText: response.statusText, headers });
}
