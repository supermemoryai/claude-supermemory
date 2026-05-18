## 2025-05-17 - Insecure File Permissions for API Keys
**Vulnerability:** Configuration files containing API keys were created with default system permissions (typically 0644 or 0664), making them readable by other users on the system.
**Learning:** Node.js `fs.writeFileSync` does not restrict permissions by default. For sensitive data like API keys, explicit permission control is required.
**Prevention:** Always specify `{ mode: 0o600 }` in `fs.writeFileSync` options when saving credentials or sensitive configuration to disk.

## 2025-05-17 - fs.writeFileSync mode limitation
**Vulnerability:** Existing files do not have their permissions updated by `fs.writeFileSync({ mode: ... })`.
**Learning:** The `mode` option in `fs.writeFileSync` only applies during file *creation*. If the file already exists, its permissions remain unchanged even if they are insecure.
**Prevention:** Use `fs.chmodSync(path, 0o600)` after writing to ensure that both new and existing files are correctly restricted.
