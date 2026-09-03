// KIS 해외주식 거래소 코드 매핑
//
// KIS는 API 계열마다 거래소 코드 체계가 다르다.
//   - 잔고/주문 계열 (OVRS_EXCG_CD): NASD / NYSE / AMEX   ← 잔고 output1[].ovrs_excg_cd 로 내려옴
//   - 시세 계열     (EXCD)        : NAS  / NYS  / AMS    ← 현재가(HHDFS00000300)·일봉(HHDFS76240000)
// 잔고에서 받은 코드를 그대로 시세 API에 넘기면 NYSE/AMEX 종목 조회가 깨지므로 반드시 변환한다.

export type PriceExchangeCode = "NAS" | "NYS" | "AMS";

/** 잔고/주문 계열 거래소 코드(또는 이미 시세 코드)를 시세 API용 EXCD로 변환. 모르는 값은 NAS. */
export function toPriceExchangeCode(ovrsExcgCd: string): PriceExchangeCode {
  switch ((ovrsExcgCd || "").trim().toUpperCase()) {
    case "NYSE":
    case "NYS":
      return "NYS";
    case "AMEX":
    case "AMS":
      return "AMS";
    case "NASD":
    case "NAS":
    default:
      return "NAS";
  }
}

/** 화면 표시용 거래소 이름 */
export function exchangeLabel(ovrsExcgCd: string): string {
  switch (toPriceExchangeCode(ovrsExcgCd)) {
    case "NYS":
      return "뉴욕";
    case "AMS":
      return "아멕스";
    default:
      return "나스닥";
  }
}
