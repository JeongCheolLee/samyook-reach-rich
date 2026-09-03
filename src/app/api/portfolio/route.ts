import { NextResponse } from "next/server";
import { getOverseasBalance, getOverseasDailyPrice } from "@/lib/kis";
import { exchangeLabel, toPriceExchangeCode } from "@/lib/exchange";

interface ChartPoint {
  date: string;
  price: number;
}

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // 잔고 조회
    const balance = await getOverseasBalance();
    const holdings = balance.output1 || [];

    // 종목별 30일 차트 (병렬). 거래소 코드는 잔고(NASD/NYSE/AMEX) → 시세(NAS/NYS/AMS)로 변환.
    const charts: Record<string, ChartPoint[]> = {};
    await Promise.all(
      holdings.map(async (h: Record<string, string>) => {
        try {
          const daily = await getOverseasDailyPrice(
            h.ovrs_pdno,
            toPriceExchangeCode(h.ovrs_excg_cd)
          );
          charts[h.ovrs_pdno] = (daily.output2 || [])
            .map((d: Record<string, string>) => ({
              date: `${d.xymd.slice(4, 6)}/${d.xymd.slice(6)}`,
              price: Number(d.clos || 0),
            }))
            .reverse(); // 오래된 날짜부터
        } catch {
          // 종목 단위 차트 실패는 건너뜀 (잔고는 보여줌)
        }
      })
    );

    // 총 평가금, 총 투자금 계산
    const totalInvested = holdings.reduce(
      (sum: number, h: Record<string, string>) =>
        sum + Number(h.pchs_amt || 0),
      0
    );
    const totalValue = holdings.reduce(
      (sum: number, h: Record<string, string>) =>
        sum + Number(h.ovrs_stck_evlu_amt || 0),
      0
    );

    return NextResponse.json({
      success: true,
      holdings: holdings.map((h: Record<string, string>) => ({
        symbol: h.ovrs_pdno,
        name: h.ovrs_item_name,
        exchange: h.ovrs_excg_cd,
        exchangeLabel: exchangeLabel(h.ovrs_excg_cd),
        quantity: Number(h.ovrs_cblc_qty || 0),
        avgPrice: Number(h.pchs_avg_pric || 0),
        currentPrice: Number(h.now_pric2 || 0),
        currency: "USD",
        totalValue: Number(h.ovrs_stck_evlu_amt || 0),
        totalCost: Number(h.pchs_amt || 0),
        returnRate: Number(h.evlu_pfls_rt || 0),
        returnAmount: Number(h.evlu_pfls_amt || 0),
      })),
      summary: {
        totalInvested,
        totalValue,
        returnRate:
          totalInvested > 0
            ? ((totalValue - totalInvested) / totalInvested) * 100
            : 0,
        returnAmount: totalValue - totalInvested,
      },
      charts, // 종목코드 → 30일 종가
      raw: balance, // 디버깅용
    });
  } catch (error) {
    console.error("Portfolio API error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
