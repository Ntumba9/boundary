import { redirect } from "next/navigation";
import { getPageAuth } from "@/lib/auth/page";

export default async function Home() {
  redirect((await getPageAuth()) ? "/dashboard" : "/login");
}
