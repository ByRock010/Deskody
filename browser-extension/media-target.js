/** Canonical, bounded playback target; independent of private browsing context. */
export function youtubeMusicUrl(input) {
  if (
    typeof input !== "string" ||
    input.length > 2048 ||
    /[\\\x00-\x1f]/.test(input)
  )
    throw new Error("Geçerli bir YouTube Music bağlantısı girin.");
  const source = new URL(input.trim());
  if (
    source.protocol !== "https:" ||
    source.hostname !== "music.youtube.com" ||
    source.username ||
    source.password ||
    source.port
  )
    throw new Error("Bağlantı https://music.youtube.com adresinden olmalı.");
  if (!["/watch", "/playlist"].includes(source.pathname))
    throw new Error(
      "YouTube Music şarkı, liste, radyo veya mix bağlantısı girin.",
    );
  const result = new URL(`https://music.youtube.com${source.pathname}`);
  const fields = {
    v: /^[A-Za-z0-9_-]{11}$/,
    list: /^[A-Za-z0-9_-]{2,256}$/,
    start_radio: /^1$/,
    index: /^[0-9]{1,5}$/,
    params: /^[A-Za-z0-9_=-]{1,512}$/,
  };
  for (const [key, pattern] of Object.entries(fields)) {
    const values = source.searchParams.getAll(key);
    if (values.length > 1 || (values.length && !pattern.test(values[0])))
      throw new Error(
        "YouTube Music bağlantısındaki oynatma bilgisi geçersiz.",
      );
    if (values.length) result.searchParams.set(key, values[0]);
  }
  if (source.pathname === "/watch" && !result.searchParams.has("v"))
    throw new Error("Şarkı bağlantısında video kimliği (v) olmalı.");
  if (source.pathname === "/playlist" && !result.searchParams.has("list"))
    throw new Error("Liste bağlantısında liste kimliği (list) olmalı.");
  return result.href;
}
