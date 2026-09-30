import { useEffect, useRef, useState } from "react";
import type { SampleMap } from "../sampleMap";
import { INITIAL_RADIO, RadioPlayback } from "./playback";
import type { RadioEntry } from "./timeline";

export function useRadioPlayback(entries: RadioEntry[], samples: SampleMap) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const controller = useRef<RadioPlayback | null>(null);
  const [snapshot, setSnapshot] = useState(INITIAL_RADIO);
  useEffect(() => {
    if (!audioRef.current) return;
    const player = new RadioPlayback(
      audioRef.current,
      entries,
      samples,
      setSnapshot,
    );
    controller.current = player;
    return () => {
      player.dispose();
      controller.current = null;
    };
  }, [entries, samples]);
  return { audioRef, controller, snapshot };
}
