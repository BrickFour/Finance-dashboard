// Vercel serverless function: every /api/* request is routed here (see vercel.json)
// and handled by the same Express app the Docker build runs.
export default async function handler(req, res) {
  let app;
  try {
    const { getApp } = await import('../server/dist/serverless.js');
    app = await getApp();
  } catch (err) {
    console.error('API failed to start:', err);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        error: {
          code: 'STARTUP_FAILED',
          message: `The API could not start: ${err instanceof Error ? err.message : String(err)}`,
        },
      }),
    );
    return;
  }
  return app(req, res);
}
