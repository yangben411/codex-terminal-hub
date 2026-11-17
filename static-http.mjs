export function acceptsGzip(header = "") {
  const encodings = new Map(String(header).split(",").map(part => {
    const [name, ...params] = part.trim().toLowerCase().split(";");
    const quality = params.map(p => p.trim()).find(p => p.startsWith("q="));
    return [name, quality === undefined ? 1 : Number(quality.slice(2))];
  }));
  const quality = encodings.has("gzip") ? encodings.get("gzip") : encodings.get("*");
  return Number.isFinite(quality) && quality > 0 && quality <= 1;
}

export function matchesEtag(header, etag) {
  const weak = value => value.trim().replace(/^W\//, "");
  return String(header || "").split(",").some(value => value.trim() === "*" || weak(value) === weak(etag));
}
