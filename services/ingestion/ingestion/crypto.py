"""AES-256-GCM decryption adapter matching shared format C4."""
from __future__ import annotations

try:
    from secep_common.crypto import decrypt, derive_master_key, encrypt, load_master_key
except ImportError:  # pragma: no cover - fallback when shared package isn't on sys.path
    import base64
    import hashlib
    import os
    import re
    from pathlib import Path
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    _HEX_64_RE = re.compile(r"^[0-9a-f]{64}$", re.IGNORECASE)

    def derive_master_key(raw_text: str) -> bytes:
        raw = raw_text.strip()
        if _HEX_64_RE.fullmatch(raw):
            return bytes.fromhex(raw)
        try:
            b64 = base64.b64decode(raw, validate=True)
            if len(b64) == 32:
                return b64
        except Exception:
            pass
        return hashlib.sha256(raw.encode("utf-8")).digest()

    def load_master_key(master_key_file: str | os.PathLike[str]) -> bytes:
        return derive_master_key(Path(master_key_file).read_text(encoding="utf-8"))

    def encrypt(plain: str, key: bytes) -> str:
        nonce = os.urandom(12)
        ct_and_tag = AESGCM(key).encrypt(nonce, plain.encode("utf-8"), None)
        return base64.b64encode(nonce + ct_and_tag).decode("ascii")

    def decrypt(enc: str, key: bytes) -> str:
        buf = base64.b64decode(enc, validate=True)
        if len(buf) < 28:
            raise ValueError("Ciphertext too short")
        return AESGCM(key).decrypt(buf[:12], buf[12:], None).decode("utf-8")

__all__ = ["derive_master_key", "load_master_key", "encrypt", "decrypt"]
