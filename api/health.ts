export function GET() {
  return Response.json({
    ok: true,
    metaApiKeyConfigured: Boolean(process.env.META_API_KEY),
  });
}
