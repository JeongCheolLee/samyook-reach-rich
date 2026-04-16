import { NextResponse } from "next/server";
import {
  getOverseasBalance,
  getOverseasPrice,
  getOverseasDailyPrice,
} from "@/lib/kis";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // 잔고 조회
    const balance = await getOverseasBalance();
    const holdings = balance.output1 || [];

    // 보유 종목이 있으면 첫 번째 종목 차트 데이터도 가져옴
    let chartData = null;
    if (holdings.length > 0) {
      const symbol = holdings[0].ovrs_pdno; // 종목코드
      try {
        const daily = await getOverseasDailyPrice(symbol);
        chartData = daily.output2 || [];
      } catch {
        // 차트 실패해도 잔고는 보여줌
      }
    }

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
      chartData: chartData
        ? chartData
            .map((d: Record<string, string>) => ({
              date: `${d.xymd.slice(4, 6)}/${d.xymd.slice(6)}`,
              price: Number(d.clos || 0),
            }))
            .reverse() // 오래된 날짜부터
        : null,
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
