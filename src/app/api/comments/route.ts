import { NextResponse } from "next/server";
import { requireAdmin } from "@/server/auth";
import { apiError, validId } from "@/server/api-errors";
import { addComment, deleteComment, listComments } from "@/lib/comments";
import { getMembers } from "@/lib/members";
import { parseUserAgent } from "@/lib/useragent";
import { lookup } from "@/lib/geoip";

const MAX_LEN = 500;

export const dynamic = "force-dynamic";

export async function GET() {
  const comments = await listComments();
  return NextResponse.json(comments);
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const authorId = body?.authorId;
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  const parentId = typeof body?.parentId === "string" ? body.parentId : null;

  if (!validId(authorId) || !text) {
    return NextResponse.json(
      { error: "이름과 내용을 입력해주세요" },
      { status: 400 }
    );
  }
  if (text.length > MAX_LEN) {
    return NextResponse.json(
      { error: `${MAX_LEN}자 이내로 입력해주세요` },
      { status: 400 }
    );
  }

  const members = await getMembers();
  const member = members.find((m) => m.id === authorId);
  if (!member) {
    return NextResponse.json(
      { error: "등록된 멤버가 아닙니다" },
      { status: 400 }
    );
  }

  if (body.parentId !== undefined && body.parentId !== null && !validId(body.parentId)) {
    return NextResponse.json({ error: "잘못된 댓글 id입니다" }, { status: 400 });
  }

  // 답글이면 부모 검증 (존재 + 답글에 답글 금지)
  if (parentId) {
    const comments = await listComments();
    const parent = comments.find((c) => c.id === parentId);
    if (!parent) {
      return NextResponse.json(
        { error: "존재하지 않는 댓글입니다" },
        { status: 400 }
      );
    }
    if (parent.parentId) {
      return NextResponse.json(
        { error: "답글에는 답글을 달 수 없어요" },
        { status: 400 }
      );
    }
  }

  // 접속 정보 수집
  const xff = request.headers.get("x-forwarded-for");
  const ip =
    (xff ? xff.split(",")[0].trim() : "") ||
    request.headers.get("x-real-ip") ||
    null;
  const ua = request.headers.get("user-agent");
  const device = parseUserAgent(ua);
  const { geo, isp } = await lookup(ip);

  try {
    const comment = await addComment(member.name, member.icon, text, parentId, {
      ip, ua, device, geo, isp,
    });
    return NextResponse.json(comment);
  } catch (error) { return apiError(error); }
}

export async function DELETE(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!validId(id)) {
    return NextResponse.json({ error: "id 필요" }, { status: 400 });
  }

  try {
    const removed = await deleteComment(id);
    return NextResponse.json({ removed });
  } catch (error) { return apiError(error); }
}
