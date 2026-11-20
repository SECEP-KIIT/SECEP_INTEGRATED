"""Shared AES-256-GCM encryption/decryption matching Node backend/src/services/crypto.js."""
from __future__ import annotations

import base64
import hashlib
import os
import re
from pathlib import Path

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

_HEX_64_RE = re.compile(r"^[0-9a-f]{64}$", re.IGNORECASE)
_NONCE_LEN = 12
_TAG_LEN = 16


def derive_master_key(raw_text: str) -> bytes:
    """Derive 32-byte AES key from master key text using the exact Node logic.

    1. Strip surrounding whitespace.
    2. If 64 hex chars -> hex decode to 32 bytes.
    3. Else if base64 decodes to exactly 32 bytes -> use those bytes.
    4. Else -> SHA-256(text as UTF-8).
    """
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
    """Read MASTER_KEY_FILE as UTF-8 text and derive the 32-byte key."""
    text = Path(master_key_file).read_text(encoding="utf-8")
    return derive_master_key(text)


def encrypt(plain: str, key: bytes) -> str:
    """Encrypt UTF-8 text as base64(nonce(12) || ciphertext || tag(16))."""
    nonce = os.urandom(_NONCE_LEN)
    aesgcm = AESGCM(key)
    ct_and_tag = aesgcm.encrypt(nonce, plain.encode("utf-8"), None)
    return base64.b64encode(nonce + ct_and_tag).decode("ascii")


def decrypt(enc: str, key: bytes) -> str:
    """Decrypt base64(nonce(12) || ciphertext || tag(16)) to UTF-8 string."""
    buf = base64.b64decode(enc, validate=True)
    if len(buf) < _NONCE_LEN + _TAG_LEN:
        raise ValueError("Ciphertext too short")
    nonce = buf[:_NONCE_LEN]
    ct_and_tag = buf[_NONCE_LEN:]
    aesgcm = AESGCM(key)
    plain = aesgcm.decrypt(nonce, ct_and_tag, None)
    return plain.decode("utf-8")
