// NTalk send-push Edge Function
// Deploy: Supabase Dashboard -> Edge Functions -> Deploy a new function (name: send-push) -> paste this file.
// Secrets (Edge Functions -> Secrets): VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (e.g. mailto:you@example.com)
// VAPID_PUBLIC_KEY config.js lo unna key tho SAME undali.
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "unauthorized" }, 401);

    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    webpush.setVapidDetails(
      Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@example.com",
      Deno.env.get("VAPID_PUBLIC_KEY")!,
      Deno.env.get("VAPID_PRIVATE_KEY")!,
    );

    const body = await req.json();
    const { data: me } = await admin.from("profiles").select("full_name,username").eq("id", user.id).single();
    const myName = me?.full_name || me?.username || "NTalk";

    // per-recipient payloads
    const payloads = new Map<string, Record<string, unknown>>();

    if (body.type === "message") {
      const { data: m } = await admin.from("messages")
        .select("id,chat_id,sender_id,content,message_type").eq("id", body.message_id).single();
      if (!m || m.sender_id !== user.id) return json({ error: "forbidden" }, 403);
      const { data: chat } = await admin.from("chats").select("name,is_group").eq("id", m.chat_id).single();
      const { data: mem } = await admin.from("chat_members").select("user_id").eq("chat_id", m.chat_id);
      const rec = (mem ?? []).map((r) => r.user_id as string).filter((id) => id !== user.id);
      const { data: sec } = await admin.from("secret_chats").select("owner_id").eq("chat_id", m.chat_id).in("owner_id", rec);
      const secret = new Set((sec ?? []).map((r) => r.owner_id as string));
      const text = m.content || (m.message_type === "image" ? "📷 Photo" : m.message_type === "video" ? "🎥 Video" : "📎 File");
      for (const id of rec) {
        payloads.set(id, secret.has(id)
          ? { type: "message", title: "NTalk", body: "New message", tag: "secret" }
          : { type: "message", title: chat?.is_group ? `${myName} · ${chat.name}` : myName, body: text, tag: m.chat_id, chat_id: m.chat_id });
      }
    } else if (body.type === "call" || body.type === "missed_call") {
      const missed = body.type === "missed_call";
      let rec: string[] = [];
      let group = false;
      let chatId: string | null = null;
      if (body.chat_id) {
        const { data: mem } = await admin.from("chat_members").select("user_id").eq("chat_id", body.chat_id);
        const ids = (mem ?? []).map((r) => r.user_id as string);
        if (!ids.includes(user.id)) return json({ error: "forbidden" }, 403);
        rec = ids.filter((id) => id !== user.id);
        group = true;
        chatId = body.chat_id;
      } else if (body.to) {
        rec = [body.to];
      }
      const kind = body.call_type === "video" ? "video" : "voice";
      for (const id of rec) {
        payloads.set(id, missed
          ? { type: "missed_call", title: "Missed call", body: `From ${myName}`, tag: `missed-${user.id}`, from: user.id }
          : { type: "call", title: myName, body: `Incoming ${kind} call`, tag: `call-${user.id}`, from: user.id, ts: Date.now(), group, chat_id: chatId });
      }
    } else {
      return json({ error: "unknown type" }, 400);
    }

    if (!payloads.size) return json({ sent: 0 });
    const { data: subs } = await admin.from("push_subscriptions").select("*").in("user_id", [...payloads.keys()]);
    let sent = 0;
    await Promise.all((subs ?? []).map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify(payloads.get(s.user_id)),
          { TTL: body.type === "call" ? 45 : 86400, urgency: body.type === "call" ? "high" : "normal" },
        );
        sent++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) await admin.from("push_subscriptions").delete().eq("id", s.id);
      }
    }));
    return json({ sent });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
