// User-Agent 문자열을 사람이 읽기 쉬운 "OS · 브라우저" 라벨로 변환.
// 의존성 없이 정규식만 사용. 정확한 기기 모델까진 안 나오고(브라우저가 가림)
// 대략적인 환경 추정용.

export function parseUserAgent(ua: string | null | undefined): string | null {
  if (!ua) return null;

  const os = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
    ? "iPad"
    : /Android/.test(ua)
    ? "Android"
    : /Macintosh|Mac OS X/.test(ua)
    ? "Mac"
    : /Windows/.test(ua)
    ? "Windows"
    : /Linux/.test(ua)
    ? "Linux"
    : null;

  // 순서 중요: 인앱/특수 브라우저 → Edge/Samsung → Chrome → Safari
  // (Chrome UA에도 "Safari"가 들어가므로 Chrome을 먼저 검사)
  const browser = /KAKAOTALK/i.test(ua)
    ? "카카오톡"
    : /Instagram/i.test(ua)
    ? "인스타그램"
    : /FBAN|FBAV/i.test(ua)
    ? "페이스북"
    : /Line\//i.test(ua)
    ? "라인"
    : /NAVER|Whale/i.test(ua)
    ? "웨일"
    : /SamsungBrowser/i.test(ua)
    ? "삼성인터넷"
    : /Edg\//i.test(ua)
    ? "Edge"
    : /OPR\/|Opera/i.test(ua)
    ? "Opera"
    : /Firefox|FxiOS/i.test(ua)
    ? "Firefox"
    : /CriOS|Chrome/.test(ua)
    ? "Chrome"
    : /Safari/.test(ua)
    ? "Safari"
    : null;

  const parts = [os, browser].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}
