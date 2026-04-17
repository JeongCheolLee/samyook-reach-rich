import { members } from "@/lib/mock-data";
import { getOverseasBalance, getOverseasDailyPrice, getDeposit, getKRWDeposit } from "@/lib/kis";
import { getMembers } from "@/lib/members";
import { DestinationProgress } from "@/components/destination-progress";
import { StockChart } from "@/components/stock-chart";

export const dynamic = "force-dynamic";

function formatKRW(amount: number) {
  return new Intl.NumberFormat("ko-KR").format(amount) + "원";
}

function formatUSD(amount: number) {
  return (
    "$" +
    new Intl.NumberFormat("en-US", { minimumFractionDigits: 2 }).format(amount)
  );
}

function getStockComment(returnRate: number): string {
  if (returnRate >= 50) return "MAKE 삼육 GREAT AGAIN!!! 유럽 간다!!!";
  if (returnRate >= 30) return "트럼프 당선되면 더 오른다 일본 ㄱㄱ";
  if (returnRate >= 20) return "관세 더 때려라!! 제주도 보인다";
  if (returnRate >= 10) return "트루스 소셜 깔아야 하나? 해외 가자";
  if (returnRate >= 5) return "슬슬 가평 펜션 알아볼까?";
  if (returnRate >= 0) return "본전은 했다... Thank you Trump...";
  if (returnRate >= -5) return "괜찮아 트럼프는 안 죽어 발산역은 간다";
  if (returnRate >= -10) return "야 트럼프 트윗 좀 해라 주가 좀 올려";
  if (returnRate >= -20) return "관세 맞은 건 우리 계좌였다";
  if (returnRate >= -30) return "트럼프 탄핵해라 진짜";
  return "삼육 해산 위기... You're fired!";
}

function formatPercent(value: number) {
  const sign = value >= 0 ? "+" : "";
  return sign + value.toFixed(2) + "%";
}

interface HoldingData {
  symbol: string;
  name: string;
  quantity: number;
  avgPrice: number;
  currentPrice: number;
  totalValue: number;
  totalCost: number;
  returnRate: number;
}

interface ChartPoint {
  date: string;
  price: number;
}

