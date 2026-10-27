'use strict';
/* Vault: password-based encryption with the browser's WebCrypto. No third-party code.

   Envelope design (the same idea password managers use):
     data key (DK)      random 256-bit AES-GCM key. It encrypts the profile's data. It never changes.
     password wrap      DK encrypted with a key derived from the password (PBKDF2-SHA256, 600k rounds, then HKDF).
     recovery wrap      DK encrypted with a key derived from a random recovery key shown once at sign-up.
     login secret       a second value derived from the password. A server may hold a hash of it; it cannot
                        decrypt anything and it is not the password.
   Changing the password only re-wraps DK, so nothing has to be re-encrypted and the recovery key keeps working.
   Sealed values look like  "v1.<iv>.<ciphertext>"  (base64). */
const Vault = (() => {
  const V = { ITER: 600000 };
  const enc = new TextEncoder(), dec = new TextDecoder();
  const subtle = () => { const c = globalThis.crypto; if (!c || !c.subtle) throw new Error('NO_CRYPTO'); return c.subtle; };
  V.available = () => !!(globalThis.crypto && globalThis.crypto.subtle);

  /* ---------- encoding ---------- */
  const b64 = bytes => { const a = new Uint8Array(bytes); let s = ''; for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  V.b64 = b64; V.unb64 = unb64;
  V.b64url = bytes => b64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  V.random = n => globalThis.crypto.getRandomValues(new Uint8Array(n));

  /* ---------- primitives ---------- */
  async function pbkdf2(password, salt, iter) {
    const key = await subtle().importKey('raw', enc.encode(String(password).normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
    return new Uint8Array(await subtle().deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256));
  }
  async function hkdf(secret, info) {
    const key = await subtle().importKey('raw', secret, 'HKDF', false, ['deriveBits']);
    return new Uint8Array(await subtle().deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: enc.encode('ledgerly-v1'), info: enc.encode(info) }, key, 256));
  }
  const aes = raw => subtle().importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);

  /** Encrypt text or bytes. */
  V.seal = async (keyBytes, data) => {
    const iv = V.random(12);
    const ct = await subtle().encrypt({ name: 'AES-GCM', iv }, await aes(keyBytes), typeof data === 'string' ? enc.encode(data) : data);
    return `v1.${b64(iv)}.${b64(ct)}`;
  };
  /** Decrypt. Throws BAD_KEY for a wrong key or tampered data. */
  V.open = async (keyBytes, sealed, asBytes = false) => {
    const [v, iv, ct] = String(sealed).split('.');
    if (v !== 'v1' || !iv || !ct) throw new Error('BAD_FORMAT');
    try {
      const pt = await subtle().decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await aes(keyBytes), unb64(ct));
      return asBytes ? new Uint8Array(pt) : dec.decode(pt);
    } catch (e) { throw new Error('BAD_KEY'); }
  };

  /* ---------- password and recovery key ---------- */
  V.fromPassword = async (password, salt, iter) => {
    const master = await pbkdf2(password, salt, iter || V.ITER);
    return { kek: await hkdf(master, 'kek'), auth: V.b64url(await hkdf(master, 'auth')) };
  };
  V.fromRecovery = async bytes => ({ kek: await hkdf(bytes, 'rec-kek'), auth: V.b64url(await hkdf(bytes, 'rec-auth')) });

  const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford: no I, L, O, U
  const toB32 = bytes => { let acc = 0, bits = 0, out = ''; for (const b of bytes) { acc = ((acc << 8) | b) & 0xFFFFFF; bits += 8; while (bits >= 5) { out += B32[(acc >>> (bits - 5)) & 31]; bits -= 5; } } if (bits) out += B32[(acc << (5 - bits)) & 31]; return out; };
  const fromB32 = s => { let acc = 0, bits = 0; const out = []; for (const ch of s) { const v = B32.indexOf(ch); if (v < 0) return null; acc = ((acc << 5) | v) & 0xFFFFFF; bits += 5; if (bits >= 8) { out.push((acc >>> (bits - 8)) & 255); bits -= 8; } } return Uint8Array.from(out); };
  /** 16 random bytes as "ABCD-EFGH-IJKL-MNPQ-RSTV-WX". */
  V.formatRecovery = bytes => toB32(bytes).match(/.{1,4}/g).join('-');
  /** Accepts any case, spaces or dashes; forgives O/I/L typos. Returns bytes or null. */
  V.parseRecovery = text => {
    const s = String(text || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
    if (s.length !== 26) return null;
    const b = fromB32(s);
    return b && b.length === 16 ? b : null;
  };

  /** Everything needed for a brand-new account. */
  V.createAccount = async password => {
    const salt = V.random(16), dk = V.random(32), rec = V.random(16);
    const pw = await V.fromPassword(password, salt, V.ITER), rc = await V.fromRecovery(rec);
    return { dk, recovery: rec, salt: b64(salt), iter: V.ITER, auth: pw.auth, pwWrap: await V.seal(pw.kek, dk), recAuth: rc.auth, recWrap: await V.seal(rc.kek, dk) };
  };
  /** Password -> data key. rec = { salt, iter, pwWrap }. Throws BAD_KEY for a wrong password. */
  V.unlock = async (password, rec) => {
    const pw = await V.fromPassword(password, unb64(rec.salt), rec.iter);
    return { dk: await V.open(pw.kek, rec.pwWrap, true), auth: pw.auth };
  };
  V.unlockWithRecovery = async (recoveryBytes, recWrap) => {
    const rc = await V.fromRecovery(recoveryBytes);
    return { dk: await V.open(rc.kek, recWrap, true), recAuth: rc.auth };
  };
  /** New password for the same data key: fresh salt, new wrap, new login secret. */
  V.rewrap = async (newPassword, dk) => {
    const salt = V.random(16), pw = await V.fromPassword(newPassword, salt, V.ITER);
    return { salt: b64(salt), iter: V.ITER, auth: pw.auth, pwWrap: await V.seal(pw.kek, dk) };
  };

  /** Rough 0 to 4 guide for the sign-up form. Not a security boundary. */
  V.strength = password => {
    const p = String(password || '');
    if (p.length < 8) return 0;
    let s = 0;
    if (p.length >= 8) s++;
    if (p.length >= 12) s++;
    if (/[a-z؀-ۿ]/.test(p) && /[A-Z0-9]/.test(p)) s++;
    if (/[^A-Za-z0-9]/.test(p) || (/\d/.test(p) && /[A-Za-z؀-ۿ]/.test(p) && p.length >= 10)) s++;
    if (/^(.)\1+$/.test(p) || /^(password|12345678|qwertyui|ledgerly|11111111)/i.test(p)) s = Math.min(s, 1);
    return Math.min(4, s);
  };

  return V;
})();
