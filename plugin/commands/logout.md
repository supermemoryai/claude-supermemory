---
description: Log out from Supermemory and clear saved credentials
allowed-tools: ["Bash"]
---

# Logout from Supermemory

Remove saved Supermemory credentials to allow re-authentication.

## Steps

1. Use Bash to remove the credentials file:
   ```bash
   rm -f ~/.supermemory-claude/credentials.json
   ```

2. Confirm to the user:
   ```
   Successfully logged out from Supermemory.

   Your credentials have been removed. The next time a Supermemory hook runs,
   you'll be prompted to log in again via browser.
   ```
