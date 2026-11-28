#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
compiler="${CC:-cc}"
headers="${NODE_INCLUDE:-/usr/include/node}"
output="${NATIVE_OUTPUT:-solver/native/build/turn-river.node}"
if [[ ! -r "$headers/node_api.h" ]]; then
  echo 'Set NODE_INCLUDE to the directory containing node_api.h from the Node development headers.' >&2
  exit 1
fi
case "$(uname -s)" in
  Linux) link=(-shared) ;;
  Darwin) link=(-bundle -undefined dynamic_lookup) ;;
  *) echo 'This addon build script supports Linux and macOS.' >&2; exit 1 ;;
esac
mkdir -p "$(dirname "$output")"
# User-supplied CPU flags are optional. The default binary uses the compiler's baseline ISA.
read -r -a cpu_flags <<< "${CPU_CFLAGS:-}"
"$compiler" -std=c11 -O3 -Wall -Wextra -Werror -ffp-contract=off -fPIC \
  "${cpu_flags[@]}" "${link[@]}" -I"$headers" -DNAPI_VERSION=8 \
  solver/native/solver.c solver/native/node-addon.c -o "$output"
