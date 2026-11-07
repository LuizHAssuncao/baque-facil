import type { Root, RootContent } from "mdast";
import { translate } from "./i18n/messages";

// Wrap only notation at build time so lesson notes stay visible and the
// disclosure works before hydration, including with JavaScript disabled.
export function remarkRhythmTranscription() {
  return (tree: Root) => {
    tree.children = tree.children.flatMap((node): RootContent[] => {
      if (node.type !== "code" || node.lang !== "rhythm") return [node];

      const label = (["en-CA", "pt-BR"] as const).map((locale) =>
        `<span data-language="${locale}" lang="${locale}">${translate(locale, "Transcription")}</span>`,
      ).join("");

      return [
        {
          type: "html",
          value: `<details class="transcription-disclosure"><summary>${label}</summary>`,
        },
        node,
        { type: "html", value: "</details>" },
      ];
    });
  };
}
