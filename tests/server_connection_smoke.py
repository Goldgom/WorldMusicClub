"""Ordinary HTTP/1.1 connection-lifetime regression checks, without a browser.

Build practice-server first. WMH_SERVER_BINARY selects the binary to inspect.
--report-only measures asset connection counts on an older binary without requiring
reuse. Requests are never retried; readiness polling precedes the measurement.
"""
import argparse
import hashlib
import http.client
import json
import os
from pathlib import Path
import socket
import subprocess
import time

ROOT = Path(__file__).resolve().parents[1]
MAX_REQUESTS_PER_CONNECTION = 64


class CountedConnection(http.client.HTTPConnection):
    def __init__(self, port):
        super().__init__("127.0.0.1", port, timeout=8)
        self.connect_count = 0

    def connect(self):
        self.connect_count += 1
        super().connect()


def get(connection, path, headers=None):
    connection.request("GET", path, headers=headers or {})
    response = connection.getresponse()
    body = response.read()
    assert response.status == 200, (path, response.status, body)
    assert response.getheader("X-Content-Type-Options") == "nosniff"
    return response, body


def measure_assets(port):
    # Six lanes resemble a browser's ordinary per-origin HTTP/1.1 pool. Each
    # group closes the pool, like a newly isolated page/browser context.
    paths = ["/"] + ["/" + path.name for path in sorted((ROOT / "web").glob("*.js"))]
    connections = close_responses = requests = 0
    for _ in range(3):
        pool = [CountedConnection(port) for _ in range(6)]
        try:
            for index, path in enumerate(paths):
                response, body = get(pool[index % len(pool)], path)
                expected = ROOT / "web" / ("index.html" if path == "/" else path[1:])
                assert body == expected.read_bytes(), path
                close_responses += response.getheader("Connection", "").lower() == "close"
                requests += 1
            connections += sum(connection.connect_count for connection in pool)
        finally:
            for connection in pool:
                connection.close()
    return {
        "groups": 3,
        "pool_width": 6,
        "paths_per_group": len(paths),
        "requests": requests,
        "tcp_connections": connections,
        "server_close_responses": close_responses,
    }


def check_lifetime(port):
    connection = CountedConnection(port)
    try:
        for number in range(1, MAX_REQUESTS_PER_CONNECTION + 1):
            response, _ = get(connection, "/api/health")
            assert (response.getheader("Connection", "").lower() == "close") == (
                number == MAX_REQUESTS_PER_CONNECTION
            ), number
            assert connection.connect_count == 1, number
        assert connection.sock is None, "Request cap must finish its final response and close"
    finally:
        connection.close()

    connection = CountedConnection(port)
    try:
        get(connection, "/api/health")
        transport = connection.sock
        assert transport is not None
        started = time.monotonic()
        assert transport.recv(1) == b"", "Idle connection must close without another request"
        elapsed = time.monotonic() - started
        assert 3.5 < elapsed < 7.5, elapsed
    finally:
        connection.close()

    connection = CountedConnection(port)
    try:
        get(connection, "/api/health")
        response, _ = get(connection, "/themes.js", {"Connection": "close"})
        assert response.getheader("Connection", "").lower() == "close"
        assert connection.connect_count == 1 and connection.sock is None
    finally:
        connection.close()

    connection = CountedConnection(port)
    try:
        _, body = get(connection, "/api/catalog")
        score = json.loads(body)[0]
        connection.request("POST", "/api/compile", json.dumps(score).encode(), {
            "Content-Type": "application/json",
        })
        response = connection.getresponse()
        compiled = json.loads(response.read())
        assert response.status == 200 and compiled["score"]["id"] == score["id"]
        assert response.getheader("Connection", "").lower() == "close"
        assert connection.connect_count == 1 and connection.sock is None
    finally:
        connection.close()
    connection = CountedConnection(port)
    try:
        started = time.monotonic()
        while time.monotonic() - started < 27:
            get(connection, "/api/health")
            assert connection.connect_count == 1, "Normal activity must reuse the same transport"
            time.sleep(1)
        transport = connection.sock
        assert transport is not None
        assert transport.recv(1) == b"", "Total lifetime must end even with regular requests"
        total_elapsed = time.monotonic() - started
        assert 28 < total_elapsed < 33, total_elapsed
    finally:
        connection.close()
    return {"request_cap": MAX_REQUESTS_PER_CONNECTION, "idle_close_seconds": round(elapsed, 3),
            "total_close_seconds": round(total_elapsed, 3),
            "client_close_honored": True, "post_closes_after_valid_response": True}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report-only", action="store_true")
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    binary = Path(os.environ.get("WMH_SERVER_BINARY", ROOT / "target" / "debug" /
                                 ("practice-server.exe" if os.name == "nt" else "practice-server"))).resolve()
    with socket.socket() as reservation:
        reservation.bind(("127.0.0.1", 0))
        port = reservation.getsockname()[1]
    process = subprocess.Popen([str(binary), "--no-open", "--port", str(port)],
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        for _ in range(100):
            connection = CountedConnection(port)
            try:
                get(connection, "/api/health", {"Connection": "close"})
                break
            except (ConnectionError, OSError):
                assert process.poll() is None, "Server exited during startup"
                time.sleep(.05)
            finally:
                connection.close()
        else:
            raise AssertionError("Server did not become ready")
        result = {"version": 1, "mode": "measurement" if args.report_only else "regression",
                  "binary_sha256": hashlib.sha256(binary.read_bytes()).hexdigest(),
                  "assets": measure_assets(port)}
        if not args.report_only:
            assert result["assets"]["tcp_connections"] == 18, result
            assert result["assets"]["server_close_responses"] == 0, result
            result["lifetime"] = check_lifetime(port)
        assert process.poll() is None, "Server must remain alive after ordinary HTTP checks"
        output = json.dumps(result, indent=2)
        print(output)
        if args.report:
            args.report.parent.mkdir(parents=True, exist_ok=True)
            args.report.write_text(output + "\n", encoding="utf-8")
    finally:
        process.terminate()
        try:
            stdout, stderr = process.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            stdout, stderr = process.communicate(timeout=5)
        if stderr:
            print(stderr)


if __name__ == "__main__":
    main()
