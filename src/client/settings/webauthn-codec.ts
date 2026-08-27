/**
 * WebAuthn base64url 编解码（浏览器侧）。
 *
 * 与 entry-server 登录页内联 JS 同构（同一仓库同一约定）：
 * options 的 challenge/user.id/excludeCredentials[].id 为 base64url 字符串，
 * 需解码为 ArrayBuffer 才能喂给 navigator.credentials。
 */

/** base64url 字符串 → ArrayBuffer。 */
export function base64urlToBuffer(b64url: string): ArrayBuffer {
  const pad = '='.repeat((4 - b64url.length % 4) % 4)
  const base64 = (b64url + pad).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const buf = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i)
  return buf.buffer
}

/** ArrayBuffer/Uint8Array → base64url 字符串。 */
export function bufferToBase64url(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  let str = ''
  for (const byte of bytes) str += String.fromCharCode(byte)
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}
