import { mkdir, writeFile } from "node:fs/promises";

// Original synthesized short whistle, with no third-party recording or license.
// Regenerate from the repository root: node scripts/generate-whistle-sample.mjs
const sampleRate = 44_100;
const duration = 0.095;
const frames = Math.round(sampleRate * duration);
const wav = Buffer.alloc(44 + frames * 2);
wav.write("RIFF", 0);
wav.writeUInt32LE(wav.length - 8, 4);
wav.write("WAVEfmt ", 8);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(sampleRate, 24);
wav.writeUInt32LE(sampleRate * 2, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write("data", 36);
wav.writeUInt32LE(frames * 2, 40);

for (let frame = 0; frame < frames; frame += 1) {
  const time = frame / sampleRate;
  const attack = Math.min(1, time / 0.006);
  const release = Math.min(1, (frames - 1 - frame) / sampleRate / 0.025);
  const envelope = Math.sin(attack * Math.PI / 2) ** 2 * release ** 2;
  const flutter = 1 + 0.08 * Math.sin(2 * Math.PI * 42 * time);
  const tone =
    0.22 * Math.sin(2 * Math.PI * 2930 * time) +
    0.09 * Math.sin(2 * Math.PI * 3370 * time) +
    0.02 * Math.sin(2 * Math.PI * 5860 * time);
  wav.writeInt16LE(Math.round(tone * envelope * flutter * 32767), 44 + frame * 2);
}

const directory = new URL("../public/samples/whistle/", import.meta.url);
await mkdir(directory, { recursive: true });
await writeFile(new URL("short.wav", directory), wav);
