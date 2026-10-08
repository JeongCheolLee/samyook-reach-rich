import { NextResponse } from "next/server";
import { archiveMember, createMember, getMembers, updateMember } from "@/lib/members";
import { requireAdmin } from "@/server/auth";
import { apiError, validId } from "@/server/api-errors";

export async function GET() {
  return NextResponse.json(await getMembers());
}

// Action-based mutations avoid replacing an entire member list from a stale tab.
export async function PUT(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  const body = await request.json().catch(() => null);
  if (!body || Array.isArray(body) || typeof body !== "object") {
    return NextResponse.json({ error: "잘못된 요청입니다" }, { status: 400 });
  }
  try {
    if (body.action === "create") {
      if (typeof body.name !== "string" || typeof body.icon !== "string") return NextResponse.json({ error: "이름과 아이콘이 필요합니다" }, { status: 400 });
      await createMember({ name: body.name, icon: body.icon });
    } else {
      if (!validId(body.id) || !Number.isSafeInteger(body.expectedVersion) || body.expectedVersion < 1) return NextResponse.json({ error: "멤버 정보가 올바르지 않습니다" }, { status: 400 });
      if (body.action === "archive") {
        await archiveMember(body.id, body.expectedVersion);
      } else if (body.action === "update") {
        const patch: { expectedVersion: number; name?: string; icon?: string; totalContributed?: number } = { expectedVersion: body.expectedVersion };
        if (body.name !== undefined) {
          if (typeof body.name !== "string") return NextResponse.json({ error: "이름을 확인해주세요" }, { status: 400 });
          patch.name = body.name;
        }
        if (body.icon !== undefined) {
          if (typeof body.icon !== "string") return NextResponse.json({ error: "아이콘을 확인해주세요" }, { status: 400 });
          patch.icon = body.icon;
        }
        if (body.totalContributed !== undefined) {
          if (!Number.isSafeInteger(body.totalContributed)) return NextResponse.json({ error: "금액은 원 단위 정수여야 합니다" }, { status: 400 });
          patch.totalContributed = body.totalContributed;
        }
        await updateMember(body.id, patch);
      } else return NextResponse.json({ error: "알 수 없는 작업입니다" }, { status: 400 });
    }
    return NextResponse.json(await getMembers());
  } catch (error) { return apiError(error); }
}