export default async function Home() {
  // 실데이터 fetch
  let holdings: HoldingData[] = [];
  let chartData: ChartPoint[] = [];
  let totalInvested = 0;
  let totalValue = 0;
  let depositUSD = 0; // 달러 잔고
  let depositKRW = 0; // 원화 잔고
  let exchangeRate = 0; // 환율
  let apiError = "";

  try {
    const [balance, depositData, krwData] = await Promise.all([
      getOverseasBalance(),
      getDeposit().catch(() => null),
      getKRWDeposit().catch(() => null),
    ]);

    const rawHoldings = balance.output1 || [];

    holdings = rawHoldings.map((h: Record<string, string>) => ({
      symbol: h.ovrs_pdno,
      name: h.ovrs_item_name,
      quantity: Number(h.ovrs_cblc_qty || 0),
      avgPrice: Number(h.pchs_avg_pric || 0),
      currentPrice: Number(h.now_pric2 || 0),
      totalValue: Number(h.ovrs_stck_evlu_amt || 0),
      totalCost: Number(h.pchs_amt || 0),
      returnRate: Number(h.evlu_pfls_rt || 0),
    }));

    totalInvested = holdings.reduce((s, h) => s + h.totalCost, 0);
    totalValue = holdings.reduce((s, h) => s + h.totalValue, 0);

    // 외화 예수금 파싱
    if (depositData?.output) {
      depositUSD = Number(depositData.output.ord_psbl_frcr_amt || 0);
      exchangeRate = Number(depositData.output.exrt || 0);
    }

    // 원화 예수금 파싱
    if (krwData?.output) {
      depositKRW = Number(krwData.output.ord_psbl_cash || krwData.output.dnca_tot_amt || 0);
    }

    // 첫 번째 종목 차트
    if (holdings.length > 0) {
      try {
        const daily = await getOverseasDailyPrice(holdings[0].symbol);
        chartData = (daily.output2 || [])
          .map((d: Record<string, string>) => ({
            date: `${d.xymd.slice(4, 6)}/${d.xymd.slice(6)}`,
            price: Number(d.clos || 0),
          }))
          .reverse();
      } catch {
        // 차트 실패해도 계속
      }
    }
  } catch (e) {
    apiError = e instanceof Error ? e.message : "Unknown error";
  }

  const memberList = getMembers();
  const memberCount = memberList.length;
  const rate = exchangeRate || 1;
  const depositUSDtoKRW = Math.round(depositUSD * rate);
  const totalValueKRW = Math.round(totalValue * rate);
  const totalAssetKRW = depositKRW + depositUSDtoKRW + totalValueKRW;
  const totalContributed = memberList.reduce((s, m) => s + m.totalContributed, 0);
  const returnRate =
    totalContributed > 0
      ? ((totalAssetKRW - totalContributed) / totalContributed) * 100
      : 0;
  const isPositive = returnRate >= 0;
  const perPersonValue =
    memberCount > 0 ? Math.round(totalAssetKRW / memberCount) : 0;

  const h = holdings[0] || null;

  return (
    <div className="flex-1 flex flex-col">
      {/* Header */}
      <header className="border-b border-card-border bg-card">
        <div className="mx-auto max-w-5xl px-6 py-4 flex items-center justify-between">
          <div className="flex flex-col">
            <span className="text-lg font-black tracking-tight leading-none">
              REACH RICH
            </span>
            <span className="text-xs text-muted leading-none mt-1">
              삼육 부자야~~~~
            </span>
          </div>
          {apiError && (
            <span className="text-xs text-negative bg-negative-bg px-3 py-1 rounded-full">
              {apiError}
            </span>
          )}
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl px-6 py-8 flex flex-col gap-6">
        {/* 여행지 프로그레스 */}
        <DestinationProgress
          perPersonValue={perPersonValue}
          memberCount={memberCount}
        />

        {/* 핵심 지표 카드 */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          <StatCard label="총 자산" value={formatKRW(totalAssetKRW)} />
          <StatCard label="총 납입금" value={formatKRW(totalContributed)} />
          <StatCard
            label="수익률"
            value={formatPercent(returnRate)}
            color={isPositive ? "positive" : "negative"}
          />
          <StatCard
            label="달러 잔고"
            value={formatUSD(depositUSD)}
          />
          <StatCard
            label="원화 잔고"
            value={formatKRW(depositKRW)}
          />
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* 보유 종목 */}
          {h ? (
            (() => {
              const positive = h.returnRate >= 0;
              return (
                <section className="rounded-xl border border-card-border bg-card p-6">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h2 className="text-2xl font-bold">{h.symbol}</h2>
                      <span className="text-sm text-muted">{h.name}</span>
                    </div>
                    <div
                      className={`text-2xl font-bold ${
                        positive ? "text-positive" : "text-negative"
                      }`}
                    >
                      {formatPercent(h.returnRate)}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4 mb-4">
                    <div>
                      <div className="text-xs text-muted mb-0.5">현재가</div>
                      <div className="font-mono font-semibold">
                        {formatUSD(h.currentPrice)}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-muted mb-0.5">
                        평균 매수가
                      </div>
                      <div className="font-mono font-semibold">
                        {formatUSD(h.avgPrice)}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-muted mb-0.5">보유 수량</div>
                      <div className="font-semibold">{h.quantity}주</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted mb-0.5">평가금</div>
                      <div
                        className={`font-mono font-semibold ${
                          positive ? "text-positive" : "text-negative"
                        }`}
                      >
                        {formatUSD(h.totalValue)}
                        <span className="text-xs text-muted ml-1">
                          ({positive ? "+" : ""}
                          {formatUSD(h.totalValue - h.totalCost)})
                        </span>
                      </div>
                    </div>
                  </div>
                  <div
                    className={`text-sm text-center py-2 px-3 rounded-lg ${
                      positive ? "bg-positive-bg" : "bg-negative-bg"
                    }`}
                  >
                    {getStockComment(h.returnRate)}
                  </div>
                </section>
              );
            })()
          ) : (
            <section className="rounded-xl border border-card-border bg-card p-6 flex items-center justify-center">
              <div className="text-center text-muted">
                <div className="text-2xl mb-2">📈</div>
                <div className="text-sm">아직 보유 종목이 없어요</div>
                <div className="text-xs mt-1">주식을 매수하면 여기에 표시됩니다</div>
              </div>
            </section>
          )}

          {/* 멤버 현황 */}
          <section className="rounded-xl border border-card-border bg-card">
            <div className="px-6 py-4 border-b border-card-border">
              <h2 className="font-semibold">멤버 ({memberList.length}명)</h2>
            </div>
            <ul className="divide-y divide-card-border">
              {memberList.map((m) => {
                const totalContributed = memberList.reduce(
                  (sum, member) => sum + member.totalContributed,
                  0
                );
                const sharePercent =
                  totalContributed > 0
                    ? (m.totalContributed / totalContributed) * 100
                    : 0;
                const myValue = Math.round(totalAssetKRW * (sharePercent / 100));
                return (
                  <li
                    key={m.name}
                    className="px-6 py-3 flex items-center justify-between"
                  >
                    <span className="text-sm">
                      <span className="mr-1.5">{m.icon}</span>
                      {m.name}
                    </span>
                    <div className="text-right">
                      <div className="text-xs text-muted font-mono">
                        납입 {formatKRW(m.totalContributed)}
                      </div>
                      <div
                        className={`text-xs font-mono font-semibold ${
                          myValue >= m.totalContributed
                            ? "text-positive"
                            : "text-negative"
                        }`}
                      >
                        평가 {formatKRW(myValue)}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>

        {/* 주가 차트 */}
        {chartData.length > 0 ? (
          <StockChart
            data={chartData}
            symbol={h?.symbol || ""}
          />
        ) : (
          <section className="rounded-xl border border-card-border bg-card p-6 text-center text-muted text-sm">
            차트 데이터가 없습니다
          </section>
        )}
      </main>
    </div>
  );
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: "positive" | "negative";
}) {
  return (
    <div className="rounded-xl border border-card-border bg-card p-4">
      <div className="text-xs text-muted mb-1">{label}</div>
      <div
        className={`text-lg font-semibold tracking-tight ${
          color === "positive"
            ? "text-positive"
            : color === "negative"
            ? "text-negative"
            : "text-foreground"
        }`}
      >
        {value}
      </div>
    </div>
  );
}
