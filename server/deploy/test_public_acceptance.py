"""Real local HTTP/SQLite regression; not public HTTPS or production acceptance."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.error
import urllib.parse
import urllib.request
from unittest.mock import patch

REPO = Path(__file__).resolve().parents[2]


class CompletedRestartTests(unittest.TestCase):
    def test_interrupted_create_restart_resume_requires_a_later_restart(self):
        spec = importlib.util.spec_from_file_location('acceptance_regression', Path(__file__).with_name('public_acceptance.py'))
        runner = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(runner)
        with tempfile.TemporaryDirectory(prefix='gutters-acceptance-regression-') as temp:
            directory = Path(temp).resolve()
            self.assertTrue(directory.is_relative_to(Path(tempfile.gettempdir()).resolve()))
            runner.STATE_PATH = directory / 'private-test-state.json'
            owner_key = secrets.token_urlsafe(32)
            origin = 'https://acceptance.example.invalid'
            with socket.socket() as listener:
                listener.bind(('127.0.0.1', 0))
                port = listener.getsockname()[1]
            local = 'http://127.0.0.1:' + str(port)
            environment = dict(os.environ, GUTTERS_BIND_HOST='127.0.0.1', GUTTERS_PORT=str(port),
                               GUTTERS_DB_PATH=str(directory / 'gutters.sqlite3'), GUTTERS_OWNER_TOKEN=owner_key,
                               GUTTERS_PUBLIC_ORIGIN=origin, GUTTERS_ALLOWED_ORIGINS=runner.WEBSITE_ORIGIN,
                               GUTTERS_TRUST_PROXY='false')
            server = None
            generation = 0
            lose_ack = True

            def start():
                nonlocal server, generation
                generation += 1
                server = subprocess.Popen(['node', str(REPO / 'server/src/server.mjs')], cwd=REPO,
                                          env=environment, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                          creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
                deadline = time.monotonic() + 10
                while time.monotonic() < deadline:
                    if server.poll() is not None:
                        self.fail('Synthetic Node service exited.')
                    try:
                        with urllib.request.urlopen(local + '/healthz', timeout=1) as response:
                            if response.status == 200:
                                return
                    except (urllib.error.URLError, TimeoutError):
                        time.sleep(0.05)
                self.fail('Synthetic Node service did not become ready.')

            def stop():
                if server is not None and server.poll() is None:
                    server.terminate()
                    try:
                        server.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        server.kill()
                        server.wait(timeout=5)

            def private_fixture(path):
                self.assertTrue(path.is_file() and not path.is_symlink())

            def save_fixture(state, *, exclusive=False):
                # Windows test adapter only; production retains Linux root/fsync checks.
                if exclusive:
                    with open(runner.STATE_PATH, 'x', encoding='utf-8') as output:
                        json.dump(state, output)
                else:
                    temporary = directory / '.state-write'
                    temporary.write_text(json.dumps(state), encoding='utf-8')
                    temporary.replace(runner.STATE_PATH)

            class LoopbackTransport:
                def __init__(self):
                    self.transport = urllib.request.build_opener(runner.NoRedirect)

                def open(self, request, timeout=85):
                    nonlocal lose_ack
                    parsed = urllib.parse.urlsplit(request.full_url)
                    if parsed.scheme + '://' + parsed.netloc != origin:
                        raise AssertionError('Unexpected external address.')
                    target = local + parsed.path + ('?' + parsed.query if parsed.query else '')
                    local_request = urllib.request.Request(target, method=request.method, data=request.data,
                                                           headers=dict(request.header_items()))
                    response = self.transport.open(local_request, timeout=timeout)
                    if lose_ack and request.method == 'POST' and parsed.path == '/conversations':
                        lose_ack = False
                        response.read()
                        response.close()
                        raise urllib.error.URLError('Synthetic lost acknowledgement after committed create')
                    return response

            original_init = runner.PublicChecks.__init__

            def initialize(checker, *args):
                original_init(checker, *args)
                checker.opener = LoopbackTransport()

            def execute(mode):
                stream = io.StringIO()
                with patch.object(sys, 'argv', ['public_acceptance.py', mode]), contextlib.redirect_stdout(stream):
                    code = runner.main()
                output = stream.getvalue()
                self.assertNotIn(owner_key, output)
                state = json.loads(runner.STATE_PATH.read_text())
                for record in state['records'].values():
                    self.assertNotIn(record['accessToken'], output)
                return code, json.loads(output), state

            try:
                with patch.object(runner, 'private_file', private_fixture), patch.object(runner, 'save_state', save_fixture), \
                     patch.object(runner, 'read_environment', lambda: (origin, owner_key)), \
                     patch.object(runner, 'service_identity', lambda: {'pid': str(server.pid), 'started': str(generation)}), \
                     patch.object(runner.os, 'geteuid', lambda: 0, create=True), \
                     patch.object(runner.PublicChecks, '__init__', initialize):
                    start()
                    code, result, interrupted = execute('create')
                    self.assertEqual(code, 1)
                    self.assertEqual(result['error'], 'URLError')
                    self.assertNotIn('completed', interrupted)
                    initial_records = interrupted['records']
                    stop()
                    start()  # This restart predates most of the writes; it must not count.
                    code, result, completed = execute('resume')
                    self.assertEqual(code, 0, result)
                    self.assertEqual(completed['records'], initial_records)
                    self.assertNotEqual(completed['serviceAtStart'], completed['serviceAtCompleted'])
                    code, result, _ = execute('verify')
                    self.assertEqual(code, 1)
                    self.assertEqual(result['error'], 'service_restart_not_observed')
                    stop()
                    start()  # Now every completed write must survive this actual restart.
                    code, result, _ = execute('verify')
                    self.assertEqual(code, 0, result)
                    self.assertTrue(result['restart_survival_verified'])
                    self.assertTrue(result['exact_retries_unchanged'])
            finally:
                stop()


if __name__ == '__main__':
    unittest.main()
