# Windows startup failures and bounded HTTP connection reuse

## Evidence and limits

The native Windows 151 browser run at commit
`4272aa49a82562e4273967df288a413e658fabaa` failed to load `/fullscreen.js`
on its 21st isolated page context. The diagnostics recorded
`net::ERR_NO_BUFFER_SPACE`, no API requests, a live Rust server, 13,507,194,880
free system bytes out of 17,174,360,064, and a Node RSS of 173,338,624 bytes.
The Node process measurement does not measure Chromium's network process or
kernel networking resources. The bootstrap failed without a retry.

Source: [native Windows run 36926942987](https://github.com/Goldgom/WorldMusicHub/actions/runs/36926942987),
“Test Windows release through real browser UI,” test 21 and its retained JSON.
The same run's separate piano-layout assertion failure is unrelated to the
connection-lifetime change.

The server at that commit sets `keep_alive(false)` for every HTTP request.
There are 48 top-level JavaScript files in this checkout, so serving modules
requires repeated socket establishment and closure rather than normal HTTP/1.1
reuse. That is a concrete, removable source of socket churn. It does **not**
prove that Windows exhausted ephemeral ports:

- Chromium's Windows error mapping maps Winsock `WSAENOBUFS` to
  `ERR_NO_BUFFER_SPACE` ([Chromium source](https://chromium.googlesource.com/chromium/src/net/+/master/base/net_errors_win.cc))
- Microsoft defines `WSAENOBUFS` as insufficient socket buffer space or a full
  queue, not a diagnosis of exhausted system RAM
  ([Winsock errors](https://learn.microsoft.com/en-us/windows/win32/winsock/windows-sockets-error-codes-2))
- Microsoft warns that numerous `TIME_WAIT` entries alone do not establish
  port exhaustion. Its diagnosis requires additional evidence
  ([TCP/IP troubleshooting](https://learn.microsoft.com/en-us/troubleshoot/windows-client/networking/tcp-ip-port-exhaustion-troubleshooting))

No Windows connection-state/process-resource snapshot was retained at the
failure, so the exact resource that failed remains unestablished. A passing
Linux connection test is not a native Windows browser acceptance result.

## Narrow lifetime policy

Only a successful GET whose Hyper request body is already at end-of-stream may
reuse a connection. All other responses explicitly carry `Connection: close`:
POSTs (including successful operations), rejected responses, unsupported
methods, and requests with unconsumed bodies. No additional body draining,
background work, network interface, API access, or dependency is introduced.
The policy uses Hyper's decoded body state rather than inferring zero length
from the HTTP method.

Bounds:

- At most 64 requests per connection; request 64 gets its complete response and
  an explicit close header
- Existing five-second header timeout also closes idle persistent connections
- Existing 30-second absolute connection lifetime remains in force
- Existing 16 accepted connections and two computation permits remain in force
- Existing eight-MiB body limit, five-second body timeout, two-second computation
  permit wait, 64-header count and 32-KiB HTTP buffer remain unchanged
- Loopback binding and exact Host/Origin validation still run for every request

Hyper 1.11.1 re-arms its header timer when a connection returns to idle; this is
confirmed by both `State::idle` and `Conn::poll_read_head` in the
[pinned Hyper source](https://github.com/hyperium/hyper/blob/v1.11.1/src/proto/h1/conn.rs).
The total lifetime is an independent outer timeout and is not extended by
additional successful requests.

[RFC 9112 section 9.3](https://www.rfc-editor.org/rfc/rfc9112.html#section-9.3)
requires the complete request body to be read, or the connection to close,
before another request is processed. Restricting reuse to known-empty GETs
preserves that requirement without changing the existing POST lifecycle.

## Reproducible functional checks

`python tests/server_connection_smoke.py` launches the built Rust server with
`--no-open` and makes ordinary loopback HTTP requests. It does not open a browser,
change any OS/network setting, or retry a failed asset request. Startup readiness
polling happens before measurement.

The measurement loads `/` and every top-level JavaScript file three times, each
time with a new six-connection pool. Every response must exactly match the
embedded source asset. The script records actual client `connect()` calls and
server close headers. `--report-only` permits measuring the old executable;
`--report PATH` retains the result. `WMH_SERVER_BINARY` selects the binary.

The regression additionally checks normal reuse, the exact request-count limit,
the five-second idle bound, the 30-second active total bound, client-requested
closure, and a valid compile POST that closes after its complete JSON response.
Pure Rust unit tests cover connection-policy decisions for errors, methods and
unconsumed bodies. They do not constitute a separate runtime security audit.

### Recorded local result (2026-10-01)

On Linux, using the same frozen frontend assets (including the new notice-view
module) with only the server connection policy changed:

| Measurement | Original close-every-response | Bounded GET reuse |
| --- | ---: | ---: |
| Asset groups × paths | 3 × 50 | 3 × 50 |
| Successful byte-exact GETs | 150 | 150 |
| TCP connections | 150 | 18 |
| Server close responses during those GETs | 150 | 0 |

The ordinary asset measurement used **88% fewer TCP connections**. This is a
functional result, not a simulation of Chromium or a reproduction of the
Windows failure.

The corrected executable also passed all lifetime checks: request 64 returned
its complete response and closed, idle closure took 5.009 seconds, and closure
under continuous ordinary activity took 30.002 seconds. Explicit client close
and a valid compile POST's complete response followed by closure both passed.

- Before binary SHA256: `a9d5ecce5965ae245c7d8c2611ca94ceaf0f4526b9bd1db4d74d5c443ce564d0`
- After binary SHA256: `97c08cac868d0ecae1db6b11dcf6b58bbe117d472af2e91e79fe4756f4861307`
- Rust 1.99.0: `cargo fmt --all --check`, all 286 Linux workspace/all-target
  tests, and `cargo clippy --workspace --all-targets --locked -- -D warnings`
  passed, including the three new connection-policy unit tests

The binaries are local development builds of the frozen current frontend
snapshot; they are not either published Windows milestone executable. The
unchanged native Windows real-browser gate must still pass for the exact next
candidate executable. No local browser launch or runtime security audit was
performed for this change.

To retain this coverage, run `python tests/server_connection_smoke.py` after
building the Rust executable in both normal Linux/Windows verification and the
native release-binary gate, selecting the actual release binary with
`WMH_SERVER_BINARY` for the latter. This adds a separate functional connection
check; it does not replace, weaken or retry the real-browser acceptance gate.

## Useful read-only Windows diagnostics

For the next native browser acceptance run, capture a small baseline before the
suite and another snapshot on bootstrap failure, preserving the original test
failure regardless of whether diagnostics succeed:

1. `Get-NetTCPConnection` state counts, both system-wide and for rows whose
   local or remote loopback port is the app's port; retain local/remote ports,
   state and owning PID for app-related rows
2. `Get-Process` IDs, parent-process relationships when available, handle counts,
   working-set and private-memory bytes for the server, Node and Chromium
   processes, distinguishing the Chromium network-service process
3. Read-only `netsh int ipv4 show dynamicport tcp` and the IPv6 equivalent,
   with any command-access failure retained as unavailable
4. Available system TCP/IP events 4227/4231 around the failure, recording absent
   or unavailable results without elevating permissions or changing logging

These snapshots can distinguish excessive connection churn, persistent socket
accumulation, handle pressure and relevant OS port-allocation evidence. They
are diagnostic evidence, not automatic permission to change dynamic-port
ranges, registry values, firewall/VPN settings or retry the failed bootstrap.
Do not report port exhaustion merely from a high `TIME_WAIT` count.
