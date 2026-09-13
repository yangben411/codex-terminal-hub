const maxClipboardBytes = 1024 * 1024;

// OSC 52 carries a selection name and base64 UTF-8 text. Clipboard queries
// ("?") are deliberately ignored: the bridge only writes copied text.
export function decodeClipboardOsc(data) {
  const separator = data.indexOf(";");
  if (separator < 0) return null;
  const selection = data.slice(0, separator);
  const encoded = data.slice(separator + 1);
  if (!/^[cps0-7]*$/.test(selection) || !encoded || encoded === "?") return null;
  if (encoded.length > Math.ceil(maxClipboardBytes / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) return null;
  const decoded = Buffer.from(encoded, "base64");
  if (!decoded.length || decoded.length > maxClipboardBytes) return null;
  if (decoded.toString("base64").replace(/=+$/, "") !== encoded.replace(/=+$/, "")) return null;
  return decoded.toString("utf8");
}
