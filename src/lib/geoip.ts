// IP → 지역/통신사 조회. 무료 호스팅 API를 서버에서 호출한다(키 불필요, HTTPS).
// 배포 환경에서도 큰 DB 파일 없이 도시+통신사를 채울 수 있다.
// 댓글 작성 시 1회만 호출. 실패/타임아웃 시 graceful 하게 null 반환.
// 1순위 freeipapi.com, 실패 시 ipapi.co 로 폴백.

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

export async function lookup(ip: string | null | undefined): Promise<GeoInfo> {
  const empty: GeoInfo = { geo: null, isp: null };
  if (!ip || isPrivateIp(ip)) return empty;

  // 1순위: freeipapi.com (HTTPS, cityName + asnOrganization)
  const a = await fetchJson(`https://freeipapi.com/api/json/${encodeURIComponent(ip)}`);
  if (a) {
    const geo = pick(a, "cityName") || pick(a, "regionName") || pick(a, "countryName");
    const isp = pick(a, "asnOrganization");
    if (geo || isp) return { geo, isp };
  }

  // 폴백: ipapi.co (HTTPS, city + org)
  const b = await fetchJson(`https://ipapi.co/${encodeURIComponent(ip)}/json/`);
  if (b && !pick(b, "error")) {
    const geo = pick(b, "city") || pick(b, "region") || pick(b, "country_name");
    const isp = pick(b, "org");
    if (geo || isp) return { geo, isp };
  }

  return empty;
}
