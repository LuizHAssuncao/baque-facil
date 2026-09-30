import { useEffect, useRef, useState } from "react";
import { INITIAL_PLAYBACK, RenderedPlayback } from "./renderedPlayback";
import { renderRequestKey, type RenderRequest } from "./renderRhythm";

export function useRenderedPlayback(enabled: boolean, request: RenderRequest) {
  const controller = useRef<RenderedPlayback | null>(null);
  const [snapshot, setSnapshot] = useState(INITIAL_PLAYBACK);
  const key = renderRequestKey(request);
  const requestRef = useRef(request);
  requestRef.current = request;

  useEffect(() => {
    if (!enabled) return;
    const player = new RenderedPlayback(requestRef.current.rhythm.title, setSnapshot);
    controller.current = player;
    player.update(requestRef.current);
    return () => {
      player.dispose();
      controller.current = null;
    };
  }, [enabled, request.rhythm.slug]);

  useEffect(() => {
    controller.current?.update(requestRef.current);
  }, [key]);

  return { controller, snapshot };
}
