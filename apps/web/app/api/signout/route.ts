import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const cookieStore = await cookies();
  cookieStore.delete("wos-session");
  const url = new URL("/login", req.url);
  return NextResponse.redirect(url);
}
