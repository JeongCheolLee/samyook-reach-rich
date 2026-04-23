import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { addComment, deleteComment, listComments } from "@/lib/comments";
import { getMembers } from "@/lib/members";

const MAX_LEN = 500;

export const dynamic = "force-dynamic";

export async function GET() {
  const comments = await listComments();
  return NextResponse.json(comments);
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const author = typeof body?.author === "string" ? body.author.trim() : "";
  const text = typeof body?.text === "string" ? body.text.trim() : "";

  if (!author || !text) {
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
  const member = members.find((m) => m.name === author);
  if (!member) {
    return NextResponse.json(
      { error: "등록된 멤버가 아닙니다" },
      { status: 400 }
    );
  }

  const comment = await addComment(member.name, member.icon, text);
  return NextResponse.json(comment);
}

export async function DELETE(request: Request) {
  const cookieStore = await cookies();
  if (!cookieStore.get("admin_token")) {
    return NextResponse.json({ error: "권한 없음" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id 필요" }, { status: 400 });
  }

  const removed = await deleteComment(id);
  return NextResponse.json({ removed });
}
