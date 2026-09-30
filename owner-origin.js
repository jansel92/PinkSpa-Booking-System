// Only configured origins are trusted; request host/proxy headers never add trust.
function createOwnerOriginValidator({ production, baseUrl, port }) {
  const allowedOrigins = new Set();
  if (production) {
    try {
      const url = new URL(baseUrl);
      if (url.protocol === "https:" && !url.username && !url.password &&
          url.pathname === "/" && !url.search && !url.hash &&
          url.origin === baseUrl.replace(/\/+$/, "")) {
        allowedOrigins.add(url.origin);
      }
    } catch {
      // Missing/invalid production configuration fails closed for Owner writes.
    }
  } else if (/^\d+$/.test(String(port)) && Number(port) > 0 && Number(port) <= 65535) {
    for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
      allowedOrigins.add(new URL(`http://${host}:${port}`).origin);
    }
  }

  function singleHeader(req, name) {
    let count = 0;
    for (let i = 0; i < (req.rawHeaders || []).length; i += 2) {
      if (req.rawHeaders[i].toLowerCase() === name) count++;
    }
    const value = req.headers?.[name];
    return count <= 1 && typeof value === "string" ? value : null;
  }

  return function validateOwnerOrigin(req, res) {
    let accepted = false;
    if (req.headers?.origin !== undefined) {
      // Exact matching also rejects null, lists, paths and malformed origins.
      accepted = allowedOrigins.has(singleHeader(req, "origin"));
    } else {
      const referer = singleHeader(req, "referer");
      if (referer && /^https?:\/\//.test(referer) && !/[\s\\]/.test(referer)) {
        try {
          const url = new URL(referer);
          accepted = !url.username && !url.password && allowedOrigins.has(url.origin);
        } catch {
          // A malformed Referer is not an acceptable fallback.
        }
      }
    }
    if (!accepted) res.status(403).json({ error: "Forbidden" });
    return accepted;
  };
}

module.exports = { createOwnerOriginValidator };
