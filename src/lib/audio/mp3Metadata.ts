import { TranslatableError } from "../i18n/messages";
/**
 * Add LAME gapless metadata to Mediabunny's Xing frame. The bundled LAME 3.100
 * encoder has a 576-sample delay; its wrapper disables LAME's own VBR tag.
 * Native decoders can then trim padding and expose the original PCM timeline.
 */
export function addGaplessMetadata(
  buffer: ArrayBuffer,
  inputFrames: number,
): ArrayBuffer {
  const original = new Uint8Array(buffer);
  const originalView = new DataView(buffer);
  // Our fixed output is MPEG-1 Layer III at 44.1 kHz, stereo, with a Xing header.
  const xing = 36;
  if (
    original[0] !== 0xff ||
    (original[1] & 0xfe) !== 0xfa ||
    original[2] !== 0x30 ||
    String.fromCharCode(...original.subarray(xing, xing + 4)) !== "Xing"
  ) {
    throw new TranslatableError("The MP3 encoder returned an unsupported audio header.");
  }
  const flags = originalView.getUint32(xing + 4);
  if (flags !== 7)
    throw new TranslatableError("The MP3 encoder returned unexpected timing metadata.");
  // Mediabunny reserves a 156-byte (48 kbps) Xing frame. The LAME extension
  // needs more room: grow just this header to a 417-byte (128 kbps) frame so
  // the tag never overwrites the first real audio frame.
  const oldHeaderSize = 156;
  const headerSize = 417;
  const extraBytes = headerSize - oldHeaderSize;
  const result = new ArrayBuffer(buffer.byteLength + extraBytes);
  const bytes = new Uint8Array(result);
  const view = new DataView(result);
  bytes.set(original.subarray(0, oldHeaderSize));
  bytes.set(original.subarray(oldHeaderSize), headerSize);
  bytes[1] |= 1; // No MPEG CRC is stored in this metadata frame.
  bytes[2] = 0x90; // MPEG-1 Layer III, 128 kbps, 44.1 kHz, no frame padding.
  // This encoder is constant-bitrate. Mark it as Info so native players seek
  // by bitrate instead of Xing's coarse, 8-bit table of byte offsets. With a
  // Xing marker, currentTime can match a seek while the audio is seconds off.
  bytes.set(new TextEncoder().encode("Info"), xing);
  view.setUint32(xing + 12, result.byteLength);
  for (let index = 0; index < 100; index += 1) {
    const oldOffset = (original[xing + 16 + index] / 256) * buffer.byteLength;
    bytes[xing + 16 + index] = Math.min(
      255,
      Math.floor(((oldOffset + extraBytes) / result.byteLength) * 256),
    );
  }
  // The generated muxer count includes the non-audio Xing frame.
  const frameCount = view.getUint32(xing + 8) - 1;
  const delay = 576;
  const padding = frameCount * 1152 - inputFrames - delay;
  if (padding < 0 || padding > 4095)
    throw new TranslatableError("The recording's MP3 timing could not be verified.");
  view.setUint32(xing + 8, frameCount);
  // Add the optional quality field, followed by the 36-byte LAME extension.
  view.setUint32(xing + 4, flags | 8);
  const tag = xing + 120;
  bytes.set(new TextEncoder().encode("LAME3.100"), tag);
  bytes[tag + 9] = 1; // Tag revision 0, constant-bitrate encoding.
  bytes[tag + 20] = 128;
  bytes[tag + 21] = delay >> 4;
  bytes[tag + 22] = ((delay & 15) << 4) | (padding >> 8);
  bytes[tag + 23] = padding & 255;
  view.setUint32(tag + 28, result.byteLength);
  // LAME tag CRC-16 (polynomial 0x8005, reflected), including the MPEG header.
  let crc = 0;
  for (let index = 0; index < tag + 34; index += 1) {
    crc ^= bytes[index];
    for (let bit = 0; bit < 8; bit += 1)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xa001 : 0);
  }
  view.setUint16(tag + 34, crc);
  return result;
}
