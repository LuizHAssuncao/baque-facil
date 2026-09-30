import { useEffect, useRef, useState } from "react";
import { INITIAL_PLAYBACK, RenderedPlayback } from "./renderedPlayback";
import { renderRequestKey, type RenderRequest } from "./renderRhythm";

export function useRenderedPlayback(enabled: boolean, request: RenderRequest) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const controller = useRef<RenderedPlayback | null>(null);
  const [snapshot, setSnapshot] = useState(INITIAL_PLAYBACK);
  const key = renderRequestKey(request);
  const requestRef = useRef(request);
  requestRef.current = request;

  useEffect(() => {
    if (!enabled || !audioRef.current) return;
    const player = new RenderedPlayback(audioRef.current, requestRef.current.rhythm.title, setSnapshot);
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

  return { audioRef, controller, snapshot };
}
