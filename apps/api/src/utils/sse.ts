type SseEvent = {
  event: string;
  data: unknown;
};

export function sseInit(res: any) {
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  // Nginx: disable buffering
  res.setHeader("X-Accel-Buffering", "no");

  // Some proxies require initial data
  res.write(`:ok\n\n`);
}

export function sseSend(res: any, evt: SseEvent) {
  res.write(`event: ${evt.event}\n`);
  res.write(`data: ${JSON.stringify(evt.data)}\n\n`);
}

export function sseDone(res: any) {
  res.write(`event: done\n`);
  res.write(`data: {}\n\n`);
  res.end();
}
