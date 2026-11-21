/**
 * 校验 Cloudflare Access 签发的 JWT（Cf-Access-Jwt-Assertion 请求头）。
 * Access 在入口已经拦截过，这里是第二道防线：即使 Access 策略配错，API 也不会对外返回数据。
 */
type Jwk = JsonWebKey & { kid: string };
let certCache: { at: number; keys: Jwk[] } | null = null;

const b64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

async function certs(team: string): Promise<Jwk[]> {
  if (certCache && Date.now() - certCache.at < 3600_000) return certCache.keys;
  const r = await fetch(`https://${team}/cdn-cgi/access/certs`);
  if (!r.ok) throw new Error(`拿不到 Access 公钥：HTTP ${r.status}`);
  const keys = ((await r.json()) as { keys: Jwk[] }).keys;
  certCache = { at: Date.now(), keys };
  return keys;
}

export async function verifyAccessJwt(token: string | null, team: string, aud: string): Promise<boolean> {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [h, p, sig] = parts as [string, string, string];
  try {
    const header = JSON.parse(new TextDecoder().decode(b64url(h))) as { kid?: string; alg?: string };
    const payload = JSON.parse(new TextDecoder().decode(b64url(p))) as { aud?: string | string[]; exp?: number; nbf?: number; iss?: string };
    if (header.alg !== "RS256") return false;
    const jwk = (await certs(team)).find((k) => k.kid === header.kid);
    if (!jwk) return false;
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64url(sig), new TextEncoder().encode(`${h}.${p}`));
    if (!ok) return false;
    const now = Math.floor(Date.now() / 1000);
    const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    return auds.includes(aud) && (payload.exp ?? 0) > now && (payload.nbf ?? 0) <= now + 60 && payload.iss === `https://${team}`;
  } catch {
    return false;
  }
}
