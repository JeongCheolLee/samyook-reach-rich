// IP → 지역/통신사 로컬 조회. DB-IP Lite (.mmdb) 파일을 maxmind 리더로 읽는다.
// DB 파일은 data/geo/ 에 위치(저장소 비커밋). 파일이 없으면 graceful 하게
// { geo: null, isp: null } 을 반환해 앱이 깨지지 않게 한다.
//
// IP 위치 데이터 © DB-IP (https://db-ip.com) — CC BY 4.0

import maxmind, {
  type Reader,
  type CityResponse,
  type AsnResponse,
} from "maxmind";
import { existsSync } from "node:fs";
import path from "node:path";

const CITY_PATH = path.join(process.cwd(), "data/geo/dbip-city-lite.mmdb");
const ASN_PATH = path.join(process.cwd(), "data/geo/dbip-asn-lite.mmdb");

// undefined = 아직 안 열어봄, null = 파일 없음/실패
let cityReader: Reader<CityResponse> | null | undefined;
let asnReader: Reader<AsnResponse> | null | undefined;

async function getReaders() {
  if (cityReader === undefined) {
    try {
      cityReader = existsSync(CITY_PATH)
        ? await maxmind.open<CityResponse>(CITY_PATH)
        : null;
    } catch {
      cityReader = null;
    }
  }
  if (asnReader === undefined) {
    try {
      asnReader = existsSync(ASN_PATH)
        ? await maxmind.open<AsnResponse>(ASN_PATH)
        : null;
    } catch {
      asnReader = null;
    }
  }
  return { cityReader, asnReader };
}

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

export async function lookup(ip: string | null | undefined): Promise<GeoInfo> {
  const empty: GeoInfo = { geo: null, isp: null };
  if (!ip || isPrivateIp(ip) || !maxmind.validate(ip)) return empty;

  try {
    const { cityReader, asnReader } = await getReaders();
    const city = cityReader?.get(ip) ?? null;
    const asn = asnReader?.get(ip) ?? null;

    const geo =
      city?.city?.names?.en ??
      city?.subdivisions?.[0]?.names?.en ??
      city?.country?.names?.en ??
      null;
    const isp = asn?.autonomous_system_organization ?? null;

    return { geo, isp };
  } catch {
    return empty;
  }
}
