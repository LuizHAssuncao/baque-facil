import { useEffect, useRef, useState } from "react";
import { errorMessage, type Message } from "../i18n/messages";
import { exportMp3, mp3ExportKey, type Mp3ExportRequest } from "./exportMp3";
import { mp3Filename, type Mp3Download } from "./downloadMp3";

type PreparedExport = Mp3Download & { key: string; tempo: number; repetitions: number };
type ExportState = {
  status: "idle" | "preparing" | "ready" | "cancelled" | "failed";
  progress: number;
  result: PreparedExport | null;
  error: Message | null;
};

export function useMp3Export() {
  const generation = useRef<AbortController | null>(null);
  const [state, setState] = useState<ExportState>({ status: "idle", progress: 0, result: null, error: null });
  useEffect(() => () => {
    generation.current?.abort();
    generation.current = null;
  }, []);

  async function prepare(request: Mp3ExportRequest) {
    if (generation.current) return;
    const controller = new AbortController();
    generation.current = controller;
    const captured = structuredClone(request);
    setState({ status: "preparing", progress: 0, result: null, error: null });
    try {
      const result = await exportMp3(captured, controller.signal, (progress) => {
        if (generation.current !== controller) return;
        const percent = Math.min(99, Math.floor(progress * 100));
        setState((previous) => previous.progress === percent ? previous : { ...previous, progress: percent });
      });
      if (generation.current !== controller || controller.signal.aborted) return;
      setState({
        status: "ready", progress: 100, error: null,
        result: {
          ...result, key: mp3ExportKey(captured), tempo: captured.tempo, repetitions: captured.repetitions,
          filename: mp3Filename(captured.rhythm.title, `${captured.tempo}bpm-${captured.repetitions}x`),
        },
      });
    } catch (cause) {
      if (generation.current !== controller || controller.signal.aborted) return;
      setState({ status: "failed", progress: 0, result: null, error: errorMessage(cause, "Unable to prepare the MP3. Please try again.") });
    } finally {
      if (generation.current === controller) generation.current = null;
    }
  }

  function cancel() {
    generation.current?.abort();
    generation.current = null;
    setState({ status: "cancelled", progress: 0, result: null, error: null });
  }

  return { ...state, prepare, cancel };
}
