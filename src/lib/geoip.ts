// IP → 지역/통신사 조회. 무료 호스팅 API를 서버에서 호출. 댓글 작성 시 1회만 호출.
// 실패/타임아웃 시 graceful 하게 null 반환.
//
// 구(區) 단위까지 표시하기 위해 1순위 ip-api.com 사용(무료, HTTP).
// 폴백: geojs.io(HTTPS, 구 단위) → ipinfo.io(도시 단위).

function isPrivateIp(raw: string): boolean {
  const ip = raw.startsWith("::ffff:") ? raw.slice(7) : raw;
  if (ip === "::1" || ip === "127.0.0.1") return true;
  if (/^10\./.test(ip)) return true;
  if (/^192\.168\./.test(ip)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;
  if (/^169\.254\./.test(ip)) return true;
  if (/^(fe80|fc|fd)/i.test(ip)) return true;
  return false;
}

export interface GeoInfo {
  geo: string | null;
  isp: string | null;
}

async function fetchJson(url: string, timeoutMs = 2500): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, cache: "no-store" });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function pick(obj: unknown, key: string): string | null {
  if (obj && typeof obj === "object" && key in obj) {
    const v = (obj as Record<string, unknown>)[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

// 구 + 시를 "Yeongdeungpo-gu, Seoul" 형태로 결합(중복/빈값 처리)
function joinPlace(district: string | null, region: string | null): string | null {
  const parts: string[] = [];
  if (district) parts.push(district);
  if (region && region !== district) parts.push(region);
  return parts.length ? parts.join(", ") : null;
}

// ipinfo org "AS4766 Korea Telecom" → "Korea Telecom"
function cleanOrg(org: string | null): string | null {
  if (!org) return null;
  return org.replace(/^AS\d+\s+/i, "").trim() || null;
}

export async function lookup(ip: string | null | undefined): Promise<GeoInfo> {
  const empty: GeoInfo = { geo: null, isp: null };
  if (!ip || isPrivateIp(ip)) return empty;

  // 1순위: ip-api.com (구 단위 city + regionName). 무료는 HTTP.
  const a = await fetchJson(
    `http://ip-api.com/json/${encodeURIComponent(
      ip
    )}?fields=status,city,regionName,country,isp,org`
  );
  if (a && pick(a, "status") === "success") {
    const geo =
      joinPlace(pick(a, "city"), pick(a, "regionName")) || pick(a, "country");
    const isp = pick(a, "isp") || pick(a, "org");
    if (geo || isp) return { geo, isp };
  }

  // 폴백: geojs.io (HTTPS, 구 단위)
  const b = await fetchJson(
    `https://get.geojs.io/v1/ip/geo/${encodeURIComponent(ip)}.json`
  );
  if (b) {
    const geo =
      joinPlace(pick(b, "city"), pick(b, "region")) || pick(b, "country");
    const isp = pick(b, "organization_name");
    if (geo || isp) return { geo, isp };
  }

  // 폴백: ipinfo.io (도시 단위)
  const token = process.env.IPINFO_TOKEN;
  const c = await fetchJson(
    `https://ipinfo.io/${encodeURIComponent(ip)}/json${
      token ? `?token=${token}` : ""
    }`
  );
  if (c && !pick(c, "error")) {
    const geo = joinPlace(pick(c, "city"), pick(c, "region")) || pick(c, "country");
    const isp = cleanOrg(pick(c, "org"));
    if (geo || isp) return { geo, isp };
  }

  return empty;
}
