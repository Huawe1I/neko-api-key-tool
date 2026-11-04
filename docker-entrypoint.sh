#!/bin/sh
set -eu

CONFIG_FILE=/usr/share/nginx/html/config.js

json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

write_config_value() {
  key="$1"
  value="${2:-}"
  escaped_value=$(json_escape "$value")
  printf '  %s: "%s",\n' "$key" "$escaped_value" >> "$CONFIG_FILE"
}

cat > "$CONFIG_FILE" <<'EOF'
window.RUNTIME_CONFIG = {
EOF

DEFAULT_BASE_URL='{"server1": "https://api.server1.com"}'

write_config_value REACT_APP_SERVER "${REACT_APP_SERVER:-}"
write_config_value REACT_APP_SHOW_DETAIL "${REACT_APP_SHOW_DETAIL:-true}"
write_config_value REACT_APP_SHOW_BALANCE "${REACT_APP_SHOW_BALANCE:-true}"
write_config_value REACT_APP_BASE_URL "${REACT_APP_BASE_URL:-$DEFAULT_BASE_URL}"
write_config_value REACT_APP_SHOW_ICONGITHUB "${REACT_APP_SHOW_ICONGITHUB:-true}"

cat >> "$CONFIG_FILE" <<'EOF'
};
EOF

exec nginx -g 'daemon off;'
