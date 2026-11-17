import { setTimeout as delay } from "node:timers/promises";

// Keep Enter separate from the paste/text event. Do not retry either write:
// missing acknowledgements do not imply the application missed the command.
export async function submitComposer(write, data, pause = delay) {
  if (typeof data !== "string") throw new Error("Composer input must be text");
  // Existing clients already append one CR. Consume it, never send two.
  const text = data.endsWith("\r") ? data.slice(0, -1) : data;
  if (text) write(text);
  await pause(100);
  write("\r");
}
